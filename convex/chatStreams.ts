import {
  hasBlockingHttpExecution,
  httpExecutionFailure,
} from "./lib/hackHttpExecutions";
import { cancelCurrentOwnedClaim } from "./lib/agentClaimCancellation";
import { hasPendingHackCleanup } from "./lib/hackRunCleanup";
import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { validateServiceKey } from "./lib/utils";
import { convexLogger } from "./lib/logger";

/**
 * Start a stream by setting active_stream_id and clearing canceled_at (backend only)
 * Atomic single mutation to avoid race with pre-clearing.
 */
export const startStream = mutation({
  args: {
    serviceKey: v.string(),
    chatId: v.string(),
    streamId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Verify service role key
    validateServiceKey(args.serviceKey);

    const chat = await ctx.db
      .query("chats")
      .withIndex("by_chat_id", (q) => q.eq("id", args.chatId))
      .first();

    if (!chat) {
      convexLogger.warn("chat_stream_start_chat_missing", {
        chat_id: args.chatId,
        stream_id: args.streamId,
      });
      return null;
    }

    if (
      (await hasPendingHackCleanup(ctx, {
        userId: chat.user_id,
        chatId: args.chatId,
      })) ||
      (await hasBlockingHttpExecution(ctx, {
        userId: chat.user_id,
        chatId: args.chatId,
      }))
    )
      return null;
    await ctx.db.patch(chat._id, {
      active_stream_id: args.streamId,
      active_http_execution_id: undefined,
      canceled_at: undefined,
      // The discard intent belongs to the cancellation being cleared here. Left
      // set, it would make the NEXT stop look like a regenerate and silently
      // throw away that run's partial output.
      cancel_skip_save: undefined,
      update_time: Date.now(),
    });

    return null;
  },
});

/**
 * Prepare chat for a new stream by clearing both active_stream_id and canceled_at (backend only)
 * Combines both operations in a single atomic mutation
 */
export const prepareForNewStream = mutation({
  args: {
    serviceKey: v.string(),
    chatId: v.string(),
    expectedTriggerRunId: v.optional(v.string()),
    expectedStreamId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Verify service role key
    validateServiceKey(args.serviceKey);

    const chat = await ctx.db
      .query("chats")
      .withIndex("by_chat_id", (q) => q.eq("id", args.chatId))
      .first();

    if (!chat) {
      convexLogger.warn("chat_stream_prepare_chat_missing", {
        chat_id: args.chatId,
      });
      return null;
    }

    if (
      args.expectedTriggerRunId !== undefined &&
      chat.active_trigger_run_id !== args.expectedTriggerRunId
    ) {
      return null;
    }

    if (args.expectedStreamId !== undefined) {
      if (chat.active_stream_id !== args.expectedStreamId) return null;
      // A finalizer or reconnect timeout cannot hide an admitted producer.
      // Its exact finish acknowledgment owns cleanup of these mappings.
      if (
        chat.active_http_execution_id === args.expectedStreamId &&
        (await hasBlockingHttpExecution(ctx, {
          userId: chat.user_id,
          chatId: args.chatId,
        }))
      )
        return null;
      await ctx.db.patch(chat._id, {
        active_stream_id: undefined,
        active_http_execution_id: undefined,
      });
      return null;
    }

    if (
      await hasBlockingHttpExecution(ctx, {
        userId: chat.user_id,
        chatId: args.chatId,
      })
    )
      return null;

    // Only patch if either field needs to be cleared.
    // Cleanup only — don't bump update_time; startStream already did that.
    if (
      chat.active_stream_id !== undefined ||
      chat.active_http_execution_id !== undefined ||
      chat.canceled_at !== undefined ||
      chat.cancel_skip_save !== undefined
    ) {
      await ctx.db.patch(chat._id, {
        active_stream_id: undefined,
        active_http_execution_id: undefined,
        canceled_at: undefined,
        cancel_skip_save: undefined,
      });
    }

    return null;
  },
});

