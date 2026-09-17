"use client";

import { useParallax } from "./use-parallax";
import { XPlanet } from "./XPlanet";
import { Reveal } from "./reveal";
import { XMediaCard } from "./x-pieces";
import { X_CONTAINER, X_LABEL, X_SECTION, X_SECTION_PAD_TIGHT } from "./x-system";

/**
 * The cinematic moment — a planet from orbit, and the claim over it.
 *
 * This has been three things. First a stock photograph of a server hall under
 * "The sandbox fleet", which two reviews killed for the right reason: sandboxes
 * run on rented E2B (e2b/template.ts), so a datacentre captioned as our fleet
 * claimed infrastructure we do not own, in the one medium nobody fact-checks.
 * Then a canvas-drawn horizon — honest, but an approximation. Now it is a real
 * 4K asset, generated and animated as a slow orbital drift (see XPlanet). It
 * clears the bar the hall failed: a planet asserts nothing about what the
 * company owns.
 *
 * ── Full bleed, then framed ──
 *
 * The section used to be `min-h-[92svh]` of edge-to-edge video with the type
 * in the black sky above it. That is the right move on a dark page and an
 * impossible one on paper: a full-bleed dark video against a paper document
 * has no transition available except a hard edge across the viewport, and a
 * hard edge is exactly what the reference never has.
 *
 * So the planet is a card, and the type went inside it. This is the reference's
 * own closing device — a single wide photograph, cornered, with white type set
 * over the dark half of the image — used here for the argument it fits: the run
 * is not happening in the tab.
 *
 * That claim is `trigger/agent-long.ts` — `maxDuration: 60 * 60` on a
 * `medium-1x` machine, a heartbeat keeping the run's lock alive. A server-side
 * hour; closing the browser is not an input.
 */
export function XScale() {
  const planetRef = useParallax<HTMLDivElement>(26);

  return (
    <section className={X_SECTION_PAD_TIGHT}>
      <div className={X_CONTAINER}>
        <Reveal>
          <XMediaCard
            grain={0.16}
            className="flex min-h-[520px] items-end lg:min-h-[620px]"
          >
            {/*
             * Overscanned past both edges, not anchored to one.
             *
             * The first pass sat the video at `-bottom-[6%] h-[94%]`, which
             * left a 6% strip of the card's own ground above it — and the
             * card's ground and the video's first frame are two different
             * darks, so the join read as a horizontal seam across the frame.
             * `-inset-y-[8%] h-[116%]` covers the card at rest and still has
             * 8% of travel in hand for the parallax to eat, which is what the
             * gap was there to provide in the first place.
             */}
            <div
              ref={planetRef}
              aria-hidden
              className="absolute -inset-y-[8%] left-0 right-0 h-[116%] will-change-transform"
            >
              {/*
               * Graded to black and white.
               *
               * Every other blue on this page came out of a token or a shader
               * and could be neutralised at the source. This one cannot: the
               * limb is baked into planet-loop.mp4 / .webm and the poster, and
               * it is the most saturated blue left in the document. A
               * `grayscale` pass is the honest fix — it costs one compositor
               * filter, it keeps the asset, and a monochrome planet reads as a
               * photograph rather than as a video that lost its colour.
               */}
              <XPlanet className="size-full object-cover object-top [filter:grayscale(1)]" />
            </div>

            {/*
             * One scrim, bottom-weighted. The full-bleed version needed two —
             * a top wash to make the sky black enough for type and a radial to
             * feather the video into the page. Inside a frame the second job
             * disappears entirely, because the corner does it.
             */}
            <div
              aria-hidden
              className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.86),rgba(0,0,0,0.35)_46%,rgba(0,0,0,0.55))]"
            />

            <div className="relative w-full p-8 md:p-12 lg:p-16">
              <p className={`${X_LABEL} text-white/55`}>
                While you are somewhere else
              </p>
              <h2
                className={`${X_SECTION} mt-5 max-w-[15ch] text-balance text-white`}
              >
                The run does not need you watching
              </h2>
              <p className="mt-5 max-w-[470px] text-[16px] leading-[1.5] text-white/70">
                A long task runs on the server for up to an hour, not in the
                tab. Close the window and come back later. The finished thread
                is waiting with the trace that produced it.
              </p>
            </div>
          </XMediaCard>
        </Reveal>
      </div>
    </section>
  );
}
