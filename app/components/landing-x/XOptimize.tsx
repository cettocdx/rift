"use client";

import {
  Anthropic,
  Moonshot,
  OpenAI,
  Qwen,
  XAI,
  ZAI,
} from "@lobehub/icons";
import { createElement, useEffect, useRef, useState, type ComponentType } from "react";

import { Reveal } from "./reveal";
import { X_CONTAINER, X_LABEL, X_SECTION, X_SECTION_PAD } from "./x-system";

/**
 * Three optimize cards, gumloop's "Optimize Your Agents" band.
 *
 * ── The animation, measured off their recording ──
 *
 * Their cards are not still. Frame by frame:
 *
 *   1. the provider ring **cycles** — one logo lifts to full white with a
 *      shadow while the rest sit faded, and the figure in the middle changes
 *      with it (-83% → -86%, $0.071 → $0.059). The point is made by the
 *      *change*: a different model, a different price, same task.
 *   2. a token travels the orbit and pauses at each labelled station.
 *   3. a callout card swaps its text on a timer.
 *
 * That cadence is copied here — a slow index advancing on a timer, everything
 * else derived from it — and the content is ours.
 *
 * ── What is real ──
 *
 * Card one's ring is the providers behind `BUILD_MODELS`. Card two is the
 * plan → build → verify loop `verify_app` runs. Card three is the agent
 * record: the gates, budget and trace a run actually holds,
 * surfaced one at a time in a floating callout.
 *
 * ── Motion ──
 *
 * One index, one interval, compositor-only properties, paused off-screen and
 * frozen under reduced motion (which shows a settled first state rather than
 * an empty one).
 */

type Mark = ComponentType<{ size?: number; className?: string }>;

const PROVIDERS: { id: string; Logo: Mark }[] = [
  { id: "openai", Logo: OpenAI as Mark },
  { id: "anthropic", Logo: Anthropic as Mark },
  { id: "xai", Logo: XAI as Mark },
  { id: "moonshot", Logo: Moonshot as Mark },
  { id: "qwen", Logo: Qwen.Color as Mark },
  { id: "zai", Logo: ZAI as Mark },
];

const STATIONS = ["Plan", "Build", "Verify"] as const;
const TICK_MS = 1900;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/** One shared clock, so the three cards advance together. */
function useCycle(length: number, hostRef: React.RefObject<HTMLElement | null>) {
  const [i, setI] = useState(0);
  const iRef = useRef(0);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        iRef.current = (iRef.current + 1) % length;
        setI(iRef.current);
      }, TICK_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };
    if (typeof IntersectionObserver === "undefined") {
      start();
      return stop;
    }
    const io = new IntersectionObserver(
      ([e]) => (e.isIntersecting ? start() : stop()),
      { threshold: 0.2 },
    );
    io.observe(host);
    return () => {
      io.disconnect();
      stop();
    };
  }, [length, hostRef]);
  return i;
}

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-[16px] bg-[var(--x-raise)]">
      {children}
    </div>
  );
}

/* ── Card 1: the routing ring, cycling ────────────────────────────────── */

/**
 * The comparison, gumloop's own mechanic.
 *
 * Their card lights *two* logos at once — a fixed baseline and a cycling
 * alternative — and the figure between them changes with the alternative:
 * "-72%", "$0.42" struck through, "$0.12" in green. The argument is made by
 * the change, not by the number: same task, different model, a fraction of the
 * cost. Copied exactly; the roster and the rates are ours.
 *
 * The baseline is the frontier default a buyer would otherwise reach for; the
 * alternatives are the cheaper models on the same key. The rates are
 * illustrative of the spread and the card says "per task" rather than quoting
 * a price the checkout has to honour.
 */
const BASELINE = { index: 0, price: 0.42 };
const ALTERNATIVES = [1, 2, 3, 4, 5];
const ALT_PRICE = [0.16, 0.12, 0.09, 0.071, 0.055];

