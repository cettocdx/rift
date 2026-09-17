"use client";

import { cn } from "@/lib/utils";
import { REASONING_EFFORT_LABELS, type ReasoningEffort } from "@/types/chat";

/**
 * Reasoning strength as a filling meter rather than a word.
 *
 * The levels are ordered and their cost is ordered with them, so the control
 * should read as a quantity at a glance. Colour escalates within a single hue
 * — dim to bright — rather than running a rainbow across the scale; only the
 * top step shifts warm, because it is the one that materially changes what a
 * turn costs. The dots carry real state, so they are not decoration.
 */

/**
 * Rank drives how many dots fill. Toggle models expose off/on instead of the
 * numeric scale, so both vocabularies are ranked here rather than special-cased
 * at the call site.
 */
const EFFORT_RANK: Record<ReasoningEffort, number> = {
  off: 0,
  on: 1,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
};

/** Filled-dot colour per level. One hue, escalating intensity, warm at the top. */
const LEVEL_TONE: Record<ReasoningEffort, string> = {
  off: "bg-foreground/15",
  on: "bg-foreground",
  low: "bg-muted-foreground/60",
  medium: "bg-[var(--cursor-text-secondary)]",
  high: "bg-foreground",
  xhigh: "bg-[var(--signal-bright,var(--primary))]",
  max: "bg-[var(--warning,var(--signal-bright,var(--primary)))]",
};

export function effortRank(effort: ReasoningEffort): number {
  return EFFORT_RANK[effort] ?? 0;
}

export function EffortMeter({
  value,
  supported,
  className,
}: {
  value: ReasoningEffort;
  /** Only the steps this model offers are drawn. */
  supported: readonly ReasoningEffort[];
  className?: string;
}) {
  // The model already publishes its steps in order; drawing exactly those keeps
  // the meter honest about what this model can actually do.
  const activeRank = effortRank(value);

  return (
    <span
      aria-hidden="true"
      data-ui="effort-meter"
      data-level={value}
      className={cn("flex shrink-0 items-center gap-[3px]", className)}
      title={`Reasoning strength: ${REASONING_EFFORT_LABELS[value]}`}
    >
      {supported.map((effort) => {
        const filled = effortRank(effort) <= activeRank;
        return (
          <span
            key={effort}
            data-filled={filled ? "true" : "false"}
            className={cn(
              "h-[7px] w-[3px] rounded-[1px] transition-colors motion-reduce:transition-none",
              filled ? LEVEL_TONE[value] : "bg-foreground/15",
            )}
          />
        );
      })}
    </span>
  );
}
