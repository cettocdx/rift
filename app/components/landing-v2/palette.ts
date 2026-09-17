import type { CSSProperties } from "react";

/**
 * The brand's palette, pinned to the page rather than inherited from the app.
 *
 * Appearance is a workspace preference: someone who works in the light theme
 * should still meet the brand as it is meant to look. Redefining the base
 * tokens on a wrapper keeps every Tailwind utility below it working unchanged
 * while holding the page at the OLED black the product is designed around.
 *
 * Every public surface imports this one object. Sign-in, pricing, download and
 * the three legal documents used to carry their own hexes, which is how a
 * product ends up with four blacks and three blues.
 */
export const LANDING_PALETTE = {
  /**
   * Geist, pinned — not the workspace's font preference.
   *
   * The appearance setting writes `data-rift-ui-font` on <html>, and the rule
   * that serves it declares on <body>, so the public page used to change face
   * with an in-app preference. Brand type is not a user preference. Declaring
   * the family here (inline style, so nothing outranks it) pins every public
   * surface to the product's own face regardless of that setting — and
   * `font-family` has to be set alongside the token, because <body> already
   * resolved its own value and children inherit the computed result.
   *
   * That face is the platform UI font, the same one the signed-in workspace
   * runs on: the site and the app are one product, and a visitor who signs up
   * should not watch the typeface change underneath them.
   */
  "--font-cursor-ui": '-apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, system-ui, sans-serif',
  "--font-display": '-apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, system-ui, sans-serif',
  "--font-sans": '-apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, system-ui, sans-serif',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, system-ui, sans-serif',

  "--background": "#000000",
  "--foreground": "#f5f5f5",
  "--surface": "#0a0a0a",
  /**
   * Hairlines, measured against the reference.
   *
   * Axiom draws every card border at rgb(17,17,17) on a #060606 ground — barely
   * a line. Ours sat at #1c1c1c on #000, nearly twice the step, which is why a
   * page of cards read as a page of boxes. The border is meant to separate two
   * surfaces, not to draw a rectangle around each one.
   */
  "--border": "#141414",
  "--border-strong": "#242424",
  "--muted-foreground": "#8f8f8f",
  "--cursor-text-secondary": "#9a9a9a",
  /**
   * One warm accent, used sparingly.
   *
   * The old value was a cold blue, which is the default of the category rather
   * than a choice: Bolt is blue, and every AI builder template ships blue. The
   * pages that read as expensive each commit to a temperature — Axiom warm
   * orange on neutral black, Linear cool near-black, Cursor a black that is
   * quietly yellow — and none of them is blue. Amber also agrees with the
   * brushed-steel plate the hero is built on, which blue was fighting.
   */
  "--primary": "#d98330",
  "--signal-bright": "#d98330",
  colorScheme: "dark",
} as CSSProperties;
