import { isRunStatus, runStatusMeta } from "@/lib/runs/run-status";

export type ConversationStatus =
  | "running"
  | "waiting"
  | "failed"
  | "warning"
  | "draft"
  | "disconnected";
export type ConversationRun = {
  id: string;
  chat_id: string;
  status: string;
  started_at: number;
  ended_at?: number;
};
export function conversationStatus(
  chat: {
    id: string;
    active_stream_id?: string;
    active_trigger_run_id?: string;
    update_time?: number;
  },
  run?: ConversationRun,
  hasDraft = false,
  now = Date.now(),
): ConversationStatus | undefined {
  // Chat and run subscriptions can arrive separately. A terminal result only
  // describes its own run: never apply a previous run to a replacement claim.
  const hasActivePointer = !!(
    chat.active_stream_id || chat.active_trigger_run_id
  );
  const matchingRun =
    run?.chat_id === chat.id &&
    (!hasActivePointer ||
      (!!chat.active_trigger_run_id && run.id === chat.active_trigger_run_id));
  if (!matchingRun) run = undefined;
  if (run?.status === "completed" || run?.status === "cancelled")
    return hasDraft ? "draft" : undefined;
  if (run?.status === "failed") return "failed";
  if (run?.status === "completed_with_warnings") return "warning";
  if (run?.status === "waiting_for_approval" && !run.ended_at) return "waiting";
  // A retained chat pointer must not override the run's connection state.
  // Elapsed task time is not a heartbeat: healthy long tasks remain running.
  if (run?.status === "disconnected" || run?.status === "degraded")
    return "disconnected";
  if (chat.active_stream_id || chat.active_trigger_run_id) {
    if (run?.ended_at) return hasDraft ? "draft" : "disconnected";
    if (!run && chat.update_time && now - chat.update_time > 75 * 60_000)
      return "disconnected";
    return "running";
  }
  if (
    run &&
    !run.ended_at &&
    isRunStatus(run.status) &&
    !runStatusMeta(run.status).isTerminal
  ) {
    if (run.status !== "draft") return "running";
  }
  return hasDraft ? "draft" : undefined;
}
export const CONVERSATION_STATUS_LABELS = {
  running: "Running",
  waiting: "Needs approval",
  failed: "Failed",
  warning: "Completed with warnings",
  draft: "Draft",
  disconnected: "Needs attention",
} as const;
