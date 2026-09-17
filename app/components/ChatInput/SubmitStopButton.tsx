"use client";

import { Button } from "@/components/ui/button";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { ArrowUp, Square } from "lucide-react";
import { useHotkeys } from "react-hotkeys-hook";
import { useInputHasText } from "@/app/contexts/InputContext";
import type { ChatStatus } from "@/types";
import type { ChatMode } from "@/types/chat";
import type { UploadedFileState } from "@/types/file";

/*
 * `transition-colors` is deliberately absent.
 *
 * It was here, and it overrode the base button's property list — which
 * transitions `transform` at `--duration-press` on `--ease-out` — leaving
 * `active:scale-[0.97]` to snap with no easing at all. The most-pressed
 * control in the app was the one with the worst press feedback. Inheriting
 * the button's own transition is the fix; nothing here needs its own.
 */
const BASE_BUTTON_CLASSES =
  "h-11 w-11 min-w-11 cursor-pointer rounded-[8px] p-0 md:h-7 md:w-7 md:min-w-0 md:rounded-[7px]";

const STOP_BUTTON_VARIANT_CLASSES: Record<ChatMode, string> = {
  agent: "bg-foreground text-background hover:bg-foreground/90",
  ask: "bg-foreground text-background hover:bg-foreground/90",
};

function getStopButtonVariantClasses(mode: ChatMode): string {
  return STOP_BUTTON_VARIANT_CLASSES[mode] ?? STOP_BUTTON_VARIANT_CLASSES.ask;
}

function getSubmitButtonVariantClasses(_mode: ChatMode): string {
  return "bg-foreground text-background hover:bg-foreground/90 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100";
}

function getSendButtonTooltip(
  hasFileErrors: boolean,
  isUploading: boolean,
): string {
  if (hasFileErrors) return "Remove failed files to send";
  if (isUploading) return "File upload pending";
  return "Send (⏎)";
}

export interface SubmitStopButtonProps {
  isGenerating: boolean;
  hideStop: boolean;
  onStop: () => void;
  onSubmit: (e: React.FormEvent) => void;
  status: ChatStatus;
  isUploadingFiles: boolean;
  uploadedFiles: UploadedFileState[];
  chatMode: ChatMode;
  disabledReason?: string;
}

export function SubmitStopButton({
  isGenerating,
  hideStop,
  onStop,
  onSubmit,
  status,
  isUploadingFiles,
  uploadedFiles,
  chatMode,
  disabledReason,
}: SubmitStopButtonProps) {
  /*
   * Read the composer state here rather than take it as a prop.
   *
   * The string used to arrive from `ChatInput`, which meant the top of the
   * composer tree subscribed to every keystroke to hand it down — re-rendering
   * the toolbar and its six selectors per character. This context carries the
   * boolean instead, so the only render a keystroke can cause here is the one
   * that actually changes the button: empty ↔ sendable.
   */
  const hasText = useInputHasText();
  useHotkeys(
    "ctrl+c",
    (e) => {
      e.preventDefault();
      onStop();
    },
    {
      enabled: isGenerating && !hideStop,
      enableOnFormTags: true,
      enableOnContentEditable: true,
      preventDefault: true,
      description: "Stop AI generation",
    },
    [isGenerating, onStop],
  );

  const containerClass = "ml-auto flex shrink-0 items-center";

  if (isGenerating && !hideStop) {
    return (
      <div className={containerClass}>
        <TooltipPrimitive.Root>
          <TooltipTrigger asChild>
            <Button
              type="button"
              onClick={onStop}
              variant="ghost"
              className={`${BASE_BUTTON_CLASSES} ${getStopButtonVariantClasses(chatMode)}`}
              aria-label="Stop generation"
            >
              <Square
                aria-hidden="true"
                className="size-3"
                fill="currentColor"
                strokeWidth={1.5}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Stop (⌃C)</p>
          </TooltipContent>
        </TooltipPrimitive.Root>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      <form onSubmit={onSubmit}>
        <TooltipPrimitive.Root>
          <TooltipTrigger asChild>
            <div className="inline-block">
              <Button
                type="submit"
                disabled={
                  status !== "ready" ||
                  isUploadingFiles ||
                  !!disabledReason ||
                  (!hasText && uploadedFiles.length === 0)
                }
                variant="default"
                className={`${BASE_BUTTON_CLASSES} ${getSubmitButtonVariantClasses(chatMode)}`}
                aria-label="Send message"
                data-testid="send-button"
              >
                <ArrowUp aria-hidden="true" size={14} strokeWidth={2.2} />
              </Button>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              {disabledReason ||
                getSendButtonTooltip(
                  uploadedFiles.some((f) => f.error),
                  isUploadingFiles,
                )}
            </p>
          </TooltipContent>
        </TooltipPrimitive.Root>
      </form>
    </div>
  );
}
