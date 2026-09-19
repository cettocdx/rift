import {
  PERSISTED_RUN_TIMEOUT_MESSAGE,
  PERSISTED_RUN_FAILURE_MESSAGE,
  PERSISTED_SANDBOX_FAILURE_MESSAGE,
  PERSISTED_MODEL_FAILURE_MESSAGE,
} from "./run-failure";
import {
  INTERRUPTED_RESPONSE_MESSAGE,
  LOST_AGENT_CONNECTION_MESSAGE,
  AGENT_WORKER_FAILED_MESSAGE,
} from "./interrupted-response";

const INTERRUPTED_WORK_MESSAGES: ReadonlySet<string> = new Set([
  INTERRUPTED_RESPONSE_MESSAGE,
  LOST_AGENT_CONNECTION_MESSAGE,
  AGENT_WORKER_FAILED_MESSAGE,
  PERSISTED_RUN_TIMEOUT_MESSAGE,
  PERSISTED_RUN_FAILURE_MESSAGE,
  PERSISTED_SANDBOX_FAILURE_MESSAGE,
  PERSISTED_MODEL_FAILURE_MESSAGE,
]);

/** A user-clicked retry of an uncertain action starts reconciliation, not replay. */
export function needsWorkReconciliation(error: Error | undefined): boolean {
  if (!error) return false;
  const message = typeof error.cause === "string" ? error.cause : error.message;
  return (
    INTERRUPTED_WORK_MESSAGES.has(message) ||
    /cannot be safely replayed|request was stopped|request has already finished|cannot be safely restored|cannot safely be restored|stream ended before a terminal response event/i.test(
      message,
    )
  );
}
export const RECONCILE_WORK_REQUEST =
  "Inspect the current files and saved results first, then continue the previous task from their actual state. The previous attempt ended. Keep completed work; do not blindly repeat earlier commands, file edits, or connected actions. If an action's outcome is uncertain, verify it before deciding the next step.";
