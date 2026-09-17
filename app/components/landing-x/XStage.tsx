"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The product, on a stage.
 *
 * ── The problem this solves ──
 *
 * The surfaces below are the real application, and the frame they were in was
 * a hairline box the width of the text column. Two things went wrong with
 * that, and the second is the one that matters:
 *
 *  1. The Hack Workbench draws its own scene and its own panel, so a bordered
 *     box around it produced a box inside a box inside a box.
 *  2. More importantly, the app *reflowed into the box*. RiftMiniApp and
 *     HackWorkbenchMini are laid out for a desktop — a 204px rail, a 310px
 *     activity column, a four-up metric strip — and squeezing them into a
 *     1200px marketing column collapsed all of it. What a visitor saw was not
 *     the product at a smaller size, it was a *different, worse layout* of the
 *     product that no signed-in user will ever see.
 *
 * ── The system, measured off gumloop.com on 26 Aug 2026 ──
 *
 * Their answer is the right one and it is three elements:
 *
 *     stage    aspect-[1440/900] · tinted ground · rounded · overflow-clip
 *     scaler   absolute top-0 left-0 origin-top-left · 1440×900 · scale(k)
 *     window   absolute inset · rounded · floating shadow · overflow-hidden
 *
 * The app is authored at a fixed 1440×900 and the whole thing is scaled by
 * `containerWidth / 1440` from the top-left corner. Measured on their hero:
 * a 1354px container carrying `matrix(0.940278, …)`, which is 1354/1440
 * exactly. Nothing inside ever reflows — every breakpoint the app has stays on
 * its desktop side, and the reader sees the real layout, just smaller.
 *
 * Their window sits at `top-10 right-10 bottom-32 left-48` inside that box —
 * 40/40/128/192 — deliberately asymmetric, pushed right and lifted off the
 * floor so it reads as an object placed on a surface rather than a screenshot
 * pasted into a div.
 *
 * ── Where this departs from them ──
 *
 * Their stage is a light tint holding a white app. Ours is the same light tint
 * holding a true-black one, which is a stronger figure/ground split and the
 * thing the rest of this page already does with its photography.
 *
 * And their `max-sm:pointer-events-none` turns the app into a picture on small
 * screens. That is copied, and it is not a compromise: below ~640px the scale
 * is under 0.45 and every control is smaller than a fingertip, so leaving it
 * live would offer an interaction that cannot succeed. The affordance line
 * above the stage is what tells a reader it is usable, and it is only shown
 * where it is true.
 */

/**
 * The width every surface inside a stage is authored for.
 *
 * The reference pins `1440/900` for both axes because every one of its stages
 * holds the same rebuilt screenshot. Ours hold three different *live* surfaces
 * whose natural heights differ by hundreds of pixels — 392, 583 and 904
 * measured — so the height is a prop rather than a constant.
 *
 * It is a prop and not a measurement, which is the important part. Driving the
 * height off the content made the window grow as a run streamed into it: a
 * visitor typed a task, the plan and the answer arrived, and the stage got
 * taller and pushed the rest of the page down under their cursor. A window
 * that resizes while you are reading it is worse than one with a little air at
 * the bottom, so each surface declares a height that holds its fullest state
 * and keeps it.
 */
const AUTHORED_W = 1440;

/** The window's own title bar, in authored pixels. macOS's number. */
const TITLE_BAR_H = 36;

/**
 * The window's inset inside the authored box, in authored pixels.
 *
 * Less asymmetric than the reference's. Theirs pushes the window 192px right
 * to slide a sidebar off the left edge, which is a composition built around
 * one specific screenshot; ours holds three different surfaces and a shared
 * offset that flatters one would crop another. The bottom is still the deepest
 * side — that is what lifts the window off the floor.
 */
const INSET = { top: 40, right: 40, bottom: 64, left: 40 } as const;

/** macOS, actual values — not approximations of them. */
const LIGHTS = ["#ff5f57", "#febc2e", "#28c840"] as const;

/** Below this the scale is under ~0.45 and nothing is tappable. */
const INTERACTIVE_MIN_PX = 640;

export function XStage({
  children,
  /** Shown in the window's title bar, the way a real window titles itself. */
  title,
  /**
   * The stage's height in authored pixels, insets included.
   *
   * Pick it from the surface's fullest state with a little headroom, not from
   * its resting one — the resting height is what a visitor sees for the first
   * two seconds and the full height is what they see for the rest of the
   * visit.
   */
  height,
}: {
  children: ReactNode;
  title: string;
  height: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [interactive, setInteractive] = useState(true);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const measure = () => {
      const width = host.clientWidth;
      if (!width) return;
      setScale(width / AUTHORED_W);
      setInteractive(width >= INTERACTIVE_MIN_PX);
    };

    measure();
    // ResizeObserver rather than a window listener: the stage's width is set by
    // the container's padding, which changes at breakpoints the window itself
    // never fires for. Only the width is observed — the height is fixed by the
    // caller and nothing inside is allowed to move it.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const windowH = height - INSET.top - INSET.bottom;

  return (
    <div
      ref={hostRef}
      // Capped rather than full-bleed: at 1440 the app filled the whole
      // measure and dwarfed the copy beside it. 1180 keeps it the largest
      // object on the page without it becoming the page.
      className="relative isolate mx-auto w-full max-w-[1180px] overflow-clip rounded-[20px] border-[0.5px] border-[var(--x-line)] bg-[var(--x-raise)] md:rounded-[24px]"
      style={{ aspectRatio: `${AUTHORED_W} / ${height}` }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          width: AUTHORED_W,
          height,
          transform: `scale(${scale})`,
          // Below the interactive floor the surface is a picture. `inert` as
          // well as pointer-events, so a keyboard cannot tab into controls
          // that are 6px tall.
          pointerEvents: interactive ? undefined : "none",
        }}
        {...(interactive ? {} : { inert: true })}
      >
        <div
          className="absolute overflow-hidden rounded-[10px] bg-[#000000] shadow-[0_2px_4px_rgba(0,0,0,0.06),0_12px_24px_-8px_rgba(0,0,0,0.18),0_48px_80px_-32px_rgba(0,0,0,0.28)]"
          style={{
            top: INSET.top,
            right: INSET.right,
            left: INSET.left,
            height: windowH,
          }}
        >
          {/*
           * The title bar.
           *
           * 36 authored pixels, which is macOS's own. The lights are decorative
           * and are marked so — they are the grammar that says "this is a
           * window", not controls, and a screen reader announcing three
           * unlabelled buttons here would be describing something that is not
           * there.
           */}
          <div
            className="flex shrink-0 items-center gap-2 border-b border-b-white/[0.07] px-4"
            style={{ height: TITLE_BAR_H }}
          >
            <span aria-hidden className="flex items-center gap-2">
              {LIGHTS.map((colour) => (
                <span
                  key={colour}
                  className="block size-[10px] rounded-full"
                  style={{ backgroundColor: colour }}
                />
              ))}
            </span>
            <span className="ml-2 truncate font-mono text-[11px] tracking-[0.02em] text-white/40">
              {title}
            </span>
          </div>

          {/*
           * The surface fills what is left and clips, exactly as the
           * reference's does. Nothing inside is asked to be responsive.
           *
           * A fixed box that clips. The surfaces manage their own internal
           * scrolling, so a second scrollbar here would be one too many — and
           * clipping is what a window does when its content outgrows it.
           */}
          <div
            className="w-full overflow-hidden"
            style={{ height: windowH - TITLE_BAR_H }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
