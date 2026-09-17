import { HReveal } from "./HReveal";
import { AGENT_PET_CATALOG } from "@/lib/ai/agents/pet-roster";
import { BUILD_MODELS, MEDIA_MODELS } from "@/types/chat";

import { H_CONTAINER, H_HEADING, H_LABEL, H_PAD } from "./h-system";

const VENDORS = new Set(BUILD_MODELS.map((m) => m.provider)).size;

/**
 * The spec sheet. Hermeus lists its aircraft as engineering specifications —
 * a key, a large value, a hairline. This is RIFT's, and every figure is read
 * from the product's own modules so the sheet cannot drift from the app.
 */
const SPECS: { k: string; v: string; note: string }[] = [
  {
    k: "Reasoning vendors",
    v: String(VENDORS),
    note: "One key, one bill, one run history",
  },
  {
    k: "Renderers",
    v: String(MEDIA_MODELS.length),
    note: "Image and video, in the thread",
  },
  {
    k: "Agent archetypes",
    v: String(AGENT_PET_CATALOG.length),
    note: "Real roles, real tool boundaries",
  },
  {
    k: "Run ceiling",
    v: "60 min",
    note: "Server-side; the tab can close",
  },
  {
    k: "Machine",
    v: "1 : 1",
    note: "A fresh sandbox per run, torn down after",
  },
  { k: "To start", v: "$0", note: "No card, first run free" },
];

export function HSpecs() {
  return (
    <section
      id="specs"
      className={`${H_PAD} scroll-mt-16 border-t border-[var(--h-line)] bg-[var(--h-deep)]`}
    >
      <div className={H_CONTAINER}>
        <HReveal>
          <p className={H_LABEL}>Specifications</p>
          <h2 className={`${H_HEADING} mt-5 max-w-[18ch] text-[var(--h-ink)]`}>
            The numbers, read from the product.
          </h2>
        </HReveal>
        <dl className="mt-14 grid gap-px border border-[var(--h-line)] bg-[var(--h-line)] sm:grid-cols-2 lg:grid-cols-3">
          {SPECS.map((s, i) => (
            <HReveal key={s.k} delayMs={i * 60}>
              <div className="flex h-full flex-col bg-[var(--h-deep)] p-7">
                <dt className={H_LABEL}>{s.k}</dt>
                <dd className="mt-4 text-[42px] leading-none tracking-[-0.02em] text-[var(--h-ink)] tabular-nums">
                  {s.v}
                </dd>
                <dd className="mt-3 text-[13px] text-[var(--h-ink-70)]">
                  {s.note}
                </dd>
              </div>
            </HReveal>
          ))}
        </dl>
      </div>
    </section>
  );
}
