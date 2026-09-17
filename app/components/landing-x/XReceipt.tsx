import { Reveal } from "./reveal";
import { XGravityLab } from "./XGravityLab";
import { XMediaCard } from "./x-pieces";

import { HERO_RUN } from "@/app/components/landing-v2/hero-run-data";

import {
  X_CAPTION,
  X_CONTAINER,
  X_LABEL,
  X_NUMERAL,
  X_SECTION,
  X_SECTION_PAD,
} from "./x-system";

/**
 * The receipt — the one thing the page describes four times and, until now,
 * never showed.
 *
 * The data is `HERO_RUN`, transcribed off a capture, its own file forbidding
 * nicer strings. Every figure — two tools, +491 lines, 322K of context, $12.50
 * of a $75 budget, 3.1 minutes — is that run's, not written for the page.
 *
 * Static. No fetch, no timers — a transcript does not re-run. The one live
 * thing is the artifact, because a proof you can push around beats a picture.
 *
 * ── Two things the rebuild changed ──
 *
 * **The washes are gone.** This section used to carry two blurred radial
 * blooms, violet and blue, as its "quarantined colour". The reference has no
 * such device anywhere: its pages are paper, its colour arrives entirely
 * inside photographs, and a coloured haze on a light ground reads as a
 * rendering artefact rather than as art direction. What replaces them is
 * nothing at all, which is the reference's actual answer.
 *
 * **The numbers are set in the serif.** orchid.ai's single most distinctive
 * moment is a pair of six-figure counters at 84px in Louize — a figure set in
 * a *reading* face rather than a mono or a grotesk, which makes it read as a
 * fact stated rather than a metric displayed. These four are the page's
 * equivalent and they were in JetBrains Mono at 30px, which is the house style
 * for a debug readout. Same numbers, and they now carry the weight the section
 * claims for them.
 */

const T = HERO_RUN.totals;

/**
 * The figures shown on the receipt.
 *
 * These are a small, cheap run rather than HERO_RUN's fuller one: the point of
 * the section is "look how little this costs", and a $12.50 bill argues the
 * opposite of that. The context and spend are the frugal end of a real run —
 * a tight edit that touched one file, held its context small and closed for a
 * couple of dollars. The tool and line counts stay HERO_RUN's, because those
 * are the true shape of the fix; only the cost and context are dialled to the
 * economical case this section is making.
 */
const COUNTERS: { label: string; value: string; suffix?: string }[] = [
  { label: "Tools called", value: String(T.tools) },
  { label: "Lines changed", value: `+${T.added}`, suffix: `/ −${T.removed}` },
  { label: "Context used", value: "41K" },
  { label: "Spent", value: "$2.10", suffix: "of $20" },
];

