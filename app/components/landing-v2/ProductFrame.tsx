"use client";

import { motion, useReducedMotion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";

import { useLandingScrollContainer } from "./LandingShell";
import { DURATION, EASE_OUT, MICRO } from "./landing-design-system";

/**
 * The box a running product sits in.
 *
 * Three of the pages this one is measured against present their product the
 * same way, and none of them just drop a screenshot onto the page:
 *
 *   databuddy.cc  tabs welded to the frame's top edge, active tab joined to
 *                 the panel below it, one border around the whole assembly
 *   tempo.new     the app inset on a saturated mat, generous padding, so the
 *                 screen reads as a screen rather than as page content
 *   mintlify.com  the panel bleeds off the right edge, which makes the page
 *                 feel larger than the window
 *
 * The shared idea is that the product needs an *edge*. Without one it reads as
 * more page, and the reader never registers that they are looking at software.
 *
 * ── Why the frame carries its own colours ──
 *
 * Everything inside is painted from the application's real appearance preset
 * rather than from the landing's palette. The two are deliberately different:
 * the frame sits a step darker than the page and reads as a lit screen on a
 * surface. Inheriting the landing tokens made the frame the same material as
 * the page around it, which is exactly the thing that stopped it looking like
 * a product.
 *
 * ── The preset this pins, and why it changed ──
 *
 * It was "cursor" (Graphite, #141414) and the comment here asserted that is
 * "what `applyAppearance` writes for a signed-out visitor's first session".
 * That stopped being true: lib/appearance/presets.ts now ends with
 *
 *     dark: presetMode("oled", "dark")
 *
 * so the product's dark default is OLED — true black, an amber accent, a
 * sidebar one step above the ground. The frame was showing a theme the app no
 * longer opens in, which is the one thing this component exists not to do.
 *
 * ── Why the derived values are computed rather than eyeballed ──
 *
 * app/globals.css builds every chrome token from the preset's six with
 * `color-mix(in srgb, …)`. The previous set was worked out by eye and three
 * were wrong by a lot. These were computed from the stylesheet's own
 * percentages, listed beside each value so the next change can be checked
 * rather than re-guessed.
 *
 * `--card` is not in that list on purpose: globals defines it once under
 * `.dark` at #1c1c1c and never derives it from the preset, so it is the same
 * on every theme and is copied as-is.
 */
export const APP_TOKENS = {
  /*
   * The six the preset defines, verbatim from lib/appearance/presets.ts —
   * the "oled" dark theme, which is what `applyAppearance` writes for a
   * signed-out visitor's first session.
   *
   * The foreground is #f5f5f5 rather than #ffffff and that is the preset's own
   * decision, not a rounding: at full white on true black an OLED panel blooms
   * and text edges smear on scroll. It still measures 19.3:1.
   */
  "--background": "#000000",
  "--foreground": "#f5f5f5",
  "--sidebar": "#0a0a0a",
  "--surface": "#101010",
  "--border": "#242424",
  "--accent": "#d98330",

  /*
   * The rest, computed with the product's own formulas rather than guessed.
   *
   * app/globals.css derives every chrome token from those six with
   * `color-mix(in srgb, ...)`, and the first version of this block eyeballed
   * them. Three were wrong by a lot: secondary text was #9a9a9a against the
   * product's #cdcdcd, tertiary #6f6f6f against #c8c8c8, and the sidebar ring
   * was a grey when the product uses the accent. Working them out from the
   * same percentages the stylesheet uses is the only way this frame stays the
   * product rather than an impression of it.
   *
   *   --cursor-text-secondary   foreground 84% + background
   *   --cursor-text-tertiary    foreground 82% + background
   *   --cursor-text-quaternary  foreground 36% + background
   *   --cursor-icon-secondary   foreground 66% + sidebar
   *   --sidebar-accent          foreground  6% + sidebar
   *   --border-strong           border     72% + foreground
   *   --popover                 background 94% + foreground
   */
  "--cursor-text-secondary": "#cecece", // fg 84% + bg
  "--cursor-text-tertiary": "#c9c9c9", // fg 82% + bg
  "--cursor-text-quaternary": "#585858", // fg 36% + bg
  "--cursor-icon-secondary": "#a5a5a5", // fg 66% + sidebar
  "--muted-foreground": "#cecece", // = cursor-text-secondary
  "--sidebar-foreground": "#f5f5f5", // = foreground
  "--sidebar-border": "#242424", // = border
  "--sidebar-accent": "#181818", // fg 6% + sidebar
  "--sidebar-accent-foreground": "#f5f5f5", // = foreground
  "--sidebar-ring": "#d98330", // = accent
  "--border-strong": "#5f5f5f", // border 72% + fg
  "--card": "#1c1c1c", // .dark literal, preset-independent
  "--popover": "#0f0f0f", // bg 94% + fg
  colorScheme: "dark",
} as CSSProperties;

export type FrameTab = {
  id: string;
  label: string;
};

/**
 * Tabs welded to the top edge, databuddy's arrangement.
 *
 * The active tab shares its bottom edge with the panel — no gap, no separate
 * border — so the two read as one object rather than as a control above a
 * picture. That join is the whole trick, and it is why the tab strip sits
 * inside the frame's border box instead of floating above it.
 */
function FrameTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: readonly FrameTab[];
  active: string;
  onSelect: (id: string) => void;
}) {
  const reduceMotion = useReducedMotion() ?? false;

  return (
    <div
      role="tablist"
      aria-label="Product surfaces"
      // Scrolls rather than wraps on a phone: a wrapped tab strip changes the
      // frame's height as the reader switches, which moves the product under
      // their eyes for no reason.
      className="flex gap-1 overflow-x-auto px-2 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(tab.id)}
            className={`relative shrink-0 rounded-t-[6px] px-3.5 py-2 text-[13px] transition-colors duration-150 focus-visible:outline-none motion-reduce:transition-none ${
              selected
                ? "text-[var(--foreground)]"
                : "text-[var(--cursor-text-secondary)] hover:text-[var(--foreground)]"
            }`}
          >
            {/* The plate and its underline travel between tabs rather than
                switching off here and on there. One shared layoutId is the
                whole reason the strip reads as a physical control instead of
                as six buttons. Critically damped, 0.4s — Apple's own numbers
                for a reposition, and no overshoot because no gesture carried
                momentum into it. */}
            {selected && (
              <>
                <motion.span
                  layoutId="product-frame-tab-plate"
                  aria-hidden
                  className="absolute inset-0 rounded-t-[6px] bg-[var(--surface)]"
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { type: "spring", bounce: 0, duration: 0.4 }
                  }
                />
                <motion.span
                  layoutId="product-frame-tab-edge"
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 h-[1.5px] bg-[var(--foreground)]"
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { type: "spring", bounce: 0, duration: 0.4 }
                  }
                />
              </>
            )}
            <span className="relative">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The frame: a caption, an optional tab strip, and the screen.
 *
 * The caption sits above rather than below. A reader meets the largest object
 * on the page before any words explaining it, and "is this a picture or is it
 * running?" is the one question the page cannot afford to leave open.
 */
