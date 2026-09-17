"use client";

import { useControllableState } from "@radix-ui/react-use-controllable-state";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { CursorActivityGlyph } from "@/components/ui/cursor-thinking";
import { cn } from "@/lib/utils";
import { ChevronRightIcon } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ComponentProps, ReactNode } from "react";

type ReasoningContextValue = {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  isStreaming: boolean;
  durationMs: number;
};

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export const useReasoning = () => {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error("Reasoning components must be used within Reasoning");
  }
  return context;
};

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
};

export function Reasoning({
  className,
  isStreaming = false,
  open,
  defaultOpen = false,
  onOpenChange,
  children,
  ...props
}: ReasoningProps) {
  const [isOpen, setIsOpen] = useControllableState({
    prop: open,
    defaultProp: defaultOpen,
    onChange: onOpenChange,
  });

  // Keep the elapsed reasoning time available after streaming finishes.
  const [durationMs, setDurationMs] = useState(0);
  const startRef = useRef<number | null>(null);

  // Streaming updates the summary; disclosure remains the reader's choice.

  useEffect(() => {
    let timeoutId: number | undefined;

    if (!isStreaming) {
      // Not streaming (ended or never started): keep the last elapsed value.
      if (startRef.current !== null) {
        const finalDurationMs = Math.max(100, Date.now() - startRef.current);
        setDurationMs((current) => Math.max(current, finalDurationMs));
      }
      startRef.current = null;
      return;
    }

    if (startRef.current === null) startRef.current = Date.now();

    const updateDuration = () => {
      if (startRef.current !== null) {
        const nextDurationMs = Math.max(0, Date.now() - startRef.current);
        setDurationMs(nextDurationMs);
        const resolution = 1000;
        timeoutId = window.setTimeout(
          updateDuration,
          Math.max(50, resolution - (nextDurationMs % resolution)),
        );
      }
    };

    updateDuration();
    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [isStreaming]);

  const contextValue = useMemo(
    () => ({ isOpen: !!isOpen, setIsOpen, isStreaming, durationMs }),
    [isOpen, setIsOpen, isStreaming, durationMs],
  );

  return (
    <ReasoningContext.Provider value={contextValue}>
      <Collapsible
        data-streaming={isStreaming ? "true" : "false"}
        open={isOpen}
        onOpenChange={setIsOpen}
        className={cn("not-prose w-full min-w-0 max-w-full", className)}
        {...props}
      >
        {children}
      </Collapsible>
    </ReasoningContext.Provider>
  );
}

export type ReasoningTriggerProps = ComponentProps<
  typeof CollapsibleTrigger
> & {
  getThinkingMessage?: (isStreaming: boolean) => ReactNode;
};

const defaultGetThinkingMessage = (isStreaming: boolean): ReactNode =>
  isStreaming ? "Thinking" : "Thought";

export function ReasoningTrigger({
  className,
  getThinkingMessage = defaultGetThinkingMessage,
  ...props
}: ReasoningTriggerProps) {
  const { isOpen, isStreaming, durationMs } = useReasoning();
  const title = isStreaming ? getThinkingMessage(true) : "Thought";
  const seconds = Math.max(isStreaming ? 0 : 1, Math.floor(durationMs / 1000));
  const elapsedLabel =
    seconds < 60
      ? `${seconds}s`
      : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

  return (
    <CollapsibleTrigger
      data-ui="reasoning-trigger"
      data-running={isStreaming ? "true" : "false"}
      className={cn(
        // The UI face. "Thought for 1.0s" is a sentence, and mono is for code,
        // paths and terminals; neither reference app sets a line like this in
        // monospace. Only the duration keeps tabular figures.
        "group/reason flex min-h-6 w-full items-center gap-1.5 py-0.5 text-left text-[13px] font-normal leading-5 text-[var(--cursor-text-secondary)] transition-colors hover:text-foreground focus-visible:outline-none",
        className,
      )}
      {...props}
    >
      {/* Only while it is actually thinking. At rest the glyph settled into a
          diamond that sat in front of every collapsed thought for the life of
          the transcript, decorating a line that already has a chevron saying
          the same thing. */}
      {isStreaming ? (
        <CursorActivityGlyph active className="text-current" />
      ) : null}
      <span
        data-ui="reasoning-label"
        className="flex min-w-0 items-baseline gap-1 truncate"
        aria-live={isStreaming ? "polite" : undefined}
      >
        <span className="truncate text-current transition-colors group-hover/reason:text-foreground">
          {title}
        </span>
        {isStreaming ? (
          <time
            aria-hidden="true"
            data-ui="reasoning-elapsed"
            dateTime={`PT${seconds}S`}
            className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
          >
            {elapsedLabel}
          </time>
        ) : durationMs > 0 ? (
          <span
            data-ui="reasoning-duration"
            className="shrink-0 font-normal tabular-nums text-muted-foreground"
          >
            {elapsedLabel}
          </span>
        ) : null}
      </span>
      <ChevronRightIcon
        data-ui="reasoning-chevron"
        aria-hidden
        className={cn(
          "size-3 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
          isOpen && "rotate-90",
        )}
      />
    </CollapsibleTrigger>
  );
}

export type ReasoningContentProps = ComponentProps<typeof CollapsibleContent>;

export function ReasoningContent({
  className,
  children,
  ...props
}: ReasoningContentProps) {
  const { isStreaming } = useReasoning();

  return (
    <CollapsibleContent
      data-ui="reasoning-content"
      data-live-rail={isStreaming ? "true" : "false"}
      className={cn(
        // Thinking is prose, and prose is set in the UI face. Inline code
        // inside it still takes the mono variant through the renderer's own
        // `[&_code]` rule, which is where mono belongs.
        "min-w-0 max-w-full space-y-2 break-words pb-1 pt-2 text-muted-foreground",
        "[overflow-wrap:anywhere]",
        "[&_pre]:max-w-full [&_pre]:overflow-x-auto",
        // The transcript viewport owns scrolling. Keep expanded prose aligned
        // with its disclosure label, without another inset rail or scrollbox.
        className,
      )}
      {...props}
    >
      {children}
      {isStreaming ? (
        <span className="sr-only" role="status">
          Reasoning is streaming
        </span>
      ) : null}
    </CollapsibleContent>
  );
}

Reasoning.displayName = "Reasoning";
ReasoningTrigger.displayName = "ReasoningTrigger";
ReasoningContent.displayName = "ReasoningContent";
