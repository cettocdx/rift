"use client";

import { RootShellPresence } from "@/app/components/RootShellPresence";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AssistantTranscript,
  type TranscriptPart,
} from "@/app/components/AssistantTranscript";
import { MemoizedMarkdown } from "@/app/components/MemoizedMarkdown";
import { CursorThinking } from "@/components/ui/cursor-thinking";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/ai-elements/reasoning";

const answer =
  "Dosyaları inceledim ve menü geçişini düzelttim.\n\n### Değişen davranış\n\n- Mesaj gönderildiğinde sohbet genişliği korunuyor.\n- Araç ayrıntıları ilgili satırdan açılıyor.\n- Klavye odağı yazı alanında kalıyor.\n\n`Sidebar.tsx` içindeki görünüm artık kullanıcı seçimine bağlı.\n\n```tsx\nconst [detailsOpen, setDetailsOpen] = useState(false);\n```\n\n| Kontrol | Sonuç |\n| --- | --- |\n| Menü geçişi | Geçti |\n| Dar ekran | Geçti |";

/** Development-only replay with local fixture data. No messages or runs are sent. */
export default function ConversationPreview() {
  const [stage, setStage] = useState<
    "ready" | "starting" | "tools" | "agents" | "writing" | "done"
  >("done");
  const [length, setLength] = useState(answer.length);
  const [startedAt, setStartedAt] = useState(0);
  useEffect(() => {
    if (stage === "starting") {
      const id = setTimeout(() => setStage("tools"), 1200);
      return () => clearTimeout(id);
    }
    if (stage === "tools") {
      const id = setTimeout(() => setStage("agents"), 2200);
      return () => clearTimeout(id);
    }
    if (stage === "agents") {
      const id = setTimeout(() => setStage("writing"), 2500);
      return () => clearTimeout(id);
    }
    if (stage !== "writing") return;
    let visibleLength = 0;
    const id = setInterval(() => {
      visibleLength = Math.min(answer.length, visibleLength + 12);
      setLength(visibleLength);
      if (visibleLength === answer.length) {
        clearInterval(id);
        setStage("done");
      }
    }, 70);
    return () => clearInterval(id);
  }, [stage]);
  const running =
    stage === "starting" ||
    stage === "tools" ||
    stage === "agents" ||
    stage === "writing";
  const parts: TranscriptPart[] = [
    {
      type: "text",
      text: "Önce menünün açılma koşulunu ve ilgili testleri kontrol ediyorum.",
    },
    {
      type: "tool-read_file",
      input: { path: "app/components/Sidebar.tsx" },
      state: "output-available",
    },
    {
      type: "tool-shell",
      state: stage === "tools" ? "input-available" : "output-available",
    },
    ...(stage === "agents" || stage === "done" || stage === "writing"
      ? [
          {
            type: "text",
            text: "Menü geçişi düzeldi. Şimdi değişikliği tasarım ve erişilebilirlik açısından kontrol ediyorum.",
          },
          {
            type: "tool-delegate_task",
            input: { agentName: "UI review" },
            state: stage === "agents" ? "input-available" : "output-available",
            ...(stage !== "agents"
              ? {
                  output: { agent: { name: "UI review", status: "completed" } },
                }
              : {}),
          },
          {
            type: "tool-delegate_task",
            input: { agentName: "Accessibility review" },
            state: "output-available",
            output: {
              agent: { name: "Accessibility review", status: "completed" },
            },
          },
          {
            type: "tool-desktop_workspace_read",
            input: { relativePath: "Sidebar.tsx" },
            state: "output-available",
            output: { ok: true },
          },
        ]
      : []),
    ...(stage === "done" || stage === "writing"
      ? [{ type: "text", text: answer.slice(0, length) }]
      : []),
  ];
  return (
    <div className="pro-shell flex h-dvh flex-col bg-background text-foreground">
      <RootShellPresence kind="pro" />
      <header className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4 text-ui-label">
        <Link href="/" className="text-muted-foreground hover:text-foreground">
          ← Rift
        </Link>
        <span>Conversation preview · sample data</span>
        <button
          className="rounded-md border border-border px-2 py-1"
          onClick={() => {
            setLength(0);
            setStartedAt(Date.now());
            setStage("starting");
          }}
        >
          Replay response
        </button>
      </header>
      <div className="messages-scroll min-h-0 flex-1 overflow-y-auto">
        <div
          data-testid="messages-container"
          className="mx-auto w-full space-y-6 px-5 py-8"
        >
          <div data-testid="user-message" className="flex justify-end">
            <div className="rift-conversation-prose rounded-[14px] rounded-br-[6px] bg-foreground/[0.06] px-4 py-2">
              Menü geçişini düzenler misin?
            </div>
          </div>
          <div
            data-testid="assistant-message"
            className="rift-conversation-prose"
          >
            <Reasoning isStreaming={stage === "starting"}>
              <ReasoningTrigger
                getThinkingMessage={() => "Checking navigation and layout"}
              />
              <ReasoningContent>
                Mevcut menü davranışını ve test sonuçlarını inceleme.
              </ReasoningContent>
            </Reasoning>
            {stage !== "starting" ? (
              <>
                <AssistantTranscript
                  parts={parts}
                  status={running ? "streaming" : "ready"}
                  renderPart={(index) =>
                    parts[index].type === "text" ? (
                      <MemoizedMarkdown
                        content={parts[index].text ?? ""}
                        revealWords={stage === "writing"}
                      />
                    ) : (
                      <div className="my-2 rounded-md bg-muted/40 p-3">
                        <code className="font-mono text-ui-label">
                          {parts[index].type === "tool-delegate_task"
                            ? "Review: keyboard navigation and reading hierarchy checked."
                            : parts[index].type === "tool-shell"
                              ? "pnpm test — menu navigation passed"
                              : "Read Sidebar.tsx"}
                        </code>
                      </div>
                    )
                  }
                />
              </>
            ) : null}
            {running && stage !== "starting" ? (
              <CursorThinking
                phase="working"
                title={
                  stage === "tools"
                    ? "Checking menu navigation"
                    : stage === "agents"
                      ? "Reviewing the interface"
                      : stage === "writing"
                        ? "Writing the response"
                        : "Starting"
                }
                startedAt={startedAt}
              />
            ) : !running ? (
              <div className="mt-3 text-ui-caption text-muted-foreground">
                Completed · sample response
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-[720px] px-5 pb-5 pt-3">
        <div className="rounded-xl border border-border bg-background p-3">
          <textarea
            aria-label="Preview message"
            placeholder="Write a follow-up…"
            className="w-full resize-none bg-transparent text-ui outline-none"
            rows={2}
          />
          <div className="flex items-center gap-3 text-ui-label text-muted-foreground">
            <span>Build</span>
            <span>Model</span>
            <span className="ml-auto">Local preview</span>
          </div>
        </div>
      </div>
    </div>
  );
}
