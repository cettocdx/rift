import { CodePresentationProvider } from "../contexts/CodePresentationContext";
import type { ChatViewState } from "../contexts/ChatViewStateContext";
import { ConversationOutline } from "./ConversationOutline";
import {
  useState,
  RefObject,
  useEffect,
  useMemo,
  useCallback,
  Dispatch,
  SetStateAction,
} from "react";
import dynamic from "next/dynamic";
import { MessageItem } from "./MessageItem";
import { MessageErrorState } from "./MessageErrorState";
import { Shimmer } from "@/components/ai-elements/shimmer";
import Loading from "@/components/ui/loading";
import { useFeedback } from "../hooks/useFeedback";
import { useFileUrlCache } from "../hooks/useFileUrlCache";
import { FileUrlCacheProvider } from "../contexts/FileUrlCacheContext";
import { findLastAssistantMessageIndex } from "@/lib/utils/message-utils";
import type { ChatStatus, ChatMessage, ChatPurpose } from "@/types";
import type { FileDetails } from "@/types/file";
import { toast } from "sonner";
import { WandSparkles } from "lucide-react";
import { CursorThinking } from "@/components/ui/cursor-thinking";
import { hasTextContent } from "@/lib/utils/message-utils";
import { useDataStreamState } from "./DataStreamProvider";
import { AssistantCompletionAnnouncer } from "./AssistantCompletionAnnouncer";

// AllFilesDialog owns the bulk-download path (including JSZip). Defer that
// rarely used dependency until the user explicitly opens the file browser.
const AllFilesDialog = dynamic(() =>
  import("./AllFilesDialog").then((module) => module.AllFilesDialog),
);

interface MessagesProps {
  codePresentationView?: ChatViewState;
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  onRegenerate: () => void;
  onRetry: () => void;
  onContinue?: () => void;
  onReconnect?: () => void;
  onEditMessage: (
    messageId: string,
    newContent: string,
    remainingFileIds?: string[],
  ) => Promise<void>;
  onBranchMessage?: (messageId: string) => Promise<void>;
  status: ChatStatus;
  error: Error | null;
  /** Live run controls, including tool approvals, inside the conversation flow. */
  runFooter?: React.ReactNode;
  isAwaitingApproval?: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  paginationStatus?:
    | "LoadingFirstPage"
    | "CanLoadMore"
    | "LoadingMore"
    | "Exhausted";
  loadMore?: (numItems: number) => void;
  isTemporaryChat?: boolean;
  isMobile?: boolean;
  tempChatFileDetails?: Map<string, FileDetails[]>;
  finishReason?: string;
  uploadStatus?: { message: string; isUploading: boolean } | null;
  summarizationStatus?: {
    status: "started" | "completed";
    message: string;
  } | null;
  mode?: import("@/types").ChatMode;
  chatPurpose?: ChatPurpose;
  chatTitle?: string | null;
  branchedFromChatId?: string;
  branchedFromChatTitle?: string;
  /** True from the moment Stop is pressed until the next send. */
  stoppedByUserRef?: RefObject<boolean>;
}

type VisibleMessageEntry = {
  message: ChatMessage;
  renderKey: string;
};

export type MessagePositionFlags = {
  isLastMessage: boolean;
  isLastAssistantMessage: boolean;
  isBranchBoundary: boolean;
};

type StandaloneAgentStatusInput = {
  messages: readonly ChatMessage[];
  status: ChatStatus;
  isAutoResuming: boolean;
  hasBlockingProcessStatus: boolean;
};

/**
 * The live row normally renders inside the newest assistant message. Before
 * the first stream part exists there is no assistant host, so keep a standalone
 * row below the user's turn. This also covers reconnect setup, where useChat
 * intentionally remains `ready` until the durable response has been found.
 */
export const shouldShowStandaloneAgentStatus = ({
  messages,
  status,
  isAutoResuming,
  hasBlockingProcessStatus,
}: StandaloneAgentStatusInput): boolean => {
  if (hasBlockingProcessStatus) return false;
  if (isAutoResuming) return true;
  if (status !== "streaming" && status !== "submitted") return false;

  const latestMessage = messages.at(-1);
  return !(
    latestMessage?.role === "assistant" && latestMessage.parts.length > 0
  );
};

