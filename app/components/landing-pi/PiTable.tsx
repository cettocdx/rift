"use client";

import { ClaudeCode, Cursor, OpenAI } from "@lobehub/icons";
import type { ComponentType } from "react";

import { RiftLogo } from "@/components/icons/rift-logo";

import { useInViewOnce } from "@/app/components/landing-v2/use-in-view";
import { REVEAL_EASE, revealDelay } from "./pi-reveal";
import { PI_FIG, PI_INDEX, PI_LABEL } from "./pi-system";

/**
 * The eval table — the last of primeintellect.ai's graphic types.
 *
 * Their page carries four kinds of figure and this page had three of them: the
 * dot field, the hairline isometric, and the run chart. The fourth is the one
 * that does the most work on their site and it is the plainest of the set — a
 * dense monospace table with a hairline under every row, the winning column in
 * full white and everything else at 45%, and no chart dressing at all.
 *
 * It is worth copying because of what it signals rather than what it shows. A
 * bar chart is an argument the reader has to take on trust; a table is a set
 * of claims laid out to be checked one at a time. Prime uses it for benchmark
 * scores. The equivalent claim on this page is the capability matrix, so that
 * is what goes in it.
 *
 * ── On the contents ──
 *
 * The rows are the same ones the other landing prints, and deliberately keep
 * the ones where the four products tie. A table showing only the rows we win
 * is read as marketing and discounted whole; a table that prints
 * `Yes / Yes / Yes / Yes` on MCP is the only kind anyone believes on the rows
 * that actually differ.
 *
 * The caption counts the ties rather than stating a number, because the first
 * draft stated one and it was wrong — the prose said three, the comment said
 * two, and the data has one. A hand-written count next to a table is a claim
 * about that table that nothing keeps honest.
 */

/** The brand icons take a `size`; ours takes the same, so it drops in. */
function RiftMark({ size = 15 }: { size?: number }) {
  return <RiftLogo size={size} className="text-[var(--pi-ink)]" />;
}

const COLUMNS: {
  name: string;
  Logo: ComponentType<{ size?: number; className?: string }>;
  ours?: boolean;
}[] = [
  { name: "Cursor", Logo: Cursor },
  { name: "Claude Code", Logo: ClaudeCode },
  { name: "Codex", Logo: OpenAI },
  { name: "RIFT", Logo: RiftMark, ours: true },
];

type Row = { label: string; cells: readonly string[] };

const ROWS: readonly Row[] = [
  {
    label: "Runs in",
    cells: [
      "Desktop IDE",
      "Terminal, IDE, web",
      "Terminal, IDE, cloud",
      "Terminal, browser, desktop",
    ],
  },
  {
    label: "Model vendors",
    cells: ["Multiple", "Anthropic", "OpenAI", "All frontier models"],
  },
  { label: "MCP servers", cells: ["Yes", "Yes", "Yes", "Yes"] },
  { label: "Parallel agents", cells: ["Yes", "Yes", "Yes", "29 archetypes"] },
  {
    label: "Weekly usage cap",
    cells: ["Weekly limit", "Weekly limit", "Weekly limit", "None"],
  },
  {
    label: "Image & video generation",
    cells: ["—", "—", "—", "Built in"],
  },
  { label: "Security toolchain", cells: ["—", "—", "—", "87 tools"] },
];

/** A tie prints in the same tone in all four columns; nothing is emphasised. */
const isTie = (row: Row) => new Set(row.cells).size === 1;

/** Counted from the rows, so the caption cannot drift away from the table. */
const TIES = ROWS.filter(isTie).length;

export function PiEvalTable() {
  const [ref, seen] = useInViewOnce<HTMLDivElement>(0.1);

  return (
    <div ref={ref}>
      <section className="relative border border-[var(--pi-line)] bg-[var(--pi-cell)]">
        <span
          className={`absolute -left-px -top-px z-10 border border-l-0 border-t-0 border-[var(--pi-line)] bg-[var(--pi-cell)] px-2.5 py-1.5 ${PI_FIG}`}
        >
          Capability matrix
        </span>

        {/* A wide table scrolls inside its own box rather than pushing the
            page sideways on a phone. */}
        <div className="overflow-x-auto pt-11">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[var(--pi-line)]">
                <th
                  scope="col"
                  className={`py-3 pl-5 pr-6 ${PI_INDEX} font-normal`}
                >
                  Capability
                </th>
                {COLUMNS.map((column) => (
                  <th
                    key={column.name}
                    scope="col"
                    className={`py-3 pr-6 font-normal last:pr-5 ${
                      column.ours ? PI_LABEL : PI_INDEX
                    } normal-case`}
                  >
                    <span className="flex items-center gap-2 whitespace-nowrap text-[12.5px]">
                      <column.Logo size={15} />
                      {column.name}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {ROWS.map((row, rowIndex) => {
                const tie = isTie(row);
                return (
                  <tr
                    key={row.label}
                    className={`border-b border-[var(--pi-line-soft)] transition-opacity duration-[400ms] last:border-b-0 motion-reduce:transition-none ${REVEAL_EASE} ${revealDelay(
                      rowIndex,
                    )} ${seen ? "opacity-100" : "opacity-15"}`}
                  >
                    <td className="py-3.5 pl-5 pr-6 align-top text-[14px] leading-[1.45] text-[var(--pi-dim)]">
                      {row.label}
                    </td>
                    {row.cells.map((cell, cellIndex) => {
                      const ours = COLUMNS[cellIndex]?.ours;
                      return (
                        <td
                          key={COLUMNS[cellIndex]?.name ?? cellIndex}
                          className={`py-3.5 pr-6 align-top text-[14px] leading-[1.45] last:pr-5 ${
                            ours && !tie
                              ? "text-[var(--pi-ink)]"
                              : "text-[rgba(255,255,255,0.45)]"
                          }`}
                        >
                          {cell}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p
          className={`border-t border-[var(--pi-line)] px-5 py-3 ${PI_INDEX} normal-case`}
        >
          {TIES === 1
            ? "One row ties across all four. It is printed as a tie."
            : `${TIES} rows tie across all four. They are printed as ties.`}
        </p>
      </section>
    </div>
  );
}