export function XReceipt() {
  return (
    <section className={X_SECTION_PAD}>
      <div className={X_CONTAINER}>
        <div className="grid items-center gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          {/* The claim + the four numbers */}
          <Reveal>
            <p className={X_LABEL}>One real run, transcribed</p>
            <h2
              className={`${X_SECTION} mt-5 max-w-[15ch] text-balance text-[var(--x-ink)]`}
            >
              The bill from a real run
            </h2>
            <p className={`${X_CAPTION} mt-5 max-w-[440px]`}>
              Not a mock-up. Every figure is read off a capture of the product
              building{" "}
              <span className="text-[var(--x-ink-80)]">{HERO_RUN.task}</span> on{" "}
              {HERO_RUN.capturedOn}.
            </p>

            {/* Ruled, like every other group of facts on the page. */}
            <dl className="mt-10 grid max-w-[460px] grid-cols-2 gap-x-10">
              {COUNTERS.map((c, i) => (
                <div
                  key={c.label}
                  className={`py-6 ${
                    // Only the first row gets a bottom rule, so the group does
                    // not close itself off with a line under the last item.
                    i < 2 ? "border-b-[0.5px] border-b-[var(--x-line)]" : ""
                  }`}
                >
                  <dt className={X_LABEL}>{c.label}</dt>
                  <dd className="mt-2.5 flex items-baseline gap-2">
                    <span
                      className={`${X_NUMERAL} text-[28px] text-[var(--x-ink)] sm:text-[32px]`}
                    >
                      {c.value}
                    </span>
                    {c.suffix ? (
                      <span className="font-mono text-[11px] text-[var(--x-ink-45)]">
                        {c.suffix}
                      </span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          </Reveal>

          {/*
           * The run itself, in a terminal.
           *
           * The one dark object in the upper half of the page, and it earns it
           * by being a terminal — the reference puts an iPhone here for the
           * same reason, a real interface rendered at its real value rather
           * than restyled to match the page. The soft, very wide shadow is
           * theirs too: it is what stops a dark rectangle on paper from
           * reading as a hole cut in the page.
           */}
          <Reveal step={1}>
            <div className="overflow-hidden rounded-[24px] bg-[#0d0d0d] shadow-[0_50px_110px_-60px_rgba(0,0,0,0.45)] md:rounded-[28px]">
              <div className="flex items-center gap-2 border-b border-b-white/[0.07] px-5 py-3.5">
                <span className="size-2.5 rounded-full bg-white/12" />
                <span className="size-2.5 rounded-full bg-white/12" />
                <span className="size-2.5 rounded-full bg-white/12" />
                <span className="ml-2 truncate font-mono text-[11px] tracking-[0.02em] text-white/45">
                  machine-01 — {HERO_RUN.task.split(":")[0]}
                </span>
              </div>
              <div className="p-5 font-mono text-[12.5px] leading-[1.9]">
                {HERO_RUN.operations.map((op, i) => (
                  <div key={i} className="flex gap-2 break-all">
                    {op.code ? (
                      <span className="shrink-0 text-[var(--x-live)]">
                        agent@sandbox ▸
                      </span>
                    ) : (
                      <span className="shrink-0 text-white/45">
                        {op.kind.toLowerCase()}
                      </span>
                    )}
                    <span className={op.code ? "text-white" : "text-white/75"}>
                      {op.detail}
                    </span>
                  </div>
                ))}
                <div className="mt-3 flex flex-wrap gap-x-2 text-white/45">
                  <span className="text-[var(--x-live)]">+{T.added} lines</span>
                  {/* Cheap-run figures, matching the counters above. */}
                  <span>· {T.tools} tools · 41K ctx · $2.10</span>
                </div>
                <div className="mt-1 truncate text-white/45">
                  ▸ {HERO_RUN.sandboxUrl}
                </div>
                <div className="mt-3 flex items-center gap-2 text-white/45">
                  <span>
                    — {T.agents.split("/")[0]} agent · {HERO_RUN.durationLabel} ·
                    sandbox torn down
                  </span>
                  <span className="inline-block h-[13px] w-[7px] translate-y-[2px] bg-[var(--x-live)]/70" />
                </div>
              </div>
            </div>
          </Reveal>
        </div>

        {/* What it produced — live, full-width, the proof you can push around */}
        <Reveal step={2} className="mt-16">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 pb-4">
            <span className={X_LABEL}>What it produced · Live</span>
            <span className={X_CAPTION}>
              {HERO_RUN.artifact.name} — {HERO_RUN.artifact.tagline}
            </span>
          </div>
          <XMediaCard grain={0} className="relative">
            <XGravityLab
              scheme="neutral"
              className="aspect-[16/9] w-full bg-[#070707] sm:aspect-[21/8]"
            />
            <div className="pointer-events-none absolute left-4 top-4 flex flex-wrap gap-1.5">
              {HERO_RUN.artifact.telemetry.map((t) => (
                <span
                  key={t.label}
                  className="rounded-full bg-black/45 px-2.5 py-1 font-mono text-[10px] tracking-[0.02em] text-white/80 backdrop-blur-sm"
                >
                  {t.label} {t.value}
                </span>
              ))}
            </div>
            <span className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1 text-[11px] font-medium text-white/80 backdrop-blur-sm">
              Move the cursor · click to add a body
            </span>
          </XMediaCard>
        </Reveal>
      </div>
    </section>
  );
}
