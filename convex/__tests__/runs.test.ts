import { describe, it, expect, jest, beforeEach } from "@jest/globals";

jest.mock("../_generated/server", () => ({
  mutation: jest.fn((config: any) => config),
  internalMutation: jest.fn((config: any) => config),
  query: jest.fn((config: any) => config),
  internalQuery: jest.fn((config: any) => config),
}));
jest.mock("convex/values", () => ({
  v: new Proxy({}, { get: () => jest.fn(() => "v") }),
  ConvexError: class ConvexError extends Error {
    data: any;
    constructor(data: any) {
      super(typeof data === "string" ? data : data.message);
      this.data = data;
      this.name = "ConvexError";
    }
  },
}));

const SERVICE_KEY = "test-service-key";
process.env.CONVEX_SERVICE_ROLE_KEY = SERVICE_KEY;

const CHAT_ID = "chat-1";
const USER_ID = "user-1";

/** A tiny in-memory stand-in for the tables these mutations touch. */
function makeCtx(seed: { runs?: any[]; run_events?: any[] } = {}) {
  const tables: Record<string, any[]> = {
    runs: seed.runs ?? [],
    run_events: seed.run_events ?? [],
    evidence: [],
  };
  let nextId = 1;

  const buildQuery = (table: string) => {
    let rows = [...tables[table]];
    const chain: any = {
      withIndex: (_name: string, predicate?: any) => {
        if (predicate) {
          const captured: Record<string, unknown> = {};
          predicate({
            eq: (field: string, value: unknown) => {
              captured[field] = value;
              return {
                eq: (f2: string, v2: unknown) => {
                  captured[f2] = v2;
                  return {};
                },
              };
            },
          });
          rows = rows.filter((row) =>
            Object.entries(captured).every(([key, value]) => row[key] === value),
          );
        }
        return chain;
      },
      order: (direction: "asc" | "desc") => {
        rows.sort((a, b) =>
          direction === "desc" ? (b.seq ?? 0) - (a.seq ?? 0) : (a.seq ?? 0) - (b.seq ?? 0),
        );
        return chain;
      },
      first: async () => rows[0] ?? null,
      take: async (n: number) => rows.slice(0, n),
    };
    return chain;
  };

  return {
    tables,
    auth: {
      getUserIdentity: jest
        .fn<any>()
        .mockResolvedValue({ subject: `${USER_ID}|s` }),
    },
    db: {
      query: (table: string) => buildQuery(table),
      get: jest.fn<any>().mockResolvedValue(null),
      insert: jest.fn<any>(async (table: string, doc: any) => {
        const _id = `${table}-${nextId++}`;
        tables[table].push({ _id, ...doc });
        return _id;
      }),
      patch: jest.fn<any>(async (id: string, patch: any) => {
        for (const rows of Object.values(tables)) {
          const row = rows.find((candidate) => candidate._id === id);
          if (row) Object.assign(row, patch);
        }
      }),
    },
  } as any;
}

describe("run event log", () => {
  beforeEach(() => jest.clearAllMocks());

  it("numbers events monotonically within a run", async () => {
    const ctx = makeCtx();
    const { appendRunEvent } = await import("../runs");

    for (const type of ["run_started", "terminal_command", "finding"]) {
      await appendRunEvent.handler(ctx, {
        serviceKey: SERVICE_KEY,
        runId: "run-1",
        chatId: CHAT_ID,
        userId: USER_ID,
        type,
      });
    }

    expect(ctx.tables.run_events.map((e: any) => e.seq)).toEqual([1, 2, 3]);
    expect(ctx.tables.run_events.map((e: any) => e.type)).toEqual([
      "run_started",
      "terminal_command",
      "finding",
    ]);
  });

  it("numbers each run's events independently", async () => {
    const ctx = makeCtx();
    const { appendRunEvent } = await import("../runs");

    await appendRunEvent.handler(ctx, {
      serviceKey: SERVICE_KEY,
      runId: "run-a",
      chatId: CHAT_ID,
      userId: USER_ID,
      type: "x",
    });
    await appendRunEvent.handler(ctx, {
      serviceKey: SERVICE_KEY,
      runId: "run-b",
      chatId: CHAT_ID,
      userId: USER_ID,
      type: "x",
    });

    expect(ctx.tables.run_events.map((e: any) => e.seq)).toEqual([1, 1]);
  });
});

