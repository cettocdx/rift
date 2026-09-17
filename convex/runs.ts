import { query, mutation, internalMutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { validateServiceKey } from "./lib/utils";
import type { Id, Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { RUN_STATUS_META, RUN_STATUSES } from "../lib/runs/run-status";

/**
 * Runs, their event log, and the evidence they gather.
 *
 * A run is a record OF the work, never a precondition FOR it. Every mutation
 * here is called best-effort from the producer, so nothing in this file may
 * throw into the agent's hot path for a reason the user would not care about.
 * Ownership and service-key checks still throw, because writing another user's
 * run is not a benign failure.
 */

/** Evidence content cap. Well under Convex's 1 MiB document limit. */
export const EVIDENCE_CONTENT_MAX_BYTES = 600 * 1024;

const encoder = new TextEncoder();

/** Keep the inline excerpt within its UTF-8 byte budget, including the notice. */
function capContent(content: string): {
  content: string;
  truncated: boolean;
  byteSize: number;
} {
  const bytes = encoder.encode(content);
  const byteSize = bytes.byteLength;
  if (byteSize <= EVIDENCE_CONTENT_MAX_BYTES) {
    return { content, truncated: false, byteSize };
  }
  const notice = `\n\n[evidence truncated: ${byteSize} bytes total]`;
  const budget = EVIDENCE_CONTENT_MAX_BYTES - encoder.encode(notice).byteLength;
  // Streaming decode holds an incomplete final code point instead of inserting
  // a replacement character (which could also exceed the byte budget).
  const kept = new TextDecoder().decode(bytes.subarray(0, budget), {
    stream: true,
  });
  return { content: kept + notice, truncated: true, byteSize };
}

// ---------------------------------------------------------------------------
// Producer-side writes (service key)
// ---------------------------------------------------------------------------

/**
 * Opens a run, or re-opens the record if the producer retried with the same id.
 */
export const startRun = mutation({
  args: {
    serviceKey: v.string(),
    runId: v.string(),
    chatId: v.string(),
    userId: v.string(),
    mode: v.optional(v.string()),
    purpose: v.optional(v.string()),
    surface: v.optional(v.string()),
    goal: v.optional(v.string()),
    model: v.optional(v.string()),
    messageId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const now = Date.now();

    const existing = await ctx.db
      .query("runs")
      .withIndex("by_run_id", (q) => q.eq("id", args.runId))
      .first();

    if (existing) {
      // A retried attempt reuses the run id. Keep the original start time so
      // the recorded duration stays the duration the user actually waited.
      await ctx.db.patch(existing._id, {
        status: "starting",
        ...(args.messageId ? { message_id: args.messageId } : {}),
        ...(args.model ? { model: args.model } : {}),
        ...(args.goal ? { goal: args.goal } : {}),
        ...(args.surface ? { surface: args.surface } : {}),
        update_time: now,
      });
      return null;
    }

    await ctx.db.insert("runs", {
      id: args.runId,
      chat_id: args.chatId,
      user_id: args.userId,
      status: "starting",
      mode: args.mode,
      purpose: args.purpose,
      surface: args.surface,
      goal: args.goal,
      model: args.model,
      message_id: args.messageId,
      started_at: now,
      update_time: now,
    });
    return null;
  },
});

/** Closes a run with its outcome. */
export const finishRun = mutation({
  args: {
    serviceKey: v.string(),
    runId: v.string(),
    status: v.string(),
    stopReason: v.optional(v.string()),
    finishReason: v.optional(v.string()),
    error: v.optional(v.string()),
    messageId: v.optional(v.string()),
    costDollars: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    outputCount: v.optional(v.number()),
    model: v.optional(v.string()),
    metrics: v.optional(v.any()),
    promptHash: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);

    const run = await ctx.db
      .query("runs")
      .withIndex("by_run_id", (q) => q.eq("id", args.runId))
      .first();
    // A run that was never opened is not an error worth throwing over: the
    // producer may have failed before startRun landed.
    if (!run) return null;

    const now = Date.now();

    // First terminal write wins. The cancel route closes a record the moment
    // the user stops a run; the dying worker's own close can land seconds
    // later and used to overwrite "cancelled" with whatever it thought
    // happened. A closed run keeps its outcome; a late writer may only fill
    // in facts the first one did not have (cost, tokens, model, metrics).
    if (run.ended_at !== undefined) {
      // A legacy 404 observation was not an authoritative terminal outcome.
      // Repair only from the exact persisted final message, never these args.
      await reconcileSavedOutcome(ctx, run);
      await ctx.db.patch(run._id, {
        ...(run.cost_dollars === undefined &&
        typeof args.costDollars === "number"
          ? { cost_dollars: args.costDollars }
          : {}),
        ...(run.total_tokens === undefined &&
        typeof args.totalTokens === "number"
          ? { total_tokens: args.totalTokens }
          : {}),
        ...(run.message_id === undefined && args.messageId
          ? { message_id: args.messageId }
          : {}),
        ...(run.model === undefined && args.model ? { model: args.model } : {}),
        ...(run.metrics === undefined && args.metrics !== undefined
          ? { metrics: args.metrics }
          : {}),
        update_time: now,
      });
      return null;
    }

    await ctx.db.patch(run._id, {
      status: args.status,
      ended_at: now,
      ...(args.model ? { model: args.model } : {}),
      ...(args.metrics !== undefined ? { metrics: args.metrics } : {}),
      ...(args.promptHash ? { prompt_hash: args.promptHash } : {}),
      ...(args.stopReason ? { stop_reason: args.stopReason } : {}),
      ...(args.finishReason ? { finish_reason: args.finishReason } : {}),
      ...(args.error ? { error: args.error } : {}),
      ...(args.messageId ? { message_id: args.messageId } : {}),
      ...(typeof args.costDollars === "number"
        ? { cost_dollars: args.costDollars }
        : {}),
      ...(typeof args.totalTokens === "number"
        ? { total_tokens: args.totalTokens }
        : {}),
      ...(typeof args.outputCount === "number"
        ? { output_count: args.outputCount }
        : {}),
      update_time: now,
    });
    return null;
  },
});

/**
 * Moves a run to a new status while it is still in flight.
 *
 * Run status is server authoritative: the client renders what this says rather
 * than inferring a state from the absence of events.
 */
export const markRunStatus = mutation({
  args: {
    serviceKey: v.string(),
    runId: v.string(),
    status: v.string(),
    phase: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);

    const run = await ctx.db
      .query("runs")
      .withIndex("by_run_id", (q) => q.eq("id", args.runId))
      .first();
    if (!run) return null;

    // A closed run keeps its outcome. A late in-flight update must not reopen
    // a run the user already saw finish.
    if (run.ended_at !== undefined) return null;

    await ctx.db.patch(run._id, {
      status: args.status,
      ...(args.phase ? { phase: args.phase } : {}),
      update_time: Date.now(),
    });
    return null;
  },
});

