import type { CSSProperties } from "react";

/**
 * The design system, measured off hermeus.com on 23 Aug 2026.
 *
 * Hermeus is the opposite of the x.ai register: where that page is near-black
 * with quiet numerals, this one is bright industrial — a light grey ground,
 * dark-grey ink, one neutral grotesque, uppercase letter-spaced labels, huge
 * display headings, and full-bleed metallic imagery that carries most of the
 * page. The copy is terse and declarative ("Building Fast Planes. Fast."), and
 * a single gold accent (their wing) is the only colour.
 *
 * Measured on the live site:
 *   ground  rgb(236,236,236)  #ececec   (with white and #d8d8d8 bands)
 *   ink     rgb(69,67,67)     #454343
 *   type    TeX Gyre Heros (a Helvetica clone) — matched here with the neutral
 *           grotesque the app already ships, set tight and, for labels, upper-
 *           case with wide tracking.
 *   display 94px on the "Mission" heading — this page lives on huge type.
 *
 * The RIFT translation keeps the structure and the restraint: a news ticker, a
 * cinematic full-bleed hero with a terse tag, a huge mission statement, an
 * engineering spec block, product bands, and an industrial footer. Aerospace
 * for a company that ships software fast.
 */

export const H_TOKENS = {
  "--h-ground": "#f0efed",
  "--h-panel": "#ffffff",
  "--h-deep": "#d8d8d8",
  "--h-ink": "#1c1b1b",
  "--h-ink-70": "#454343",
  "--h-ink-45": "rgba(28,27,27,0.5)",
  "--h-line": "rgba(28,27,27,0.16)",
  "--h-line-soft": "rgba(28,27,27,0.08)",
  /** The single accent — Hermeus's wing gold, tuned a touch deeper for text. */
  /** No accent hue — the page is monochrome like /landing/x. This token is
   *  kept as ink so any former "accent" reads as plain emphasis. */
  "--h-accent": "#1c1b1b",
  /** The only colour: a functional status green, for live dots. */
  "--h-live": "#3f9256",
  // The typeface now matches /landing/x: Geist for everything, JetBrains Mono
  // for the terminal/technical layer. Same faces the app itself ships.
  "--h-sans": '-apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, system-ui, sans-serif',
  "--h-mono":
    "var(--font-jetbrains-mono), ui-monospace, 'SF Mono', Menlo, monospace",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, system-ui, sans-serif',
  "--h-dark": "#0a0a0a",
  "--h-dark-raise": "rgba(255,255,255,0.03)",
  "--h-dark-line": "#1f2228",
  "--h-dark-ink": "#ffffff",
  "--h-dark-ink-45": "rgba(255,255,255,0.45)",
  colorScheme: "light",
} as CSSProperties;

/* ── Type ─────────────────────────────────────────────────────────────── */

/**
 * The hero/mission display. Enormous, tight, medium weight — the page is
 * carried by type at this size the way the reference is.
 */
export const H_DISPLAY =
  "text-[30px] leading-[1.05] font-medium tracking-[-0.02em] sm:text-[38px] lg:text-[46px]";

/** A large section heading, one step under the display. */
export const H_HEADING =
  "text-[22px] leading-[1.1] font-medium tracking-[-0.02em] sm:text-[26px] lg:text-[30px]";

/** The terse statement/body under a heading. */
export const H_LEDE =
  "text-[15px] leading-[1.55] font-normal text-[var(--h-ink-70)] sm:text-[16px]";

export const H_BODY =
  "text-[15px] leading-[1.6] font-normal text-[var(--h-ink-70)]";

/** Uppercase, wide-tracked eyebrow/label — nav, section tags, spec keys. */
export const H_MONO =
  "font-[family-name:var(--h-mono)] text-[12px] tracking-[-0.01em] text-[var(--h-ink-70)]";

export const H_LABEL =
  "text-[11px] font-medium uppercase tracking-[0.13em] text-[var(--h-ink-70)]";

/** Nav item. */
export const H_NAV =
  "text-[12px] font-medium uppercase tracking-[0.09em] text-[var(--h-ink-70)] transition-colors hover:text-[var(--h-ink)]";

/* ── Controls ─────────────────────────────────────────────────────────── */

/**
 * Square, not pill. Hermeus's controls are sharp-cornered and industrial —
 * the exact opposite of x.ai's full pills, and the fastest way to read as a
 * different company.
 */
export const H_BTN =
  "inline-flex h-11 items-center justify-center gap-2 px-6 text-[12px] font-semibold uppercase tracking-[0.12em] transition-colors motion-reduce:transition-none";
export const H_BTN_SOLID = `${H_BTN} bg-[var(--h-ink)] text-[var(--h-ground)] hover:bg-[var(--h-ink-70)]`;
export const H_BTN_GHOST = `${H_BTN} border border-[var(--h-line)] text-[var(--h-ink)] hover:border-[var(--h-ink)]`;

/* ── Layout ───────────────────────────────────────────────────────────── */

/** Wide industrial gutters, generous column. */
export const H_CONTAINER = "mx-auto w-full max-w-[1360px] px-6 sm:px-10";

/** Section rhythm. */
export const H_PAD = "py-24 lg:py-36";
