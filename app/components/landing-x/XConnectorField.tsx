import Image from "next/image";

import { logoNeedsPlate } from "@/app/components/mcp-logo-tone";

import { CONNECTORS } from "./x-mark-data";
import { Reveal } from "./reveal";
import {
  X_CAPTION,
  X_CONTAINER,
  X_INTRO,
  X_LABEL,
  X_SECTION,
  X_SECTION_PAD,
} from "./x-system";

/**
 * The connectors — logos only, name on hover.
 *
 * This has been three things: a bare tile grid, then a wall of captioned
 * cards, now a single row of logo pucks with the name surfacing on hover. The
 * card version answered *what does each do* at the cost of a screen of text in
 * a section whose whole job is to say "a lot, and you recognise them". A wall
 * of marks says that in one glance; the name is one hover away for anyone who
 * wants it, and the description lives in the product, not the landing.
 *
 * `CONNECTORS` is the catalogue filtered by the exact endpoint check the
 * product gates on, so nothing shows here that would fail the moment a visitor
 * signed up and clicked it.
 */
export function XConnectorField() {
  return (
    <section id="connect" className={`${X_SECTION_PAD} scroll-mt-24`}>
      <div className={X_CONTAINER}>
        <Reveal>
          <p className={X_LABEL}>Connect</p>
          <h2
            className={`${X_SECTION} mt-4 max-w-[16ch] text-balance text-[var(--x-ink)]`}
          >
            It reaches the rest of your stack
          </h2>
          <p className={`${X_INTRO} mt-4 max-w-[520px]`}>
            Preconfigured and one click from connected. Anything else joins
            by URL, with OAuth handled and credentials kept in a vault.
          </p>
        </Reveal>

        <Reveal step={1}>
          {/* One row, wrapping. Logo only; the name rises on hover. */}
          <ul className="mt-10 flex flex-wrap gap-2.5">
            {CONNECTORS.map((entry) => {
              const plated = logoNeedsPlate(entry.logoPath);
              return (
                <li key={entry.id} className="group relative">
                  <span className="flex size-12 items-center justify-center rounded-[12px] bg-[var(--x-raise)] transition-colors duration-200 group-hover:bg-[var(--x-raise-strong)] motion-reduce:transition-none">
                    <Image
                      src={entry.logoPath}
                      alt={entry.name}
                      width={26}
                      height={26}
                      loading="eager"
                      decoding="sync"
                      className={`size-[26px] rounded-[6px] object-contain transition-transform duration-200 group-hover:scale-110 motion-reduce:transition-none ${
                        plated ? "bg-white p-[3px]" : ""
                      }`}
                    />
                  </span>
                  {/* The name, on hover — a small tooltip above the puck. */}
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-[6px] bg-[var(--x-ink)] px-2 py-1 text-[11px] font-medium tracking-[-0.01em] text-[var(--x-ground)] opacity-0 transition-[opacity,transform] duration-150 group-hover:translate-y-0 group-hover:opacity-100 motion-reduce:transition-none"
                  >
                    {entry.name}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className={`${X_CAPTION} mt-5`}>
            Preconfigured today · any other MCP server connects by URL.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
