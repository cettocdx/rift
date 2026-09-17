"use client";

import { CircleDashed } from "lucide-react";
import type { RunStatus, RunStatusTone } from "@/lib/runs/run-status";
import { runStatusMeta } from "@/lib/runs/run-status";
import { cn } from "@/lib/utils";

/**
 * The one component that renders a Run's status.
 *
 * Every surface used to phrase these itself, which is how a stopped run came to
 * read as a failure in one place and as a success in another. Anything that
 * shows a status renders this, so the words and the colour cannot drift apart.
 */

const TONE_CLASS: Record<RunStatusTone, string> = {
  neutral: "text-muted-foreground",
  active: "text-[var(--primary)]",
  attention: "text-[var(--warning)]",
  success: "text-[var(--success)]",
  warning: "text-[var(--warning)]",
  danger: "text-[var(--destructive)]",
};

const DOT_CLASS: Record<RunStatusTone, string> = {
  neutral: "bg-muted-foreground/60",
  active: "bg-[var(--primary)]",
  attention: "bg-[var(--warning)]",
  success: "bg-[var(--success)]",
  warning: "bg-[var(--warning)]",
  danger: "bg-[var(--destructive)]",
};

function formatTimestamp(value: number): string {
  const delta = Date.now() - value;
  if (delta < 60_000) return "just now";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export interface RunStatusBadgeProps {
  status: RunStatus;
  /** When the run entered this status. */
  timestamp?: number;
  /** Why, when the status alone does not say it (a failure message, a stop reason). */
  reason?: string;
  /** 0-100. Only shown for a status that is still in flight. */
  progress?: number;
  className?: string;
}

export function RunStatusBadge({
  status,
  timestamp,
  reason,
  progress,
  className,
}: RunStatusBadgeProps) {
  const meta = runStatusMeta(status);
  const isActive = meta.tone === "active" && !meta.isTerminal;
  // Progress on a finished run is a leftover number, not information.
  const showProgress =
    typeof progress === "number" && !meta.isTerminal && progress > 0;

  return (
    <span
      data-ui="run-status"
      data-status={status}
      data-tone={meta.tone}
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-[12.5px] leading-4 tracking-[-0.01em]",
        TONE_CLASS[meta.tone],
        className,
      )}
    >
      {isActive ? (
        <CircleDashed
          aria-hidden
          className="size-3 shrink-0 motion-safe:animate-spin motion-reduce:animate-none"
        />
      ) : (
        <span
          aria-hidden
          className={cn("size-1.5 shrink-0 rounded-full", DOT_CLASS[meta.tone])}
        />
      )}

      <span className="truncate font-medium">{meta.label}</span>

      {showProgress ? (
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {Math.round(progress)}%
        </span>
      ) : null}

      {reason ? (
        <>
          <span aria-hidden className="shrink-0 text-muted-foreground/50">
            ·
          </span>
          <span className="truncate text-muted-foreground">{reason}</span>
        </>
      ) : null}

      {typeof timestamp === "number" ? (
        <>
          <span aria-hidden className="shrink-0 text-muted-foreground/50">
            ·
          </span>
          <time
            dateTime={new Date(timestamp).toISOString()}
            className="shrink-0 text-muted-foreground"
          >
            {formatTimestamp(timestamp)}
          </time>
        </>
      ) : null}
    </span>
  );
}
