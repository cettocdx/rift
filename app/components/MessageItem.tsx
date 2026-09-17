import { FilesChangedCard } from "./FilesChangedCard";
import { extractAllSidebarContent } from "@/lib/utils/sidebar-utils";
import { memo, useMemo, useCallback, Fragment, useState } from "react";
import { MessageActions } from "./MessageActions";
import { MessagePartHandler } from "./MessagePartHandler";
import { FilePartRenderer } from "./FilePartRenderer";
import { MessageEditor, EditableFile } from "./MessageEditor";
import { FeedbackInput } from "./FeedbackInput";
import { BranchIndicator } from "./BranchIndicator";
import { FinishReasonNotice } from "./FinishReasonNotice";
import { splitWorkedForParts } from "./worked-for-parts";
import { AssistantTranscript } from "./AssistantTranscript";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { ChevronDown, ChevronUp, FileSearch, WandSparkles } from "lucide-react";
import { CursorThinking } from "@/components/ui/cursor-thinking";
import { buildLiveProgressPresentation } from "@/lib/chat/live-progress";
import { hasVisibleLiveReasoning } from "@/lib/chat/reasoning-state";
import {
  extractMessageText,
  hasTextContent,
  extractWebSourcesFromMessage,
} from "@/lib/utils/message-utils";
import { isAgentMode } from "@/lib/utils/mode-helpers";
import type { ChatStatus, ChatMessage, ChatMode, ChatPurpose } from "@/types";
import type { FileDetails } from "@/types/file";

const USER_MESSAGE_PREVIEW_LINE_LIMIT = 20;
const USER_MESSAGE_PREVIEW_CHAR_LIMIT = 1_200;

const splitMessageLines = (text: string) => text.split(/\r\n|\r|\n/);

const isLongUserMessageText = (text: string) =>
  text.length > USER_MESSAGE_PREVIEW_CHAR_LIMIT ||
  splitMessageLines(text).length > USER_MESSAGE_PREVIEW_LINE_LIMIT;

const getUserMessagePreview = (text: string) => {
  const lines = splitMessageLines(text);

  if (lines.length > USER_MESSAGE_PREVIEW_LINE_LIMIT) {
    return lines.slice(0, USER_MESSAGE_PREVIEW_LINE_LIMIT).join("\n");
  }

  return text.slice(0, USER_MESSAGE_PREVIEW_CHAR_LIMIT).trimEnd();
};

interface MessageItemProps {
  message: ChatMessage;
  isLastMessage: boolean;
  isLastAssistantMessage: boolean;
  isAwaitingApproval?: boolean;
  isBranchBoundary: boolean;
  status: ChatStatus;
  isHovered?: boolean;
  isEditing: boolean;
  isMobile?: boolean;
  feedbackInputMessageId: string | null;
  tempChatFileDetails?: Map<string, FileDetails[]>;
  finishReason?: string;
  mode?: ChatMode;
  purpose?: ChatPurpose;
  isTemporaryChat?: boolean;
  branchedFromChatId?: string;
  branchedFromChatTitle?: string;
  showingLoadingIndicator?: boolean;
  // Inline status for mid-conversation summarization (when message already has content)
  summarizationStatus?: {
    status: "started" | "completed";
    message: string;
  } | null;
  // Callbacks
  onMouseEnter?: (messageId: string) => void;
  onMouseLeave?: () => void;
  onStartEdit: (messageId: string) => void;
  onSaveEdit: (newContent: string, remainingFileIds: string[]) => Promise<void>;
  onCancelEdit: () => void;
  onRegenerate: () => void;
  onContinue?: () => void;
  onBranchMessage?: (messageId: string) => void;
  onFeedback: (messageId: string, type: "positive" | "negative") => void;
  onFeedbackSubmit: (details: string) => Promise<void>;
  onFeedbackCancel: () => void;
  onShowAllFiles: (message: ChatMessage, fileDetails: FileDetails[]) => void;
  getCachedUrl: (fileId: string) => string | null | undefined;
}

