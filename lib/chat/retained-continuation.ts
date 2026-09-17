export interface RetainedContinuationOptions {
  getStatus: () => "ready" | "submitted" | "streaming" | "error";
  getError: () => unknown;
  isAvailable: () => boolean;
  /** Notify subscribers only when the pending snapshot changes. */
  onChange?: () => void;
  sendMessage: (
    message: { text: string; metadata: { isAutoContinue: true } } | undefined,
    options: { body: Record<string, unknown> },
  ) => void | Promise<void>;
}

const MAX_ORDINARY_CONTINUATIONS = 5;
const MAX_EXTRA_BUILD_TIME_LEGS = 3;
const RUN_ACTIVE_RETRY_DELAYS = [1_000, 2_000, 4_000] as const;
const HANDOFF_DELAY_MS = 500;
const FINALIZER_POLL_MS = 50;

type Attempt = {
  options: { body: Record<string, unknown> };
  bypassesOrdinaryCap: boolean;
  dispatched: boolean;
  failureHandled: boolean;
  retries: number;
};

function isRunActiveConflict(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { statusCode?: unknown; code?: unknown };
  return value.statusCode === 409 && value.code === "run_active";
}

function captureContext(body: Record<string, unknown>) {
  // This is the already-serialized request configuration. Never replay its
  // message envelope over the fresh hidden user turn prepared by the SDK.
  const {
    messages: _messages,
    chatId: _chatId,
    id: _id,
    regenerate: _regenerate,
    useClientMessagesForRegenerate: _regenerateMessages,
    replaceActiveRun: _replaceActiveRun,
    __riftRetainedContinuation: _internal,
    isAutoContinue: _autoContinue,
    ...context
  } = body;
  return JSON.parse(JSON.stringify(context)) as Record<string, unknown>;
}

/** A chat-owned hand-off controller. No state or lifetime belongs to a route. */
export class RetainedContinuationController {
  private context: Record<string, unknown> | null = null;
  private pendingSignal: { timeLimit: boolean } | null = null;
  private attempt: Attempt | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seenIds = new Set<string>();
  private requestSequence = 0;
  private ordinaryCount = 0;
  private extraBuildTimeLegs = 0;
  private stopped = false;
  private disposed = false;
  private lastNotifiedPending = false;

  constructor(private readonly options: RetainedContinuationOptions) {}

  get pending() {
    return (
      !this.disposed &&
      Boolean(this.pendingSignal || this.attempt || this.timer)
    );
  }

  setRequestContext(body: Record<string, unknown>) {
    if (this.disposed) return;
    this.context = captureContext(body);
    if (!this.eligible()) this.cancelPending();
  }

  onData(part: { type: string; data?: unknown }) {
    if (
      part.type !== "data-auto-continue" ||
      !this.available() ||
      !this.eligible()
    )
      return;
    const data =
      part.data && typeof part.data === "object"
        ? (part.data as {
            shouldContinue?: unknown;
            continuationId?: unknown;
            reason?: unknown;
          })
        : {};
    if (data.shouldContinue === false) return;
    // Legacy producers omit IDs. One signal per actual request prevents
    // duplicate legacy chunks/reconnect replay from creating duplicate turns.
    const id =
      typeof data.continuationId === "string" && data.continuationId
        ? data.continuationId
        : `legacy-request:${this.requestSequence}`;
    if (this.seenIds.has(id)) return;
    this.seenIds.add(id);
    const timeLimit =
      data.reason === "timeout" || data.reason === "preemptive-timeout";
    if (
      timeLimit &&
      this.context?.purpose !== "app" &&
      this.context?.purpose !== "security"
    )
      return;
    this.pendingSignal = {
      timeLimit: timeLimit || this.pendingSignal?.timeLimit === true,
    };
    // Usually the signal arrives during streaming. Also support a signal
    // delivered just after the SDK has already finalized the leg.
    if (this.options.getStatus() === "ready") this.schedulePending();
    this.notifyPending();
  }

  onFinish() {
    if (!this.available()) return;
    if (this.attempt?.dispatched && !this.attempt.failureHandled) {
      this.waitForFinalizer(this.attempt);
    } else if (!this.attempt) {
      this.schedulePending();
    }
  }

  onError(error: unknown) {
    if (this.attempt?.dispatched) this.handleFailure(this.attempt, error);
    else this.cancelPending();
  }

  /** A new user request starts a fresh bounded chain; old replay IDs stay seen. */
  reset() {
    if (this.disposed) return;
    this.cancelPending();
    this.stopped = false;
    this.ordinaryCount = 0;
    this.extraBuildTimeLegs = 0;
    this.requestSequence += 1;
  }

  stop() {
    this.stopped = true;
    this.cancelPending();
  }