describe("evidence", () => {
  beforeEach(() => jest.clearAllMocks());

  it("stores content and links an event to it in one write", async () => {
    const ctx = makeCtx();
    const { recordEvidence } = await import("../runs");

    await recordEvidence.handler(ctx, {
      serviceKey: SERVICE_KEY,
      chatId: CHAT_ID,
      userId: USER_ID,
      runId: "run-1",
      toolCallId: "call-1",
      kind: "terminal_output",
      content: "build failed",
      exitCode: 1,
      event: { type: "terminal_command", summary: "npm run build" },
    });

    expect(ctx.tables.evidence).toHaveLength(1);
    expect(ctx.tables.evidence[0]).toMatchObject({
      kind: "terminal_output",
      content: "build failed",
    });
    // Untruncated content omits the flag entirely rather than storing a null.
    expect(ctx.tables.evidence[0].truncated).toBeUndefined();
    // The event points at evidence that is guaranteed to exist.
    expect(ctx.tables.run_events[0].evidence_id).toBe(
      ctx.tables.evidence[0]._id,
    );
  });

  it("caps oversized content and reports the size it had", async () => {
    // Evidence must never be the thing that pushes a document past Convex's
    // 1 MiB limit -- that would make the fix reintroduce the original failure.
    const ctx = makeCtx();
    const { recordEvidence, EVIDENCE_CONTENT_MAX_BYTES } = await import(
      "../runs"
    );
    const huge = "x".repeat(EVIDENCE_CONTENT_MAX_BYTES + 50_000);

    await recordEvidence.handler(ctx, {
      serviceKey: SERVICE_KEY,
      chatId: CHAT_ID,
      userId: USER_ID,
      kind: "tool_output",
      content: huge,
    });

    const stored = ctx.tables.evidence[0];
    expect(stored.truncated).toBe(true);
    expect(stored.byte_size).toBe(huge.length);
    expect(stored.content.length).toBeLessThan(huge.length);
    expect(stored.content).toContain("[evidence truncated");
  });

  it("caps multibyte output by bytes including its notice, without splitting characters", async () => {
    const ctx = makeCtx();
    const { recordEvidence, EVIDENCE_CONTENT_MAX_BYTES } = await import("../runs");
    const huge = "ğ🙂漢".repeat(160_000);
    await recordEvidence.handler(ctx, {
      serviceKey: SERVICE_KEY, chatId: CHAT_ID, userId: USER_ID,
      kind: "terminal_output", content: huge,
    });
    const stored = ctx.tables.evidence[0];
    expect(new TextEncoder().encode(stored.content).byteLength).toBeLessThanOrEqual(EVIDENCE_CONTENT_MAX_BYTES);
    expect(stored.content).not.toContain("\uFFFD");
    expect(stored.byte_size).toBe(new TextEncoder().encode(huge).byteLength);
    expect(stored.truncated).toBe(true);
  });

  it("writes no event when there is no run to attach it to", async () => {
    const ctx = makeCtx();
    const { recordEvidence } = await import("../runs");

    await recordEvidence.handler(ctx, {
      serviceKey: SERVICE_KEY,
      chatId: CHAT_ID,
      userId: USER_ID,
      kind: "tool_output",
      content: "orphan output",
      event: { type: "tool_result" },
    });

    expect(ctx.tables.evidence).toHaveLength(1);
    expect(ctx.tables.run_events).toHaveLength(0);
  });
});

