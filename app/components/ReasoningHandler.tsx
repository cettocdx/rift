"use client";

import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { UIMessage } from "@ai-sdk/react";
import type { ChatStatus } from "@/types";
import { MemoizedMarkdown } from "./MemoizedMarkdown";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { buildReasoningPresentation } from "@/lib/chat/reasoning-presentation";
import {
  collectReasoningRunText,
  hasVisibleReasoningText,
  isReasoningRunStreaming,
} from "@/lib/chat/reasoning-state";

type ReasoningHandlerProps = {
  message: UIMessage;
  partIndex: number;
  status: ChatStatus;
  isLastMessage?: boolean;
};

// Custom comparison for reasoning handler
function areReasoningPropsEqual(
  prev: ReasoningHandlerProps,
  next: ReasoningHandlerProps,
): boolean {
  if (prev.status !== next.status) return false;
  if (prev.message.id !== next.message.id) return false;
  if (prev.isLastMessage !== next.isLastMessage) return false;
  if (prev.partIndex !== next.partIndex) return false;
  // The visible transcript can span multiple adjacent reasoning parts. Compare
  // the entire run rather than only the first part, otherwise a provider that
  // appends to a later reasoning part can leave the UI visually frozen.
  if (prev.message.parts.length !== next.message.parts.length) return false;
  if (
    prev.message.parts[prev.partIndex - 1]?.type !==
    next.message.parts[next.partIndex - 1]?.type
  )
    return false;
  if (
    isReasoningRunStreaming({ ...prev, parts: prev.message.parts }) !==
    isReasoningRunStreaming({ ...next, parts: next.message.parts })
  )
    return false;
  const prevPart = prev.message.parts[prev.partIndex];
  const nextPart = next.message.parts[next.partIndex];
  if (prevPart?.type !== nextPart?.type) return false;
  if (prevPart?.type === "reasoning" && nextPart?.type === "reasoning") {
    return (
      collectReasoningRunText(prev.message.parts, prev.partIndex) ===
      collectReasoningRunText(next.message.parts, next.partIndex)
    );
  }
  return true;
}

export const ReasoningHandler = memo(function ReasoningHandler({
  message,
  partIndex,
  status,
  isLastMessage,
}: ReasoningHandlerProps) {
  // Memoize parts array reference to avoid recreation
  const parts = useMemo(
    () => (Array.isArray(message.parts) ? message.parts : []),
    [message.parts],
  );
  const currentPart = parts[partIndex];

  // Memoize combined text collection - only recompute when parts or index changes
  const combined = useMemo(() => {
    if (currentPart?.type !== "reasoning") return "";
    // Skip if previous part is also reasoning (avoid duplicate renders)
    const previousPart = parts[partIndex - 1];
    if (previousPart?.type === "reasoning") return "";
    return collectReasoningRunText(parts, partIndex);
  }, [parts, partIndex, currentPart?.type]);

  // Early return for non-reasoning parts
  if (currentPart?.type !== "reasoning") return null;

  // Skip if previous part is also reasoning (avoid duplicate renders)
  const previousPart = parts[partIndex - 1];
  if (previousPart?.type === "reasoning") return null;

  // Don't show reasoning if empty or only contains [REDACTED] (encrypted reasoning from providers like Gemini)
  if (!hasVisibleReasoningText(combined)) return null;

  const isStreaming = isReasoningRunStreaming({
    parts,
    partIndex,
    status,
    isLastMessage,
  });
  const presentation = isStreaming
    ? buildReasoningPresentation(combined, true)
    : null;

  return (
    <Reasoning
      data-ui="reasoning"
      data-streaming={isStreaming ? "true" : "false"}
      isStreaming={isStreaming}
      className="my-1 w-full border-0 bg-transparent p-0 shadow-none"
    >
      <ReasoningTrigger
        aria-label={presentation?.title}
        data-presentation-source={presentation?.source}
        getThinkingMessage={presentation ? () => presentation.title : undefined}
      />
      <ReasoningContent>
        <LiveReasoningViewport streaming={isStreaming} contentKey={combined}>
          <div data-ui="reasoning-copy" className="[&_code]:font-mono">
            <MemoizedMarkdown content={combined} />
          </div>
        </LiveReasoningViewport>
      </ReasoningContent>
    </Reasoning>
  );
}, areReasoningPropsEqual);

/** Follow the live tail until the reader scrolls into history. Keep the same
 * scroll container on completion so that reading position never disappears. */
export function LiveReasoningViewport({
  streaming,
  contentKey,
  children,
}: {
  streaming: boolean;
  contentKey: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const followingRef = useRef(true);
  const wasStreamingRef = useRef(streaming);
  const [following, setFollowing] = useState(true);

  useLayoutEffect(() => {
    // Include a final delta delivered together with the completed state, but
    // never jump to the end when opening an already completed transcript.
    const wasLive = streaming || wasStreamingRef.current;
    wasStreamingRef.current = streaming;
    if (!wasLive || !followingRef.current) return;
    const el = ref.current;
    if (el) el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
  }, [streaming, contentKey]);

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Reasoning transcript"
      tabIndex={0}
      data-ui="reasoning-live-viewport"
      data-streaming={streaming ? "true" : "false"}
      data-following={following ? "true" : "false"}
      className="rift-reasoning-live"
      onScroll={(event) => {
        const el = event.currentTarget;
        const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop <= 12;
        followingRef.current = atBottom;
        setFollowing(atBottom);
      }}
    >
      {children}
    </div>
  );
}
