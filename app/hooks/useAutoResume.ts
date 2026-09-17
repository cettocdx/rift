"use client";

import { useEffect, useRef, useState } from "react";
import type { UseChatHelpers } from "@ai-sdk/react";
import type { ChatMessage, ChatStatus } from "@/types/chat";
import { isConnectionFailure } from "@/lib/chat/interrupted-response";
import {
  useDataStreamState,
  useDataStreamDispatch,
} from "@/app/components/DataStreamProvider";

export interface UseAutoResumeParams {
  autoResume: boolean;
  initialMessages: ChatMessage[];
  resumeStream: UseChatHelpers<ChatMessage>["resumeStream"];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  status?: ChatStatus;
  error?: unknown;
  /** Abort only the local reader; this must never cancel the durable run. */
  stopReader?: () => void | Promise<void>;
  /** A shell-owned SDK session keeps reading when its route is hidden. */
  preserveReaderOnUnmount?: boolean;
  hasManuallyStoppedRef?: React.RefObject<boolean>;
  // Tri-state: undefined = chat data still loading (wait), true = server is
  // actively producing (resume), false = no active stream (don't resume —
  // the user message went unanswered, but resuming would just GET an empty
  // SSE and waste a round-trip).
  hasActiveStream: boolean | undefined;
}

/**
 * How long the reconnect label may stand before the UI admits it is connected.
 * Under the producer's 25s heartbeat, so it never waits on one.
 */
const RESUME_LABEL_MAX_MS = 6_000;

/**
 * Hidden this long, and a stream the SDK still calls "streaming" is assumed
 * dead: mobile browsers do not keep a background page's sockets open anywhere
 * near this long, and the SDK only learns a socket died when a read fails.
 */
const RESUME_AFTER_HIDDEN_MS = 20_000;

