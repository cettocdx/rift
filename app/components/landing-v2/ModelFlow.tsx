"use client";

import { useReducedMotion } from "motion/react";

import { MICRO_LABEL_CLASS } from "./type-scale";

/**
 * Six vendors converging on one mark — drawn, not rendered.
 *
 * This replaces a WebGL scene. The scene was 424 lines of three.js for a claim
 * the page makes in six words, and it kept failing in ways that are structural
 * rather than fixable: a perspective camera on a full-bleed canvas has no
 * relationship to the six-column grid directly above it, so the orbit never
 * lined up with the thing it was meant to be about, and at any framing that
 * showed the mark clearly the satellites crossed it.
 *
 * The benchmark that drove today's work settles the question. Axiom, Linear,
 * Cursor and v0 were all measured, and not one of them puts a decorative 3D
 * scene on its marketing page — every visual on those pages is either a real
 * product surface or a precise diagram. Reaching for WebGL here was the tell.
 *
 * So: the six lines start exactly where the six vendor tiles above end, and
 * converge into the mark. The graphic is a continuation of the layout rather
 * than a picture sitting under it, which is the whole reason it reads as
 * deliberate. Hairlines, one amber signal, no box.
 */

/** Matches the six-column vendor grid above: same order, same centres. */
const COLUMNS = 6;
const WIDTH = 1240;
const HEIGHT = 190;
const TARGET_X = WIDTH / 2;
const TARGET_Y = HEIGHT - 34;

/** Tile centres, as a fraction of the grid: (i + 0.5) / 6. */
const sourceX = (index: number) => ((index + 0.5) / COLUMNS) * WIDTH;

/**
 * A path from a tile down into the mark.
 *
 * The control points hold each line vertical as it leaves its tile and
 * vertical again as it arrives, so six lines meet the mark head-on instead of
 * fanning into it at six different angles.
 */
const routeFor = (index: number) => {
  const x = sourceX(index);
  return `M${x.toFixed(1)} 0 C${x.toFixed(1)} ${HEIGHT * 0.42} ${TARGET_X} ${HEIGHT * 0.5} ${TARGET_X} ${TARGET_Y}`;
};

// The negative top margin lets the routes leave the tiles' bottom edge rather
// than starting in the gap below them: the lines only read as a continuation of
// the grid if they touch it.
export function ModelFlow() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="-mt-px" aria-hidden>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        // No height class: a fixed height that does not match the viewBox
        // ratio letterboxes the drawing, and with yMax alignment the slack
        // landed at the top — a 12px band between the tiles and the lines that
        // read as a gap rather than as a join. Sized from the viewBox, the
        // routes start exactly on the tiles' bottom edge at every width.
        className="w-full"
        fill="none"
      >
        <defs>
          {/* The lines leave the tiles at full strength and give out before the
              hub, so the convergence reads as arrival rather than as six wires
              soldered to a point. */}
          <linearGradient id="mf-line" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--border-strong,#2e2e2e)" />
            <stop offset="0.7" stopColor="var(--border,#1c1c1c)" />
            <stop
              offset="1"
              stopColor="var(--border,#1c1c1c)"
              stopOpacity="0"
            />
          </linearGradient>
        </defs>

        {Array.from({ length: COLUMNS }, (_, index) => (
          <path
            key={`route-${index}`}
            d={routeFor(index)}
            stroke="url(#mf-line)"
            strokeWidth="1"
          />
        ))}

        {/* One travelling dash per route. A short dash on a long gap, offset
            back to the start and animated forward, is a packet moving down the
            wire — no per-frame JavaScript, and it stops dead under
            prefers-reduced-motion because the animation is the only thing that
            makes it visible. */}
        {!reduceMotion &&
          Array.from({ length: COLUMNS }, (_, index) => (
            <path
              key={`pulse-${index}`}
              d={routeFor(index)}
              stroke="var(--signal-bright,#d98330)"
              strokeWidth="1.5"
              strokeLinecap="round"
              className="rift-model-flow-pulse"
              style={{ animationDelay: `${index * 0.55}s` }}
            />
          ))}

        {/* The hub. Two rings rather than a filled disc: a solid dot at this
            size reads as a bullet point, and the page already has a mark. */}
        <circle
          cx={TARGET_X}
          cy={TARGET_Y}
          r="21"
          stroke="var(--border,#1c1c1c)"
          strokeWidth="1"
        />
        <circle
          cx={TARGET_X}
          cy={TARGET_Y}
          r="4.5"
          fill="var(--signal-bright,#d98330)"
        />
      </svg>

      <p className={`mt-3 text-center ${MICRO_LABEL_CLASS}`}>
        One prompt box, one bill, one thread
      </p>
    </div>
  );
}
