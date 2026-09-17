"use client";

import { useReducedMotion } from "motion/react";
import { useId, useState } from "react";

import { MICRO_LABEL_CLASS } from "./type-scale";

/**
 * The run, under the reader's thumb.
 *
 * The Build section already plays a run; this hands the clock over. Drag and
 * every figure moves together — tools called, lines added and removed, context
 * consumed, dollars spent — because that is the actual claim: these numbers are
 * one story, visible while the work happens, not a bill that arrives later.
 *
 * The control is a real `input[type=range]` sitting invisibly over the graphic.
 * That is the whole accessibility story for free: arrow keys step it, Home and
 * End jump to the ends, screen readers announce a slider with a value, and
 * touch drag works without a single pointer handler.
 */

const BARS = 44;

/** Every figure is derived from one position so they can never disagree. */
function readAt(progress: number) {
  const eased = progress * progress * (3 - 2 * progress);
  return {
    tools: Math.round(progress * 28),
    added: Math.round(eased * 214),
    removed: Math.round(eased * 37),
    context: Math.round(18 + progress * 44),
    cost: progress * 0.41,
    minutes: Math.floor(progress * 3),
    seconds: Math.floor(progress * 3 * 60) % 60,
  };
}

/**
 * Activity per bar — busier in the middle, where the edits land.
 *
 * Rounded here rather than left at full float precision: React serialises the
 * inline style differently on the server and the client at that many decimals,
 * which is a hydration mismatch on every bar. Two decimals is far finer than a
 * pixel at this size and identical on both sides.
 */
function barHeight(index: number): number {
  const t = index / (BARS - 1);
  const shape = Math.sin(t * Math.PI) ** 0.7;
  const jitter = (((Math.sin(index * 12.9898) * 43758.5453) % 1) + 1) % 1;
  return (
    Math.round((0.18 + shape * 0.72 * (0.72 + jitter * 0.28)) * 10000) / 100
  );
}

export function RunScrubber() {
  const reduceMotion = useReducedMotion();
  const labelId = useId();
  const [value, setValue] = useState(62);
  const progress = value / 100;
  const data = readAt(progress);
  const activeBars = Math.round(progress * BARS);

  return (
    <div className="mt-12 rounded-[12px] border border-border bg-[var(--surface,#0c0c0c)] p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p
          id={labelId}
          className="text-[12.5px] text-[var(--cursor-text-secondary)]"
        >
          Drag to move through the run
        </p>
        <p className="text-[12.5px] tabular-nums text-[var(--cursor-text-secondary)]">
          {String(data.minutes).padStart(2, "0")}:
          {String(data.seconds).padStart(2, "0")}
        </p>
      </div>

      <div className="relative mt-5">
        <div className="flex h-24 items-end gap-[3px]" aria-hidden>
          {Array.from({ length: BARS }, (_, index) => {
            const reached = index < activeBars;
            return (
              <span
                key={index}
                className={`flex-1 rounded-[6px] ${
                  // Reached bars are lit, not coloured. Painting thirty of
                  // them in the accent spent the page's one warm colour on a
                  // chart — the references it is measured against use theirs
                  // two or three times in a whole document. The accent moved
                  // to the playhead, where it marks the single thing that is
                  // actually happening.
                  reached ? "bg-foreground/45" : "bg-foreground/[0.09]"
                } ${reduceMotion ? "" : "transition-colors duration-100"}`}
                style={{ height: `${barHeight(index)}%` }}
              />
            );
          })}
        </div>

        {/* The playhead follows the thumb, drawn rather than positioned so it
            stays on the compositor while the value changes. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px bg-[var(--signal-bright,#d98330)]"
          style={{ left: `${progress * 100}%` }}
        />

        {/* A real slider, invisible, covering the graphic — the same trick a
            good chart scrubber uses, and the reason this is keyboard and
            screen-reader operable without any extra code. */}
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          aria-labelledby={labelId}
          aria-valuetext={`${data.tools} tools, ${data.added} lines added, ${data.context}% context, $${data.cost.toFixed(2)}`}
          onChange={(event) => setValue(Number(event.target.value))}
          className="absolute inset-x-0 -bottom-2 h-10 w-full cursor-grab opacity-0 active:cursor-grabbing"
        />
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        {[
          { label: "Tools", value: String(data.tools) },
          {
            label: "Diff",
            value: `+${data.added} / −${data.removed}`,
          },
          { label: "Context", value: `${data.context}%` },
          { label: "Spent", value: `$${data.cost.toFixed(2)}` },
        ].map((item) => (
          <div key={item.label}>
            <dt className={MICRO_LABEL_CLASS}>{item.label}</dt>
            {/* Tabular figures: these change under a dragging thumb, and
                proportional digits would make the row twitch sideways. */}
            <dd className="mt-1 text-[15px] tabular-nums text-foreground">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
