import React from "react";
import { Check, ChevronRight, CircleStop, LoaderCircle, X } from "lucide-react";
import { Shimmer } from "@/components/ai-elements/shimmer";

interface ToolBlockProps {
  icon: React.ReactNode;
  action: string;
  target?: string;
  isShimmer?: boolean;
  isClickable?: boolean;
  onClick?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

/** A compact Cursor-style agent action row. */
const ToolBlock: React.FC<ToolBlockProps> = ({
  icon,
  action,
  target,
  isShimmer = false,
  isClickable = false,
  onClick,
  onKeyDown,
}) => {
  const normalizedAction = action.toLowerCase();
  const isStopped = normalizedAction.startsWith("stopped");
  const isError =
    normalizedAction.includes("failed") ||
    normalizedAction.includes("error") ||
    normalizedAction.includes("could not") ||
    normalizedAction.includes("unavailable");
  const state = isShimmer
    ? "running"
    : isStopped
      ? "stopped"
      : isError
        ? "error"
        : "done";
  const baseClasses =
    "group/tb relative flex min-h-[30px] w-full max-w-full items-center gap-1.5 overflow-hidden bg-transparent px-0.5 py-1.5 text-left text-[12px] leading-4 transition-colors";
  const clickableClasses = isClickable
    ? "cursor-pointer hover:bg-foreground/[0.035] focus-visible:outline-none"
    : "";

  const content = (
    <>
      <span
        aria-hidden="true"
        className="inline-flex size-4 flex-shrink-0 items-center justify-center text-muted-foreground/65 [&>svg]:size-3.5 [&>svg]:stroke-[1.7]"
      >
        {icon}
      </span>
      <span className="min-w-0 max-w-full flex-1 truncate">
        <span className="text-[12px] text-[var(--cursor-text-secondary)]">
          {isShimmer ? <Shimmer>{action}</Shimmer> : action}
        </span>
        {target ? (
          <span className="ml-1.5 font-mono text-[11.5px] text-muted-foreground/70">
            {target}
          </span>
        ) : null}
      </span>
      <span
        className="flex size-4 shrink-0 items-center justify-center"
        aria-live="polite"
      >
        {state === "running" ? (
          <LoaderCircle
            className="size-3 text-muted-foreground motion-safe:animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : state === "error" ? (
          <X className="size-3 text-destructive" aria-hidden="true" />
        ) : state === "stopped" ? (
          <CircleStop
            className="size-3 text-muted-foreground/70"
            aria-hidden="true"
          />
        ) : (
          <Check className="size-3 text-[var(--success)]" aria-hidden="true" />
        )}
        <span className="sr-only">{state}</span>
      </span>
      {isClickable ? (
        <ChevronRight
          aria-hidden="true"
          className="size-3 shrink-0 text-muted-foreground/35 transition-colors group-hover/tb:text-muted-foreground/75"
        />
      ) : null}
    </>
  );

  return (
    <div className="min-w-0 flex-1">
      {isClickable ? (
        <button
          type="button"
          data-ui="action-block"
          data-running={isShimmer ? "true" : "false"}
          data-status={state}
          className={`${baseClasses} ${clickableClasses}`}
          onClick={onClick}
          onKeyDown={onKeyDown}
          aria-label={target ? `Open ${target} in sidebar` : undefined}
        >
          {content}
        </button>
      ) : (
        <div
          data-ui="action-block"
          data-running={isShimmer ? "true" : "false"}
          data-status={state}
          className={baseClasses}
        >
          {content}
        </div>
      )}
    </div>
  );
};

export default ToolBlock;
