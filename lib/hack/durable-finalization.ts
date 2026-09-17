import type { AgentStreamState } from "@/lib/api/agent-stream-runner";
import { resolveRunOutcome, type RunOutcome } from "@/lib/runs/run-outcome";

type FinishState = Pick<
  AgentStreamState,
  | "providerError"
  | "streamFinishReason"
  | "stoppedDueToElapsedTimeout"
  | "stoppedDueToDoomLoop"
  | "stoppedDueToBudgetExhaustion"
  | "stoppedDueToTokenExhaustion"
>;

/** An SDK abort alone is not evidence that a person pressed Stop. */
export function resolveHackRunFinalization(input: {
  state: FinishState;
  isAborted: boolean;
  manualStop: boolean;
}): { finishReason: string | undefined; outcome: RunOutcome } {
  const { state, isAborted } = input;
  const manuallyAborted = isAborted && input.manualStop;
  const knownCutoff =
    state.stoppedDueToElapsedTimeout ||
    state.stoppedDueToDoomLoop ||
    state.stoppedDueToBudgetExhaustion ||
    state.stoppedDueToTokenExhaustion;
  const internalFailure =
    !manuallyAborted &&
    !knownCutoff &&
    (state.providerError !== undefined ||
      state.streamFinishReason === "error" ||
      isAborted);
  const finishReason = manuallyAborted
    ? undefined
    : internalFailure
      ? "error"
      : state.streamFinishReason;
  return {
    finishReason,
    outcome: internalFailure
      ? {
          status: "failed",
          reasonLine: "The assessment stopped after an execution error.",
        }
      : resolveRunOutcome({
          isAborted,
          manuallyAborted,
          stoppedDueToElapsedTimeout: state.stoppedDueToElapsedTimeout,
          stoppedDueToDoomLoop: state.stoppedDueToDoomLoop,
          stoppedDueToBudgetExhaustion: state.stoppedDueToBudgetExhaustion,
          stoppedDueToTokenExhaustion: state.stoppedDueToTokenExhaustion,
          terminalProviderError: false,
          finishReason,
        }),
  };
}

/** A Trigger abort can be platform-originated. Only the exact durable claim
 * establishes a user Stop; a failed/slow read cannot establish its actor. */
export async function readHackCancellationEvidence(
  binding: { userId: string; chatId: string; claimId: string; runId: string },
  read: () => Promise<unknown>,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const claim = await Promise.race([
      read(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 1000);
      }),
    ]);
    if (!claim || typeof claim !== "object") return false;
    const value = claim as Record<string, unknown>;
    return (
      value.userId === binding.userId &&
      value.chatId === binding.chatId &&
      value.claimId === binding.claimId &&
      value.runId === binding.runId &&
      typeof value.cancelRequestedAt === "number" &&
      Number.isFinite(value.cancelRequestedAt)
    );
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
