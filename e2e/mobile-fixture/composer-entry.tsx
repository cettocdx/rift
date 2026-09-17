import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { ComposerSurface } from "../../app/components/ChatInput/ComposerSurface";
import { ChatInputTextarea } from "../../app/components/ChatInput/ChatInputTextarea";
import { ActiveGoalStatus } from "../../app/components/ChatInput/ActiveGoalStatus";
import { browserTaskGoalStore } from "../../lib/composer/browser-goal-store";
import { ChatInputToolbar } from "../../app/components/ChatInput/ChatInputToolbar";
import { ProShellProvider } from "../../app/components/pro/ProShellContext";
import { InputProvider } from "../../app/contexts/InputContext";
import { TooltipProvider } from "../../components/ui/tooltip";
import { ComposerState, useGlobalState } from "./composer-state";

const parameters = new URLSearchParams(location.search);
const activeGoal = parameters.has("goal");
if (activeGoal)
  browserTaskGoalStore.set(
    "fixture-goal",
    "Keep building a mobile application with a long goal title",
  );
function Composer() {
  const [result, setResult] = useState("");
  const generating = parameters.has("streaming");
  const { chatMode } = useGlobalState();
  return (
    <div className="pro-shell">
      <main
        className="pro-main"
        style={{ paddingTop: parameters.has("compact") ? 8 : 160 }}
      >
        {/* Reproduce the production shell constraints; every toolbar control is imported. */}
        <div
          data-ui="composer-region"
          className="relative min-w-0 px-3 sm:px-4"
        >
          <div
            data-ui="composer-column"
            className="mx-auto flex w-full min-w-0 max-w-[640px] flex-col"
          >
            <ComposerSurface isCentered proShell>
              {activeGoal && <ActiveGoalStatus taskId="fixture-goal" />}
              <ChatInputTextarea
                draftId="fixture-draft"
                chatMode={chatMode}
                minRows={2}
                isCentered
                autoFocus={false}
                onEnterSubmit={(event) => {
                  event.preventDefault();
                  setResult("submitted");
                }}
              />
              <ChatInputToolbar
                isCentered
                chatMode={chatMode}
                onAttachClick={() => {
                  throw Error("Attachment execution disabled");
                }}
                isGenerating={generating}
                hideStop={false}
                onStop={() => {
                  setResult("stopped");
                }}
                onSubmit={(event) => {
                  event.preventDefault();
                  setResult("submitted");
                }}
                status={generating ? "streaming" : "ready"}
                isUploadingFiles={false}
                uploadedFiles={[]}
              />
            </ComposerSurface>
            <output aria-label="Fixture action">{result}</output>
          </div>
        </div>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
    <TooltipProvider>
      <ProShellProvider>
        <ComposerState>
          <InputProvider>
            <Composer />
          </InputProvider>
        </ComposerState>
      </ProShellProvider>
    </TooltipProvider>
  </ThemeProvider>,
);
