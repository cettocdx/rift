"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { PiDotField } from "./PiDotField";
import { PI_CONTAINER, PI_DISPLAY, PI_INDEX, PI_LABEL } from "./pi-system";

/**
 * The fold, built to primeintellect.ai's arrangement.
 *
 * Theirs: a full-bleed cinematic backdrop, the copy bottom-left over it, a
 * mono eyebrow above a 36px headline, two square buttons, a live typing
 * terminal beneath them, and a row of backer names bottom-right. Nothing is
 * centred and nothing is large.
 *
 * ── About the backdrop, and a correction ──
 *
 * The first version of this file called their hero a photograph. It is not.
 * Measured live on 21 Aug 2026 it is a video:
 *
 *   /backgrounds/pi-glass-loop-prod.webm   1920x1080 natural, 20.5s, looped,
 *                                          muted, autoplay, object-fit cover,
 *                                          object-position 62% 66%
 *
 * That matters because of what is *in* it. The setting is a jungle gorge, but
 * the subject is a composited slab of lit glass standing on an island in the
 * water, and it is the only light source in the frame. Nature is the stage;
 * the fabricated, glowing thing is what the shot is about. Take the glass out
 * and you have wallpaper — pretty, and saying nothing about the product.
 *
 * Researching the peer set turned up three postures on nature, worth recording
 * because it decides what belongs here:
 *
 *   anthropic.com   no photography at all; nature lives in the material —
 *                   an unbleached-paper ground at rgb(250,249,245)
 *   openai.com      editorial photography used heavily as art cards —
 *                   snowfields, radio telescopes, cosmic renders
 *   factory.ai      none; industrial metal and a grid instead
 *   vercel.com      none; one rendered object in an empty black fold
 *
 * Two of five use nature, and both use it as a *threshold or a scale
 * reference*, never as scenery for its own sake. Ours below follows the same
 * construction rather than the same picture.
 */

/**
 * What a reader would actually type, typed for them.
 *
 * The first version of this line typed `rift build "..."`, `rift scan ...` and
 * `rift render "..."` — a shell prompt for a CLI that does not exist. It read
 * beautifully and it was a lie, which is the worst combination a landing page
 * can produce: the one line above the fold that looks like proof.
 *
 * These are the three prompts the product itself offers on an empty Build
 * screen, verbatim, and the caret is the app's input rather than a shell. The
 * device still works — something is being typed, so something can be asked —
 * and now the thing being typed is real.
 */
const COMMANDS = [
  "the pricing test is failing, find out why and fix it",
  "build a gravity simulation with bouncing balls in one HTML file",
  "add rate limiting to the public API and prove it works",
] as const;

/**
 * The line that types itself, their `$ pip install` device.
 *
 * `typed` starts at 0 on the server and on the client's first render, and
 * nothing about the first frame depends on `useReducedMotion`. That is not
 * incidental: asking a server whether the visitor prefers reduced motion has
 * no answer, Motion picks one, the browser picks the other, and React reports
 * a hydration mismatch on every element whose markup depended on it. Under
 * reduced motion the effect below simply completes the line in one step
 * instead of thirty.
 */
function TypingLine() {
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState(0);

  const count = typed;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (reduceMotion) {
      // Complete, not animated — and scheduled rather than written in the
      // effect body, which this repo lints against.
      const settle = setTimeout(() => setTyped(COMMANDS[index].length), 0);
      return () => clearTimeout(settle);
    }

    const command = COMMANDS[index];
    const clear = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };

    // Type it, hold it, then move to the next. Scheduled rather than written
    // synchronously so nothing is set during the effect body.
    for (let i = 1; i <= command.length; i += 1) {
      timers.current.push(setTimeout(() => setTyped(i), i * 38));
    }
    timers.current.push(
      setTimeout(
        () => {
          setTyped(0);
          setIndex((current) => (current + 1) % COMMANDS.length);
        },
        command.length * 38 + 2600,
      ),
    );

    return clear;
  }, [index, reduceMotion]);

  return (
    <p className="mt-9 font-mono text-[13px] leading-6 text-[var(--pi-dim)]">
      <span className="select-none text-[var(--pi-faint)]">&rsaquo; </span>
      {COMMANDS[index].slice(0, count)}
      <span className="ml-0.5 inline-block h-[13px] w-[7px] translate-y-px animate-pulse bg-[var(--pi-ink)] align-middle motion-reduce:animate-none" />
    </p>
  );
}