// Custom comparison to minimize re-renders
function areMessageItemPropsEqual(
  prev: MessageItemProps,
  next: MessageItemProps,
): boolean {
  // Always re-render if these change
  if (prev.status !== next.status) return false;
  if (prev.isAwaitingApproval !== next.isAwaitingApproval) return false;
  if (prev.isHovered !== next.isHovered) return false;
  if (prev.isEditing !== next.isEditing) return false;
  if (prev.isMobile !== next.isMobile) return false;
  if (prev.feedbackInputMessageId !== next.feedbackInputMessageId) return false;
  if (prev.isLastMessage !== next.isLastMessage) return false;
  if (prev.isLastAssistantMessage !== next.isLastAssistantMessage) return false;
  if (prev.isBranchBoundary !== next.isBranchBoundary) return false;
  if (prev.finishReason !== next.finishReason) return false;
  if (prev.mode !== next.mode) return false;
  if (prev.purpose !== next.purpose) return false;
  if (prev.showingLoadingIndicator !== next.showingLoadingIndicator)
    return false;
  if (prev.summarizationStatus?.status !== next.summarizationStatus?.status)
    return false;
  if (prev.tempChatFileDetails !== next.tempChatFileDetails) return false;

  // Compare message by reference first, then by parts length for streaming
  if (prev.message !== next.message) {
    // During streaming, parts array changes
    if (prev.message.id !== next.message.id) return false;
    // Saved artifacts may arrive or refresh after the text has settled.
    if (prev.message.fileDetails !== next.message.fileDetails) return false;
    if (prev.message.parts.length !== next.message.parts.length) return false;
    // Parallel tools can finish behind already-emitted prose. Inspect every
    // changed part reference so those earlier status updates remain visible.
    if (
      prev.message.parts.some(
        (part, index) => part !== next.message.parts[index],
      )
    )
      return false;
    // generationTimeMs arrives in message-metadata after the last text-delta;
    // parts may be unchanged but metadata needs to trigger a re-render so the
    // "Worked for X" pill shows the duration.
    if (prev.message.metadata?.mode !== next.message.metadata?.mode)
      return false;
    if (
      prev.message.metadata?.generationStartedAt !==
      next.message.metadata?.generationStartedAt
    )
      return false;
    if (
      prev.message.metadata?.generationTimeMs !==
      next.message.metadata?.generationTimeMs
    )
      return false;
    // Usage receipts can arrive after text and duration have already settled.
    if (
      prev.message.metadata?.totalTokens !== next.message.metadata?.totalTokens
    )
      return false;
    if (
      prev.message.metadata?.costDollars !== next.message.metadata?.costDollars
    )
      return false;
    if (prev.message.createdAt !== next.message.createdAt) return false;
    if (prev.message.metadata?.createdAt !== next.message.metadata?.createdAt)
      return false;
  }

  return true;
}

/** Wall-clock stamp for the prompt row, as a terminal echoes it: "6:24 PM". */
export const formatPromptTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * Run figures for the end-of-run row: "26.2k · $0.053". Sub-cent costs keep
 * enough precision to stay honest instead of rounding away to $0.00.
 */
