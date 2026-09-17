import Image from "next/image";

import { F1Reveal } from "./F1Reveal";
import { BUILD_STEPS } from "./f1-content";
import {
  F1_BODY_CLASS,
  F1_CONTAINER_CLASS,
  F1_LABEL_CLASS,
  F1_SECTION_CLASS,
  F1_SECTION_TITLE_CLASS,
} from "./f1-design";

export function BuildNarrative() {
  return (
    <section
      id="build"
      aria-labelledby="build-title"
      className={`${F1_CONTAINER_CLASS} ${F1_SECTION_CLASS} scroll-mt-20`}
    >
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-5">
          <F1Reveal>
            <p className={F1_LABEL_CLASS}>Build</p>
            <h2
              id="build-title"
              className={`mt-4 max-w-[13ch] ${F1_SECTION_TITLE_CLASS}`}
            >
              From task to verified change.
            </h2>
            <p className={`${F1_BODY_CLASS} mt-5 max-w-[52ch]`}>
              RIFT keeps the plan, execution and proof inside one legible run.
            </p>
          </F1Reveal>

          <ol className="mt-10 border-y border-border">
            {BUILD_STEPS.map((step, index) => (
              <li
                key={step.label}
                className="border-b border-border py-6 last:border-b-0"
              >
                <article className="grid grid-cols-[72px_1fr] gap-4">
                  <span
                    className={F1_LABEL_CLASS}
                  >{`0${index + 1} / ${step.label}`}</span>
                  <div>
                    <h3 className="text-[17px] font-medium tracking-[-0.01em]">
                      {step.title}
                    </h3>
                    <p className={`${F1_BODY_CLASS} mt-2`}>{step.body}</p>
                  </div>
                </article>
              </li>
            ))}
          </ol>
        </div>

        <F1Reveal delay={0.08} className="lg:col-span-7 lg:self-center">
          <div className="overflow-hidden rounded-[16px] border border-border bg-[var(--surface)]">
            <Image
              src="/landing/product/build-product-design-4k.webp"
              alt="RIFT Build showing a plan, execution state and verification results."
              width={3840}
              height={2160}
              sizes="(max-width: 639px) calc(100vw - 40px), (max-width: 1023px) calc(100vw - 64px), (max-width: 1239px) calc(58.333vw - 66.667px), 657px"
              className="h-auto w-full"
            />
          </div>
        </F1Reveal>
      </div>
    </section>
  );
}
