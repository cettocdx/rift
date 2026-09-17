export const AGENT_LONG_HEARTBEAT_PART_TYPE = "data-agent-heartbeat" as const;

/**
 * "Everything before this was history; from here it is live."
 *
 * Reattaching to a run replays its stream from the beginning. The transport
 * fast-forwards and compacts that history, but it still leaves through the same
 * pipe as live output, so the SDK calls it streaming and the UI animated every
 * replayed word as if it were being typed right now -- the whole transcript
 * "re-typing itself" each time the user came back. This transient part marks
 * the boundary so the client can paint history instantly and animate only what
 * actually arrives after it. Transient: delivered to onData, never persisted.
 */
export const AGENT_LONG_REPLAY_EDGE_PART_TYPE =
  "data-agent-replay-edge" as const;

// Trigger.dev realtime stream subscriptions can go quiet while long terminal
// commands run. Keep a small, hidden UI-stream pulse comfortably below common
// idle cutoffs so later command output is still delivered to the frontend.
export const AGENT_LONG_HEARTBEAT_INTERVAL_MS = 25_000;

type HeartbeatStreamOptions<T> = {
  source: ReadableStream<T>;
  signal: AbortSignal;
  heartbeat: () => T;
  intervalMs?: number;
  /** The source owns cooperative abort and must drain its async finalizer. */
  drainOnAbort?: boolean;
};

/**
 * Adds idle heartbeats without concurrently mutating a stream controller.
 *
 * The previous implementation used an interval plus an async reader loop that
 * could both call enqueue/close while downstream cancellation was happening.
 * Node closes a ReadableStream controller as part of cancellation, so one of
 * those background callbacks could subsequently throw "Controller is already
 * closed" outside the task promise. A pull-driven adapter serializes every
 * controller transition through a single code path and lets a thrown source
 * error error the stream naturally.
 */
export const withAgentLongStreamHeartbeat = <T>({
  source,
  signal,
  heartbeat,
  intervalMs = AGENT_LONG_HEARTBEAT_INTERVAL_MS,
  drainOnAbort = false,
}: HeartbeatStreamOptions<T>): ReadableStream<T> => {
  const reader = source.getReader();
  const aborted = Symbol("agent-long-heartbeat-aborted");
  const heartbeatDue = Symbol("agent-long-heartbeat-due");

  let terminal = false;
  let pendingRead: Promise<ReadableStreamReadResult<T>> | undefined;
  let resolveAbort!: (value: typeof aborted) => void;
  const abortPromise = new Promise<typeof aborted>((resolve) => {
    resolveAbort = resolve;
  });

  const onAbort = () => {
    if (!drainOnAbort) resolveAbort(aborted);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();

  const readNext = () => {
    pendingRead ??= reader.read().finally(() => {
      pendingRead = undefined;
    });
    return pendingRead;
  };

  const release = () => {
    signal.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      // A pending read or an already-released reader is harmless here.
    }
  };

  return new ReadableStream<T>({
    async pull(controller) {
      if (terminal) return;

      let timer: ReturnType<typeof setTimeout> | undefined;
      const heartbeatPromise = new Promise<typeof heartbeatDue>((resolve) => {
        timer = setTimeout(() => resolve(heartbeatDue), intervalMs);
      });

      try {
        const result = await Promise.race([
          readNext(),
          abortPromise,
          heartbeatPromise,
        ]);

        if (terminal) return;

        // A controller can only be settled once. `cancel()` and an in-flight
        // `pull()` can both reach a close, and closing a controller that has
        // already errored throws — which reaches the operator as the agent
        // connection dropping.
        const closeOnce = () => {
          try {
            controller.close();
          } catch {
            // Already errored or cancelled by the consumer.
          }
        };

        if (result === aborted) {
          terminal = true;
          await reader.cancel("agent-long stream aborted").catch(() => {});
          release();
          closeOnce();
          return;
        }

        if (result === heartbeatDue) {
          controller.enqueue(heartbeat());
          return;
        }

        if (result.done) {
          terminal = true;
          release();
          closeOnce();
          return;
        }

        controller.enqueue(result.value);
      } catch (error) {
        terminal = true;
        release();
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },

    async cancel(reason) {
      if (terminal) return;
      terminal = true;
      signal.removeEventListener("abort", onAbort);
      await reader.cancel(reason).catch(() => {});
      release();
    },
  });
};

type MessageWithParts = {
  parts?: unknown[];
};

const isAgentLongHeartbeatPart = (part: unknown): boolean =>
  typeof part === "object" &&
  part !== null &&
  "type" in part &&
  (part as { type?: unknown }).type === AGENT_LONG_HEARTBEAT_PART_TYPE;

export const stripAgentLongHeartbeatParts = <T extends MessageWithParts>(
  message: T,
): T => {
  if (!Array.isArray(message.parts)) return message;

  const parts = message.parts.filter((part) => !isAgentLongHeartbeatPart(part));
  if (parts.length === message.parts.length) return message;

  return { ...message, parts } as T;
};

export const stripAgentLongHeartbeatPartsFromMessages = <
  T extends MessageWithParts,
>(
  messages: T[],
): T[] => {
  let changed = false;
  const stripped = messages.map((message) => {
    const next = stripAgentLongHeartbeatParts(message);
    if (next !== message) changed = true;
    return next;
  });

  return changed ? stripped : messages;
};
