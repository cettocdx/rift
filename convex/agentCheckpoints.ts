import { ConvexError, v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { validateServiceKey } from "./lib/utils";
import { restoreCompletedStepCheckpoint } from "../lib/agent/checkpoint";

const ownerArgs = {
  serviceKey: v.string(),
  userId: v.string(),
  chatId: v.string(),
};
const runArgs = { ...ownerArgs, claimId: v.string(), runId: v.string() };
const checkpointValidator = v.object({
  version: v.literal(1),
  stepIndex: v.number(),
  finishReason: v.string(),
  messagesJson: v.string(),
});
const beginResult = v.object({
  status: v.union(
    v.literal("fresh"),
    v.literal("resume"),
    v.literal("blocked"),
  ),
  reason: v.optional(v.string()),
  checkpoint: v.union(v.null(), checkpointValidator),
  stepIndex: v.number(),
});

type Owner = { serviceKey: string; userId: string; chatId: string };
type Run = Owner & { claimId: string; runId: string };

async function readOwned(ctx: { db: QueryCtx["db"] }, args: Owner) {
  validateServiceKey(args.serviceKey);
  for (const id of [args.userId, args.chatId])
    if (!id || id.trim() !== id || id.length > 200)
      throw new Error("Invalid checkpoint identifier");
  const [chats, claims, checkpoints] = await Promise.all([
    ctx.db
      .query("chats")
      .withIndex("by_chat_id", (q) => q.eq("id", args.chatId))
      .take(2),
    ctx.db
      .query("agent_run_claims")
      .withIndex("by_chat_id", (q) => q.eq("chat_id", args.chatId))
      .take(2),
    ctx.db
      .query("agent_checkpoints")
      .withIndex("by_chat_id", (q) => q.eq("chat_id", args.chatId))
      .take(2),
  ]);
  if ([chats, claims, checkpoints].some((rows) => rows.length > 1))
    throw new ConvexError({
      code: "CHECKPOINT_CONFLICT",
      message: "Chat checkpoint is ambiguous",
    });
  if (
    [chats[0], claims[0], checkpoints[0]].some(
      (row) => row && row.user_id !== args.userId,
    )
  )
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "You do not own this chat",
    });
  return { chat: chats[0], claim: claims[0], row: checkpoints[0] };
}

type Owned = Awaited<ReturnType<typeof readOwned>>;
function isCurrent({ chat, claim }: Owned, args: Run) {
  return (
    !!chat &&
    claim?.phase === "active" &&
    claim.claim_id === args.claimId &&
    claim.run_id === args.runId &&
    chat.active_trigger_run_id === args.runId
  );
}
function isCanceled({ chat, claim }: Owned) {
  return (
    claim?.cancel_requested_at !== undefined ||
    chat?.canceled_at !== undefined ||
    chat?.cancel_skip_save === true
  );
}
function isWritable(state: Owned, args: Run) {
  return (
    isCurrent(state, args) &&
    !isCanceled(state) &&
    state.row?.status === "active" &&
    state.row.claim_id === args.claimId &&
    state.row.run_id === args.runId &&
    !state.row.blocked_reason
  );
}
const blocked = (reason: string, stepIndex = 0) => ({
  status: "blocked" as const,
  reason,
  checkpoint: null,
  stepIndex,
});

function hasSteeringState(row: Doc<"agent_checkpoints">) {
  // Intake writes the counter transactionally with the first receipt. Retain
  // this fence through disable/recovery even when no step has prepared it yet.
  // A future explicit ack/terminal API must retire this state after accounting
  // for every receipt; otherwise completed steering would lock later requests.
  return (
    row.steering_enabled === 1 ||
    row.steering_prepared_step !== undefined ||
    row.steering_next_sequence !== undefined
  );
}

const steeringInputValidator = v.object({
  id: v.id("agent_run_inputs"),
  sequence: v.number(),
  text: v.string(),
  afterResponseMessageCount: v.literal(0),
});

