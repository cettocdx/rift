import type { CSSProperties } from "react";

/**
 * The design system of the parallel landing, measured off primeintellect.ai.
 *
 * Every value here was read with `getComputedStyle` on 20 Aug 2026 at a
 * 1512px viewport, not eyeballed from a screenshot. The page it describes is
 * 10,744px tall and its whole effect comes from restraint, so the numbers
 * matter more than usual: getting the type 8px too large or the grid one shade
 * too bright turns a technical document back into a marketing page.
 *
 * ── The finding that drives all of this ──
 *
 * Prime Intellect's display type is the *smallest* of any page in this peer
 * group. Its h1 is 36px at weight 400 with zero tracking; vercel.com opens at
 * 64px, databuddy.cc at 60px, tempo.new at 52px. It also reads as the most
 * serious of the five. The authority is not in the type — it is in everything
 * the type sits inside: a visible modular grid, monospace on every machine
 * fact, decimal indices, figure numbers, and a piece of real evidence in every
 * single cell.
 *
 * So this file encodes a *document*, not a poster.
 */

/* ── Palette ──────────────────────────────────────────────────────────── */

/**
 * Near-black, one hairline, and no accent.
 *
 * Measured: their ground is near-black, their grid hairline is rgb(32,32,32)
 * and appears 150 times across the page, and the only saturated colour on the
 * entire site is a single acid-green band behind one customer quote.
 *
 * Ours takes the ground and the hairline and declines the green. Copying a
 * competitor's one signature colour is the move that reads as imitation
 * rather than as craft — and RIFT has no accent hue anywhere else, so it would
 * arrive from nowhere.
 */
export const PI_TOKENS = {
  "--pi-ground": "#0b0b0c",
  "--pi-cell": "#0e0e0f",
  "--pi-line": "#202020",
  "--pi-line-soft": "rgba(255,255,255,0.09)",
  "--pi-ink": "#ededed",
  "--pi-dim": "rgba(255,255,255,0.62)",
  "--pi-faint": "rgba(255,255,255,0.5)",
  /*
   * Their pair for a label and its index is 88% and 45%. Ours keeps the label
   * and lifts the index.
   *
   * A contrast sweep put four elements at 4.06-4.08:1 against the cell — all
   * of them index-toned, all of them small, and all of them carrying real
   * information: a release-status disclosure, a scan's scope line, a run's
   * totals, the name of a platform. 4.5:1 is the line at which small text
   * stops being a problem for a reader with ordinary vision in ordinary
   * light, and losing seven points of fidelity to the reference is a much
   * smaller cost than losing the sentence.
   */
  "--pi-label": "rgba(255,255,255,0.88)",
  "--pi-index": "rgba(255,255,255,0.58)",
  "--pi-sans": '-apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, system-ui, sans-serif',
  "--pi-mono":
    "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, system-ui, sans-serif',
  colorScheme: "dark",
} as CSSProperties;

/* ── Type ─────────────────────────────────────────────────────────────── */

/**
 * 36px, weight 400, zero tracking.
 *
 * The temptation is to make this bigger. Resist it: the measured page is at 36
 * and it is the quietest and most convincing of the set. Zero tracking is
 * equally deliberate — Vercel's signature is -0.06em, and Prime Intellect
 * never touches the axis at any size.
 */
export const PI_DISPLAY =
  "text-[28px] leading-[1.1] tracking-normal font-normal sm:text-[32px] lg:text-[36px]";

/** 28px, weight 400, leading 1.2. Every section heading on their page. */
export const PI_HEADING =
  "text-[22px] leading-[1.2] tracking-normal font-normal sm:text-[25px] lg:text-[28px]";

/**
 * Their headline pattern: a bright noun, then the sentence at 50%.
 *
 * `Lab.` in full white followed by "Post-train your own self improving
 * agents" at half — same size, same weight, opacity carrying the whole
 * hierarchy. Repeated exactly for Inference., Compute., Research. It is the
 * cheapest hierarchy device on the page and the one most worth stealing.
 */
export const PI_HEADING_LEAD = "text-[var(--pi-ink)]";
export const PI_HEADING_REST = "text-[rgba(255,255,255,0.5)]";

/** Running copy. 15px on a 1.55 line, at 62%. */
export const PI_BODY = "text-[15px] leading-[1.55] text-[var(--pi-dim)]";

/**
 * The mono label. 12px, weight 400, uppercase, no tracking.
 *
 * Note the absent letter-spacing. Uppercase mono at 12px is normally opened
 * up; they leave it alone, which is part of why the labels read as terminal
 * output rather than as small-caps styling.
 */
export const PI_LABEL =
  "font-mono text-[12px] font-normal uppercase text-[var(--pi-label)]";
export const PI_INDEX =
  "font-mono text-[12px] font-normal uppercase text-[var(--pi-index)]";

/** The figure number that sits on a cell's corner, on the rule itself. */
export const PI_FIG =
  "font-mono text-[11px] font-normal uppercase tracking-[0.04em] text-[var(--pi-index)]";

/* ── Layout ───────────────────────────────────────────────────────────── */

/**
 * 1400px of content inside a 1440 cap with 20px of padding — theirs exactly.
 */
export const PI_CONTAINER = "mx-auto w-full max-w-[1440px] px-5";

/**
 * 40px between cells. Not 96, not 128.
 *
 * The other surprise from the measurement. This page does not breathe the way
 * a modern marketing site is supposed to: its blocks sit 40px apart and the
 * air lives *inside* the cells instead of between them. That density is a
 * large part of why it reads as a document.
 */
export const PI_GAP = "mt-10";

/* ── Motion ───────────────────────────────────────────────────────────── */

/** One curve, long tail, no overshoot. */
export const PI_EASE = [0.22, 1, 0.36, 1] as const;
export const PI_DURATION = { tap: 0.12, control: 0.2, enter: 0.55 } as const;
