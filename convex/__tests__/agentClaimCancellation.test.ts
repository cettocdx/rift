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
const row = (patch: Record<string, unknown> = {}) => ({
  _id: "ledger",
  user_id: "owner",
  balance_points: 1000,
  monthly_granted_points: 500_000,
  monthly_granted_used_points: 0,
  monthly_granted_reset_date: "2026-09",
  monthly_reset_date: "2026-09",
  monthly_spent_points: 0,
  monthly_granted_resets_at: "2026-10-03T00:00:00Z",
  updated_at: 0,
  ...patch,
});
type Row = Record<string, any>;
function fixture(initial: Row | null) {
  const tables: Record<string, Row[]> = {
    extra_usage: initial ? [{ ...initial }] : [],
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
    agent_checkpoints: [],
    subscriptions: [
      {
        _id: "sub",
        user_id: "owner",
        tier: "pro",
        status: "active",
        updated_at: NOW,
        ls_subscription_id: "sub-real-fixture",
      },
    ],
    user_suspensions: [],
    temp_streams: [],
    user_customization: [],
    processed_credit_refunds: [],
    account_credit_reservations: [],
    processed_checkout_sessions: [],
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
        const read = async () =>
          tables[table]?.find((r) =>
            Object.entries(matches).every(([key, value]) => r[key] === value),
          ) ?? null;
        return {
          first: read,
          take: async (n: number) =>
            (
              tables[table]?.filter((r) =>
                Object.entries(matches).every(
                  ([key, value]) => r[key] === value,
                ),
              ) ?? []
            ).slice(0, n),
          order() {
            return this;
          },
          collect: async () =>
            tables[table]?.filter((r) =>
              Object.entries(matches).every(([key, value]) => r[key] === value),
            ) ?? [],
          unique: async () => {
            const found =
              tables[table]?.filter((r) =>
                Object.entries(matches).every(
                  ([key, value]) => r[key] === value,
                ),
              ) ?? [];
            if (found.length > 1) throw new Error("Duplicate indexed rows");
            return found[0] ?? null;
          },
        };
      },
    })),
    delete: jest.fn(async (id: string) => {
      for (const rows of Object.values(tables)) {
        const i = rows.findIndex((r) => r._id === id);
        if (i >= 0) rows.splice(i, 1);
      }
    }),
    patch: jest.fn(async (id: string, patch: Row) => {
      const found = Object.values(tables)
        .flat()
        .find((r) => r._id === id);
      if (!found) throw new Error("missing row");
      Object.assign(found, patch);
    }),
    insert: jest.fn(async (table: string, value: Row) => {
      const next = { _id: `${table}-${tables[table]?.length ?? 0}`, ...value };
      (tables[table] ??= []).push(next);
      return next._id;
    }),
  };
  return {
    ctx: {
      db,
      auth: { getUserIdentity: async () => ({ subject: "owner|session" }) },
      scheduler: { runAfter: jest.fn() },
    },
    tables,
  };
}

