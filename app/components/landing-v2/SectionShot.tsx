"use client";

import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from "motion/react";
import { useRef } from "react";

import { useLandingScrollContainer } from "./LandingShell";

/**
 * A product capture, placed in the section that argues for it.
 *
 * The frame settles rather than appears: it rises a little, scales up from
 * just under full size, and lifts its shadow as it arrives — the same gesture
 * a real panel makes when it comes forward. It is scroll-linked rather than
 * timed, so the reader controls it, and it holds still once seated instead of
 * drifting for the rest of the section.
 */

export function SectionShot({
  src,
  alt,
  caption,
}: {
  src: string;
  alt: string;
  caption?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const container = useLandingScrollContainer();

  const { scrollYProgress } = useScroll({
    container: container ?? undefined,
    target: ref,
    // From the frame entering the viewport to the point it is comfortably read.
    offset: ["start 92%", "start 45%"],
  });

  const scale = useTransform(scrollYProgress, [0, 1], [0.955, 1]);
  const y = useTransform(scrollYProgress, [0, 1], [40, 0]);
  const opacity = useTransform(scrollYProgress, [0, 0.55], [0, 1]);

  return (
    <figure ref={ref} className="mt-12">
      <motion.div
        style={reduceMotion ? undefined : { scale, y, opacity }}
        className="overflow-hidden rounded-[14px] border border-border bg-[var(--surface,#0c0c0c)] shadow-[0_24px_80px_-24px_rgba(0,0,0,0.9)]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="block w-full"
        />
      </motion.div>
      {caption ? (
        <figcaption className="mt-4 max-w-[62ch] text-[12.5px] leading-[1.6] text-[var(--cursor-text-secondary)]">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
