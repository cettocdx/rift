"use client";

import type { ReactNode } from "react";

import { useInViewOnce } from "./use-in-view";

import {
  BODY_CLASS,
  CONTAINER_CLASS,
  MICRO_LABEL_CLASS,
  SECTION_HEADING_CLASS,
  SECTION_RHYTHM_CLASS,
} from "./type-scale";

/**
 * One reveal for the whole page, so every section arrives the same way.
 *
 * Deliberately almost nothing. The reference page we studied has no generic
 * section reveal at all — measured across its whole document, the largest
 * translate on any entering element is 6px, and most sections simply exist.
 * Our first pass rose 22px over 650ms, which on a long page means the reader
 * spends the scroll waiting for text to stop moving before they can read it.
 *
 * So this is now a 6px settle over 380ms: enough to register as arrival,
 * short enough that the content is readable the moment it is on screen.
 * `once` keeps the page from re-animating on the way back up.
 */

/**
 * The reveal's easing and stagger, as classes.
 *
 * Written out in full rather than interpolated: Tailwind scans source text, so
 * `delay-[${n}ms]` produces no CSS at all and the stagger silently does
 * nothing. Sixty milliseconds a step, twelve steps — longer than any sequence
 * on this page.
 */
const REVEAL_EASE = "ease-[cubic-bezier(0.23,1,0.32,1)]";
const REVEAL_DELAYS = [
  "delay-0",
  "delay-[60ms]",
  "delay-[120ms]",
  "delay-[180ms]",
  "delay-[240ms]",
  "delay-[300ms]",
  "delay-[360ms]",
  "delay-[420ms]",
  "delay-[480ms]",
  "delay-[540ms]",
  "delay-[600ms]",
  "delay-[660ms]",
] as const;

/**
 * The word stagger: 34ms a step, up to twenty words.
 *
 * A separate table from the section delays because the steps are much finer —
 * at 34ms a seven-word heading is fully settled 200ms after the first word
 * lands, so the eye tracks one wave across the line instead of counting words.
 * Wider spacing here is exactly how this device turns into the cliche it is
 * often used as.
 */
const WORD_DELAYS = [
  "delay-0",
  "delay-[34ms]",
  "delay-[68ms]",
  "delay-[102ms]",
  "delay-[136ms]",
  "delay-[170ms]",
  "delay-[204ms]",
  "delay-[238ms]",
  "delay-[272ms]",
  "delay-[306ms]",
  "delay-[340ms]",
  "delay-[374ms]",
  "delay-[408ms]",
  "delay-[442ms]",
  "delay-[476ms]",
  "delay-[510ms]",
  "delay-[544ms]",
  "delay-[578ms]",
  "delay-[612ms]",
  "delay-[646ms]",
] as const;

/** The heading's own base delay, folded into the per-word step. */
const wordDelay = (base: number, index: number) =>
  WORD_DELAYS[
    Math.min(
      Math.max(Math.round(base / 0.034) + index, 0),
      WORD_DELAYS.length - 1,
    )
  ];

/** Seconds in, class out — call sites keep passing durations. */
const delayClass = (seconds: number) =>
  REVEAL_DELAYS[
    Math.min(Math.max(Math.round(seconds / 0.06), 0), REVEAL_DELAYS.length - 1)
  ];

/**
 * ── Why this is CSS and not Motion ──
 *
 * It was a `motion.div` with `whileInView`, and it had two faults that only
 * show up in the two situations nobody tests.
 *
 * The first is that it failed *closed*. `whileInView` with `once` has no
 * backstop: if the observer never reports — a restored bfcache page, a tab
 * that was backgrounded at load, a browser that throttles it — the element
 * stays at `opacity: 0` permanently. Not degraded, gone. Reviewing this page
 * in a backgrounded tab, the hero's input and the whole product frame below it
 * sat invisible, and it looked like a rendering bug rather than an animation
 * that had not been told to start.
 *
 * The second is that it branched on `useReducedMotion()` to decide what to
 * render. A server cannot answer that question; Motion picks one answer there
 * and the browser picks the other, and React reports a hydration mismatch for
 * every element whose markup depended on it.
 *
 * A class-driven transition has neither problem. The markup is identical on
 * both sides of hydration, the shared `useInViewOnce` hook carries a fail-open
 * timer so nothing can be stranded, and the reduced-motion preference is
 * answered by a media query in globals — in the one place that can actually
 * see it.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const [ref, seen] = useInViewOnce<HTMLDivElement>(0.01);

  return (
    <div
      ref={ref}
      data-landing-reveal
      className={`${className ?? ""} transition-[opacity,transform] duration-[380ms] ${REVEAL_EASE} ${delayClass(
        delay,
      )} ${seen ? "translate-y-0 opacity-100" : "translate-y-[6px] opacity-0"}`}
    >
      {children}
    </div>
  );
}

/**
 * A heading that arrives a word at a time.
 *
 * Every section on this page entered identically — one 6px rise, 380ms, the
 * same for the eyebrow, the heading and the lede — which is why the page had
 * no moment anywhere in it. This is the one place worth spending a real
 * entrance: the heading is the first thing read in a section, it is large
 * enough for the motion to register, and a line that assembles reads as
 * *being written*, which is what this product does.
 *
 * Deliberately restrained so it stays a flowing line rather than words popping
 * in one by one: 12px, 0.5s, and a 34ms step. At that spacing a seven-word
 * heading is fully settled 200ms after the first word lands, so the eye tracks
 * one wave across the line instead of counting words. Bigger numbers here are
 * exactly how this device turns into the cliché it is often used as.
 *
 * Word-level `<span>`s with explicit spaces between them: joining on a space
 * inside the span would let a line break fall mid-gap and lose it.
 */
function WordsRise({
  text,
  className,
  delay = 0,
}: {
  text: string;
  className?: string;
  delay?: number;
}) {
  const [ref, seen] = useInViewOnce<HTMLHeadingElement>(0.01);
  const words = text.split(" ");

  return (
    <h2 ref={ref} data-landing-reveal className={className}>
      {words.map((word, index) => (
        <span
          key={`${word}-${index}`}
          // The clip is what makes it read as words rising out of the line
          // rather than sliding around loose on the page.
          className="inline-block overflow-hidden align-bottom"
        >
          <span
            className={`inline-block transition-[opacity,transform] duration-500 ${REVEAL_EASE} ${wordDelay(
              delay,
              index,
            )} ${
              seen
                ? "translate-y-0 opacity-100"
                : "translate-y-[0.42em] opacity-0"
            }`}
          >
            {word}
          </span>
          {index < words.length - 1 ? " " : null}
        </span>
      ))}
    </h2>
  );
}

/** Section shell: consistent rhythm, one eyebrow/heading/lede pattern. */
export function Section({
  id,
  eyebrow,
  title,
  lede,
  children,
  className = "",
}: {
  id?: string;
  eyebrow: string;
  title: string;
  lede?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`${CONTAINER_CLASS} scroll-mt-24 ${SECTION_RHYTHM_CLASS} ${className}`}
    >
      <Reveal>
        <p className={MICRO_LABEL_CLASS}>{eyebrow}</p>
      </Reveal>
      <WordsRise
        text={title}
        delay={0.06}
        className={`mt-4 max-w-[20ch] text-foreground ${SECTION_HEADING_CLASS}`}
      />
      {lede ? (
        <Reveal delay={0.18}>
          <p className={`mt-5 max-w-[60ch] ${BODY_CLASS}`}>{lede}</p>
        </Reveal>
      ) : null}
      {children}
    </section>
  );
}