/**
 * Trigger-backed agent messages use the Trigger run id as their message id.
 * During reconnect, the persisted message and the replayed in-flight message
 * can briefly coexist with the same id. React keys therefore need a stable
 * occurrence discriminator in addition to the logical message id.
 */
export const createVisibleMessageEntries = (
  messages: ChatMessage[],
): VisibleMessageEntry[] => {
  const occurrencesById = new Map<string, number>();

  return messages.map((message) => {
    const occurrence = occurrencesById.get(message.id) ?? 0;
    occurrencesById.set(message.id, occurrence + 1);

    return {
      message,
      // JSON tuple encoding avoids delimiter collisions between arbitrary ids.
      renderKey: JSON.stringify([message.id, occurrence]),
    };
  });
};

/**
 * Pass only the positional facts a row renders instead of the collection's
 * changing length/index metadata. Historical rows can then stay memoized when
 * older pages are prepended or a new turn is appended.
 */
export const getMessagePositionFlags = ({
  message,
  index,
  messagesLength,
  lastAssistantMessageIndex,
  branchBoundaryIndex,
}: {
  message: ChatMessage;
  index: number;
  messagesLength: number;
  lastAssistantMessageIndex: number | undefined;
  branchBoundaryIndex: number;
}): MessagePositionFlags => ({
  isLastMessage: index === messagesLength - 1,
  isLastAssistantMessage:
    message.role === "assistant" && index === lastAssistantMessageIndex,
  isBranchBoundary: index === branchBoundaryIndex,
});

