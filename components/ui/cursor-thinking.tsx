"use client";

import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { RiftReasoningOrb } from "./rift-reasoning-orb";
import styles from "./cursor-thinking.module.css";

export type CursorThinkingPhase =
  | "starting"
  | "connecting"
  | "reasoning"
  | "terminal"
  | "working";

const PHASE_COPY: Record<
  CursorThinkingPhase,
  {
    ariaLabel: string;
    title: string;
  }
> = {
  starting: {
    ariaLabel: "Starting the agent run",
    title: "Working",
  },
  connecting: {
    ariaLabel: "Connecting to the live agent run",
    title: "Working",
  },
  reasoning: {
    ariaLabel: "Thinking. Reviewing context and results",
    title: "Thinking",
  },
  terminal: {
    ariaLabel: "Running command. Streaming live terminal output",
    title: "Running command",
  },
  working: {
    ariaLabel: "Working on the request",
    title: "Working",
  },
};

const elapsedSince = (startedAt: number): number =>
  Math.max(0, Date.now() - startedAt);

/** Grok-style precision for short work, compact Cursor-style units thereafter. */
export function formatCursorElapsed(elapsedMs: number): string {
  const safeElapsedMs = Math.max(0, elapsedMs);
  if (safeElapsedMs < 10_000) {
    return `${(Math.floor(safeElapsedMs / 100) / 10).toFixed(1)}s`;
  }

  const totalSeconds = Math.floor(safeElapsedMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/** Shared semantic activity mark. */
export function CursorActivityGlyph({
  active,
  className,
}: {
  active: boolean;
  className?: string;
}) {
  return active ? (
    <span
      aria-hidden="true"
      data-active="true"
      data-ui="cursor-activity-glyph"
      className={cn(styles.glyph, className)}
    >
      <RiftReasoningOrb />
    </span>
  ) : (
    <svg
      aria-hidden="true"
      focusable="false"
      data-active="false"
      data-ui="cursor-activity-glyph"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(styles.glyph, className)}
    >
      <path d="m3.25 7 2.5 2.5 5-5" />
    </svg>
  );
}

/** Compact live activity row shared by reasoning and tool work. */
export function CursorThinking({
  phase = "working",
  startedAt,
  title,
  ariaLabel,
  source,
  trailing,
}: {
  phase?: CursorThinkingPhase;
  startedAt?: number;
  /** Public progress derived from visible stream activity, never hidden CoT. */
  title?: string;
  ariaLabel?: string;
  source?: string;
  /** Right-aligned run figures (total elapsed, tokens, cost). */
  trailing?: ReactNode;
}) {
  const copy = PHASE_COPY[phase];
  const visibleTitle = title?.trim() || copy.title;
  const localStartedAtRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    let effectiveStartedAt = localStartedAtRef.current;
    if (typeof startedAt === "number" && Number.isFinite(startedAt)) {
      effectiveStartedAt = startedAt;
    } else if (effectiveStartedAt === null) {
      effectiveStartedAt = Date.now();
      localStartedAtRef.current = effectiveStartedAt;
    }

    const updateElapsed = () => {
      setElapsedMs(elapsedSince(effectiveStartedAt));
    };

    updateElapsed();
    const intervalId = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(intervalId);
  }, [startedAt]);

  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const elapsedLabel =
    elapsedSeconds < 60 ? `${elapsedSeconds}s` : formatCursorElapsed(elapsedMs);

  // The UI face, not the mono one. This line says what the agent is doing in
  // ordinary words -- "Updating vercel.json" -- and neither reference app sets
  // that in monospace; mono is for the terminal and for code. Only the two
  // numbers keep tabular figures so they stop jittering as they count.
  return (
    <div
      data-phase={phase}
      data-progress-source={source}
      data-ui="live-agent-status"
      role="status"
      aria-label={
        ariaLabel?.trim() || (title?.trim() ? visibleTitle : copy.ariaLabel)
      }
      aria-live="polite"
      aria-atomic="true"
      className={styles.status}
    >
      <CursorActivityGlyph active />
      <span
        aria-hidden="true"
        data-ui="live-agent-phase"
        className={cn(styles.label, "rift-thinking-shimmer")}
      >
        {visibleTitle}
      </span>
      <time
        aria-hidden="true"
        data-ui="live-agent-elapsed"
        dateTime={`PT${elapsedSeconds}S`}
        className={styles.elapsed}
      >
        {elapsedLabel}
      </time>
      {trailing ? (
        <span
          aria-hidden="true"
          data-ui="live-agent-trailing"
          className={styles.trailing}
        >
          {trailing}
        </span>
      ) : null}
    </div>
  );
}