describe("run lifecycle", () => {
  beforeEach(() => jest.clearAllMocks());

  it("keeps the original start time when a retry reuses the run id", async () => {
    // The recorded duration must stay the duration the user actually waited.
    const ctx = makeCtx({
      runs: [
        {
          _id: "runs-1",
          id: "run-1",
          chat_id: CHAT_ID,
          user_id: USER_ID,
          status: "failed",
          started_at: 1000,
          update_time: 1000,
        },
      ],
    });
    const { startRun } = await import("../runs");

    await startRun.handler(ctx, {
      serviceKey: SERVICE_KEY,
      runId: "run-1",
      chatId: CHAT_ID,
      userId: USER_ID,
    });

    expect(ctx.tables.runs).toHaveLength(1);
    expect(ctx.tables.runs[0].started_at).toBe(1000);
    // A reopened run goes back to `starting`, not straight to `running`: the
    // stream has not produced anything yet, and claiming otherwise would show
    // the user a run that is further along than it is.
    expect(ctx.tables.runs[0].status).toBe("starting");
  });

  it("moves an in-flight run to a new status", async () => {
    const ctx = makeCtx({
      runs: [
        {
          _id: "runs-1",
          id: "run-1",
          chat_id: CHAT_ID,
          user_id: USER_ID,
          status: "starting",
          started_at: 1000,
          update_time: 1000,
        },
      ],
    });
    const { markRunStatus } = await import("../runs");

    await markRunStatus.handler(ctx, {
      serviceKey: SERVICE_KEY,
      runId: "run-1",
      status: "running",
      phase: "recon",
    });

    expect(ctx.tables.runs[0]).toMatchObject({
      status: "running",
      phase: "recon",
    });
  });

  it("refuses to reopen a run that already finished", async () => {
    // A late in-flight update must not contradict an outcome the user has
    // already seen.
    const ctx = makeCtx({
      runs: [
        {
          _id: "runs-1",
          id: "run-1",
          chat_id: CHAT_ID,
          user_id: USER_ID,
          status: "cancelled",
          started_at: 1000,
          ended_at: 2000,
          update_time: 2000,
        },
      ],
    });
    const { markRunStatus } = await import("../runs");

    await markRunStatus.handler(ctx, {
      serviceKey: SERVICE_KEY,
      runId: "run-1",
      status: "running",
    });

    expect(ctx.tables.runs[0].status).toBe("cancelled");
  });

  it("closes a stopped run as cancelled with its stop reason", async () => {
    const ctx = makeCtx({
      runs: [
        {
          _id: "runs-1",
          id: "run-1",
          chat_id: CHAT_ID,
          user_id: USER_ID,
          status: "running",
          started_at: 1000,
          update_time: 1000,
        },
      ],
    });
    const { finishRun } = await import("../runs");

    await finishRun.handler(ctx, {
      serviceKey: SERVICE_KEY,
      runId: "run-1",
      status: "cancelled",
      stopReason: "user",
    });

    expect(ctx.tables.runs[0]).toMatchObject({
      status: "cancelled",
      stop_reason: "user",
    });
    expect(typeof ctx.tables.runs[0].ended_at).toBe("number");
  });

  it("ignores a close for a run that was never opened", async () => {
    const ctx = makeCtx();
    const { finishRun } = await import("../runs");

    await expect(
      finishRun.handler(ctx, {
        serviceKey: SERVICE_KEY,
        runId: "missing",
        status: "completed",
      }),
    ).resolves.toBeNull();
  });
});

