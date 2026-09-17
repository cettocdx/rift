"use client";

import { useEffect, useRef, type RefObject } from "react";
import { hasTextContent } from "@/lib/utils/message-utils";
import type { ChatMessage, ChatStatus } from "@/types";

const COMPLETION_ANNOUNCEMENT = "RIFT response complete.";
const STOPPED_ANNOUNCEMENT = "RIFT response stopped.";

function isResponseInProgress(status: ChatStatus): boolean {
  return status === "submitted" || status === "streaming";
}

function isAnnounceableAssistantMessage(
  message: ChatMessage | undefined,
): boolean {
  if (message?.role !== "assistant") return false;
  return (
    hasTextContent(message.parts) ||
    message.parts.some((part) => part.type === "file")
  );
}

function findLatestUserMessageId(messages: readonly ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return messages[index].id;
  }
  return null;
}

interface AssistantCompletionAnnouncerProps {
  messages: readonly ChatMessage[];
  status: ChatStatus;
  /**
   * Set by the Stop control before the transport unwinds. Stop and a natural
   * finish both land on `status === "ready"`, so without this the only thing a
   * screen reader hears after cancelling is that the response completed --
   * which is the one thing that did not happen.
   */
  stoppedByUserRef?: RefObject<boolean>;
}

/** Announces only responses that complete during this mounted chat session. */
export function AssistantCompletionAnnouncer({
  messages,
  status,
  stoppedByUserRef,
}: AssistantCompletionAnnouncerProps) {
  const responseInProgressRef = useRef(isResponseInProgress(status));
  const activeUserMessageIdRef = useRef<string | null>(
    isResponseInProgress(status) ? findLatestUserMessageId(messages) : null,
  );
  const liveRegionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isResponseInProgress(status)) {
      responseInProgressRef.current = true;
      activeUserMessageIdRef.current =
        findLatestUserMessageId(messages) ?? activeUserMessageIdRef.current;
      if (liveRegionRef.current) liveRegionRef.current.textContent = "";
      return;
    }

    if (status !== "ready") {
      responseInProgressRef.current = false;
      activeUserMessageIdRef.current = null;
      if (liveRegionRef.current) liveRegionRef.current.textContent = "";
      return;
    }

    if (!responseInProgressRef.current) {
      if (liveRegionRef.current) liveRegionRef.current.textContent = "";
      return;
    }

    const activeUserIndex = messages.findIndex(
      (message) => message.id === activeUserMessageIdRef.current,
    );
    if (activeUserIndex < 0) {
      responseInProgressRef.current = false;
      activeUserMessageIdRef.current = null;
      return;
    }

    const stoppedByUser = stoppedByUserRef?.current === true;
    const latestMessage = messages.at(-1);
    if (
      !stoppedByUser &&
      (activeUserIndex >= messages.length - 1 ||
        !isAnnounceableAssistantMessage(latestMessage))
    ) {
      return;
    }

    responseInProgressRef.current = false;
    activeUserMessageIdRef.current = null;
    if (liveRegionRef.current) {
      // Reset first so repeated completions produce a fresh live-region change.
      liveRegionRef.current.textContent = "";
      liveRegionRef.current.textContent = stoppedByUser
        ? STOPPED_ANNOUNCEMENT
        : COMPLETION_ANNOUNCEMENT;
    }
  }, [messages, status, stoppedByUserRef]);

  return (
    <div
      ref={liveRegionRef}
      role="status"
      aria-atomic="true"
      aria-live="polite"
      className="sr-only"
    />
  );
}
