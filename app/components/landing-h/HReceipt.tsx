import { HGravityLab } from "./HGravityLab";
import { HReveal } from "./HReveal";
import { HERO_RUN } from "@/app/components/landing-v2/hero-run-data";

import { H_CONTAINER, H_HEADING, H_LABEL, H_PAD } from "./h-system";

/**
 * The receipt — the proof brought over from /landing/x, in the industrial
 * register. A real transcribed run's numbers (nothing written for the page),
 * and its actual artifact running live in the frame: the bill, and the thing
 * the bill paid for.
 */
const T = HERO_RUN.totals;
const COUNTERS: { k: string; v: string }[] = [
  { k: "Tools called", v: String(T.tools) },
  { k: "Lines changed", v: `+${T.added} / −${T.removed}` },
  { k: "Context used", v: `${T.context}K` },
  { k: "Spent", v: `$${T.cost.toFixed(2)} / $${T.budget}` },
];

export function HReceipt() {
  return (
    <section className={`${H_PAD} border-t border-[var(--h-line)] bg-[var(--h-deep)]`}>
      <div className={H_CONTAINER}>
        <HReveal>
          <p className={H_LABEL}>One real run, transcribed · {HERO_RUN.capturedOn}</p>
          <h2 className={`${H_HEADING} mt-5 max-w-[20ch] text-[var(--h-ink)]`}>
            The bill, from a run that happened.
          </h2>
        </HReveal>

        <HReveal delayMs={80} className="mt-12">
          <div className="grid border border-[var(--h-line)] bg-[var(--h-line)] lg:grid-cols-[1.1fr_1fr]" style={{ gap: "1px" }}>
            {/* Counters + operations */}
            <div className="bg-[var(--h-panel)] p-7">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-6">
                {COUNTERS.map((c) => (
                  <div key={c.k}>
                    <dt className={H_LABEL}>{c.k}</dt>
                    <dd className="mt-2.5 font-[family-name:var(--h-mono)] text-[26px] tabular-nums text-[var(--h-ink)]">
                      {c.v}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="mt-8 border-t border-[var(--h-line)] pt-6">
                <p className={H_LABEL}>What it did</p>
                <ol className="mt-4 flex flex-col gap-2 font-[family-name:var(--h-mono)] text-[12.5px] text-[var(--h-ink-70)]">
                  {HERO_RUN.operations.map((op, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="w-[92px] shrink-0 text-[var(--h-ink-45)]">
                        {op.kind}
                      </span>
                      <span className="text-[var(--h-ink)]">{op.detail}</span>
                    </li>
                  ))}
                </ol>
                <p className="mt-5 font-[family-name:var(--h-mono)] text-[11px] uppercase tracking-[0.1em] text-[var(--h-ink-45)]">
                  {HERO_RUN.totals.agents} agent · {HERO_RUN.durationLabel} · sandbox torn down after
                </p>
              </div>
            </div>

            {/* The live artifact the run produced */}
            <div className="flex flex-col bg-[var(--h-panel)] p-7">
              <p className={H_LABEL}>What it produced · live</p>
              <div className="relative mt-4 flex-1 overflow-hidden rounded-[6px] border border-[var(--h-line)]">
                <HGravityLab className="aspect-[16/11] w-full bg-[#06080e]" />
                <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1 font-[family-name:var(--h-mono)] text-[10.5px] uppercase tracking-[0.06em] text-white/85 backdrop-blur-sm">
                  {HERO_RUN.artifact.name} · move the cursor · click to add a body
                </span>
              </div>
            </div>
          </div>
        </HReveal>
      </div>
    </section>
  );
}
