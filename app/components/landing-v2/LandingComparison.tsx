"use client";

import { ClaudeCode, Cursor, OpenAI } from "@lobehub/icons";
import type { ComponentType } from "react";

import { RiftLogo } from "@/components/icons/rift-logo";

/** The brand icons take a `size`; ours takes the same, so it drops straight in. */
function RiftMark({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return <RiftLogo size={size} className={className ?? "text-foreground"} />;
}

import { Reveal, Section } from "./Reveal";

import { MICRO_LABEL_CLASS } from "./type-scale";

/**
 * The comparison table.
 *
 * Written to survive being checked. Cursor, Claude Code and Codex are all
 * strong coding agents, and the rows where they match RIFT — MCP, parallel
 * agents — are printed as matches rather than quietly dropped. A table that
 * only shows the rows we win reads as marketing; a table that admits the ties
 * is the only kind anyone believes on the rows that differ.
 */

type Cell = { value: string; strong?: boolean };

/**
 * Each column is named by its mark. A table of four product names in the same
 * grey reads as a spec sheet; the logos let a reader find their own tool at a
 * glance and make the RIFT column the one that is obviously ours.
 */
const COLUMNS: {
  name: string;
  Logo: ComponentType<{ size?: number; className?: string }>;
}[] = [
  { name: "Cursor", Logo: Cursor },
  { name: "Claude Code", Logo: ClaudeCode },
  { name: "Codex", Logo: OpenAI },
  { name: "RIFT", Logo: RiftMark },
];

const ROWS: { label: string; cells: Cell[] }[] = [
  {
    label: "Runs in",
    cells: [
      { value: "Desktop IDE" },
      { value: "Terminal, IDE, web" },
      { value: "Terminal, IDE, cloud" },
      { value: "Terminal, browser, desktop", strong: true },
    ],
  },
  {
    label: "Model vendors",
    cells: [
      { value: "Multiple" },
      { value: "Anthropic" },
      { value: "OpenAI" },
      { value: "All frontier models", strong: true },
    ],
  },
  {
    label: "MCP servers",
    cells: [
      { value: "Yes" },
      { value: "Yes" },
      { value: "Yes" },
      { value: "Yes" },
    ],
  },
  {
    label: "Parallel agents",
    cells: [
      { value: "Yes" },
      { value: "Yes" },
      { value: "Yes" },
      // 29 selectable archetypes ship in the catalog; six are enabled by
      // default, which is what this row used to report and it undersold it.
      { value: "29 archetypes", strong: true },
    ],
  },
  {
    // The row every heavy user checks first, and the one where the difference
    // is largest. Stated flatly: the competitors publish weekly caps.
    label: "Weekly usage cap",
    cells: [
      { value: "Weekly limit" },
      { value: "Weekly limit" },
      { value: "Weekly limit" },
      { value: "None", strong: true },
    ],
  },
  {
    label: "Image & video generation",
    cells: [
      { value: "—" },
      { value: "—" },
      { value: "—" },
      { value: "Built in", strong: true },
    ],
  },
  {
    label: "Security toolchain",
    cells: [
      { value: "—" },
      { value: "—" },
      { value: "—" },
      { value: "87 tools", strong: true },
    ],
  },
];

export function LandingComparison() {
  return (
    <Section
      id="compare"
      eyebrow="Compare"
      title="Where RIFT is different — and where it isn't."
      lede="All four ship a capable coding agent. Two rows are where the products genuinely diverge."
    >
      <Reveal delay={0.06}>
        {/* Wide tables scroll inside their own container rather than pushing the
            page sideways on a phone. */}
        <div className="mt-12 -mx-6 overflow-x-auto px-6 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border-strong">
                <th className={`py-3 pr-4 ${MICRO_LABEL_CLASS}`}>
                  <span className="sr-only">Capability</span>
                </th>
                {COLUMNS.map((column) => (
                  <th
                    key={column.name}
                    scope="col"
                    className={`py-3 pr-4 text-[12.5px] font-medium tracking-[-0.005em] ${
                      column.name === "RIFT"
                        ? "text-foreground"
                        : "text-[var(--cursor-text-secondary)]"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <column.Logo size={16} />
                      {column.name}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.label} className="border-b border-border">
                  <th
                    scope="row"
                    className="py-4 pr-6 text-[13px] font-normal text-[var(--cursor-text-secondary)]"
                  >
                    {row.label}
                  </th>
                  {row.cells.map((cell, index) => (
                    <td
                      key={COLUMNS[index].name}
                      className={`py-4 pr-4 text-[13px] ${
                        cell.strong
                          ? "font-medium text-foreground"
                          : cell.value === "—"
                            ? "text-[var(--cursor-text-secondary)]/50"
                            : "text-foreground/80"
                      }`}
                    >
                      {cell.value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>

      <Reveal delay={0.1}>
        <p className="mt-6 max-w-[62ch] text-[12px] leading-[1.6] text-[var(--cursor-text-secondary)]">
          Reflects each product&rsquo;s shipped capabilities as of August 2026.
          If a row is out of date, it is a mistake rather than a claim —{" "}
          <a
            href="mailto:hello@riftsys.app"
            className="text-foreground underline decoration-border-strong underline-offset-[3px] hover:decoration-foreground"
          >
            tell us
          </a>{" "}
          and it gets corrected.
        </p>
      </Reveal>
    </Section>
  );
}