/**
 * Records one piece of evidence and, optionally, the run event that points at
 * it. Both are written in one mutation so an event can never reference evidence
 * that failed to land.
 */
export const recordEvidence = mutation({
  args: {
    serviceKey: v.string(),
    chatId: v.string(),
    userId: v.string(),
    runId: v.optional(v.string()),
    toolCallId: v.optional(v.string()),
    kind: v.string(),
    content: v.string(),
    command: v.optional(v.string()),
    cwd: v.optional(v.string()),
    exitCode: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    /** When set, an event pointing at this evidence is appended to the run. */
    event: v.optional(
      v.object({
        type: v.string(),
        summary: v.optional(v.string()),
        toolName: v.optional(v.string()),
        severity: v.optional(v.string()),
      }),
    ),
  },
  returns: v.union(v.id("evidence"), v.null()),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);

    const capped = capContent(args.content);
    const now = Date.now();

    const evidenceId = await ctx.db.insert("evidence", {
      chat_id: args.chatId,
      user_id: args.userId,
      run_id: args.runId,
      tool_call_id: args.toolCallId,
      kind: args.kind,
      content: capped.content,
      ...(capped.truncated ? { truncated: true } : {}),
      byte_size: capped.byteSize,
      command: args.command,
      cwd: args.cwd,
      exit_code: args.exitCode,
      started_at: args.startedAt,
      ended_at: args.endedAt,
      duration_ms: args.durationMs,
      created_at: now,
    });

    if (args.event && args.runId) {
      await appendEventRow(ctx, {
        runId: args.runId,
        chatId: args.chatId,
        userId: args.userId,
        type: args.event.type,
        summary: args.event.summary,
        toolName: args.event.toolName,
        severity: args.event.severity,
        toolCallId: args.toolCallId,
        evidenceId,
        exitCode: args.exitCode,
        durationMs: args.durationMs,
        at: now,
      });
    }

    return evidenceId;
  },
});

