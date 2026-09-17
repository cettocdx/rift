"use client";

import { RIFT_SYMBOL_PATH } from "@/lib/brand/logo";
import { motion, useReducedMotion } from "motion/react";

/**
 * The hero object, built the way vercel.com builds its own.
 *
 * Theirs is one thing in an otherwise empty black fold: a solid dark form,
 * lit hard from behind and above so only its edges catch, sitting inside a
 * wide soft bloom, with film grain over the whole thing. Measured on the page
 * on 20 Aug 2026, it ships as an 840x560 noise-textured WebP with a 983x655
 * canvas fading in over it — a static fallback and an animated version of the
 * same image.
 *
 * This is that construction with our mark instead of their triangle, and drawn
 * rather than rendered so it costs no asset and no WebGL context:
 *
 *   bloom   a wide radial, brightest just above the mark's apex, which is
 *           where their light source sits
 *   form    the mark filled near-black — darker than the bloom behind it, so
 *           it reads as an object occluding a light rather than as a shape
 *           painted on top of one
 *   rim     a second copy of the mark, offset up by a pixel and clipped to a
 *           gradient, which is what puts light on the top edges only
 *   grain   feTurbulence at low opacity, the same job their noise WebP does:
 *           it stops the bloom banding and gives the black a surface
 *
 * The bloom is the only thing in the fold that moves, and it moves visibly:
 * 0.6 to 1.0 in opacity, 0.9 to 1.1 in scale, and a few percent of drift left
 * to right, on a 6.5s cycle. The ground behind it is deliberately still — two
 * moving lights in one view is two things asking for the eye, so the plate
 * lost its travelling specular when this gained amplitude.
 *
 * 6.5s is far from the ~0.2Hz band where ambient motion stops reading as a
 * light and starts reading as a flicker, and it is gone entirely under reduced
 * motion.
 */

/** The mark's own geometry, taken from components/icons/rift-logo.tsx. */
const VIEW_BOX = "0 0 124 124";

export function HeroMark({ className = "" }: { className?: string }) {
  const reduceMotion = useReducedMotion();

  return (
    <div
      aria-hidden
      className={`pointer-events-none relative isolate ${className}`}
    >
      {/* The bloom. Centred slightly above the mark, because the light is
          above it. */}
      <motion.div
        className="absolute left-1/2 top-1/2 size-[130%] -translate-x-1/2 -translate-y-[58%] bg-[radial-gradient(circle,rgba(255,255,255,0.30)_0%,rgba(255,255,255,0.11)_22%,rgba(255,255,255,0.035)_42%,transparent_66%)]"
        animate={
          reduceMotion
            ? undefined
            : {
                opacity: [0.6, 1, 0.6],
                scale: [0.9, 1.1, 0.9],
                x: ["-4%", "4%", "-4%"],
              }
        }
        transition={{
          duration: 6.5,
          repeat: Infinity,
          repeatType: "mirror",
          ease: "easeInOut",
        }}
      />

      <svg
        viewBox={VIEW_BOX}
        className="relative size-full"
        role="presentation"
        focusable="false"
      >
        <defs>
          {/* Light along the top edges only. */}
          <linearGradient id="rift-hero-rim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.92" />
            <stop offset="34%" stopColor="#ffffff" stopOpacity="0.30" />
            <stop offset="62%" stopColor="#ffffff" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>

          {/* The body: near-black, with the faintest lift where the bloom
              wraps around it. */}
          <linearGradient id="rift-hero-body" x1="0" y1="0" x2="0.2" y2="1">
            <stop offset="0%" stopColor="#141414" />
            <stop offset="46%" stopColor="#080808" />
            <stop offset="100%" stopColor="#020202" />
          </linearGradient>

          <filter id="rift-hero-grain">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves="3"
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>

          {/* Shared supplied artwork; lighting layers reuse the same silhouette. */}
          <g id="rift-hero-path" transform="translate(12 12)">
            <path d={RIFT_SYMBOL_PATH} />
            <path d={RIFT_SYMBOL_PATH} transform="rotate(180 50 50)" />
          </g>
        </defs>

        {/* The rim, one pixel proud, clipped to the top-light gradient. */}
        <use
          href="#rift-hero-path"
          transform="translate(0,-1.4)"
          fill="url(#rift-hero-rim)"
        />
        {/* The form itself, occluding the bloom. */}
        <use href="#rift-hero-path" fill="url(#rift-hero-body)" />
        {/* Grain over the form only, so the sky stays clean. */}
        <use
          href="#rift-hero-path"
          fill="#ffffff"
          filter="url(#rift-hero-grain)"
          opacity="0.09"
          style={{ mixBlendMode: "overlay" }}
        />
      </svg>
    </div>
  );
}
