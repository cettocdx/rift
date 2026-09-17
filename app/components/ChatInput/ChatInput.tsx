"use client";

import { HomeCommandCenter } from "@/app/components/pro/HomeCommandCenter";
import { useWorkingFile } from "@/lib/composer/working-file-store";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { useInputApi } from "@/app/contexts/InputContext";
import { TodoPanel } from "../TodoPanel";
import type { ChatStatus } from "@/types";
import { FileUploadPreview } from "../FileUploadPreview";
import { QueuedMessagesPanel } from "../QueuedMessagesPanel";
import { ScrollToBottomButton } from "../ScrollToBottomButton";
import { useFileUpload } from "@/app/hooks/useFileUpload";
import { newChatDraftId } from "@/lib/composer/draft-id";
import { removeDraft } from "@/lib/utils/client-storage";
import {
  RateLimitWarning,
  type RateLimitWarningData,
} from "../RateLimitWarning";
import { isAgentMode } from "@/lib/utils/mode-helpers";
import { toast } from "sonner";
import { NULL_THREAD_DRAFT_ID } from "@/lib/utils/client-storage";
import { ChatInputTextarea } from "./ChatInputTextarea";
import { ChatInputToolbar } from "./ChatInputToolbar";
import { RiftTuiChrome, useTuiSkin } from "@/app/components/tui/RiftTuiChrome";
import { type ContextUsageData } from "../ContextUsageIndicator";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ChatMode, ChatPurpose, SelectedModel } from "@/types/chat";
import { useProShell } from "@/app/components/pro/ProShellContext";
import { ComposerSurface } from "./ComposerSurface";
import { ActiveGoalStatus } from "./ActiveGoalStatus";
import { useSlashCommandRuntime } from "./useSlashCommandRuntime";

/** Placeholder copy for the composer, per chat purpose (mode). */
function purposePlaceholder(
  purpose: ChatPurpose,
  _selectedModel: SelectedModel,
): string {
  if (purpose === "app") {
    return "Plan, Build, / for commands, @ for context";
  }
  if (purpose === "image") return "Describe an image or video to create";
  return "Ask, / for commands, @ for context";
}

interface ChatInputProps {
  accessory?: ReactNode;
  onSubmit: (
    e: React.FormEvent,
    options?: { input?: string; mode?: ChatMode },
  ) => void | boolean | Promise<void | boolean>;
  onStop: () => void;
  onSendNow: (messageId: string) => void;
  status: ChatStatus;
  isCentered?: boolean;
  hasMessages?: boolean;
  isAtBottom?: boolean;
  onScrollToBottom?: () => void;
  hideStop?: boolean;
  isNewChat?: boolean;
  clearDraftOnSubmit?: boolean;
  chatId?: string;
  rateLimitWarning?: RateLimitWarningData;
  onDismissRateLimitWarning?: () => void;
  contextUsage?: ContextUsageData;
  placeholder?: string;
  autoFocus?: boolean;
}