function steeringConflict(message: string): never {
  throw new ConvexError({ code: "STEERING_PREPARATION_CONFLICT", message });
}
function validIdentifier(value: string) {
  return !!value && value.trim() === value && value.length <= 200;
}
function validateBase(messagesJson: string) {
  // Reuse the checkpoint envelope's byte/closed-tool/approval validation; this
  // does not claim that this initial prefix is itself a completed model step.
  restoreCompletedStepCheckpoint({
    version: 1,
    stepIndex: 1,
    finishReason: "tool-calls",
    messagesJson,
  });
}
function steeringBase(row: Doc<"agent_checkpoints">, initial?: string) {
  if (row.checkpoint) {
    if (initial !== undefined) steeringConflict("Unexpected prepared base");
    const restored = restoreCompletedStepCheckpoint(row.checkpoint);
    if (!restored.resumeAllowed) steeringConflict("Checkpoint cannot continue");
    return row.checkpoint.messagesJson;
  }
  if (initial === undefined) steeringConflict("Missing prepared base");
  validateBase(initial);
  return initial;
}
async function readSteeringReceipts(
  ctx: { db: QueryCtx["db"] },
  row: Doc<"agent_checkpoints">,
  status: "pending" | "reserved",
) {
  return ctx.db
    .query("agent_run_inputs")
    .withIndex("by_request_status", (q) =>
      q
        .eq("user_id", row.user_id)
        .eq("chat_id", row.chat_id)
        .eq("request_message_id", row.request_message_id)
        .eq("request_hash", row.request_hash)
        .eq("status", status),
    )
    .order("asc")
    .take(11);
}
function validateReceipts(inputs: Doc<"agent_run_inputs">[]) {
  if (inputs.length > 10) steeringConflict("Too many steering receipts");
  let previousSequence = 0;
  for (const input of inputs) {
    if (
      !Number.isSafeInteger(input.sequence) ||
      input.sequence <= previousSequence ||
      !validIdentifier(input.claim_id) ||
      !validIdentifier(input.run_id) ||
      !validIdentifier(input.client_request_id) ||
      !/^[a-f0-9]{64}$/.test(input.payload_hash) ||
      !input.text.trim() ||
      new TextEncoder().encode(input.text).byteLength > 16 * 1024
    )
      steeringConflict("Invalid steering receipt");
    previousSequence = input.sequence;
  }
}
async function readPreparedSteering(
  ctx: { db: QueryCtx["db"] },
  row: Doc<"agent_checkpoints">,
) {
  const prepared = row.steering_prepared_step!;
  if (
    !Number.isSafeInteger(prepared.step_index) ||
    prepared.step_index !== (row.checkpoint?.stepIndex ?? 0) + 1 ||
    row.in_flight_step_index !== prepared.step_index ||
    !validIdentifier(prepared.claim_id) ||
    !validIdentifier(prepared.run_id)
  )
    steeringConflict("Invalid prepared step");
  const baseMessagesJson = steeringBase(row, prepared.initial_messages_json);
  const inputs = await readSteeringReceipts(ctx, row, "reserved");
  validateReceipts(inputs);
  if (
    inputs.length !== prepared.input_ids.length ||
    inputs.some(
      (input, index) =>
        input._id !== prepared.input_ids[index] ||
        input.reserved_step_index !== prepared.step_index ||
        input.after_response_message_count !== 0 ||
        input.applied_step_index !== undefined,
    )
  )
    steeringConflict("Prepared steering receipt set changed");
  return { baseMessagesJson, inputs };
}
function preparationResult(
  stepIndex: number,
  baseMessagesJson: string,
  inputs: Doc<"agent_run_inputs">[],
) {
  return {
    stepIndex,
    baseMessagesJson,
    inputs: inputs.map((input) => ({
      id: input._id,
      sequence: input.sequence,
      text: input.text,
      afterResponseMessageCount: 0 as const,
    })),
  };
}

/**
 * Disabled-runtime primitive: freeze FIFO membership and the execution fence in
 * one mutation, even for zero inputs. Future transcript/ack integration rebases
 * each step onto its completed checkpoint and inserts here at response offset 0;
 * it must slice the SDK's cumulative tail before appending that step's delta.
 * No existing save/finish path may acknowledge or discard this reservation.
 */
