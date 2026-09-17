"use client";

import Image from "next/image";

import {
  Anthropic,
  ByteDance,
  Flux,
  Google,
  Kling,
  Moonshot,
  OpenAI,
  Qwen,
  Sora,
  XAI,
  ZAI,
} from "@lobehub/icons";

import { logoNeedsPlate } from "@/app/components/mcp-logo-tone";
import { STUDIO_MODELS } from "@/app/components/landing-v2/mini-app-surfaces";
import {
  MCP_CATALOG,
  hasConfiguredMcpEndpoint,
} from "@/app/components/mcpCatalog";

import { REVEAL_EASE, revealDelay } from "./pi-reveal";
import { PI_FIG, PI_INDEX, PI_LABEL } from "./pi-system";

import { useInViewOnce } from "@/app/components/landing-v2/use-in-view";

/**
 * The marks: the model vendors, and every connector that actually works.
 *
 * Both lists are read from the product rather than typed here. The connectors
 * come from MCP_CATALOG filtered by `hasConfiguredMcpEndpoint` — the same
 * predicate the application uses to decide whether a connector can be opened
 * at all — so a logo can never appear on the marketing page for something the
 * product cannot complete. A hand-kept list drifts into being one the first
 * time an entry is pulled.
 *
 * ── The motion ──
 *
 * Emil Kowalski's rule, and the one this page needed most: motion should be
 * *interruptible and cheap*, and its job is to say something the static state
 * cannot. A grid of logos that all fade in together says only "loading". A
 * grid that lights one cell at a time, in a diagonal, says *connecting* —
 * which is the verb this section is about.
 *
 * So the wave is a function of row plus column rather than of index. It sweeps
 * across the grid from the top left instead of running along each row and
 * snapping back, the same reason a lighting cue travels a stage. 45ms a step,
 * 420ms a cell: the whole grid is lit inside a second, and no single cell is
 * slow enough to wait for.
 *
 * Hover is a spring, not the entrance easing. A lift under the pointer is a
 * physical response to a gesture and should not feel like the same kind of
 * motion as an arrival.
 */

/**
 * The vendor marks, from @lobehub/icons — the same components the other
 * landing renders, and the same six the product actually routes to. Not SVG
 * files copied into public/: a second copy of a logo is a second thing to keep
 * current when a vendor rebrands.
 */
const MODELS = [
  { name: "OpenAI", Logo: OpenAI },
  { name: "Anthropic", Logo: Anthropic },
  { name: "xAI", Logo: XAI },
  { name: "Moonshot AI", Logo: Moonshot },
  { name: "Alibaba", Logo: Qwen },
  { name: "Z.ai", Logo: ZAI },
] as const;

/**
 * The renderers behind Studio, and who makes each one.
 *
 * The names are not typed here — they come from `STUDIO_MODELS`, the same
 * list the Studio mini-app renders its model chips from, so the wall cannot
 * advertise a renderer the demo above it does not offer. Only the mark for
 * each is local, because a model name and the company that ships it are two
 * different facts and only the first one lives in the product.
 *
 * Google appears twice, for Nano Banana Pro and for Veo. That is correct
 * rather than a duplicate: the label under each names the model, and
 * collapsing them into one Google cell would say the section covers five
 * renderers when it covers six.
 */
const STUDIO_MARKS: Record<
  string,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  "Seedream 4": ByteDance,
  "Nano Banana Pro": Google,
  "Flux 2": Flux,
  "Veo 3.1": Google,
  "Kling 2.5": Kling,
  "Sora 2": Sora,
};

/** Columns at the widest breakpoint, so the diagonal is a real diagonal. */
const COLUMNS = 7;

function Mark({
  src,
  name,
  plated,
  seen,
  step,
}: {
  src: string;
  name: string;
  plated: boolean;
  seen: boolean;
  /** Position in the stagger, not a duration. */
  step: number;
}) {
  return (
    <li
      title={name}
      className={`flex h-[92px] items-center justify-center bg-[var(--pi-cell)] px-3 transition-[opacity,transform] duration-[420ms] hover:-translate-y-0.5 motion-reduce:transition-none ${REVEAL_EASE} ${revealDelay(
        step,
      )} ${seen ? "opacity-100" : "opacity-10"}`}
    >
      <span
        className={`flex size-10 items-center justify-center overflow-hidden ${
          plated ? "rounded-[2px] bg-[#ededeb]" : ""
        }`}
      >
        <Image
          src={src}
          alt={name}
          width={plated ? 26 : 36}
          height={plated ? 26 : 36}
          // Both axes auto: the plate constrains the box, object-contain
          // does the fitting, and Next warns when only one of the two
          // intrinsic dimensions is overridden by CSS.
          style={{ width: "auto", height: "auto" }}
          unoptimized
          draggable={false}
          className="select-none object-contain"
        />
      </span>
    </li>
  );
}

