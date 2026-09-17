"use client";

import { useEffect, useRef, useCallback } from "react";
import type { ChatStatus, MessageMetadata, Todo } from "@/types";
import {
  useDataStreamState,
  useDataStreamDispatch,
} from "@/app/components/DataStreamProvider";
import { useLatestRef } from "./useLatestRef";

export const MAX_AUTO_CONTINUES = 5;
/** Consecutive 58-minute Build legs allowed before asking the user. */
export const MAX_BUILD_TIME_LEGS = 3;
const RUN_ACTIVE_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

function isRunActiveConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const conflict = error as { statusCode?: unknown; code?: unknown };
  return conflict.statusCode === 409 && conflict.code === "run_active";
}

interface ContinuationAttempt {
  hasDispatched: boolean;
  handleError: (error: unknown) => void;
}

export interface UseAutoContinueParams {
  enabled?: boolean;
  status: ChatStatus;
  error?: unknown;
  chatMode: string;
  chatPurpose: string;
  sendMessage: (
    message?: { text: string; metadata?: MessageMetadata },
    options?: { body?: Record<string, unknown> },
  ) => void | Promise<void>;
  hasManuallyStoppedRef: React.RefObject<boolean>;
  todos: Todo[];
  temporaryChatsEnabled: boolean;
  sandboxPreference: string;
  selectedModel: string;
}

