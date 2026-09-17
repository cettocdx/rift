import { ConvexError, v, type Infer } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { validateServiceKey } from "./lib/utils";

const MAX_TEXT_BYTES = 16 * 1024;
const MAX_PENDING_INPUTS = 10;
const ownerArgs = {
  serviceKey: v.string(),
  userId: v.string(),
  chatId: v.string(),
};
const receiptValidator = v.object({
  id: v.id("agent_run_inputs"),
  clientRequestId: v.string(),
  requestMessageId: v.string(),
  claimId: v.string(),
  runId: v.string(),
  sequence: v.number(),
  status: v.union(
    v.literal("pending"),
    v.literal("reserved"),
    v.literal("applied"),
    v.literal("undelivered"),
  ),
  acceptedAt: v.number(),
  reservedStepIndex: v.optional(v.number()),
  afterResponseMessageCount: v.optional(v.number()),
  appliedStepIndex: v.optional(v.number()),
});
export type AgentRunInputReceipt = Infer<typeof receiptValidator>;
type Owner = { serviceKey: string; userId: string; chatId: string };
const fail = (code: string, message: string): never => {
  throw new ConvexError({ code, message });
};
function requireIdentifier(value: string) {
  if (!value || value.trim() !== value || value.length > 200) {
    fail("INVALID_STEERING_INPUT", "Invalid steering identifier");
  }
}
function requireHash(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value))
    fail("INVALID_STEERING_INPUT", "Invalid steering hash");
}

async function readOwned(ctx: { db: QueryCtx["db"] }, args: Owner) {
  if (!args.serviceKey)
    fail("UNAUTHORIZED", "Unauthorized: Invalid service key");
  validateServiceKey(args.serviceKey);
  requireIdentifier(args.userId);
  requireIdentifier(args.chatId);
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
  if ([chats, claims, checkpoints].some((rows) => rows.length > 1)) {
    fail("STEERING_CONFLICT", "Chat steering authority is ambiguous");
  }
  if (
    [chats[0], claims[0], checkpoints[0]].some(
      (row) => row && row.user_id !== args.userId,
    )
  ) {
    fail("FORBIDDEN", "You do not own this chat");
  }
  return { chat: chats[0], claim: claims[0], checkpoint: checkpoints[0] };
}

async function readReceipt(
  ctx: { db: QueryCtx["db"] },
  args: Owner & { clientRequestId: string },
) {
  requireIdentifier(args.clientRequestId);
  const rows = await ctx.db
    .query("agent_run_inputs")
    .withIndex("by_owner_chat_client_request", (q) =>
      q
        .eq("user_id", args.userId)
        .eq("chat_id", args.chatId)
        .eq("client_request_id", args.clientRequestId),
    )
    .take(2);
  if (rows.length > 1)
    fail("STEERING_CONFLICT", "Steering receipt is ambiguous");
  return rows[0];
}
function publicReceipt(row: Doc<"agent_run_inputs">): AgentRunInputReceipt {
  return {
    id: row._id,
    clientRequestId: row.client_request_id,
    requestMessageId: row.request_message_id,
    claimId: row.claim_id,
    runId: row.run_id,
    sequence: row.sequence,
    status: row.status,
    acceptedAt: row.accepted_at,
    ...(row.reserved_step_index !== undefined
      ? { reservedStepIndex: row.reserved_step_index }
      : {}),
    ...(row.after_response_message_count !== undefined
      ? { afterResponseMessageCount: row.after_response_message_count }
      : {}),
    ...(row.applied_step_index !== undefined
      ? { appliedStepIndex: row.applied_step_index }
      : {}),
  };
}