describe("finishRun outcome guard", () => {
  beforeEach(() => jest.clearAllMocks());

  it("closes an open run with its outcome, model, metrics and prompt hash", async () => {
    const ctx = makeCtx({
      runs: [
        {
          _id: "runs-1",
          id: "run-1",
          chat_id: CHAT_ID,
          user_id: USER_ID,
          status: "running",
          started_at: 1000,
          update_time: 1000,
        },
      ],
    });
    const { finishRun } = await import("../runs");

    await finishRun.handler(ctx, {
      serviceKey: SERVICE_KEY,
      runId: "run-1",
      status: "completed",
      finishReason: "stop",
      costDollars: 0.25,
      totalTokens: 1234,
      outputCount: 2,
      model: "x-ai/grok-4.3",
      metrics: { steps: 7, tool_calls: 3 },
      promptHash: "sha256:abc",
    });

    const run = ctx.tables.runs[0];
    expect(run).toMatchObject({
      status: "completed",
      finish_reason: "stop",
      cost_dollars: 0.25,
      total_tokens: 1234,
      output_count: 2,
      model: "x-ai/grok-4.3",
      metrics: { steps: 7, tool_calls: 3 },
      prompt_hash: "sha256:abc",
    });
    expect(typeof run.ended_at).toBe("number");
    expect(run.ended_at).toBeGreaterThanOrEqual(run.started_at);
  });

  it("keeps the first terminal outcome when a late close lands on a closed run", async () => {
    // The cancel route closes the record the moment the user stops a run. The
    // dying worker's own close can arrive seconds later and must not turn
    // "cancelled" into "completed" -- it may only fill facts nobody had yet.
    const ctx = makeCtx({
      runs: [
        {
          _id: "runs-1",
          id: "run-1",
          chat_id: CHAT_ID,
          user_id: USER_ID,
          status: "cancelled",
          stop_reason: "user",
          started_at: 1000,
          ended_at: 2000,
          update_time: 2000,
          // Already known: must survive the late write untouched.
          cost_dollars: 0.5,
          message_id: "msg-first",
        },
      ],
    });
    const { finishRun } = await import("../runs");

    await finishRun.handler(ctx, {
      serviceKey: SERVICE_KEY,
      runId: "run-1",
      status: "completed",
      stopReason: "finished",
      finishReason: "stop",
      error: "late error",
      messageId: "msg-late",
      costDollars: 9.99,
      totalTokens: 4321,
      outputCount: 5,
      model: "late-model",
      metrics: { steps: 3 },
      promptHash: "sha256:late",
    });

    const run = ctx.tables.runs[0];
    // Outcome is frozen.
    expect(run.status).toBe("cancelled");
    expect(run.stop_reason).toBe("user");
    expect(run.ended_at).toBe(2000);
    expect(run.finish_reason).toBeUndefined();
    expect(run.error).toBeUndefined();
    expect(run.output_count).toBeUndefined();
    expect(run.prompt_hash).toBeUndefined();
    // Present facts are not overwritten.
    expect(run.cost_dollars).toBe(0.5);
    expect(run.message_id).toBe("msg-first");
    // Missing facts are filled in.
    expect(run.total_tokens).toBe(4321);
    expect(run.model).toBe("late-model");
    expect(run.metrics).toEqual({ steps: 3 });
    expect(ctx.db.patch).toHaveBeenCalledTimes(1);
  });
});

