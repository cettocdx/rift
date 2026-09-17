import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

jest.mock("../_generated/server", () => ({
  mutation: jest.fn((config: any) => config),
  query: jest.fn((config: any) => config),
}));
jest.mock("convex/values", () => ({
  v: new Proxy({}, { get: () => jest.fn(() => "v") }),
  ConvexError: class ConvexError extends Error {
    data: any;
    constructor(data: any) {
      super(data.message);
      this.data = data;
    }
  },
}));
jest.mock("../lib/utils", () => ({ validateServiceKey: jest.fn() }));

const { activate, getForBackend, release, reserve, requestCancellation } =
  jest.requireActual<typeof import("../agentRunClaims")>("../agentRunClaims");
const { validateServiceKey } = jest.requireMock("../lib/utils") as {
  validateServiceKey: jest.Mock;
};

const NOW = 1_000_000;
const base = { serviceKey: "test-key", userId: "owner", chatId: "chat-1" };
it("starts both bounded ownership reads before waiting for either", async () => {
  const started: string[] = [];
  let finishChat!: (value: unknown[]) => void;
  const chatRead = new Promise<unknown[]>((resolve) => {
    finishChat = resolve;
  });
  const ctx = {
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          take: (limit: number) => {
            expect(limit).toBe(2);
            started.push(table);
            return table === "chats" ? chatRead : Promise.resolve([]);
          },
        }),
      }),
    },
  };
  const pending = (getForBackend as any).handler(ctx, base);
  const beforeResolution = [...started];
  finishChat([]);
  await expect(pending).resolves.toBeNull();
  expect(beforeResolution).toEqual(["chats", "agent_run_claims"]);
});
const claim = (patch: Record<string, unknown> = {}) => ({
  _id: "claim-row",
  user_id: "owner",
  chat_id: "chat-1",
  claim_id: "claim-a",
  phase: "starting",
  started_at: NOW,
  lease_until: NOW + 90_000,
  ...patch,
});
const chat = (patch: Record<string, unknown> = {}) => ({
  _id: "chat-row",
  id: "chat-1",
  user_id: "owner",
  ...patch,
});

function makeCtx(
  seed: { claims?: any[]; chats?: any[]; gates?: any[]; intents?: any[] } = {},
) {
  const tables: Record<string, any[]> = {
    agent_run_claims: seed.claims ?? [],
    agent_run_resources: [],
    chats: seed.chats ?? [],
    agent_dispatch_admissions: seed.gates ?? [],
    agent_dispatch_intents: seed.intents ?? [],
    agent_dispatch_requests: [],
    hack_http_execution_heads: [],
    hack_http_executions: [],
  };
  const ctx: any = {
    db: {
      query: jest.fn((table: string) => ({
        withIndex: (_name: string, predicate: any) => {
          const filters: Record<string, unknown> = {};
          const q: any = {
            eq: (key: string, value: unknown) => {
              filters[key] = value;
              return q;
            },
          };
          predicate(q);
          const rows = tables[table].filter((row) =>
            Object.entries(filters).every(([key, value]) => row[key] === value),
          );
          return {
            first: async () => rows[0] ?? null,
            take: async (n: number) => rows.slice(0, n),
            paginate: async (opts: { numItems: number }) => ({
              page: rows.slice(0, opts.numItems),
              isDone: rows.length <= opts.numItems,
              continueCursor: "fixture-cursor",
            }),
          };
        },
      })),
      insert: jest.fn(async (table: string, value: any) => {
        const _id = `${table}-${tables[table].length + 1}`;
        tables[table].push({ _id, ...value });
        return _id;
      }),
      patch: jest.fn(async (id: string, value: any) => {
        const row = Object.values(tables)
          .flat()
          .find((candidate) => candidate._id === id);
        if (!row) throw new Error("Missing fixture");
        Object.assign(row, value);
      }),
    },
  };
  return { ctx, tables };
}

const reserveRun = (ctx: any, patch: Record<string, unknown> = {}) =>
  (reserve as any).handler(ctx, { ...base, claimId: "claim-b", ...patch });
const activateRun = (ctx: any, patch: Record<string, unknown> = {}) =>
  (activate as any).handler(ctx, {
    ...base,
    claimId: "claim-a",
    runId: "run-a",
    ...patch,
  });
const releaseRun = (ctx: any, patch: Record<string, unknown> = {}) =>
  (release as any).handler(ctx, { ...base, claimId: "claim-a", ...patch });

