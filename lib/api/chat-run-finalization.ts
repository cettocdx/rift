import type { RunOutcomeStatus } from "@/lib/runs/run-outcome";

export interface ChatRunFinalizationInput {
  isAborted: boolean;
  hardTimedOut: boolean;
  approvalStopped: boolean;
  stoppedDueToElapsedTimeout: boolean;
  hasProviderError: boolean;
  finishReason?: string;
}

/** Shared by the original HTTP stream and its already-admitted fallback. */
export function resolveChatRunFinalization(input: ChatRunFinalizationInput): {
  status: RunOutcomeStatus;
  stopReason?: "user";
  finishReason?: string;
  wasPreemptiveTimeout: boolean;
} {
  const manuallyAborted = input.isAborted && !input.hardTimedOut;
  return {
    status: input.isAborted
      ? input.hardTimedOut
        ? "completed_with_warnings"
        : "cancelled"
      : input.hasProviderError
        ? "failed"
        : input.stoppedDueToElapsedTimeout && !input.approvalStopped
          ? "completed_with_warnings"
          : "completed",
    stopReason: manuallyAborted ? "user" : undefined,
    finishReason: manuallyAborted ? undefined : input.finishReason,
    wasPreemptiveTimeout: input.hardTimedOut,
  };
}
