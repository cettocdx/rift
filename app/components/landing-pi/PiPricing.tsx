"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import { desktopReleaseStatus, downloadLinks } from "@/app/download/constants";
import { PLANS } from "@/lib/pricing/plans";

import { useInViewOnce } from "@/app/components/landing-v2/use-in-view";
import { REVEAL_EASE, revealDelay } from "./pi-reveal";
import { PI_FIG, PI_INDEX, PI_LABEL } from "./pi-system";

/**
 * What it costs, and how to get it on a machine.
 *
 * Two things a reader goes looking for and should never have to hunt for. The
 * other landing has both; this one did not, which is the kind of gap that only
 * shows up when the two pages are opened side by side.
 *
 * The plans are imported from `lib/pricing/plans` — the same module the
 * pricing page and the other landing render. A marketing page carrying its own
 * copy of the prices is a page that will eventually advertise a number the
 * checkout no longer charges, and nobody notices until a customer does.
 *
 * ── Why no highlighted tier ──
 *
 * `plan.highlight` is true for Pro and this deliberately does not act on it
 * with a fill or a border. Prime Intellect's page has exactly one saturated
 * element on 10,744px of scroll; a glowing middle column would be the second
 * loudest thing here after the hero and it would be selling rather than
 * stating. The recommendation is carried by a corner index instead, in the
 * same monospace as every other index on the page.
 */

/**
 * The builds that exist, and the ones that do not, said plainly.
 *
 * Read from `app/download/constants` rather than typed here — the same module
 * the download page renders, including its release-status strings. The first
 * draft of this listed macOS, Windows and Linux with confident subtitles
 * ("Apple silicon and Intel", "AppImage and deb"). Two of those three have no
 * build at all: `downloadLinks.windows` is null and there is no Linux entry.
 *
 * A download section that lists a platform you cannot download is worse than
 * one that lists a single platform, because the reader finds out by clicking.
 * So Windows is printed with its real status and no link, and Linux is not
 * claimed. When the builds land, this list follows the constants.
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
] as const;

/**
 * A price that arrives by counting.
 *
 * `plan.price` is a formatted string — "$0", "$39" — because that is what the
 * checkout charges, so this parses the digits out to animate them and re-emits
 * everything around them untouched: the currency symbol, any suffix, whatever
 * a future plan is called. A price it cannot parse renders exactly as given
 * rather than guessed at, which is the only acceptable failure mode for a
 * number somebody is going to be billed.
 *
 * Three prices that climb are read as a scale, and a scale is what this asks
 * the reader to judge. Three static numbers are read one at a time.
 *
 * The first draft of this faded the digits in instead of counting them, on top
 * of a cell that was already fading in — two opacity animations stacked on the
 * same pixels, which reads as the number being *dimmer* rather than as it
 * arriving. It also made the comment above a lie. It counts now.
 */
function PiPrice({
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
    if (!run || reduceMotion || target === null || target === 0) return;

    // Scheduled, never written synchronously in the effect body — this repo
    // lints against that, and a state write before paint cascades a render.
    const STEPS = 18;
    let cleanup = () => {};

    const start = setTimeout(() => {
      let step = 0;
      const timer = setInterval(() => {
        step += 1;
        // Ease out, so it decelerates into the real number rather than
        // stopping dead on it.
        const t = 1 - (1 - step / STEPS) ** 3;
        setShown(step >= STEPS ? target : Math.round(target * t));
        if (step >= STEPS) clearInterval(timer);
      }, 26);
      cleanup = () => clearInterval(timer);
    }, delay * 1000);

    return () => {
      clearTimeout(start);
      cleanup();
    };
  }, [delay, reduceMotion, run, target]);

  if (!match || target === null) {
    return <span className="tabular-nums">{price}</span>;
  }

  const [, prefix, , suffix] = match;
  const value = reduceMotion || !run ? target : shown;

  return (
    <span className="tabular-nums">
      {prefix}
      {value}
      {suffix}
    </span>
  );
}