/**
 * The model vendors, on their own.
 *
 * Split from the connector wall deliberately. Stacking the two put twenty-odd
 * logos in one column of the page, and a reader scrolling past could not tell
 * where "the models this runs on" ended and "the tools it connects to" began —
 * two different claims reading as one wall of marks. The vendors belong beside
 * Build, which is what routes to them; the connectors belong in Plugins.
 */
export function PiModelMarks() {
  const [ref, seen] = useInViewOnce<HTMLDivElement>(0.12);

  return (
    <div ref={ref}>
      <div className="relative border border-[var(--pi-line)] bg-[var(--pi-cell)]">
        <span
          className={`absolute -left-px -top-px z-10 border border-l-0 border-t-0 border-[var(--pi-line)] bg-[var(--pi-cell)] px-2.5 py-1.5 ${PI_FIG}`}
        >
          Models behind one bill
        </span>
        <ul className="grid grid-cols-3 gap-px border-t-[44px] border-[var(--pi-cell)] bg-[var(--pi-line)] sm:grid-cols-6">
          {MODELS.map((model, index) => (
            <li
              key={model.name}
              className={`flex h-[104px] flex-col items-center justify-center gap-2.5 bg-[var(--pi-cell)] transition-[opacity,transform] duration-[420ms] hover:-translate-y-0.5 motion-reduce:transition-none ${REVEAL_EASE} ${revealDelay(
                index,
              )} ${seen ? "opacity-100" : "opacity-10"}`}
            >
              <model.Logo size={26} className="text-[var(--pi-ink)]" />
              <span className={`${PI_INDEX} normal-case`}>{model.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * The renderers, on their own.
 *
 * Same construction as the model wall above Build, and deliberately so: two
 * sections that both mean "these are the engines behind this surface" should
 * not be two different graphics. What differs is only which list is read.
 */
export function PiStudioMarks() {
  const [ref, seen] = useInViewOnce<HTMLDivElement>(0.12);

  return (
    <div ref={ref}>
      <div className="relative border border-[var(--pi-line)] bg-[var(--pi-cell)]">
        <span
          className={`absolute -left-px -top-px z-10 border border-l-0 border-t-0 border-[var(--pi-line)] bg-[var(--pi-cell)] px-2.5 py-1.5 ${PI_FIG}`}
        >
          Renderers behind one prompt box
        </span>
        <ul className="grid grid-cols-3 gap-px border-t-[44px] border-[var(--pi-cell)] bg-[var(--pi-line)] sm:grid-cols-6">
          {STUDIO_MODELS.map((model, index) => {
            const Mark = STUDIO_MARKS[model];
            return (
              <li
                key={model}
                className={`flex h-[104px] flex-col items-center justify-center gap-2.5 bg-[var(--pi-cell)] px-2 text-center transition-[opacity,transform] duration-[420ms] hover:-translate-y-0.5 motion-reduce:transition-none ${REVEAL_EASE} ${revealDelay(
                  index,
                )} ${seen ? "opacity-100" : "opacity-10"}`}
              >
                {Mark ? (
                  <Mark size={26} className="text-[var(--pi-ink)]" />
                ) : null}
                <span className={`${PI_INDEX} normal-case`}>{model}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** Every connector the product can actually open. */
export function PiConnectorMarks() {
  const connectable = MCP_CATALOG.filter(hasConfiguredMcpEndpoint);
  const [ref, seen] = useInViewOnce<HTMLDivElement>(0.12);

  return (
    <div ref={ref}>
      <div className="relative border border-[var(--pi-line)] bg-[var(--pi-cell)]">
        <span
          className={`absolute -left-px -top-px z-10 border border-l-0 border-t-0 border-[var(--pi-line)] bg-[var(--pi-cell)] px-2.5 py-1.5 ${PI_FIG}`}
        >
          Connectors that open
        </span>
        <ul className="grid grid-cols-4 gap-px border-t-[44px] border-[var(--pi-cell)] bg-[var(--pi-line)] sm:grid-cols-5 lg:grid-cols-7">
          {connectable.map((entry, index) => {
            const row = Math.floor(index / COLUMNS);
            const column = index % COLUMNS;
            return (
              <Mark
                key={entry.id}
                src={entry.logoPath}
                name={entry.name}
                plated={logoNeedsPlate(entry.logoPath)}
                seen={seen}
                step={row + column}
              />
            );
          })}
        </ul>
        <p
          className={`border-t border-[var(--pi-line)] px-4 py-3 ${PI_LABEL} normal-case`}
        >
          <span className="text-[var(--pi-dim)]">
            These arrive with a verified endpoint. Any other MCP server connects
            by URL.
          </span>
        </p>
      </div>
    </div>
  );
}
