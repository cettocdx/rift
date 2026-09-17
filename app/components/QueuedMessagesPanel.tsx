import { Button } from "@/components/ui/button";
import {
  Trash,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Check,
} from "lucide-react";
import type { QueuedMessage, QueueBehavior } from "@/types/chat";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface QueuedMessagesPanelProps {
  messages: QueuedMessage[];
  onSendNow: (messageId: string) => void;
  onDelete: (messageId: string) => void;
  isStreaming: boolean;
  queueBehavior?: QueueBehavior;
  onQueueBehaviorChange?: (behavior: QueueBehavior) => void;
}

export const QueuedMessagesPanel = ({
  messages,
  onSendNow,
  onDelete,
  isStreaming,
  queueBehavior = "queue",
  onQueueBehaviorChange,
}: QueuedMessagesPanelProps) => {
  const [isExpanded, setIsExpanded] = useState(true);

  if (messages.length === 0) {
    return null;
  }

  const handleToggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  const queueBehaviorOptions: Array<{
    value: QueueBehavior;
    label: string;
  }> = [
    { value: "queue", label: "Queue after current message" },
    { value: "stop-and-send", label: "Stop & send right away" },
  ];

  return (
    <div className="mb-1.5 overflow-hidden rounded-lg border border-border bg-input-chat">
      {/* Header */}
      <div className="flex min-h-8 items-center px-2.5 transition-colors">
        <button
          onClick={handleToggleExpand}
          className="flex flex-1 cursor-pointer items-center gap-1.5 rounded-md py-1 text-left transition-colors hover:text-foreground focus-visible:outline-none"
          aria-label={
            isExpanded ? "Collapse queued messages" : "Expand queued messages"
          }
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleToggleExpand();
            }
          }}
        >
          {isExpanded ? (
            <ChevronDown className="size-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3 text-muted-foreground" />
          )}
          <div className="flex items-center gap-1.5">
            <h3 className="text-[12px] font-medium text-muted-foreground">
              {messages.length} Queued
            </h3>
          </div>
        </button>

        {/* Settings Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-6"
              aria-label="Queue settings"
            >
              <MoreHorizontal className="size-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
              When to send follow-ups
            </div>
            {queueBehaviorOptions.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onClick={() => onQueueBehaviorChange?.(option.value)}
                className="flex cursor-pointer items-center justify-between text-xs"
              >
                <span>{option.label}</span>
                {queueBehavior === option.value && (
                  <Check className="size-3.5" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Message List - Collapsible */}
      {isExpanded && (
        <div className="max-h-[180px] space-y-1.5 overflow-y-auto border-t border-border px-2.5 py-2">
          {messages.map((message) => (
            <div
              key={message.id}
              className="flex items-start gap-2 rounded-md px-1 py-0.5 transition-colors hover:bg-accent/40"
            >
              {/* Message preview */}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] leading-5 text-foreground/80">
                  {message.text}
                </div>
                {message.dispatchState && (
                  <div
                    role="status"
                    className="text-ui-caption text-muted-foreground"
                  >
                    {message.dispatchState === "sending"
                      ? "Sending…"
                      : "Delivery unconfirmed. Check the conversation before sending again."}
                  </div>
                )}
                {message.files && message.files.length > 0 && (
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {message.files.length} file
                    {message.files.length > 1 ? "s" : ""}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-shrink-0 items-center gap-0.5">
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => onSendNow(message.id)}
                  disabled={
                    !isStreaming ||
                    messages.some((item) => item.dispatchState != null)
                  }
                  className="px-2 text-[11px]"
                  title={
                    isStreaming
                      ? "Cancel current response and send this now"
                      : "Waiting for current response to complete"
                  }
                >
                  <ArrowUp className="mr-1 size-3" />
                  Send now
                </Button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => onDelete(message.id)}
                  disabled={message.dispatchState === "sending"}
                  className="size-6"
                  title="Remove from queue"
                >
                  <Trash className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
