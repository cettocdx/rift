"use client";

import Image from "next/image";

import { logoNeedsPlate } from "@/app/components/mcp-logo-tone";
import {
  MCP_CATALOG,
  hasConfiguredMcpEndpoint,
} from "@/app/components/mcpCatalog";

import { CONTAINER, MICRO } from "./landing-design-system";

/**
 * The marks, directly under the hero.
 *
 * This is the move claude.com/product/claude-code makes and it is the strongest
 * one available to a product with no customer logos yet: a row of tools the
 * reader already uses, right where they are deciding whether to keep scrolling.
 * It says "this fits into what you have" without claiming anyone in particular
 * uses it — which is a claim we cannot honestly make.
 *
 * Ours is better sourced than theirs. The list is not typed here: it is
 * MCP_CATALOG filtered by the same predicate the application uses to decide
 * whether a connector can actually be opened, so a mark can never appear on the
 * marketing page for something the product cannot complete.
 *
 * The full wall stays in the Plugins section — this is the same data at glance
 * size, not a second copy of the argument.
 */
export function IntegrationStrip() {
  const connectable = MCP_CATALOG.filter(hasConfiguredMcpEndpoint);

  return (
    <section
      aria-label="Integrations"
      className={`${CONTAINER} pt-14 lg:pt-16`}
    >
      <p className={MICRO}>Connects to what you already use</p>

      {/* A row of marks, not a grid of cells. Bordered tiles at this size would
          put fourteen boxes between the reader and the product they just used;
          the marks alone carry it. */}
      <ul className="mt-5 flex flex-wrap items-center gap-x-7 gap-y-5">
        {connectable.map((entry) => {
          // A handful of marks are near-black and vanish on this ground; those
          // keep a light plate. Measured in mcp-logo-tone.ts.
          const plated = logoNeedsPlate(entry.logoPath);
          return (
            <li key={entry.id} className="flex items-center">
              <span
                title={entry.name}
                // Full strength. A first pass held these at 70% to keep the
                // row quiet, and the two mid-luminance marks — Cloudflare at
                // 159, Notion at 113 — dropped out of the row entirely at 28px
                // on this ground. The job of the strip is recognition; dimming
                // it is dimming the only thing it does.
                className={`flex size-8 items-center justify-center overflow-hidden ${
                  plated ? "rounded-[6px] bg-[#ededeb]" : ""
                }`}
              >
                <Image
                  src={entry.logoPath}
                  alt={entry.name}
                  width={plated ? 20 : 28}
                  height={plated ? 20 : 28}
                  unoptimized
                  draggable={false}
                  className="select-none object-contain"
                />
              </span>
            </li>
          );
        })}
      </ul>

      <p className={`mt-5 ${MICRO}`}>
        Verified endpoints · any other MCP server connects by URL
      </p>
    </section>
  );
}
