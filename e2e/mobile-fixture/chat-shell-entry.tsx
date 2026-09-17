import { useEffect, useState } from "react";
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

function Conversation() {
  const [result, setResult] = useState("");
  useEffect(() => {
    let rejected = false;
    return onSubmitChatMessage((text) => {
      // Controlled rejection exercises the real card/bridge recovery, not a provider.
      if (
        new URLSearchParams(location.search).has("rejectAnswer") &&
        !rejected
      ) {
        rejected = true;
        return false;
      }
      setResult(text);
      return true;
    });
  }, []);
  // These structural wrappers reproduce chat.tsx's conversation column; the
  // app header, question card, textarea and toolbar below are actual imports.
  // Runtime transcript/worker behavior is intentionally outside this fixture.
  return (
    <div
      data-rift-chat-root
      className="flex min-h-0 flex-1 w-full flex-col bg-transparent overflow-x-hidden"
    >
      <div className="flex min-h-0 flex-1 min-w-0 relative">
        <div
          data-rift-conversation-column
          className="flex min-h-0 flex-col flex-1 min-w-0"
        >
          <div
            data-rift-chat-surface
            className="bg-transparent flex flex-col flex-1 relative min-h-0"
          >
            <div
              data-ui="fixture-transcript"
              className="flex-1 min-h-0 overflow-auto"
            >
              {Array.from({ length: 40 }, (_, i) => (
                <p key={i} className="p-3">
                  Message {i + 1}: working through the current task.
                </p>
              ))}
            </div>
            <div
              className="shrink-0 min-w-0 px-3 sm:px-4"
              data-ui="question-dock"
            >
              <div className="mx-auto w-full max-w-[760px] min-w-0">
                <PlanQuestions data={questions} />
              </div>
            </div>
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
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
    <TooltipProvider>
      <ProShellProvider>
        <ComposerState>
          <InputProvider>
            <ChatViewport data-rift-route-shell="chat">
              <ProChatLayout>
                <Conversation />
              </ProChatLayout>
            </ChatViewport>
          </InputProvider>
        </ComposerState>
      </ProShellProvider>
    </TooltipProvider>
  </ThemeProvider>,
);
