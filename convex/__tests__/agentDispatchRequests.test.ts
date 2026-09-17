/** @jest-environment node */
// Handler tests exercise state transitions with an in-memory DB double.
// They do not prove Convex transaction isolation or concurrent uniqueness.
jest.mock("../_generated/server", () => ({
  mutation: (c: unknown) => c,
  query: (c: unknown) => c,
}));
const SERVICE = "isolated-test-key";
const NOW = 1800000000000;
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
    agent_run_claims: [
      {
        _id: "claim-row",
        user_id: "owner",
        chat_id: "chat",
        claim_id: "claim",
        phase: "starting",
        lease_until: NOW + 90000,
      },
    ],
    agent_dispatch_requests: [],
    agent_dispatch_admissions: [],
    agent_dispatch_intents: [],
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

const owner = {
  serviceKey: SERVICE,
  userId: "owner",
  chatId: "chat",
  dispatchId: "dispatch",
};
const creation = {
  ...owner,
  claimId: "claim",
  requestMessageId: "message",
  payloadHash: "a".repeat(64),
  fingerprintVersion: 1,
};
const saved = process.env.CONVEX_SERVICE_ROLE_KEY;
beforeEach(() => {
  process.env.CONVEX_SERVICE_ROLE_KEY = SERVICE;
  jest.useFakeTimers().setSystemTime(NOW);
});
afterEach(() => {
  jest.useRealTimers();
  if (saved === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
  else process.env.CONVEX_SERVICE_ROLE_KEY = saved;
});
async function setup() {
  return {
    ...fixture(),
    api: (await import("../agentDispatchRequests")) as any,
  };
}
it("creates once and returns the identical receipt on a sequential retry", async () => {
  const { ctx, tables, api } = await setup();
  const first = await api.create.handler(ctx, creation);
  expect(first.created).toBe(true);
  expect((await api.create.handler(ctx, creation)).created).toBe(false);
  expect(tables.agent_dispatch_requests).toHaveLength(1);
  expect((await api.getForBackend.handler(ctx, owner)).state).toBe("reserved");
});
it("rejects service and chat/claim ownership mismatches", async () => {
  const { ctx, tables, api } = await setup();
  await expect(
    api.create.handler(ctx, { ...creation, serviceKey: "wrong" }),
  ).rejects.toThrow();
  await expect(
    api.getForBackend.handler(ctx, { ...owner, userId: "other" }),
  ).rejects.toThrow();
  tables.chats = [];
  await expect(
    api.create.handler(ctx, { ...creation, userId: "other" }),
  ).rejects.toThrow();
  expect(tables.agent_dispatch_requests).toHaveLength(0);
});
it.each([
  { payloadHash: "b".repeat(64) },
  { claimId: "other" },
  { requestMessageId: "other" },
])("rejects immutable binding changes %p", async (change) => {
  const { ctx, api } = await setup();
  await api.create.handler(ctx, creation);
  await expect(
    api.create.handler(ctx, { ...creation, ...change }),
  ).rejects.toThrow();
});
it("requires a live uncanceled starting claim for creation and dispatch", async () => {
  const { ctx, tables, api } = await setup();
  tables.agent_run_claims[0].cancel_requested_at = NOW;
  await expect(api.create.handler(ctx, creation)).rejects.toThrow();
  delete tables.agent_run_claims[0].cancel_requested_at;
  await api.create.handler(ctx, creation);
  tables.agent_run_claims[0].claim_id = "replacement";
  await expect(
    api.markDispatching.handler(ctx, { ...owner, claimId: "claim" }),
  ).rejects.toThrow();
});
it("records accepted run once and rejects a competing run binding", async () => {
  const { ctx, api } = await setup();
  await api.create.handler(ctx, creation);
  await api.markDispatching.handler(ctx, { ...owner, claimId: "claim" });
  const accepted = { ...owner, claimId: "claim", runId: "run" };
  await api.recordAccepted.handler(ctx, accepted);
  await api.recordAccepted.handler(ctx, accepted);
  await expect(
    api.recordAccepted.handler(ctx, { ...accepted, runId: "other" }),
  ).rejects.toThrow();
  expect((await api.getForBackend.handler(ctx, owner)).runId).toBe("run");
});
it("preserves terminal evidence when late route acceptance arrives after worker completion", async () => {
  const { ctx, tables, api } = await setup();
  await api.create.handler(ctx, creation);
  await api.markDispatching.handler(ctx, { ...owner, claimId: "claim" });
  const bound = { ...owner, claimId: "claim", runId: "run" };
  await api.recordTerminal.handler(ctx, { ...bound, terminalStatus: "FAILED" });
  tables.agent_run_claims[0].claim_id = "newer";
  await api.recordAccepted.handler(ctx, bound);
  await expect(
    api.recordTerminal.handler(ctx, { ...bound, terminalStatus: "COMPLETED" }),
  ).rejects.toThrow();
  const receipt = await api.getForBackend.handler(ctx, owner);
  expect(receipt).toMatchObject({
    state: "terminal",
    terminalStatus: "FAILED",
    runId: "run",
  });
  expect((await api.create.handler(ctx, creation)).created).toBe(false);
});
it("does not accept an undispatched request or alter a foreign claim binding", async () => {
  const { ctx, api } = await setup();
  await api.create.handler(ctx, creation);
  await expect(
    api.recordAccepted.handler(ctx, {
      ...owner,
      claimId: "claim",
      runId: "run",
    }),
  ).rejects.toThrow();
  await expect(
    api.markDispatching.handler(ctx, { ...owner, claimId: "other" }),
  ).rejects.toThrow();
});

it("grants dispatch transition once, including after the startup lease expires", async () => {
  const { ctx, api } = await setup();
  await api.create.handler(ctx, creation);
  const bound = { ...owner, claimId: "claim" };
  expect((await api.markDispatching.handler(ctx, bound)).transitioned).toBe(
    true,
  );
  jest.setSystemTime(NOW + 100000);
  expect((await api.markDispatching.handler(ctx, bound)).transitioned).toBe(
    false,
  );
});

it("supports claim-owned temporary chats and returns null for an unknown owner-scoped receipt", async () => {
  const { ctx, tables, api } = await setup();
  tables.chats = [];
  expect(await api.getForBackend.handler(ctx, owner)).toBeNull();
  await api.create.handler(ctx, creation);
  expect((await api.getForBackend.handler(ctx, owner)).claimId).toBe("claim");
});

it.each(["prompt content", "A".repeat(64), "a".repeat(63)])(
  "rejects invalid digest %s",
  async (payloadHash) => {
    const { ctx, tables, api } = await setup();
    await expect(
      api.create.handler(ctx, { ...creation, payloadHash }),
    ).rejects.toThrow();
    expect(tables.agent_dispatch_requests).toHaveLength(0);
  },
);

it("fails closed for ambiguous receipts", async () => {
  const { ctx, tables, api } = await setup();
  await api.create.handler(ctx, creation);
  tables.agent_dispatch_requests.push({
    ...tables.agent_dispatch_requests[0],
    _id: "duplicate",
  });
  await expect(api.getForBackend.handler(ctx, owner)).rejects.toThrow();
});
