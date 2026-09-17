"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

/**
 * A Build run, playing.
 *
 * This is a recreation of the product's own activity strip, not a screenshot:
 * the format, the braille spinner and the ordering are lifted from the real
 * component so the page and the app agree, but it is rebuilt in the page so it
 * can move. A still image of a progress indicator argues nothing — the claim
 * being made is that you can watch the work and the cost as it happens, and the
 * only honest way to show that is to let it run.
 *
 * It is driven off one 80ms tick, only while on screen, and holds its finished
 * state for anyone who asked for reduced motion.
 */

/** The spinner from the app, at the app's frame rate. */
const SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const;
const SETTLED_GLYPH = "◆";
const TICK_MS = 80;

/** One pass of the timeline, in ticks. 80ms each. */
const TOTAL_TICKS = 150;
const HOLD_TICKS = 34;

type Phase = { until: number; word: string; line: string };

// The run reads as a real one: it plans, edits, discovers a failure, fixes it,
// and only then reports green. A demo that succeeds on the first try is the
// tell that nobody ran it.
const PHASES: Phase[] = [
  {
    until: 20,
    word: "planning",
    line: "Reading the failing spec and the module it covers",
  },
  {
    until: 48,
    word: "editing",
    line: "lib/pricing/model-price.ts — rewriting the retail margin path",
  },
  { until: 74, word: "running tests", line: "pnpm vitest run lib/pricing" },
  {
    until: 92,
    word: "reading output",
    line: "1 failed — rounding drifts at the 3rd decimal",
  },
  {
    until: 118,
    word: "editing",
    line: "lib/pricing/model-price.ts — rounding at the boundary instead",
  },
  {
    until: TOTAL_TICKS,
    word: "running tests",
    line: "pnpm vitest run lib/pricing",
  },
];

/** Counters climb across the run rather than jumping at the end. */
function counters(tick: number) {
  const progress = Math.min(tick / TOTAL_TICKS, 1);
  return {
    agents: tick < 20 ? 1 : tick < 74 ? 2 : 3,
    tools: Math.round(progress * 28),
    added: Math.round(progress * 214),
    removed: Math.round(progress * 37),
    context: Math.round(18 + progress * 44),
    cost: progress * 0.41,
  };
}

export function BuildRunDemo() {
  const reduceMotion = useReducedMotion();
  const hostRef = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(reduceMotion ? TOTAL_TICKS : 0);

  useEffect(() => {
    if (reduceMotion) return;
    const host = hostRef.current;
    if (!host) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        // The pass ends, holds on its result, then starts over — a loop that
        // restarts instantly reads as a glitch rather than a second run.
        setTick((previous) =>
          previous >= TOTAL_TICKS + HOLD_TICKS ? 0 : previous + 1,
        );
      }, TICK_MS);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    // Nothing animates while it is off screen: a landing page should not spend
    // the reader's battery on a panel they are not looking at.
    const observer = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting ? start() : stop()),
      { threshold: 0.15 },
    );
    observer.observe(host);
    return () => {
      observer.disconnect();
      stop();
    };
  }, [reduceMotion]);

  const running = tick < TOTAL_TICKS;
  const clamped = Math.min(tick, TOTAL_TICKS);
  const phase =
    PHASES.find((entry) => clamped < entry.until) ?? PHASES[PHASES.length - 1];
  const { agents, tools, added, removed, context, cost } = counters(clamped);
  const glyph = running
    ? SPINNER_FRAMES[tick % SPINNER_FRAMES.length]
    : SETTLED_GLYPH;

  return (
    <div
      ref={hostRef}
      className="overflow-hidden rounded-[14px] border border-border bg-[var(--surface,#0c0c0c)]"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="size-1.5 rounded-full bg-foreground/25" />
        <span className="text-[11.5px] font-medium tracking-[0.02em] text-[var(--cursor-text-secondary)]">
          Build · Claude Opus 4.8
        </span>
      </div>

      <div className="px-4 py-4 font-mono text-[12px] leading-[1.7]">
        <p className="text-foreground/55">
          <span className="text-foreground/35">›</span> the pricing test is
          failing, find out why and fix it
        </p>
        <p className="mt-2 min-h-[1.7em] text-foreground/80">
          <span className="mr-2 inline-block w-[1ch] text-foreground">
            {glyph}
          </span>
          {running ? phase.word : "done"}
        </p>
        <p className="mt-1 min-h-[1.7em] text-[var(--cursor-text-secondary)]">
          {running ? phase.line : "2 passed · 0 failed"}
        </p>
      </div>

      {/* The strip the product actually shows, in the product's own order. */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-border px-4 py-3 text-[10.5px] font-medium text-[var(--cursor-text-secondary)]">
        <span>
          {agents} agent{agents === 1 ? "" : "s"}
        </span>
        <span aria-hidden>·</span>
        <span>{tools} tools</span>
        <span aria-hidden>·</span>
        <span>
          diff <span className="text-emerald-400">+{added}</span>{" "}
          <span className="text-rose-400">−{removed}</span>
        </span>
        <span aria-hidden>·</span>
        <span>{context}% context</span>
        <span aria-hidden>·</span>
        {/* Tabular figures so the cost does not jitter sideways as it climbs. */}
        <span className="tabular-nums text-foreground">${cost.toFixed(2)}</span>
      </div>
    </div>
  );
}
