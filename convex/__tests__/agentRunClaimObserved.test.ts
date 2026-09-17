/** @jest-environment node */
import { webcrypto } from "node:crypto";
jest.mock("../_generated/server", () => ({
  mutation: (config: unknown) => config,
  internalMutation: (config: unknown) => config,
  query: (config: unknown) => config,
  internalQuery: (config: unknown) => config,
  action: (config: unknown) => config,
}));
jest.mock("../lib/logger", () => ({
  convexLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../unitEconomicsLib", () => ({
  recordRevenueEventInternal: jest.fn(),
}));
const SERVICE = "isolated-test-key";
const NOW = Date.parse("2026-09-11T12:00:00Z");
type Row = Record<string, any>;
function fixture() {
  const tables: Record<string, Row[]> = {
    chats: [
      {
        _id: "chat-row",
        _creationTime: NOW,
        id: "chat",
        user_id: "owner",
        title: "test",
        update_time: NOW,
      },
    ],
    agent_run_claims: [],
    hack_http_execution_heads: [],
    hack_http_executions: [],
    agent_dispatch_requests: [],
  };
  const db = {
    query: jest.fn((table: string) => ({
      withIndex: (_index: string, predicate: (q: any) => unknown) => {
        const matches: Record<string, unknown> = {};
        const q = {
          eq: (field: string, value: unknown) => {
            matches[field] = value;
            return q;
          },
        };
        predicate(q);
        return {
          take: async (n: number) =>
            tables[table]
              .filter((r) =>
                Object.entries(matches).every(
                  ([key, value]) => r[key] === value,
                ),
              )
              .slice(0, n),
        };
      },
    })),
    patch: jest.fn(async (id: string, patch: Row) => {
      const found = Object.values(tables)
        .flat()
        .find((r) => r._id === id);
      if (!found) throw new Error("missing row");
      Object.assign(found, patch);
    }),
    insert: jest.fn(async (table: string, value: Row) => {
      const next = { _id: `${table}-${tables[table].length}`, ...value };
      tables[table].push(next);
      return next._id;
    }),
  };
  return { ctx: { db }, tables };
}