function RoutingRing({ active }: { active: number }) {
  const altSlot = active % ALTERNATIVES.length;
  const altIndex = ALTERNATIVES[altSlot];
  const alt = ALT_PRICE[altSlot];
  const cut = Math.round((1 - alt / BASELINE.price) * 100);

  return (
    <CardShell>
      {PROVIDERS.map(({ id, Logo }, i) => {
        const lit = i === BASELINE.index || i === altIndex;
        const a = (i / PROVIDERS.length) * Math.PI * 2 - Math.PI / 2;
        return (
          <span
            key={id}
            className="absolute flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[12px]"
            style={{
              left: `${50 + Math.cos(a) * 36}%`,
              top: `${50 + Math.sin(a) * 36}%`,
              background: lit ? "var(--x-ground)" : "transparent",
              boxShadow: lit ? "0 8px 20px -8px rgba(0,0,0,0.3)" : "none",
              opacity: lit ? 1 : 0.22,
              transform: `translate(-50%,-50%) scale(${lit ? 1.06 : 0.9})`,
              transition: `opacity 420ms ${EASE}, transform 420ms ${EASE}, background 420ms ${EASE}, box-shadow 420ms ${EASE}`,
            }}
          >
            {createElement(Logo, { size: 21 })}
          </span>
        );
      })}

      <div className="absolute left-1/2 top-1/2 w-full -translate-x-1/2 -translate-y-1/2 px-6 text-center">
        <p className="text-[11px] leading-[1.35] text-[var(--x-ink-45)]">
          Cost reduction
          <br />
          per task
        </p>
        <p
          key={`cut-${altSlot}`}
          className="mt-1 text-[34px] font-medium leading-none tracking-[-0.03em] text-[var(--x-ink-45)]"
          style={{ animation: `x-opt-in 420ms ${EASE} both` }}
        >
          −{cut}
          <span className="text-[18px]">%</span>
        </p>
        <p className="mt-2 text-[13px] tabular-nums">
          <span className="text-[var(--x-ink-30)] line-through">
            ${BASELINE.price.toFixed(2)}
          </span>{" "}
          <span
            key={`alt-${altSlot}`}
            className="font-medium text-[var(--x-live)]"
            style={{ animation: `x-opt-in 420ms ${EASE} both` }}
          >
            ${alt.toFixed(alt < 0.1 ? 3 : 2)}
          </span>
        </p>
      </div>
    </CardShell>
  );
}

/* ── Card 2: the loop, the token pausing at stations ──────────────────── */

function VerifyLoop({ active }: { active: number }) {
  const station = active % STATIONS.length;
  const R = 33;
  const a = (station / STATIONS.length) * Math.PI * 2 - Math.PI / 2;
  return (
    <CardShell>
      <div className="absolute inset-0 flex items-center justify-center">
        <svg viewBox="0 0 200 200" className="size-[86%]" aria-hidden fill="none">
          <circle cx="100" cy="100" r="66" stroke="var(--x-line)" strokeWidth="1" />
        </svg>
      </div>

      {/* The token, easing from station to station rather than sweeping. */}
      <span
        aria-hidden
        className="absolute z-10 size-3 rounded-full bg-[var(--x-ink)] shadow-[0_0_0_4px_var(--x-raise)]"
        style={{
          left: `${50 + Math.cos(a) * R}%`,
          top: `${50 + Math.sin(a) * R}%`,
          transform: "translate(-50%,-50%)",
          transition: `left 700ms ${EASE}, top 700ms ${EASE}`,
        }}
      />

      {STATIONS.map((label, i) => {
        const on = i === station;
        const sa = (i / STATIONS.length) * Math.PI * 2 - Math.PI / 2;
        return (
          <div
            key={label}
            className="absolute -translate-x-1/2 -translate-y-1/2 text-center"
            style={{
              left: `${50 + Math.cos(sa) * R}%`,
              top: `${50 + Math.sin(sa) * R}%`,
            }}
          >
            <span className="mx-auto block size-2 rounded-full bg-[var(--x-ink)]/25" />
            <span
              className="mt-1.5 block font-mono text-[10px] uppercase tracking-[0.06em]"
              style={{
                color: on ? "var(--x-ink)" : "var(--x-ink-45)",
                transition: `color 420ms ${EASE}`,
              }}
            >
              {label}
            </span>
          </div>
        );
      })}

      <div className="absolute left-1/2 top-1/2 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--x-ink)]">
        <span className="size-2 rounded-full bg-[var(--x-ground)]" />
      </div>
    </CardShell>
  );
}