/** Service-only intake. The future HTTP route must moderate before calling. */
export const enqueueForBackend = mutation({
  args: {
    ...ownerArgs,
    requestMessageId: v.string(),
    requestHash: v.string(),
    claimId: v.string(),
    runId: v.string(),
    clientRequestId: v.string(),
    payloadHash: v.string(),
    text: v.string(),
  },
  returns: receiptValidator,
  handler: async (ctx, args): Promise<AgentRunInputReceipt> => {
    const { chat, claim, checkpoint } = await readOwned(ctx, args);
    for (const id of [
      args.requestMessageId,
      args.claimId,
      args.runId,
      args.clientRequestId,
    ])
      requireIdentifier(id);
    requireHash(args.requestHash);
    requireHash(args.payloadHash);
    if (!args.text.trim())
      fail("INVALID_STEERING_INPUT", "Invalid steering text");
    if (new TextEncoder().encode(args.text).byteLength > MAX_TEXT_BYTES)
      fail("STEERING_LIMIT", "Steering text exceeds the byte limit");

    // Retry before live admission: the original receipt remains readable even
    // when that exact target has finished, been canceled, or been replaced.
    const existing = await readReceipt(ctx, args);
    if (existing) {
      if (
        existing.payload_hash !== args.payloadHash ||
        existing.text !== args.text ||
        existing.request_message_id !== args.requestMessageId ||
        existing.request_hash !== args.requestHash ||
        existing.claim_id !== args.claimId ||
        existing.run_id !== args.runId
      ) {
        fail("STEERING_CONFLICT", "Steering idempotency conflict");
      }
      return publicReceipt(existing);
    }
    if (
      !chat ||
      claim?.phase !== "active" ||
      claim.claim_id !== args.claimId ||
      claim.run_id !== args.runId ||
      chat.active_trigger_run_id !== args.runId ||
      checkpoint?.status !== "active" ||
      checkpoint.claim_id !== args.claimId ||
      checkpoint.run_id !== args.runId ||
      checkpoint.request_message_id !== args.requestMessageId ||
      checkpoint.request_hash !== args.requestHash
    ) {
      fail(
        "STEERING_RUN_UNAVAILABLE",
        "The observed steering target is not active",
      );
    }
    if (
      claim.cancel_requested_at !== undefined ||
      chat.canceled_at !== undefined ||
      chat.cancel_skip_save === true
    ) {
      fail("STEERING_CANCELED", "The steering target is canceled");
    }
    if (
      checkpoint.execution_tracking !== 1 ||
      checkpoint.steering_enabled !== 1 ||
      checkpoint.blocked_reason
    ) {
      fail(
        "STEERING_DISABLED",
        "This worker does not support durable steering",
      );
    }
    const [latest, pending, reserved] = await Promise.all([
      ctx.db
        .query("agent_run_inputs")
        .withIndex("by_request_sequence", (q) =>
          q
            .eq("user_id", args.userId)
            .eq("chat_id", args.chatId)
            .eq("request_message_id", args.requestMessageId)
            .eq("request_hash", args.requestHash),
        )
        .order("desc")
        .take(2),
      ctx.db
        .query("agent_run_inputs")
        .withIndex("by_request_status", (q) =>
          q
            .eq("user_id", args.userId)
            .eq("chat_id", args.chatId)
            .eq("request_message_id", args.requestMessageId)
            .eq("request_hash", args.requestHash)
            .eq("status", "pending"),
        )
        .take(MAX_PENDING_INPUTS),
      ctx.db
        .query("agent_run_inputs")
        .withIndex("by_request_status", (q) =>
          q
            .eq("user_id", args.userId)
            .eq("chat_id", args.chatId)
            .eq("request_message_id", args.requestMessageId)
            .eq("request_hash", args.requestHash)
            .eq("status", "reserved"),
        )
        .take(MAX_PENDING_INPUTS),
    ]);
    const sequence = checkpoint.steering_next_sequence ?? 1;
    if (
      !Number.isSafeInteger(sequence) ||
      sequence < 1 ||
      !Number.isSafeInteger(sequence + 1) ||
      (latest[0]
        ? checkpoint.steering_next_sequence === undefined ||
          !Number.isSafeInteger(latest[0].sequence) ||
          latest[0].sequence < 1 ||
          sequence !== latest[0].sequence + 1
        : sequence !== 1) ||
      (latest.length > 1 && latest[0].sequence === latest[1].sequence)
    ) {
      fail("STEERING_CONFLICT", "Steering sequence counter is inconsistent");
    }
    if (pending.length + reserved.length >= MAX_PENDING_INPUTS)
      fail("STEERING_LIMIT", "The steering inbox is full");

    const value = {
      user_id: args.userId,
      chat_id: args.chatId,
      request_message_id: args.requestMessageId,
      request_hash: args.requestHash,
      claim_id: args.claimId,
      run_id: args.runId,
      client_request_id: args.clientRequestId,
      payload_hash: args.payloadHash,
      text: args.text,
      sequence,
      status: "pending" as const,
      accepted_at: Date.now(),
    };
    // Indexed reads, receipt insert and counter advance share one Convex
    // mutation transaction. Concurrent arrivals conflict/retry in the database.
    const id = await ctx.db.insert("agent_run_inputs", value);
    await ctx.db.patch(checkpoint._id, {
      steering_next_sequence: sequence + 1,
    });
    return publicReceipt({
      ...value,
      _id: id,
      _creationTime: value.accepted_at,
    });
  },
});

/** Status only: no transcript text or credentials leave this owner-scoped read. */
export const getForBackend = query({
  args: { ...ownerArgs, clientRequestId: v.string() },
  returns: v.union(v.null(), receiptValidator),
  handler: async (ctx, args): Promise<AgentRunInputReceipt | null> => {
    await readOwned(ctx, args);
    const row = await readReceipt(ctx, args);
    return row ? publicReceipt(row) : null;
  },
});
