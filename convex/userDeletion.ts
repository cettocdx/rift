import { internalMutation, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { fileCountAggregate } from "./fileAggregate";
import { scheduleChatCheckpointCleanup } from "./lib/chatCheckpointCleanup";

/**
 * Delete all data for the authenticated user in correct dependency order.
 *
 * Deletion order (respects foreign key constraints):
 * 1) Feedback records (referenced by messages)
 * 2) Messages (owned by user, reference chats and files)
 * 3) Chats (owned by user)
 * 4) Task runs, tasks, then projects (dependency ordered and batched)
 * 5) Files + storage (owned by user, may be referenced by messages)
 *    - S3 files: Batch deleted using scheduled action
 *    - Convex storage files: Deleted directly
 * 6) Memories (owned by user)
 * 7) Notes (owned by user)
 * 8) User customization (owned by user)
 *
 * Uses parallel queries and deletions for optimal performance.
 * S3 cleanup is scheduled asynchronously and errors don't block user deletion.
 */

const OWNED_RECORD_DELETE_BATCH_SIZE = 100;

async function scheduleNextOwnedRecordBatch(
  ctx: MutationCtx,
  userId: string,
): Promise<void> {
  await ctx.scheduler.runAfter(
    0,
    internal.userDeletion.deleteTasksAndProjectsBatch,
    { userId },
  );
}

/**
 * Delete task runs before their tasks, and tasks before projects. Each query is
 * ownership-indexed and capped so an account with a long execution history
 * cannot exceed a Convex mutation's transaction limits.
 */
async function deleteTasksAndProjectsBatchForUser(
  ctx: MutationCtx,
  userId: string,
): Promise<void> {
  const taskRuns = await ctx.db
    .query("task_runs")
    .withIndex("by_user_and_started", (q) => q.eq("user_id", userId))
    .take(OWNED_RECORD_DELETE_BATCH_SIZE);
  await Promise.all(taskRuns.map((run) => ctx.db.delete(run._id)));
  if (taskRuns.length === OWNED_RECORD_DELETE_BATCH_SIZE) {
    await scheduleNextOwnedRecordBatch(ctx, userId);
    return;
  }

  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_user_and_updated", (q) => q.eq("user_id", userId))
    .take(OWNED_RECORD_DELETE_BATCH_SIZE);
  await Promise.all(tasks.map((task) => ctx.db.delete(task._id)));
  if (tasks.length === OWNED_RECORD_DELETE_BATCH_SIZE) {
    await scheduleNextOwnedRecordBatch(ctx, userId);
    return;
  }

  const meetings = await ctx.db
    .query("bot_meetings")
    .withIndex("by_user_project", (q) => q.eq("user_id", userId))
    .take(OWNED_RECORD_DELETE_BATCH_SIZE);
  await Promise.all(meetings.map((row) => ctx.db.delete(row._id)));
  if (meetings.length === OWNED_RECORD_DELETE_BATCH_SIZE) {
    await scheduleNextOwnedRecordBatch(ctx, userId);
    return;
  }
  const bots = await ctx.db
    .query("project_bots")
    .withIndex("by_user_project", (q) => q.eq("user_id", userId))
    .take(OWNED_RECORD_DELETE_BATCH_SIZE);
  await Promise.all(bots.map((row) => ctx.db.delete(row._id)));
  if (bots.length === OWNED_RECORD_DELETE_BATCH_SIZE) {
    await scheduleNextOwnedRecordBatch(ctx, userId);
    return;
  }

  const projects = await ctx.db
    .query("projects")
    .withIndex("by_user", (q) => q.eq("user_id", userId))
    .take(OWNED_RECORD_DELETE_BATCH_SIZE);
  await Promise.all(projects.map((project) => ctx.db.delete(project._id)));
  if (projects.length === OWNED_RECORD_DELETE_BATCH_SIZE) {
    await scheduleNextOwnedRecordBatch(ctx, userId);
  }
}

export const deleteTasksAndProjectsBatch = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await deleteTasksAndProjectsBatchForUser(ctx, args.userId);
    return null;
  },
});