/* ── Card 3: the run record, as a floating callout ────────────────────── */

/**
 * gumloop's third card is a faint dot grid with a notification card floating
 * over it, its text swapping on the same clock ("Flag — voice & tone passes
 * fell to 38 of 46 tasks"). It is the *evals* card: the product noticing
 * something and telling you.
 *
 * Ours is the same shape carrying what RIFT actually records. Every line is a
 * thing the run trace holds — the gate that failed, the budget it closed
 * under, the agent it delegated to — rather than a metric invented for the
 * card.
 */
const NOTICES = [
  {
    kind: "Gate",
    body: "Mobile render failed at 390×844. The preview was held back and the fix reran.",
  },
  {
    kind: "Budget",
    body: "Run closed at $2.10 of a $20 allowance, priced as it went.",
  },
  {
    kind: "Delegate",
    body: "Security Engineer picked up the scoped pass and kept its evidence.",
  },
  {
    kind: "Trace",
    body: "2 tools called, 1 file touched, 41K of context — attached to the run.",
  },
] as const;

function RunRecord({ active }: { active: number }) {
  const n = NOTICES[active % NOTICES.length];
  return (
    <CardShell>
      {/* The faint grid, theirs. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            "linear-gradient(to right, color-mix(in srgb, var(--x-ink) 7%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--x-ink) 7%, transparent) 1px, transparent 1px)",
          backgroundSize: "38px 38px",
        }}
      />
      {/* A slow scan line — their vertical rule drifting across the grid. */}
      <div
        aria-hidden
        className="absolute inset-y-0 w-px bg-[color-mix(in_srgb,var(--x-ink)_14%,transparent)] [animation:x-scan_9s_linear_infinite] motion-reduce:hidden"
      />

      <div className="absolute inset-0 flex items-center justify-center p-6">
        <div
          key={n.kind}
          className="w-full max-w-[280px] rounded-[10px] border-[0.5px] border-[var(--x-line)] bg-[var(--x-ground)] p-4 shadow-[0_14px_36px_-16px_rgba(0,0,0,0.28)]"
          style={{ animation: `x-opt-in 460ms ${EASE} both` }}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--x-ink-45)]">
            {n.kind}
          </p>
          <p className="mt-1.5 text-[12.5px] leading-[1.5] text-[var(--x-ink)]">
            {n.body}
          </p>
        </div>
      </div>
    </CardShell>
  );
}

/* ── The band ─────────────────────────────────────────────────────────── */

export function XOptimize() {
  const hostRef = useRef<HTMLDivElement>(null);
  const i = useCycle(PROVIDERS.length, hostRef);

  const CARDS = [
    {
      figure: <RoutingRing active={i} />,
      lead: "Model per task, not per subscription.",
      rest: "Every frontier vendor on one key. Switch mid-thread; the bill is the same.",
    },
    {
      figure: <VerifyLoop active={i} />,
      lead: "It checks its own work.",
      rest: "Plan, build, verify — the loop runs the production build and renders the page before it says done.",
    },
    {
      figure: <RunRecord active={i} />,
      lead: "Every run on the record.",
      rest: "Gates, budget, delegation and trace are attached to the run and stay with it.",
    },
  ];

  return (
    <section className={X_SECTION_PAD} ref={hostRef}>
      <div className={X_CONTAINER}>
        <Reveal>
          <p className={X_LABEL}>Optimize</p>
          <h2
            className={`${X_SECTION} mt-4 max-w-[18ch] text-balance text-[var(--x-ink)]`}
          >
            Cheaper, checked, and delegated
          </h2>
        </Reveal>

        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          {CARDS.map((card, ci) => (
            <Reveal key={card.lead} step={ci}>
              {card.figure}
              <p className="mt-4 text-[14px] leading-[1.5] tracking-[-0.025em]">
                <span className="font-medium text-[var(--x-ink)]">
                  {card.lead}
                </span>{" "}
                <span className="text-[var(--x-ink-45)]">{card.rest}</span>
              </p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