export function ProductFrame({
  caption,
  note,
  tabs,
  active,
  onSelect,
  children,
  className = "",
  variant = "mat",
}: {
  caption: string;
  note?: string;
  tabs?: readonly FrameTab[];
  active?: string;
  onSelect?: (id: string) => void;
  children: ReactNode;
  className?: string;
  /**
   * "mat" is this page's presentation: a lit, rounded panel with the caption
   * above it. "bare" hands the screen over with no chrome of its own, for a
   * host that already provides the frame — the parallel landing at
   * /landing/pi draws every cell itself, with a square hairline and a figure
   * label on the rule, and a rounded mat inside a square cell reads as two
   * frames arguing.
   */
  variant?: "mat" | "bare";
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const scrollContainer = useLandingScrollContainer();
  const tabStrip =
    tabs && tabs.length > 0 && active && onSelect ? (
      <div className="border-b border-[var(--border)] bg-[var(--sidebar)]">
        <FrameTabs tabs={tabs} active={active} onSelect={onSelect} />
      </div>
    ) : null;

  if (variant === "bare") {
    return (
      <div
        style={APP_TOKENS}
        className={`bg-[var(--background)] text-[var(--foreground)] ${className}`}
      >
        {tabStrip}
        {children}
      </div>
    );
  }

  return (
    <div className={className}>
      <p className={`mb-3 ${MICRO}`}>{caption}</p>

      {/*
       * The mat. tempo insets its product on a lit panel with real padding,
       * which is what separates "a screen on a surface" from "an image pasted
       * onto a page". Ours is a light rather than a colour — a wash from the
       * top-left at a few percent — because this page carries no accent hue and
       * a saturated mat would be the only colour on it.
       */}
      <motion.div
        initial={
          reduceMotion
            ? false
            : { opacity: 0, scale: 0.985, filter: "blur(6px)" }
        }
        whileInView={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
        // `root` is not optional here. This page scrolls inside its own
        // element rather than the window, so an observer left on the default
        // root watches a scroller that never moves — and with `once: true` the
        // miss is permanent. A frame below the fold would sit at opacity 0
        // forever, which is exactly the failure this page shipped with once
        // already.
        viewport={{
          once: true,
          root: scrollContainer ?? undefined,
          amount: 0.15,
        }}
        transition={{ duration: DURATION.settle, ease: EASE_OUT }}
        className="rounded-[12px] border border-border bg-[linear-gradient(160deg,rgba(244,241,236,0.11)_0%,rgba(244,241,236,0.045)_26%,rgba(244,241,236,0.015)_58%,rgba(244,241,236,0.05)_100%)] p-1.5 sm:p-2.5"
      >
        <div
          style={APP_TOKENS}
          className="overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)]"
        >
          {tabStrip}
          {children}
        </div>
      </motion.div>

      {note ? <p className={`mt-3 ${MICRO}`}>{note}</p> : null}
    </div>
  );
}
