"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import { desktopReleaseStatus, downloadLinks } from "@/app/download/constants";
import { PLANS } from "@/lib/pricing/plans";

import { Reveal, Section } from "./Reveal";
import { useInViewOnce } from "./use-in-view";

/**
 * Two things a reader goes looking for and should never have to hunt for: what
 * it costs, and how to get it on their machine.
 *
 * The plans are imported from the same module the pricing page renders, not
 * retyped here. A landing page carrying its own copy of the prices is a page
 * that will eventually advertise a number the checkout no longer charges.
 */

/**
 * The builds that exist, from the module the download page reads.
 *
 * This listed macOS, Windows and Linux with confident subtitles — "Apple
 * silicon and Intel", "x64", "AppImage and deb". Checked against
 * `app/download/constants`: `downloadLinks.windows` is null and there is no
 * Linux build at all, so two of the three platforms advertised here could not
 * be downloaded. A reader finds that out by clicking, which is the most
 * expensive possible moment to find it out.
 *
 * Now it reads the same constants the download page renders, including their
 * release-status strings, and Linux is not claimed until there is a file.
 */
const PLATFORMS = [
  {
    name: "macOS",
    href: downloadLinks.macos,
    detail: desktopReleaseStatus.macos,
  },
  {
    name: "Windows",
    href: downloadLinks.windows,
    detail: desktopReleaseStatus.windows,
  },
];

/**
 * A price that counts up to itself.
 *
 * `plan.price` is a formatted string from the pricing module — "$0", "$39" —
 * because that is what the checkout charges and the page must never carry its
 * own copy of a number. So this parses the digits out to animate them and
 * re-emits everything around them untouched: the currency symbol, any suffix,
 * whatever a future plan is called. A price it cannot parse is rendered
 * exactly as given rather than guessed at, which is the only acceptable
 * failure mode for a number somebody is going to be billed.
 *
 * The reason to animate it at all: three plans whose prices arrive by climbing
 * are read as a scale, and a scale is what this section is asking the reader
 * to judge. Three static numbers are read one at a time.
 */
function PriceCount({
  price,
  run,
  delay,
}: {
  price: string;
  run: boolean;
  delay: number;
}) {
  const reduceMotion = useReducedMotion();
  const match = price.match(/^(\D*)(\d+)(.*)$/);
  const target = match ? Number(match[2]) : null;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!run || reduceMotion || target === null) return;
    let frame = 0;
    const steps = 20;
    const start = setTimeout(() => {
      const timer = setInterval(() => {
        frame += 1;
        setShown(Math.round(target * (1 - Math.pow(1 - frame / steps, 3))));
        if (frame >= steps) clearInterval(timer);
      }, 26);
    }, delay);
    return () => clearTimeout(start);
  }, [run, target, delay, reduceMotion]);

  if (!match || target === null) return <>{price}</>;
  const value = reduceMotion || !run ? target : shown;
  return (
    <>
      {match[1]}
      <span className="tabular-nums">{value}</span>
      {match[3]}
    </>
  );
}

