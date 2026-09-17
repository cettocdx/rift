"use client";

import { Reveal } from "./reveal";
import {
  X_CAPTION,
  X_CARD_TITLE_SM,
  X_CONTAINER,
  X_LABEL,
  X_SECTION,
  X_SECTION_PAD,
  X_SMALL,
} from "./x-system";

/**
 * Where the code goes.
 *
 * ── Why this section exists ──
 *
 * A review put it plainly: this page asks a stranger to let a model execute
 * their code on someone else's computer, and separately advertises an
 * offensive-security toolchain — and said nothing at all about isolation,
 * retention or who can read what. No buyer above hobbyist clears a page like
 * that, and the absence reads worse the more serious the reader is.
 *
 * ── Why it is this short ──
 *
 * Because these four lines are the ones that can be checked in this repository
 * today. There is no SOC 2 claim here, no DPA, no retention period and no
 * statement about training, because I could not verify any of those and a
 * fabricated compliance claim is worse than an absent one by a wide margin —
 * it is the single fastest way to lose an enterprise deal and the only kind of
 * error on this page that could become a legal problem rather than an
 * embarrassing one.
 *
 * When those answers exist, they belong here. Until then this section says
 * what is true and points at the documents that govern the rest.
 */

const FACTS = [
  {
    title: "One machine per run",
    body: "Work executes in a sandbox issued for that run and torn down after it. Nothing an agent does touches your computer, and no two runs share a filesystem.",
  },
  {
    title: "Credentials never enter a prompt",
    body: "Connector authentication lives in a vault and is exchanged at call time. A model sees the tool, not the key.",
  },
  {
    title: "The Workbench needs a scope",
    body: "It runs only against a target you have declared and are authorised to test, and the evidence stays attached to the run.",
  },
] as const;

export function XTrust() {
  return (
    <section className={X_SECTION_PAD}>
      <div className={X_CONTAINER}>
        <Reveal>
          <p className={X_LABEL}>Where the code goes</p>
          <h2
            className={`${X_SECTION} mt-5 max-w-[20ch] text-balance text-[var(--x-ink)]`}
          >
            It runs on our machines
          </h2>
        </Reveal>

        <div className="mt-16 grid divide-y-[0.5px] divide-[var(--x-line)] border-t-[0.5px] border-t-[var(--x-line)] lg:grid-cols-3 lg:divide-x-[0.5px] lg:divide-y-0">
          {FACTS.map((fact) => (
            <div key={fact.title} className="py-10 lg:px-10 lg:first:pl-0 lg:last:pr-0">
              <h3 className={`${X_CARD_TITLE_SM} text-[var(--x-ink)]`}>
                {fact.title}
              </h3>
              <p className={`${X_CAPTION} mt-3 leading-[23px]`}>{fact.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap gap-x-8 gap-y-3">
          <a
            href="/terms-of-service"
            className={`${X_SMALL} font-normal text-[var(--x-ink-50)] underline decoration-[var(--x-line-soft)] underline-offset-[6px] transition-colors hover:text-[var(--x-ink)] motion-reduce:transition-none`}
          >
            Terms of service
          </a>
          <a
            href="/privacy-policy"
            className={`${X_SMALL} font-normal text-[var(--x-ink-50)] underline decoration-[var(--x-line-soft)] underline-offset-[6px] transition-colors hover:text-[var(--x-ink)] motion-reduce:transition-none`}
          >
            Privacy policy
          </a>
          <a
            href="/refund-policy"
            className={`${X_SMALL} font-normal text-[var(--x-ink-50)] underline decoration-[var(--x-line-soft)] underline-offset-[6px] transition-colors hover:text-[var(--x-ink)] motion-reduce:transition-none`}
          >
            Refund policy
          </a>
        </div>
      </div>
    </section>
  );
}
