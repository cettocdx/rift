"use client";

import { BODY, MICRO } from "./landing-design-system";
import { Reveal } from "./Reveal";

/**
 * What the Studio section is actually selling.
 *
 * A section claiming twelve generation models earns nothing from a list of
 * their names — the output is the argument. The set is deliberately spread
 * across a portrait, a product macro and a landscape, because the case for many
 * models is range; a wall of variations on one subject would argue the
 * opposite. They are graded to the same cool monochrome so the page still reads
 * as one object rather than a stock gallery.
 *
 * The clip that used to open this section is gone, and the measurement is the
 * reason. Sampled every half second across its full five, its frame averaged
 * between 2 and 7 luma out of 255 — a dark object on a dark ground, with one
 * specular edge reaching 145 and nothing else above the noise floor. At
 * 1160x650 it read as an empty box, which is the worst thing a section arguing
 * "look at what it generates" can lead with. Grading it does not help: lifting
 * a frame that dark raises the compression noise faster than the subject.
 *
 * A video model's output is motion and a still cannot prove it, so this is a
 * real loss rather than a tidy-up. It stands until there is a clip worth
 * showing; three visible frames beat four where one is invisible.
 */

const STILLS = [
  {
    src: "/landing-v2/studio-chrome.webp",
    alt: "Generated abstract: a polished liquid-chrome ribbon looping under a single strip light.",
    /** What this frame is here to demonstrate. */
    shows: "Material and reflection",
    note: "A polished surface under one strip light — the hardest thing to fake",
  },
  {
    src: "/landing-v2/studio-product.webp",
    alt: "Generated product macro: the machined corner of a matte black device catching a blue chamfer highlight.",
    shows: "Product macro",
    note: "Controlled highlight on a machined chamfer, at close range",
  },
  {
    src: "/landing-v2/studio-landscape.webp",
    alt: "Generated landscape: a dark volcanic ridge at night with cloud pouring through the valley.",
    shows: "Environment and scale",
    note: "Atmosphere and depth across a whole valley, not a single subject",
  },
];

export function StudioShowcase() {
  return (
    <div className="mt-14">
      {/*
        Not three equal tiles in a row.
        
        The section's argument is range — the case for many models is that they
        are good at different things — and three identical 4:3 frames argue the
        opposite of range by showing one shape three times. So the first frame
        takes the height of the other two: a lead image with two beside it,
        which is what a set of work looks like when it is being shown rather
        than listed.

        Each frame says what it is there to demonstrate. Unlabelled pictures
        prove the output is good; they do not prove the claim in the heading,
        which is about coverage.
      */}
      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Reveal>
          <figure className="m-0 flex h-full flex-col gap-3">
            <span className="block flex-1 overflow-hidden rounded-[8px] border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={STILLS[0].src}
                alt={STILLS[0].alt}
                loading="lazy"
                decoding="async"
                className="block size-full min-h-[280px] object-cover lg:min-h-[420px]"
              />
            </span>
            <figcaption className="flex flex-col gap-1">
              <span className={MICRO}>{STILLS[0].shows}</span>
              <span className={BODY}>{STILLS[0].note}</span>
            </figcaption>
          </figure>
        </Reveal>

        <div className="grid gap-4">
          {STILLS.slice(1).map((still, index) => (
            <Reveal key={still.src} delay={(index + 1) * 0.07}>
              <figure className="m-0 flex flex-col gap-3">
                <span className="block overflow-hidden rounded-[8px] border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={still.src}
                    alt={still.alt}
                    loading="lazy"
                    decoding="async"
                    className="block aspect-[16/10] w-full object-cover"
                  />
                </span>
                <figcaption className="flex flex-col gap-1">
                  <span className={MICRO}>{still.shows}</span>
                  <span className={BODY}>{still.note}</span>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </div>
    </div>
  );
}
