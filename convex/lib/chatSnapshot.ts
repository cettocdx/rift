import { v, type Infer } from "convex/values";
import type { Doc } from "../_generated/dataModel";

/** Same public shape for a backend read and a successful worker claim. */
export const chatSnapshotValidator = v.union(
  v.object({
    _id: v.id("chats"),
    _creationTime: v.number(),
    id: v.string(),
    title: v.string(),
    user_id: v.string(),
    finish_reason: v.optional(v.string()),
    active_stream_id: v.optional(v.string()),
    active_http_execution_id: v.optional(v.string()),
    canceled_at: v.optional(v.number()),
    default_model_slug: v.optional(
      v.union(v.literal("ask"), v.literal("agent"), v.literal("agent-long")),
    ),
    todos: v.optional(
      v.array(
        v.object({
          id: v.string(),
          content: v.string(),
          status: v.union(
            v.literal("pending"),
            v.literal("in_progress"),
            v.literal("completed"),
            v.literal("cancelled"),
          ),
          sourceMessageId: v.optional(v.string()),
        }),
      ),
    ),
    branched_from_chat_id: v.optional(v.string()),
    latest_summary_id: v.optional(v.id("chat_summaries")),
    share_id: v.optional(v.string()),
    share_date: v.optional(v.number()),
    update_time: v.number(),
    pinned_at: v.optional(v.number()),
    active_trigger_run_id: v.optional(v.string()),
    last_run_error: v.optional(v.string()),
    opencode_session_id: v.optional(v.string()),
    opencode_sandbox_id: v.optional(v.string()),
    sandbox_type: v.optional(v.string()),
    selected_model: v.optional(v.string()),
    purpose: v.optional(v.string()),
    console_session: v.optional(v.boolean()),
    project_id: v.optional(v.id("projects")),
    project_bot_id: v.optional(v.id("project_bots")),
    bot_meeting_id: v.optional(v.id("bot_meetings")),
  }),
  v.null(),
);
export type ChatSnapshot = Infer<typeof chatSnapshotValidator>;

export function toChatSnapshot(chat: Doc<"chats"> | null): ChatSnapshot {
  if (!chat) return null;
  // Cancellation intent is read through its dedicated backend API, not this public shape.
  const {
    codex_thread_id: _legacy,
    cancel_skip_save: _cancelIntent,
    ...snapshot
  } = chat;
  return snapshot;
}