const owner = { serviceKey: SERVICE, userId: "owner", chatId: "chat" };
const run = { ...owner, claimId: "claim-a", runId: "run-a" };
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
async function started(temporary = false) {
  const f = fixture(row());
  if (temporary) f.tables.chats = [];
  const claims: any = await import("../agentRunClaims");
  const streams: any = await import("../chatStreams");
  const temp: any = await import("../tempStreams");
  const checkpoints: any = await import("../agentCheckpoints");
  await claims.reserve.handler(f.ctx, { ...owner, claimId: "claim-a" });
  await claims.activateForWorker.handler(f.ctx, {
    ...run,
    requireChat: !temporary,
  });
  return { ...f, claims, streams, temp, checkpoints };
}
it.each([false, true])(
  "sticky Stop prevents active re-entry and execution after cleanup (temporary=%s)",
  async (temporary) => {
    const f = await started(temporary);
    expect(await f.claims.requestCancellation.handler(f.ctx, run)).toBe(true);
    expect(f.tables.agent_run_claims[0]).toMatchObject({
      phase: "active",
      cancel_requested_at: NOW,
    });
    if (!temporary)
      await f.streams.prepareForNewStream.handler(f.ctx, {
        serviceKey: SERVICE,
        chatId: "chat",
        expectedTriggerRunId: "run-a",
      });
    expect(
      await f.claims.activateForWorker.handler(f.ctx, {
        ...run,
        requireChat: !temporary,
      }),
    ).toEqual({ activated: false });
    expect(
      await f.claims.isExecutionCurrent.handler(f.ctx, {
        ...run,
        requireChat: !temporary,
      }),
    ).toBe(false);
  },
);
it("old Stop cannot stamp a replacement claim or a different run", async () => {
  const f = await started();
  expect(
    await f.claims.requestCancellation.handler(f.ctx, {
      ...run,
      runId: "wrong",
    }),
  ).toBe(false);
  await f.claims.release.handler(f.ctx, run);
  await f.claims.reserve.handler(f.ctx, { ...owner, claimId: "claim-b" });
  expect(await f.claims.requestCancellation.handler(f.ctx, run)).toBe(false);
  expect(f.tables.agent_run_claims[0].cancel_requested_at).toBeUndefined();
});
it("marker is idempotent, survives release, and only a new claim clears it", async () => {
  const f = await started();
  await f.claims.requestCancellation.handler(f.ctx, run);
  jest.setSystemTime(NOW + 50);
  await f.claims.requestCancellation.handler(f.ctx, run);
  expect(f.tables.agent_run_claims[0].cancel_requested_at).toBe(NOW);
  await f.claims.release.handler(f.ctx, run);
  expect(f.tables.agent_run_claims[0].cancel_requested_at).toBe(NOW);
  await f.claims.reserve.handler(f.ctx, { ...owner, claimId: "claim-b" });
  expect(f.tables.agent_run_claims[0].cancel_requested_at).toBeUndefined();
});
it("a marked starting generation cannot activate or re-admit the same reservation", async () => {
  const f = await started();
  await f.claims.release.handler(f.ctx, run);
  await f.claims.reserve.handler(f.ctx, { ...owner, claimId: "claim-b" });
  expect(
    await f.claims.requestCancellation.handler(f.ctx, {
      ...owner,
      claimId: "claim-b",
    }),
  ).toBe(true);
  expect(
    await f.claims.reserve.handler(f.ctx, { ...owner, claimId: "claim-b" }),
  ).toMatchObject({ acquired: false });
  expect(
    await f.claims.activateForWorker.handler(f.ctx, {
      ...owner,
      claimId: "claim-b",
      runId: "run-b",
      requireChat: true,
    }),
  ).toEqual({ activated: false });
});
it("direct authenticated chat Stop stamps only the current mapped claim", async () => {
  const f = await started();
  await f.streams.cancelStreamFromClient.handler(f.ctx, { chatId: "chat" });
  expect(f.tables.agent_run_claims[0].cancel_requested_at).toBe(NOW);
  await f.streams.prepareForNewStream.handler(f.ctx, {
    serviceKey: SERVICE,
    chatId: "chat",
    expectedTriggerRunId: "run-a",
  });
  expect(f.tables.agent_run_claims[0].cancel_requested_at).toBe(NOW);
});
it("direct chat cancellation refuses foreign ownership and ignores mismapped active claim", async () => {
  const f = await started();
  await expect(
    f.streams.cancelStreamFromClient.handler(
      {
        ...f.ctx,
        auth: { getUserIdentity: async () => ({ subject: "foreign|session" }) },
      },
      { chatId: "chat" },
    ),
  ).rejects.toThrow();
  f.tables.chats[0].active_trigger_run_id = "new-run";
  await f.streams.cancelStreamFromClient.handler(f.ctx, { chatId: "chat" });
  expect(f.tables.agent_run_claims[0].cancel_requested_at).toBeUndefined();
});
it("temporary cancellation verifies coordination owner and stamps a claimed run without a chat", async () => {
  const f = await started(true);
  f.tables.temp_streams.push({
    _id: "temp",
    chat_id: "chat",
    user_id: "owner",
  });
  await f.temp.cancelTempStreamFromClient.handler(f.ctx, { chatId: "chat" });
  expect(f.tables.temp_streams).toHaveLength(0);
  expect(f.tables.agent_run_claims[0].cancel_requested_at).toBe(NOW);
});
it("foreign temporary coordination cannot mark an owned claim", async () => {
  const f = await started(true);
  f.tables.temp_streams.push({
    _id: "temp",
    chat_id: "chat",
    user_id: "foreign",
  });
  await expect(
    f.temp.cancelTempStreamFromClient.handler(f.ctx, { chatId: "chat" }),
  ).rejects.toThrow();
  expect(f.tables.agent_run_claims[0].cancel_requested_at).toBeUndefined();
});
it("marker blocks checkpoint begin and execution even after chat flags clear", async () => {
  const f = await started();
  const begin = {
    ...run,
    requestMessageId: "request",
    requestHash: "a".repeat(64),
    model: "model",
    executionTracking: 1,
  };
  expect(await f.checkpoints.beginRun.handler(f.ctx, begin)).toMatchObject({
    status: "fresh",
  });
  expect(
    await f.checkpoints.markStep.handler(f.ctx, { ...run, stepIndex: 1 }),
  ).toBe(true);
  await f.claims.requestCancellation.handler(f.ctx, run);
  expect(
    await f.checkpoints.markExecution.handler(f.ctx, { ...run, stepIndex: 1 }),
  ).toBe(false);
  expect(await f.checkpoints.beginRun.handler(f.ctx, begin)).toMatchObject({
    status: "blocked",
    reason: "canceled",
  });
});
it("uncanceled current temporary and persistent runs remain executable beyond the startup lease", async () => {
  for (const temporary of [false, true]) {
    const f = await started(temporary);
    jest.setSystemTime(NOW + 900000);
    expect(
      await f.claims.isExecutionCurrent.handler(f.ctx, {
        ...run,
        requireChat: !temporary,
      }),
    ).toBe(true);
  }
});
it("execution and cancellation reject duplicate or foreign owner claims without mutation", async () => {
  for (const kind of ["duplicate", "foreign"]) {
    const f = await started();
    if (kind === "duplicate")
      f.tables.agent_run_claims.push({
        ...f.tables.agent_run_claims[0],
        _id: "duplicate",
      });
    else f.tables.agent_run_claims[0].user_id = "foreign";
    await expect(
      f.claims.requestCancellation.handler(f.ctx, run),
    ).rejects.toThrow();
    await expect(
      f.claims.isExecutionCurrent.handler(f.ctx, { ...run, requireChat: true }),
    ).rejects.toThrow();
    expect(f.tables.agent_run_claims[0].cancel_requested_at).toBeUndefined();
  }
});
it("persistent deleted chat cannot execute, while mismapped chat cannot authorize a claimed run", async () => {
  const f = await started();
  f.tables.chats = [];
  expect(
    await f.claims.isExecutionCurrent.handler(f.ctx, {
      ...run,
      requireChat: true,
    }),
  ).toBe(false);
  f.tables.chats.push({
    _id: "replacement",
    id: "chat",
    user_id: "owner",
    active_trigger_run_id: "different",
  });
  expect(
    await f.claims.isExecutionCurrent.handler(f.ctx, {
      ...run,
      requireChat: false,
    }),
  ).toBe(false);
});
it("temporary Stop before coordination row creation still stamps the authenticated claim", async () => {
  const f = await started(true);
  await f.temp.cancelTempStreamFromClient.handler(f.ctx, { chatId: "chat" });
  expect(f.tables.agent_run_claims[0].cancel_requested_at).toBe(NOW);
});
it("stamped startup cannot persist another initial turn", async () => {
  const f = await started();
  await f.claims.release.handler(f.ctx, run);
  await f.claims.reserve.handler(f.ctx, { ...owner, claimId: "next" });
  await f.claims.requestCancellation.handler(f.ctx, {
    ...owner,
    claimId: "next",
  });
  await expect(
    f.claims.persistInitialTurn.handler(f.ctx, {
      ...owner,
      claimId: "next",
      allowCreate: false,
      title: "must not change",
    }),
  ).rejects.toThrow();
  expect(f.tables.chats[0].title).toBe("test");
});
it.each([false, true])(
  "checkpoint cancellation preserves explicit partial-output policy (skipSave=%s)",
  async (skipSave) => {
    const f = await started();
    const begin = {
      ...run,
      requestMessageId: "request",
      requestHash: "a".repeat(64),
      model: "model",
      executionTracking: 1,
    };
    await f.checkpoints.beginRun.handler(f.ctx, begin);
    const saved = {
      version: 1,
      stepIndex: 1,
      finishReason: "stop",
      messagesJson: "[]",
    };
    f.tables.agent_checkpoints[0].checkpoint = saved;
    await f.streams.cancelStreamFromClient.handler(f.ctx, {
      chatId: "chat",
      skipSave,
    });
    await f.streams.prepareForNewStream.handler(f.ctx, {
      serviceKey: SERVICE,
      chatId: "chat",
      expectedTriggerRunId: "run-a",
    });
    expect(await f.checkpoints.finishRun.handler(f.ctx, run)).toBe(true);
    expect(f.tables.agent_checkpoints[0].checkpoint).toEqual(
      skipSave ? undefined : saved,
    );
    expect(f.tables.agent_checkpoints[0].blocked_reason).toBe("canceled");
    expect(f.tables.agent_run_claims[0].phase).toBe("active");
  },
);
it("persistent client Stop can fence its owned claim even when chat persistence has not happened", async () => {
  const f = await started();
  f.tables.chats = [];
  await f.streams.cancelStreamFromClient.handler(f.ctx, { chatId: "chat" });
  expect(f.tables.agent_run_claims[0].cancel_requested_at).toBe(NOW);
});

