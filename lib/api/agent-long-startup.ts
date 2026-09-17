type StartupCleanupStage = "cancel" | "clear" | "persist";

type FinalizeAgentLongStartupOptions = {
  createPublicToken: () => Promise<string>;
  persistActiveRun: () => Promise<unknown>;
  cancelTriggeredRun: () => Promise<unknown>;
  clearActiveRun?: () => Promise<unknown>;
  onCleanupError?: (stage: StartupCleanupStage, error: unknown) => void;
};

/**
 * Finish the two pieces of bookkeeping required after Trigger accepts a run.
 *
 * Triggering succeeds before the browser token and durable run mapping exist,
 * so both follow-ups race a run that is ALREADY executing and billing. What
 * happens when one fails is therefore a question about the user's work, and
 * the two failures do not deserve the same answer:
 *
 * MAPPING FAILED, TOKEN FINE -- recoverable, and killing the run is the worst
 * possible response. The task writes the same mapping itself as its first act
 * (see trigger/agent-long.ts), and this response still carries a token the
 * client can subscribe with right now. The run is handed over; the failure is
 * logged, not fatal. This used to cancel, which meant a transient Convex blip
 * destroyed work the user was paying for and had done nothing wrong to lose.
 *
 * TOKEN FAILED -- this response cannot be used to attach, and the client's
 * error path may start a replacement run. Two runs mutating one workspace is
 * worse than a lost one, so this remains a cancel. It is recoverable-ish (a
 * reload would resume through the task's own mapping), but not worth the risk
 * of a duplicate.
 */
export async function finalizeAgentLongStartup({
  createPublicToken,
  persistActiveRun,
  cancelTriggeredRun,
  clearActiveRun,
  onCleanupError,
}: FinalizeAgentLongStartupOptions): Promise<string> {
  const [tokenResult, persistenceResult] = await Promise.allSettled([
    Promise.resolve().then(createPublicToken),
    Promise.resolve().then(persistActiveRun),
  ]);

  if (tokenResult.status === "fulfilled") {
    if (persistenceResult.status === "rejected") {
      try {
        onCleanupError?.("persist", persistenceResult.reason);
      } catch {
        // Reporting must never turn a usable run into a failed request.
      }
    }
    return tokenResult.value;
  }

  const startupError = tokenResult.reason;

  try {
    await cancelTriggeredRun();
  } catch (error) {
    try {
      onCleanupError?.("cancel", error);
    } catch {
      // Cleanup reporting must never replace the original startup failure.
    }
    // Keep a successfully persisted mapping intact when cancellation was not
    // confirmed. The resume/cancel routes can still recover the run.
    throw startupError;
  }

  if (clearActiveRun) {
    try {
      await clearActiveRun();
    } catch (error) {
      try {
        onCleanupError?.("clear", error);
      } catch {
        // Cleanup reporting must never replace the original startup failure.
      }
    }
  }

  throw startupError;
}
