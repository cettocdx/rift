"use client";

import React, { useId, useState } from "react";
import {
  Check,
  ChevronRight,
  CircleStop,
  LoaderCircle,
  Terminal,
  X,
} from "lucide-react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { cn } from "@/lib/utils";

interface CursorToolBlockProps {
  label: string;
  status: "running" | "done" | "error" | "stopped";
  command?: string;
  output?: string;
  defaultOpen?: boolean;
  isShimmer?: boolean;
  isClickable?: boolean;
  onClick?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

const STATUS_LABEL: Record<CursorToolBlockProps["status"], string> = {
  running: "Running",
  done: "Done",
  error: "Error",
  stopped: "Stopped",
};

const STATUS_CLASS: Record<CursorToolBlockProps["status"], string> = {
  running: "text-muted-foreground",
  done: "text-[var(--success)]",
  error: "text-[var(--destructive)]",
  stopped: "text-muted-foreground/70",
};

function ToolStatusIcon({
  status,
}: {
  status: CursorToolBlockProps["status"];
}) {
  const className = cn("size-3.5", STATUS_CLASS[status]);

  if (status === "running") {
    return (
      <LoaderCircle
        className={cn(
          className,
          "motion-safe:animate-spin motion-reduce:animate-none",
        )}
        aria-hidden="true"
      />
    );
  }
  // Nothing for a finished row. The label already says what happened, in the
  // past tense; a tick on every one of them is a column of decoration running
  // down the trace. Running and failed still show -- those are the two states
  // the words cannot carry on their own.
  if (status === "done") return null;
  if (status === "error") {
    return <X className={className} aria-hidden="true" />;
  }
  return <CircleStop className={className} aria-hidden="true" />;
}

function outputLineClass(line: string): string {
  if (/^\+(?!\+\+)/.test(line)) return "text-[var(--success)]/85";
  if (/^-(?!---)/.test(line)) return "text-[var(--destructive)]/85";
  if (/https?:\/\//.test(line)) return "text-[var(--cursor-text-secondary)]";
  return "text-muted-foreground";
}

function CursorToolOutput({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, index) => (
        <span key={`${index}-${line.slice(0, 24)}`}>
          {index > 0 ? "\n" : null}
          <span className={outputLineClass(line)}>{line}</span>
        </span>
      ))}
    </>
  );
}

export function CursorToolBlock({
  label,
  status,
  command,
  output,
  defaultOpen = false,
  isShimmer = false,
  isClickable = false,
  onClick,
  onKeyDown,
}: CursorToolBlockProps) {
  const isRunning = status === "running";
  const hasBody = Boolean(command || output);
  const canToggle = hasBody && !isRunning;
  const isInteractive = canToggle || isClickable;
  const outputId = useId();
  const [manualOpenState, setManualOpenState] = useState<
    "auto" | "open" | "closed"
  >("auto");
  const autoOpen = defaultOpen || (isRunning && hasBody);
  const open =
    (isRunning && hasBody) ||
    (manualOpenState === "auto" ? autoOpen : manualOpenState === "open");

  const toggleOpen = () =>
    setManualOpenState((current) =>
      current === "open" || (current === "auto" && autoOpen)
        ? "closed"
        : "open",
    );

  const handleHeaderClick = () => {
    if (canToggle) toggleOpen();
    if (isClickable) onClick?.();
  };

  const handleHeaderKeyDown = (event: React.KeyboardEvent) => {
    if (canToggle && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      toggleOpen();
    }
    onKeyDown?.(event);
  };

  const summaryContent = (
    <>
      <span
        data-ui="tool-toggle"
        className="flex size-3 shrink-0 items-center justify-center"
        aria-hidden="true"
      >
        {canToggle ? (
          <ChevronRight
            className={cn(
              "size-3 text-muted-foreground/50 transition-transform duration-150 motion-reduce:transition-none",
              open && "rotate-90",
            )}
          />
        ) : null}
      </span>
      <Terminal
        data-ui="tool-icon"
        className="size-3.5 shrink-0 text-muted-foreground/65"
        strokeWidth={1.7}
        aria-hidden="true"
      />
      <span
        data-ui="tool-label"
        className="min-w-0 flex-1 truncate text-[12px] text-[var(--cursor-text-secondary)]"
      >
        {isShimmer ? <Shimmer>{label}</Shimmer> : label}
      </span>
      <span
        data-ui="tool-status"
        aria-live="polite"
        className="flex size-4 shrink-0 items-center justify-center"
      >
        <ToolStatusIcon status={status} />
        <span className="sr-only">{STATUS_LABEL[status]}</span>
      </span>
    </>
  );

  const summaryClassName = cn(
    "flex min-h-[30px] w-full select-none items-center gap-1.5 px-0.5 py-1.5 text-left leading-4 text-muted-foreground transition-colors",
    isInteractive &&
      "cursor-pointer hover:bg-[var(--accent)] focus-visible:outline-none",
  );

  return (
    <div
      data-ui="tool-block"
      data-status={status}
      data-running={isRunning ? "true" : "false"}
      className="my-0 min-w-0 bg-transparent"
    >
      {isInteractive ? (
        <button
          type="button"
          data-ui="tool-summary"
          data-interactive="true"
          aria-expanded={canToggle ? open : undefined}
          aria-controls={hasBody ? outputId : undefined}
          onClick={handleHeaderClick}
          onKeyDown={handleHeaderKeyDown}
          className={summaryClassName}
        >
          {summaryContent}
        </button>
      ) : (
        <div
          data-ui="tool-summary"
          data-interactive="false"
          className={summaryClassName}
        >
          {summaryContent}
        </div>
      )}

      {open && hasBody ? (
        <div
          id={outputId}
          data-ui="tool-output"
          role="region"
          aria-label="Terminal output"
          aria-busy={isRunning}
          aria-live={isRunning ? "polite" : undefined}
          className="mb-1.5 ml-[21px] max-h-[280px] overflow-auto border-l border-border/70 py-1 pl-3 pr-1 font-mono text-[11.5px] leading-[1.65] whitespace-pre-wrap"
        >
          {command ? (
            <div
              data-ui="terminal-command"
              className="min-w-0 whitespace-pre-wrap break-words text-[var(--cursor-text-secondary)]"
            >
              {command}
            </div>
          ) : null}
          {output ? (
            <div
              data-ui="terminal-output-body"
              className={cn(command && "mt-1.5")}
            >
              <CursorToolOutput text={output} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default CursorToolBlock;
