import {
  readHackHttpExecution,
  type HackHttpExecutionBinding,
} from "@/lib/hack/http-execution";
import { createRedisSubscriber, getCancelChannel } from "./redis-pubsub";

/** Redis is a latency optimization. The exact execution's durable marker is
 * always authoritative and is polled even while the subscription is healthy. */
export async function createScopedCancellationSubscriber({
  binding,
  abortController,
  onStop,
  pollIntervalMs = 1000,
  readTimeoutMs = 2000,
}: {
  binding: HackHttpExecutionBinding;
  abortController: AbortController;
  onStop: () => void;
  pollIntervalMs?: number;
  readTimeoutMs?: number;
}) {
  const reads = new AbortController();
  // Convex reads cannot be canceled here. Race their observation and consume
  // late settlement without letting it mutate this subscriber's state.
  const readBounded = async (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let onReadAbort: (() => void) | undefined;
    try {
      return await Promise.race([
        readHackHttpExecution(binding),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Execution cancellation read timed out")),
            Number.isFinite(readTimeoutMs) ? Math.max(1, readTimeoutMs) : 2000,
          );
          if (signal) {
            onReadAbort = () =>
              reject(
                signal.reason ?? new Error("Cancellation observation stopped"),
              );
            signal.addEventListener("abort", onReadAbort, { once: true });
            if (signal.aborted) onReadAbort();
          }
        }),
      ]);
    } finally {
      clearTimeout(timeout);
      if (onReadAbort) signal?.removeEventListener("abort", onReadAbort);
    }
  };
  let stopped = false;
  let notified = false;
  let discard = false;
  let usingPubSub = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let subscriber: Awaited<ReturnType<typeof createRedisSubscriber>> = null;
  const channel = getCancelChannel(binding.chatId, binding.executionId);
  const closeSubscriber = () => {
    const current = subscriber;
    subscriber = null;
    usingPubSub = false;
    if (current) {
      void current.unsubscribe(channel).catch(() => {});
      void current.quit().catch(() => {});
    }
  };
  const cleanup = () => {
    stopped = true;
    reads.abort();
    clearTimeout(timer);
    abortController.signal.removeEventListener("abort", onAbort);
    closeSubscriber();
  };
  const onAbort = () => {
    cleanup();
    if (!notified) {
      notified = true;
      onStop();
    }
  };
  const readStatus = async () => {
    if (stopped) return;
    try {
      const status = await readBounded(reads.signal);
      if (stopped || status?.executionId !== binding.executionId) return;
      if (status.stopped) {
        discard = status.discard === true;
        abortController.abort();
      }
    } catch {
      // Unavailable observation is never an acknowledgment. The next poll
      // retries the same identity; the Stop API retains its pending state.
    }
  };
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(async () => {
      await readStatus();
      schedule();
    }, pollIntervalMs);
  };
  // Register before any asynchronous setup so an abort cannot be lost.
  abortController.signal.addEventListener("abort", onAbort, { once: true });
  if (abortController.signal.aborted) onAbort();
  else {
    await readStatus();
    if (!stopped) {
      schedule();
      // Do not block model startup on a slow Redis connection. Late setup is
      // cleaned immediately if Stop/completion happened while connecting.
      void (async () => {
        try {
          const connected = await createRedisSubscriber();
          if (!connected) return;
          if (stopped) {
            await connected.quit().catch(() => {});
            return;
          }
          subscriber = connected;
          await connected.subscribe(channel, (message) => {
            if (stopped) return;
            try {
              const value = JSON.parse(message);
              if (
                value?.canceled === true &&
                value.executionId === binding.executionId
              )
                void readStatus();
            } catch {
              /* Ignore malformed or unrelated notifications. */
            }
          });
          if (stopped) return;
          usingPubSub = true;
          await readStatus();
        } catch {
          closeSubscriber();
        }
      })();
    }
  }
  return {
    stop: async () => {
      cleanup();
    },
    get isUsingPubSub() {
      return usingPubSub;
    },
    shouldSkipSave: () => discard,
    resolveSkipSave: async () => {
      if (discard) return true;
      try {
        // Finalization must read discard even after execution cancellation.
        const status = await readBounded();
        return (
          status?.executionId === binding.executionId &&
          status.stopped &&
          status.discard
        );
      } catch {
        return false;
      }
    },
  };
}
