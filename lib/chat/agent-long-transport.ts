import {
  recoverAgentDispatch,
  isConfirmedHackCancellation,
} from "./agent-dispatch-recovery";
import { ChatSDKError, type ErrorCode } from "@/lib/errors";
import { AGENT_UI_STREAM_ID } from "@/trigger/stream-ids";
import { AGENT_LONG_REPLAY_EDGE_PART_TYPE } from "@/lib/chat/agent-long-heartbeat";
import { createToolInputDedupFilter } from "./agent-long-tool-input-dedup";
import {
  AGENT_START_TIMEOUT_MESSAGE,
  LOST_AGENT_CONNECTION_MESSAGE,
  AGENT_WORKER_FAILED_MESSAGE,
} from "./interrupted-response";
import {
  getAgentResumeRequestContext,
  type AgentResumeRequestContext,
} from "@/lib/api/agent-resume-context";
import { isChatPurpose } from "@/types/chat";

type TriggerCore = typeof import("@trigger.dev/core/v3");

let triggerCorePromise: Promise<TriggerCore> | null = null;

const getTriggerCore = (): Promise<TriggerCore> => {
  if (!triggerCorePromise) {
    triggerCorePromise = import("@trigger.dev/core/v3").catch((error) => {
      // A transient chunk/deployment failure must not poison Agent mode for
      // the rest of the page session. Clear the cache so the next real send
      // can retry the import.
      triggerCorePromise = null;
      throw error;
    });
  }
  return triggerCorePromise;
};

/** Preload only after Agent mode is selected; Ask mode never pays this cost. */
export const preloadAgentLongTransport = (): void => {
  // Preloading is opportunistic. The actual send path reports failures; this
  // warm-up must never create an unhandled rejection.
  void getTriggerCore().catch(() => undefined);
};

/**
 * `fetch` adapter for "agent-long" mode used by the chat transport.
 *
 *   1. POST the request body to /api/agent-long, which triggers a durable
 *      trigger.dev task and returns { runId, publicAccessToken }.
 *   2. Subscribe to the task's "ui" metadata stream (Vercel AI SDK
 *      UIMessage chunks the task emitted).
 *   3. Re-encode each chunk as an SSE `data: ...\n\n` frame so the caller's
 *      `useChat` consumes it identically to a normal streaming response.
 *
 * On reconnect (page reload while a run is still executing), useChat fires
 * a GET against the configured reconnect URL; we route that through
 * `resumeAgentLongStream`, which fetches the active runId from
 * /api/agent-long/resume and pipes the same trigger.dev stream. Trigger.dev
 * streams are durable for 28 days, so a fresh subscription replays every
 * chunk from the beginning — useChat reconstructs the in-progress
 * assistant turn without needing a client-side cursor.
 */
type RunHandle = {
  runId: string;
  publicAccessToken: string;
  requestContext?: AgentResumeRequestContext;
};

const readOptionalRequestContext = (
  value: unknown,
): AgentResumeRequestContext | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const context = value as Record<string, unknown>;
  // This is the normalized response shape, not a worker payload. Do not let
  // the payload normalizer invent missing required continuation settings.
  if (
    context.mode !== "agent" ||
    typeof context.purpose !== "string" ||
    !isChatPurpose(context.purpose) ||
    typeof context.temporary !== "boolean" ||
    typeof context.approvalMode !== "string" ||
    typeof context.sandboxPreference !== "string" ||
    !Array.isArray(context.todos)
  )
    return;
  try {
    return getAgentResumeRequestContext({
      ...context,
      baseTodos: context.todos,
    });
  } catch {
    // Malformed optional settings must not prevent replay of a valid run or
    // enter the retained session as unchecked continuation context.
    return;
  }
};

const readRunHandle = async (response: Response): Promise<RunHandle> => {
  const invalidHandle = () =>
    new Error("The agent response did not include a valid run handle.");
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    // Do not expose response contents, which may include a subscription token.
    throw invalidHandle();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidHandle();
  }
  const handle = value as Record<string, unknown>;
  if (
    typeof handle.runId !== "string" ||
    !handle.runId.trim() ||
    typeof handle.publicAccessToken !== "string" ||
    !handle.publicAccessToken.trim()
  ) {
    throw invalidHandle();
  }
  // IDs and tokens are opaque. Allow additive response fields without
  // inventing an identifier format, and normalize optional settings separately.
  return {
    runId: handle.runId,
    publicAccessToken: handle.publicAccessToken,
    requestContext: readOptionalRequestContext(handle.requestContext),
  };
};

const sseHeaders: HeadersInit = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