/**
 * Cancel a stream from the client (with auth check)
 * Client-callable version of cancelStream
 */
export const cancelStreamFromClient = mutation({
  args: {
    chatId: v.string(),
    skipSave: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Authenticate user
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Unauthorized: User not authenticated",
      });
    }

    const chat = await ctx.db
      .query("chats")
      .withIndex("by_chat_id", (q) => q.eq("id", args.chatId))
      .first();

    if (!chat) {
      if (
        await hasBlockingHttpExecution(ctx, {
          userId: identity.subject.split("|")[0],
          chatId: args.chatId,
        })
      )
        httpExecutionFailure("EXACT_HTTP_STOP_REQUIRED");
      // A claim can precede persistence or outlive a deleted chat. Ownership
      // must still match before fencing that pending/active generation.
      await cancelCurrentOwnedClaim(ctx, {
        userId: identity.subject.split("|")[0],
        chatId: args.chatId,
      });
      return null;
    }

    // Verify ownership
    if (chat.user_id !== identity.subject.split("|")[0]) {
      throw new ConvexError({
        code: "ACCESS_DENIED",
        message: "Unauthorized: Chat does not belong to user",
      });
    }

    if (
      await hasBlockingHttpExecution(ctx, {
        userId: chat.user_id,
        chatId: args.chatId,
      })
    )
      httpExecutionFailure("EXACT_HTTP_STOP_REQUIRED");
    await cancelCurrentOwnedClaim(ctx, {
      userId: chat.user_id,
      chatId: args.chatId,
    });

    // Only patch if needed
    if (chat.active_stream_id !== undefined || chat.canceled_at === undefined) {
      await ctx.db.patch(chat._id, {
        active_stream_id: undefined,
        canceled_at: Date.now(),
        // The discard intent used to travel only over the Redis message below.
        // A dropped message left the producer unable to tell a plain Stop from
        // a regenerate, and it defaulted to discarding -- which threw away the
        // partial output the user had just watched stream in. Recording it here
        // makes the intent durable regardless of what Redis does.
        cancel_skip_save: args.skipSave === true ? true : undefined,
        finish_reason: undefined,
        update_time: Date.now(),
      });
    }

    // Keep cancellation on the checkpoint itself: a subsequent stream clears
    // chat.canceled_at, but must never revive a discarded or stopped operation.
    const checkpoint = await ctx.db
      .query("agent_checkpoints")
      .withIndex("by_chat_id", (q) => q.eq("chat_id", args.chatId))
      .first();
    if (
      checkpoint &&
      checkpoint.user_id === chat.user_id &&
      checkpoint.run_id === chat.active_trigger_run_id
    ) {
      await ctx.db.patch(checkpoint._id, {
        status: "finished",
        blocked_reason: "canceled",
        ...(args.skipSave === true ? { checkpoint: undefined } : {}),
        update_time: Date.now(),
      });
    }

    // Publish cancellation to Redis for instant backend notification
    // This runs async and doesn't block the mutation response
    await ctx.scheduler.runAfter(0, internal.redisPubsub.publishCancellation, {
      chatId: args.chatId,
      skipSave: args.skipSave,
    });

    return null;
  },
});

/**
 * Get only the cancellation status for a chat (backend only)
 * Optimized for stream cancellation checks
 */
export const getCancellationStatus = query({
  args: { serviceKey: v.string(), chatId: v.string() },
  returns: v.union(
    v.object({
      canceled_at: v.optional(v.number()),
      cancel_skip_save: v.optional(v.boolean()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    // Verify service role key
    validateServiceKey(args.serviceKey);

    try {
      const chat = await ctx.db
        .query("chats")
        .withIndex("by_chat_id", (q) => q.eq("id", args.chatId))
        .first();

      if (!chat) {
        return null;
      }

      return {
        canceled_at: chat.canceled_at,
        cancel_skip_save: chat.cancel_skip_save,
      };
    } catch (error) {
      console.error("Failed to get cancellation status:", error);
      return null;
    }
  },
});