  dispose() {
    this.stop();
    this.disposed = true;
    this.context = null;
    this.seenIds.clear();
  }

  private available() {
    return !this.disposed && !this.stopped && this.options.isAvailable();
  }

  private eligible() {
    return this.context?.mode === "agent";
  }

  private notifyPending() {
    const pending = this.pending;
    if (pending === this.lastNotifiedPending) return;
    this.lastNotifiedPending = pending;
    this.options.onChange?.();
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private cancelPending() {
    this.clearTimer();
    this.pendingSignal = null;
    this.attempt = null;
    this.notifyPending();
  }

  private defer(callback: () => void, delay: number) {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      callback();
    }, delay);
  }

  private schedulePending() {
    if (
      !this.pendingSignal ||
      this.attempt ||
      !this.available() ||
      !this.eligible()
    )
      return;
    const atCap = this.ordinaryCount >= MAX_ORDINARY_CONTINUATIONS;
    const bypassesOrdinaryCap =
      atCap &&
      this.pendingSignal.timeLimit &&
      (this.context?.purpose === "security" ||
        (this.context?.purpose === "app" &&
          this.extraBuildTimeLegs < MAX_EXTRA_BUILD_TIME_LEGS));
    if (atCap && !bypassesOrdinaryCap) {
      this.pendingSignal = null;
      this.notifyPending();
      return;
    }
    const attempt: Attempt = {
      options: {
        body: {
          ...this.context,
          isAutoContinue: true,
          __riftRetainedContinuation: true,
        },
      },
      bypassesOrdinaryCap,
      dispatched: false,
      failureHandled: false,
      retries: 0,
    };
    this.pendingSignal = null;
    this.attempt = attempt;
    this.defer(() => this.dispatch(attempt, false), HANDOFF_DELAY_MS);
    this.notifyPending();
  }

  private dispatch(attempt: Attempt, retry: boolean) {
    if (this.attempt !== attempt) return;
    if (!this.available() || !this.eligible()) {
      this.cancelPending();
      return;
    }
    const status = this.options.getStatus();
    if (status === "submitted" || status === "streaming") {
      // onFinish fires before ready. Never replace a still-active SDK response.
      this.defer(() => this.dispatch(attempt, retry), FINALIZER_POLL_MS);
      return;
    }
    if (
      status !== "ready" &&
      !(
        retry &&
        status === "error" &&
        isRunActiveConflict(this.options.getError())
      )
    ) {
      this.cancelPending();
      return;
    }
    if (!retry) {
      this.ordinaryCount += 1;
      if (attempt.bypassesOrdinaryCap) this.extraBuildTimeLegs += 1;
      this.requestSequence += 1;
    }
    attempt.dispatched = true;
    attempt.failureHandled = false;
    try {
      const result = this.options.sendMessage(
        retry
          ? undefined
          : { text: "continue", metadata: { isAutoContinue: true } },
        attempt.options,
      );
      void Promise.resolve(result).then(
        () => {
          if (this.attempt !== attempt || attempt.failureHandled) return;
          if (this.options.getStatus() === "error") {
            this.handleFailure(attempt, this.options.getError());
          } else if (this.options.getStatus() === "ready") {
            this.completeAttempt(attempt);
          }
        },
        (error) => this.handleFailure(attempt, error),
      );
    } catch (error) {
      this.handleFailure(attempt, error);
    }
  }

  private waitForFinalizer(attempt: Attempt) {
    if (this.attempt !== attempt || attempt.failureHandled) return;
    if (!this.available()) {
      this.cancelPending();
      return;
    }
    const status = this.options.getStatus();
    if (status === "ready") this.completeAttempt(attempt);
    else if (status === "error")
      this.handleFailure(attempt, this.options.getError());
    else this.defer(() => this.waitForFinalizer(attempt), FINALIZER_POLL_MS);
  }

  private completeAttempt(attempt: Attempt) {
    if (this.attempt !== attempt) return;
    this.clearTimer();
    this.attempt = null;
    this.schedulePending();
    // Keep a continuous busy snapshot if another leg is already waiting.
    this.notifyPending();
  }

  private handleFailure(attempt: Attempt, error: unknown) {
    if (this.attempt !== attempt || attempt.failureHandled) return;
    attempt.failureHandled = true;
    const delay = RUN_ACTIVE_RETRY_DELAYS[attempt.retries];
    if (this.available() && isRunActiveConflict(error) && delay !== undefined) {
      attempt.retries += 1;
      this.defer(() => this.dispatch(attempt, true), delay);
    } else {
      // A lost acknowledgement is ambiguous: never duplicate work by retrying
      // network failures or arbitrary provider/server errors.
      this.cancelPending();
    }
  }
}
