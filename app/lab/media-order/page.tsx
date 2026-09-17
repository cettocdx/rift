"use client";

import { useMemo, useState } from "react";
import { MessageItem } from "@/app/components/MessageItem";
import { useMessageScroll } from "@/app/hooks/useMessageScroll";
import type { ChatMessage } from "@/types";

const noop = () => {};
const asyncNoop = async () => {};
/** Local replay of the real message renderer. No model calls or saved messages. */
export default function MediaOrderPreview() {
  const [count, setCount] = useState(0);
  const [done, setDone] = useState(false);
  const [panel, setPanel] = useState(false);
  const view = useMemo(() => ({}), []);
  const { scrollRef, contentRef } = useMessageScroll(view);
  const message = useMemo(
    () =>
      ({
        id: "media-order-fixture",
        role: "assistant",
        metadata: { mode: "agent" },
        parts: [
          {
            type: "text",
            text: "The composition is ready. The generated image follows this introduction.",
          },
          {
            type: "tool-generate_image",
            toolCallId: "fixture-image",
            state: "output-available",
            input: { aspectRatio: "16:9" },
            output: { url: "/scroll-fixture.svg", mediaType: "image/svg+xml" },
          },
          ...Array.from({ length: count }, (_, i) => ({
            type: "text",
            text: `After-image paragraph ${i + 1}. This explanation must stay below the generated image as the response grows.`,
          })),
        ],
      }) as unknown as ChatMessage,
    [count],
  );
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b px-4 text-sm">
        <span>Media order · local replay</span>
        <button onClick={() => setCount((c) => c + 1)}>
          Append explanation
        </button>
        <button onClick={() => setDone(true)}>Finish response</button>
        <button onClick={() => setPanel((p) => !p)}>Toggle panel</button>
      </header>
      <div className="flex min-h-0 flex-1">
        <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto">
          <div ref={contentRef} className="mx-auto max-w-[840px] p-6">
            <MessageItem
              message={message}
              isLastMessage
              isLastAssistantMessage
              isBranchBoundary={false}
              status={done ? "ready" : "streaming"}
              isHovered={false}
              isEditing={false}
              feedbackInputMessageId={null}
              mode="agent"
              onMouseEnter={noop}
              onMouseLeave={noop}
              onStartEdit={noop}
              onSaveEdit={asyncNoop}
              onCancelEdit={noop}
              onRegenerate={noop}
              onFeedback={noop}
              onFeedbackSubmit={asyncNoop}
              onFeedbackCancel={noop}
              onShowAllFiles={noop}
              getCachedUrl={() => undefined}
            />
          </div>
        </div>
        {panel && (
          <aside className="w-[35%] border-l p-4 text-sm">Preview panel</aside>
        )}
      </div>
    </div>
  );
}