export const prepareSteeringStep = mutation({
  args: {
    ...runArgs,
    requestMessageId: v.string(),
    requestHash: v.string(),
    stepIndex: v.number(),
    initialMessagesJson: v.optional(v.string()),
  },
  returns: v.object({
    stepIndex: v.number(),
    baseMessagesJson: v.string(),
    inputs: v.array(steeringInputValidator),
  }),
  handler: async (ctx, args) => {
    if (!args.serviceKey) throw new Error("Unauthorized: Invalid service key");
    const state = await readOwned(ctx, args);
    if (!isCurrent(state, args)) steeringConflict("Steering claim lost");
    if (isCanceled(state)) steeringConflict("Steering canceled");
    if (!isWritable(state, args))
      steeringConflict("Steering checkpoint unavailable");
    const row = state.row!;
    if (
      !validIdentifier(args.claimId) ||
      !validIdentifier(args.runId) ||
      !validIdentifier(args.requestMessageId) ||
      !/^[a-f0-9]{64}$/.test(args.requestHash) ||
      row.request_message_id !== args.requestMessageId ||
      row.request_hash !== args.requestHash
    )
      steeringConflict("Steering original request mismatch");
    if (row.execution_tracking !== 1)
      steeringConflict("Steering preparation disabled");
    if (
      !Number.isSafeInteger(args.stepIndex) ||
      args.stepIndex !== (row.checkpoint?.stepIndex ?? 0) + 1 ||
      (row.executing_step_index ?? 0) >= args.stepIndex
    )
      steeringConflict("Unsafe steering step");
    if (row.steering_prepared_step) {
      const prepared = await readPreparedSteering(ctx, row);
      if (
        args.initialMessagesJson !== undefined &&
        args.initialMessagesJson !==
          row.steering_prepared_step.initial_messages_json
      )
        steeringConflict("Changed prepared base");
      return preparationResult(
        args.stepIndex,
        prepared.baseMessagesJson,
        prepared.inputs,
      );
    }
    if (row.steering_enabled !== 1)
      steeringConflict("Steering preparation disabled");
    if (row.in_flight_step_index !== undefined)
      steeringConflict("Unprepared in-flight step");
    const baseMessagesJson = steeringBase(row, args.initialMessagesJson);
    const [inputs, reserved] = await Promise.all([
      readSteeringReceipts(ctx, row, "pending"),
      readSteeringReceipts(ctx, row, "reserved"),
    ]);
    validateReceipts(inputs);
    if (
      reserved.length ||
      inputs.some(
        (input) =>
          input.reserved_step_index !== undefined ||
          input.after_response_message_count !== undefined ||
          input.applied_step_index !== undefined,
      )
    )
      steeringConflict("Unexpected reserved steering receipt");
    // Admission is by current checkpoint authority plus immutable logical
    // request, not the receipt's physical run: safe recovery retains old intake.
    for (const input of inputs)
      await ctx.db.patch(input._id, {
        status: "reserved",
        reserved_step_index: args.stepIndex,
        after_response_message_count: 0,
      });
    await ctx.db.patch(row._id, {
      in_flight_step_index: args.stepIndex,
      steering_prepared_step: {
        step_index: args.stepIndex,
        claim_id: args.claimId,
        run_id: args.runId,
        input_ids: inputs.map((input) => input._id),
        ...(row.checkpoint ? {} : { initial_messages_json: baseMessagesJson }),
      },
      update_time: Date.now(),
    });
    return preparationResult(args.stepIndex, baseMessagesJson, inputs);
  },
});

