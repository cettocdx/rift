import type { ChatPurpose } from "@/types";

export type AgentAutoContinueReason =
  | "context-limit"
  | "tool-calls"
  | "preemptive-timeout"
  | "timeout";

interface ResolveAgentAutoContinueReasonInput {
  purpose: ChatPurpose;
  temporary: boolean;
  finishReason?: string;
  stoppedDueToTokenExhaustion: boolean;
  stoppedDueToElapsedTimeout: boolean;
  hardTimedOut?: boolean;
  manuallyAborted?: boolean;
  terminalError?: boolean;
  approvalStopped?: boolean;
}

/**
 * Decide whether a completed Agent leg is safe to continue automatically.
 *
 * Tool/context continuation preserves the existing Agent behaviour. Wall-clock
 * continuation is deliberately Build-only: Studio and Hack runs can be costly
 * or externally sensitive, so a timeout there remains a user decision.
 */
export const resolveAgentAutoContinueReason = ({
  purpose,
  temporary,
  finishReason,
  stoppedDueToTokenExhaustion,
  stoppedDueToElapsedTimeout,
  hardTimedOut = false,
  manuallyAborted = false,
  terminalError = false,
  approvalStopped = false,
}: ResolveAgentAutoContinueReasonInput): AgentAutoContinueReason | null => {
  if (temporary || manuallyAborted || terminalError || approvalStopped)
    return null;

  const reachedTimeLimit =
    hardTimedOut ||
    stoppedDueToElapsedTimeout ||
    finishReason === "timeout" ||
    finishReason === "preemptive-timeout";

  if (reachedTimeLimit) {
    if (purpose !== "app") return null;
    return finishReason === "timeout" ? "timeout" : "preemptive-timeout";
  }

  if (stoppedDueToTokenExhaustion) return "context-limit";
  if (finishReason === "tool-calls") return "tool-calls";

  return null;
};
