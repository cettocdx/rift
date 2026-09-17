"use client";

import { useInViewOnce } from "@/app/components/landing-v2/use-in-view";
import { REVEAL_EASE } from "./pi-reveal";

/**
 * The isometric wireframe — their second graphic language.
 *
 * Prime Intellect draws every architecture as a hairline isometric: stacked
 * diamonds for layers, a dotted lattice for a grid of workers, arcs for
 * routing, a cube for a container, and small mono chips labelling the parts.
 * Everything is one weight of near-white line on black with no fills, so the
 * diagram reads as a technical drawing rather than an illustration.
 *
 * The construction is simple and worth stating, because it is what keeps a
 * set of these consistent: a diamond is a rectangle at a 2:1 ratio, drawn as
 * four points; a stack is the same diamond repeated down the y axis; a cube is
 * two diamonds joined by verticals. Nothing here needs a 3D library.
 *
 * RIFT's version says what RIFT does: a prompt enters at the bottom, a sandbox
 * opens in the middle, tools run inside it, and a verified result leaves at
 * the top. That is the product's actual shape, which is the only reason to
 * draw it.
 */

const LINE = "rgba(237,237,237,0.34)";
const LINE_DIM = "rgba(237,237,237,0.16)";
const CHIP_BG = "rgba(237,237,237,0.10)";

/** A 2:1 isometric diamond centred on (cx, cy). */
function diamond(cx: number, cy: number, w: number) {
  const h = w / 2;
  return `${cx} ${cy - h} L ${cx + w} ${cy} L ${cx} ${cy + h} L ${cx - w} ${cy} Z`;
}

function Chip({ x, y, text }: { x: number; y: number; text: string }) {
  const w = text.length * 6.4 + 12;
  return (
    <g transform={`translate(${x},${y})`}>
      <rect width={w} height={16} fill={CHIP_BG} />
      <text
        x={w / 2}
        y={11.5}
        textAnchor="middle"
        fill="rgba(237,237,237,0.82)"
        fontSize="8.5"
        fontFamily="var(--pi-mono)"
        letterSpacing="0.04em"
      >
        {text}
      </text>
    </g>
  );
}