export const beginRun = mutation({
  args: {
    ...runArgs,
    requestMessageId: v.string(),
    requestHash: v.string(),
    model: v.string(),
    executionTracking: v.optional(v.literal(1)),
    // Allows preservation of a previously prepared step; does not enable intake.
    steeringPreparation: v.optional(v.literal(1)),
  },
  returns: beginResult,
  handler: async (ctx, args) => {
    const state = await readOwned(ctx, args);
    if (!isCurrent(state, args)) return blocked("claim-lost");
    if (isCanceled(state)) return blocked("canceled");
    if (
      !args.requestMessageId ||
      !/^[a-f0-9]{64}$/.test(args.requestHash) ||
      args.requestMessageId.length > 200 ||
      !args.model ||
      args.model.length > 300
    )
      throw new Error("Invalid checkpoint request");
    const { row } = state;
    if (
      row?.request_message_id === args.requestMessageId &&
      row.request_hash === args.requestHash &&
      row.blocked_reason === "canceled"
    )
      return blocked("canceled");
    if (
      row?.request_message_id === args.requestMessageId &&
      row.request_hash === args.requestHash &&
      row.status === "finished"
    )
      return blocked("already-finished", row.checkpoint?.stepIndex ?? 0);
    const sameRequest =
      row?.request_message_id === args.requestMessageId &&
      row.request_hash === args.requestHash &&
      row.status === "active";
    if (
      row &&
      hasSteeringState(row) &&
      (!sameRequest ||
        args.steeringPreparation !== 1 ||
        args.executionTracking !== 1)
    )
      return blocked(
        row.steering_prepared_step ? "steering-prepared" : "steering-pending",
        row.checkpoint?.stepIndex ?? 0,
      );
    if (sameRequest && row.model !== args.model)
      return blocked("model-changed", row.checkpoint?.stepIndex ?? 0);
    const completedStep = sameRequest ? (row.checkpoint?.stepIndex ?? 0) : 0;
    const resumeReason = sameRequest
      ? (row.blocked_reason ??
        ((row.in_flight_step_index ?? 0) > completedStep &&
        (row.execution_tracking !== 1 ||
          args.executionTracking !== 1 ||
          (row.executing_step_index ?? 0) > completedStep)
          ? "in-flight-step"
          : undefined))
      : undefined;
    // Keep uncertainty durable even if beginRun is retried after rebinding.
    if (resumeReason) {
      await ctx.db.patch(row!._id, {
        claim_id: args.claimId,
        run_id: args.runId,
        blocked_reason: resumeReason,
        update_time: Date.now(),
      });
      return blocked(resumeReason, completedStep);
    }
    if (sameRequest && row.run_id === args.runId)
      return blocked("run-already-started", row.checkpoint?.stepIndex ?? 0);
    const checkpoint = sameRequest ? (row.checkpoint ?? null) : null;
    if (checkpoint) {
      const restored = restoreCompletedStepCheckpoint(checkpoint);
      if (!restored.resumeAllowed)
        return blocked(restored.reason, completedStep);
      // A duplicate worker for an already used run must not replay its history.
      if (row!.run_id === args.runId)
        return blocked("run-already-started", completedStep);
    }
    if (row?.steering_prepared_step) await readPreparedSteering(ctx, row);
    const next = {
      user_id: args.userId,
      chat_id: args.chatId,
      claim_id: args.claimId,
      run_id: args.runId,
      request_message_id: args.requestMessageId,
      request_hash: args.requestHash,
      model: args.model,
      execution_tracking: args.executionTracking,
      // Receipt admission is a capability of the admitted worker, never a
      // sticky property of the chat. Runtime steering is not enabled by this
      // legacy entry point; a future complete integration must opt in anew.
      steering_enabled: undefined,
      steering_next_sequence: sameRequest
        ? row?.steering_next_sequence
        : undefined,
      status: "active" as const,
      checkpoint: checkpoint ?? undefined,
      steering_prepared_step: sameRequest
        ? row?.steering_prepared_step
        : undefined,
      in_flight_step_index:
        sameRequest && row?.steering_prepared_step
          ? row.in_flight_step_index
          : undefined,
      executing_step_index: undefined,
      blocked_reason: undefined,
      update_time: Date.now(),
    };
    if (row) await ctx.db.patch(row._id, next);
    else await ctx.db.insert("agent_checkpoints", next);
    return {
      status: checkpoint ? ("resume" as const) : ("fresh" as const),
      checkpoint,
      stepIndex: checkpoint?.stepIndex ?? 0,
    };
  },
});

