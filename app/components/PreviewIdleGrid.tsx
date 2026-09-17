"use client";

import { useMemo } from "react";
import { DitherGradient } from "@/components/dither-kit/gradient";

/**
 * The preview pane's building state, measured from Grok's app builder: a
 * perspective grid receding to a vanishing point just above center, with
 * colored light beams that sweep along individual rays and fade out again on a
 * slow cycle. It reads as a place where an app is about to exist — long,
 * quiet, and non-repetitive enough not to feel like a spinner.
 *
 * Pure CSS/SVG; beams pause under prefers-reduced-motion via the
 * motion-reduce utilities.
 */

const BEAM_COLORS = [
  "#7dd3fc",
  "#f0abfc",
  "#fbbf24",
  "#86efac",
  "#fda4af",
  "#a5b4fc",
];

export function PreviewIdleGrid({ statusLine }: { statusLine: string | null }) {
  // Rays fan from the vanishing point; a handful carry animated beams with
  // staggered delays so the pattern never visibly loops.
  const rays = useMemo(() => {
    const list: Array<{ x2: number; beam?: { color: string; delay: number } }> =
      [];
    for (let index = 0; index <= 24; index += 1) {
      const x2 = -600 + index * 100;
      const beamSlot = index % 4 === 1;
      list.push(
        beamSlot
          ? {
              x2,
              beam: {
                color: BEAM_COLORS[(index / 4) % BEAM_COLORS.length | 0],
                delay: (index * 1.7) % 11,
              },
            }
          : { x2 },
      );
    }
    return list;
  }, []);

  return (
    <div
      data-ui="preview-idle-grid"
      className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden bg-[#0a0a0a]"
    >
      {/* Ordered-dither glow rising from the horizon, under the grid. The
          idle pane was pure vector -- clean rays on flat black -- and read a
          little sterile for a place where an app is being built; the coarse
          dither cells give the light a material grain without adding motion
          (the paint is static; only the existing beams animate). */}
      <DitherGradient
        from="purple"
        direction="up"
        cell={4}
        opacity={0.28}
        className="absolute inset-x-0 bottom-0 h-[58%]"
      />
      {statusLine ? (
        <p
          aria-live="polite"
          className="relative z-10 mb-10 max-w-[80%] truncate text-center text-[14px] leading-6 tracking-[-0.1px] text-foreground"
        >
          {statusLine}
        </p>
      ) : null}

      <svg
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[58%] w-full"
        viewBox="0 0 1200 500"
        preserveAspectRatio="none"
      >
        {/* Horizon rows, denser toward the vanishing line. */}
        {[0, 14, 32, 56, 88, 130, 184, 252, 336, 440].map((y) => (
          <line
            key={`row-${y}`}
            x1="0"
            x2="1200"
            y1={y}
            y2={y}
            stroke="rgba(255,255,255,0.07)"
            strokeWidth="1"
          />
        ))}
        {/* Rays to the vanishing point. */}
        {rays.map(({ x2, beam }, index) => (
          <g key={`ray-${index}`}>
            <line
              x1="600"
              y1="0"
              x2={x2}
              y2="500"
              stroke="rgba(255,255,255,0.07)"
              strokeWidth="1"
            />
            {beam ? (
              <line
                x1="600"
                y1="0"
                x2={x2}
                y2="500"
                stroke={beam.color}
                strokeWidth="1.5"
                pathLength={1}
                strokeDasharray="0.18 0.82"
                className="rift-preview-beam motion-reduce:animate-none"
                style={{
                  animationDelay: `${beam.delay}s`,
                  opacity: 0,
                }}
              />
            ) : null}
          </g>
        ))}
      </svg>
    </div>
  );
}
