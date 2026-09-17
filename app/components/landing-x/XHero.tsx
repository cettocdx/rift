"use client";

import { useEffect, useRef, useState } from "react";

import dynamic from "next/dynamic";

// three.js is ~150KB. It has no business in the first payload of a cold-traffic
// landing page for a decorative, aria-hidden background, so XGlobe is split out
// and loaded after mount. ssr:false because it needs WebGL and paints nothing
// meaningful on the server anyway; the card it sits in has its own dark ground,
// so there is no flash and no layout shift when it arrives.
const XGlobe = dynamic(() => import("./XGlobe").then((m) => m.XGlobe), {
  ssr: false,
});
import { XMediaCard } from "./x-pieces";
import {
  X_BTN_FILLED,
  X_BTN_GHOST,
  X_CONTAINER,
  X_DISPLAY,
  X_LEDE,
  X_SMALL,
} from "./x-system";

/**
 * The fold.
 *
 * ── The shape, rebuilt ──
 *
 * This used to be type floating in the middle of a full-bleed three.js globe
 * with two radial washes fighting to keep the headline legible. On paper that
 * construction has nowhere to go: you cannot wash a light ground over a dark
 * render without turning the render to mud.
 *
 * orchid.ai solves the same problem by refusing it. Its fold is a headline, a
 * line under it and one small button on bare paper — nothing else in the
 * viewport — and the product only appears *after* the fold, as a single large
 * object in its own rounded frame. Two things follow from that and both are
 * worth having: the headline is never competing with an image for contrast,
 * and the image gets to be a real photograph rather than a background.
 *
 * So the globe did not get deleted, it got framed. It is the same render, in
 * the reference's media card, immediately under the type.
 *
 * ── The device being kept ──
 *
 * `Give it the work. Get it ____.` with the last word replaced by a ruled
 * blank that fills itself, one past participle after another. The sentence is
 * a *claim about breadth*, and a blank that keeps being filled proves breadth
 * in a way a list of six nouns never does — a reader watches three verbs go by
 * and supplies the fourth themselves.
 *
 * The blank is a fixed-width ruled slot rather than text that reflows. Letting
 * the headline re-wrap on every word is the version of this device that makes
 * a page feel broken; the rule holds the line still and turns the change into
 * an event inside it.
 */

const VERBS = [
  "shipped",
  "debugged",
  "refactored",
  "rendered",
  "tested",
  "verified",
] as const;

/** Long enough to read, short enough that a reader sees three without waiting. */
const HOLD_MS = 1900;

function FillingBlank() {
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const clear = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };

    if (reduced) {
      // Settled, not animated. Scheduled rather than written in the effect
      // body, which this repo lints against.
      timers.current.push(setTimeout(() => setShown(true), 0));
      return clear;
    }

    // In, hold, out, next. Scheduled so nothing is set synchronously.
    timers.current.push(setTimeout(() => setShown(true), 60));
    timers.current.push(setTimeout(() => setShown(false), HOLD_MS));
    timers.current.push(
      setTimeout(() => {
        setIndex((current) => (current + 1) % VERBS.length);
      }, HOLD_MS + 320),
    );
    return clear;
  }, [index]);

  return (
    <span className="relative inline-block align-baseline">
      {/* The slot is sized by the longest verb so the rule never resizes. */}
      <span aria-hidden className="invisible whitespace-pre">
        refactored
      </span>
      {/*
       * The rule sits lower and finer than it did on the dark page. A 2px bar
       * under a 500-weight grotesk read as an underline; under a serif at
       * -0.04em it reads as a correction, so it is 1.5px and dropped clear of
       * the descender line the serif actually uses.
       */}
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-[0.1em] h-[1.5px] bg-[var(--x-ink-30)]"
      />
      {/* aria-hidden. Without it assistive technology reads the visible verb
          and then the full list immediately after it — "…get it shipped
          shipped, debugged, refactored…" — because both live inside the same
          element. */}
      <span
        aria-hidden
        className={`absolute inset-0 flex items-baseline justify-center transition-[opacity,transform,filter] duration-300 motion-reduce:transition-none ${
          shown
            ? "translate-y-0 opacity-100 blur-0"
            : "translate-y-[0.16em] opacity-0 blur-[2px]"
        }`}
        style={{
          // Enter on ease-out (arrives, settles); leave on ease-in
          // (accelerates away). One curve for both made the exiting word
          // decelerate as it left, which reads backwards.
          transitionTimingFunction: shown
            ? "cubic-bezier(0.16,1,0.3,1)"
            : "cubic-bezier(0.4,0,1,1)",
        }}
      >
        {VERBS[index]}
      </span>
      {/* One accessible copy of the whole claim, so a screen reader is not
          read a headline with a hole in it. */}
      <span className="sr-only">
        shipped, debugged, refactored, rendered, tested and verified
      </span>
    </span>
  );
}

