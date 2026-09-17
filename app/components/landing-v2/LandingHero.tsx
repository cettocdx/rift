import Image from "next/image";
import Link from "next/link";

import { ApertureSignature } from "./ApertureSignature";
import {
  F1_CONTAINER_CLASS,
  F1_DISPLAY_CLASS,
  F1_LEAD_CLASS,
} from "./f1-design";
import { F1Reveal } from "./F1Reveal";

const FOCUS_RING_CLASS =
  "focus-visible:outline-none";

export function LandingHero() {
  return (
    <section className="relative isolate overflow-hidden pt-28 sm:pt-32 lg:pt-40">
      <div
        className={`${F1_CONTAINER_CLASS} grid items-center gap-10 lg:grid-cols-12 lg:gap-8`}
      >
        <div className="lg:col-span-7">
          <F1Reveal>
            <h1 className={`max-w-[9ch] text-foreground ${F1_DISPLAY_CLASS}`}>
              Give RIFT the work.
            </h1>
          </F1Reveal>
          <F1Reveal delay={0.08}>
            <p className={`mt-6 max-w-[55ch] ${F1_LEAD_CLASS}`}>
              Build software, create media and investigate systems through the
              same agent layer.
            </p>
          </F1Reveal>
          <F1Reveal delay={0.14}>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/download"
                className={`inline-flex h-11 items-center justify-center rounded-full bg-[var(--primary)] px-6 text-[14px] font-medium text-[#080808] transition-transform duration-200 active:translate-y-px ${FOCUS_RING_CLASS}`}
              >
                Download RIFT
              </Link>
              <a
                href="#build"
                className={`inline-flex h-11 items-center justify-center rounded-full border border-border-strong px-6 text-[14px] font-medium text-foreground transition-colors duration-200 hover:bg-foreground/5 ${FOCUS_RING_CLASS}`}
              >
                Watch RIFT work
              </a>
            </div>
          </F1Reveal>
        </div>

        <F1Reveal delay={0.1} className="lg:col-span-5">
          <ApertureSignature className="mx-auto w-full max-w-[430px] text-foreground" />
        </F1Reveal>
      </div>

      <F1Reveal delay={0.2} className={`${F1_CONTAINER_CLASS} mt-12 lg:mt-16`}>
        <div className="overflow-hidden rounded-[16px] border border-border bg-[var(--surface)] shadow-[0_30px_100px_rgba(0,0,0,0.45)]">
          <Image
            src="/landing/product/build-product-design-4k.webp"
            alt="RIFT Build showing an agent task and its execution workspace."
            width={3840}
            height={2160}
            preload
            sizes="(max-width: 1280px) 100vw, 1240px"
            className="h-auto w-full"
          />
        </div>
      </F1Reveal>
    </section>
  );
}