export function PiPricing() {
  const [ref, seen] = useInViewOnce<HTMLDivElement>(0.12);

  return (
    <div ref={ref}>
      <section className="relative border border-[var(--pi-line)] bg-[var(--pi-line)]">
        <span
          className={`absolute -left-px -top-px z-10 border border-l-0 border-t-0 border-[var(--pi-line)] bg-[var(--pi-cell)] px-2.5 py-1.5 ${PI_FIG}`}
        >
          What it costs
        </span>

        <div className="grid gap-px pt-px sm:grid-cols-2 lg:grid-cols-3">
          {PLANS.map((plan, index) => (
            <div
              key={plan.name}
              className={`flex flex-col bg-[var(--pi-cell)] px-6 pb-6 pt-14 transition-opacity duration-[450ms] motion-reduce:transition-none ${REVEAL_EASE} ${revealDelay(
                index,
              )} ${seen ? "opacity-100" : "opacity-15"}`}
            >
              <p className="flex items-baseline justify-between gap-3">
                <span className={`${PI_LABEL} normal-case text-[15px]`}>
                  {plan.name}
                </span>
                {plan.highlight ? (
                  <span className={PI_INDEX}>recommended</span>
                ) : null}
              </p>

              <p className="mt-5 flex items-baseline gap-2">
                <span className="font-mono text-[32px] leading-none text-[var(--pi-ink)]">
                  <PiPrice
                    price={plan.price}
                    run={seen}
                    delay={index * 0.07 + 0.1}
                  />
                </span>
                <span className={PI_INDEX}>{plan.cadence}</span>
              </p>

              <p className="mt-3 text-[14px] leading-[1.5] text-[var(--pi-dim)]">
                {plan.blurb}
              </p>

              <ul className="mt-6 flex flex-col">
                {plan.features.map((feature) => (
                  <li
                    key={feature}
                    className="border-t border-[var(--pi-line-soft)] py-2.5 text-[13.5px] leading-[1.45] text-[var(--pi-dim)] first:border-t-0 first:pt-0"
                  >
                    {feature}
                  </li>
                ))}
              </ul>

              <a
                href={plan.href}
                className={`mt-auto block pt-7 ${PI_LABEL} transition-colors hover:text-[var(--pi-ink)] motion-reduce:transition-none`}
              >
                <span className="block border border-[var(--pi-line)] px-4 py-2.5 text-center transition-[background-color,transform] duration-100 hover:bg-[rgba(255,255,255,0.05)] active:scale-[0.985] motion-reduce:transition-none">
                  {plan.cta} ›
                </span>
              </a>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function PiDownload() {
  const [ref, seen] = useInViewOnce<HTMLDivElement>(0.15);

  return (
    <div ref={ref}>
      <section className="relative border border-[var(--pi-line)] bg-[var(--pi-cell)]">
        <span
          className={`absolute -left-px -top-px z-10 border border-l-0 border-t-0 border-[var(--pi-line)] bg-[var(--pi-cell)] px-2.5 py-1.5 ${PI_FIG}`}
        >
          On your machine
        </span>

        {/* The clearance for the corner label belongs to the cell, not to the
            grid — the grid's background *is* the hairline colour, so padding
            it paints a light bar the full width of the figure. */}
        <div className="pt-11">
          <div className="grid gap-px bg-[var(--pi-line)] lg:grid-cols-[1fr_1.15fr]">
            <div className="bg-[var(--pi-cell)] px-6 py-7">
              <p className={PI_LABEL}>Desktop</p>
              <ul className="mt-5 flex flex-col">
                {PLATFORMS.map((platform, index) => (
                  <li
                    key={platform.name}
                    className={`flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-[var(--pi-line-soft)] py-3.5 transition-opacity duration-[400ms] first:border-t-0 first:pt-0 motion-reduce:transition-none ${REVEAL_EASE} ${revealDelay(
                      index,
                    )} ${seen ? "opacity-100" : "opacity-15"}`}
                  >
                    {platform.href ? (
                      <a
                        href={platform.href}
                        className="text-[14.5px] text-[var(--pi-ink)] underline decoration-[var(--pi-line)] underline-offset-4 transition-colors hover:decoration-[var(--pi-ink)] motion-reduce:transition-none"
                      >
                        {platform.name}
                      </a>
                    ) : (
                      // No link, because there is no file. A disabled-looking
                      // row is the honest rendering of "not yet".
                      <span className="text-[14.5px] text-[var(--pi-faint)]">
                        {platform.name}
                      </span>
                    )}
                    <span className={`${PI_INDEX} normal-case`}>
                      {platform.detail}
                    </span>
                  </li>
                ))}
              </ul>
              <a
                href="/download"
                className={`mt-7 inline-block border border-[var(--pi-line)] px-4 py-2.5 ${PI_LABEL} transition-[background-color,transform] duration-100 hover:bg-[rgba(255,255,255,0.05)] active:scale-[0.985] motion-reduce:transition-none`}
              >
                Download ›
              </a>
            </div>

            <div className="bg-[var(--pi-cell)] px-6 py-7">
              <p className={PI_LABEL}>Browser</p>
              {/*
               * This half used to carry a copyable
               * `curl -fsSL https://riftsys.app/install.sh | sh`, describing a
               * CLI that would sign the machine in. That URL returns 404 in
               * production and there is no CLI package in this repo.
               *
               * What is true is better anyway, and it is the reason the desktop
               * build being unsigned matters so little: the workspace runs in a
               * browser with nothing installed, and the sandbox was never on the
               * reader's machine to begin with.
               */}
              <p className="mt-5 text-[15px] leading-[1.5] text-[var(--pi-ink)]">
                Nothing to install.
              </p>
              <p className="mt-3 text-[14px] leading-[1.5] text-[var(--pi-dim)]">
                The sandbox does not run on your machine, so the browser is not
                a lesser version of the workspace — it is the workspace. Same
                account, same sandboxes, same run history as the desktop build.
                Sign in and the first run starts in seconds.
              </p>
              <a
                href="/login"
                className={`mt-7 inline-block bg-[var(--pi-ink)] px-4 py-2.5 font-mono text-[12px] uppercase text-[var(--pi-ground)] transition-transform duration-100 active:scale-[0.985] motion-reduce:transition-none`}
              >
                Open the workspace ›
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