export function XHero() {
  return (
    <section id="top" className="relative isolate">
      <div
        className={`${X_CONTAINER} flex min-h-[74svh] flex-col items-center justify-center pb-14 pt-32 text-center`}
      >
        {/*
         * A chip, kept — but the reference's chip, not the previous one.
         *
         * orchid.ai has exactly one of these on the page: a small pill holding
         * a state word and a label, no border, no arrow, sitting on the raise
         * colour. What it announces here is the thing the rest of the page is
         * about, which is where the reference puts its own.
         */}
        <a
          href="#build"
          className="mb-8 inline-flex items-center gap-2.5 rounded-full bg-[var(--x-raise)] py-1.5 pl-1.5 pr-4 transition-colors hover:bg-[var(--x-raise-strong)] motion-reduce:transition-none"
        >
          <span className="shrink-0 whitespace-nowrap rounded-full bg-[var(--x-ink)] px-2.5 py-1 font-mono text-[11px] font-normal uppercase tracking-[0.06em] text-[var(--x-ground)]">
            How it works
          </span>
          {/* The full claim is three lines inside a pill at 390px, which
              reads as a paragraph that happens to be round. The short form
              carries the same promise in one line. */}
          <span className={`${X_SMALL} font-normal text-[var(--x-ink-80)]`}>
            <span className="sm:hidden">Real machine, real terminal</span>
            <span className="hidden sm:inline">
              Real machine, real terminal, proved before it says done
            </span>
          </span>
        </a>

        {/*
         * "One workstation" was the first draft and a review took it apart:
         * workstation names a piece of furniture, and the paragraph under it
         * closed on billing. What replaces both is the one thing here that a
         * wrapper cannot copy — the work is done on a real machine and proved
         * before it is handed back.
         *
         * `max-w-[min(92vw,760px)]`, the reference's own hero measure, rather
         * than a `ch` count: a serif at -0.04em and a grotesk disagree about
         * the width of a character by enough that a 15ch cap set for one
         * breaks the line count of the other.
         */}
        <h1
          className={`${X_DISPLAY} max-w-[min(92vw,760px)] text-balance text-[var(--x-ink)]`}
        >
          Give it the work. Get it <FillingBlank />.
        </h1>

        <p className={`${X_LEDE} mt-7 max-w-[min(92vw,560px)] text-balance`}>
          RIFT runs a frontier agent on a real machine — filesystem, package
          manager, terminal — and does not say done until it has built and run
          the work. Every run shows what it did and what it cost.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          {/* /signup, not /login. "Start building" is the primary call on a
              page whose traffic is cold; sending a first-time visitor to a
              password field is the cheapest conversion loss on the page. */}
          <a href="/signup" className={X_BTN_FILLED}>
            Start building
            <span aria-hidden>›</span>
          </a>
          <a href="#build" className={X_BTN_GHOST}>
            See it run
          </a>
        </div>
      </div>

      {/*
       * The object under the fold.
       *
       * A sphere with traffic arcing over it, cropped so its centre sits below
       * the frame — a whole planet centred in a card reads as a logo; a
       * fragment of one reads as a photograph taken from somewhere. It says
       * "work handed to a machine elsewhere and returned finished" with no
       * caption, which is the only job it has.
       *
       * Grain at full strength here rather than the 0.18 default: this is a
       * live WebGL render rather than a photograph, and it is the one image on
       * the page with no film in its history to hide the banding across the
       * atmosphere.
       */}
      <div className={X_CONTAINER}>
        <XMediaCard grain={0.24} className="aspect-[4/3] sm:aspect-[16/9] lg:aspect-[21/9]">
          <XGlobe className="absolute inset-0 size-full" />
          {/* A short foot-fade into the card's own ground, so the globe reads
              as sitting in the frame rather than cropped by it. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-[linear-gradient(to_top,var(--x-well),transparent)]"
          />
        </XMediaCard>
      </div>
    </section>
  );
}
