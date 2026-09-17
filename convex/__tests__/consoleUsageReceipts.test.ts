/** @jest-environment node */
import {
  beginConsoleUsageOperation,
  getConsoleUsageReceipts,
} from "../extraUsage";
jest.mock("../_generated/server", () => ({
  mutation: (x: unknown) => x,
  query: (x: unknown) => x,
  internalMutation: (x: unknown) => x,
  internalQuery: (x: unknown) => x,
}));
const begin = (beginConsoleUsageOperation as any).handler;
const read = (getConsoleUsageReceipts as any).handler;
const key = "usage-test-authority";
const saved = process.env.CONVEX_SERVICE_ROLE_KEY;
beforeEach(() => {
  process.env.CONVEX_SERVICE_ROLE_KEY = key;
});
afterEach(() => {
  if (saved === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
  else process.env.CONVEX_SERVICE_ROLE_KEY = saved;
});
function storage(initial: Record<string, any[]> = {}) {
  const tables = {
    console_usage_operations: [],
    console_workspace_operations: [],
    account_credit_reservations: [],
    usage_settlements: [],
    chats: [],
    ...initial,
  } as Record<string, any[]>;
  const db = {
    insert: async (table: string, row: any) => {
      tables[table].push(row);
      return "id";
    },
    query: (table: string) => ({
      withIndex: (_name: string, range: (q: any) => unknown) => {
        const filters: Array<(row: any) => boolean> = [];
        const q = {
          eq: (k: string, v: unknown) => {
            filters.push((row) => row[k] === v);
            return q;
          },
        };
        range(q);
        const select = () =>
          tables[table].filter((row) => filters.every((f) => f(row)));
        return {
          unique: async () => {
            const rows = select();
            if (rows.length > 1) throw Error("duplicate");
            return rows[0] ?? null;
          },
          take: async (n: number) => select().slice(0, n),
        };
      },
    }),
  };
  return { db };
}
const identity = {
  serviceKey: key,
  userId: "owner",
  sessionId: "s",
  operationId: "op",
  reservationKey: "credit:console:server:preflight",
};
test("one owner operation can authorize exactly one dispatch even after process restart", async () => {
  const ctx = storage();
  expect(await begin(ctx, identity)).toBe(true);
  expect(
    await begin(ctx, {
      ...identity,
      reservationKey: "credit:console:new:preflight",
    }),
  ).toBe(false);
  expect(
    await read(ctx, { serviceKey: key, userId: "owner", sessionId: "s" }),
  ).toEqual([{ operationId: "op", status: "unknown", credits: null }]);
  expect(
    await read(ctx, { serviceKey: key, userId: "other", sessionId: "s" }),
  ).toEqual([]);
});
test("binds exact ledger receipts and never reads another owner's reservation", async () => {
  const ctx = storage({
    account_credit_reservations: [
      {
        reservation_key: identity.reservationKey,
        user_id: "owner",
        state: "settled",
        terminal_settlement: {
          result: { state: "settled", receipt: { actualPoints: 25 } },
        },
      },
    ],
  });
  await begin(ctx, identity);
  expect(
    await read(ctx, { serviceKey: key, userId: "owner", sessionId: "s" }),
  ).toEqual([{ operationId: "op", status: "settled", credits: 25 }]);
  const foreign = storage({
    console_usage_operations: [
      {
        user_id: "owner",
        session_id: "s",
        operation_id: "op",
        reservation_key: "foreign",
      },
    ],
    account_credit_reservations: [
      {
        reservation_key: "foreign",
        user_id: "other",
        state: "settled",
        terminal_settlement: {
          result: { state: "settled", receipt: { actualPoints: 99 } },
        },
      },
    ],
  });
  expect(
    await read(foreign, { serviceKey: key, userId: "owner", sessionId: "s" }),
  ).toEqual([{ operationId: "op", status: "unknown", credits: null }]);
});
test.each(["pending", "uncertain", "acknowledged"])(
  "hosted %s journal only reveals acknowledged charged points",
  async (state) => {
    const ctx = storage({
      chats: [{ id: "chat", user_id: "owner" }],
      usage_settlements: [
        {
          user_id: "owner",
          chat_id: "chat",
          run_id: "run",
          actual_points: 10,
          state,
        },
      ],
    });
    const result = await read(ctx, {
      serviceKey: key,
      userId: "owner",
      chatId: "chat",
    });
    expect(result[0]).toMatchObject({
      status:
        state === "acknowledged"
          ? "settled"
          : state === "pending"
            ? "pending"
            : "unknown",
      credits: state === "acknowledged" ? 10 : null,
    });
    await expect(
      read(ctx, { serviceKey: key, userId: "other", chatId: "chat" }),
    ).rejects.toThrow();
  },
);
test("rejects absent service authority and mixed selectors", async () => {
  await expect(
    begin(storage(), { ...identity, serviceKey: "wrong" }),
  ).rejects.toThrow();
  await expect(
    read(storage(), {
      serviceKey: key,
      userId: "owner",
      chatId: "chat",
      sessionId: "s",
    }),
  ).rejects.toThrow();
});

test.each(["running", "cancel_requested", "uncertain", "completed", "failed"])(
  "hosted %s operations cannot disappear behind prior settled usage",
  async (status) => {
    const ctx = storage({
      chats: [{ id: "chat", user_id: "owner" }],
      console_workspace_operations: [
        { user_id: "owner", chat_id: "chat", operation_id: "new", status },
      ],
      usage_settlements: [
        {
          user_id: "owner",
          chat_id: "chat",
          run_id: "prior",
          state: "acknowledged",
          actual_points: 25,
        },
      ],
    });
    expect(
      await read(ctx, { serviceKey: key, userId: "owner", chatId: "chat" }),
    ).toContainEqual({
      operationId: "workspace:new",
      status: ["running", "cancel_requested"].includes(status)
        ? "pending"
        : "unknown",
      credits: null,
    });
  },
);
test("completed hosted operations require their own acknowledged receipt", async () => {
  const ctx = storage({
    chats: [{ id: "chat", user_id: "owner" }],
    console_workspace_operations: [
      {
        user_id: "owner",
        chat_id: "chat",
        operation_id: "op",
        status: "completed",
      },
    ],
    usage_settlements: [
      {
        user_id: "owner",
        chat_id: "chat",
        run_id: "run",
        operation_id: "op",
        state: "acknowledged",
        actual_points: 25,
      },
    ],
  });
  expect(
    await read(ctx, { serviceKey: key, userId: "owner", chatId: "chat" }),
  ).toEqual([{ operationId: "run", status: "settled", credits: 25 }]);
});

test("an acknowledged intermediate receipt does not complete a running operation", async () => {
  const ctx = storage({
    chats: [{ id: "chat", user_id: "owner" }],
    console_workspace_operations: [
      {
        user_id: "owner",
        chat_id: "chat",
        operation_id: "op",
        status: "running",
      },
    ],
    usage_settlements: [
      {
        user_id: "owner",
        chat_id: "chat",
        run_id: "run",
        operation_id: "op",
        state: "acknowledged",
        actual_points: 25,
      },
    ],
  });
  expect(
    await read(ctx, { serviceKey: key, userId: "owner", chatId: "chat" }),
  ).toEqual([
    { operationId: "run", status: "settled", credits: 25 },
    { operationId: "workspace:op", status: "pending", credits: null },
  ]);
});
test("changing sessions cannot replay an owner's operation identity", async () => {
  const ctx = storage();
  expect(await begin(ctx, identity)).toBe(true);
  expect(await begin(ctx, { ...identity, sessionId: "another" })).toBe(false);
  expect(
    await read(ctx, { serviceKey: key, userId: "owner", sessionId: "another" }),
  ).toEqual([]);
});