describe("atomic per-chat agent run claims", () => {
  it("keeps a terminal worker fenced until exact remote cleanup acknowledgment", async () => {
    const { requireRemoteCleanup, confirmRemoteCleanup } =
      jest.requireActual<any>("../agentRunClaims");
    const { ctx, tables } = makeCtx({
      claims: [claim({ phase: "active", run_id: "run-a" })],
      chats: [chat({ active_trigger_run_id: "run-a" })],
    });
    const binding = { ...base, claimId: "claim-a", runId: "run-a" };
    expect(await requireRemoteCleanup.handler(ctx, binding)).toBe(true);
    expect(await releaseRun(ctx, { runId: "run-a" })).toBe(false);
    expect(
      (
        await reserveRun(ctx, {
          expectedClaimId: "claim-a",
          expectedRunId: "run-a",
          expectedChatRunId: "run-a",
        })
      ).acquired,
    ).toBe(false);
    expect(
      await confirmRemoteCleanup.handler(ctx, { ...binding, runId: "other" }),
    ).toBe(false);
    expect(await confirmRemoteCleanup.handler(ctx, binding)).toBe(true);
    expect(await confirmRemoteCleanup.handler(ctx, binding)).toBe(true);
    expect(await releaseRun(ctx, { runId: "run-a" })).toBe(true);
    expect(
      (await reserveRun(ctx, { expectedChatRunId: undefined })).acquired,
    ).toBe(true);
    expect(tables.agent_run_claims[0].remote_cleanup_required).toBeUndefined();
  });

  it("cannot arm cleanup or acknowledge a replaced claim", async () => {
    const { requireRemoteCleanup, confirmRemoteCleanup } =
      jest.requireActual<any>("../agentRunClaims");
    const { ctx } = makeCtx({
      claims: [
        claim({ phase: "active", run_id: "run-new", claim_id: "claim-new" }),
      ],
    });
    const stale = { ...base, claimId: "claim-a", runId: "run-a" };
    expect(await requireRemoteCleanup.handler(ctx, stale)).toBe(false);
    expect(await confirmRemoteCleanup.handler(ctx, stale)).toBe(false);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => jest.restoreAllMocks());

  it("persists the target before any assistant output and keeps failure after release", async () => {
    const { ctx, tables } = makeCtx({
      claims: [claim()],
      chats: [chat({ sandbox_type: "e2b" })],
    });
    expect(await activateRun(ctx, { sandboxPreference: "mac-runner" })).toBe(
      true,
    );
    expect(tables.chats[0].sandbox_type).toBe("mac-runner");
    expect(
      await releaseRun(ctx, {
        runId: "run-a",
        failureMessage: "Computer unavailable",
      }),
    ).toBe(true);
    expect(tables.chats[0].last_run_error).toBe("Computer unavailable");
    expect(tables.chats[0].active_trigger_run_id).toBeUndefined();
    // A duplicate cleanup must not erase the saved failure.
    await releaseRun(ctx, { runId: "run-a" });
    expect(tables.chats[0].last_run_error).toBe("Computer unavailable");
  });

  it("clears old failure on a new run, but never on a stale worker", async () => {
    const { ctx, tables } = makeCtx({
      claims: [claim()],
      chats: [chat({ last_run_error: "Old failure" })],
    });
    await activateRun(ctx, { claimId: "stale", sandboxPreference: "old-mac" });
    expect(tables.chats[0].last_run_error).toBe("Old failure");
    await activateRun(ctx, { sandboxPreference: "e2b" });
    expect(tables.chats[0].last_run_error).toBeUndefined();
    expect(tables.chats[0].sandbox_type).toBe("e2b");
    await releaseRun(ctx, {
      claimId: "stale",
      runId: "run-a",
      failureMessage: "Late failure",
    });
    expect(tables.chats[0].last_run_error).toBeUndefined();
  });

  it("does not report failure for a user-canceled run", async () => {
    const { ctx, tables } = makeCtx({
      claims: [claim()],
      chats: [chat({ canceled_at: NOW + 1, cancel_skip_save: true })],
    });
    await activateRun(ctx);
    await releaseRun(ctx, { runId: "run-a", failureMessage: "Aborted" });
    expect(tables.chats[0].last_run_error).toBeUndefined();
  });

  it("reserves a new or temporary chat without creating a chat/message row", async () => {
    const { ctx, tables } = makeCtx();
    expect(await reserveRun(ctx)).toMatchObject({
      acquired: true,
      claimId: "claim-b",
      phase: "starting",
      leaseUntil: NOW + 90_000,
    });
    expect(tables.chats).toHaveLength(0);
    expect(tables.agent_run_claims).toHaveLength(1);
    expect(validateServiceKey).toHaveBeenCalledWith("test-key");
  });

  it("returns no claim for an unreserved owned chat", async () => {
    const { ctx } = makeCtx({ chats: [chat()] });
    expect(await (getForBackend as any).handler(ctx, base)).toBeNull();
  });

  it("returns the owned public claim shape without internal bookkeeping fields", async () => {
    const { ctx } = makeCtx({
      claims: [claim({ expected_chat_run_id: "old-run" })],
    });
    expect(await (getForBackend as any).handler(ctx, base)).toEqual({
      userId: "owner",
      chatId: "chat-1",
      claimId: "claim-a",
      phase: "starting",
      startedAt: NOW,
      leaseUntil: NOW + 90_000,
    });
  });

  it("rejects an invalid service key before reading any rows", async () => {
    const { ctx } = makeCtx();
    validateServiceKey.mockImplementationOnce(() => {
      throw new Error("Unauthorized");
    });
    await expect(reserveRun(ctx)).rejects.toThrow("Unauthorized");
    expect(ctx.db.query).not.toHaveBeenCalled();
  });

  it("fails closed on ambiguous legacy claim records", async () => {
    const { ctx } = makeCtx({ claims: [claim(), claim({ _id: "duplicate" })] });
    await expect(reserveRun(ctx)).rejects.toMatchObject({
      data: { code: "CLAIM_CONFLICT" },
    });
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("blocks a second reservation during startup without changing its lease", async () => {
    const { ctx, tables } = makeCtx({ claims: [claim()] });
    expect(await reserveRun(ctx)).toMatchObject({
      acquired: false,
      claimId: "claim-a",
      phase: "starting",
    });
    expect(tables.agent_run_claims[0].lease_until).toBe(NOW + 90_000);
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("replays the same live startup claim idempotently without renewing its lease", async () => {
    const { ctx } = makeCtx({ claims: [claim()] });
    expect(await reserveRun(ctx, { claimId: "claim-a" })).toMatchObject({
      acquired: true,
      leaseUntil: NOW + 90_000,
    });
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it.each([getForBackend, reserve, activate, release])(
    "rejects a foreign durable chat before exposing any claim",
    async (operation) => {
      const { ctx } = makeCtx({
        chats: [chat({ user_id: "other" })],
        claims: [claim()],
      });
      await expect(
        (operation as any).handler(ctx, {
          ...base,
          claimId: "claim-b",
          runId: "run-a",
        }),
      ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
      expect(ctx.db.patch).not.toHaveBeenCalled();
    },
  );

  it("rejects a foreign claim even when no durable chat exists", async () => {
    const { ctx } = makeCtx({ claims: [claim({ user_id: "other" })] });
    await expect(reserveRun(ctx)).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
    });
  });

  it("reclaims only an expired startup with no attached run", async () => {
    const { ctx, tables } = makeCtx({ claims: [claim({ lease_until: NOW })] });
    expect(await reserveRun(ctx)).toMatchObject({
      acquired: true,
      claimId: "claim-b",
    });
    expect(tables.agent_run_claims).toHaveLength(1);
    expect(await activateRun(ctx)).toBe(false);
  });

  it("cannot renew an expired or released claim by reusing its fencing token", async () => {
    for (const old of [
      claim({ lease_until: NOW }),
      claim({ phase: "released" }),
    ]) {
      const { ctx } = makeCtx({ claims: [old] });
      expect(await reserveRun(ctx, { claimId: "claim-a" })).toMatchObject({
        acquired: false,
      });
      expect(ctx.db.patch).not.toHaveBeenCalled();
    }
  });

  it.each(["starting", "active"])(
    "never expires a %s claim with a run id",
    async (phase) => {
      const { ctx } = makeCtx({
        claims: [claim({ phase, run_id: "run-a", lease_until: NOW - 1 })],
      });
      expect(await reserveRun(ctx)).toMatchObject({
        acquired: false,
        runId: "run-a",
      });
    },
  );

  it("allows an explicit active takeover only when both claim and run match", async () => {
    const { ctx } = makeCtx({
      claims: [claim({ phase: "active", run_id: "run-a" })],
      chats: [chat({ active_trigger_run_id: "run-a" })],
    });
    const expected = {
      expectedClaimId: "claim-a",
      expectedRunId: "run-a",
      expectedChatRunId: "run-a",
    };
    expect(
      await reserveRun(ctx, { ...expected, expectedRunId: "wrong" }),
    ).toMatchObject({ acquired: false });
    expect(
      await reserveRun(ctx, { ...expected, expectedClaimId: "wrong" }),
    ).toMatchObject({ acquired: false });
    expect(await reserveRun(ctx, expected)).toMatchObject({
      acquired: true,
      claimId: "claim-b",
      phase: "starting",
    });
  });

  it("fails the legacy chat mapping CAS even if the claim is free", async () => {
    const { ctx } = makeCtx({
      chats: [chat({ active_trigger_run_id: "newer-run" })],
    });
    expect(
      await reserveRun(ctx, { expectedChatRunId: "old-run" }),
    ).toMatchObject({ acquired: false });
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("activates an unexpired claim and updates its chat atomically", async () => {
    const { ctx, tables } = makeCtx({ claims: [claim()], chats: [chat()] });
    expect(await activateRun(ctx)).toBe(true);
    expect(tables.agent_run_claims[0]).toMatchObject({
      phase: "active",
      run_id: "run-a",
    });
    expect(tables.chats[0].active_trigger_run_id).toBe("run-a");
    expect(await activateRun(ctx)).toBe(true);
    expect(await activateRun(ctx, { runId: "different" })).toBe(false);
  });

  it("admits a late queued worker if its claim still owns the slot, blocking a competing reclaim", async () => {
    const { ctx, tables } = makeCtx({
      claims: [claim({ lease_until: NOW - 1 })],
      chats: [chat()],
    });
    expect(await activateRun(ctx)).toBe(true);
    expect(tables.agent_run_claims[0]).toMatchObject({
      phase: "active",
      run_id: "run-a",
    });
    expect(await reserveRun(ctx, { expectedChatRunId: "run-a" })).toMatchObject(
      { acquired: false, runId: "run-a" },
    );
  });

  it("never revives a completed claim on a late route acknowledgement", async () => {
    const { ctx, tables } = makeCtx({
      claims: [claim({ phase: "released", run_id: "run-a" })],
      chats: [chat()],
    });
    expect(await activateRun(ctx)).toBe(false);
    expect(tables.chats[0].active_trigger_run_id).toBeUndefined();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("does not let activation overwrite an unrelated legacy mapping", async () => {
    const { ctx } = makeCtx({
      claims: [claim({ expected_chat_run_id: "old-run" })],
      chats: [chat({ active_trigger_run_id: "other-run" })],
    });
    expect(await activateRun(ctx)).toBe(false);
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("allows activation after the previous mapping is cleared", async () => {
    const { ctx } = makeCtx({
      claims: [claim({ expected_chat_run_id: "old-run" })],
      chats: [chat()],
    });
    expect(await activateRun(ctx)).toBe(true);
  });

  it("clears only cancellation belonging to the previous task on activation", async () => {
    const { ctx, tables } = makeCtx({
      claims: [claim()],
      chats: [chat({ canceled_at: NOW - 1, cancel_skip_save: true })],
    });
    expect(await activateRun(ctx)).toBe(true);
    expect(tables.chats[0].canceled_at).toBeUndefined();
    expect(tables.chats[0].cancel_skip_save).toBeUndefined();
  });
  it.each([NOW, NOW + 1])(
    "preserves a stop during startup at %s",
    async (canceledAt) => {
      const { ctx, tables } = makeCtx({
        claims: [claim()],
        chats: [chat({ canceled_at: canceledAt, cancel_skip_save: true })],
      });
      expect(await activateRun(ctx)).toBe(true);
      expect(tables.chats[0].canceled_at).toBe(canceledAt);
      expect(tables.chats[0].cancel_skip_save).toBe(true);
    },
  );

  it("releases a pre-dispatch claim only while it is still unbound", async () => {
    const { ctx, tables } = makeCtx({ claims: [claim()] });
    expect(await releaseRun(ctx)).toBe(true);
    expect(tables.agent_run_claims[0].phase).toBe("released");
    expect(await reserveRun(ctx)).toMatchObject({ acquired: true });
    expect(await releaseRun(ctx)).toBe(false);
  });

  it("requires the active run id when releasing and preserves a newer chat mapping", async () => {
    const { ctx, tables } = makeCtx({
      claims: [claim({ phase: "active", run_id: "run-a" })],
      chats: [chat({ active_trigger_run_id: "newer-run" })],
    });
    expect(await releaseRun(ctx)).toBe(false);
    expect(await releaseRun(ctx, { runId: "wrong" })).toBe(false);
    expect(await releaseRun(ctx, { runId: "run-a" })).toBe(true);
    expect(tables.chats[0].active_trigger_run_id).toBe("newer-run");
  });

  it("atomically fences worker cleanup with activation", async () => {
    const { activateForWorker, confirmRemoteCleanup } =
      jest.requireActual<any>("../agentRunClaims");
    const { ctx, tables } = makeCtx({ claims: [claim()], chats: [chat()] });
    const binding = { ...base, claimId: "claim-a", runId: "run-a" };
    const result = await activateForWorker.handler(ctx, {
      ...binding,
      requireChat: true,
      requireRemoteCleanup: true,
    });
    expect(result).toMatchObject({
      activated: true,
      remoteCleanupRequired: true,
    });
    expect(tables.agent_run_claims[0].remote_cleanup_required).toBe(true);
    expect(await release.handler(ctx, binding)).toBe(false);
    expect(await confirmRemoteCleanup.handler(ctx, binding)).toBe(true);
    expect(await release.handler(ctx, binding)).toBe(true);
  });

  it("does not reopen cleanup after a worker already confirmed it", async () => {
    const { activateForWorker } = jest.requireActual<any>("../agentRunClaims");
    const { ctx } = makeCtx({
      claims: [
        claim({
          phase: "active",
          run_id: "run-a",
          remote_cleanup_confirmed: true,
        }),
      ],
      chats: [chat()],
    });
    expect(
      await activateForWorker.handler(ctx, {
        ...base,
        claimId: "claim-a",
        runId: "run-a",
        requireChat: true,
        requireRemoteCleanup: true,
      }),
    ).toEqual({ activated: false });
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("clears only its own active chat mapping on release", async () => {
    const { ctx, tables } = makeCtx({
      claims: [claim({ phase: "active", run_id: "run-a" })],
      chats: [chat({ active_trigger_run_id: "run-a" })],
    });
    expect(await releaseRun(ctx, { runId: "run-a" })).toBe(true);
    expect(tables.chats[0].active_trigger_run_id).toBeUndefined();
    expect(tables.agent_run_claims[0].phase).toBe("released");
  });
});

describe("worker claim chat snapshot", () => {
  const activateWorker = (ctx: any, extra: Record<string, unknown> = {}) =>
    (
      jest.requireActual<typeof import("../agentRunClaims")>(
        "../agentRunClaims",
      ) as any
    ).activateForWorker.handler(ctx, {
      ...base,
      claimId: "claim-a",
      runId: "run-a",
      requireChat: true,
      ...extra,
    });
  it("returns the owned snapshot after activation updates without another chat read", async () => {
    const { ctx, tables } = makeCtx({
      claims: [claim()],
      chats: [
        chat({
          title: "Current",
          purpose: "app",
          project_id: "project-1",
          latest_summary_id: "summary-1",
          todos: [],
          codex_thread_id: "legacy",
          canceled_at: NOW - 1,
          last_run_error: "old",
        }),
      ],
    });
    const result = await activateWorker(ctx, { sandboxPreference: "local" });
    expect(result.activated).toBe(true);
    expect(result.chat).toMatchObject({
      id: "chat-1",
      user_id: "owner",
      title: "Current",
      purpose: "app",
      project_id: "project-1",
      latest_summary_id: "summary-1",
      sandbox_type: "local",
      active_trigger_run_id: "run-a",
    });
    expect(result.chat.codex_thread_id).toBeUndefined();
    expect(result.chat.canceled_at).toBeUndefined();
    expect(result.chat.last_run_error).toBeUndefined();
    expect(tables.agent_run_claims[0].phase).toBe("active");
    expect(
      ctx.db.query.mock.calls.filter(([table]: [string]) => table === "chats"),
    ).toHaveLength(1);
  });
  it.each([
    { claim_id: "newer" },
    { phase: "released" },
    { phase: "active", run_id: "other" },
  ])("a stale claim returns no chat content (%j)", async (patch) => {
    const { ctx } = makeCtx({
      claims: [claim(patch)],
      chats: [chat({ title: "private" })],
    });
    expect(await activateWorker(ctx)).toEqual({ activated: false });
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
  it("wrong ownership and a changed run mapping cannot disclose a snapshot", async () => {
    const wrong = makeCtx({
      claims: [claim()],
      chats: [chat({ user_id: "other" })],
    });
    await expect(activateWorker(wrong.ctx)).rejects.toThrow("own this chat");
    const moved = makeCtx({
      claims: [claim()],
      chats: [chat({ active_trigger_run_id: "replacement" })],
    });
    expect(await activateWorker(moved.ctx)).toEqual({ activated: false });
  });
  it("deleted persisted chats fail without mutating the claim; temporary absence is explicit null", async () => {
    const { ctx, tables } = makeCtx({ claims: [claim()] });
    expect(await activateWorker(ctx)).toEqual({ activated: false });
    expect(tables.agent_run_claims[0].phase).toBe("starting");
    expect(await activateWorker(ctx, { requireChat: false })).toEqual({
      activated: true,
      chat: null,
    });
  });
  it("a current cancellation timestamp survives in the snapshot", async () => {
    const { ctx } = makeCtx({
      claims: [claim()],
      chats: [chat({ canceled_at: NOW + 1, cancel_skip_save: true })],
    });
    const result = await activateWorker(ctx);
    expect(result.chat.canceled_at).toBe(NOW + 1);
    expect(result.chat).not.toHaveProperty("cancel_skip_save");
  });
});

describe("owned admission snapshot", () => {
  const read = async (ctx: any, overrides = {}) => {
    const endpoint = (jest.requireActual("../agentRunClaims") as any)
      .getAdmissionSnapshot;
    expect(endpoint).toBeDefined();
    return endpoint.handler(ctx, { ...base, ...overrides });
  };
  beforeEach(() => jest.clearAllMocks());
  it("returns sanitized chat and claim from the same owned read", async () => {
    const { ctx } = makeCtx({
      chats: [chat({ codex_thread_id: "legacy", cancel_skip_save: true })],
      claims: [claim()],
    });
    const result = await read(ctx);
    expect(result.chat).toMatchObject({
      id: base.chatId,
      user_id: base.userId,
    });
    expect(result.chat).not.toHaveProperty("codex_thread_id");
    expect(result.chat).not.toHaveProperty("cancel_skip_save");
    expect(result.claim).toMatchObject({
      claimId: "claim-a",
      userId: "owner",
      chatId: "chat-1",
    });
    expect(result.claim).not.toHaveProperty("_id");
    expect(ctx.db.query.mock.calls.map((c: any[]) => c[0])).toEqual([
      "chats",
      "agent_run_claims",
    ]);
  });
  it.each(["chat", "claim"])("rejects foreign %s ownership", async (kind) => {
    const { ctx } = makeCtx({
      chats: [chat({ user_id: kind === "chat" ? "other" : "owner" })],
      claims: [claim({ user_id: kind === "claim" ? "other" : "owner" })],
    });
    await expect(read(ctx)).rejects.toThrow("You do not own this chat");
  });
  it.each(["chats", "claims"])("rejects duplicate %s", async (kind) => {
    const { ctx } = makeCtx({
      chats: kind === "chats" ? [chat(), chat()] : [],
      claims: kind === "claims" ? [claim(), claim()] : [],
    });
    await expect(read(ctx)).rejects.toThrow("Chat claim is ambiguous");
  });
  it.each(["claim", "mapping"])(
    "a competing %s after an empty snapshot still blocks reserve",
    async (kind) => {
      const { ctx, tables } = makeCtx();
      expect(await read(ctx)).toEqual({ chat: null, claim: null });
      if (kind === "claim")
        tables.agent_run_claims.push(
          claim({ phase: "active", run_id: "competitor" }),
        );
      else tables.chats.push(chat({ active_trigger_run_id: "competitor" }));
      expect(await reserveRun(ctx)).toMatchObject({ acquired: false });
      expect(ctx.db.insert).not.toHaveBeenCalled();
      expect(ctx.db.patch).not.toHaveBeenCalled();
    },
  );
  it("validates the service key before any read", async () => {
    validateServiceKey.mockImplementationOnce(() => {
      throw new Error("Invalid key");
    });
    const { ctx } = makeCtx();
    await expect(read(ctx)).rejects.toThrow("Invalid key");
    expect(ctx.db.query).not.toHaveBeenCalled();
  });
  it("retains the existing-chat tombstone decision across snapshot, reserve and persistence", async () => {
    const { ctx, tables } = makeCtx({ chats: [chat()] });
    const snapshot = await read(ctx);
    tables.chats.length = 0;
    expect(await reserveRun(ctx)).toMatchObject({ acquired: true });
    ctx.db.insert.mockClear();
    ctx.db.patch.mockClear();
    const { persistInitialTurn } = jest.requireActual(
      "../agentRunClaims",
    ) as any;
    await expect(
      persistInitialTurn.handler(ctx, {
        ...base,
        claimId: "claim-b",
        title: "Must not recreate",
        allowCreate: snapshot.chat === null,
      }),
    ).rejects.toThrow("This chat no longer exists.");
    expect(tables.chats).toEqual([]);
    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
});

describe("legacy paths honor durable dispatch admission", () => {
  const previousFlag = process.env.RIFT_DURABLE_DISPATCH_ADMISSION;
  beforeEach(() => {
    process.env.RIFT_DURABLE_DISPATCH_ADMISSION = "true";
  });
  afterEach(() => {
    if (previousFlag === undefined)
      delete process.env.RIFT_DURABLE_DISPATCH_ADMISSION;
    else process.env.RIFT_DURABLE_DISPATCH_ADMISSION = previousFlag;
  });
  function admitted(active = false) {
    const identity = {
      user_id: "owner",
      chat_id: "chat-1",
      dispatch_id: "dispatch",
      attempt_id: "attempt",
      next_claim_id: "next",
      phase: "elected",
    };
    return makeCtx({
      chats: [chat(active ? { active_trigger_run_id: "run-a" } : {})],
      claims: active ? [claim({ phase: "active", run_id: "run-a" })] : [],
      gates: [{ _id: "gate", ...identity }],
      intents: [{ _id: "intent", ...identity }],
    });
  }
  it("blocks a legacy first reservation while an intent owns admission", async () => {
    const { ctx, tables } = admitted();
    expect((await reserveRun(ctx)).acquired).toBe(false);
    expect(tables.agent_run_claims).toHaveLength(0);
  });
  it("does not let legacy replacement cancel the elected predecessor", async () => {
    const { ctx, tables } = admitted(true);
    expect(
      await (requestCancellation as any).handler(ctx, {
        ...base,
        claimId: "claim-a",
        runId: "run-a",
        reason: "replace",
      }),
    ).toBe(false);
    expect(tables.agent_run_claims[0].cancel_requested_at).toBeUndefined();
    expect(tables.agent_dispatch_admissions[0].phase).toBe("elected");
  });
  it("revokes admission when the user stops the exact current run", async () => {
    const { ctx, tables } = admitted(true);
    expect(
      await (requestCancellation as any).handler(ctx, {
        ...base,
        claimId: "claim-a",
        runId: "run-a",
      }),
    ).toBe(true);
    expect(tables.agent_dispatch_admissions[0].phase).toBe("revoked");
    expect(tables.agent_dispatch_intents[0].phase).toBe("revoked");
  });
  it("does not let an obsolete Stop revoke a newer intent", async () => {
    const { ctx, tables } = admitted(true);
    expect(
      await (requestCancellation as any).handler(ctx, {
        ...base,
        claimId: "obsolete",
        runId: "old",
      }),
    ).toBe(false);
    expect(tables.agent_dispatch_admissions[0].phase).toBe("elected");
  });
  it("chat Stop revokes an elected first request even before a claim exists", async () => {
    const { cancelCurrentOwnedClaim } =
      await import("../lib/agentClaimCancellation");
    const { ctx, tables } = admitted();
    await cancelCurrentOwnedClaim(ctx, base);
    expect(tables.agent_dispatch_admissions[0].phase).toBe("revoked");
  });
});

describe("durable remote resource journal", () => {
  const args = {
    ...base,
    claimId: "claim-a",
    runId: "run-a",
    resourceId: "resource-a",
    sandboxId: "sandbox-a",
  };
  const journal = () => jest.requireActual<any>("../agentRunResources");
  const fixture = () =>
    makeCtx({
      claims: [
        claim({
          phase: "active",
          run_id: "run-a",
          remote_cleanup_required: true,
        }),
      ],
    });
  it("reserves a launch once and blocks cleanup even before the start acknowledgment", async () => {
    const { ctx, tables } = fixture();
    const { reserveCommand } = journal();
    expect(await reserveCommand.handler(ctx, args)).toBe(true);
    expect(await reserveCommand.handler(ctx, args)).toBe(false);
    expect(tables.agent_run_resources).toHaveLength(1);
    const { confirmRemoteCleanup } =
      jest.requireActual<any>("../agentRunClaims");
    expect(await confirmRemoteCleanup.handler(ctx, args)).toBe(false);
  });
  it("retains a late start after Stop and requires the matching process identity for exit", async () => {
    const { ctx, tables } = fixture();
    const { reserveCommand, recordStarted, recordExited } = journal();
    await reserveCommand.handler(ctx, args);
    tables.agent_run_claims[0].cancel_requested_at = NOW;
    const started = {
      ...args,
      pid: 123,
      processIdentity: "boot-id:start-ticks:nonce-a",
    };
    expect(await recordStarted.handler(ctx, started)).toBe(true);
    expect(await recordStarted.handler(ctx, started)).toBe(true);
    await expect(
      recordExited.handler(ctx, {
        ...started,
        processIdentity: "different-process",
      }),
    ).rejects.toThrow();
    const { confirmRemoteCleanup } =
      jest.requireActual<any>("../agentRunClaims");
    expect(await confirmRemoteCleanup.handler(ctx, args)).toBe(false);
    expect(await recordExited.handler(ctx, started)).toBe(true);
    expect(await recordExited.handler(ctx, started)).toBe(true);
    expect(await confirmRemoteCleanup.handler(ctx, args)).toBe(true);
    expect(
      await reserveCommand.handler(ctx, { ...args, resourceId: "late-launch" }),
    ).toBe(false);
  });
  it("scopes recovery inventory to exact owner, chat, claim, run and pending state", async () => {
    const { ctx, tables } = fixture();
    await journal().reserveCommand.handler(ctx, args);
    const row = tables.agent_run_resources[0];
    tables.agent_run_resources.push(
      ...[
        { user_id: "foreign" },
        { chat_id: "other-chat" },
        { claim_id: "old-claim" },
        { run_id: "old-run" },
        { state: "exited" },
      ].map((patch, i) => ({ ...row, _id: `foreign-${i}`, ...patch })),
    );
    const result = await journal().listPending.handler(ctx, {
      ...args,
      state: "reserved",
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(result.page).toEqual([row]);
  });
  it("accepts explicit unsent proof but refuses a later start or abandoning a started process", async () => {
    const { ctx } = fixture();
    const { reserveCommand, recordNotStarted, recordStarted } = journal();
    await reserveCommand.handler(ctx, args);
    await recordNotStarted.handler(ctx, args);
    const started = { ...args, pid: 123, processIdentity: "identity" };
    await expect(recordStarted.handler(ctx, started)).rejects.toThrow();
    const { confirmRemoteCleanup } =
      jest.requireActual<any>("../agentRunClaims");
    expect(await confirmRemoteCleanup.handler(ctx, args)).toBe(true);
    const other = fixture();
    await reserveCommand.handler(other.ctx, args);
    await recordStarted.handler(other.ctx, started);
    await expect(recordNotStarted.handler(other.ctx, args)).rejects.toThrow();
  });
  it("does not turn an unacknowledged launch into an exited process", async () => {
    const { ctx } = fixture();
    const { reserveCommand, recordExited } = journal();
    await reserveCommand.handler(ctx, args);
    await expect(
      recordExited.handler(ctx, {
        ...args,
        pid: 123,
        processIdentity: "identity",
      }),
    ).rejects.toThrow();
  });
  it.each([
    { userId: "other-owner" },
    { claimId: "replacement" },
    { runId: "other-run" },
    { sandboxId: "other-sandbox" },
  ])("rejects a receipt with mismatched ownership %j", async (patch) => {
    const { ctx } = fixture();
    const { reserveCommand, recordStarted } = journal();
    await reserveCommand.handler(ctx, args);
    await expect(
      recordStarted.handler(ctx, {
        ...args,
        ...patch,
        pid: 123,
        processIdentity: "identity",
      }),
    ).rejects.toThrow();
  });
  it("preserves historical receipts without changing a successor claim", async () => {
    const { ctx, tables } = fixture();
    const { reserveCommand, recordStarted, recordExited } = journal();
    await reserveCommand.handler(ctx, args);
    tables.agent_run_claims[0].claim_id = "successor";
    const started = { ...args, pid: 123, processIdentity: "identity" };
    await recordStarted.handler(ctx, started);
    await recordExited.handler(ctx, started);
    expect(tables.agent_run_claims[0].remote_cleanup_confirmed).toBeUndefined();
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid PID %s",
    async (pid) => {
      const { ctx } = fixture();
      const { reserveCommand, recordStarted } = journal();
      await reserveCommand.handler(ctx, args);
      await expect(
        recordStarted.handler(ctx, {
          ...args,
          pid,
          processIdentity: "identity",
        }),
      ).rejects.toThrow();
    },
  );
  it("does not overlook a pending resource after hundreds of exited commands", async () => {
    const { ctx, tables } = fixture();
    await journal().reserveCommand.handler(ctx, args);
    const reserved = tables.agent_run_resources[0];
    tables.agent_run_resources.unshift(
      ...Array.from({ length: 300 }, (_, i) => ({
        ...reserved,
        _id: `done-${i}`,
        resource_id: `done-${i}`,
        state: "exited",
      })),
    );
    const { confirmRemoteCleanup } =
      jest.requireActual<any>("../agentRunClaims");
    expect(await confirmRemoteCleanup.handler(ctx, args)).toBe(false);
  });
  it("rejects new launches after cancellation", async () => {
    const { ctx, tables } = fixture();
    tables.agent_run_claims[0].cancel_requested_at = NOW;
    expect(await journal().reserveCommand.handler(ctx, args)).toBe(false);
  });
});

it("records sandbox absence separately from successful process exit", async () => {
  const { recordSandboxAbsent } = jest.requireActual<
    typeof import("../agentRunResources")
  >("../agentRunResources");
  const args = {
    ...base,
    claimId: "claim-a",
    runId: "run-a",
    resourceId: "resource-a",
    sandboxId: "sandbox-a",
  };
  const row = {
    _id: "resource-row",
    user_id: base.userId,
    chat_id: base.chatId,
    claim_id: args.claimId,
    run_id: args.runId,
    resource_id: args.resourceId,
    sandbox_id: args.sandboxId,
    state: "reserved",
  };
  const patch = jest.fn();
  const ctx = {
    db: {
      query: () => ({ withIndex: () => ({ take: async () => [row] }) }),
      patch,
    },
  };
  expect(await (recordSandboxAbsent as any).handler(ctx, args)).toBe(true);
  expect(patch).toHaveBeenCalledWith("resource-row", {
    state: "sandbox_absent",
    absence_verified_at: expect.any(Number),
  });
  await expect(
    (recordSandboxAbsent as any).handler(ctx, { ...args, userId: "foreign" }),
  ).rejects.toThrow();
});