export function PiIsometric({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 460 420"
      className={`block size-full ${className}`}
      role="img"
      aria-label="A prompt enters a sandbox, tools run inside it, a verified result leaves"
      fill="none"
    >
      {/* Ground plane — the lattice the sandbox sits on. */}
      <path
        d={`M ${diamond(230, 348, 150)}`}
        stroke={LINE_DIM}
        strokeWidth="1"
      />
      <path
        d={`M ${diamond(230, 348, 100)}`}
        stroke={LINE_DIM}
        strokeWidth="1"
        strokeDasharray="2 4"
      />

      {/* The sandbox: a cube, drawn as two diamonds joined by verticals. */}
      <path d={`M ${diamond(230, 250, 86)}`} stroke={LINE} strokeWidth="1" />
      <path d={`M ${diamond(230, 196, 86)}`} stroke={LINE} strokeWidth="1" />
      <path
        d="M144 250 V196 M316 250 V196 M230 293 V239 M230 207 V153"
        stroke={LINE}
        strokeWidth="1"
      />

      {/* Tools running inside it. Small marks on the interior plane. */}
      <g fill="rgba(237,237,237,0.55)">
        <rect x="196" y="220" width="4" height="4" />
        <rect x="228" y="212" width="4" height="4" />
        <rect x="256" y="226" width="4" height="4" />
        <rect x="212" y="236" width="4" height="4" />
      </g>

      {/* Result plane — the verified output, a dotted lattice above. */}
      <path
        d={`M ${diamond(230, 96, 118)}`}
        stroke={LINE_DIM}
        strokeWidth="1"
        strokeDasharray="2 4"
      />
      <path d={`M ${diamond(230, 96, 74)}`} stroke={LINE} strokeWidth="1" />

      {/* The path the work takes. */}
      <path
        id="pi-iso-flow"
        d="M230 392 V293 M230 153 V110"
        stroke={LINE}
        strokeWidth="1"
      />
      <path d="M226 300 l4 -8 l4 8 Z" fill="rgba(237,237,237,0.5)" />
      <path d="M226 118 l4 -8 l4 8 Z" fill="rgba(237,237,237,0.5)" />

      {/*
       * The travelling pulse, on a CSS keyframe. `prefers-reduced-motion` is
       * answered by the media query in globals rather than by a hook, so the
       * markup is identical on both sides of hydration and the preference is
       * still honoured.
       */}
      <circle
        r="2.6"
        fill="#ededed"
        className="pi-pulse motion-reduce:hidden"
      />

      {/* Leader lines and labels, their exact treatment. */}
      <path d="M96 96 H150" stroke={LINE} strokeWidth="1" />
      <text
        x="20"
        y="92"
        fill="rgba(237,237,237,0.82)"
        fontSize="11"
        fontFamily="var(--pi-sans)"
      >
        Verified
      </text>
      <text
        x="20"
        y="106"
        fill="rgba(237,237,237,0.5)"
        fontSize="11"
        fontFamily="var(--pi-sans)"
      >
        result
      </text>

      <path d="M364 250 H410" stroke={LINE} strokeWidth="1" />
      <text
        x="416"
        y="248"
        fill="rgba(237,237,237,0.82)"
        fontSize="11"
        fontFamily="var(--pi-sans)"
      >
        Sandbox
      </text>

      <path d="M96 392 H196" stroke={LINE} strokeWidth="1" />
      <text
        x="20"
        y="396"
        fill="rgba(237,237,237,0.82)"
        fontSize="11"
        fontFamily="var(--pi-sans)"
      >
        Prompt
      </text>

      <Chip x={286} y={168} text="DIFF" />
      <Chip x={122} y={196} text="TERMINAL" />
      <Chip x={294} y={286} text="FILESYSTEM" />
      <Chip x={126} y={302} text="PACKAGES" />
      <Chip x={276} y={72} text="TESTS PASS" />
    </svg>
  );
}

/**
 * The reward-curve figure, their FIG.3.
 *
 * A single hairline series climbing and then flattening, with the final value
 * called out at the top right and a parameter table beside it. Ours plots what
 * RIFT actually reports across a run — tool calls against elapsed time — so
 * the shape is the product's, not a decoration.
 */
export function PiRunChart({
  className = "",
  points,
}: {
  className?: string;
  points: readonly number[];
}) {
  // Not `whileInView`. This page scrolls inside its own element, so a Motion
  // viewport left on the default root watches a scroller that never moves and
  // the line simply never draws — the bug the scroll-root contract test exists
  // to catch, and it caught this one. The shared hook is the single place the
  // root gets resolved.
  const [chartRef, drawn] = useInViewOnce<HTMLDivElement>(0.4);
  const w = 420;
  const h = 220;
  const max = Math.max(...points, 1);
  const d = points
    .map((value, index) => {
      const x = (index / (points.length - 1)) * w;
      const y = h - (value / max) * h;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div ref={chartRef} className={`size-full ${className}`}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="block size-full"
        role="img"
        aria-label="Tool calls over the course of a run"
        fill="none"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1="0"
            x2={w}
            y1={h * f}
            y2={h * f}
            stroke={LINE_DIM}
            strokeWidth="1"
            strokeDasharray={f === 1 ? undefined : "2 5"}
          />
        ))}
        {/*
         * Drawn with CSS, not Motion. `pathLength="1"` normalises the path's
         * length to 1 whatever its real geometry, so a dash array of 1 and an
         * offset from 1 to 0 draws it exactly — and unlike a Motion `initial`,
         * both the server and the browser emit the same attribute, which is
         * the difference between a hydrated tree and a console full of
         * mismatches.
         */}
        <path
          d={d}
          pathLength={1}
          stroke="#ededed"
          strokeWidth="1.25"
          strokeDasharray={1}
          strokeDashoffset={drawn ? 0 : 1}
          className={`transition-[stroke-dashoffset] duration-[1600ms] motion-reduce:transition-none ${REVEAL_EASE}`}
        />
      </svg>
    </div>
  );
}