const owner = { serviceKey: SERVICE, userId: "owner", chatId: "chat" };
const saved = process.env.CONVEX_SERVICE_ROLE_KEY;
beforeEach(() => {
  process.env.CONVEX_SERVICE_ROLE_KEY = SERVICE;
  jest.useFakeTimers().setSystemTime(NOW);
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
});
afterEach(() => {
  jest.useRealTimers();
  if (saved === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
  else process.env.CONVEX_SERVICE_ROLE_KEY = saved;
});

async function setup(temporary = false) {
  const f = fixture();
  if (temporary) f.tables.chats = [];
  const claims: any = await import("../agentRunClaims");
  const observed = (
    claimId: string,
    previousClaimId: string | null,
    extra = {},
  ) =>
    claims.reserveObserved.handler(f.ctx, {
      ...owner,
      claimId,
      previousClaimId,
      ...extra,
    });
  const activate = (claimId: string, runId: string) =>
    claims.activateForWorker.handler(f.ctx, {
      ...owner,
      claimId,
      runId,
      requireChat: !temporary,
    });
  const release = (claimId: string, runId?: string) =>
    claims.release.handler(f.ctx, {
      ...owner,
      claimId,
      ...(runId ? { runId } : {}),
    });
  return { ...f, claims, observed, activate, release };
}

it.each([false, true])(
  "immutable original A replay cannot reopen after B retires (temporary=%s)",
  async (temporary) => {
    const f = await setup(temporary);
    const original = Object.freeze({
      ...owner,
      claimId: "a",
      previousClaimId: null,
    });
    expect(
      await f.claims.reserveObserved.handler(f.ctx, original),
    ).toMatchObject({ acquired: true });
    expect(await f.activate("a", "run-a")).toMatchObject({ activated: true });
    expect(
      await f.claims.requestCancellation.handler(f.ctx, {
        ...owner,
        claimId: "a",
        runId: "run-a",
      }),
    ).toBe(true);
    expect(await f.release("a", "run-a")).toBe(true);
    expect(await f.observed("b", "a")).toMatchObject({ acquired: true });
    expect(await f.activate("b", "run-b")).toMatchObject({ activated: true });
    expect(await f.release("b", "run-b")).toBe(true);
    const before = structuredClone(f.tables);
    expect(
      await f.claims.reserveObserved.handler(f.ctx, original),
    ).toMatchObject({ acquired: false, claimId: "b" });
    expect(await f.activate("a", "run-a")).toEqual({ activated: false });
    expect(
      await f.claims.isExecutionCurrent.handler(f.ctx, {
        ...owner,
        claimId: "a",
        runId: "run-a",
        requireChat: !temporary,
      }),
    ).toBe(false);
    expect(f.tables).toEqual(before);
  },
);

it("stale non-null predecessor cannot install a delayed first reservation", async () => {
  const f = await setup();
  await f.observed("p", null);
  await f.release("p");
  const delayed = Object.freeze({
    ...owner,
    claimId: "a",
    previousClaimId: "p",
  });
  await f.observed("b", "p");
  await f.release("b");
  expect(await f.claims.reserveObserved.handler(f.ctx, delayed)).toMatchObject({
    acquired: false,
    claimId: "b",
  });
});

it("same-current live replay succeeds with original stale predecessor without renewing lease", async () => {
  const f = await setup();
  const first = await f.observed("a", null);
  jest.setSystemTime(NOW + 100);
  expect(await f.observed("a", null)).toEqual(first);
  expect(f.tables.agent_run_claims).toHaveLength(1);
  expect(f.tables.agent_run_claims[0].lease_until).toBe(NOW + 90_000);
});

it.each(["canceled", "released", "expired", "active"])(
  "same-current %s ID never grants a fresh reservation",
  async (state) => {
    const f = await setup();
    await f.observed("a", null);
    if (state === "canceled")
      await f.claims.requestCancellation.handler(f.ctx, {
        ...owner,
        claimId: "a",
      });
    if (state === "released") await f.release("a");
    if (state === "expired") jest.setSystemTime(NOW + 90_001);
    if (state === "active") await f.activate("a", "run-a");
    expect(
      await f.observed(
        "a",
        null,
        state === "active" ? { expectedChatRunId: "run-a" } : {},
      ),
    ).toMatchObject({ acquired: false, claimId: "a" });
  },
);

it.each(["a", "b"])(
  "serial contender order with %s first grants only that request",
  async (winner) => {
    const f = await setup();
    const loser = winner === "a" ? "b" : "a";
    // Model both legal serial commit orders, not concurrent writes to an array DB.
    expect(await f.observed(winner, null)).toMatchObject({ acquired: true });
    expect(await f.observed(loser, null)).toMatchObject({
      acquired: false,
      claimId: winner,
    });
    expect(await f.observed(winner, null)).toMatchObject({ acquired: true });
    expect(f.tables.agent_run_claims).toHaveLength(1);
  },
);

it("accepted A with non-null predecessor cannot replay after B", async () => {
  const f = await setup();
  await f.observed("p", null);
  await f.release("p");
  const original = Object.freeze({
    ...owner,
    claimId: "a",
    previousClaimId: "p",
  });
  expect(await f.claims.reserveObserved.handler(f.ctx, original)).toMatchObject(
    { acquired: true },
  );
  await f.release("a");
  await f.observed("b", "a");
  await f.release("b");
  expect(await f.claims.reserveObserved.handler(f.ctx, original)).toMatchObject(
    { acquired: false, claimId: "b" },
  );
});

it("a fresh request can replace its observed released predecessor", async () => {
  const f = await setup();
  await f.observed("a", null);
  await f.release("a");
  expect(await f.observed("b", "a")).toMatchObject({
    acquired: true,
    claimId: "b",
  });
});

it("matching observation cannot implicitly take over an active run", async () => {
  const f = await setup();
  await f.observed("a", null);
  await f.activate("a", "run-a");
  expect(
    await f.observed("b", "a", { expectedChatRunId: "run-a" }),
  ).toMatchObject({ acquired: false, claimId: "a" });
  expect(
    await f.observed("b", "a", {
      expectedChatRunId: "run-a",
      expectedClaimId: "a",
      expectedRunId: "run-a",
    }),
  ).toMatchObject({ acquired: true, claimId: "b" });
});

it("matching takeover proof cannot bypass stale predecessor", async () => {
  const f = await setup();
  await f.observed("a", null);
  await f.activate("a", "run-a");
  expect(
    await f.observed("b", null, {
      expectedChatRunId: "run-a",
      expectedClaimId: "a",
      expectedRunId: "run-a",
    }),
  ).toMatchObject({ acquired: false, claimId: "a" });
});

it("matching predecessor cannot bypass current mapped run", async () => {
  const f = await setup();
  await f.observed("a", null);
  await f.release("a");
  f.tables.chats[0].active_trigger_run_id = "other";
  expect(await f.observed("b", "a")).toMatchObject({ acquired: false });
});

it.each(["", " padded", "x".repeat(201)])(
  "rejects invalid observed predecessor %s without writes",
  async (previous) => {
    const f = await setup();
    await expect(f.observed("a", previous)).rejects.toMatchObject({
      data: { code: "INVALID_CLAIM" },
    });
    expect(f.ctx.db.insert).not.toHaveBeenCalled();
    expect(f.ctx.db.patch).not.toHaveBeenCalled();
  },
);

it.each(["foreign-chat", "foreign-claim", "duplicate-claim", "bad-service"])(
  "preserves %s authority validation",
  async (scenario) => {
    const f = await setup();
    await f.observed("a", null);
    await f.release("a");
    if (scenario === "foreign-chat") f.tables.chats[0].user_id = "foreign";
    if (scenario === "foreign-claim")
      f.tables.agent_run_claims[0].user_id = "foreign";
    if (scenario === "duplicate-claim")
      f.tables.agent_run_claims.push({
        ...f.tables.agent_run_claims[0],
        _id: "dup",
      });
    const before = structuredClone(f.tables);
    await expect(
      f.observed(
        "b",
        "a",
        scenario === "bad-service" ? { serviceKey: "wrong" } : {},
      ),
    ).rejects.toThrow();
    expect(f.tables).toEqual(before);
  },
);

it("legacy reserve remains compatible and explicitly outside predecessor protection", async () => {
  const f = await setup();
  await f.observed("a", null);
  await f.release("a");
  await f.observed("b", "a");
  await f.release("b");
  expect(
    await f.claims.reserve.handler(f.ctx, { ...owner, claimId: "a" }),
  ).toMatchObject({ acquired: true, claimId: "a" });
});

it("expired successor still rejects immutable original even though both leases expired", async () => {
  const f = await setup();
  await f.observed("a", null);
  jest.setSystemTime(NOW + 90_001);
  expect(await f.observed("b", "a")).toMatchObject({ acquired: true });
  jest.setSystemTime(NOW + 180_002);
  const before = structuredClone(f.tables);
  expect(await f.observed("a", null)).toMatchObject({
    acquired: false,
    claimId: "b",
  });
  expect(f.tables).toEqual(before);
  expect(await f.observed("c", "b")).toMatchObject({ acquired: true });
});
it("non-null observation rejects disappearance of the predecessor row", async () => {
  const f = await setup();
  await f.observed("a", null);
  await f.release("a");
  f.tables.agent_run_claims.length = 0;
  expect(await f.observed("b", "a")).toMatchObject({ acquired: false });
  expect(f.tables.agent_run_claims).toHaveLength(0);
});
it("chat deletion does not erase retained predecessor protection for delayed temporary work", async () => {
  const f = await setup();
  await f.observed("a", null);
  await f.release("a");
  await f.observed("b", "a");
  await f.release("b");
  f.tables.chats.length = 0;
  const before = structuredClone(f.tables);
  expect(await f.observed("a", null)).toMatchObject({
    acquired: false,
    claimId: "b",
  });
  expect(f.tables).toEqual(before);
});