export function useAutoResume(params: UseAutoResumeParams) {
  const {
    initialMessages,
    setMessages,
    status,
    error,
    hasActiveStream,
    autoResume,
  } = params;
  const { dataStream, isAutoResuming } = useDataStreamState();
  const { setIsAutoResuming } = useDataStreamDispatch();
  const [recoveryPending, setRecoveryPending] = useState(false);
  const latest = useRef(params);
  latest.current = params;
  const reconcileRef = useRef<() => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let initialAttempted = false;
    let automaticRecoveryUsed = false;
    let observedRun = false;
    let pending = false;
    let waitingForReader = false;
    let inFlight: Promise<void> | null = null;
    let hiddenAt: number | null = null;
    let wasOffline = navigator.onLine === false;
    let lastRecoveryAt = -Infinity;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 1_000;
    const clearRetry = () => {
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
    };
    let ownedStopReader: UseAutoResumeParams["stopReader"];

    const available = () =>
      navigator.onLine !== false && document.visibilityState !== "hidden";
    const stopped = () =>
      latest.current.hasManuallyStoppedRef?.current === true;
    const markPending = (value: boolean) => {
      pending = value;
      if (!disposed) setRecoveryPending(value);
    };
    const settle = () => {
      waitingForReader = false;
      markPending(false);
      if (!disposed) setIsAutoResuming(false);
    };

    const scheduleRetry = () => {
      const current = latest.current;
      if (
        disposed ||
        stopped() ||
        retryTimer !== undefined ||
        inFlight ||
        !available() ||
        current.hasActiveStream !== true ||
        current.status === "streaming" ||
        current.status === "submitted"
      )
        return;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        requestRecovery();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30_000);
    };

    const drive = () => {
      if (disposed || !pending) return;
      if (stopped()) {
        settle();
        return;
      }
      const current = latest.current;
      // SDK stop() resolves before its response finalizer. Wait for both the
      // observed idle status and our previous resume promise before reattaching.
      if (
        current.status === "streaming" ||
        current.status === "submitted" ||
        inFlight
      )
        return;
      if (!available()) return;
      if (current.hasActiveStream === undefined) return;
      if (!current.hasActiveStream) {
        settle();
        return;
      }
      waitingForReader = false;
      automaticRecoveryUsed = true;
      lastRecoveryAt = Date.now();
      setIsAutoResuming(true);
      ownedStopReader = current.stopReader;
      let result: Promise<void>;
      try {
        result = Promise.resolve(current.resumeStream());
      } catch (failure) {
        settle();
        if (isConnectionFailure(failure)) scheduleRetry();
        return;
      }
      inFlight = result;
      const finish = (failure?: unknown) => {
        if (disposed || inFlight !== result) return;
        inFlight = null;
        if (waitingForReader) {
          // A wake interrupted this reader; its own cleanup has now completed.
          drive();
        } else {
          settle();
          const current = latest.current;
          if (
            isConnectionFailure(failure) ||
            (failure === undefined &&
              current.status === "error" &&
              isConnectionFailure(current.error))
          ) {
            scheduleRetry();
          }
        }
      };
      void result.then(() => finish(), finish);
    };

    const requestRecovery = (forceReaderReplacement = false) => {
      const current = latest.current;
      if (disposed || stopped() || !available()) return;
      if (!current.autoResume && !observedRun) return;
      // A POST still being accepted may already have started durable work.
      // Never abort/resend it just because an online/visibility hint arrived.
      if (current.status === "submitted") return;
      if (current.status === "streaming") {
        if (!forceReaderReplacement || !current.stopReader || waitingForReader)
          return;
        // Coalesce visibility/pageshow/online hints emitted together on wake.
        if (Date.now() - lastRecoveryAt < 1_000) return;
        lastRecoveryAt = Date.now();
        markPending(true);
        waitingForReader = true;
        setIsAutoResuming(true);
        ownedStopReader = current.stopReader;
        // This is a subscriber abort, not the user's Stop action. No run cancel
        // endpoint is called and the user's stopped flag is left untouched.
        try {
          void Promise.resolve(current.stopReader()).catch(settle);
        } catch {
          settle();
        }
        return;
      }
      if (pending || inFlight || current.hasActiveStream !== true) return;
      clearRetry();
      markPending(true);
      drive();
    };

    const reconcile = () => {
      const current = latest.current;
      if (current.status === "streaming" || current.status === "submitted") {
        observedRun = true;
        // This mounted session already owns a reader/send. Late persistence
        // and a not-yet-cleared active pointer are not an initial attachment.
        // Otherwise a completed new chat is reset and replayed from scratch.
        // Explicit wake/error recovery remains available below.
        initialAttempted = true;
      }
      if (current.status === "submitted" && !inFlight && !waitingForReader) {
        automaticRecoveryUsed = false;
      }
      if (stopped()) {
        clearRetry();
        settle();
        return;
      }
      if (
        current.hasActiveStream === false ||
        current.status === "submitted" ||
        current.status === "ready"
      ) {
        clearRetry();
        retryDelay = 1_000;
      }
      if (waitingForReader && current.status === "submitted") {
        // A new user send takes precedence over queued recovery.
        settle();
        automaticRecoveryUsed = false;
      }
      if (current.status === "streaming" && !waitingForReader) {
        clearRetry();
        retryDelay = 1_000;
        setIsAutoResuming(false);
        // The resume promise spans the whole run, but recovery has succeeded.
        markPending(false);
      }
      if (!initialAttempted && current.autoResume && current.hasActiveStream) {
        if (current.status === "submitted" || current.status === "streaming") {
          initialAttempted = true;
        } else if (available()) {
          initialAttempted = true;
          requestRecovery();
        }
      }
      // A lost POST acknowledgement is ambiguous, but a confirmed durable
      // producer is safe to reattach to. Failed GET attachments retry with
      // backoff; they never resubmit the user's POST or repeat tool actions.
      if (
        current.status === "error" &&
        observedRun &&
        !automaticRecoveryUsed &&
        current.hasActiveStream &&
        isConnectionFailure(current.error)
      ) {
        requestRecovery();
      }
      // React observes ready after the SDK's synchronous finalizer. Defer the
      // attach as well so an older reader cannot clear the new activeResponse.
      if (waitingForReader) void Promise.resolve().then(drive);
    };
    reconcileRef.current = reconcile;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const slept =
        hiddenAt !== null && Date.now() - hiddenAt > RESUME_AFTER_HIDDEN_MS;
      hiddenAt = null;
      requestRecovery(slept || wasOffline);
      reconcile();
    };
    const onOffline = () => {
      wasOffline = true;
    };
    const onOnline = () => {
      wasOffline = false;
      requestRecovery(true);
      reconcile();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        requestRecovery(true);
        reconcile();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);
    reconcile();
    return () => {
      disposed = true;
      clearRetry();
      reconcileRef.current = () => {};
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pageshow", onPageShow);
      if (
        !latest.current.preserveReaderOnUnmount &&
        (inFlight || waitingForReader)
      ) {
        try {
          void Promise.resolve(ownedStopReader?.()).catch(() => {});
        } catch {
          /* Already detached. */
        }
      }
      setIsAutoResuming(false);
    };
  }, [setIsAutoResuming]);

  useEffect(() => {
    reconcileRef.current();
  }, [status, error, hasActiveStream, autoResume, initialMessages.length]);

  /**
   * Stop saying "Connecting" once we plainly are.
   *
   * Reattaching to a run that is mid-tool-call produces no output until that
   * tool returns -- a build can take minutes -- and the only thing that was
   * clearing this label early is a stream part. The producer sends a heartbeat
   * every 25 seconds, so the honest worst case was 25 seconds of a
   * "Connecting" label sitting over a connection that had already succeeded,
   * and if that heartbeat went missing there was nothing else to clear it at
   * all. The word was wrong in both cases: the reconnect is not still in
   * progress, the agent is simply busy.
   *
   * The window is deliberately shorter than the heartbeat interval, so it
   * expires before the thing it is covering for would have arrived. What the
   * UI falls back to is its ordinary working state, which is the truth.
   */
  useEffect(() => {
    if (!isAutoResuming) return;
    const timer = setTimeout(
      () => setIsAutoResuming(false),
      RESUME_LABEL_MAX_MS,
    );
    return () => clearTimeout(timer);
  }, [isAutoResuming, setIsAutoResuming]);

  useEffect(() => {
    if (!dataStream) return;
    if (dataStream.length === 0) return;

    const dataPart = dataStream[0];
    if (dataPart.type === "data-appendMessage") {
      const message = JSON.parse(dataPart.data);
      setMessages([...initialMessages, message]);
      // First message arrived, we can allow Stop button again
      setIsAutoResuming(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataStream, initialMessages, setMessages]);

  return recoveryPending;
}
