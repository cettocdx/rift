import { ApertureSignature } from "./ApertureSignature";
import { F1Reveal } from "./F1Reveal";
import { CONTINUITY_STEPS } from "./f1-content";
import {
  F1_BODY_CLASS,
  F1_CONTAINER_CLASS,
  F1_LABEL_CLASS,
  F1_SECTION_CLASS,
  F1_SECTION_TITLE_CLASS,
} from "./f1-design";

export function SystemContinuity() {
  return (
    <section
      id="system"
      aria-labelledby="system-title"
      className={`relative isolate scroll-mt-20 overflow-hidden ${F1_SECTION_CLASS}`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_32%,rgba(255,255,255,0.055),transparent_34%)]"
      />

      <div className={`${F1_CONTAINER_CLASS} relative`}>
        <F1Reveal>
          <ApertureSignature
            compact
            className="mx-auto w-full max-w-[320px] text-foreground"
          />
          <h2
            id="system-title"
            className={`mx-auto mt-8 max-w-[16ch] text-balance text-center ${F1_SECTION_TITLE_CLASS}`}
          >
            One context. Three working surfaces.
          </h2>
          <p
            className={`${F1_BODY_CLASS} mx-auto mt-5 max-w-[58ch] text-center`}
          >
            Work can change shape without losing the project, evidence or
            decisions that produced it.
          </p>
        </F1Reveal>

        <ol className="relative mt-12 grid gap-8 border-l border-border pl-6 md:grid-cols-3 md:gap-0 md:border-l-0 md:border-t md:pl-0 md:pt-8">
          {CONTINUITY_STEPS.map((step) => (
            <li key={step.id} className="relative md:px-6">
              <span
                aria-hidden="true"
                className="absolute -left-[29px] top-1.5 size-2 rounded-full bg-[var(--primary)] md:-top-[37px] md:left-6"
              />
              <p className={F1_LABEL_CLASS}>{step.label}</p>
              <h3 className="mt-3 text-[18px] font-medium tracking-[-0.015em]">
                {step.title}
              </h3>
              <p className={`${F1_BODY_CLASS} mt-2`}>{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
