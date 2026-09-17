/**
 * The public type scale, as one set of values rather than a clamp() per file.
 *
 * Every heading on the marketing pages used to be its own
 * `text-[clamp(1.9rem,3.9vw,3rem)]`, which is why measuring the rendered page
 * returned 64.8px, 48px, 18.4px and 83.64px — numbers nobody chose, produced by
 * a viewport multiplication. A scale that lands on fractional values cannot be
 * checked against a reference, and it cannot be kept consistent between files.
 *
 * The values below come from measuring the pages this product is judged
 * against, on 18 Aug 2026 (docs/product-transformation/axiom-visual-benchmark-2026-08-18.md):
 *
 *   axiom.co   h1 72/68  w500  -0.025em   h2 40/44  body 15/22.5  rhythm 96px
 *   linear.app h1 64/64  w510  -0.022em   h2 48/48  body 15/24    rhythm 128px
 *   cursor.com h1 26/32  w400  -0.0125em                          rhythm 67.2px
 *
 * Two products that never spoke to each other landed on the same three rules:
 * display weight stays at 500 and never reaches 600, tracking sits near
 * -0.025em, and the vertical rhythm is one constant repeated without exception.
 * Those are the rules encoded here. RIFT was outside all three.
 */

/** Hero display. 40px on a phone, 72px from `md` up — no viewport arithmetic. */
export const DISPLAY_CLASS =
  "text-[40px] leading-[1.0] tracking-[-0.06em] font-normal sm:text-[56px] md:text-[64px] md:leading-[1.0]";

/**
 * Section heading.
 *
 * Re-exported, not redefined — this was the second copy of the same token, the
 * same way MICRO_LABEL_CLASS was, and the two had drifted to different weights
 * (500 here, 400 there) for the same role on the same page.
 *
 * The values are linear.app's, measured: its h2 is 48px at weight 510 with
 * -1.056px of tracking on a 48px line, which is -0.022em and a line-height of
 * exactly 1.0. Weight 510 is the detail worth taking — it is a variable-font
 * weight that no static cut offers, and it is why Linear's headings read as
 * set rather than as bold. Geist carries the axis, so it lands here too.
 */
export { SECTION_TITLE as SECTION_HEADING_CLASS } from "./landing-design-system";

/** Sub-heading under a display line. 16px, not the 18.4px it rendered at. */
export const LEAD_CLASS =
  "text-[16px] leading-[1.6] tracking-[-0.006em] text-foreground/60";

/** Running copy inside a section. */
export const BODY_CLASS = "text-[15px] leading-[1.6] text-foreground/60";

/**
 * Eyebrow / data label.
 *
 * Re-exported rather than defined, because there were two of these. This file
 * had one at mono/40% and landing-design-system.ts had another, and six live
 * components imported this copy — so raising the contrast in one place left
 * the footer, the comparison table, the model row, the scrubber and the vendor
 * strip still at 40%, which measures 3.48:1 and fails AA at 11px uppercase.
 * Two definitions of the same token is how a page ends up with two answers.
 *
 * MICRO is now the only definition; see landing-design-system.ts for the
 * measurements behind its weight, tracking and opacity.
 */
export { MICRO as MICRO_LABEL_CLASS } from "./landing-design-system";

/**
 * One rhythm, repeated. 96px is Axiom's constant; 64px below `sm` so a phone
 * does not scroll through a screen of nothing between every section.
 */
export const SECTION_RHYTHM_CLASS = "py-16 sm:py-20 md:py-24";

/** The closing section gets double, the way both references end their page. */
export const CLOSING_RHYTHM_CLASS = "py-24 sm:py-32 md:py-48";

/** Content column. Axiom 1240, Linear 1380 — RIFT sat at 1100. */
/**
 * The content column.
 *
 * 1448 with 24px of padding, which is vercel.com's own: measured on their page
 * at 1512px, the container caps at max-width 1448 and the headline starts at
 * x=56, giving 1400px of content. This page was at 1240/1160 — a full 240px
 * narrower — which is why it read as a column on a wide screen while theirs
 * reads as a page.
 */
export const CONTAINER_CLASS = "mx-auto w-full max-w-[1448px] px-6";
