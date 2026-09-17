"use client";

/**
 * The hero's ground: one lit object in an otherwise black fold.
 *
 * This is vercel.com's hero composition, and it is the composition this page
 * started with. Vercel puts a single rendered triangle in the middle of an
 * absolute-black fold, raked by one hard light, with the headline to its left
 * and nothing else competing. Ours is a photographed steel plate lit the same
 * way — the same idea in the material this product is actually made of.
 *
 * ── Why it came out, and what changed so it could come back ──
 *
 * The plate was removed when the page ground was lifted to a warm grey, for
 * two measured faults rather than a preference:
 *
 *   1. Its machining grain is a regular vertical stripe. At 1512px that pitch
 *      beat against the pixel grid into visible moiré across the top right.
 *   2. The left stop of its falloff was an opaque `var(--background)` covering
 *      the first third of the width — exactly where the left drafting guide
 *      runs — so the grid died underneath it.
 *
 * Both are fixed here rather than tolerated. The image is scaled 1.30 across
 * and 1.326 down: a 2% difference on one axis only, far too small to read as a
 * stretch and just enough to take the grain out of lockstep with the pixel
 * pitch, so the beat never lands. And every falloff stop is now an alpha over
 * black instead of an opaque fill, so the guides read straight through.
 *
 * The ground being #000000 again is the other half of it. This photograph was
 * shot against black; on the grey it had to be washed out to sit at all.
 *
 * Nothing here moves. A travelling specular used to rake across the plate, and
 * it competed with the one thing in the fold that should be alive — the light
 * on the mark itself. Two moving lights in one view is two things asking for
 * the eye, so the ground is now still and the motion belongs entirely to
 * HeroMark.
 */
export function HeroAtmosphere({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none ${className}`}>
      {/*
       * Masked out of the middle.
       *
       * vercel.com's fold is clean black around its lit object — nothing
       * textured competes with it. Ours keeps the plate, because the material
       * is the brand, but it is punched out behind the mark: a radial mask
       * centred where HeroMark sits removes the machining grain exactly where
       * the object needs empty ground, and lets it back in toward the edges.
       * Without this the plate's vertical stripes ran straight through the
       * mark's rim light and both lost.
       */}
      <div className="absolute inset-0 overflow-hidden [mask-image:radial-gradient(58%_62%_at_62%_36%,transparent_0%,transparent_26%,rgba(0,0,0,0.55)_46%,#000_72%)]">
        <picture>
          <source
            srcSet="/landing-v2/hero-metal-3840.webp 3840w, /landing-v2/hero-metal-2560.webp 2560w, /landing-v2/hero-metal-1600.webp 1600w, /landing-v2/hero-metal-960.webp 960w"
            sizes="100vw"
            type="image/webp"
          />
          <img
            src="/landing-v2/hero-metal-2560.webp"
            alt=""
            fetchPriority="high"
            decoding="async"
            className="size-full origin-bottom scale-x-[1.30] scale-y-[1.326] object-cover object-[68%_top] opacity-[0.72] [filter:saturate(0.06)_contrast(1.04)]"
          />
        </picture>

        {/* The rake. One narrow specular from the upper right, which is what
            makes a flat photograph read as a lit surface rather than as a
            texture. */}
        <div className="absolute inset-0 bg-[radial-gradient(58%_62%_at_76%_2%,rgba(255,255,255,0.16)_0%,rgba(255,255,255,0.05)_30%,transparent_62%)]" />

        {/* Falloff in alpha over black, never in opaque paint. */}
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,transparent_38%,rgba(0,0,0,0.72)_74%,#000_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(100deg,rgba(0,0,0,0.94)_0%,rgba(0,0,0,0.9)_30%,rgba(0,0,0,0.72)_46%,rgba(0,0,0,0.4)_58%,rgba(0,0,0,0.1)_70%,transparent_80%)]" />
      </div>
    </div>
  );
}
