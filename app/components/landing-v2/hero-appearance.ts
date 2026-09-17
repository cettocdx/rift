import type { CSSProperties } from "react";

import { APPEARANCE_PRESETS } from "@/lib/appearance/presets";

/**
 * The product's OLED palette, applied to the hero's replica of the workspace.
 *
 * The app paints its chrome from `--rift-appearance-*`, but those tokens are
 * installed at runtime and scoped to `[data-rift-workspace]` — neither of which
 * exists on a marketing page. Without them the replica fell back to the default
 * dark theme, whose sidebar is `#2b373e`: a blue-grey nothing in the product is
 * ever painted with, on a page whose whole claim is that this is the real
 * interface.
 *
 * Attaching `data-rift-workspace` would have been the shortcut, but the app's
 * selector list includes `body:has([data-rift-workspace])`, so it would have
 * repainted the entire landing page. Instead the same derivations are rebuilt
 * here, from the same preset constants the product ships, and scoped to the
 * frame.
 *
 * The mixes below mirror app/globals.css exactly. If a derivation changes
 * there, change it here — the contract test in
 * app/components/landing-v2/__tests__ compares the two.
 */

const OLED = APPEARANCE_PRESETS.find((preset) => preset.id === "oled");

if (!OLED) {
  throw new Error("OLED appearance preset is missing");
}

const { accent, background, foreground, sidebar, surface, border } = OLED.dark;

/** `color-mix(in srgb, a P%, b)`, written the way globals.css writes it. */
const mix = (a: string, percent: number, b: string) =>
  `color-mix(in srgb, ${a} ${percent}%, ${b})`;

export const HERO_WORKSPACE_APPEARANCE = {
  "--background": background,
  "--foreground": foreground,
  "--card": background,
  "--card-foreground": foreground,
  "--popover": mix(background, 94, foreground),
  "--popover-foreground": foreground,
  "--primary": accent,
  "--secondary": surface,
  "--secondary-foreground": foreground,
  "--muted": surface,
  "--muted-foreground": mix(foreground, 84, background),
  "--accent": mix(foreground, 7, background),
  "--accent-foreground": foreground,
  "--border": border,
  "--input": mix(border, 68, foreground),
  "--ring": accent,

  "--sidebar": sidebar,
  "--sidebar-foreground": foreground,
  "--sidebar-primary": accent,
  "--sidebar-accent": mix(foreground, 6, sidebar),
  "--sidebar-accent-foreground": foreground,
  "--sidebar-border": border,
  "--sidebar-ring": accent,

  "--cursor-text-primary": foreground,
  "--cursor-text-secondary": mix(foreground, 84, background),
  "--cursor-text-tertiary": mix(foreground, 82, background),
  "--cursor-text-quaternary": mix(foreground, 36, background),
  "--cursor-icon-secondary": mix(foreground, 66, sidebar),

  "--signal": accent,
  "--signal-bright": mix(accent, 72, foreground),
  "--surface-1": background,
  "--surface-2": surface,
} as CSSProperties;

/** Exported for the contract test, so the palette cannot drift from the preset. */
export const HERO_WORKSPACE_PALETTE = OLED.dark;
