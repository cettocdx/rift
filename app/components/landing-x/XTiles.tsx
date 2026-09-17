"use client";

import { AGENT_PET_CATALOG } from "@/lib/ai/agents/pet-roster";
import { MEDIA_MODELS } from "@/types/chat";

import { XMesh, type MESH_PALETTES } from "./XMesh";
import { VENDORS } from "./x-mark-data";
import { Reveal } from "./reveal";
import { XGrain } from "./x-pieces";
import {
  X_CONTAINER,
  X_LABEL,
  X_MEDIA_RADIUS,
  X_SECTION,
  X_SECTION_PAD,
} from "./x-system";

/**
 * The colour row.
 *
 * The page is paper from top to bottom, and a monochrome page has one failure
 * mode: after four sections a reader stops being able to tell where they are,
 * because every screen has the same value. The reference answers it with
 * photographs — every one of its five feature cards is a real blue-hour scene,
 * colour strictly inside a rounded frame, the page around it untouched.
 *
 * These four are generated rather than shot, and they are held to the same
 * three rules the reference's photographs follow, which is what stops a mesh
 * gradient from reading as a 2021 SaaS header:
 *
 *   - **No border.** A hairline around an image turns it into a screenshot of
 *     something. The corner does the containing.
 *   - **Grain.** Every image on the reference has it. Here it is doing
 *     literal work as well as stylistic — a canvas mesh at this size bands
 *     visibly across its gradients, and noise dithers the banding away.
 *   - **A deep base and one bright pass**, which is what a blue-hour
 *     photograph is: dark shadows, a single warm or cold practical.
 *
 * The type sits INSIDE each plate, bottom-anchored over a scrim, so each card
 * reads as one object. The content is the four surfaces the product has, each
 * linking to the section that demonstrates it, so the row doubles as a
 * contents page; the figures are read from the product's modules.
 */

// Shared with XVendorOrbit so the "N frontier vendors" figure can never
// diverge from the ring that draws them.
const VENDOR_COUNT = VENDORS.length;

const TILES: {
  href: string;
  eyebrow: string;
  headline: string;
  caption: string;
  palette: keyof typeof MESH_PALETTES;
  seed: number;
}[] = [
  {
    href: "#build",
    eyebrow: "Build",
    headline: "Plan it, or just ship it",
    caption:
      "Frontier vendors on one key — it reads the repo, makes the change and runs what it wrote.",
    // Graphite, not ice. The blue palette was the loudest thing on a page
    // whose ink is now pure black, and it sat on the flagship surface.
    palette: "graphite",
    seed: 7,
  },
  {
    href: "#studio",
    eyebrow: "Studio",
    headline: "Every renderer, one prompt box",
    caption:
      "Images and video in the same thread as the code that needed them. No second tab, no second invoice.",
    palette: "violet",
    seed: 23,
  },
  {
    href: "#workbench",
    eyebrow: "Hack Workbench",
    headline: "Scoped, authorised, evidenced",
    caption:
      "An offensive toolchain that runs only against a target you declared, and keeps its evidence. Included with Max.",
    palette: "rose",
    seed: 41,
  },
  {
    href: "#everything",
    eyebrow: "Agents",
    headline: `${AGENT_PET_CATALOG.length} archetypes with real roles`,
    caption:
      "Delegated to rather than prompted at — each a starting point you shape, with a run that outlives the tab.",
    palette: "forest",
    seed: 59,
  },
];

export function XTiles() {
  return (
    <section className={X_SECTION_PAD}>
      <div className={X_CONTAINER}>
        <Reveal>
          <p className={X_LABEL}>The surfaces</p>
          <h2
            className={`${X_SECTION} mt-5 max-w-[16ch] text-balance text-[var(--x-ink)]`}
          >
            Four ways to hand over the work
          </h2>
        </Reveal>

        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TILES.map((tile, i) => (
            <a
              key={tile.href}
              href={tile.href}
              className={`group relative isolate flex min-h-[380px] flex-col justify-end overflow-hidden ${X_MEDIA_RADIUS} p-6 shadow-[0_30px_70px_-55px_rgba(0,0,0,0.42)] transition-shadow duration-500 hover:shadow-[0_40px_90px_-50px_rgba(0,0,0,0.5)] motion-reduce:transition-none`}
            >
              {/*
               * Graded, not just cropped.
               *
               * The mesh palettes were authored to glow on a #0a0a0a page, and
               * their top stops run to #c8c8c8 / #f0b8ee / #ffc2e6. Dropped
               * unchanged onto paper those four cards read as 2014 SaaS
               * headers — the brightest thing in the viewport, and the only
               * place on the page with no photographic reference.
               *
               * `saturate(0.8) brightness(0.66)` is the grade the reference's
               * own photography already has: a deep base with one practical
               * light in it. Same canvas, same seeds, and it now sits in the
               * page instead of on top of it.
               */}
              <div
                aria-hidden
                className="absolute inset-0 -z-10 [filter:saturate(0.8)_brightness(0.66)] transition-transform duration-[520ms] ease-out group-hover:scale-[1.05] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
              >
                <XMesh palette={tile.palette} seed={tile.seed} />
              </div>
              <div
                aria-hidden
                className="absolute inset-0 -z-10 bg-[linear-gradient(to_top,rgba(0,0,0,0.82),rgba(0,0,0,0.14)_50%,transparent_76%)]"
              />
              {/* Above the scrim, below the type — the grain has to sit on the
                  darkened image, not under the thing that darkened it. */}
              <XGrain opacity={0.2} />

              <span className="absolute right-4 top-4 font-mono text-[11px] tracking-[0.04em] text-white/70 [text-shadow:0_1px_4px_rgba(0,0,0,0.75)]">
                0{i + 1}
              </span>

              <div className="flex items-center gap-2">
                <p className="font-mono text-[12px] uppercase tracking-[0.05em] text-white/90">
                  {tile.eyebrow}
                </p>
                <span
                  aria-hidden
                  className="text-white/55 transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none"
                >
                  &rarr;
                </span>
              </div>
              <p className="mt-2 text-[17px] font-medium leading-[1.2] tracking-[-0.02em] text-white">
                {tile.headline}
              </p>
              <p className="mt-2 text-[13px] leading-[1.5] text-white/70">
                {tile.caption}
              </p>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
