"use client";

import type { ReactNode } from "react";

import {
  PI_FIG,
  PI_HEADING,
  PI_HEADING_LEAD,
  PI_HEADING_REST,
  PI_INDEX,
  PI_LABEL,
} from "./pi-system";

/**
 * The grid cell — the unit the whole page is built from.
 *
 * primeintellect.ai draws a 1px rgb(32,32,32) hairline 150 times across its
 * page, and content lives *inside* those cells rather than floating in
 * whitespace. That is the structural difference between it and every other
 * page in the set: the rules are not decoration laid over a layout, they are
 * the layout.
 *
 * The figure label is the second half of the device. `FIG.1`, `FIG.2`,
 * `CASE STUDY`, `READ MORE` sit tucked into a cell's corner, on the rule
 * itself, in monospace. It is the grammar of a scientific paper, and it costs
 * one absolutely-positioned span.
 */
export function PiCell({
  fig,
  children,
  className = "",
  bleed = false,
}: {
  /** The corner label. `FIG.3`, `CASE STUDY` — omit for an unlabelled cell. */
  fig?: string;
  children: ReactNode;
  className?: string;
  /** Content runs to the cell edge; used for figures and photography. */
  bleed?: boolean;
}) {
  return (
    <section
      className={`relative border border-[var(--pi-line)] bg-[var(--pi-cell)] ${className}`}
    >
      {fig ? (
        <span
          className={`absolute -left-px -top-px z-10 border border-l-0 border-t-0 border-[var(--pi-line)] px-2.5 py-1.5 ${PI_FIG}`}
        >
          {fig}
        </span>
      ) : null}
      <div className={bleed ? "" : fig ? "px-7 pb-8 pt-14" : "p-7"}>
        {children}
      </div>
    </section>
  );
}

/**
 * Their headline: a bright noun, then the sentence at 50%.
 *
 * `Lab.` at full white, `Post-train your own self improving agents` at half —
 * same size, same weight, opacity doing the entire hierarchy. Repeated without
 * variation for Inference., Compute., Research. Two spans and no second type
 * size is the cheapest hierarchy on that page and the most worth taking.
 */
export function PiHeading({
  lead,
  rest,
  className = "",
}: {
  lead: string;
  rest: string;
  className?: string;
}) {
  return (
    <h2 className={`${PI_HEADING} ${className}`}>
      <span className={PI_HEADING_LEAD}>{lead}</span>{" "}
      <span className={PI_HEADING_REST}>{rest}</span>
    </h2>
  );
}

/**
 * A section's claims, one per hairline row.
 *
 * These used to carry a decimal index — `1.1`, `1.2`, `1.3` — copied from the
 * reference page along with everything else. It was removed because it was
 * decoration wearing the clothes of structure: a three-item list is not an
 * outline, nobody cross-references `1.2`, and the numbers were doing nothing
 * except making the page look like a specification.
 *
 * The rule between rows already separates them, which was the only job the
 * numbers were actually doing.
 */
export function PiFeatureList({ items }: { items: readonly string[] }) {
  return (
    <ul className="flex flex-col">
      {items.map((item) => (
        <li
          key={item}
          className="border-t border-[var(--pi-line-soft)] py-3.5 text-[14.5px] leading-[1.5] text-[var(--pi-dim)] first:border-t-0 first:pt-0"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

/** A section's number and name, their pairing: `03 Hosted Training`. */
export function PiSectionTitle({
  index,
  name,
}: {
  index: string;
  name: string;
}) {
  return (
    <p className="flex items-baseline gap-3">
      <span className={PI_INDEX}>{index}</span>
      <span className={`${PI_LABEL} normal-case text-[17px]`}>{name}</span>
    </p>
  );
}