export const ChatInput = ({
  onSubmit,
  onStop,
  onSendNow,
  status,
  isCentered = false,
  hasMessages = false,
  isAtBottom = true,
  onScrollToBottom,
  hideStop = false,
  isNewChat = false,
  clearDraftOnSubmit = true,
  chatId,
  rateLimitWarning,
  onDismissRateLimitWarning,
  contextUsage,
  placeholder,
  autoFocus,
  accessory,
}: ChatInputProps) => {
  /*
   * Deliberately not `useInputValue()`. This component renders the toolbar and
   * its six selectors; subscribing here put all of them on the keystroke path.
   * The handlers below read `inputRef.current` — always current, never
   * reactive — and the send button subscribes to its own boolean.
   */
  const { setInput, inputRef } = useInputApi();
  const {
    chatMode,
    setChatMode,
    chatPurpose,
    uploadedFiles,
    isUploadingFiles,
    messageQueue,
    removeQueuedMessage,
    queueBehavior,
    setQueueBehavior,
    sandboxPreference,
    setSandboxPreference,
    selectedModel,
    setSelectedModel,
    subscription,
    temporaryChatsEnabled,
    hasLocalSandbox,
    defaultLocalSandboxPreference,
    desktopBridgeActive,
  } = useGlobalState();
  const isMobile = useIsMobile();
  const isTuiSkin = useTuiSkin();
  const { enabled: proShell } = useProShell();
  const {
    fileInputRef,
    handleFileUploadEvent,
    handleRemoveFile,
    handleAttachClick,
  } = useFileUpload(chatMode);

  const isGenerating = status === "submitted" || status === "streaming";
  const showContextIndicator =
    (subscription !== "free" || isAgentMode(chatMode)) && !!contextUsage;
  const draftId = isNewChat
    ? newChatDraftId(chatPurpose)
    : chatId || NULL_THREAD_DRAFT_ID;
  const goalTaskId = chatId || draftId;
  const workingFile = useWorkingFile(chatId);
  const dispatchPendingRef = useRef(false);
  const workingFilePending =
    chatPurpose === "app" && !!workingFile && !desktopBridgeActive;

  const clearComposer = useCallback(() => {
    removeDraft(draftId);
    setInput("");
  }, [draftId, setInput]);

  const submitCommandPrompt = useCallback(
    (prompt: string, mode: ChatMode) => {
      setInput(prompt);
      const submit = () =>
        onSubmit({ preventDefault() {} } as React.FormEvent, {
          input: prompt,
          mode,
        });
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(submit);
      } else {
        window.setTimeout(submit, 0);
      }
    },
    [onSubmit, setInput],
  );

  const slashCommands = useSlashCommandRuntime({
    taskId: goalTaskId,
    status,
    onStop,
    onClearComposer: clearComposer,
    onSetComposer: setInput,
    onSubmitPrompt: submitCommandPrompt,
  });

  // Free agent mode constraints:
  // 1. Requires local sandbox — fall back to ask mode if disconnected
  // 2. Force local sandbox preference (not e2b)
  // 3. Force auto model selection
  //
  // Subscription tiers were removed, so every signed-in user can run cloud
  // (E2B) Agent mode. The old "free Agent requires a local sandbox, else fall
  // back to Ask" downgrade no longer applies.
  const isFreeAgent = false;

  const prevHasLocalSandboxRef = useRef(hasLocalSandbox);
  useEffect(() => {
    const wasConnected = prevHasLocalSandboxRef.current;
    prevHasLocalSandboxRef.current = hasLocalSandbox;

    if (!isFreeAgent) return;
    // Only show toast on actual disconnect (true → false), not on
    // initial mount or logout where hasLocalSandbox starts as false.
    if (!hasLocalSandbox) {
      setChatMode("ask");
      if (wasConnected) {
        toast.info("Local sandbox disconnected. Switched to Ask mode.", {
          description: "Reconnect your sandbox to use Agent mode.",
          duration: 5000,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFreeAgent, hasLocalSandbox]);

  useEffect(() => {
    if (!isFreeAgent) return;
    if (
      (!sandboxPreference || sandboxPreference === "e2b") &&
      defaultLocalSandboxPreference
    ) {
      setSandboxPreference(defaultLocalSandboxPreference);
    }
    if (selectedModel !== "auto") {
      setSelectedModel("auto");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFreeAgent]);

  // Fallback to 'ask' mode when temporary chats are enabled (agent modes not allowed)
  useEffect(() => {
    if (temporaryChatsEnabled && isAgentMode(chatMode)) {
      setChatMode("ask");
    }
  }, [temporaryChatsEnabled, chatMode, setChatMode]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (workingFilePending) return;
    const input = inputRef.current;
    if (input.trimStart().startsWith("/")) {
      void slashCommands.execute(input).then((handled) => {
        if (!handled) submitRegularInput(e);
      });
      return;
    }

    submitRegularInput(e);
  };

  const submitRegularInput = (e: React.FormEvent) => {
    if (dispatchPendingRef.current) return;
    const canSubmit =
      (status === "ready" || status === "streaming") &&
      !isUploadingFiles &&
      (inputRef.current.trim() || uploadedFiles.length > 0);

    if (canSubmit) {
      const submittedInput = inputRef.current;
      const clearAcceptedDraft = (accepted: void | boolean) => {
        if (accepted === false || !clearDraftOnSubmit) return;
        // Never erase text entered while native access was being checked.
        if (inputRef.current && inputRef.current !== submittedInput) return;
        removeDraft(draftId);
        setInput("");
      };
      dispatchPendingRef.current = true;
      try {
        const result = onSubmit(e);
        if (result && typeof result === "object" && "then" in result) {
          void result
            .then(clearAcceptedDraft)
            .catch(() => {
              toast.error(
                "Your message was not sent. Your draft is still here.",
              );
            })
            .finally(() => {
              dispatchPendingRef.current = false;
            });
        } else {
          clearAcceptedDraft(result);
          dispatchPendingRef.current = false;
        }
      } catch {
        dispatchPendingRef.current = false;
        toast.error("Your message was not sent. Your draft is still here.");
      }
    }
  };

  return (
    <div
      data-ui="composer-region"
      data-centered={isCentered ? "true" : "false"}
      className={`relative min-w-0 px-3 sm:px-4 ${
        isCentered ? "" : "pb-[max(12px,env(safe-area-inset-bottom))]"
      }`}
    >
      <div
        data-ui="composer-column"
        className={`mx-auto flex w-full min-w-0 flex-1 flex-col ${
          isCentered ? "max-w-[640px]" : "max-w-[760px]"
        }`}
      >
        {rateLimitWarning && onDismissRateLimitWarning && (
          <RateLimitWarning
            data={rateLimitWarning}
            onDismiss={onDismissRateLimitWarning}
          />
        )}

        {accessory}
        <TodoPanel status={status} />

        {messageQueue.length > 0 && (
          <QueuedMessagesPanel
            messages={messageQueue}
            onSendNow={onSendNow}
            onDelete={removeQueuedMessage}
            isStreaming={status === "streaming"}
            queueBehavior={queueBehavior}
            onQueueBehaviorChange={setQueueBehavior}
          />
        )}

        {uploadedFiles && uploadedFiles.length > 0 && (
          <FileUploadPreview
            uploadedFiles={uploadedFiles}
            onRemoveFile={handleRemoveFile}
            mediaKind={
              chatPurpose === "image"
                ? selectedModel.startsWith("video-")
                  ? "video"
                  : "image"
                : undefined
            }
          />
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          aria-label="Upload files"
          onChange={handleFileUploadEvent}
        />

        {proShell && chatPurpose === "app" && !isTuiSkin && !isMobile ? (
          <HomeCommandCenter chatId={chatId} isGenerating={isGenerating} />
        ) : null}

        <ComposerSurface
          isCentered={isCentered}
          proShell={proShell}
          hasAttachments={!!uploadedFiles?.length}
        >
          <ActiveGoalStatus key={goalTaskId} taskId={goalTaskId} />
          <ChatInputTextarea
            draftId={draftId}
            conversationId={chatId ?? undefined}
            chatMode={chatMode}
            isCentered={isCentered}
            onEnterSubmit={handleSubmit}
            minRows={isMobile ? 1 : 2}
            placeholder={
              placeholder ??
              (isMobile && chatPurpose !== "image"
                ? "Message RIFT"
                : purposePlaceholder(chatPurpose, selectedModel))
            }
            autoFocus={autoFocus ?? isMobile === false}
          />
          <ChatInputToolbar
            chatId={chatId}
            onAttachClick={handleAttachClick}
            isCentered={isCentered}
            isGenerating={isGenerating}
            hideStop={hideStop}
            onStop={onStop}
            onSubmit={handleSubmit}
            status={status}
            isUploadingFiles={isUploadingFiles}
            disabledReason={
              workingFilePending ? "Connecting to your working file" : undefined
            }
            uploadedFiles={uploadedFiles}
            chatMode={chatMode}
            contextUsage={contextUsage}
            showContextIndicator={showContextIndicator}
            contextUsageVariant={isMobile ? "compact-popover" : "tooltip"}
          />
        </ComposerSurface>

        {isTuiSkin ? (
          <RiftTuiChrome contextUsed={contextUsage?.usedTokens ?? 0} />
        ) : null}

        {onScrollToBottom && (
          <div className="absolute -top-16 left-1/2 -translate-x-1/2 z-40">
            <ScrollToBottomButton
              onClick={onScrollToBottom}
              hasMessages={hasMessages}
              isAtBottom={isAtBottom}
            />
          </div>
        )}
      </div>
    </div>
  );
};
