"use client";
import { memo, useEffect, useMemo, useState, type RefObject } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ChatMessage } from "@/types";
import { extractMessageText } from "@/lib/utils/message-utils";

interface ConversationOutlineProps {
  messages: ChatMessage[];
  scrollRef: RefObject<HTMLDivElement | null>;
}

function ConversationOutlineView({
  messages,
  scrollRef,
}: ConversationOutlineProps) {
  const turns = useMemo(
    () =>
      messages
        .filter((m) => m.role === "user")
        .map((m) => ({
          id: m.id,
          text: extractMessageText(m.parts) || "Attached files",
        })),
    [messages],
  );
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    // Message rows are ordered vertically. Cache the available user anchors
    // and locate the active one without forcing layout for every offscreen row.
    const anchors = turns.flatMap((turn) => {
      const node = scroller.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(turn.id)}"]`,
      );
      return node ? [{ id: turn.id, node }] : [];
    });
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = scroller.getBoundingClientRect().top + 100;
        let current = turns[0]?.id ?? null;
        let low = 0;
        let high = anchors.length - 1;
        while (low <= high) {
          const middle = (low + high) >>> 1;
          if (anchors[middle].node.getBoundingClientRect().top <= top) {
            current = anchors[middle].id;
            low = middle + 1;
          } else high = middle - 1;
        }
        setActive(current);
      });
    };
    scroller.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    if (scroller.firstElementChild)
      observer.observe(scroller.firstElementChild);
    update();
    return () => {
      scroller.removeEventListener("scroll", update);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [turns, scrollRef]);
  if (turns.length < 2) return null;
  return (
    <nav
      aria-label="Conversation outline"
      className="rift-conversation-outline"
    >
      {turns.map((turn, index) => (
        <Tooltip key={turn.id} delayDuration={150}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`Jump to message ${index + 1}: ${turn.text.slice(0, 70)}`}
              aria-current={active === turn.id ? "location" : undefined}
              onClick={() => {
                const scroller = scrollRef.current;
                const node = scroller?.querySelector<HTMLElement>(
                  `[data-message-id="${CSS.escape(turn.id)}"]`,
                );
                if (!scroller || !node) return;
                // Scroll only the conversation, never the app shell or the composer.
                scroller.scrollTo({
                  top:
                    scroller.scrollTop +
                    node.getBoundingClientRect().top -
                    scroller.getBoundingClientRect().top -
                    20,
                  behavior: matchMedia("(prefers-reduced-motion: reduce)")
                    .matches
                    ? "instant"
                    : "smooth",
                });
              }}
            >
              <span />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="right"
            sideOffset={12}
            className="rift-conversation-preview"
          >
            <span className="mb-1 block text-[11px] text-muted-foreground">
              Message {index + 1}
            </span>
            <p className="line-clamp-4 whitespace-pre-wrap text-[13px] leading-5">
              {turn.text.slice(0, 500)}
            </p>
          </TooltipContent>
        </Tooltip>
      ))}
    </nav>
  );
}

// The outline represents user turns only. Assistant deltas must not rebuild its
// scroll subscription or resize observer. Immutable user edits still invalidate it.
export const ConversationOutline = memo(
  ConversationOutlineView,
  (previous, next) => {
    if (previous.scrollRef !== next.scrollRef) return false;
    let previousIndex = 0;
    let nextIndex = 0;
    while (true) {
      while (
        previousIndex < previous.messages.length &&
        previous.messages[previousIndex].role !== "user"
      )
        previousIndex++;
      while (
        nextIndex < next.messages.length &&
        next.messages[nextIndex].role !== "user"
      )
        nextIndex++;
      const previousUser = previous.messages[previousIndex];
      const nextUser = next.messages[nextIndex];
      if (previousUser !== nextUser) return false;
      if (!previousUser) return true;
      previousIndex++;
      nextIndex++;
    }
  },
);
