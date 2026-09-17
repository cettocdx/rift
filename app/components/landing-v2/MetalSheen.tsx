"use client";

import { useReducedMotion } from "motion/react";

/**
 * A slow specular travelling across black.
 *
 * The reference for this is a saturated gradient wash; ours cannot be, because
 * the product is true black and a coloured wash would be the only hue on the
 * page. So the same idea is expressed in our material: a narrow band of cool
 * light raking across a dark machined surface, the way the hero plate is lit.
 *
 * Constraints this respects, deliberately:
 * — it only paints `background-position`, which stays off the layout path;
 * — the cycle is 18s, well away from the ~0.2Hz band that reads as flicker;
 * — it is `aria-hidden` and vanishes under reduced motion rather than slowing
 *   down, because a moving full-width backdrop is exactly what that setting is
 *   asking you to remove.
 */

export function MetalSheen({
  className = "",
  /**
   * Draw the grain and the vignette. Off when the sheen sits on a surface that
   * already has both — over the hero plate they doubled the texture and the
   * vignette flattened the photograph's own specular to black.
   */
  bare = false,
}: {
  className?: string;
  bare?: boolean;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      {/* The grain reads as a milled surface and gives the sheen something to
          catch; without it the band looks like a gradient sliding over paint. */}
      {!bare ? (
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, rgba(255,255,255,0.045) 0px, rgba(255,255,255,0.045) 1px, transparent 1px, transparent 3px)",
          }}
        />
      ) : null}
      {!reduceMotion ? (
        <div
          className="absolute inset-[-20%] animate-[rift-sheen_18s_linear_infinite]"
          style={{
            // Tuned twice. At the original stops the peak landed near 0.09
            // white once the wrapper opacity was applied and black swallowed
            // it; opened too far the other way it became a haze over the whole
            // hero. This band is narrow enough to read as one raking specular.
            backgroundImage:
              "linear-gradient(100deg, transparent 36%, rgba(255,255,255,0.10) 45%, rgba(255,255,255,0.24) 50%, rgba(255,255,255,0.10) 55%, transparent 64%)",
            backgroundSize: "260% 100%",
          }}
        />
      ) : null}
      {/* The band has to die out before the edges or it reads as a stripe
          crossing a box rather than light on a surface. */}
      {!bare ? (
        <div className="absolute inset-0 bg-[radial-gradient(120%_100%_at_50%_0%,transparent_40%,#000_100%)]" />
      ) : null}
    </div>
  );
}
