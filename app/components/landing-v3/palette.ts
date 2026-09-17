import type { CSSProperties } from "react";

/**
 * A quiet, warm ground.
 *
 * v2 sits on OLED black with a cool blue accent. This treatment keeps the
 * accent but warms and lifts the ground a little, the way the products this
 * page sits beside do — pure #000 reads as a void on a large display, while a
 * warm near-black reads as paper. Every section below the hero is v2's own
 * component, so redefining these tokens restyles the whole page without
 * touching a single section.
 *
 * Opaque on purpose. The 3D lives in the hero and nowhere else; sections that
 * let a scene show through were the thing that never quite worked.
 */
export const WORLD_PALETTE = {
  "--background": "#0d0c0b",
  "--foreground": "#f2f0ee",
  "--surface": "#141312",
  "--border": "#221f1d",
  "--border-strong": "#332f2c",
  "--muted-foreground": "#8f8a85",
  "--cursor-text-secondary": "#a09a94",
  "--primary": "#d98330",
  "--signal-bright": "#d98330",
  colorScheme: "dark",
} as CSSProperties;
