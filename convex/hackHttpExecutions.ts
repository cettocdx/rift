import { v } from "convex/values";
import { hasPendingHackCleanup } from "./lib/hackRunCleanup";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { validateServiceKey } from "./lib/utils";
import {
  readAdmissionGate,
  isAdmissionGateBlocking,
} from "./lib/agentDispatchAdmission";
import {
  httpExecutionFailure as fail,
  readHttpExecution,
  readHttpExecutionHead,
  hasBlockingHttpExecution,
  type HttpOwner,
} from "./lib/hackHttpExecutions";

const ownerArgs = {
  serviceKey: v.string(),
  userId: v.string(),
  chatId: v.string(),
  executionId: v.string(),
};
type Owner = HttpOwner & { serviceKey: string };
const phase = v.union(
  v.literal("stopped"),
  v.literal("admitted"),
  v.literal("running"),
  v.literal("terminal"),
);
const statusValidator = v.object({
  executionId: v.string(),
  phase,
  stopped: v.boolean(),
  discard: v.boolean(),
  canceled: v.boolean(),
});
function status(row: Doc<"hack_http_executions">) {
  const stopped = row.stop_requested_at !== undefined;
  return {
    executionId: row.execution_id,
    phase: row.phase,
    stopped,
    discard: row.discard === true,
    canceled: stopped && (row.phase === "stopped" || row.phase === "terminal"),
  };
}
async function readOwned(ctx: { db: QueryCtx["db"] }, owner: Owner) {
  validateServiceKey(owner.serviceKey);
  for (const id of [owner.userId, owner.chatId, owner.executionId])
    if (!id || id.trim() !== id || id.length > 200)
      fail("INVALID_HTTP_EXECUTION");
  if (!/^[A-Za-z0-9._~-]{1,200}$/.test(owner.executionId))
    fail("INVALID_HTTP_EXECUTION");
  const chats = await ctx.db
    .query("chats")
    .withIndex("by_chat_id", (q) => q.eq("id", owner.chatId))
    .take(2);
  const claims = await ctx.db
    .query("agent_run_claims")
    .withIndex("by_chat_id", (q) => q.eq("chat_id", owner.chatId))
    .take(2);
  const head = await readHttpExecutionHead(ctx, owner.chatId);
  const gate = await readAdmissionGate(ctx, owner.chatId);
  if (chats.length > 1 || claims.length > 1) fail("HTTP_EXECUTION_CONFLICT");
  if (
    [chats[0], claims[0], head, gate].some(
      (row) => row && row.user_id !== owner.userId,
    ) ||
    (chats[0]?.purpose !== undefined && chats[0].purpose !== "security")
  )
    fail("FORBIDDEN");
  return {
    chat: chats[0],
    claim: claims[0],
    head,
    gate,
    row: await readHttpExecution(ctx, owner),
  };
}
function hasDurableProducer(current: Awaited<ReturnType<typeof readOwned>>) {
  return (
    (!!current.claim && current.claim.phase !== "released") ||
    isAdmissionGateBlocking(current.gate) ||
    current.chat?.active_trigger_run_id !== undefined
  );
}

/** Only admitted:true authorizes the original HTTP caller to execute and later
 * acknowledge cleanup. Duplicate IDs cannot launch or revive another producer. */
