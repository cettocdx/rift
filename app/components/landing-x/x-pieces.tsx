import type { ReactNode } from "react";

import { RiftLogo } from "@/components/icons/rift-logo";

import { X_CONTAINER, X_MEDIA_RADIUS, X_RULE_B } from "./x-system";

/**
 * The four small parts the reference repeats, in one file so they cannot
 * drift.
 *
 * Everything here is a shape borrowed from orchid.ai rather than a component
 * that page happens to have. Read them together and they are most of why that
 * site reads as one object: one ground, one rule weight, one corner, one
 * grain.
 */

/* ── Grain ────────────────────────────────────────────────────────────── */

/**
 * Film grain over a photograph.
 *
 * Zoom into any image on the reference and it is there: a fine, even noise
 * sitting on top of the picture. It is doing real work rather than decorating
 * — a webp of a dark blue-hour scene has visible banding across its gradients
 * at this size, and a little grain destroys the banding by dithering it. It
 * also stops a photograph on a paper page from reading as a screenshot.
 *
 * `feTurbulence` rather than a noise PNG so there is no second asset to fetch
 * and no resolution to be wrong at. `stitchTiles` matters — without it the
 * pattern seams at every 160px tile boundary, which is more visible than the
 * grain itself.
 */
const GRAIN_URL =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")";

export function XGrain({ opacity = 0.18 }: { opacity?: number }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 mix-blend-overlay"
      style={{ backgroundImage: GRAIN_URL, opacity }}
    />
  );
}

/* ── Media card ───────────────────────────────────────────────────────── */

/**
 * A photograph on paper.
 *
 * The reference's one visual container, and it has no border. That is the
 * detail worth keeping: a hairline around a photograph turns it into a
 * *screenshot of* something, and every image on that page is trying to read as
 * a window instead. The corner does the containing.
 *
 * The floor is `--x-well`, not paper — every asset this page puts in one is a
 * dark scene, and a paper-coloured box flashing before a 2560px webp decodes
 * is the most visible loading artefact the page has.
 */
export function XMediaCard({
  children,
  className,
  grain = 0.18,
}: {
  children: ReactNode;
  className?: string;
  /** 0 disables it — for a card whose content is UI rather than a photograph. */
  grain?: number;
}) {
  return (
    <div
      className={`relative isolate overflow-hidden bg-[var(--x-well)] ${X_MEDIA_RADIUS} ${className ?? ""}`}
    >
      {children}
      {grain > 0 ? <XGrain opacity={grain} /> : null}
    </div>
  );
}

/* ── Section divider ──────────────────────────────────────────────────── */

/**
 * Two hairlines and the mark.
 *
 * The reference sets five orchid petals between two rules at the seam of every
 * feature section, which is its logo taken apart and scattered through the
 * page. It is a small thing that does something no amount of spacing can: it
 * tells a reader the section ended *on purpose* rather than the page having
 * run out of things to say, and it does it without drawing a band across the
 * page the way a full-width rule would.
 *
 * Ours is the same construction with our own mark, at ink/25 — present, and
 * quiet enough that a reader registers it as punctuation rather than as a
 * logo placement.
 */
export function XDivider() {
  return (
    <div aria-hidden className={X_CONTAINER}>
      <div className="flex items-center gap-6">
        <span className="h-px flex-1 bg-[var(--x-line)]" />
        <RiftLogo size={18} className="text-[var(--x-ink-30)]" />
        <span className="h-px flex-1 bg-[var(--x-line)]" />
      </div>
    </div>
  );
}

/* ── Feature list ─────────────────────────────────────────────────────── */

/**
 * The reference's bullet list: rows separated by rules, not boxes.
 *
 * `py-3` and a 0.5px bottom rule at ink/10, with the last row's rule dropped.
 * The version this replaces put the same content in a bordered grid with a 1px
 * gap painted by the container's background — a technique that works on a dark
 * page, where the gap reads as a seam, and turns into a visible grey lattice
 * on paper.
 *
 * The rule stops at the last row deliberately. A trailing rule under the final
 * item reads as the start of something that never arrives.
 */
export function XFeatureList({ items }: { items: readonly string[] }) {
  return (
    <ul className="w-full">
      {items.map((item, i) => (
        <li
          key={item}
          className={`flex w-full py-3 text-[16px] leading-[1.5] text-[var(--x-ink-80)] ${
            i === items.length - 1 ? "" : X_RULE_B
          }`}
        >
          {item}
        </li>
      ))}
    </ul>
  );
}