const buildTerminalSSEResponse = (chunk: {
  type: "abort" | "error";
  errorText?: string;
}): Response =>
  new Response(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`), {
    status: 200,
    headers: sseHeaders,
  });

// A resume handle can name a run that already died. Replaying its durable
// stream yields only buffered history with no live tail, so without this
// check the client paints stale chunks and then sits silent forever. Ask the
// provider once up front; a lookup failure must not kill a healthy resume.
const readRunStatus = async (
  runId: string,
  publicAccessToken: string,
): Promise<string | undefined> => {
  try {
    const { ApiClient } = await getTriggerCore();
    const apiClient = new ApiClient(
      "https://api.trigger.dev",
      publicAccessToken,
    );
    const run = (await apiClient.retrieveRun(runId)) as {
      status?: string;
    };
    return run.status;
  } catch {
    return undefined;
  }
};

// Only truly failed/terminated statuses warrant an immediate abort — the
// task died and no `finish` chunk will ever arrive. Do NOT include
// "COMPLETED" here: a successful run still has stream chunks (including
// `finish`) in flight when the status event lands, and breaking early
// causes a race that closes the frontend stream prematurely.
const TERMINAL_RUN_STATUSES = new Set([
  "FAILED",
  "CRASHED",
  "CANCELED",
  "SYSTEM_FAILURE",
  "TIMED_OUT",
  "EXPIRED",
]);

// Bound both halves of Agent startup. The HTTP route itself has a 30-second
// ceiling, while a healthy Trigger worker emits its first heartbeat shortly
// after pickup. These guards turn a missing worker/queue stall into useChat's
// normal error state, where Retry and Reconnect are already available, instead
// of leaving a silent Stop button for five minutes.
export const AGENT_START_REQUEST_TIMEOUT_MS = 35_000;
export const AGENT_FIRST_EVENT_TIMEOUT_MS = 60_000;
export class AgentRunActiveError extends Error {
  readonly statusCode = 409;
  readonly code = "run_active";
}
const STREAM_IDLE_TIMEOUT_SECONDS = AGENT_FIRST_EVENT_TIMEOUT_MS / 1000;
const RESUME_RETRY_DELAYS_MS = [1_000, 3_000] as const;
// A half-open HTTP request after wake must not hold recovery forever. This is
// a read-only lookup of the existing run; retry never submits a new run.
const RESUME_REQUEST_TIMEOUT_MS = 15_000;

/**
 * A ceiling on idle-close reopens, not on run length. At one close per idle
 * minute this covers a run that spends the better part of an hour thinking,
 * which is already past the task's own 58-minute budget.
 */
const MAX_UI_STREAM_RECONNECTS = 90;
const UI_STREAM_REOPEN_DELAY_MS = 250;

/**
 * How many reopens in a row may deliver nothing before the stream is treated
 * as gone. A live run breaks its silence with a heartbeat, so three empty
 * windows in a row means the producer is not talking to anyone.
 */
const MAX_EMPTY_UI_STREAM_REOPENS = 3;

/**
 * How long the drain loop may hold the main thread before it must yield.
 *
 * This transport runs IN THE BROWSER: it subscribes to the run's realtime
 * stream and re-encodes it as SSE for useChat. On a live run that is harmless
 * -- chunks arrive slower than they are processed. On RESUME it is not: the
 * subscription replays the run's entire buffered history, every buffered
 * chunk resolves `iter.next()` synchronously, and `await` of an
 * already-resolved promise is a microtask -- so the while-loop drains the
 * whole backlog inside a single microtask checkpoint. The event loop never
 * turns, nothing paints, no input is handled. Reopening the app onto a chat
 * whose run had been executing for an hour pinned WebKit's content process at
 * 100% and the window read as frozen; a profiler sample showed the entire
 * main thread inside one `performMicrotaskCheckpoint`.
 *
 * A time budget rather than a chunk count, because chunk cost varies wildly
 * (a tool-output frame can be kilobytes). 24ms keeps replay within roughly a
 * frame and lets input and paint interleave; the macrotask hop costs ~0-4ms
 * per turn, which is noise against a multi-second replay.
 */
const DRAIN_YIELD_BUDGET_MS = 24;

/** A macrotask breath: lets the browser paint and handle input mid-replay. */
const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/**
 * How long a quiet gap has to be before the replay is considered over.
 *
 * Every subscription to a run's stream starts by replaying its entire
 * buffered history, and the yield above only makes that replay POLITE -- it
 * is still all processed: stringified, framed, parsed and reduced into React
 * state, thousands of chunks deep for a run that has been alive an hour. The
 * page survives it; it does not enjoy it, and on WebKit it can take minutes.
 *
 * Almost none of that work buys anything. Completed messages are already
 * persisted and load from the database with the chat; the only chunks the UI
 * genuinely needs are the in-flight message's own. So while chunks arrive
 * faster than this gap the transport just BUFFERS them raw -- no encoding, no
 * emission -- and when the stream first goes quiet it emits only the suffix
 * from the last message boundary (`type: "start"`), then continues live.
 *
 * If the gap fires early -- a slow network pausing mid-replay -- the cost is
 * re-streaming an already-persisted message, which the client merges by id.
 * Wrong in the cheap direction; the fallback when no boundary exists in the
 * buffer is to emit everything, wrong in the same direction.
 */
const REPLAY_EDGE_QUIET_MS = 400;

/** Sentinel resolved by the quiet-gap timer in the replay race. */
const replayEdgeSentinel = Symbol("replay-edge");

/**
 * Compact a replayed suffix before emitting it.
 *
 * The message-boundary skip is worthless in the worst case: a Build run's
 * whole history is usually ONE assistant message, so the suffix from its
 * `start` is the entire buffer. What makes replay expensive is not the chunk
 * count in memory -- it is that every chunk is stringified, framed, parsed
 * and reduced into React state downstream. For a finished stretch of history
 * that per-chunk granularity carries no information: only the final state of
 * each part matters.
 *
 * So, per part id, the thousands of one-word deltas collapse into one chunk
 * carrying the whole text, placed at the first delta's position so the order
 * of parts within the message survives. Deltas for a tool input whose
 * `tool-input-available` also sits in the buffer are dropped outright -- the
 * complete input follows anyway, and the SDK treats the available chunk as
 * authoritative (see agent-long-tool-input-dedup). Tens of thousands of
 * chunks become hundreds; the LIVE tail after the edge stays untouched, so
 * typing-style streaming is unaffected.
 */
export function compactReplaySuffix(chunks: unknown[]): unknown[] {
  type Delta = { type: string; id?: string; delta?: string };
  type ToolChunk = { type?: string; toolCallId?: string };

  const completedToolInputs = new Set<string>();
  for (const chunk of chunks) {
    const c = chunk as ToolChunk;
    if (
      c?.type === "tool-input-available" &&
      typeof c.toolCallId === "string"
    ) {
      completedToolInputs.add(c.toolCallId);
    }
  }

  const out: unknown[] = [];
  const mergedAt = new Map<string, Delta>();
  for (const chunk of chunks) {
    const c = chunk as Delta & ToolChunk;
    if (
      (c?.type === "text-delta" || c?.type === "reasoning-delta") &&
      typeof c.id === "string" &&
      typeof c.delta === "string"
    ) {
      const key = `${c.type}:${c.id}`;
      const merged = mergedAt.get(key);
      if (merged) {
        merged.delta += c.delta;
      } else {
        const first = { ...c };
        mergedAt.set(key, first);
        out.push(first);
      }
      continue;
    }
    if (
      c?.type === "tool-input-delta" &&
      typeof c.toolCallId === "string" &&
      completedToolInputs.has(c.toolCallId)
    ) {
      continue;
    }
    out.push(chunk);
  }
  return out;
}

const waitForResumeRetry = (
  delayMs: number,
  signal?: AbortSignal,
): Promise<boolean> =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeoutId);
      resolve(false);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

const shouldRetryResumeResponse = (response: Response): boolean =>
  response.status === 408 || response.status === 425 || response.status >= 500;

const fetchDurableResume = async (
  url: string,
  init: RequestInit | undefined,
): Promise<Response> => {
  const signal = init?.signal ?? undefined;

  for (let attempt = 0; attempt <= RESUME_RETRY_DELAYS_MS.length; attempt++) {
    if (signal?.aborted) return buildTerminalSSEResponse({ type: "abort" });

    const attemptController = new AbortController();
    const forwardAbort = () => attemptController.abort(signal?.reason);
    signal?.addEventListener("abort", forwardAbort, { once: true });
    if (signal?.aborted) forwardAbort();
    const timer = setTimeout(
      () => attemptController.abort(),
      RESUME_REQUEST_TIMEOUT_MS,
    );
    try {
      const response = await fetch(url, {
        ...init,
        method: "GET",
        signal: attemptController.signal,
      });
      if (!shouldRetryResumeResponse(response)) return response;

      if (attempt === RESUME_RETRY_DELAYS_MS.length) {
        await response.body?.cancel().catch(() => undefined);
        return buildTerminalSSEResponse({
          type: "error",
          errorText: LOST_AGENT_CONNECTION_MESSAGE,
        });
      }

      await response.body?.cancel().catch(() => undefined);
    } catch {
      if (signal?.aborted) return buildTerminalSSEResponse({ type: "abort" });
      if (attempt === RESUME_RETRY_DELAYS_MS.length) {
        return buildTerminalSSEResponse({
          type: "error",
          errorText: LOST_AGENT_CONNECTION_MESSAGE,
        });
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forwardAbort);
    }

    const shouldContinue = await waitForResumeRetry(
      RESUME_RETRY_DELAYS_MS[attempt],
      signal,
    );
    if (!shouldContinue) return buildTerminalSSEResponse({ type: "abort" });
  }

  return buildTerminalSSEResponse({
    type: "error",
    errorText: LOST_AGENT_CONNECTION_MESSAGE,
  });
};

export const buildSSEResponseFromRun = (
  { runId, publicAccessToken }: RunHandle,
  signal?: AbortSignal,
  firstEventTimeoutMs = AGENT_FIRST_EVENT_TIMEOUT_MS,
): Response => {
  const encoder = new TextEncoder();
  let cancelActiveStream = () => {};
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      // Allocate this before the Trigger SDK import/auth awaits. Startup
      // timeout and user Stop can then cancel setup immediately instead of
      // allowing a late background subscription after the response closed.
      const readAbortController = new AbortController();
      let statusSubscription: { unsubscribe?: () => void } | undefined;
      let userAborted = false;
      let workerFailed = false;

      const stopBackgroundWork = () => {
        readAbortController.abort();
        statusSubscription?.unsubscribe?.();
      };

      const markConsumerClosed = () => {
        if (closed) return;
        closed = true;
        stopBackgroundWork();
      };

      const enqueueFrame = (frame: Uint8Array): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(frame);
          return true;
        } catch {
          // Response-body cancellation closes the native controller without
          // notifying this async start callback. Treat that as the terminal
          // transition and stop every producer immediately.
          markConsumerClosed();
          return false;
        }
      };

      const sendTerminalChunkAndClose = (chunk: {
        type: "abort" | "error" | "finish";
        errorText?: string;
      }) => {
        if (closed) return;
        enqueueFrame(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        if (closed) return;
        closed = true;
        stopBackgroundWork();
        try {
          controller.close();
        } catch {
          // ignore if already closed
        }
      };

      // A real consumer/user abort must stay an abort. Transport failures use
      // an error chunk instead; treating those as aborts made useChat silently
      // drop back to "ready" with a persisted user message and no response.
      const sendAbortAndClose = () =>
        sendTerminalChunkAndClose({ type: "abort" });
      const sendErrorAndClose = () =>
        sendTerminalChunkAndClose({
          type: "error",
          errorText: workerFailed
            ? AGENT_WORKER_FAILED_MESSAGE
            : LOST_AGENT_CONNECTION_MESSAGE,
        });
      const sendStartupTimeoutAndClose = () =>
        sendTerminalChunkAndClose({
          type: "error",
          errorText: AGENT_START_TIMEOUT_MESSAGE,
        });

      const close = () => {
        if (closed) return;
        closed = true;
        stopBackgroundWork();
        try {
          controller.close();
        } catch {
          // already closed by sendAbortAndClose
        }
      };

      // Timeout guard: if the task never registers/emits its UI stream, close
      // with a retryable startup error rather than an indefinite spinner.
      //
      // Re-armable on purpose. A run queued behind the concurrency limit emits
      // no UI chunks and is not late -- it has not been handed a worker yet.
      // Firing a startup error at it turned "your turn is coming" into "the
      // connection dropped" on a run that would have started fine. Every
      // status event from a live, non-terminal run restarts the clock, so this
      // only fires on genuine silence.
      let startupTimeoutId: ReturnType<typeof setTimeout> | null = null;
      const armStartupTimeout = () => {
        if (startupTimeoutId !== null) clearTimeout(startupTimeoutId);
        startupTimeoutId = setTimeout(() => {
          readAbortController.abort();
          sendStartupTimeoutAndClose();
        }, firstEventTimeoutMs);
      };
      const disarmStartupTimeout = () => {
        if (startupTimeoutId === null) return;
        clearTimeout(startupTimeoutId);
        startupTimeoutId = null;
      };
      armStartupTimeout();
      cancelActiveStream = () => {
        disarmStartupTimeout();
        markConsumerClosed();
      };

      // Short-circuit if the consumer already aborted before we got here.
      if (signal?.aborted) {
        disarmStartupTimeout();
        sendAbortAndClose();
        return;
      }

      let firstEventReceived = false;
      let runIsTerminal = false;
      let lastEventId: string | undefined;

      const onAbort = () => {
        userAborted = true;
        readAbortController.abort();
        sendAbortAndClose();
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      try {
        // The full @trigger.dev/sdk is server-only in 4.5.x because it owns
        // AsyncLocalStorage state. ApiClient is the browser-safe public client
        // used by @trigger.dev/react-hooks and keeps this durable stream out of
        // a long-running Vercel function.
        const { ApiClient } = await getTriggerCore();
        const apiClient = new ApiClient(
          "https://api.trigger.dev",
          publicAccessToken,
        );

        if (closed) return;
        if (signal?.aborted) {
          userAborted = true;
          readAbortController.abort();
          return;
        }

        // Monitor run failure separately from the UI stream. Reading the
        // stream directly avoids a race where the mixed run+stream
        // subscription can discover the stream late and replay chunks only
        // at completion.
        statusSubscription = apiClient.subscribeToRun(runId, {
          skipColumns: ["payload", "output"],
        });
        const statusMonitor = (async () => {
          for await (const run of statusSubscription as AsyncIterable<{
            status?: string;
            metadata?: { uiDeliveryStatus?: string; status?: string };
          }>) {
            const status = run.status;
            // Only this worker marker certifies that the model consumer and
            // durable persistence finished despite a failed S2 upload. Ordinary
            // COMPLETED runs must still drain their in-flight finish chunk.
            if (
              status === "COMPLETED" &&
              run.metadata?.uiDeliveryStatus === "interrupted" &&
              run.metadata.status === "done"
            ) {
              sendTerminalChunkAndClose({ type: "finish" });
              break;
            }
            if (status && TERMINAL_RUN_STATUSES.has(status)) {
              runIsTerminal = true;
              workerFailed = status !== "CANCELED";
              readAbortController.abort();
              break;
            }
            // Trigger is still reporting on this run, so it exists and is
            // moving. Whatever it is waiting for, it is not lost.
            if (!firstEventReceived) armStartupTimeout();
          }
        })().catch(() => undefined);

        // Re-openable, and it has to be. `timeoutInSeconds` asks the server to
        // close the SSE connection after that much silence, and when it does,
        // the SDK reports a clean end of stream -- its retry path only covers
        // errors, not a close it was told to expect. A run that spends a minute
        // inside one tool call therefore ended up looking like a dropped
        // connection. Reopening from the last event id continues the same
        // durable stream with no replay.
        const openUiStream = async () => {
          const uiStream = await apiClient.fetchStream<unknown>(
            runId,
            AGENT_UI_STREAM_ID,
            {
              signal: readAbortController.signal,
              timeoutInSeconds: STREAM_IDLE_TIMEOUT_SECONDS,
              lastEventId,
              onPart: (part: { id?: string }) => {
                if (typeof part?.id === "string") lastEventId = part.id;
              },
            } as Parameters<typeof apiClient.fetchStream>[2],
          );
          return uiStream[Symbol.asyncIterator]();
        };

        // text-delta and reasoning-delta chunks are emitted per-token and
        // can number in the thousands for long tasks. Forwarding each one
        // as a separate SSE frame causes the browser to process thousands
        // of React state updates in rapid succession, freezing the UI.
        // We buffer consecutive delta chunks and flush them as a single
        // merged chunk, reducing ~9k events to a few hundred.
        const DELTA_FLUSH_COUNT = 50; // flush after this many buffered deltas
        const DELTA_FLUSH_MS = 30; // or after this many ms (live streaming)

        type DeltaBatch = {
          type: "text-delta" | "reasoning-delta";
          id: string;
          delta: string;
        };
        const deltaBuffers = new Map<string, DeltaBatch>();
        let batchedDeltaCount = 0;
        let deltaFlushTimer: ReturnType<typeof setTimeout> | null = null;
        const toolInputDedup = createToolInputDedupFilter();

        const flushDeltaBuffers = () => {
          if (deltaFlushTimer !== null) {
            clearTimeout(deltaFlushTimer);
            deltaFlushTimer = null;
          }
          if (deltaBuffers.size === 0) return;
          for (const batch of deltaBuffers.values()) {
            if (
              !enqueueFrame(
                encoder.encode(`data: ${JSON.stringify(batch)}\n\n`),
              )
            ) {
              break;
            }
          }
          deltaBuffers.clear();
          batchedDeltaCount = 0;
        };

        // Race stream.next() against the consumer's abort signal so Stop
        // closes the local stream in one tick, even when the LLM is mid-step
        // and no chunks are flowing.
        const abortSentinel = Symbol("aborted");
        const abortPromise = new Promise<typeof abortSentinel>((resolve) => {
          if (!signal) return; // never resolves — Promise.race ignores it
          signal.addEventListener("abort", () => resolve(abortSentinel), {
            once: true,
          });
        });

        let sawTerminalChunk = false;
        let reconnects = 0;
        let emptyReopens = 0;
        let chunksSinceOpen = 0;
        let iter = await openUiStream();
        let lastYieldAt = Date.now();
        // The replay skip, per subscription: every (re)open replays the run's
        // history from the beginning, so each one gets its own fast-forward.
        let replayDone = false;
        let replayBuffer: unknown[] = [];
        let replayCursor = 0;
        let streamClosed = false;
        // Set once the last replayed chunk has been handed on. The edge marker
        // goes out at the top of the next turn -- after that chunk's deltas are
        // flushed, before anything live is read -- so the client can tell
        // remembered history from words that are genuinely arriving now.
        let pendingReplayEdge = false;
        // A read that lost the race to the quiet-gap timer is still a read:
        // the generator will resolve it with the NEXT chunk, and abandoning
        // the promise threw that chunk away -- the first live word after every
        // reattach, silently. The pending read is kept and consumed by
        // whichever loop asks next.
        let pendingNext: Promise<IteratorResult<unknown>> | null = null;
        const nextChunk = () => {
          const promise = pendingNext ?? iter.next();
          pendingNext = promise;
          return promise;
        };
        const emitReplayEdge = () => {
          flushDeltaBuffers();
          enqueueFrame(
            encoder.encode(
              `data: ${JSON.stringify({
                type: AGENT_LONG_REPLAY_EDGE_PART_TYPE,
                data: { at: Date.now() },
                transient: true,
              })}\n\n`,
            ),
          );
        };
        reconnectLoop: while (true) {
          while (true) {
            // The budget check must sit INSIDE the drain: during a replay every
            // `await` below resolves as a microtask, so nothing else here ever
            // gets the thread back voluntarily.
            if (Date.now() - lastYieldAt >= DRAIN_YIELD_BUDGET_MS) {
              await yieldToEventLoop();
              lastYieldAt = Date.now();
            }

            if (pendingReplayEdge) {
              pendingReplayEdge = false;
              emitReplayEdge();
            }

            if (!replayDone) {
              // Fast-forward: pull as long as chunks arrive without a quiet
              // gap, storing them untouched. This loop does no encoding and no
              // emission, so an hour of history costs array pushes.
              let edgeTimer: ReturnType<typeof setTimeout> | undefined;
              const edgePromise = new Promise<typeof replayEdgeSentinel>(
                (resolve) => {
                  edgeTimer = setTimeout(
                    () => resolve(replayEdgeSentinel),
                    REPLAY_EDGE_QUIET_MS,
                  );
                },
              );
              const raced = await Promise.race([
                nextChunk(),
                abortPromise,
                edgePromise,
              ]);
              clearTimeout(edgeTimer);
              if (raced === abortSentinel) {
                userAborted = true;
                break reconnectLoop;
              }
              // The read settled (with a chunk or the end); the next call may
              // open a fresh one. If the timer won, pendingNext stays armed.
              if (raced !== replayEdgeSentinel) pendingNext = null;
              if (raced !== replayEdgeSentinel && !raced.done) {
                replayBuffer.push(raced.value);
                // Buffered chunks are received chunks: a long replay must not
                // trip the "no first event" startup timeout mid-fast-forward.
                if (!firstEventReceived) {
                  firstEventReceived = true;
                  disarmStartupTimeout();
                }
                continue;
              }
              // The live edge (quiet gap) or the end of the stream. Emit only
              // from the last message boundary; everything before it is
              // persisted and already on screen.
              streamClosed = raced !== replayEdgeSentinel;
              let suffixStart = 0;
              for (let i = replayBuffer.length - 1; i >= 0; i--) {
                const buffered = replayBuffer[i] as { type?: string } | null;
                if (buffered && buffered.type === "start") {
                  suffixStart = i;
                  break;
                }
              }
              replayBuffer = compactReplaySuffix(
                replayBuffer.slice(suffixStart),
              );
              replayCursor = 0;
              replayDone = true;
              // Nothing to replay: the boundary is right here, before the first
              // live chunk, so the client never waits on a marker with no
              // history in front of it.
              if (replayBuffer.length === 0) emitReplayEdge();
            }

            let chunk: unknown;
            if (replayCursor < replayBuffer.length) {
              chunk = replayBuffer[replayCursor];
              replayCursor += 1;
              if (replayCursor >= replayBuffer.length) {
                replayBuffer = [];
                replayCursor = 0;
                const lastType = (chunk as { type?: string } | null)?.type;
                if (
                  lastType === "finish" ||
                  lastType === "abort" ||
                  lastType === "error"
                ) {
                  // The replay IS the whole run. The loop ends on this chunk, so
                  // the edge has to go out before it or not at all.
                  emitReplayEdge();
                } else {
                  // Let this last replayed chunk be processed below, then mark
                  // the edge on the next turn, ahead of the first live read.
                  pendingReplayEdge = true;
                }
              }
            } else if (streamClosed) {
              break;
            } else {
              const next = await Promise.race([nextChunk(), abortPromise]);
              if (next === abortSentinel) {
                userAborted = true;
                break reconnectLoop;
              }
              pendingNext = null;
              if (next.done) break;
              chunk = next.value;
            }
            chunksSinceOpen += 1;

            // Disarm the "no first event" timeout once the UI stream is
            // proven live. Healthy long runs are then governed by task-side
            // heartbeats and the durable worker's own execution ceiling.
            if (!firstEventReceived) {
              firstEventReceived = true;
              disarmStartupTimeout();
            }

            if (
              typeof chunk !== "object" ||
              chunk === null ||
              !("type" in chunk)
            ) {
              continue;
            }

            const chunkType = (chunk as { type?: string }).type;
            const chunkId = (chunk as { id?: string }).id;
            const chunkDelta = (chunk as { delta?: string }).delta;

            if (
              (chunkType === "text-delta" || chunkType === "reasoning-delta") &&
              typeof chunkId === "string" &&
              typeof chunkDelta === "string"
            ) {
              const key = `${chunkType}:${chunkId}`;
              const existing = deltaBuffers.get(key);
              if (existing) {
                existing.delta += chunkDelta;
              } else {
                deltaBuffers.set(key, {
                  type: chunkType as "text-delta" | "reasoning-delta",
                  id: chunkId,
                  delta: chunkDelta,
                });
              }
              batchedDeltaCount++;
              if (batchedDeltaCount >= DELTA_FLUSH_COUNT) {
                flushDeltaBuffers();
              } else if (deltaFlushTimer === null) {
                deltaFlushTimer = setTimeout(flushDeltaBuffers, DELTA_FLUSH_MS);
              }
              continue;
            }

            // Non-delta chunk: flush any buffered deltas first so ordering
            // is preserved (e.g. text-delta before tool-input-start).
            flushDeltaBuffers();

            if (
              toolInputDedup.shouldDrop(
                chunk as { type?: string; toolCallId?: string },
              )
            ) {
              continue;
            }

            enqueueFrame(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            // finish / abort / error are the last chunks useChat needs.
            if (
              chunkType === "finish" ||
              chunkType === "abort" ||
              chunkType === "error"
            ) {
              sawTerminalChunk = true;
              break reconnectLoop;
            }
          }

          // The producer stream closed. If the run is still alive and this was
          // just the idle close, pick the same stream back up where it stopped.
          // `readAbortController` is aborted by the startup guard and by a
          // terminal run status. Either way the reader was told to stop, so
          // reopening it would walk straight back into the thing that stopped it.
          if (
            userAborted ||
            signal?.aborted ||
            runIsTerminal ||
            readAbortController.signal.aborted
          ) {
            break;
          }
          emptyReopens = chunksSinceOpen === 0 ? emptyReopens + 1 : 0;
          if (emptyReopens > MAX_EMPTY_UI_STREAM_REOPENS) break;
          chunksSinceOpen = 0;
          if (reconnects >= MAX_UI_STREAM_RECONNECTS) break;
          reconnects += 1;
          // A breath between reopens. An idle close arrives a minute apart and
          // never notices this; a stream that closes the instant it opens would
          // otherwise spin the API as fast as the event loop allows.
          if (!(await waitForResumeRetry(UI_STREAM_REOPEN_DELAY_MS, signal))) {
            userAborted = true;
            break;
          }
          iter = await openUiStream();
          // A fresh subscription replays from the beginning again.
          replayDone = false;
          replayBuffer = [];
          replayCursor = 0;
          streamClosed = false;
          pendingReplayEdge = false;
          pendingNext = null;
        }

        // Flush any deltas that didn't trigger a count- or timer-based flush.
        flushDeltaBuffers();

        if (userAborted) {
          // Release the trigger.dev subscription so it doesn't keep
          // streaming chunks into a dead controller.
          await iter.return?.(undefined).catch(() => undefined);
        }

        if (!sawTerminalChunk) {
          // Subscription ended without a terminal UI chunk — run crashed,
          // was canceled, or failed before registering the stream. Only a
          // local consumer abort is silent; every producer failure must be
          // visible and retryable.
          if (userAborted || signal?.aborted) {
            sendAbortAndClose();
          } else {
            sendErrorAndClose();
          }
        }

        statusSubscription?.unsubscribe?.();
        void statusMonitor;

        // Normal close path (sawTerminalChunk = true exits loop above).
        disarmStartupTimeout();
        close();
      } catch {
        disarmStartupTimeout();
        if (userAborted || signal?.aborted) {
          sendAbortAndClose();
        } else {
          sendErrorAndClose();
        }
      } finally {
        cancelActiveStream = () => {};
        signal?.removeEventListener("abort", onAbort);
        statusSubscription?.unsubscribe?.();
      }
    },
    cancel() {
      cancelActiveStream();
    },
  });

  return new Response(stream, { status: 200, headers: sseHeaders });
};

export const fetchAgentLongStream = async (
  init: RequestInit | undefined,
  timings?: {
    startRequestTimeoutMs?: number;
    firstEventTimeoutMs?: number;
  },
  channel: "app" | "hack" = "app",
  onRequestContext?: (context: AgentResumeRequestContext) => void,
): Promise<Response> => {
  const timeoutController = new AbortController();
  const externalSignal = init?.signal ?? undefined;
  let didTimeout = false;

  const forwardExternalAbort = () =>
    timeoutController.abort(externalSignal?.reason);
  if (externalSignal?.aborted) {
    forwardExternalAbort();
  } else {
    externalSignal?.addEventListener("abort", forwardExternalAbort, {
      once: true,
    });
  }

  const timeoutId = setTimeout(() => {
    didTimeout = true;
    timeoutController.abort(new Error(AGENT_START_TIMEOUT_MESSAGE));
  }, timings?.startRequestTimeoutMs ?? AGENT_START_REQUEST_TIMEOUT_MS);

  let startResponse: Response;
  let ambiguousResponse = false;
  try {
    startResponse = await fetch(
      channel === "hack" ? "/api/hack-long" : "/api/agent-long",
      {
        ...init,
        signal: timeoutController.signal,
      },
    );
    if (!startResponse.ok) {
      // Startup conflicts use { error, message }, whereas ordinary app
      // failures use { code, cause, metadata }. Preserve the actual HTTP
      // status: a 500 mentioning run_active is not safe to retry.
      const body = await startResponse
        .clone()
        .json()
        .catch(() => null);
      ambiguousResponse =
        startResponse.status >= 500 ||
        (startResponse.status === 409 && body?.error === "dispatch_pending");
      if (startResponse.status === 409 && body?.error === "run_active") {
        throw new AgentRunActiveError(
          typeof body.message === "string"
            ? body.message
            : "A run is already active in this chat.",
        );
      }
      if (typeof body?.code === "string") {
        throw new ChatSDKError(
          body.code as ErrorCode,
          body.cause,
          body.metadata,
        );
      }
      // Leave malformed/unknown responses intact for the SDK's normal error
      // path. Neither this adapter nor auto-continue retries them.
    }
  } catch (error) {
    clearTimeout(timeoutId);
    const recovered =
      !(error instanceof AgentRunActiveError) &&
      !(error instanceof ChatSDKError)
        ? await recoverAgentDispatch(init, 3000, channel)
        : null;
    if (recovered) {
      startResponse = recovered;
    } else {
      if (didTimeout && !externalSignal?.aborted)
        throw new Error(AGENT_START_TIMEOUT_MESSAGE);
      if (typeof navigator !== "undefined" && !navigator.onLine)
        throw new ChatSDKError("offline:chat");
      throw error;
    }
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", forwardExternalAbort);
  }

  if (!startResponse.ok && ambiguousResponse) {
    startResponse =
      (await recoverAgentDispatch(init, 3000, channel)) ?? startResponse;
  }
  if (
    channel === "hack" &&
    (await isConfirmedHackCancellation(startResponse, init))
  )
    return buildTerminalSSEResponse({ type: "abort" });
  if (!startResponse.ok) return startResponse;

  let handle: RunHandle;
  try {
    handle = await readRunHandle(startResponse);
  } catch (error) {
    const recovered = await recoverAgentDispatch(init, 3000, channel);
    if (!recovered) throw error;
    if (
      channel === "hack" &&
      (await isConfirmedHackCancellation(recovered, init))
    )
      return buildTerminalSSEResponse({ type: "abort" });
    handle = await readRunHandle(recovered);
  }
  if (handle.requestContext) onRequestContext?.(handle.requestContext);
  return buildSSEResponseFromRun(
    handle,
    init?.signal ?? undefined,
    timings?.firstEventTimeoutMs,
  );
};

export const resumeAgentLongStream = async (
  url: string,
  init: RequestInit | undefined,
  onDurableReplay?: (runId: string) => void,
  onRequestContext?: (context: AgentResumeRequestContext) => void,
): Promise<Response> => {
  // useChat's reconnectToStream signals "nothing to resume" by treating a
  // 204 as null. /api/agent-long/resume returns 204 when the chat has no
  // active run (or the stored run hit a terminal state); pass that through.
  // HttpChatTransport obtains the reconnect response before it creates its
  // internal active response. Retry only transient setup failures, with an
  // abort-aware short backoff. Durable Trigger streams replay from the start,
  // so a successful retry restores the same in-flight assistant turn.
  const response = await fetchDurableResume(url, init);
  if (response.status === 204) return response;
  if (!response.ok) return response;
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    return response;
  }

  const handle = await readRunHandle(response);
  // A terminal run will never emit another live chunk: its stream can only
  // replay history. Surface the failure instead of replaying into silence.
  const status = await readRunStatus(handle.runId, handle.publicAccessToken);
  if (status && TERMINAL_RUN_STATUSES.has(status)) {
    return buildTerminalSSEResponse({
      type: "error",
      errorText: AGENT_WORKER_FAILED_MESSAGE,
    });
  }
  // Seed the session before starting the replay: it may already contain the
  // signal that hands this run off to its next bounded continuation leg.
  if (handle.requestContext) onRequestContext?.(handle.requestContext);
  const replay = await buildSSEResponseFromRun(
    handle,
    init?.signal ?? undefined,
  );
  onDurableReplay?.(handle.runId);
  return replay;
};