it("independent: canceled active ownership cannot expire into a new grant without terminal takeover", async () => {
  const f = await started();
  await f.claims.requestCancellation.handler(f.ctx, run);
  jest.setSystemTime(NOW + 86400000);
  expect(
    await f.claims.reserve.handler(f.ctx, {
      ...owner,
      claimId: "next",
      expectedChatRunId: "run-a",
    }),
  ).toMatchObject({ acquired: false, claimId: "claim-a", phase: "active" });
  expect(
    await f.claims.reserve.handler(f.ctx, {
      ...owner,
      claimId: "claim-a",
      expectedChatRunId: "run-a",
    }),
  ).toMatchObject({ acquired: false });
  expect(f.tables.agent_run_claims[0].cancel_requested_at).toBe(NOW);
});
it("independent: late old Stop and release cannot alter fully activated replacement mapping", async () => {
  const f = await started();
  await f.claims.requestCancellation.handler(f.ctx, run);
  await f.claims.release.handler(f.ctx, run);
  await f.claims.reserve.handler(f.ctx, { ...owner, claimId: "claim-b" });
  const replacement = { ...owner, claimId: "claim-b", runId: "run-b" };
  await f.claims.activateForWorker.handler(f.ctx, {
    ...replacement,
    requireChat: true,
  });
  const before = JSON.stringify(f.tables);
  expect(await f.claims.requestCancellation.handler(f.ctx, run)).toBe(false);
  expect(await f.claims.release.handler(f.ctx, run)).toBe(false);
  expect(JSON.stringify(f.tables)).toBe(before);
  expect(
    await f.claims.isExecutionCurrent.handler(f.ctx, {
      ...replacement,
      requireChat: true,
    }),
  ).toBe(true);
});
it("independent: temporary Stop cannot delete coordination or stamp claim when persisted owner disagrees", async () => {
  const f = await started(true);
  f.tables.chats.push({ _id: "foreign", id: "chat", user_id: "foreign" });
  f.tables.temp_streams.push({
    _id: "temp",
    chat_id: "chat",
    user_id: "owner",
  });
  const before = JSON.stringify(f.tables);
  await expect(
    f.temp.cancelTempStreamFromClient.handler(f.ctx, { chatId: "chat" }),
  ).rejects.toThrow();
  expect(JSON.stringify(f.tables)).toBe(before);
  expect(f.ctx.scheduler.runAfter).not.toHaveBeenCalled();
});
it("independent: a zero timestamp cancellation remains sticky and visible in owned snapshots", async () => {
  const f = await started();
  jest.setSystemTime(0);
  await f.claims.requestCancellation.handler(f.ctx, run);
  expect(await f.claims.getForBackend.handler(f.ctx, owner)).toMatchObject({
    cancelRequestedAt: 0,
  });
  expect(
    await f.claims.isExecutionCurrent.handler(f.ctx, {
      ...run,
      requireChat: true,
    }),
  ).toBe(false);
  expect(
    await f.claims.activateForWorker.handler(f.ctx, {
      ...run,
      requireChat: true,
    }),
  ).toEqual({ activated: false });
});
