import { MICRO_LABEL_CLASS } from "./type-scale";

/**
 * The numbers, stated once, near the top of the page.
 *
 * Every page in the visual benchmark carries a trust device above the fold —
 * a customer logo wall, a named testimonial, or a figure. RIFT had none, which
 * left the page arguing entirely from its own description of itself.
 *
 * A logo wall and a testimonial need real customers, and inventing either is
 * not an option. A figure does not: these three are already asserted further
 * down this same page, sourced from the product rather than from marketing.
 * Restating them here moves the evidence to where a reader decides whether to
 * keep scrolling, and introduces no claim the page was not already making.
 *
 *   29 archetypes  — the agent catalog (see LandingComparison)
 *   87 tools       — the Hack Workbench, across 25 categories
 *   6 vendors      — the model row (OpenAI, Anthropic, xAI, Moonshot, Alibaba, Z.ai)
 *
 * If any of these changes in the product, it changes in three places on this
 * page. The contract test asserts they agree.
 */

const PROOF = [
  {
    figure: "29",
    label: "agent archetypes",
    detail: "A catalog of specialists, not one generalist wearing hats.",
  },
  {
    figure: "87",
    label: "security tools",
    detail: "Across 25 categories, preinstalled in an isolated container.",
  },
  {
    figure: "6",
    label: "frontier vendors",
    detail:
      "OpenAI, Anthropic, xAI, Moonshot, Alibaba and Z.ai, already wired in.",
  },
] as const;

export function ProofStrip() {
  return (
    <section aria-label="By the numbers" className="border-y border-border">
      <div className="mx-auto w-full max-w-[1240px] px-6 py-14 sm:px-10">
        <p className={MICRO_LABEL_CLASS}>What ships in the box</p>
        <dl className="mt-8 grid gap-10 sm:grid-cols-3 sm:gap-8">
          {PROOF.map((item) => (
            <div key={item.label}>
              {/* Tabular figures so the three numbers sit on one optical line
                  rather than drifting with the width of a 6 against a 29. */}
              <dt className="text-[44px] font-medium leading-none tracking-[-0.03em] text-foreground [font-variant-numeric:tabular-nums]">
                {item.figure}
              </dt>
              <dd className="mt-3">
                <span className="block text-[13px] font-medium text-foreground">
                  {item.label}
                </span>
                <span className="mt-1.5 block max-w-[34ch] text-[13.5px] leading-[1.55] text-foreground/50">
                  {item.detail}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
