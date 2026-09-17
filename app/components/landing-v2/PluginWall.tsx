"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "motion/react";

import {
  MCP_CATALOG,
  hasConfiguredMcpEndpoint,
} from "@/app/components/mcpCatalog";

import { logoNeedsPlate } from "@/app/components/mcp-logo-tone";

import { EASE_OUT } from "./landing-design-system";
import { useInViewOnce } from "./use-in-view";

/**
 * The providers that are actually wired, shown as marks.
 *
 * Read from the catalog the product ships rather than a list typed into the
 * marketing page, and filtered by the same predicate the app uses to decide
 * whether a connector can be opened at all. A landing page that advertises an
 * integration the product cannot complete is the worst kind of copy, and a
 * hand-kept list drifts into being one the first time an entry is pulled.
 *
 * Marks only. No category label under each logo: a reader who recognises the
 * logo does not need to be told what Stripe does, and one who does not will not
 * be helped by the word "payments".
 *
 * ── The connection sweep ──
 *
 * The wall arrives one tile at a time, in a diagonal from the top left, each
 * mark fading up from a dim state as the wave reaches it. The section's verb
 * is *connect*, and a grid that assembles itself is that verb — twenty-odd
 * services coming online in sequence, which is what the reader is being told
 * happens when they point this at their stack. A grid that simply exists says
 * nothing, and a grid where every tile fades in together says only "loading".
 */

/** Columns at the widest breakpoint, so the wave travels a real diagonal. */
const COLUMNS = 7;

export function PluginWall() {
  const connectable = MCP_CATALOG.filter(hasConfiguredMcpEndpoint);
  const reduceMotion = useReducedMotion();
  const [ref, seen] = useInViewOnce<HTMLUListElement>(0.15);

  return (
    <div className="mt-10">
      <ul
        ref={ref}
        className="grid grid-cols-3 gap-px overflow-hidden rounded-[12px] border border-border bg-border sm:grid-cols-5 lg:grid-cols-7"
      >
        {connectable.map((entry, index) => {
          // A handful of marks are near-black and vanish on this page; those
          // keep a light plate. The rest sit bare, as the connectors board
          // draws them. Measured in mcp-logo-tone.ts.
          const plated = logoNeedsPlate(entry.logoPath);
          const row = Math.floor(index / COLUMNS);
          const column = index % COLUMNS;
          const delay = (row + column) * 0.045;

          return (
            <li
              key={entry.id}
              className="flex h-[104px] items-center justify-center bg-background px-3"
            >
              <motion.span
                initial={reduceMotion ? false : { opacity: 0.12, scale: 0.86 }}
                animate={
                  reduceMotion || seen ? { opacity: 1, scale: 1 } : undefined
                }
                transition={{ duration: 0.42, delay, ease: EASE_OUT }}
                className={`flex size-11 items-center justify-center overflow-hidden ${
                  plated ? "rounded-[8px] bg-[#ededeb]" : ""
                }`}
              >
                <Image
                  src={entry.logoPath}
                  alt={entry.name}
                  width={plated ? 28 : 40}
                  height={plated ? 28 : 40}
                  // Both axes auto: the plate constrains the box, object-contain
                  // does the fitting, and Next warns when only one of the two
                  // intrinsic dimensions is overridden by CSS.
                  style={{ width: "auto", height: "auto" }}
                  unoptimized
                  draggable={false}
                  className="select-none object-contain"
                />
              </motion.span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[12px] text-muted-foreground">
        {/* No count. These are the providers that arrive verified, but the
            number is not the claim: any MCP server connects by URL, so a
            figure here would read as a ceiling that does not exist. */}
        These arrive with a verified endpoint. Any other MCP server connects by
        URL.
      </p>
    </div>
  );
}
