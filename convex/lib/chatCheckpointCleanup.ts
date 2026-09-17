import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";

// A checkpoint can approach 750KB. Keep each cleanup transaction well below
// Convex's read limit, including when inconsistent duplicate rows exist.
const CHECKPOINT_DELETE_BATCH_SIZE = 4;

type CheckpointOwner = { chatId: string; userId: string };

export async function scheduleChatCheckpointCleanup(
  ctx: MutationCtx,
  owner: CheckpointOwner,
): Promise<void> {
  await ctx.scheduler.runAfter(
    0,
    internal.chats.deleteChatCheckpointsBatch,
    owner,
  );
}

/** Called only after chat deletion authority is established. */
export async function deleteChatCheckpointBatch(
  ctx: MutationCtx,
  owner: CheckpointOwner,
): Promise<void> {
  const rows = await ctx.db
    .query("agent_checkpoints")
    .withIndex("by_chat_id", (q) => q.eq("chat_id", owner.chatId))
    .filter((q) => q.eq(q.field("user_id"), owner.userId))
    .take(CHECKPOINT_DELETE_BATCH_SIZE);
  for (const row of rows) await ctx.db.delete(row._id);
  if (rows.length === CHECKPOINT_DELETE_BATCH_SIZE) {
    await scheduleChatCheckpointCleanup(ctx, owner);
  }
}