export const Messages = ({
  runFooter,
  isAwaitingApproval = false,
  messages,
  setMessages,
  onRegenerate,
  onRetry,
  onContinue,
  onReconnect,
  onEditMessage,
  onBranchMessage,
  status,
  error,
  scrollRef,
  contentRef,
  paginationStatus,
  loadMore,
  isTemporaryChat,
  isMobile,
  tempChatFileDetails,
  finishReason,
  uploadStatus,
  summarizationStatus,
  mode,
  chatPurpose,
  chatTitle,
  branchedFromChatId,
  branchedFromChatTitle,
  stoppedByUserRef,
  codePresentationView,
}: MessagesProps) => {
  const { isAutoResuming } = useDataStreamState();
  // Prefetch and cache image URLs for better performance
  const { getCachedUrl, setCachedUrl } = useFileUrlCache(messages);

  // Filter out auto-continue messages for rendering
  const visibleMessages = useMemo(
    () => messages.filter((msg) => !msg.metadata?.isAutoContinue),
    [messages],
  );
  const visibleMessageEntries = useMemo(
    () => createVisibleMessageEntries(visibleMessages),
    [visibleMessages],
  );

  // Memoize expensive calculations
  const lastAssistantMessageIndex = useMemo(() => {
    return findLastAssistantMessageIndex(visibleMessages);
  }, [visibleMessages]);

  // Check if last assistant message has any content (text or files)
  const lastAssistantHasContent = useMemo(() => {
    if (lastAssistantMessageIndex === undefined) return false;
    const lastAssistantMsg = visibleMessages[lastAssistantMessageIndex];
    if (!lastAssistantMsg) return false;
    const hasText = hasTextContent(lastAssistantMsg.parts);
    const hasFiles = lastAssistantMsg.parts.some(
      (part) => part.type === "file",
    );
    return hasText || hasFiles;
  }, [lastAssistantMessageIndex, visibleMessages]);

  // Before the first assistant part arrives, keep an operational row directly
  // below the user's turn. Once a part exists, MessageItem owns the inline row.
  const shouldShowStandaloneStatus = useMemo(
    () =>
      shouldShowStandaloneAgentStatus({
        messages: visibleMessages,
        status,
        isAutoResuming,
        hasBlockingProcessStatus:
          summarizationStatus?.status === "started" ||
          Boolean(uploadStatus?.isUploading),
      }),
    [
      isAutoResuming,
      status,
      summarizationStatus,
      uploadStatus,
      visibleMessages,
    ],
  );

  const standaloneStatusPhase = isAutoResuming
    ? "connecting"
    : status === "submitted"
      ? "starting"
      : "reasoning";

  // Determine if summarization status should be shown as a separate element vs inline
  // Upload status and loading dots ALWAYS show separately (they only appear when no content yet)
  // Summarization status shows separately only when last assistant has no content
  const showSummarizationSeparately = useMemo(() => {
    return (
      summarizationStatus?.status === "started" && !lastAssistantHasContent
    );
  }, [summarizationStatus, lastAssistantHasContent]);

  // Compute the branch boundary: last message that originated from another chat
  const branchBoundaryIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sourceMessageId) return i;
    }
    return -1;
  }, [messages]);

  // Track edit state for messages
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);

  // Track all files dialog state
  const [showAllFilesDialog, setShowAllFilesDialog] = useState(false);
  const [dialogFiles, setDialogFiles] = useState<
    Array<{
      part: any;
      partIndex: number;
      messageId: string;
    }>
  >([]);

  // Handle feedback logic
  const {
    feedbackInputMessageId,
    handleFeedback,
    handleFeedbackSubmit,
    handleFeedbackCancel,
  } = useFeedback({ messages, setMessages });

  // Sidebar auto-open removed - sidebar only opens via manual clicks

  // Memoized edit handlers to prevent unnecessary re-renders
  const handleStartEdit = useCallback((messageId: string) => {
    setEditingMessageId(messageId);
  }, []);

  const handleSaveEdit = useCallback(
    async (newContent: string, remainingFileIds: string[]) => {
      if (editingMessageId) {
        try {
          await onEditMessage(editingMessageId, newContent, remainingFileIds);
        } catch (error) {
          console.error("Failed to edit message:", error);
          toast.error("Failed to edit message. Please try again.");
        } finally {
          setEditingMessageId(null);
        }
      }
    },
    [editingMessageId, onEditMessage],
  );

  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
  }, []);

  // Handler to show all files for a specific message
  const handleShowAllFiles = useCallback(
    (message: ChatMessage, fileDetails: FileDetails[]) => {
      if (!fileDetails || fileDetails.length === 0) return;

      const files = fileDetails
        .filter((file) => file.url || file.storageId || file.s3Key)
        .map((file, fileIndex) => ({
          part: {
            url: file.url ?? undefined,
            storageId: file.storageId,
            fileId: file.fileId,
            s3Key: file.s3Key,
            name: file.name,
            filename: file.name,
            mediaType: file.mediaType,
          },
          partIndex: fileIndex,
          messageId: message.id,
        }));

      setDialogFiles(files);
      setShowAllFilesDialog(true);
    },
    [],
  );

  // Handler for branching a message
  const handleBranchMessage = useCallback(
    async (messageId: string) => {
      if (onBranchMessage) {
        try {
          await onBranchMessage(messageId);
        } catch (error) {
          console.error("Failed to branch message:", error);
          toast.error("Failed to branch chat. Please try again.");
        }
      }
    },
    [onBranchMessage],
  );

  // Handle scroll to load more messages when scrolling to top
  const handleScroll = useCallback(() => {
    if (!scrollRef.current || !loadMore || paginationStatus !== "CanLoadMore") {
      return;
    }

    const { scrollTop } = scrollRef.current;

    // Check if we're near the top (within 100px)
    if (scrollTop < 100) {
      loadMore(28); // Load 28 more messages
    }
  }, [scrollRef, loadMore, paginationStatus]);

  // Add scroll event listener
  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    scrollElement.addEventListener("scroll", handleScroll);
    return () => scrollElement.removeEventListener("scroll", handleScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleScroll]);

  return (
    <CodePresentationProvider view={codePresentationView}>
      <FileUrlCacheProvider
        getCachedUrl={getCachedUrl}
        setCachedUrl={setCachedUrl}
      >
        <AssistantCompletionAnnouncer
          messages={visibleMessages}
          status={status}
          stoppedByUserRef={stoppedByUserRef}
        />
        <div className="relative flex min-h-0 flex-1">
          <ConversationOutline
            messages={visibleMessages}
            scrollRef={scrollRef}
          />
          <div
            ref={scrollRef}
            className="messages-scroll flex-1 min-h-0 overflow-y-auto terminal-scrollbar"
          >
            <div
              ref={contentRef}
              className="mx-auto flex w-full max-w-[840px] flex-col space-y-5 px-4 pb-24 pt-4 md:px-5 md:pt-5"
              data-testid="messages-container"
            >
              {/* Loading indicator at top when loading more messages */}
              {paginationStatus === "LoadingMore" && (
                <div className="flex justify-center py-2">
                  <Loading size={6} />
                </div>
              )}
              {visibleMessageEntries.map(({ message, renderKey }, index) => {
                const position = getMessagePositionFlags({
                  message,
                  index,
                  messagesLength: visibleMessages.length,
                  lastAssistantMessageIndex,
                  branchBoundaryIndex,
                });

                return (
                  <MessageItem
                    key={renderKey}
                    message={message}
                    {...position}
                    isAwaitingApproval={
                      position.isLastAssistantMessage && isAwaitingApproval
                    }
                    // Run controls belong to the newest assistant. Historical
                    // rows retain their settled content and actions when the
                    // current run starts, finishes, or changes its live notice.
                    status={position.isLastAssistantMessage ? status : "ready"}
                    isEditing={editingMessageId === message.id}
                    isMobile={isMobile}
                    feedbackInputMessageId={feedbackInputMessageId}
                    tempChatFileDetails={tempChatFileDetails}
                    finishReason={
                      position.isLastAssistantMessage && !error
                        ? finishReason
                        : undefined
                    }
                    mode={mode}
                    purpose={chatPurpose}
                    isTemporaryChat={isTemporaryChat}
                    branchedFromChatId={branchedFromChatId}
                    branchedFromChatTitle={branchedFromChatTitle}
                    onStartEdit={handleStartEdit}
                    onSaveEdit={handleSaveEdit}
                    onCancelEdit={handleCancelEdit}
                    onRegenerate={onRegenerate}
                    onContinue={onContinue}
                    onBranchMessage={
                      onBranchMessage ? handleBranchMessage : undefined
                    }
                    onFeedback={handleFeedback}
                    onFeedbackSubmit={handleFeedbackSubmit}
                    onFeedbackCancel={handleFeedbackCancel}
                    onShowAllFiles={handleShowAllFiles}
                    getCachedUrl={getCachedUrl}
                    showingLoadingIndicator={
                      position.isLastAssistantMessage &&
                      (summarizationStatus?.status === "started" ||
                        Boolean(uploadStatus?.isUploading) ||
                        shouldShowStandaloneStatus)
                    }
                    summarizationStatus={
                      position.isLastAssistantMessage
                        ? summarizationStatus
                        : null
                    }
                  />
                );
              })}

              {/* Processing status - upload/loading dots always separate, summarization only when no content */}
              {(showSummarizationSeparately ||
                uploadStatus?.isUploading ||
                shouldShowStandaloneStatus) && (
                <div className="flex flex-col items-start">
                  {showSummarizationSeparately && (
                    <div className="flex items-center gap-2">
                      <WandSparkles className="w-4 h-4 text-muted-foreground" />
                      <Shimmer className="text-sm">
                        {`${summarizationStatus?.message}...`}
                      </Shimmer>
                    </div>
                  )}
                  {uploadStatus?.isUploading && (
                    <Shimmer className="text-sm">{`${uploadStatus.message}...`}</Shimmer>
                  )}
                  {shouldShowStandaloneStatus && (
                    <CursorThinking phase={standaloneStatusPhase} />
                  )}
                </div>
              )}

              {/* Build timeouts are durable segment hand-offs, not visible errors. */}
              {error &&
                !(
                  chatPurpose === "app" &&
                  (finishReason === "timeout" ||
                    finishReason === "preemptive-timeout")
                ) && (
                  <MessageErrorState
                    error={error}
                    onRetry={onRetry}
                    onReconnect={onReconnect}
                  />
                )}

              {runFooter}
            </div>

            {/* All Files Dialog */}
            {showAllFilesDialog ? (
              <AllFilesDialog
                open
                onOpenChange={setShowAllFilesDialog}
                files={dialogFiles}
                chatTitle={chatTitle}
              />
            ) : null}
          </div>
        </div>
      </FileUrlCacheProvider>
    </CodePresentationProvider>
  );
};