export const admit = mutation({
  args: ownerArgs,
  returns: v.object({
    admitted: v.boolean(),
    reason: v.optional(
      v.union(v.literal("stopped"), v.literal("duplicate"), v.literal("busy")),
    ),
    status: v.union(statusValidator, v.null()),
  }),
  handler: async (ctx, owner) => {
    const current = await readOwned(ctx, owner);
    if (current.row)
      return {
        admitted: false,
        reason:
          current.row.stop_requested_at !== undefined
            ? ("stopped" as const)
            : ("duplicate" as const),
        status: status(current.row),
      };
    if (
      hasDurableProducer(current) ||
      current.chat?.active_stream_id !== undefined ||
      current.chat?.active_http_execution_id !== undefined ||
      (await hasPendingHackCleanup(ctx, owner)) ||
      (await hasBlockingHttpExecution(ctx, owner))
    )
      return { admitted: false, reason: "busy" as const, status: null };
    const value = {
      user_id: owner.userId,
      chat_id: owner.chatId,
      execution_id: owner.executionId,
      phase: "admitted" as const,
      created_at: Date.now(),
      admitted_at: Date.now(),
    };
    const id = await ctx.db.insert("hack_http_executions", value);
    const head = {
      user_id: owner.userId,
      chat_id: owner.chatId,
      execution_id: owner.executionId,
    };
    if (current.head) await ctx.db.patch(current.head._id, head);
    else await ctx.db.insert("hack_http_execution_heads", head);
    return {
      admitted: true,
      status: status({ ...value, _id: id, _creationTime: value.created_at }),
    };
  },
});
export const markRunning = mutation({
  args: { ...ownerArgs, streamId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, owner) => {
    const current = await readOwned(ctx, owner);
    if (owner.streamId !== owner.executionId)
      fail("HTTP_STREAM_BINDING_CONFLICT");
    const { row, chat, head } = current;
    if (
      !chat ||
      !row ||
      head?.execution_id !== owner.executionId ||
      row.stop_requested_at !== undefined ||
      (row.phase !== "admitted" && row.phase !== "running") ||
      hasDurableProducer(current)
    )
      return false;
    const alreadyMapped =
      chat.active_stream_id === owner.executionId &&
      chat.active_http_execution_id === owner.executionId;
    if (row.phase === "running") return alreadyMapped;
    if (
      chat.active_stream_id !== undefined ||
      chat.active_http_execution_id !== undefined
    )
      return false;
    await ctx.db.patch(row._id, { phase: "running", running_at: Date.now() });
    await ctx.db.patch(chat._id, {
      active_stream_id: owner.executionId,
      active_http_execution_id: owner.executionId,
      update_time: Date.now(),
    });
    return true;
  },
});
export const getForBackend = query({
  args: ownerArgs,
  returns: v.union(statusValidator, v.null()),
  handler: async (ctx, owner) => {
    const { row } = await readOwned(ctx, owner);
    return row ? status(row) : null;
  },
});
/** Required acknowledgment from the admitted producer AFTER all finalization
 * and cleanup. A clock, disconnected reader, or Stop request is not this proof. */
export const finish = mutation({
  args: ownerArgs,
  returns: v.boolean(),
  handler: async (ctx, owner) => {
    const { row, chat, head } = await readOwned(ctx, owner);
    if (!row || row.phase === "stopped") return false;
    if (row.phase !== "terminal")
      await ctx.db.patch(row._id, {
        phase: "terminal",
        terminal_at: Date.now(),
      });
    if (
      head?.execution_id === owner.executionId &&
      chat?.active_stream_id === owner.executionId &&
      chat.active_http_execution_id === owner.executionId
    )
      await ctx.db.patch(chat._id, {
        active_stream_id: undefined,
        active_http_execution_id: undefined,
      });
    return true;
  },
});
export const stop = mutation({
  args: { ...ownerArgs, discard: v.optional(v.boolean()) },
  returns: statusValidator,
  handler: async (ctx, owner) => {
    const { row } = await readOwned(ctx, owner);
    const now = Date.now();
    const patch = {
      stop_requested_at: row?.stop_requested_at ?? now,
      discard: row?.discard === true || owner.discard === true,
    };
    let next: Doc<"hack_http_executions">;
    if (row) {
      await ctx.db.patch(row._id, patch);
      next = { ...row, ...patch };
    } else {
      const value = {
        user_id: owner.userId,
        chat_id: owner.chatId,
        execution_id: owner.executionId,
        phase: "stopped" as const,
        created_at: now,
        ...patch,
      };
      const id = await ctx.db.insert("hack_http_executions", value);
      next = { ...value, _id: id, _creationTime: now };
    }
    // Publish only this generation. Repeating Stop can retry a previously lost
    // Redis delivery; the durable record remains authoritative when Redis fails.
    await ctx.scheduler.runAfter(0, internal.redisPubsub.publishCancellation, {
      chatId: owner.chatId,
      executionId: owner.executionId,
      ...(next.discard ? { skipSave: true } : {}),
    });
    return status(next);
  },
});