/** Optional per-step / replay fields shared by the single and batch appenders. */
const runEventExtraArgs = {
  stepIndex: v.optional(v.number()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  reasoningTokens: v.optional(v.number()),
  cacheReadTokens: v.optional(v.number()),
  costDollars: v.optional(v.number()),
  status: v.optional(v.string()),
  inputHash: v.optional(v.string()),
  outputBytes: v.optional(v.number()),
};

type RunEventExtra = {
  stepIndex?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  costDollars?: number;
  status?: string;
  inputHash?: string;
  outputBytes?: number;
};

const pickExtra = (source: RunEventExtra): RunEventExtra => ({
  stepIndex: source.stepIndex,
  inputTokens: source.inputTokens,
  outputTokens: source.outputTokens,
  reasoningTokens: source.reasoningTokens,
  cacheReadTokens: source.cacheReadTokens,
  costDollars: source.costDollars,
  status: source.status,
  inputHash: source.inputHash,
  outputBytes: source.outputBytes,
});

/** Appends one event to a run's log. */
export const appendRunEvent = mutation({
  args: {
    serviceKey: v.string(),
    runId: v.string(),
    chatId: v.string(),
    userId: v.string(),
    type: v.string(),
    summary: v.optional(v.string()),
    toolName: v.optional(v.string()),
    toolCallId: v.optional(v.string()),
    severity: v.optional(v.string()),
    exitCode: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    ...runEventExtraArgs,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    await appendEventRow(ctx, {
      runId: args.runId,
      chatId: args.chatId,
      userId: args.userId,
      type: args.type,
      summary: args.summary,
      toolName: args.toolName,
      toolCallId: args.toolCallId,
      severity: args.severity,
      exitCode: args.exitCode,
      durationMs: args.durationMs,
      at: Date.now(),
      ...pickExtra(args),
    });
    return null;
  },
});

/**
 * Appends several events in one mutation.
 *
 * Per-step telemetry writes one row per step; at one round trip per row that
 * is a hundred serial mutations on a long run. Batching keeps the recorder's
 * buffer semantics simple and the write count bounded. Order within the batch
 * is preserved: `seq` is assigned in array order.
 */
export const appendRunEvents = mutation({
  args: {
    serviceKey: v.string(),
    runId: v.string(),
    chatId: v.string(),
    userId: v.string(),
    events: v.array(
      v.object({
        type: v.string(),
        at: v.optional(v.number()),
        summary: v.optional(v.string()),
        toolName: v.optional(v.string()),
        toolCallId: v.optional(v.string()),
        severity: v.optional(v.string()),
        exitCode: v.optional(v.number()),
        durationMs: v.optional(v.number()),
        ...runEventExtraArgs,
      }),
    ),
  },
  returns: v.object({ appended: v.number() }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const now = Date.now();
    for (const event of args.events.slice(0, 100)) {
      await appendEventRow(ctx, {
        runId: args.runId,
        chatId: args.chatId,
        userId: args.userId,
        type: event.type,
        summary: event.summary,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        severity: event.severity,
        exitCode: event.exitCode,
        durationMs: event.durationMs,
        at: event.at ?? now,
        ...pickExtra(event),
      });
    }
    return { appended: Math.min(args.events.length, 100) };
  },
});

/**
 * Assigns the next sequence number for a run and inserts the event.
 *
 * `seq` is read-then-written inside the mutation. Convex mutations are
 * serializable and conflicting ones are retried, so two concurrent appends
 * cannot hand out the same number.
 */
async function appendEventRow(
  ctx: { db: any },
  input: {
    runId: string;
    chatId: string;
    userId: string;
    type: string;
    at: number;
    summary?: string;
    toolName?: string;
    toolCallId?: string;
    severity?: string;
    evidenceId?: Id<"evidence">;
    exitCode?: number;
    durationMs?: number;
  } & RunEventExtra,
): Promise<void> {
  const last = await ctx.db
    .query("run_events")
    .withIndex("by_run_id", (q: any) => q.eq("run_id", input.runId))
    .order("desc")
    .first();
  const seq = (last?.seq ?? 0) + 1;

  await ctx.db.insert("run_events", {
    run_id: input.runId,
    chat_id: input.chatId,
    user_id: input.userId,
    seq,
    type: input.type,
    at: input.at,
    tool_call_id: input.toolCallId,
    tool_name: input.toolName,
    summary: input.summary,
    evidence_id: input.evidenceId,
    severity: input.severity,
    exit_code: input.exitCode,
    duration_ms: input.durationMs,
    step_index: input.stepIndex,
    input_tokens: input.inputTokens,
    output_tokens: input.outputTokens,
    reasoning_tokens: input.reasoningTokens,
    cache_read_tokens: input.cacheReadTokens,
    cost_dollars: input.costDollars,
    status: input.status,
    input_hash: input.inputHash,
    output_bytes: input.outputBytes,
  });
}

// ---------------------------------------------------------------------------
// Reader-side (authenticated user)
// ---------------------------------------------------------------------------

const runShape = v.object({
  id: v.string(),
  chat_id: v.string(),
  status: v.string(),
  mode: v.optional(v.string()),
  purpose: v.optional(v.string()),
  surface: v.optional(v.string()),
  goal: v.optional(v.string()),
  phase: v.optional(v.string()),
  model: v.optional(v.string()),
  message_id: v.optional(v.string()),
  started_at: v.number(),
  ended_at: v.optional(v.number()),
  stop_reason: v.optional(v.string()),
  finish_reason: v.optional(v.string()),
  error: v.optional(v.string()),
  cost_dollars: v.optional(v.number()),
  total_tokens: v.optional(v.number()),
  output_count: v.optional(v.number()),
});

/** Projects a stored run into the reader shape. One place, so the list and the
 *  detail view can never disagree about what a run is. */
function toRunShape(run: {
  id: string;
  chat_id: string;
  status: string;
  mode?: string;
  purpose?: string;
  surface?: string;
  goal?: string;
  phase?: string;
  model?: string;
  message_id?: string;
  started_at: number;
  ended_at?: number;
  stop_reason?: string;
  finish_reason?: string;
  error?: string;
  cost_dollars?: number;
  total_tokens?: number;
  output_count?: number;
}) {
  return {
    id: run.id,
    chat_id: run.chat_id,
    status: run.status,
    mode: run.mode,
    purpose: run.purpose,
    surface: run.surface,
    goal: run.goal,
    phase: run.phase,
    model: run.model,
    message_id: run.message_id,
    started_at: run.started_at,
    ended_at: run.ended_at,
    stop_reason: run.stop_reason,
    finish_reason: run.finish_reason,
    error: run.error,
    cost_dollars: run.cost_dollars,
    total_tokens: run.total_tokens,
    output_count: run.output_count,
  };
}

async function requireUserId(ctx: { auth: any }): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Unauthorized: User not authenticated",
    });
  }
  return identity.subject.split("|")[0];
}