export function useAutoContinue({
  enabled = true,
  status,
  error,
  chatMode,
  chatPurpose,
  sendMessage,
  hasManuallyStoppedRef,
  todos,
  temporaryChatsEnabled,
  sandboxPreference,
  selectedModel,
}: UseAutoContinueParams) {
  const { dataStream } = useDataStreamState();
  const { setIsAutoResuming, setAutoContinueCount } = useDataStreamDispatch();
  const autoContinueCountRef = useRef(0);
  const pendingAutoContinueRef = useRef(false);
  const pendingBuildTimeoutRef = useRef(false);
  const buildTimeLegCountRef = useRef(0);
  const lastProcessedIndexRef = useRef(0);
  const dataStreamLengthRef = useRef(0);
  const seenContinuationIdsRef = useRef(new Set<string>());
  const attemptRef = useRef<ContinuationAttempt | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousSurfaceRef = useRef({ chatMode, chatPurpose });

  const todosRef = useLatestRef(todos);
  const sendMessageRef = useLatestRef(sendMessage);
  const chatModeRef = useLatestRef(chatMode);
  const chatPurposeRef = useLatestRef(chatPurpose);
  const temporaryChatsEnabledRef = useLatestRef(temporaryChatsEnabled);
  const sandboxPreferenceRef = useLatestRef(sandboxPreference);
  const selectedModelRef = useLatestRef(selectedModel);
  const statusRef = useLatestRef(status);

  const cancelAttempt = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    attemptRef.current = null;
  }, []);

  useEffect(
    () => () => {
      cancelAttempt();
      setIsAutoResuming(false);
    },
    [cancelAttempt, setIsAutoResuming],
  );

  useEffect(() => {
    if (!enabled) return;
    const previous = previousSurfaceRef.current;
    previousSurfaceRef.current = { chatMode, chatPurpose };
    if (previous.chatMode === chatMode && previous.chatPurpose === chatPurpose)
      return;
    cancelAttempt();
    pendingAutoContinueRef.current = false;
    pendingBuildTimeoutRef.current = false;
    setIsAutoResuming(false);
  }, [enabled, cancelAttempt, chatMode, chatPurpose, setIsAutoResuming]);

  // Detect data-auto-continue signal and immediately mark pending
  useEffect(() => {
    if (!enabled) return;
    dataStreamLengthRef.current = dataStream?.length ?? 0;
    if (!dataStream?.length) return;

    const startIndex = Math.min(
      lastProcessedIndexRef.current,
      dataStream.length,
    );
    const newParts = dataStream.slice(startIndex);
    let foundEligibleSignal = false;

    newParts.forEach((part, index) => {
      if (part.type !== "data-auto-continue") return;
      const data = part.data as
        | {
            shouldContinue?: boolean;
            continuationId?: unknown;
            reason?: unknown;
          }
        | undefined;
      if (data?.shouldContinue === false) return;

      const continuationId =
        typeof data?.continuationId === "string" && data.continuationId
          ? data.continuationId
          : `legacy-stream-index:${startIndex + index}`;
      if (seenContinuationIdsRef.current.has(continuationId)) return;
      seenContinuationIdsRef.current.add(continuationId);

      const reason = typeof data?.reason === "string" ? data.reason : undefined;
      const isTimeLimit =
        reason === "timeout" || reason === "preemptive-timeout";
      if (isTimeLimit && chatPurpose !== "app") return;
      if (chatMode !== "agent" || hasManuallyStoppedRef.current) return;

      foundEligibleSignal = true;
      if (isTimeLimit && chatPurpose === "app") {
        pendingBuildTimeoutRef.current = true;
      }
    });

    if (foundEligibleSignal) {
      pendingAutoContinueRef.current = true;
      setIsAutoResuming(true);
    }
    lastProcessedIndexRef.current = dataStream.length;
  }, [
    enabled,
    chatMode,
    chatPurpose,
    dataStream,
    hasManuallyStoppedRef,
    setIsAutoResuming,
  ]);

  // Fire auto-continue when status is ready and signal was detected.
  // Depends on both `status` and `dataStream` so it re-evaluates when
  // the signal arrives after the stream has already ended (status already "ready").
  useEffect(() => {
    if (
      !enabled ||
      status !== "ready" ||
      !pendingAutoContinueRef.current ||
      attemptRef.current
    )
      return;
    if (hasManuallyStoppedRef.current || chatMode !== "agent") {
      pendingAutoContinueRef.current = false;
      pendingBuildTimeoutRef.current = false;
      setIsAutoResuming(false);
      return;
    }
    // The ordinary cap still protects context/tool loops. A Build wall-clock
    // boundary is different: it is an expected durable-run segment hand-off,
    // so it may pass the ordinary cap — but only MAX_BUILD_TIME_LEGS times.
    // Unbounded, a build that never converges would chain hour-long legs and
    // spend the whole balance; after three the user decides whether to go on.
    const atOrdinaryCap = autoContinueCountRef.current >= MAX_AUTO_CONTINUES;
    const isBuildTimeLeg =
      pendingBuildTimeoutRef.current && chatPurpose === "app";
    let bypassContinuationCap = false;
    if (atOrdinaryCap && isBuildTimeLeg) {
      bypassContinuationCap =
        buildTimeLegCountRef.current < MAX_BUILD_TIME_LEGS;
    }
    if (atOrdinaryCap && !bypassContinuationCap) {
      pendingAutoContinueRef.current = false;
      pendingBuildTimeoutRef.current = false;
      setIsAutoResuming(false);
      return;
    }

    let retries = 0;
    let failureHandled = false;
    let options: { body: Record<string, unknown> } | undefined;
    const attempt: ContinuationAttempt = {
      hasDispatched: false,
      handleError: (failure) => {
        if (attemptRef.current !== attempt || failureHandled) return;
        failureHandled = true;
        if (hasManuallyStoppedRef.current || chatModeRef.current !== "agent") {
          cancelAttempt();
          setIsAutoResuming(false);
          return;
        }
        const delay = RUN_ACTIVE_RETRY_DELAYS_MS[retries];
        if (isRunActiveConflict(failure) && delay !== undefined) {
          retries += 1;
          setIsAutoResuming(true);
          timerRef.current = setTimeout(() => dispatch(true), delay);
          return;
        }
        cancelAttempt();
        console.error("Failed to auto-continue Agent run:", failure);
        setIsAutoResuming(false);
      },
    };

    const dispatch = (retry = false) => {
      if (attemptRef.current !== attempt) return;
      timerRef.current = null;
      // Stop, a new user turn/reset, navigation or a different active send
      // always wins over a scheduled continuation or busy-run retry.
      if (
        hasManuallyStoppedRef.current ||
        chatModeRef.current !== "agent" ||
        chatPurposeRef.current !== chatPurpose ||
        (statusRef.current !== "ready" &&
          !(retry && statusRef.current === "error"))
      ) {
        cancelAttempt();
        pendingAutoContinueRef.current = false;
        pendingBuildTimeoutRef.current = false;
        setIsAutoResuming(false);
        return;
      }
      if (!retry) {
        pendingAutoContinueRef.current = false;
        pendingBuildTimeoutRef.current = false;
        autoContinueCountRef.current += 1;
        if (bypassContinuationCap) buildTimeLegCountRef.current += 1;
        setAutoContinueCount(autoContinueCountRef.current);
        options = {
          body: {
            mode: chatModeRef.current,
            isAutoContinue: true,
            todos: todosRef.current,
            temporary: temporaryChatsEnabledRef.current,
            sandboxPreference: sandboxPreferenceRef.current,
            selectedModel: selectedModelRef.current,
            purpose: chatPurposeRef.current,
          },
        };
      }
      attempt.hasDispatched = true;
      failureHandled = false;
      try {
        // A rejected start already appended the hidden user turn in useChat.
        // Sending undefined retries that same turn; appending "continue" again
        // would duplicate the input and consume another continuation.
        const sendResult = sendMessageRef.current(
          retry
            ? undefined
            : { text: "continue", metadata: { isAutoContinue: true } },
          options,
        );
        void Promise.resolve(sendResult).catch(attempt.handleError);
      } catch (failure) {
        attempt.handleError(failure);
      }
    };

    attemptRef.current = attempt;
    setIsAutoResuming(true);
    timerRef.current = setTimeout(() => dispatch(), 500);
  }, [
    enabled,
    status,
    dataStream,
    chatMode,
    chatPurpose,
    chatModeRef,
    chatPurposeRef,
    hasManuallyStoppedRef,
    setIsAutoResuming,
    setAutoContinueCount,
    sendMessageRef,
    todosRef,
    temporaryChatsEnabledRef,
    sandboxPreferenceRef,
    selectedModelRef,
    statusRef,
    cancelAttempt,
  ]);

  // The SDK catches transport failures internally and resolves sendMessage.
  // Observe its error state as well as actual promise rejections.
  useEffect(() => {
    if (!enabled) return;
    if (status === "error" && attemptRef.current?.hasDispatched) {
      attemptRef.current.handleError(error);
    }
    if (status === "streaming") {
      if (attemptRef.current) {
        const wasOnlyScheduled = !attemptRef.current.hasDispatched;
        cancelAttempt();
        if (wasOnlyScheduled) {
          pendingAutoContinueRef.current = false;
          pendingBuildTimeoutRef.current = false;
        }
      }
      setIsAutoResuming(false);
    }
  }, [enabled, status, error, cancelAttempt, setIsAutoResuming]);

  const resetAutoContinueCount = useCallback(() => {
    cancelAttempt();
    autoContinueCountRef.current = 0;
    buildTimeLegCountRef.current = 0;
    pendingAutoContinueRef.current = false;
    pendingBuildTimeoutRef.current = false;
    // Keep the cursor at the current tail. Resetting it to zero reprocessed old
    // signals on the next data chunk and could dispatch a duplicate "continue".
    lastProcessedIndexRef.current = dataStreamLengthRef.current;
    setAutoContinueCount(0);
    setIsAutoResuming(false);
  }, [cancelAttempt, setAutoContinueCount, setIsAutoResuming]);

  return { resetAutoContinueCount };
}
