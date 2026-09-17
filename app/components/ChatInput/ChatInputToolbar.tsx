"use client";

import { ApprovalModeSelector } from "./ApprovalModeSelector";
import { AttachmentButton } from "@/app/components/AttachmentButton";
import { ChatModeSelector } from "./ChatModeSelector";
import { ModelSelector } from "@/app/components/ModelSelector";
import { BuildModelSelector } from "./BuildModelSelector";
import { ImageModelSelector } from "./ImageModelSelector";
import {
  SubmitStopButton,
  type SubmitStopButtonProps,
} from "./SubmitStopButton";
import {
  ContextUsageIndicator,
  type ContextUsageData,
} from "@/app/components/ContextUsageIndicator";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { useProShell } from "@/app/components/pro/ProShellContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileComposerSettings } from "./MobileComposerSettings";

export interface ChatInputToolbarProps extends SubmitStopButtonProps {
  chatId?: string;
  onAttachClick: () => void;
  isCentered?: boolean;
  contextUsage?: ContextUsageData;
  showContextIndicator?: boolean;
  contextUsageVariant?: "tooltip" | "compact-popover";
}

export function ChatInputToolbar({
  chatId,
  onAttachClick,
  isCentered = false,
  contextUsage,
  showContextIndicator = false,
  contextUsageVariant = "tooltip",
  chatMode,
  ...submitStopProps
}: ChatInputToolbarProps) {
  const {
    selectedModel,
    setSelectedModel,
    reasoningEffort,
    setReasoningEffort,
    setChatMode,
    chatPurpose,
  } = useGlobalState();
  const { enabled: proShell } = useProShell();
  const isMobile = useIsMobile();
  const contextIndicator =
    showContextIndicator && contextUsage ? (
      <ContextUsageIndicator {...contextUsage} variant={contextUsageVariant} />
    ) : null;

  return (
    <div
      className={`flex shrink-0 min-w-0 items-center gap-0.5 px-2 pb-2 pt-1 ${proShell ? "pro-composer-toolbar" : ""}`}
      data-ui="composer-toolbar"
      data-layout={isCentered ? "hero" : "follow-up"}
    >
      <div className="shrink-0">
        <AttachmentButton onAttachClick={onAttachClick} />
      </div>
      {/* Media Studio owns execution routing: images use the fast request path;
          video models use the durable Agent worker for async polling/storage. */}
      {chatPurpose !== "image" && !isMobile && <ChatModeSelector />}
      {chatPurpose !== "image" && !isMobile && <ApprovalModeSelector />}
      <div
        data-ui="composer-model-controls"
        className="ml-auto flex min-w-0 items-center gap-0.5"
      >
        {chatPurpose === "app" ? (
          <>
            <BuildModelSelector
              value={selectedModel}
              onChange={setSelectedModel}
              reasoningEffort={reasoningEffort}
              onReasoningChange={setReasoningEffort}
              openDownward={isCentered}
            />
          </>
        ) : chatPurpose === "image" ? (
          <ImageModelSelector
            value={selectedModel}
            onChange={(model) => {
              setSelectedModel(model);
              setChatMode(model.startsWith("video-") ? "agent" : "ask");
            }}
          />
        ) : (
          <ModelSelector
            value={selectedModel}
            onChange={setSelectedModel}
            mode={chatMode}
          />
        )}
      </div>
      {isMobile && chatPurpose !== "image" && (
        <MobileComposerSettings
          chatId={chatId}
          showWorkspace={proShell && chatPurpose === "app"}
          contextIndicator={contextIndicator}
        />
      )}
      <div
        data-ui="composer-submit-controls"
        className="flex shrink-0 items-center gap-1"
      >
        {(!isMobile || chatPurpose === "image") && contextIndicator}
        <SubmitStopButton {...submitStopProps} chatMode={chatMode} />
      </div>
    </div>
  );
}