/** The runs recorded for one chat, newest first. */
export const listRunsForChat = query({
  args: { chatId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(runShape),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);

    const runs = await ctx.db
      .query("runs")
      .withIndex("by_chat_id", (q) => q.eq("chat_id", args.chatId))
      .order("desc")
      .take(limit);

    return runs.filter((run) => run.user_id === userId).map(toRunShape);
  },
});

/**
 * Every run this user has, newest first. The Runs destination filters client
 * side so switching filters costs no round trip.
 */
export const listRuns = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(runShape),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 200);

    const runs = await ctx.db
      .query("runs")
      .withIndex("by_user_id", (q) => q.eq("user_id", userId))
      .order("desc")
      .take(limit);

    return runs.map(toRunShape);
  },
});

/** One run's ordered event log, with the evidence each event points at. */
export const getRunLog = query({
  args: { runId: v.string(), limit: v.optional(v.number()) },
  returns: v.object({
    run: v.union(runShape, v.null()),
    events: v.array(
      v.object({
        seq: v.number(),
        type: v.string(),
        at: v.number(),
        summary: v.optional(v.string()),
        tool_name: v.optional(v.string()),
        tool_call_id: v.optional(v.string()),
        severity: v.optional(v.string()),
        exit_code: v.optional(v.number()),
        duration_ms: v.optional(v.number()),
        evidence_id: v.optional(v.id("evidence")),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const limit = Math.min(Math.max(args.limit ?? 500, 1), 1000);

    const run = await ctx.db
      .query("runs")
      .withIndex("by_run_id", (q) => q.eq("id", args.runId))
      .first();

    if (!run || run.user_id !== userId) {
      return { run: null, events: [] };
    }

    const events = await ctx.db
      .query("run_events")
      .withIndex("by_run_id", (q) => q.eq("run_id", args.runId))
      .order("asc")
      .take(limit);

    return {
      run: toRunShape(run),
      events: events.map((event) => ({
        seq: event.seq,
        type: event.type,
        at: event.at,
        summary: event.summary,
        tool_name: event.tool_name,
        tool_call_id: event.tool_call_id,
        severity: event.severity,
        exit_code: event.exit_code,
        duration_ms: event.duration_ms,
        evidence_id: event.evidence_id,
      })),
    };
  },
});

/**
 * Reads back one piece of evidence. This is what makes compaction non-lossy:
 * the message keeps a short placeholder, and the full output is still here.
 */
export const getEvidence = query({
  args: { evidenceId: v.id("evidence") },
  returns: v.union(
    v.object({
      kind: v.string(),
      content: v.string(),
      truncated: v.optional(v.boolean()),
      byte_size: v.number(),
      command: v.optional(v.string()),
      cwd: v.optional(v.string()),
      exit_code: v.optional(v.number()),
      started_at: v.optional(v.number()),
      ended_at: v.optional(v.number()),
      duration_ms: v.optional(v.number()),
      created_at: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const evidence = await ctx.db.get(args.evidenceId);
    if (!evidence || evidence.user_id !== userId) return null;

    return {
      kind: evidence.kind,
      content: evidence.content,
      truncated: evidence.truncated,
      byte_size: evidence.byte_size,
      command: evidence.command,
      cwd: evidence.cwd,
      exit_code: evidence.exit_code,
      started_at: evidence.started_at,
      ended_at: evidence.ended_at,
      duration_ms: evidence.duration_ms,
      created_at: evidence.created_at,
    };
  },
});

/** Evidence recorded for one tool call, so a row can reopen its own output. */
export const getEvidenceForToolCall = query({
  args: { toolCallId: v.string() },
  returns: v.union(
    v.object({
      _id: v.id("evidence"),
      kind: v.string(),
      content: v.string(),
      truncated: v.optional(v.boolean()),
      byte_size: v.number(),
      exit_code: v.optional(v.number()),
      duration_ms: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const evidence = await ctx.db
      .query("evidence")
      .withIndex("by_tool_call_id", (q) =>
        q.eq("tool_call_id", args.toolCallId),
      )
      .order("desc")
      .first();

    if (!evidence || evidence.user_id !== userId) return null;

    return {
      _id: evidence._id,
      kind: evidence.kind,
      content: evidence.content,
      truncated: evidence.truncated,
      byte_size: evidence.byte_size,
      exit_code: evidence.exit_code,
      duration_ms: evidence.duration_ms,
    };
  },
});

/** A persisted checkpoint or tool step is not a finished assistant response. */
async function reconcileSavedOutcome(
  ctx: MutationCtx,
  run: Doc<"runs">,
): Promise<boolean> {
  const legacyMissingObservation =
    run.status === "disconnected" && run.stop_reason === "worker_not_found";
  if (
    (run.ended_at !== undefined && !legacyMissingObservation) ||
    !run.message_id
  )
    return false;
  const message = await ctx.db
    .query("messages")
    .withIndex("by_message_id", (q) => q.eq("id", run.message_id!))
    .first();
  if (
    !message ||
    message.user_id !== run.user_id ||
    message.chat_id !== run.chat_id ||
    message.role !== "assistant"
  )
    return false;
  const reason = message.finish_reason;
  if (
    !reason ||
    !["stop", "error", "length", "content-filter"].includes(reason)
  )
    return false;
  // A stale message reused by an older generation cannot finish this run.
  if (
    !Number.isFinite(message.update_time) ||
    message.update_time < run.started_at
  )
    return false;
  await ctx.db.patch(run._id, {
    status:
      message.stop_reason === "user"
        ? "cancelled"
        : reason === "error"
          ? "failed"
          : reason === "stop"
            ? "completed"
            : "completed_with_warnings",
    ended_at: message.update_time,
    finish_reason: reason,
    stop_reason: "persisted_outcome",
    ...(legacyMissingObservation ? { error: undefined } : {}),
    update_time: Date.now(),
  });
  return true;
}

/** Age selects candidates only. Live/unknown producers remain open. Paginate
 * the inventory so long-running rows cannot starve later completed records. */
export const reconcileStaleRuns = internalMutation({
  args: {
    cutoffMs: v.number(),
    limit: v.number(),
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    closedCount: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const openStatuses = new Set<string>(
      RUN_STATUSES.filter((status) => !RUN_STATUS_META[status].isTerminal),
    );
    const page = await ctx.db.query("runs").paginate({
      cursor: args.cursor ?? null,
      numItems: Math.max(1, Math.min(100, Math.floor(args.limit))),
    });
    let closedCount = 0;
    for (const run of page.page) {
      if (run.started_at >= args.cutoffMs || !openStatuses.has(run.status))
        continue;
      if (await reconcileSavedOutcome(ctx, run)) closedCount++;
    }
    return {
      closedCount,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

/** Repair a missing run outcome from its exact saved final assistant message.
 * This does not release execution claims or acknowledge remote cleanup. */
export const reconcileCompletedMessages = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    runIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    for (const id of args.runIds.slice(0, 60)) {
      const run = await ctx.db
        .query("runs")
        .withIndex("by_run_id", (q) => q.eq("id", id))
        .first();
      if (run?.user_id === args.userId) await reconcileSavedOutcome(ctx, run);
    }
    return null;
  },
});

/** Compatibility for older web bundles: a provider 404 cannot establish exit.
 * Only exact saved final evidence may close or repair this owned run. */
export const closeMissingWorker = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    chatId: v.string(),
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const run = await ctx.db
      .query("runs")
      .withIndex("by_run_id", (q) => q.eq("id", args.runId))
      .first();
    if (!run || run.user_id !== args.userId || run.chat_id !== args.chatId)
      return false;
    return reconcileSavedOutcome(ctx, run);
  },
});
