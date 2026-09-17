import {
  Copy,
  Check,
  RotateCcw,
  Pencil,
  ThumbsUp,
  ThumbsDown,
  Split,
} from "lucide-react";
import { useState } from "react";
import type { ChatStatus } from "@/types";
import { WithTooltip } from "@/components/ui/with-tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMessageActionTimestamp } from "@/lib/utils/message-time";
import { SourcesDialog } from "./SourcesDialog";
import { SourceDomainBadge } from "./SourceDomainBadge";

interface MessageActionsProps {
  messageText: string;
  isUser: boolean;
  isLastAssistantMessage: boolean;
  canRegenerate: boolean;
  onRegenerate: () => void;
  onEdit: () => void;
  onBranch?: () => void;
  isHovered: boolean;
  isEditing: boolean;
  isMobile?: boolean;
  messageCreatedAt?: number;
  status: ChatStatus;
  onFeedback?: (type: "positive" | "negative") => void;
  existingFeedback?: "positive" | "negative" | null;
  isAwaitingFeedbackDetails?: boolean;
  hasFileContent?: boolean;
  isTemporaryChat?: boolean;
  sources?: Array<{
    title?: string;
    url: string;
    text?: string;
    publishedDate?: string;
  }>;
}

interface MessageActionVisibility {
  shouldRenderActions: boolean;
  actionsAreVisible: boolean;
  shouldReserveTimestamp: boolean;
  timestampIsVisible: boolean;
}

const timestampClassName =
  "flex h-6 items-center px-1 text-[11px] leading-none text-muted-foreground tabular-nums whitespace-nowrap transition-opacity duration-150 ease-in-out";

export function getMessageActionVisibility({
  isUser,
  isLastAssistantMessage,
  isMobile,
  isHovered,
  isEditing,
  isLastAssistantLoading,
  hasTimestamp,
}: {
  isUser: boolean;
  isLastAssistantMessage: boolean;
  isMobile: boolean;
  isHovered: boolean;
  isEditing: boolean;
  isLastAssistantLoading: boolean;
  hasTimestamp: boolean;
}): MessageActionVisibility {
  const shouldRenderActions = !isLastAssistantLoading && !isEditing;
  const isHistoricalAssistant = !isUser && !isLastAssistantMessage;
  const requiresDesktopHover = isUser || isHistoricalAssistant;
  const actionsAreVisible =
    shouldRenderActions && (!requiresDesktopHover || isMobile || isHovered);
  const shouldReserveTimestamp =
    shouldRenderActions && !isMobile && hasTimestamp;
  const timestampIsVisible = shouldReserveTimestamp && isHovered;

  return {
    shouldRenderActions,
    actionsAreVisible,
    shouldReserveTimestamp,
    timestampIsVisible,
  };
}

function MessageTimestamp({
  dateTime,
  display,
  isVisible,
}: {
  dateTime: string;
  display: string;
  isVisible: boolean;
}) {
  return (
    <time
      dateTime={dateTime}
      className={cn(
        timestampClassName,
        isVisible
          ? "opacity-70"
          : "opacity-0 group-hover/message:opacity-70 group-focus-within/message-actions:opacity-70",
      )}
    >
      {display}
    </time>
  );
}