describe("batched run events", () => {
  beforeEach(() => jest.clearAllMocks());

  it("assigns seq in array order and persists per-step fields as columns", async () => {
    const ctx = makeCtx();
    const { appendRunEvents } = await import("../runs");

    const result = await appendRunEvents.handler(ctx, {
      serviceKey: SERVICE_KEY,
      runId: "run-1",
      chatId: CHAT_ID,
      userId: USER_ID,
      events: [
        {
          type: "step",
          at: 111,
          stepIndex: 0,
          inputTokens: 10,
          outputTokens: 20,
          reasoningTokens: 5,
          cacheReadTokens: 2,
          costDollars: 0.01,
          status: "ok",
          inputHash: "h0",
          outputBytes: 512,
        },
        {
          type: "tool_call",
          toolName: "bash",
          toolCallId: "call-1",
          exitCode: 0,
          durationMs: 40,
          stepIndex: 1,
          status: "ok",
        },
        { type: "step", stepIndex: 2, status: "error" },
      ],
    });

    expect(result).toEqual({ appended: 3 });
    const rows = ctx.tables.run_events;
    expect(rows.map((e: any) => e.seq)).toEqual([1, 2, 3]);
    expect(rows.map((e: any) => e.type)).toEqual(["step", "tool_call", "step"]);
    expect(rows[0]).toMatchObject({
      run_id: "run-1",
      chat_id: CHAT_ID,
      user_id: USER_ID,
      at: 111,
      step_index: 0,
      input_tokens: 10,
      output_tokens: 20,
      reasoning_tokens: 5,
      cache_read_tokens: 2,
      cost_dollars: 0.01,
      status: "ok",
      input_hash: "h0",
      output_bytes: 512,
    });
    expect(rows[1]).toMatchObject({
      tool_name: "bash",
      tool_call_id: "call-1",
      exit_code: 0,
      duration_ms: 40,
      step_index: 1,
      status: "ok",
    });
    expect(rows[2]).toMatchObject({ step_index: 2, status: "error" });
    // An event without its own timestamp gets the mutation's clock.
    expect(typeof rows[1].at).toBe("number");
  });

  it("appends at most 100 events per call and reports how many landed", async () => {
    const ctx = makeCtx();
    const { appendRunEvents } = await import("../runs");

    const events = Array.from({ length: 150 }, (_, index) => ({
      type: "step",
      stepIndex: index,
    }));

    const result = await appendRunEvents.handler(ctx, {
      serviceKey: SERVICE_KEY,
      runId: "run-1",
      chatId: CHAT_ID,
      userId: USER_ID,
      events,
    });

    expect(result).toEqual({ appended: 100 });
    expect(ctx.tables.run_events).toHaveLength(100);
    expect(ctx.tables.run_events[0].seq).toBe(1);
    expect(ctx.tables.run_events[99].seq).toBe(100);
    // The first hundred in array order, not an arbitrary hundred.
    expect(ctx.tables.run_events[99].step_index).toBe(99);
  });

  it("continues numbering after an earlier batch on the same run", async () => {
    const ctx = makeCtx({
      run_events: [
        { _id: "run_events-0", run_id: "run-1", chat_id: CHAT_ID, user_id: USER_ID, seq: 4, type: "x", at: 1 },
      ],
    });
    const { appendRunEvents } = await import("../runs");

    await appendRunEvents.handler(ctx, {
      serviceKey: SERVICE_KEY,
      runId: "run-1",
      chatId: CHAT_ID,
      userId: USER_ID,
      events: [{ type: "a" }, { type: "b" }],
    });

    expect(ctx.tables.run_events.map((e: any) => e.seq)).toEqual([4, 5, 6]);
  });
});

describe("single run event with per-step fields", () => {
  beforeEach(() => jest.clearAllMocks());

  it("persists the optional telemetry fields as snake_case columns", async () => {
    const ctx = makeCtx();
    const { appendRunEvent } = await import("../runs");

    await appendRunEvent.handler(ctx, {
      serviceKey: SERVICE_KEY,
      runId: "run-1",
      chatId: CHAT_ID,
      userId: USER_ID,
      type: "step",
      summary: "step 3",
      stepIndex: 3,
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: 25,
      cacheReadTokens: 80,
      costDollars: 0.002,
      status: "ok",
      inputHash: "sha256:in",
      outputBytes: 2048,
    });

    expect(ctx.tables.run_events).toHaveLength(1);
    expect(ctx.tables.run_events[0]).toMatchObject({
      seq: 1,
      type: "step",
      summary: "step 3",
      step_index: 3,
      input_tokens: 100,
      output_tokens: 50,
      reasoning_tokens: 25,
      cache_read_tokens: 80,
      cost_dollars: 0.002,
      status: "ok",
      input_hash: "sha256:in",
      output_bytes: 2048,
    });
    expect(typeof ctx.tables.run_events[0].at).toBe("number");
  });
});