export const markStep = mutation({
  args: { ...runArgs, stepIndex: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const state = await readOwned(ctx, args);
    if (!isWritable(state, args)) return false;
    const row = state.row!;
    if (hasSteeringState(row)) return false;
    if (
      !Number.isSafeInteger(args.stepIndex) ||
      args.stepIndex !== (row.checkpoint?.stepIndex ?? 0) + 1
    )
      return false;
    if (row.in_flight_step_index !== undefined)
      return row.in_flight_step_index === args.stepIndex;
    await ctx.db.patch(row._id, {
      in_flight_step_index: args.stepIndex,
      update_time: Date.now(),
    });
    return true;
  },
});

/** Durable barrier immediately before an approved tool can perform any work. */
export const markExecution = mutation({
  args: { ...runArgs, stepIndex: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const state = await readOwned(ctx, args);
    if (
      !isWritable(state, args) ||
      state.row!.execution_tracking !== 1 ||
      (hasSteeringState(state.row!) && !state.row!.steering_prepared_step) ||
      !Number.isSafeInteger(args.stepIndex) ||
      state.row!.in_flight_step_index !== args.stepIndex ||
      args.stepIndex !== (state.row!.checkpoint?.stepIndex ?? 0) + 1
    )
      return false;
    await ctx.db.patch(state.row!._id, {
      executing_step_index: args.stepIndex,
      update_time: Date.now(),
    });
    return true;
  },
});

export const saveStep = mutation({
  args: { ...runArgs, checkpoint: checkpointValidator },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const state = await readOwned(ctx, args);
    if (!isWritable(state, args)) return false;
    if (hasSteeringState(state.row!)) return false;
    restoreCompletedStepCheckpoint(args.checkpoint);
    const row = state.row!;
    const previous = row.checkpoint;
    if (previous?.stepIndex === args.checkpoint.stepIndex)
      return (
        previous.version === args.checkpoint.version &&
        previous.finishReason === args.checkpoint.finishReason &&
        previous.messagesJson === args.checkpoint.messagesJson
      );
    if (
      args.checkpoint.stepIndex !== (previous?.stepIndex ?? 0) + 1 ||
      row.in_flight_step_index !== args.checkpoint.stepIndex
    )
      return false;
    await ctx.db.patch(row._id, {
      checkpoint: args.checkpoint,
      in_flight_step_index: undefined,
      executing_step_index: undefined,
      update_time: Date.now(),
    });
    return true;
  },
});

export const disableRun = mutation({
  args: {
    ...runArgs,
    reason: v.optional(
      v.union(v.literal("checkpoint-too-large"), v.literal("model-changed")),
    ),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const state = await readOwned(ctx, args);
    if (
      !isCurrent(state, args) ||
      isCanceled(state) ||
      state.row?.status !== "active" ||
      state.row.claim_id !== args.claimId ||
      state.row.run_id !== args.runId
    )
      return false;
    const reason = args.reason ?? "checkpoint-too-large";
    if (state.row.blocked_reason) return state.row.blocked_reason === reason;
    await ctx.db.patch(state.row._id, {
      blocked_reason: reason,
      steering_enabled: undefined,
      update_time: Date.now(),
    });
    return true;
  },
});

export const finishRun = mutation({
  args: { ...runArgs, discard: v.optional(v.boolean()) },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const state = await readOwned(ctx, args);
    if (
      !isCurrent(state, args) ||
      state.row?.claim_id !== args.claimId ||
      state.row.run_id !== args.runId
    )
      return false;
    if (hasSteeringState(state.row)) return false;
    const discard =
      args.discard === true || state.chat?.cancel_skip_save === true;
    await ctx.db.patch(state.row._id, {
      status: "finished",
      steering_enabled: undefined,
      ...(discard || isCanceled(state) ? { blocked_reason: "canceled" } : {}),
      ...(discard ? { checkpoint: undefined } : {}),
      update_time: Date.now(),
    });
    return true;
  },
});

export const getForBackend = query({
  args: ownerArgs,
  handler: async (ctx, args) => {
    const { row } = await readOwned(ctx, args);
    return row
      ? {
          runId: row.run_id,
          requestMessageId: row.request_message_id,
          requestHash: row.request_hash,
          model: row.model,
          status: row.status,
          checkpoint: row.checkpoint ?? null,
          inFlightStepIndex: row.in_flight_step_index,
          blockedReason: row.blocked_reason,
        }
      : null;
  },
});