export const MessageActions = ({
  messageText,
  isUser,
  isLastAssistantMessage,
  canRegenerate,
  onRegenerate,
  onEdit,
  onBranch,
  isHovered,
  isEditing,
  isMobile = false,
  messageCreatedAt,
  status,
  onFeedback,
  existingFeedback,
  isAwaitingFeedbackDetails = false,
  hasFileContent = false,
  isTemporaryChat = false,
  sources = [],
}: MessageActionsProps) => {
  const [copied, setCopied] = useState(false);
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(messageText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy message:", error);
    }
  };

  const handleFeedback = (type: "positive" | "negative") => {
    if (onFeedback) {
      onFeedback(type);
    }
  };

  const handleRegenerate = () => {
    if (isRegenerating) return;
    setIsRegenerating(true);
    onRegenerate();
  };

  // Don't show actions for last assistant message when it's loading/streaming
  const isLastAssistantLoading =
    isLastAssistantMessage &&
    (status === "submitted" || status === "streaming");
  const formattedCreatedAt = formatMessageActionTimestamp(messageCreatedAt);
  const timestampDateTime =
    formattedCreatedAt !== null && typeof messageCreatedAt === "number"
      ? new Date(messageCreatedAt).toISOString()
      : null;
  const {
    shouldRenderActions,
    actionsAreVisible,
    shouldReserveTimestamp,
    timestampIsVisible,
  } = getMessageActionVisibility({
    isUser,
    isLastAssistantMessage,
    isMobile,
    isHovered,
    isEditing,
    isLastAssistantLoading,
    hasTimestamp: formattedCreatedAt !== null && timestampDateTime !== null,
  });

  // Reset isRegenerating when status changes back to idle
  const isLoading = status === "submitted" || status === "streaming";
  if (!isLoading && isRegenerating) {
    setIsRegenerating(false);
  }

  return (
    <div
      className={cn(
        "group/message-actions mt-1 flex min-h-6 flex-wrap items-center gap-1 transition-opacity duration-150 ease-in-out",
        isUser ? "justify-end" : "justify-start",
        actionsAreVisible
          ? "opacity-100"
          : "pointer-events-none opacity-0 group-hover/message:pointer-events-auto group-hover/message:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100",
      )}
    >
      {shouldRenderActions ? (
        <>
          {isUser && shouldReserveTimestamp && (
            <MessageTimestamp
              dateTime={timestampDateTime!}
              display={formattedCreatedAt!}
              isVisible={timestampIsVisible}
            />
          )}

          <div className="flex items-center gap-0.5">
            <WithTooltip
              display={copied ? "Copied!" : "Copy message"}
              trigger={
                <button
                  onClick={handleCopy}
                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-70 transition-colors hover:bg-accent hover:text-foreground hover:opacity-100 focus-visible:outline-none"
                  aria-label={copied ? "Copied!" : "Copy message"}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              }
              side="bottom"
              delayDuration={300}
            />

            {/* Show edit only for user messages */}
            {isUser && (
              <WithTooltip
                display={"Edit message"}
                trigger={
                  <button
                    onClick={onEdit}
                    className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-70 transition-colors hover:bg-accent hover:text-foreground hover:opacity-100 focus-visible:outline-none"
                    aria-label="Edit message"
                  >
                    <Pencil size={14} />
                  </button>
                }
                side="bottom"
                delayDuration={300}
              />
            )}

            {/* Show feedback buttons only for assistant messages and not in temporary chats */}
            {!isUser && onFeedback && !isTemporaryChat && (
              <>
                {/* Hide positive feedback button when awaiting negative feedback details */}
                {!isAwaitingFeedbackDetails && (
                  <WithTooltip
                    display={"Good response"}
                    trigger={
                      <button
                        type="button"
                        onClick={() => handleFeedback("positive")}
                        className={`flex size-6 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:outline-none ${
                          existingFeedback === "positive"
                            ? "opacity-100 text-foreground"
                            : "opacity-70 hover:opacity-100 text-muted-foreground"
                        }`}
                        aria-label="Good response"
                      >
                        <ThumbsUp
                          size={14}
                          fill={
                            existingFeedback === "positive"
                              ? "currentColor"
                              : "none"
                          }
                        />
                      </button>
                    }
                    side="bottom"
                    delayDuration={300}
                  />
                )}
                <WithTooltip
                  display={"Poor response"}
                  trigger={
                    <button
                      type="button"
                      onClick={() => handleFeedback("negative")}
                      className={`flex size-6 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:outline-none ${
                        existingFeedback === "negative" ||
                        isAwaitingFeedbackDetails
                          ? "opacity-100 text-foreground"
                          : "opacity-70 hover:opacity-100 text-muted-foreground"
                      }`}
                      aria-label="Poor response"
                    >
                      <ThumbsDown
                        size={14}
                        fill={
                          existingFeedback === "negative" ||
                          isAwaitingFeedbackDetails
                            ? "currentColor"
                            : "none"
                        }
                      />
                    </button>
                  }
                  side="bottom"
                  delayDuration={300}
                />
              </>
            )}

            {/* Show regenerate only for the last assistant message */}
            {!isUser && isLastAssistantMessage && (
              <WithTooltip
                display={"Regenerate response"}
                trigger={
                  <button
                    type="button"
                    onClick={handleRegenerate}
                    disabled={!canRegenerate || isRegenerating}
                    className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-70 transition-colors hover:bg-accent hover:text-foreground hover:opacity-100 focus-visible:outline-none disabled:opacity-40"
                    aria-label="Regenerate response"
                  >
                    <RotateCcw size={14} />
                  </button>
                }
                side="bottom"
                delayDuration={300}
              />
            )}

            {/* Show branch only for assistant messages and not in temporary chats */}
            {!isUser && onBranch && !isTemporaryChat && (
              <WithTooltip
                display={"Branch in new chat"}
                trigger={
                  <button
                    type="button"
                    onClick={onBranch}
                    className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-70 transition-colors hover:bg-accent hover:text-foreground hover:opacity-100 focus-visible:outline-none"
                    aria-label="Branch in new chat"
                  >
                    <Split size={14} />
                  </button>
                }
                side="bottom"
                delayDuration={300}
              />
            )}
          </div>

          {/* Sources (only for assistant messages with web results) - positioned at the end */}
          {!isUser && sources.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsSourcesOpen(true)}
              className="group/footnote flex h-6 w-fit items-center gap-1.5 rounded-md border border-border bg-transparent px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="View sources"
            >
              <div className="flex flex-row-reverse">
                {sources.slice(0, 3).map((src, idx) => {
                  return (
                    <div
                      key={`src-${idx}`}
                      className="border-background bg-background flex items-center overflow-clip rounded-full -ms-1.5 first:me-0 border-2 group-hover/footnote:border-muted relative"
                    >
                      <div className="relative inline-block shrink-0">
                        <SourceDomainBadge
                          source={src.url}
                          className="opacity-80 transition-opacity motion-reduce:transition-none"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="text-[11px] font-medium">Sources</div>
            </Button>
          )}

          {!isUser && shouldReserveTimestamp && (
            <MessageTimestamp
              dateTime={timestampDateTime!}
              display={formattedCreatedAt!}
              isVisible={timestampIsVisible}
            />
          )}
        </>
      ) : (
        <>
          {/* Invisible spacer buttons to maintain layout */}
          <div className="size-6" />
        </>
      )}

      {/* Sources Dialog */}
      {!isUser && sources.length > 0 && (
        <SourcesDialog
          open={isSourcesOpen}
          onOpenChange={setIsSourcesOpen}
          sources={sources}
        />
      )}
    </div>
  );
};