export const deleteAllUserData = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized: User not authenticated");
    }

    try {
      // Fetch all user data in parallel using indexed queries
      const userId = user.subject.split("|")[0];
      const [chats, files, memories, notes, customization, messagesByUser] =
        await Promise.all([
          ctx.db
            .query("chats")
            .withIndex("by_user_and_updated", (q) => q.eq("user_id", userId))
            .collect(),
          ctx.db
            .query("files")
            .withIndex("by_user_id", (q) => q.eq("user_id", userId))
            .collect(),
          ctx.db
            .query("memories")
            .withIndex("by_user_and_update_time", (q) =>
              q.eq("user_id", userId),
            )
            .collect(),
          ctx.db
            .query("notes")
            .withIndex("by_user_and_updated", (q) => q.eq("user_id", userId))
            .collect(),
          ctx.db
            .query("user_customization")
            .withIndex("by_user_id", (q) => q.eq("user_id", userId))
            .first(),
          ctx.db
            .query("messages")
            .withIndex("by_user_id", (q) => q.eq("user_id", userId))
            .collect(),
        ]);

      // All user-owned messages (assistant/system messages also have user_id in this app)
      const allMessages = messagesByUser;

      // Step 1: Delete feedback records (no dependencies)
      const feedbackIds = allMessages
        .map((m) => m.feedback_id)
        .filter((id): id is NonNullable<typeof id> => !!id);

      await Promise.all(
        feedbackIds.map(async (feedbackId) => {
          try {
            await ctx.db.delete(feedbackId);
          } catch (error) {
            console.error(`Failed to delete feedback ${feedbackId}:`, error);
          }
        }),
      );

      // Step 2: Delete messages (now safe since feedback is gone)
      await Promise.all(
        allMessages.map(async (message) => {
          try {
            await ctx.db.delete(message._id);
          } catch (error) {
            console.error(`Failed to delete message ${message._id}:`, error);
          }
        }),
      );

      // Step 3: Delete chats (now safe since messages are gone)
      await Promise.all(
        chats.map(async (chat) => {
          try {
            // Checkpoint payloads are large; delete them in bounded internal
            // jobs whose authorization survives removal of the account.
            await scheduleChatCheckpointCleanup(ctx, {
              chatId: chat.id,
              userId,
            });
            await ctx.db.delete(chat._id);
          } catch (error) {
            console.error(`Failed to delete chat ${chat._id}:`, error);
          }
        }),
      );

      // Step 4: Delete dependent task runs, tasks, then projects. The first
      // bounded batch completes in this transaction; larger histories continue
      // through the internal mutation scheduled by the helper.
      await deleteTasksAndProjectsBatchForUser(ctx, userId);

      // Step 5: Delete files and storage blobs (safe since messages no longer reference them)

      // Collect S3 keys for batch deletion
      const s3Keys: string[] = [];

      await Promise.all(
        files.map(async (file) => {
          try {
            // Handle S3 files
            if (file.s3_key) {
              s3Keys.push(file.s3_key);
            }
            // Handle Convex storage files
            if (file.storage_id) {
              try {
                await ctx.storage.delete(file.storage_id);
              } catch (e) {
                console.warn(
                  "Failed to delete storage blob:",
                  file.storage_id,
                  e,
                );
              }
            }

            // Delete from aggregate
            await fileCountAggregate.deleteIfExists(ctx, file);

            // Delete database record
            await ctx.db.delete(file._id);
          } catch (error) {
            console.error(`Failed to delete file record ${file._id}:`, error);
          }
        }),
      );

      // Batch delete all S3 files for efficiency
      if (s3Keys.length > 0) {
        try {
          await ctx.scheduler.runAfter(
            0,
            internal.s3Cleanup.deleteS3ObjectsBatchAction,
            { s3Keys },
          );
          console.log(
            `Scheduled deletion of ${s3Keys.length} S3 objects for user ${userId}`,
          );
        } catch (error) {
          console.error("Failed to schedule S3 batch deletion:", error);
          // Don't fail user deletion on S3 cleanup errors
        }
      }

      // Step 6: Delete memories (independent of other data)
      await Promise.all(
        memories.map(async (memory) => {
          try {
            await ctx.db.delete(memory._id);
          } catch (error) {
            console.error(`Failed to delete memory ${memory._id}:`, error);
          }
        }),
      );

      // Step 7: Delete notes (independent of other data)
      await Promise.all(
        notes.map(async (note) => {
          try {
            await ctx.db.delete(note._id);
          } catch (error) {
            console.error(`Failed to delete note ${note._id}:`, error);
          }
        }),
      );

      // Step 8: Delete user customization (independent of other data)
      if (customization) {
        try {
          await ctx.db.delete(customization._id);
        } catch (error) {
          console.error(
            `Failed to delete user customization ${customization._id}:`,
            error,
          );
        }
      }

      return null;
    } catch (error) {
      console.error("Failed to delete user data:", error);
      throw new Error(
        "Account deletion failed. Please try again or contact support.",
      );
    }
  },
});
