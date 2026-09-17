"use client";

import { Reveal } from "./reveal";
import { XGrain } from "./x-pieces";
import { XRunLoop } from "./XRunLoop";
import {
  X_BODY_SM,
  X_CARD_TITLE_SM,
  X_CONTAINER,
  X_INTRO,
  X_LABEL,
  X_SECTION,
  X_SECTION_PAD,
} from "./x-system";

/**
 * The claim the page is actually built on.
 *
 * ── Why this claim and not another ──
 *
 * Everything else this product offers, someone with more capital can copy in a
 * quarter: the model routing is a reseller margin, the tool count is a
 * container image, the archetypes are prompts. One thing is architectural —
 * the work is executed and proved on the same machine that made it. The claim
 * used to be "done is a passing suite", but nothing in the repo gates
 * completion on a green suite, and a claim you cannot point at a mechanism for
 * reads as marketing. What IS enforced is stronger: expose-preview.ts refuses
 * to show a preview for a port that has not passed verify_app, and verify_app
 * runs the production build, probes the live server and renders the page at
 * desktop and mobile widths before it will pass. A wrapper around an API has
 * nowhere to do any of that.
 *
 * ── What the rebuild changed ──
 *
 * The image beside the claim is no longer an image. It was a 4K photograph of
 * light particles streaming toward a horizon, and the honest description of it
 * was atmosphere: a reader who did not already understand "it has to make it
 * work before it says it works" learned nothing from it. It is now XRunLoop —
 * the four checks, in order, with the preview held back until they pass. The
 * picture argues the section instead of decorating it.
 *
 * The four steps below it keep their content and lose their box. Ruled
 * columns, the reference's 0.5px at ink/10, no card and no fill.
 */

const STEPS = [
  {
    step: "01",
    title: "It gets a machine",
    body: "A sandbox with a filesystem, a package manager and a terminal — issued for the run, torn down after it.",
  },
  {
    step: "02",
    title: "It does the work",
    body: "Reads the code, makes the change, installs what it needs, runs what it wrote.",
  },
  {
    step: "03",
    title: "It proves the work",
    body: "The build runs, the server is probed and the page is rendered at desktop and mobile widths. It cannot show you a preview that failed those checks.",
  },
  {
    step: "04",
    title: "It shows the bill",
    body: "Tools called, lines changed, context used and dollars spent — on the run, while it happens.",
  },
] as const;

export function XProof() {
  return (
    <section className={`${X_SECTION_PAD} bg-[#000000]`}>
      <div className={X_CONTAINER}>
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <Reveal>
            <p className={`${X_LABEL} !text-white/45`}>What a run is</p>
            <h2
              className={`${X_SECTION} mt-5 max-w-[16ch] text-balance text-white`}
            >
              It makes it work before it says it works
            </h2>
            <p className={`${X_INTRO} mt-5 max-w-[470px] !text-white/55`}>
              Done means something that built and ran. You see the command, the
              output and the exit code.
            </p>
          </Reveal>

          {/*
           * The run itself, drawn.
           *
           * This was a 4K photograph of light streaming toward a horizon —
           * beautiful, and decoration. The section's claim is that a preview
           * is *released by* its checks rather than announced by the agent,
           * and a picture of weather cannot make that claim. XRunLoop can: it
           * plays the four checks `verify_app` runs and holds the release bar
           * back until all four have passed.
           */}
          <Reveal step={1}>
            {/*
             * x.ai's code-block treatment: the panel floats on a dark plate
             * that is *cut* rather than feathered — a hard-edged rectangle,
             * offset behind the panel, carrying a soft diagonal gradient and a
             * grain. The panel itself is smaller than its plate, which is what
             * gives the arrangement depth without a drop shadow doing the work.
             */}
            <div className="relative mx-auto w-full max-w-[540px] p-7 sm:p-9">
              {/*
               * The plate: a hard-cut rectangle carrying a diagonal ramp and a
               * soft light bleed in the upper right, with grain over both. The
               * panel floats on it with a wide margin — that margin is what
               * makes the arrangement read as depth without a drop shadow.
               */}
              <div
                aria-hidden
                className="absolute inset-0 overflow-hidden bg-[linear-gradient(150deg,#101010_0%,#181818_40%,#242424_62%,#0d0d0d_100%)]"
              >
                {/* The light bleed — the reference's brightest note. */}
                <div className="absolute -right-1/4 -top-1/3 size-2/3 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.30),transparent_65%)] blur-[26px]" />
                <XGrain opacity={0.3} />
              </div>
              {/* Cut marks at the plate's bottom corners, theirs exactly. */}
              <span aria-hidden className="absolute bottom-0 left-0 size-4 bg-[#000]" />
              <span aria-hidden className="absolute bottom-0 right-0 size-4 bg-[#000]" />

              <div className="relative overflow-hidden rounded-[12px] shadow-[0_30px_70px_-32px_rgba(0,0,0,0.9)]">
                <XRunLoop className="aspect-[5/4] w-full" />
              </div>
            </div>
          </Reveal>
        </div>

        {/*
         * Ruled columns, not cards.
         *
         * `divide-*` rather than a border on each cell, so the outer edges of
         * the group carry no rule at all — the reference never closes a group
         * of items with a box, and an outer border here would put one back.
         */}
        <Reveal step={2}>
          <ol className="mt-20 grid divide-y-[0.5px] divide-white/10 border-t-[0.5px] border-t-white/10 lg:grid-cols-4 lg:divide-x-[0.5px] lg:divide-y-0">
            {STEPS.map((item) => (
              <li key={item.step} className="pb-8 pt-8 lg:px-8 lg:first:pl-0 lg:last:pr-0">
                {/* ink-45 (≈8:1 on paper), not ink-30: these numerals carry
                    the sequence and are not aria-hidden, so they are real
                    text. */}
                <p className="font-mono text-[13px] text-white/40">
                  {item.step}
                </p>
                <h3 className={`${X_CARD_TITLE_SM} mt-6 text-white`}>
                  {item.title}
                </h3>
                <p className={`${X_BODY_SM} mt-3 text-white/50`}>
                  {item.body}
                </p>
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}
