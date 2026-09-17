"use client";

import { RiftWordmark } from "@/components/icons/rift-wordmark";
import { motion, useReducedMotion } from "motion/react";

import { RiftLogo } from "@/components/icons/rift-logo";

import { SECTION_HEADING_CLASS } from "./type-scale";

/**
 * The closing band: a lit lockup, and light that actually moves.
 *
 * The arrangement is databuddy.cc's — headline and actions left, the brand
 * mark large and lit on the right, light bleeding in from the corners — but
 * the light was static, and a static gradient behind a mark reads as a
 * screenshot of a gradient. This one drifts.
 *
 * ── How the motion is built, and why this way ──
 *
 * Three large, heavily blurred radial blobs, each on its own slow loop, moved
 * with `transform` only. That matters: `transform` and `opacity` are the two
 * properties a browser can animate on the compositor without laying out or
 * painting again, so three 700px light sources cost nothing per frame.
 * Animating `background-position` on a gradient — the obvious way to do this —
 * repaints the whole band every frame, and at this size that is measurable.
 *
 * The periods are 34s, 41s and 29s. Deliberately coprime, so the three never
 * come back into the same relative position and the loop has no visible seam;
 * and all far away from the ~0.2Hz band where ambient motion stops reading as
 * atmosphere and starts reading as flicker.
 *
 * It is white light, not colour. This page has no accent hue anywhere, and the
 * closing section is the last place to introduce one — a rainbow here would be
 * the only colour on the page and would make the loudest thing about the
 * ending its background.
 *
 * Under reduced motion the blobs stay exactly where they are. The composition
 * is designed at rest, so nothing is lost but the drift.
 */

/** One drifting light. */
function Blob({
  className,
  path,
  duration,
  delay = 0,
}: {
  className: string;
  path: { x: number[]; y: number[]; scale: number[] };
  duration: number;
  delay?: number;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      aria-hidden
      className={`pointer-events-none absolute rounded-full ${className}`}
      animate={
        reduceMotion ? undefined : { x: path.x, y: path.y, scale: path.scale }
      }
      transition={{
        duration,
        delay,
        repeat: Infinity,
        repeatType: "mirror",
        ease: "easeInOut",
      }}
    />
  );
}

export function ClosingBand() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="relative isolate overflow-hidden rounded-[12px] border border-border">
      {/*
       * The moving light. Sits under everything, clipped by the band, and is
       * the only thing on this page that never stops.
       */}
      <div aria-hidden className="absolute inset-0 -z-10">
        <Blob
          className="left-[-12%] top-[-40%] size-[520px] bg-[radial-gradient(circle,rgba(255,255,255,0.20)_0%,rgba(255,255,255,0.06)_38%,transparent_70%)] blur-[26px]"
          path={{ x: [0, 120, 40], y: [0, 60, 10], scale: [1, 1.12, 1] }}
          duration={34}
        />
        <Blob
          className="right-[-6%] top-[-30%] size-[640px] bg-[radial-gradient(circle,rgba(255,255,255,0.26)_0%,rgba(255,255,255,0.08)_34%,transparent_68%)] blur-[30px]"
          path={{ x: [0, -90, -20], y: [0, 70, 20], scale: [1, 1.08, 1] }}
          duration={41}
          delay={1.5}
        />
        <Blob
          className="bottom-[-52%] left-[38%] size-[560px] bg-[radial-gradient(circle,rgba(255,255,255,0.16)_0%,rgba(255,255,255,0.05)_36%,transparent_70%)] blur-[28px]"
          path={{ x: [0, -70, 30], y: [0, -50, -10], scale: [1, 1.14, 1] }}
          duration={29}
          delay={0.8}
        />
      </div>

      {/* A hairline of light along the top edge, the way a real surface catches
          the source above it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(to_right,transparent,rgba(255,255,255,0.34),transparent)]"
      />

      <div className="grid items-center gap-12 px-8 py-16 sm:px-14 lg:grid-cols-[1.3fr_auto] lg:py-20">
        <div>
          <h2
            className={`max-w-[18ch] text-foreground ${SECTION_HEADING_CLASS}`}
          >
            Open a sandbox and give it something hard.
          </h2>
          <p className="mt-5 max-w-[52ch] text-[15px] leading-[1.6] text-[var(--cursor-text-secondary)]">
            No install, no credit card. The first run tells you more than this
            page can.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            {/* Pills, which is what vercel.com uses for both of its hero
                actions — and the shape reads as an action rather than as a
                panel, which a 6px rectangle at this size does not. */}
            <a
              href="/login"
              className="inline-flex h-11 items-center rounded-full bg-foreground px-6 text-[14px] font-medium text-background transition-transform duration-100 active:scale-[0.985] motion-reduce:transition-none"
            >
              Start building
            </a>
            <a
              href="/download"
              className="inline-flex h-11 items-center rounded-full border border-border-strong px-5 text-[14px] font-medium text-foreground transition-colors hover:bg-foreground/[0.08] motion-reduce:transition-none"
            >
              Download the app
            </a>
          </div>
        </div>

        {/*
         * The lockup, at the size a brand uses when it has stopped explaining
         * itself: the mark over the wordmark, on one optical centre, with the
         * bloom coming off the mark rather than sitting behind the pair.
         *
         * The mark alone was the previous version and it read as decoration —
         * a shape in the corner. With the wordmark set under it in the page's
         * own letter-spacing it reads as a signature, which is what a closing
         * band is for.
         */}
        <motion.div
          aria-hidden
          className="hidden flex-col items-center gap-5 justify-self-end lg:flex"
          animate={reduceMotion ? undefined : { y: [0, -8, 0] }}
          transition={{
            duration: 9,
            repeat: Infinity,
            repeatType: "mirror",
            ease: "easeInOut",
          }}
        >
          <RiftLogo
            size={132}
            className="text-foreground [filter:drop-shadow(0_0_48px_rgba(255,255,255,0.30))_drop-shadow(0_0_12px_rgba(255,255,255,0.18))]"
          />
          <RiftWordmark
            decorative
            height={39}
            className="text-[26px] font-medium tracking-[0.34em] text-foreground/90 [text-shadow:0_0_28px_rgba(255,255,255,0.28)]"
          />
        </motion.div>
      </div>
    </div>
  );
}