const BACKED_BY = [
  "E2B",
  "OpenAI",
  "Anthropic",
  "xAI",
  "Google",
  "Moonshot",
  "Alibaba",
] as const;

export function PiHero() {
  const video = useRef<HTMLVideoElement>(null);
  const reduceMotion = useReducedMotion();

  // Played from an effect rather than declared with `autoPlay`. The attribute
  // would have to be derived from `useReducedMotion`, which answers
  // differently on a server than in a browser, and the markup would not match
  // itself. Starting it after mount is also the honest reading of the
  // preference: under reduced motion the element never plays and the poster is
  // what the visitor sees.
  useEffect(() => {
    const node = video.current;
    if (!node || reduceMotion) return;
    const play = () => void node.play().catch(() => {});
    const timer = setTimeout(play, 0);
    return () => clearTimeout(timer);
  }, [reduceMotion]);

  return (
    <section id="top" className="relative isolate overflow-hidden">
      {/*
       * The fold's image, and it moves.
       *
       * Prime's construction, not Prime's picture. Theirs is a 20.5-second
       * silent loop of a jungle gorge with a lit glass slab composited into
       * it: nature is the stage, and one fabricated glowing thing is the
       * subject. Ours takes the construction and finds its own subject in the
       * brand name — a rift is a fissure in rock, so the fissure itself is
       * what glows. Cold white light pours up out of the crack and lights the
       * underside of the fog and the wet edges of the basalt from below; rain
       * falls; mist drifts out of it. Nothing was placed in the shot. The
       * landscape is the product's name, lit.
       *
       * Two earlier versions are worth recording because both were rejected
       * for the same reason in opposite directions. A plain landscape read as
       * wallpaper — beautiful, and saying nothing. A landscape with a glass
       * monolith standing in it read as Prime's shot with our rocks in it:
       * their device, borrowed. The fissure glowing is the one that is a fact
       * about us rather than an association or a loan.
       *
       * ── The loop ──
       *
       * Generated at 1920x1080 for 8 seconds, mirrored so the light falls on
       * the right and the copy keeps the dark corner, then closed into a
       * seamless 6.8-second loop by crossfading the first 1.2s over the tail.
       * A palindrome was the obvious way to close it and is wrong here: played
       * backwards the rain falls upward, which is the one thing in the frame
       * a viewer would catch immediately.
       *
       * Served as VP9 and H.264 at 2.3MB each, with the 4K still as the poster
       * so the fold is complete before a single frame of video arrives — and
       * so the fold is still complete if none ever does.
       */}
      {/*
       * z-0, never a negative index.
       *
       * This layer sat at -z-10 and the photograph was invisible for four
       * passes while the gradients above it took the blame. The cause is the
       * oldest trap in CSS stacking: a child with a negative z-index paints
       * behind its nearest stacking-context ancestor's own background, and the
       * page root here carries an opaque `bg-[var(--pi-ground)]`. The picture
       * was rendering perfectly, underneath the page.
       *
       * The fix carries no z-index at all. Both this layer and the content
       * below it are positioned and unnumbered, so paint order is decided by
       * DOM order — background first, copy second — which is the one ordering
       * rule that cannot be defeated by a stacking context appearing somewhere
       * up the tree. Numbering them (-10, then 0 with the content at 10) was
       * tried and still rendered black; taking the numbers away fixed it.
       */}
      <div className="pointer-events-none absolute inset-0">
        {/*
         * Poster first, video second.
         *
         * `poster` is the same 4K still the picture element used to serve, so
         * the fold paints complete on the first frame and stays complete if
         * the video is blocked, still downloading, or refused — which on a
         * metered connection or under a data-saver setting is the common case
         * rather than the edge one.
         *
         * `autoPlay` is conditional. Reduced motion does not mean a still
         * instead of a video; it means this video element simply never starts,
         * and what the visitor sees is the poster. Same element, same layout,
         * no swap.
         */}
        <video
          ref={video}
          poster="/landing-pi/rift-2560.webp"
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden
          className="size-full object-cover object-[50%_58%]"
        >
          <source src="/landing-pi/rift-hero.webm" type="video/webm" />
          <source src="/landing-pi/rift-hero.mp4" type="video/mp4" />
        </video>
        <PiDotField
          shape="horizon"
          speed={0.5}
          className="absolute inset-0 opacity-[0.14]"
        />
        {/*
         * Wash only where the words are.
         *
         * The first three passes buried the image completely, and the
         * fold rendered as flat black with the picture underneath it doing
         * nothing. The cause was reach, not strength: one gradient ran to 78%
         * of the width and another to 70% of the height, so between them they
         * covered the entire frame including the one bright thing in it.
         *
         * Both are local, and both were re-measured when the frame changed.
         * A 12x8 luma grid over the mirrored fissure puts the copy's corner —
         * bottom left, columns 0-4, rows 4-7 — at 4-43 of 255. That corner is
         * already darker than any wash would make it, which is the whole
         * reason the frame was mirrored: the light runs to the bottom right
         * and the words keep the dark half. So the horizontal is clear by 52%
         * and the vertical by 32%, and neither touches the crack.
         *
         * Re-measured once more after the video landed: the crack's glow
         * reaches further left in motion than the still suggested, and the
         * body copy's last line was ending inside it. The horizontal now runs
         * to 0.88 and clears at 62% — still short of the brightest part of the
         * frame, but past the point where the type stops being sure of
         * itself.
         */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(11,11,12,0.88)_0%,rgba(11,11,12,0.72)_22%,rgba(11,11,12,0.4)_38%,rgba(11,11,12,0.14)_50%,transparent_62%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(11,11,12,0.7)_0%,rgba(11,11,12,0.28)_13%,transparent_32%)]" />
      </div>

      <div
        className={`${PI_CONTAINER} relative flex min-h-[620px] flex-col justify-end pb-12 pt-36 sm:min-h-[700px]`}
      >
        <p className={PI_LABEL}>The agent workstation</p>

        <h1 className={`mt-4 max-w-[20ch] text-[var(--pi-ink)] ${PI_DISPLAY}`}>
          Give it something hard
        </h1>

        <p className="mt-4 max-w-[52ch] text-[15px] leading-[1.55] text-[var(--pi-dim)]">
          Plan, write, execute and verify — inside a sandbox that can actually
          run what it just wrote. One surface for building, generating and
          testing.
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-2">
          <a
            href="/login"
            className="bg-[var(--pi-ink)] px-4 py-2.5 font-mono text-[12px] uppercase text-[var(--pi-ground)] transition-transform duration-100 active:scale-[0.985] motion-reduce:transition-none"
          >
            Start building ›
          </a>
          <a
            href="/download"
            className="border border-[var(--pi-line)] bg-[rgba(255,255,255,0.05)] px-4 py-2.5 font-mono text-[12px] uppercase text-[var(--pi-ink)] transition-[background-color,transform] duration-100 hover:bg-[rgba(255,255,255,0.09)] active:scale-[0.985] motion-reduce:transition-none"
          >
            Download
          </a>
        </div>

        <TypingLine />

        {/* Their backer row, bottom-right — plain names, no logos. Ours names
            the model vendors and the sandbox runtime the product is actually
            built on, which is the honest equivalent: RIFT has no investors to
            list, and inventing social proof is the one thing this page must
            never do. */}
        <div className="mt-12 border-t border-[var(--pi-line)] pt-5 lg:mt-16">
          <p className={PI_INDEX}>Runs on</p>
          <ul className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
            {BACKED_BY.map((name, index) => (
              <li
                key={name}
                className="flex items-center gap-4 text-[14px] text-[var(--pi-dim)]"
              >
                {index > 0 ? (
                  <span aria-hidden className="text-[var(--pi-faint)]">
                    /
                  </span>
                ) : null}
                {name}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
