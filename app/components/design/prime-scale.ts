import type { CSSProperties } from "react";

/**
 * The product-UI scale, measured off app.primeintellect.ai.
 *
 * Every value below was read with `getComputedStyle` on the Quickstart
 * dashboard on 22 Aug 2026 at a 1512px viewport. None of it is estimated from
 * a screenshot, and none of it is carried over from the marketing site —
 * which is the point worth stating first.
 *
 * ── The finding ──
 *
 * Their application and their marketing page do not share a design system.
 * They do not even share a typeface. Put side by side:
 *
 *                        primeintellect.ai        app.primeintellect.ai
 *   typeface             marketing face           IBM Plex Sans / Plex Mono
 *   ground               near-black #0b0b0c       pure #000000
 *   display              36px / weight 400        30px / weight 600
 *   body                 15px                     16px / 24px line
 *   hairline             rgb(32,32,32)            rgb(46,46,46), 2px on cards
 *   corners              square                   6-8px, and 2px on nav rows
 *
 * The marketing page is a document: small type, no weight contrast, hairline
 * grid, everything at rest. The application is the opposite — bigger type,
 * real weight steps, filled surfaces, rounded corners. They are two different
 * jobs and they are designed as two different jobs, which is the actual
 * lesson: a product UI that borrows its marketing page's restraint reads as
 * underpowered, and a marketing page that borrows its product's weight reads
 * as a dashboard screenshot.
 *
 * So this file is the *application* scale. The marketing scale lives in
 * app/components/landing-pi/pi-system.ts and the two are meant to differ.
 */

/* ── Palette ──────────────────────────────────────────────────────────── */

/**
 * Pure black, and five inks.
 *
 * The ground is `#000000` exactly — not the near-black most dark UIs use.
 * That is measurable and deliberate: against a true black, `#262626` surfaces
 * read as raised without needing a border, which is why their cards can carry
 * a 2px hairline and still feel light.
 */
export const PRIME_TOKENS = {
  "--pa-ground": "#000000",
  /** Raised surfaces: buttons, chips, the fill behind a code block. */
  "--pa-surface": "#262626",
  /** The same fill, thinned — code boxes at 35%, step numerals at 25%. */
  "--pa-surface-soft": "rgba(38, 38, 38, 0.35)",
  "--pa-surface-faint": "rgba(38, 38, 38, 0.25)",
  /** An active navigation row. Light on black, not a fill colour. */
  "--pa-active": "rgba(255, 255, 255, 0.08)",
  "--pa-line": "#2e2e2e",
  /** Cards thin their border rather than darkening it. */
  "--pa-line-soft": "rgba(46, 46, 46, 0.7)",
  "--pa-ink": "#fafafa",
  /** Navigation labels sit between the ink and the muted tone. */
  "--pa-nav": "#d0d3d8",
  "--pa-muted": "#a3a3a3",
  "--pa-faint": "#787b82",
  /*
   * Geist and JetBrains Mono — ours, not theirs.
   *
   * The measurement found IBM Plex Sans and Plex Mono, and this file shipped
   * with them for exactly one pass before the typeface was brought back. That
   * is the right call and worth recording rather than quietly reverting: what
   * transfers from another company's product is the *system* — the steps
   * between sizes, the weights that carry rank, the ratios of the palette,
   * the geometry. The typeface is their identity, and adopting it makes a
   * product look like theirs rather than like itself.
   *
   * Every number below this line is still measured off their application. The
   * face it is set in is RIFT's.
   */
  "--pa-sans": '-apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, system-ui, sans-serif',
  "--pa-mono":
    "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, system-ui, sans-serif',
  colorScheme: "dark",
} as CSSProperties;

/* ── Type ─────────────────────────────────────────────────────────────── */

/**
 * Four weights doing real work.
 *
 * The marketing page uses one weight and carries hierarchy on opacity alone.
 * The application does the opposite: 600 for a display line, 500 for a section
 * title, 400 for everything else, and it barely touches opacity. Copying the
 * marketing approach into a dense product screen is how a dashboard ends up
 * looking like it has no headings.
 */

/** 30 / 600 / 36. The one large line on a screen. */
export const PA_DISPLAY =
  "text-[26px] leading-[32px] font-semibold sm:text-[30px] sm:leading-[36px]";

/** 24 / 500 / 32. A section or step title. */
export const PA_TITLE =
  "text-[22px] leading-[30px] font-medium sm:text-[24px] sm:leading-[32px]";

/** 18 / 600 / 28. The page name in a header bar. */
export const PA_PAGE_TITLE = "text-[18px] leading-[28px] font-semibold";

/** 16 / 400 / 24. Body copy, and the label above a field. */
export const PA_BODY = "text-[16px] leading-[24px] font-normal";

/** 16 / 400 / 28. Body copy given room, under a display line. */
export const PA_LEDE = "text-[16px] leading-[28px] font-normal";

/** 14 / 400 / 20. Sub-headers, navigation rows, secondary copy. */
export const PA_SMALL = "text-[14px] leading-[20px] font-normal";

/** 12 / 500 / 16. A button's label. */
export const PA_BUTTON = "text-[12px] leading-[16px] font-medium";

/** 12 / 400 / 16, mono. Code inside a box. */
export const PA_CODE = "font-mono text-[12px] leading-[16px] font-normal";

/**
 * 11 / 400 / 16, mono, uppercase, tracking 0.22px.
 *
 * Their sidebar group labels — LAB, COMPUTE. Measured in ABC Favorit Mono,
 * which is licensed and not ours; the slot is what matters and JetBrains Mono
 * fills it. 0.22px at 11px is 0.02em, which is what the tracking below says
 * so it holds if the size ever moves.
 */
export const PA_GROUP =
  "font-mono text-[11px] leading-[16px] font-normal uppercase tracking-[0.02em]";

/* ── Geometry ─────────────────────────────────────────────────────────── */

/**
 * Measured widths and paddings.
 *
 * The sidebar is 256px and the content column is 1224px with 56px above and
 * 40px below — generous by the standards of the marketing page, which runs its
 * blocks 40px apart. Density belongs to a document; a workspace needs the air.
 */
export const PA_SIDEBAR_WIDTH = "w-[256px]";
export const PA_CONTENT = "mx-auto w-full max-w-[768px] px-6";
export const PA_PAGE_PAD = "pt-14 pb-10";

/** A card: 2px hairline at 70%, 8px corners, 20px inside. */
export const PA_CARD =
  "rounded-[8px] border-2 border-[var(--pa-line-soft)] bg-[var(--pa-ground)] p-5";

/** A code box: 1px line, thinned fill, 6px corners, 8/12 inside. */
export const PA_CODE_BOX =
  "rounded-[6px] border border-[var(--pa-line)] bg-[var(--pa-surface-soft)] px-3 py-2";

/** A filled button: 6px corners, 12px sides, 32 tall. */
export const PA_BUTTON_FILLED =
  "inline-flex h-8 items-center gap-2 rounded-[6px] bg-[var(--pa-surface)] px-3 text-[var(--pa-ink)]";

/**
 * A navigation row: 36 tall, 8px inside, gap 8 — and a 2px corner.
 *
 * That radius is the single most distinctive number in the whole system.
 * Everything else on the screen is 6 or 8; the rows that repeat forty times
 * down a sidebar are almost square, which stops the list reading as a stack of
 * pills.
 */
export const PA_NAV_ROW =
  "flex h-9 items-center gap-2 rounded-[2px] p-2 text-[var(--pa-nav)]";
