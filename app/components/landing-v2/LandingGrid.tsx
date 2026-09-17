"use client";

/**
 * A section boundary, vercel.com's.
 *
 * Solid, one pixel, rgb(31,31,31), running the full width of the viewport
 * rather than stopping at the content column — measured on their page, where
 * every section is separated by exactly this and nothing else.
 *
 * It replaced a dashed rule with a bright square node at each end, plus a pair
 * of continuous dashed verticals down the whole page. That was tempo.new's
 * drafting grid, and it was doing real work here: it tied the sections
 * together when they read as unrelated slabs, and it gave an empty ground
 * something to be. But it is not this page's language any more, and two grid
 * systems on one page is one too many — Vercel separates with a single line
 * and lets the space either side carry the rhythm.
 */
export function GridRule({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`h-px w-full bg-[var(--grid-line)] ${className}`}
    />
  );
}
