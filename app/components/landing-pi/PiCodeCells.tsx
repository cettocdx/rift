"use client";

import { useState } from "react";

import {
  MCP_CATALOG,
  hasConfiguredMcpEndpoint,
} from "@/app/components/mcpCatalog";

import {
  BUILD_RUNS,
  WORKBENCH_LINES,
} from "@/app/components/landing-v2/mini-app-surfaces";

import { useInViewOnce } from "@/app/components/landing-v2/use-in-view";
import { PI_INDEX, PI_LABEL } from "./pi-system";

/**
 * Three artefacts, side by side — the reference's code triptych.
 *
 * Theirs sits under the Environment Hub: `Verifiers`, `Prime-RL`, `Sandboxes`,
 * each a code cell with line numbers and a copy button, each with one line of
 * caption underneath. It is the densest evidence on their page and the device
 * this one was missing, because a code block is the one graphic a reader can
 * check rather than admire.
 *
 * ── What is in ours ──
 *
 * Three different *kinds* of artefact rather than three snippets of the same
 * language, and all three are real:
 *
 *   1. The reconnaissance transcript, from the module the live Workbench demo
 *      prints — the same lines a visitor's own authorised pass produces.
 *   2. A connector config, whose URL is read out of `MCP_CATALOG` rather than
 *      typed here, so it is an endpoint the product will actually open.
 *   3. The agent's own step log for a recorded run, from `BUILD_RUNS`, with
 *      its real totals.
 *
 * Nothing here is illustrative. A code block that cannot be pasted is the most
 * expensive kind of decoration a technical page can carry, because it is the
 * element a technical reader will actually try.
 *
 * ── On colour ──
 *
 * The reference colours its code green and blue. This does not, and the
 * restraint is the same one the whole page runs on: RIFT has no accent hue
 * anywhere, so a syntax palette would arrive from nowhere and read as
 * borrowed. Three tones carry the same structure — what you type at full
 * white, what it takes at 62%, what comes back at 42% — and a monospace block
 * with a considered tonal hierarchy is not a lesser thing than a coloured one.
 */

/** A line and how loudly it should read. */
type Tone = "in" | "arg" | "out" | "note";
type Line = { text: string; tone?: Tone };

const TONE: Record<Tone, string> = {
  in: "text-[var(--pi-ink)]",
  arg: "text-[var(--pi-dim)]",
  out: "text-[rgba(255,255,255,0.52)]",
  note: "text-[var(--pi-faint)]",
};

/** The first connectable endpoint in the catalog — a URL that resolves. */
const CONNECTOR = MCP_CATALOG.filter(hasConfiguredMcpEndpoint)[0];

/** The recorded run the rest of the page already uses. */
const RUN = BUILD_RUNS[0];

const CELLS: {
  title: string;
  href: string;
  caption: string;
  lines: readonly Line[];
}[] = [
  {
    title: "Sandbox",
    href: "#workbench",
    caption:
      "What one authorised pass prints. The Workbench above runs this live, once a day per visitor.",
    lines: WORKBENCH_LINES.map((text, index) => ({
      text,
      // The declaration and the two commands are things you type; every
      // other line is what came back.
      tone: (index === 0
        ? "note"
        : /^[a-z]+ /.test(text) && index < 6 && !/^\d/.test(text)
          ? "in"
          : "out") as Tone,
    })),
  },
  {
    title: "Connectors",
    href: "#plugins",
    caption:
      "Any MCP server connects by URL. This one ships configured; the shape is the same for yours.",
    lines: [
      { text: "{", tone: "in" },
      { text: '  "mcpServers": {', tone: "in" },
      {
        text: `    "${CONNECTOR?.name.toLowerCase().replace(/\s+/g, "-") ?? "server"}": {`,
        tone: "in",
      },
      { text: '      "transport": "http",', tone: "arg" },
      { text: `      "url": "${CONNECTOR?.url ?? ""}"`, tone: "arg" },
      { text: "    }", tone: "in" },
      { text: "  }", tone: "in" },
      { text: "}", tone: "in" },
    ],
  },
  {
    title: "Run record",
    href: "#build",
    caption: `Every step, every tool, every dollar. ${RUN.tools} tools, ${RUN.seconds}s, +${RUN.diff.added} −${RUN.diff.removed}.`,
    lines: [
      { text: `> ${RUN.prompt}`, tone: "in" },
      ...RUN.ops.map((op) => ({
        text: `  ${op.verb.toLowerCase().padEnd(9)}${op.arg}`,
        tone: "out" as const,
      })),
      {
        text: `  done      +${RUN.diff.added} −${RUN.diff.removed}`,
        tone: "note" as const,
      },
    ],
  },
];

function CodeCell({ cell }: { cell: (typeof CELLS)[number] }) {
  const [copied, setCopied] = useState(false);
  const body = cell.lines.map((line) => line.text).join("\n");

  return (
    <div data-landing-chrome className="flex flex-col bg-[var(--pi-cell)] p-6">
      {/* Copy sits in the header, not floating over the code. Placed inside
          the block it landed on top of line 1 in two of the three cells —
          and line 1 is the line most worth reading. */}
      <div className="flex items-center justify-between gap-4">
        <a
          href={cell.href}
          className="group flex w-fit items-center gap-2 text-[15px] text-[var(--pi-ink)] transition-colors hover:text-white motion-reduce:transition-none"
        >
          {cell.title}
          <span
            aria-hidden
            className="text-[var(--pi-faint)] group-hover:text-[var(--pi-ink)]"
          >
            ›
          </span>
        </a>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(body).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
          aria-label={`Copy the ${cell.title} block`}
          className={`shrink-0 ${PI_INDEX} transition-colors hover:text-[var(--pi-ink)] motion-reduce:transition-none`}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>

      <div className="mt-4 border border-[var(--pi-line)] bg-[rgba(255,255,255,0.022)]">
        {/* Overflows inside its own box; a code block must never be the reason
            the page scrolls sideways on a phone. */}
        <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[12px] leading-[1.65]">
          {cell.lines.map((line, index) => (
            <div key={`${index}-${line.text}`} className="flex gap-3.5">
              <span
                aria-hidden
                className="w-4 shrink-0 select-none text-right text-[var(--pi-faint)]"
              >
                {index + 1}
              </span>
              <span className={`whitespace-pre ${TONE[line.tone ?? "out"]}`}>
                {line.text}
              </span>
            </div>
          ))}
        </pre>
      </div>

      <p className="mt-4 text-[13.5px] leading-[1.5] text-[var(--pi-dim)]">
        {cell.caption}
      </p>
    </div>
  );
}

export function PiCodeCells() {
  const [ref] = useInViewOnce<HTMLDivElement>(0.1);

  return (
    <div ref={ref}>
      <section className="relative border border-[var(--pi-line)] bg-[var(--pi-cell)]">
        <span
          className={`absolute -left-px -top-px z-10 border border-l-0 border-t-0 border-[var(--pi-line)] bg-[var(--pi-cell)] px-2.5 py-1.5 ${PI_LABEL}`}
        >
          Things you can paste
        </span>
        <div className="pt-11">
          <div className="grid gap-px bg-[var(--pi-line)] lg:grid-cols-3">
            {CELLS.map((cell) => (
              <CodeCell key={cell.title} cell={cell} />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