export function PricingSection() {
  const reduceMotion = useReducedMotion();
  const [plansRef, plansSeen] = useInViewOnce<HTMLDivElement>(0.25);

  return (
    <Section
      id="pricing"
      eyebrow="Pricing"
      title="One plan, the whole workstation."
      lede="The models, the sandboxes, the terminal and Studio come together rather than as line items you assemble yourself."
    >
      {/* items-stretch plus h-full on the card: the three plans list different
          numbers of features, and a row of cards that end at different heights
          reads as three unrelated boxes rather than one comparison. */}
      <div
        ref={plansRef}
        className="mt-12 grid items-stretch gap-4 sm:grid-cols-3"
      >
        {PLANS.map((plan, index) => (
          <Reveal key={plan.name} delay={index * 0.06} className="h-full">
            <motion.div
              whileHover={reduceMotion ? undefined : { y: -3 }}
              transition={{ type: "spring", bounce: 0, duration: 0.32 }}
              className={`flex h-full flex-col rounded-[12px] border p-7 ${
                plan.highlight
                  ? "border-foreground/25 bg-[var(--surface,#0c0c0c)]"
                  : "border-border bg-background"
              }`}
            >
              <div className="flex items-center gap-2">
                <h3 className="text-[14.5px] font-medium tracking-[-0.01em] text-foreground">
                  {plan.name}
                </h3>
                {plan.highlight ? (
                  <span className="rounded-[6px] border border-foreground/25 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.1em] text-foreground/80">
                    Popular
                  </span>
                ) : null}
              </div>

              <p className="mt-4 flex items-baseline gap-1.5">
                <span className="text-[32px] font-semibold tracking-[-0.03em] text-foreground">
                  <PriceCount
                    price={plan.price}
                    run={plansSeen}
                    delay={index * 90}
                  />
                </span>
                <span className="text-[12.5px] text-[var(--cursor-text-secondary)]">
                  {plan.cadence}
                </span>
              </p>

              <p className="mt-3 text-[13px] leading-[1.6] text-[var(--cursor-text-secondary)]">
                {plan.blurb}
              </p>

              <ul className="mt-5 space-y-2">
                {plan.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex gap-2 text-[12.5px] leading-[1.55] text-foreground/80"
                  >
                    <span
                      aria-hidden
                      className="text-[var(--cursor-text-secondary)]"
                    >
                      ·
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>

              {/* mt-auto pins every button to the bottom edge, so the three sit
                  on one line however long the feature list above them runs. */}
              <a
                href={plan.href}
                className={`mt-auto inline-flex h-10 items-center justify-center rounded-[6px] text-[13px] font-medium transition-colors motion-reduce:transition-none ${
                  plan.highlight
                    ? "bg-foreground text-background hover:bg-foreground/90"
                    : "border border-border-strong text-foreground hover:bg-foreground/5"
                }`}
              >
                {plan.cta}
              </a>
            </motion.div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.14}>
        <p className="mt-6 text-[12px] text-[var(--cursor-text-secondary)]">
          Credit packs are available on top of any paid plan.{" "}
          <a
            href="/pricing"
            className="text-foreground underline decoration-border-strong underline-offset-[3px] hover:decoration-foreground"
          >
            Full pricing
          </a>
        </p>
      </Reveal>
    </Section>
  );
}

export function DownloadSection() {
  const reduceMotion = useReducedMotion();

  return (
    <Section
      id="download"
      eyebrow="Desktop"
      title="Or run it as an app."
      lede="The desktop build is the same workstation in its own window — native window chrome, the shortcut always available, and the sidebar rendered against the desktop's own material."
    >
      <div className="mt-12 grid gap-x-10 gap-y-7 sm:grid-cols-2">
        {PLATFORMS.map((platform, index) => (
          <Reveal key={platform.name} delay={index * 0.06}>
            <div className="border-t border-border-strong pt-4">
              <h3 className="text-[14.5px] font-medium tracking-[-0.01em]">
                {platform.href ? (
                  <a
                    href={platform.href}
                    className="text-foreground underline decoration-border-strong underline-offset-4 transition-colors hover:decoration-foreground motion-reduce:transition-none"
                  >
                    {platform.name}
                  </a>
                ) : (
                  // No link, because there is no file.
                  <span className="text-[var(--cursor-text-secondary)]">
                    {platform.name}
                  </span>
                )}
              </h3>
              <p className="mt-1.5 text-[12.5px] text-[var(--cursor-text-secondary)]">
                {platform.detail}
              </p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.12}>
        <motion.a
          href="/download"
          whileHover={reduceMotion ? undefined : { y: -2 }}
          transition={{ type: "spring", bounce: 0, duration: 0.3 }}
          className="mt-9 inline-flex h-11 items-center gap-2 rounded-[8px] border border-border-strong px-5 text-[14px] font-medium text-foreground transition-colors hover:bg-foreground/5 motion-reduce:transition-none"
        >
          Download RIFT
          <span aria-hidden>→</span>
        </motion.a>
      </Reveal>
    </Section>
  );
}
