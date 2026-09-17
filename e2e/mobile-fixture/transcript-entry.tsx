import type { SidebarContent } from "../../types/chat";
import { MobileToolDialog } from "../../app/components/MobileToolDialog";
import { ComputerSidebarBase } from "../../app/components/ComputerSidebar";
import { BuildPreviewPanel } from "../../app/components/BuildPreviewPanel";
import {
  Profiler,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { ChatViewport } from "../../app/components/chat-layout/ChatViewport";
import { ProChatLayout } from "../../app/components/pro/ProChatLayout";
import { ProShellProvider } from "../../app/components/pro/ProShellContext";
import { PlanQuestions } from "../../app/components/PlanQuestions";
import { ActiveGoalStatus } from "../../app/components/ChatInput/ActiveGoalStatus";
import { browserTaskGoalStore } from "../../lib/composer/browser-goal-store";
import { ComposerSurface } from "../../app/components/ChatInput/ComposerSurface";
import { ChatInputTextarea } from "../../app/components/ChatInput/ChatInputTextarea";
import { ChatInputToolbar } from "../../app/components/ChatInput/ChatInputToolbar";
import { InputProvider } from "../../app/contexts/InputContext";
import { TooltipProvider } from "../../components/ui/tooltip";
import { ComposerState } from "./chat-shell-state";
import { onSubmitChatMessage } from "../../lib/utils/submit-message";

import { Messages } from "../../app/components/Messages";
import { useMessageScroll } from "../../app/hooks/useMessageScroll";
import {
  ChatViewStateProvider,
  useChatViewState,
} from "../../app/contexts/ChatViewStateContext";
import type { ChatMessage } from "../../types";
import { WorkbenchDock } from "../../app/components/workbench/WorkbenchDock";
import { useWorkbenchDock } from "../../app/hooks/useWorkbenchDock";
import { LiveSidebarContentProvider } from "../../app/contexts/LiveSidebarContent";
import { TranscriptDockState } from "./transcript-dock-state";
import { useResizableSplit } from "../../app/components/pro/useResizableSplit";
import dockStyles from "../../app/components/workbench/WorkbenchDock.module.css";
import {
  completionProfiler,
  beginCompletionPhase,
  recordCompletion,
} from "./completion-profile";
const completionDiagnostic = new URLSearchParams(location.search).has(
  "completion",
);
const holdActivityReady = new URLSearchParams(location.search).has(
  "holdActivityReady",
);
const withMobileTools = new URLSearchParams(location.search).has("mobileTools");
const withWorkbench = new URLSearchParams(location.search).has("workbench");
const realisticHistory = new URLSearchParams(location.search).has("realistic");
const sustainedChunks = [
  "## Live mixed output\n\n",
  "```javascript\n",
  ...Array.from(
    { length: 40 },
    (_, i) => `const streamed${i} = "${"complete source ".repeat(5)}";\n`,
  ),
  "```\n\n",
  ...Array.from(
    { length: 18 },
    (_, i) =>
      `Streaming paragraph ${i}. Continued local output remains complete.\n\n`,
  ),
];

const transcriptHistory: ChatMessage[] = Array.from({ length: 36 }, (_, i) => ({
  id: `transcript-${i}`,
  role: "assistant",
  parts: [
    {
      type: "text",
      text:
        `## Section ${i + 1}\n\n` +
        `Anchor paragraph ${i + 1}. Keep this paragraph stable while the viewport changes and later output arrives. `.repeat(
          8,
        ) +
        `\n\n## Detail ${i + 1}\n\n` +
        "Preserve this later paragraph within the same message. ".repeat(20),
    },
  ],
}));
if (new URLSearchParams(location.search).has("activityHistory")) {
  transcriptHistory[0].parts.push({
    type: "tool-run_terminal_cmd",
    toolCallId: "history-command",
    state: "output-available",
    input: { command: "printf historical-output" },
    output: { result: { output: "historical-output", exitCode: 0 } },
  } as ChatMessage["parts"][number]);
}
if (completionDiagnostic) {
  for (const index of [0, 18]) {
    const part = transcriptHistory[index].parts[0];
    if (part.type === "text")
      part.text +=
        '\n\n```javascript\nconst historical = "completed source remains present";\n```\n';
  }
}
const initialMessages: ChatMessage[] = realisticHistory
  ? transcriptHistory.flatMap<ChatMessage>((message, index) => [
      {
        id: `history-user-${index}`,
        role: "user",
        parts: [{ type: "text", text: `Explain section ${index + 1}.` }],
      },
      {
        ...message,
        metadata: {
          totalTokens: 2400,
          inputTokens: 2000,
          outputTokens: 400,
          costDollars: 0.004,
        },
      },
    ])
  : transcriptHistory;
const lifecycleCode = Array.from(
  {
    length:
      new URLSearchParams(location.search).get("codeLines") === "80" ? 80 : 401,
  },
  (_, i) => `const line${i} = "${"readable wrapping output ".repeat(6)}";`,
).join("\n");
const activeGoal = new URLSearchParams(location.search).has("goal");
if (activeGoal)
  browserTaskGoalStore.set(
    "shell-fixture-goal",
    "Preserve the long-running mobile task",
  );

const questions = {
  questions: [
    {
      multi: new URLSearchParams(location.search).has("multi"),
      question:
        "Which implementation should RIFT use? Compare the available choices, or write a custom response before continuing.",
      options: Array.from({ length: 3 }, (_, i) => ({
        label: `Option ${i + 1}`,
        detail:
          "Preserve the current work and verify the implementation with a meaningful offline test.",
      })),
    },
  ],
};

function Conversation({
  messages,
  setMessages,
  panel,
  setPanel,
}: {
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  panel: boolean;
  setPanel: Dispatch<SetStateAction<boolean>>;
}) {
  const mobileBackground = useRef<HTMLDivElement>(null);
  const [mobileContent, setMobileContent] = useState<SidebarContent | null>(
    new URLSearchParams(location.search).has("longTerminal")
      ? {
          command: "printf 'RIFT_TERMINAL_MARKER_" + "x".repeat(160) + "'",
          output: "/home/user\nRIFT_TERMINAL_MARKER_" + "x".repeat(160),
          isExecuting: false,
          toolCallId: "long-terminal-layout",
        }
      : null,
  );
  const [mobileTool, setMobileTool] = useState<"activity" | "preview" | null>(
    null,
  );
  const [previewActive, setPreviewActive] = useState(true);
  useEffect(() => {
    // Contract control for a retained pane becoming inactive and active again.
    // This does not simulate Safari suspension or an OS app switch.
    Reflect.set(window, "__setFixturePreviewActive", setPreviewActive);
    return () => {
      Reflect.deleteProperty(window, "__setFixturePreviewActive");
    };
  }, []);
  const dock = useWorkbenchDock("retained-transcript", withWorkbench);
  const split = useResizableSplit(
    withWorkbench &&
      dock.state.visible &&
      dock.state.placement === "right" &&
      !dock.state.maximized,
  );
  const streamTimer = useRef<ReturnType<typeof setInterval> | undefined>(
    undefined,
  );
  const streamProgress = useRef(0);
  const streamEvents = useRef<
    Array<{ kind: string; time: number; progress: number }>
  >([]);
  const [result, setResult] = useState("");
  const [codeStreaming, setCodeStreaming] = useState(false);
  const completionMessages = useRef(messages);
  useEffect(() => {
    if (completionDiagnostic) {
      recordCompletion("message-reference", {
        unchanged: completionMessages.current === messages,
      });
      completionMessages.current = messages;
    }
  });
  const [question, setQuestion] = useState(false);
  const view = useChatViewState("retained-transcript");
  view.scroll ??= { top: 0, atBottom: false };
  const { scrollRef, contentRef, scrollToBottom, isAtBottom } =
    useMessageScroll(view);
  useEffect(() => {
    (window as any).__transcript = {
      prepareCompletion: () => {
        if (!completionDiagnostic)
          throw new Error("Completion diagnostic is not enabled");
        beginCompletionPhase("setup");
        setCodeStreaming(true);
        setMessages((current) => [
          ...current.filter(
            (message) =>
              message.id !== "sustained-output" &&
              message.id !== "sustained-user",
          ),
          {
            id: "sustained-user",
            role: "user",
            parts: [
              {
                type: "text",
                text: "Continue with the next code example and explanation.",
              },
            ],
          },
          {
            id: "sustained-output",
            role: "assistant",
            parts: [{ type: "text", text: sustainedChunks.join("") }],
          },
        ]);
      },
      completionCheckpoint: (finish: boolean) => {
        beginCompletionPhase(finish ? "completion" : "unchanged");
        setCodeStreaming(!finish);
      },
      startSustained: () => {
        clearInterval(streamTimer.current);
        streamProgress.current = 0;
        streamEvents.current = [
          { kind: "start", time: performance.now(), progress: 0 },
        ];
        setCodeStreaming(true);
        setMessages((current) => [
          ...current.filter(
            (m) => m.id !== "sustained-output" && m.id !== "sustained-user",
          ),
          ...(realisticHistory
            ? [
                {
                  id: "sustained-user",
                  role: "user" as const,
                  parts: [
                    {
                      type: "text" as const,
                      text: "Continue with the next code example and explanation.",
                    },
                  ],
                },
              ]
            : []),
          {
            id: "sustained-output",
            role: "assistant",
            parts: [{ type: "text", text: "" }],
          },
        ]);
        streamTimer.current = setInterval(() => {
          const chunk = sustainedChunks[streamProgress.current++];
          if (chunk === undefined) {
            clearInterval(streamTimer.current);
            setCodeStreaming(false);
            streamEvents.current.push({
              kind: "complete",
              time: performance.now(),
              progress: streamProgress.current,
            });
            if (realisticHistory)
              requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                  (window as any).__workspaceFrameStop = true;
                  streamEvents.current.push({
                    kind: "measurement-stop",
                    time: performance.now(),
                    progress: streamProgress.current,
                  });
                }),
              );
            return;
          }
          streamEvents.current.push({
            kind: "chunk",
            time: performance.now(),
            progress: streamProgress.current,
          });
          setMessages((current) =>
            current.map((message) =>
              message.id === "sustained-output"
                ? {
                    ...message,
                    parts: message.parts.map((part) =>
                      part.type === "text"
                        ? { ...part, text: part.text + chunk }
                        : part,
                    ),
                  }
                : message,
            ),
          );
        }, 100);
      },
      streamSnapshot: () => ({
        progress: streamProgress.current,
        total: sustainedChunks.length,
        expected: sustainedChunks.join(""),
        events: streamEvents.current,
      }),
      paragraph: (text: string, streaming = true) => {
        setCodeStreaming(streaming);
        setMessages((current) => [
          ...current.filter((message) => message.id !== "paragraph-lifecycle"),
          {
            id: "paragraph-lifecycle",
            role: "assistant",
            parts: [{ type: "text", text }],
          },
        ]);
      },
      code: (closed: boolean) => {
        setCodeStreaming(true);
        setMessages((current) => [
          ...current.filter((m) => m.id !== "code-lifecycle"),
          {
            id: "code-lifecycle",
            role: "assistant",
            parts: [
              {
                type: "text",
                text:
                  "```javascript\n" + lifecycleCode + (closed ? "\n```" : ""),
              },
            ],
          },
        ]);
      },
      continueCode: () =>
        setMessages((current) =>
          current.map((message) =>
            message.id === "code-lifecycle"
              ? {
                  ...message,
                  parts: message.parts.map((part) =>
                    part.type === "text"
                      ? {
                          ...part,
                          text:
                            part.text +
                            "\n\nContinuation after the code fence.",
                        }
                      : part,
                  ),
                }
              : message,
          ),
        ),
      finishCode: () => setCodeStreaming(false),
      lateUsage: () =>
        setMessages((current) =>
          current.map((message) =>
            message.id === "code-lifecycle"
              ? {
                  ...message,
                  metadata: {
                    ...message.metadata,
                    mode: "agent",
                    generationTimeMs: 3000,
                    totalTokens: 2400,
                    costDollars: 0.125,
                  },
                }
              : message,
          ),
        ),
      lateFile: (corrected: boolean) =>
        setMessages((current) =>
          current.map((message) =>
            message.id === "code-lifecycle"
              ? {
                  ...message,
                  fileDetails: [
                    {
                      fileId:
                        "fixture-generated-image" as import("../../convex/_generated/dataModel").Id<"files">,
                      name: corrected ? "final-frame.svg" : "draft-frame.svg",
                      mediaType: "image/svg+xml",
                      url: `/scroll-fixture.svg?receipt=${corrected ? 2 : 1}`,
                    },
                  ],
                }
              : message,
          ),
        ),

      panel: setPanel,
      question: setQuestion,
      snapshot: () => ({ following: isAtBottom, saved: view.scroll }),
      latest: () => scrollToBottom({ force: true, instant: true }),
      append: () =>
        setMessages((current) => [
          ...current,
          {
            id: `append-${current.length}`,
            role: "assistant",
            parts: [
              { type: "text", text: "Streaming tail output. ".repeat(120) },
            ],
          },
        ]),
      image: () =>
        setMessages((current) =>
          current.map((m) =>
            m.id === "transcript-0"
              ? {
                  ...m,
                  // SDK streams append new file parts. MessageItem renders
                  // them above prose without changing existing part indexes.
                  parts: [
                    ...m.parts,
                    {
                      type: "file",
                      url: "/scroll-fixture.svg",
                      mediaType: "image/svg+xml",
                    },
                  ],
                }
              : m,
          ),
        ),
    };
    return () => {
      delete (window as any).__transcript;
    };
  }, [isAtBottom, scrollToBottom, view, setMessages, setPanel]);
  useEffect(() => () => clearInterval(streamTimer.current), []);
  useEffect(
    () =>
      onSubmitChatMessage((text) => {
        setResult(text);
        return true;
      }),
    [],
  );
  // These structural wrappers reproduce chat.tsx's conversation column; the
  // app header, question card, textarea and toolbar below are actual imports.
  // Messages, MessageItem and useMessageScroll execute normally; network,
  // remote persistence and provider/worker execution are outside this fixture.
  return (
    <div
      data-rift-chat-root
      ref={mobileBackground}
      className="flex min-h-0 flex-1 w-full flex-col bg-transparent overflow-x-hidden"
    >
      {withMobileTools && (
        <div className="flex shrink-0 gap-2">
          <button
            className="min-h-11 px-3"
            onClick={() => {
              (window as any).__mobileRestoreTarget = document.activeElement;
              setMobileTool("activity");
            }}
          >
            Open mobile activity
          </button>
          <button
            className="min-h-11 px-3"
            onClick={() => {
              (window as any).__mobileRestoreTarget = document.activeElement;
              setMobileTool("preview");
            }}
          >
            Open mobile preview
          </button>
        </div>
      )}
      {mobileTool && (
        <MobileToolDialog
          key={mobileTool}
          backgroundRef={mobileBackground}
          label={mobileTool === "activity" ? "RIFT computer" : "Live Preview"}
          description="Mobile tool verification"
          contentClassName="top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 items-center justify-center gap-0 overflow-hidden rounded-none border-0 bg-background p-4 shadow-none"
          onClose={() => setMobileTool(null)}
        >
          <div className="w-full h-full">
            {mobileTool === "activity" ? (
              <ComputerSidebarBase
                sidebarOpen
                sidebarContent={mobileContent}
                navigationExecutions={
                  mobileContent ? [mobileContent] : undefined
                }
                onNavigate={setMobileContent}
                closeSidebar={() => setMobileTool(null)}
                messages={messages}
                currentRunExecutions={[]}
                currentRunTodos={[]}
                status={codeStreaming ? "streaming" : "ready"}
              />
            ) : (
              <BuildPreviewPanel
                embedded={new URLSearchParams(location.search).has(
                  "modulePreview",
                )}
                chatId="mobile-preview-fixture"
                active={previewActive}
                building={codeStreaming}
                onShowActivity={() => setMobileTool("activity")}
              />
            )}
          </div>
        </MobileToolDialog>
      )}
      {withWorkbench && (
        <button
          className="shrink-0 text-sm"
          aria-controls="rift-build-tool-pane"
          onClick={() => dock.openKind("activity")}
        >
          Open Activity
        </button>
      )}
      <div
        data-rift-dock-placement={dock.state.placement}
        data-rift-dock-visible={
          withWorkbench && dock.state.visible ? "true" : "false"
        }
        data-rift-dock-maximized={dock.state.maximized ? "true" : "false"}
        data-rift-dock-resizing={split.isResizing ? "true" : "false"}
        className={`flex min-h-0 flex-1 min-w-0 relative ${withWorkbench && dock.state.placement === "bottom" ? "flex-col" : ""}`}
      >
        <div
          data-rift-conversation-column
          className="flex min-h-0 flex-col flex-1 min-w-0"
          inert={withWorkbench && dock.state.visible && dock.state.maximized}
          style={
            withWorkbench
              ? dock.state.visible && dock.state.maximized
                ? { display: "none" }
                : undefined
              : { maxWidth: panel ? "65%" : "100%" }
          }
        >
          <div
            data-rift-chat-surface
            className="bg-transparent flex flex-col flex-1 relative min-h-0"
          >
            <Profiler id="Messages" onRender={completionProfiler}>
              <Messages
                codePresentationView={view}
                messages={messages}
                setMessages={setMessages}
                scrollRef={scrollRef}
                contentRef={contentRef}
                status={codeStreaming ? "streaming" : "ready"}
                error={null}
                mode="agent"
                chatPurpose="app"
                onRegenerate={() => {}}
                onRetry={() => {}}
                onEditMessage={async () => {}}
              />
            </Profiler>
            {question && (
              <div
                className="shrink-0 min-w-0 px-3 sm:px-4"
                data-ui="question-dock"
              >
                <div className="mx-auto w-full max-w-[760px] min-w-0">
                  <PlanQuestions data={questions} />
                </div>
              </div>
            )}
            <div
              data-ui="composer-region"
              data-centered="false"
              className="relative min-w-0 px-3 sm:px-4 pb-[max(12px,env(safe-area-inset-bottom))]"
            >
              <div
                data-ui="composer-column"
                className="mx-auto flex w-full min-w-0 flex-1 flex-col max-w-[760px]"
              >
                <ComposerSurface proShell>
                  {activeGoal && (
                    <ActiveGoalStatus taskId="shell-fixture-goal" />
                  )}
                  <ChatInputTextarea
                    draftId="shell-fixture-draft"
                    chatMode="agent"
                    minRows={1}
                    autoFocus={false}
                    onEnterSubmit={() => setResult("Message submitted")}
                  />
                  <ChatInputToolbar
                    chatMode="agent"
                    onAttachClick={() => {}}
                    isGenerating={false}
                    hideStop={false}
                    onStop={() => {}}
                    onSubmit={(event) => {
                      event.preventDefault();
                      setResult("Message submitted");
                    }}
                    status="ready"
                    isUploadingFiles={false}
                    uploadedFiles={[]}
                  />
                </ComposerSurface>
              </div>
            </div>
            <output className="sr-only" aria-label="Fixture submitted response">
              {result}
            </output>
          </div>
        </div>
        {withWorkbench && (
          <>
            <div
              role="separator"
              aria-label="Resize workspace panel"
              aria-orientation="vertical"
              className="pro-resize-handle shrink-0"
              style={{
                display:
                  dock.state.visible &&
                  !dock.state.maximized &&
                  dock.state.placement === "right"
                    ? undefined
                    : "none",
              }}
              {...split.handleProps}
            />
            <div
              id="rift-build-tool-pane"
              data-rift-tool-pane
              className={dockStyles.container}
              data-visible={dock.state.visible}
              data-placement={dock.state.placement}
              inert={!dock.state.visible}
              aria-hidden={!dock.state.visible}
              style={
                dock.state.placement === "right"
                  ? {
                      width: dock.state.visible
                        ? dock.state.maximized
                          ? "100%"
                          : `${split.ratio * 100}%`
                        : 0,
                    }
                  : {
                      height: dock.state.visible
                        ? dock.state.maximized
                          ? "100%"
                          : 340
                        : 0,
                      width: "100%",
                    }
              }
            >
              {dock.state.tabs.length > 0 && (
                <WorkbenchDock
                  controller={dock}
                  messages={messages}
                  executions={[]}
                  allExecutions={[]}
                  todos={[]}
                  status={
                    holdActivityReady
                      ? "ready"
                      : codeStreaming
                        ? "streaming"
                        : "ready"
                  }
                  chatId="retained-transcript"
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
// Keep only server-like transcript data and pane preference outside the route.
// The conversation and its DOM/hook unmount, while the real shell view cache lives.
function RouteHarness() {
  const [messages, setMessages] = useState(initialMessages);
  const [panel, setPanel] = useState(false);
  const [away, setAway] = useState(false);
  useEffect(() => {
    (window as any).__route = {
      away: setAway,
      panel: setPanel,
      image: (index: number) =>
        setMessages((current) =>
          current.map((m, i) =>
            i === index
              ? {
                  ...m,
                  parts: [
                    ...m.parts,
                    {
                      type: "file",
                      url: "/scroll-fixture.svg",
                      mediaType: "image/svg+xml",
                    },
                  ],
                }
              : m,
          ),
        ),
    };
    return () => {
      delete (window as any).__route;
    };
  }, []);
  return away ? (
    <div data-testid="away-route">Another screen</div>
  ) : (
    <Conversation
      messages={messages}
      setMessages={setMessages}
      panel={panel}
      setPanel={setPanel}
    />
  );
}
createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
    <TooltipProvider>
      <ProShellProvider>
        <ComposerState>
          <TranscriptDockState>
            <LiveSidebarContentProvider>
              <InputProvider>
                <ChatViewport data-rift-route-shell="chat">
                  <ProChatLayout>
                    <ChatViewStateProvider>
                      <RouteHarness />
                    </ChatViewStateProvider>
                  </ProChatLayout>
                </ChatViewport>
              </InputProvider>
            </LiveSidebarContentProvider>
          </TranscriptDockState>
        </ComposerState>
      </ProShellProvider>
    </TooltipProvider>
  </ThemeProvider>,
);
