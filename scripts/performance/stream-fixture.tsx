import {
  buildStreamHistory,
  historyMessage,
  toolOutput,
} from "./stream-history.cjs";
import React, { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoizedMarkdown } from "../../app/components/MemoizedMarkdown";
import {
  AssistantTranscript,
  type TranscriptPart,
} from "../../app/components/AssistantTranscript";
import { MessageActions } from "../../app/components/MessageActions";
import { useMessageScroll } from "../../app/hooks/useMessageScroll";

// Owned, synthetic replay: no account, provider, worker, or network requests.
const scenario = new URLSearchParams(location.search).get("scenario");
const chatScroll =
  new URLSearchParams(location.search).get("scroll") === "chat";
const mixed = scenario === "mixed" || scenario === "code";
const updates = Math.max(
  120,
  Math.min(
    2400,
    Number(new URLSearchParams(location.search).get("updates")) || 120,
  ),
);
const escapedHistory =
  new URLSearchParams(location.search).get("history") === "escaped";
const base = buildStreamHistory(mixed, escapedHistory);
const work: TranscriptPart[] = Array.from({ length: 60 }, (_, i) => [
  { type: "reasoning", text: `Checking synthetic file ${i}.`, state: "done" },
  {
    type: "tool-run_terminal_cmd",
    toolCallId: `command-${i}`,
    state: "output-available",
    input: { command: `test fixture-${i}` },
    output: { stdout: toolOutput(i, escapedHistory) },
  },
]).flat();
const history = Array.from({ length: 200 }, (_, i) => (
  <article key={i} className="history-row" data-message-id={`history-${i}`}>
    <MemoizedMarkdown content={historyMessage(i, escapedHistory)} />
  </article>
));

function Draft() {
  const [value, setValue] = useState("");
  return (
    <input
      aria-label="Draft"
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}

function ScrollSurface({ children }: { children: React.ReactNode }) {
  const { scrollRef, contentRef, isAtBottom } = useMessageScroll(
    undefined,
    chatScroll,
  );
  if (!chatScroll) return <>{children}</>;
  return (
    <div id="chat-scroll" ref={scrollRef} data-following={isAtBottom}>
      <div ref={contentRef}>{children}</div>
    </div>
  );
}

function App() {
  const renderStartedAt = (window as any).recordReplayTiming
    ? performance.now()
    : 0;
  const [text, setText] = useState(base);
  const [panel, setPanel] = useState(false);
  const [edited, setEdited] = useState(false);
  useLayoutEffect(() => {
    (window as any).recordReplayTiming?.({
      kind: "react-commit",
      startTime: renderStartedAt,
      duration: performance.now() - renderStartedAt,
      textLength: text.length,
      panel,
    });
  });
  (window as any).startReplay = () =>
    new Promise<void>((done) => {
      let n = 0;
      const timer = setInterval(() => {
        n++;
        (window as any).recordReplayTiming?.({
          kind: "stream-update",
          startTime: performance.now(),
          update: n,
        });
        setText(
          scenario === "code"
            ? base +
                "\n\n```typescript\n" +
                Array.from(
                  { length: n * 3 },
                  (_, i) =>
                    `export const item${i} = { name: "Synthetic item ${i}", enabled: true, value: ${i} };\n`,
                ).join("") +
                (n === updates ? "```\n\nStreaming output. " : "")
            : base + "\n\nLatest result: " + "Streaming output. ".repeat(n),
        );
        if (n === updates) {
          clearInterval(timer);
          done();
        }
      }, 25);
    });
  const parts: TranscriptPart[] = [...work, { type: "text", text }];
  return (
    <>
      <nav>
        <Draft />
        <button onClick={() => setPanel((v) => !v)}>Toggle panel</button>
      </nav>
      <main style={{ width: panel ? "60%" : "100%" }}>
        <ScrollSurface>
          <section
            id="actions-fixture"
            className="group/message"
            data-message-id="actions"
          >
            <p>Historical message</p>
            <MessageActions
              messageText="Historical message"
              isUser
              isLastAssistantMessage={false}
              canRegenerate={false}
              onRegenerate={() => {}}
              onEdit={() => setEdited(true)}
              isHovered={false}
              isEditing={false}
              status="ready"
              messageCreatedAt={1_780_000_000_000}
            />
            {edited && <span id="edit-confirmed">Edit selected</span>}
          </section>
          {mixed && <section id="history">{history}</section>}
          <section id="live" data-message-id="live">
            {mixed ? (
              <AssistantTranscript
                parts={parts}
                status="streaming"
                renderPart={(i) =>
                  parts[i].type === "text" ? (
                    <MemoizedMarkdown revealWords content={parts[i].text!} />
                  ) : (
                    <pre className="tool-output">
                      {parts[i].text ??
                        JSON.stringify(parts[i].output, null, 2)}
                    </pre>
                  )
                }
              />
            ) : (
              <MemoizedMarkdown revealWords content={text} />
            )}
          </section>
        </ScrollSurface>
      </main>
      {panel && <aside>Activity details</aside>}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