export function formatRunFigures(
  totalTokens?: number,
  costDollars?: number,
): string | null {
  const parts: string[] = [];

  if (
    typeof totalTokens === "number" &&
    Number.isFinite(totalTokens) &&
    totalTokens > 0
  ) {
    parts.push(
      totalTokens >= 1000
        ? `${(totalTokens / 1000).toFixed(1)}k`
        : `${totalTokens}`,
    );
  }

  if (
    typeof costDollars === "number" &&
    Number.isFinite(costDollars) &&
    costDollars > 0
  ) {
    parts.push(
      costDollars < 0.01
        ? `$${costDollars.toFixed(4)}`
        : `$${costDollars.toFixed(2)}`,
    );
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

export const MessageItem = memo(function MessageItem({
  message,
  isLastMessage,
  isLastAssistantMessage,
  isAwaitingApproval = false,
  isBranchBoundary,
  status,
  isHovered = false,
  isEditing,
  isMobile,
  feedbackInputMessageId,
  tempChatFileDetails,
  finishReason,
  mode,
  purpose,
  isTemporaryChat,
  branchedFromChatId,
  branchedFromChatTitle,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onRegenerate,
  onContinue,
  onBranchMessage,
  onFeedback,
  onFeedbackSubmit,
  onFeedbackCancel,
  onShowAllFiles,
  getCachedUrl,
  showingLoadingIndicator,
  summarizationStatus,
}: MessageItemProps) {
  const [isUserMessageExpanded, setIsUserMessageExpanded] = useState(false);
  const isUser = message.role === "user";
  const canRegenerate = status === "ready" || status === "error";

  // Only the last assistant message should propagate "streaming" status to its
  // tool handlers. Old messages may have tools stuck in input-available /
  // input-streaming state (e.g. from a broken stream) — passing the global
  // "streaming" status to them would incorrectly show shimmer animations.
  const effectiveStatus: ChatStatus =
    (status === "streaming" || status === "submitted") &&
    !isLastAssistantMessage
      ? "ready"
      : status;

  // Memoize expensive computations
  const messageText = useMemo(
    () => extractMessageText(message.parts),
    [message.parts],
  );

  const messageHasTextContent = useMemo(
    () => hasTextContent(message.parts),
    [message.parts],
  );

  // Memoize part filtering - only recompute when parts change
  const { fileParts, deliverableParts, nonFileParts, contentParts } = useMemo(
    () => splitWorkedForParts(message.parts),
    [message.parts],
  );

  const shouldCollapseUserMessage =
    isUser &&
    nonFileParts.length > 0 &&
    nonFileParts.every((part) => part.type === "text") &&
    isLongUserMessageText(messageText);

  const collapsedUserMessageText = useMemo(
    () => (shouldCollapseUserMessage ? getUserMessagePreview(messageText) : ""),
    [messageText, shouldCollapseUserMessage],
  );

  const handleShowFullUserMessage = useCallback(() => {
    setIsUserMessageExpanded(true);
  }, []);

  const handleShowLessUserMessage = useCallback(() => {
    setIsUserMessageExpanded(false);
  }, []);

  const isStreamingThisMessage =
    message.role === "assistant" &&
    isLastAssistantMessage &&
    effectiveStatus === "streaming";

  const generationTimeMs =
    typeof message.metadata?.generationTimeMs === "number"
      ? message.metadata.generationTimeMs
      : undefined;
  const generationStartedAt =
    typeof message.metadata?.generationStartedAt === "number"
      ? message.metadata.generationStartedAt
      : undefined;
  const shouldUseAgentTranscript = message.metadata?.mode === "agent";
  // What the run cost, reported where the run ends, so the user does not have
  // to open the usage page to find out.
  const runFigures = formatRunFigures(
    message.metadata?.totalTokens,
    message.metadata?.costDollars,
  );
  const liveProgress = useMemo(
    () => buildLiveProgressPresentation(message.parts),
    [message.parts],
  );

  const showLiveFooter =
    isStreamingThisMessage &&
    (isAwaitingApproval ||
      !hasVisibleLiveReasoning(message.parts, effectiveStatus, isLastMessage));

  // Pre-compute terminal output by toolCallId so TerminalToolHandler doesn't filter all parts per instance
  const terminalOutputByToolCallId = useMemo(() => {
    const map = new Map<string, string>();
    message.parts.forEach((p) => {
      if (p.type === "data-terminal" && (p as any).data?.toolCallId) {
        const id = (p as any).data.toolCallId;
        const terminal = (p as any).data?.terminal || "";
        map.set(id, (map.get(id) || "") + terminal);
      }
    });
    return map;
  }, [message.parts]);

  const hasFileContent = fileParts.length > 0;
  const hasAnyContent =
    messageHasTextContent || hasFileContent || deliverableParts.length > 0;

  // Memoize file details
  const effectiveFileDetails = useMemo(() => {
    if (isUser) return undefined;

    return (
      message.fileDetails || tempChatFileDetails?.get(message.id) || undefined
    );
  }, [isUser, message.fileDetails, message.id, tempChatFileDetails]);

  const savedFiles = useMemo(() => {
    if (isUser || !effectiveFileDetails) return [];
    const inlineFileIds = new Set(
      deliverableParts
        .map((part) =>
          part &&
          typeof part === "object" &&
          "output" in part &&
          part.output &&
          typeof part.output === "object" &&
          "fileId" in part.output &&
          typeof part.output.fileId === "string"
            ? part.output.fileId
            : null,
        )
        .filter((fileId): fileId is string => fileId !== null),
    );

    return effectiveFileDetails.filter(
      (file) =>
        (file.url || file.storageId || file.s3Key) &&
        !inlineFileIds.has(file.fileId),
    );
  }, [deliverableParts, effectiveFileDetails, isUser]);

  const shouldShowBranchIndicator = Boolean(
    branchedFromChatId && branchedFromChatTitle && isBranchBoundary,
  );

  // Memoize web sources extraction
  const webSources = useMemo(() => {
    if (isUser) return [];
    if (isLastAssistantMessage && status === "streaming") return [];
    return extractWebSourcesFromMessage(message as any);
  }, [isUser, isLastAssistantMessage, status, message]);

  // Stable event handlers
  const handleEdit = useCallback(() => {
    onStartEdit(message.id);
  }, [onStartEdit, message.id]);

  const handleBranch = useCallback(() => {
    onBranchMessage?.(message.id);
  }, [onBranchMessage, message.id]);

  const handleFeedbackClick = useCallback(
    (type: "positive" | "negative") => {
      onFeedback(message.id, type);
    },
    [onFeedback, message.id],
  );

  const changedFiles = useMemo(
    () =>
      isUser
        ? []
        : extractAllSidebarContent([
            {
              ...message,
              parts: message.parts.filter((part) => {
                if (!part.type.startsWith("tool-")) return true;
                const result = part as {
                  state?: string;
                  output?: { error?: unknown; success?: boolean };
                };
                return (
                  result.state === "output-available" &&
                  !result.output?.error &&
                  result.output?.success !== false
                );
              }),
            },
          ] as any[]),
    [isUser, message],
  );

  // Memoize editable files for MessageEditor
  const editableFiles = useMemo(() => {
    return fileParts
      .filter((part) => part.fileId)
      .map((part) => {
        return {
          fileId: part.fileId as string,
          name: part.name || part.filename || "File",
          mediaType: part.mediaType,
          url: part.url || getCachedUrl(part.fileId as string),
        } as EditableFile;
      });
  }, [fileParts, getCachedUrl]);

  // Skip rendering empty assistant message when loading indicator is shown
  // (the loading indicator is shown separately in Messages.tsx)
  if (isLastAssistantMessage && !hasAnyContent && showingLoadingIndicator) {
    return null;
  }
  // Skip rendering empty historical assistant messages (only metadata parts,
  // no text/tool/file content) — they produce empty bubbles with just action buttons.
  if (!isUser && !hasAnyContent && !isLastAssistantMessage) {
    return null;
  }

  const renderAssistantPart = (partIndex: number) => {
    const part = message.parts[partIndex];
    const content = (
      <MessagePartHandler
        message={message}
        part={part}
        partIndex={partIndex}
        status={effectiveStatus}
        isLastMessage={isLastMessage}
        terminalOutputByToolCallId={terminalOutputByToolCallId}
        sharedFileDetails={effectiveFileDetails}
      />
    );
    return part.type === "tool-generate_image" ||
      part.type === "tool-generate_video" ? (
      <section
        aria-label="Generated media"
        data-ui="generated-media-results"
        className="not-prose my-3 w-full min-w-0"
      >
        {content}
      </section>
    ) : (
      content
    );
  };

  return (
    <Fragment>
      <div
        data-testid={isUser ? "user-message" : "assistant-message"}
        data-message-id={message.id}
        data-rift-final={
          isLastAssistantMessage && !isStreamingThisMessage ? "true" : undefined
        }
        className="group/message flex w-full flex-col"
      >
        {isEditing && isUser ? (
          <div className="flex w-full">
            <div className="min-w-0 flex-1">
              <MessageEditor
                initialContent={messageText}
                initialFiles={editableFiles}
                onSave={onSaveEdit}
                onCancel={onCancelEdit}
              />
            </div>
          </div>
        ) : (
          <div className="flex w-full items-start">
            <div
              className={`min-w-0 overflow-hidden ${
                isUser
                  ? "flex w-full flex-col items-stretch gap-1"
                  : "flex-1 text-foreground"
              }`}
            >
              {/* Render file parts first for user messages */}
              {isUser && fileParts.length > 0 && (
                <div className="mb-1 flex w-full flex-wrap items-center gap-2 px-1">
                  {fileParts.map((part, partIndex) => (
                    <FilePartRenderer
                      key={`${message.id}-file-${partIndex}`}
                      part={part}
                      partIndex={partIndex}
                      messageId={message.id}
                      totalFileParts={fileParts.length}
                    />
                  ))}
                </div>
              )}

              {/* Render assistant-generated file parts (e.g. images from the
                  generate_image tool) — these are emitted on the assistant
                  message, not just user uploads. */}
              {!isUser && fileParts.length > 0 && (
                <div className="flex flex-wrap items-start gap-2 w-full mb-2">
                  {fileParts.map((part, partIndex) => (
                    <FilePartRenderer
                      key={`${message.id}-afile-${partIndex}`}
                      part={part}
                      partIndex={partIndex}
                      messageId={message.id}
                      totalFileParts={fileParts.length}
                      large
                    />
                  ))}
                </div>
              )}

              {/* Render text and other parts */}
              {contentParts.length > 0 && (
                <div
                  data-testid="message-content"
                  className={`${
                    isUser
                      ? // Grok's turn anatomy, measured: the user's message is a
                        // right-aligned rounded pill — 24px radius with a tight
                        // 8px bottom-right corner, 8x16 padding, capped width,
                        // same 15px prose as the answer (not a terminal echo).
                        "ml-auto w-fit max-w-[576px] rounded-[14px] rounded-br-[6px] bg-foreground/[0.06] px-4 py-2 rift-conversation-prose text-foreground"
                      : // The answer runs at Grok's measured metrics: one size
                        // for everything, bold at 550 doing the work headings
                        // would, 4px list rhythm.
                        "prose min-w-0 w-full max-w-none rift-conversation-prose text-foreground dark:prose-invert prose-headings:mb-2 prose-headings:mt-4 prose-headings:font-medium prose-strong:font-medium prose-p:my-2 prose-li:my-1"
                  } overflow-hidden`}
                >
                  {isUser ? (
                    <>
                      <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                        {shouldCollapseUserMessage && !isUserMessageExpanded ? (
                          <>
                            <div>{collapsedUserMessageText}</div>
                            <div aria-hidden="true">…</div>
                            <button
                              type="button"
                              onClick={handleShowFullUserMessage}
                              aria-expanded={false}
                              className="mt-2 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <span>Show full message</span>
                              <ChevronDown className="size-4 shrink-0" />
                            </button>
                          </>
                        ) : (
                          <>
                            {nonFileParts.map((part, partIndex) => (
                              <MessagePartHandler
                                key={`${message.id}-${partIndex}`}
                                message={message}
                                part={part}
                                partIndex={partIndex}
                                status={effectiveStatus}
                                terminalOutputByToolCallId={
                                  terminalOutputByToolCallId
                                }
                              />
                            ))}
                            {shouldCollapseUserMessage &&
                              isUserMessageExpanded && (
                                <button
                                  type="button"
                                  onClick={handleShowLessUserMessage}
                                  aria-expanded={true}
                                  className="mt-2 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  <span>Show less</span>
                                  <ChevronUp className="size-4 shrink-0" />
                                </button>
                              )}
                          </>
                        )}
                      </div>
                    </>
                  ) : !shouldUseAgentTranscript ? (
                    message.parts.map((part, partIndex) =>
                      part.type === "file" ? null : (
                        <Fragment key={`${message.id}-${partIndex}`}>
                          {renderAssistantPart(partIndex)}
                        </Fragment>
                      ),
                    )
                  ) : (
                    <AssistantTranscript
                      parts={message.parts}
                      isAwaitingApproval={isAwaitingApproval}
                      status={effectiveStatus}
                      renderPart={renderAssistantPart}
                    />
                  )}
                  {showLiveFooter ? (
                    <CursorThinking
                      phase={
                        isAwaitingApproval ? "working" : liveProgress.phase
                      }
                      startedAt={generationStartedAt}
                      title={
                        isAwaitingApproval
                          ? "Waiting for approval"
                          : liveProgress.title
                      }
                      ariaLabel={
                        isAwaitingApproval
                          ? "Waiting for your approval. This action has not run."
                          : liveProgress.ariaLabel
                      }
                      source={liveProgress.source}
                    />
                  ) : null}
                </div>
              )}

              {/* For assistant messages without the user-specific styling, render files mixed with content */}
              {!isUser &&
                fileParts.length > 0 &&
                nonFileParts.length === 0 &&
                deliverableParts.length === 0 && (
                  <div className="prose min-w-0 max-w-none space-y-2.5 overflow-hidden text-[14px] leading-5 dark:prose-invert">
                    {message.parts.map((part, partIndex) => (
                      <MessagePartHandler
                        key={`${message.id}-${partIndex}`}
                        message={message}
                        part={part}
                        partIndex={partIndex}
                        status={effectiveStatus}
                        terminalOutputByToolCallId={terminalOutputByToolCallId}
                        sharedFileDetails={effectiveFileDetails}
                      />
                    ))}
                  </div>
                )}

              {isStreamingThisMessage && contentParts.length === 0 ? (
                <CursorThinking
                  phase={isAwaitingApproval ? "working" : liveProgress.phase}
                  startedAt={generationStartedAt}
                  title={
                    isAwaitingApproval
                      ? "Waiting for approval"
                      : liveProgress.title
                  }
                  ariaLabel={
                    isAwaitingApproval
                      ? "Waiting for your approval. This action has not run."
                      : liveProgress.ariaLabel
                  }
                  source={liveProgress.source}
                />
              ) : null}
            </div>
          </div>
        )}

        {!isUser &&
        shouldUseAgentTranscript &&
        !isStreamingThisMessage &&
        (generationTimeMs || runFigures) ? (
          <div
            data-ui="run-completion"
            className="mt-2 text-ui-caption text-muted-foreground tabular-nums"
          >
            {typeof generationTimeMs === "number"
              ? `Worked for ${Math.max(1, Math.round(generationTimeMs / 1000))}s`
              : ""}
            {runFigures ? `${generationTimeMs ? " · " : ""}${runFigures}` : ""}
          </div>
        ) : null}

        {/* Saved files from tools (hidden only on the actively streaming message - previous messages always show files) */}
        {!isUser &&
          savedFiles.length > 0 &&
          !(status === "streaming" && isLastAssistantMessage) && (
            <div className="mt-2 flex w-full flex-wrap items-center gap-2 animate-in fade-in-0 duration-200">
              {savedFiles.length > 2 ? (
                <>
                  {/* Show only last file when more than 2 */}
                  <FilePartRenderer
                    key={`${message.id}-saved-file-${savedFiles.length - 1}`}
                    part={{
                      url: savedFiles[savedFiles.length - 1].url ?? undefined,
                      storageId: savedFiles[savedFiles.length - 1].storageId,
                      fileId: savedFiles[savedFiles.length - 1].fileId,
                      s3Key: savedFiles[savedFiles.length - 1].s3Key,
                      name: savedFiles[savedFiles.length - 1].name,
                      filename: savedFiles[savedFiles.length - 1].name,
                      mediaType: savedFiles[savedFiles.length - 1].mediaType,
                    }}
                    partIndex={savedFiles.length - 1}
                    messageId={message.id}
                    totalFileParts={savedFiles.length}
                    large={
                      savedFiles[savedFiles.length - 1].mediaType?.startsWith(
                        "video/",
                      ) ||
                      savedFiles[savedFiles.length - 1].mediaType?.startsWith(
                        "image/",
                      )
                    }
                  />
                  {/* View all files button */}
                  <button
                    onClick={() =>
                      onShowAllFiles(message, effectiveFileDetails || [])
                    }
                    className="flex h-11 w-full min-w-64 max-w-72 items-center gap-2 rounded-lg border border-border bg-card px-3 transition-colors hover:bg-accent"
                    type="button"
                    aria-label="View all files"
                  >
                    <FileSearch
                      className="w-4 h-4 text-muted-foreground"
                      strokeWidth={2}
                    />
                    <span className="text-sm text-muted-foreground">
                      View all files in this task
                    </span>
                  </button>
                </>
              ) : (
                /* Show all files when 2 or less */
                savedFiles.map((file, fileIndex) => (
                  <FilePartRenderer
                    key={`${message.id}-saved-file-${fileIndex}`}
                    part={{
                      url: file.url ?? undefined,
                      storageId: file.storageId,
                      fileId: file.fileId,
                      s3Key: file.s3Key,
                      name: file.name,
                      filename: file.name,
                      mediaType: file.mediaType,
                    }}
                    partIndex={fileIndex}
                    messageId={message.id}
                    totalFileParts={savedFiles.length}
                    large={
                      file.mediaType?.startsWith("video/") ||
                      file.mediaType?.startsWith("image/")
                    }
                  />
                ))
              )}
            </div>
          )}

        {/* Inline summarization status - only shown when last assistant message has content */}
        {isLastAssistantMessage &&
          hasAnyContent &&
          summarizationStatus?.status === "started" && (
            <div className="flex items-center gap-2 mt-2">
              <WandSparkles className="w-4 h-4 text-muted-foreground" />
              <Shimmer className="text-sm">
                {`${summarizationStatus.message}...`}
              </Shimmer>
            </div>
          )}

        {/* Finish reason notice under last assistant message */}
        {isLastAssistantMessage && status !== "streaming" && (
          <FinishReasonNotice
            finishReason={finishReason}
            mode={mode}
            purpose={purpose}
            onContinue={onContinue}
          />
        )}

        {!isUser &&
          message.parts.some(
            (part) =>
              part.type.startsWith("tool-") &&
              /Action (denied|expired|canceled)\./.test(
                String((part as { errorText?: string }).errorText ?? ""),
              ),
          ) && (
            <p className="my-3 text-[13px] text-muted-foreground">
              Action not approved. This action was not executed.
            </p>
          )}
        {!isUser && changedFiles.length > 0 && (
          <FilesChangedCard toolExecutions={changedFiles} />
        )}

        <MessageActions
          messageText={messageText}
          isUser={isUser}
          isLastAssistantMessage={isLastAssistantMessage}
          canRegenerate={canRegenerate}
          onRegenerate={onRegenerate}
          onEdit={handleEdit}
          onBranch={!isUser && onBranchMessage ? handleBranch : undefined}
          isHovered={isHovered}
          isEditing={isEditing}
          isMobile={isMobile}
          messageCreatedAt={message.createdAt ?? message.metadata?.createdAt}
          status={status}
          onFeedback={handleFeedbackClick}
          existingFeedback={message.metadata?.feedbackType || null}
          isAwaitingFeedbackDetails={feedbackInputMessageId === message.id}
          hasFileContent={hasFileContent}
          isTemporaryChat={Boolean(isTemporaryChat)}
          sources={webSources}
        />

        {/* Show feedback input for negative feedback */}
        {feedbackInputMessageId === message.id && (
          <div className="w-full">
            <FeedbackInput
              onSend={onFeedbackSubmit}
              onCancel={onFeedbackCancel}
            />
          </div>
        )}
      </div>

      {/* Branch indicator - show after the branched message */}
      {shouldShowBranchIndicator && (
        <BranchIndicator
          branchedFromChatId={branchedFromChatId!}
          branchedFromChatTitle={branchedFromChatTitle!}
        />
      )}
    </Fragment>
  );
}, areMessageItemPropsEqual);
