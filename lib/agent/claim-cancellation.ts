export type CanceledClaimBinding = Readonly<{
  userId: string;
  chatId: string;
  claimId: string;
  runId?: string;
}>;

/** Only authoritative cancellation evidence should construct this error. */
export class AgentRunCanceledError extends Error {
  readonly name = "AgentRunCanceledError";
  readonly claim?: CanceledClaimBinding;
  constructor(claim?: CanceledClaimBinding) {
    super("This agent run was stopped.");
    this.claim = claim ? Object.freeze({ ...claim }) : undefined;
  }
}

type TerminalStatus = "succeeded" | "failed" | "canceled";

/** Latch expected Stop before it reaches the SDK's automatic error encoder. */
export function createWorkerClaimCancellation() {
  let stopped = false;
  let releaseBinding: CanceledClaimBinding | undefined;
  return {
    handle(
      error: unknown,
      writer?: { write(part: { type: "abort" }): void },
      triggerSignal?: AbortSignal,
    ) {
      const typed = error instanceof AgentRunCanceledError;
      // throwIfAborted preserves this exact reason. A similar name/message is not proof.
      if (!typed && !(triggerSignal?.aborted && error === triggerSignal.reason))
        return false;
      stopped = true;
      if (typed && error.claim) releaseBinding ??= error.claim;
      writer?.write({ type: "abort" });
      return true;
    },
    get stopped() {
      return stopped;
    },
    get releaseBinding() {
      return releaseBinding;
    },
    terminalStatus(
      triggerAborted: boolean,
      otherwise: TerminalStatus,
    ): TerminalStatus {
      return stopped || triggerAborted ? "canceled" : otherwise;
    },
  };
}

type StopFinalization = {
  checkpoint: "not_registered" | "confirmed" | "unconfirmed";
  runRecord: "not_registered" | "attempted" | "failed";
  skipped?: "model_started";
};

/** Only the pre-model Stop path uses these terminal operations. Once a model
 * attempt begins, its existing usage-aware onFinish owns terminal accounting. */
export function createPreModelClaimStopFinalizer() {
  let checkpoint: (() => Promise<boolean | undefined>) | undefined;
  let runRecord: (() => Promise<void>) | undefined;
  let modelStarted = false;
  let pending: Promise<StopFinalization> | undefined;
  return {
    trackCheckpoint(finish: () => Promise<boolean | undefined>) {
      checkpoint = finish;
    },
    trackRunRecord(finish: () => Promise<void>) {
      runRecord = finish;
    },
    markModelStarted() {
      modelStarted = true;
    },
    get modelStarted() {
      return modelStarted;
    },
    finish(): Promise<StopFinalization> {
      if (pending) return pending;
      if (modelStarted)
        return Promise.resolve({
          checkpoint: "not_registered",
          runRecord: "not_registered",
          skipped: "model_started",
        });
      pending = (async () => {
        const result: StopFinalization = {
          checkpoint: "not_registered",
          runRecord: "not_registered",
        };
        if (checkpoint) {
          try {
            const confirmed = await checkpoint();
            result.checkpoint =
              confirmed === undefined
                ? "not_registered"
                : confirmed
                  ? "confirmed"
                  : "unconfirmed";
          } catch {
            result.checkpoint = "unconfirmed";
          }
        }
        if (runRecord) {
          try {
            await runRecord();
            result.runRecord = "attempted";
          } catch {
            result.runRecord = "failed";
          }
        }
        return result;
      })();
      return pending;
    },
  };
}
