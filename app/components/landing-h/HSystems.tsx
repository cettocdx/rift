import {
  CONNECTORS,
  RENDERERS,
  VENDORS,
} from "@/app/components/landing-x/x-mark-data";

import { logoNeedsPlate } from "@/app/components/mcp-logo-tone";

import { HReveal } from "./HReveal";
import { H_CONTAINER, H_HEADING, H_LABEL, H_PAD } from "./h-system";

/**
 * The systems board — not three stacked rows but one dense spec grid, the way
 * Factory lists a machine's components. Reasoning and rendering models fill a
 * bordered cell grid (logo, mono designation, a role tag); connectors run
 * beneath as a compact strip. Everything is read from the product's modules.
 */

type Cell = {
  id: string;
  name: string;
  role: string;
  Logo?: React.ComponentType<{ size?: number; className?: string }>;
};

const MODELS: Cell[] = [
  ...VENDORS.map((v) => ({
    id: `v-${v.id}`,
    name: v.name,
    role: "reasoning",
    Logo: v.Logo,
  })),
  ...RENDERERS.map((m) => ({
    id: `r-${m.id}`,
    name: m.name,
    role: /veo|kling|seedance|imagine video/i.test(m.name) ? "video" : "image",
    Logo: m.Logo ?? undefined,
  })),
];

export function HSystems() {
  const connectors = CONNECTORS.slice(0, 14);
  return (
    <section
      className={`${H_PAD} border-t border-[var(--h-line)] bg-[var(--h-ground)]`}
    >
      <div className={H_CONTAINER}>
        <HReveal>
          <p className={H_LABEL}>Systems · {MODELS.length} models</p>
          <h2 className={`${H_HEADING} mt-5 max-w-[22ch] text-[var(--h-ink)]`}>
            Every frontier model. Every connector. One key.
          </h2>
        </HReveal>

        {/* The model grid — dense, bordered, mono designations. */}
        <HReveal delayMs={80} className="mt-12">
          <ul className="grid grid-cols-2 gap-px border border-[var(--h-line)] bg-[var(--h-line)] sm:grid-cols-3 lg:grid-cols-4">
            {MODELS.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-3 bg-[var(--h-panel)] px-4 py-3.5"
              >
                {m.Logo ? (
                  <m.Logo size={20} className="shrink-0 text-[var(--h-ink)]" />
                ) : (
                  <span className="size-5 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate text-[13px] tracking-[-0.01em] text-[var(--h-ink)]">
                  {m.name}
                </span>
                <span className="font-[family-name:var(--h-mono)] text-[9px] uppercase tracking-[0.1em] text-[var(--h-ink-45)]">
                  {m.role}
                </span>
              </li>
            ))}
          </ul>
        </HReveal>

        {/* Connectors — a compact strip, not another stacked row. */}
        <HReveal delayMs={120} className="mt-6">
          <div className="flex flex-col gap-4 border border-[var(--h-line)] bg-[var(--h-panel)] px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
            <span className={H_LABEL}>
              Connectors · and any MCP server, by URL
            </span>
            <ul className="flex flex-wrap items-center gap-2.5">
              {connectors.map((entry) => {
                const plated = logoNeedsPlate(entry.logoPath);
                return (
                  <li key={entry.id} title={entry.name}>
                    <span className="flex size-8 items-center justify-center rounded-[5px] border border-[var(--h-line)] bg-[var(--h-ground)]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={entry.logoPath}
                        alt={entry.name}
                        width={18}
                        height={18}
                        loading="eager"
                        decoding="sync"
                        className={`size-[18px] rounded-[3px] object-contain ${plated ? "" : ""}`}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </HReveal>
      </div>
    </section>
  );
}
