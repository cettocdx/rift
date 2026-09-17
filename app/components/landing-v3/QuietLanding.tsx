"use client";

import { motion, useReducedMotion } from "motion/react";

import { LandingComparison } from "@/app/components/landing-v2/LandingComparison";
import { LandingFooter } from "@/app/components/landing-v2/LandingFooter";
import { LandingNav } from "@/app/components/landing-v2/LandingNav";
import { LandingSections } from "@/app/components/landing-v2/LandingSections";
import { LandingShell } from "@/app/components/landing-v2/LandingShell";
import { HeroWorkspace } from "@/app/components/landing-v2/HeroWorkspace";

import { HeroAurora } from "./HeroAurora";
import { WORLD_PALETTE } from "./palette";

/**
 * The page: one rendered object, and then quiet.
 *
 * Everything below the hero is v2's own component — Build, subagents, Studio,
 * the Hack Workbench, plugins, pricing, download, the comparison, the footer.
 * Forking them would have produced two landing pages to maintain and a
 * comparison that stopped being about the treatment.
 *
 * What changed is the hero, and the ground everything stands on. The 3D is a
 * single machined artifact in the corner of the first screen; past it the page
 * is typography on a warm near-black, which is what the products this sits
 * beside actually do.
 */

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

function Hero() {
  const reduceMotion = useReducedMotion();

  const rise = (delay: number) => ({
    "data-landing-reveal": true,
    ...(reduceMotion
      ? {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          transition: { duration: 0.4, delay },
        }
      : {
          initial: { opacity: 0, transform: "translateY(18px)" },
          animate: { opacity: 1, transform: "translateY(0px)" },
          transition: { duration: 0.7, delay, ease: EASE_OUT },
        }),
  });

  return (
    <section className="relative isolate overflow-hidden">
      {/* The field fills the first screen and hands off to the page below it.
          It is the only rendered surface anywhere on the route — everything
          past the fold is type on a flat ground. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[min(104svh,1000px)]">
        <HeroAurora className="absolute inset-0" />
        {/* Ends the field in the page's own black instead of at a canvas edge,
            which would read as a pasted image. */}
        <div className="absolute inset-x-0 bottom-0 h-56 bg-[linear-gradient(to_top,var(--background)_8%,transparent)]" />
        {/* Holds the reading column dark enough for white type without
            dimming the whole field — the trade every hero over imagery makes. */}
        <div className="absolute inset-0 bg-[linear-gradient(100deg,rgba(6,6,5,0.92)_0%,rgba(6,6,5,0.78)_26%,rgba(6,6,5,0.42)_46%,transparent_66%)]" />
      </div>

      <div className="mx-auto w-full max-w-[1100px] px-6 pb-24 pt-[15vh] sm:px-10">
        <motion.p
          {...rise(0.04)}
          className="text-[12px] font-medium uppercase tracking-[0.2em] text-[var(--muted-foreground)]"
        >
          The agent workstation
        </motion.p>

        <motion.h1
          {...rise(0.08)}
          className="mt-6 max-w-[13ch] text-[clamp(2.5rem,5.2vw,4.05rem)] font-semibold leading-[1.03] tracking-[-0.035em] text-foreground"
        >
          The workstation your agents actually run in.
        </motion.h1>

        <motion.p
          {...rise(0.16)}
          className="mt-6 max-w-[40ch] text-[clamp(1rem,1.4vw,1.15rem)] leading-[1.55] text-[var(--cursor-text-secondary)]"
        >
          Plan, build, verify and ship from one surface. Real sandboxes, a real
          terminal, and the frontier models already wired in.
        </motion.p>

        <motion.div
          {...rise(0.24)}
          className="mt-9 flex flex-wrap items-center gap-3"
        >
          <a
            href="/login"
            className="inline-flex h-11 items-center rounded-[10px] bg-foreground px-5 text-[14px] font-medium text-background transition-transform duration-100 active:scale-[0.985] motion-reduce:transition-none"
          >
            Start building
          </a>
          <a
            href="#build"
            className="inline-flex h-11 items-center rounded-[10px] border border-border-strong px-5 text-[14px] font-medium text-foreground transition-colors hover:bg-foreground/5 motion-reduce:transition-none"
          >
            See how it works
          </a>
        </motion.div>

        <motion.div {...rise(0.32)} className="mt-14 max-w-[880px]">
          <HeroWorkspace />
        </motion.div>
      </div>
    </section>
  );
}

export function QuietLanding() {
  return (
    <LandingShell
      style={WORLD_PALETTE}
      className="h-full overflow-y-auto bg-background font-sans text-foreground antialiased"
    >
      <noscript>
        <style>{`[data-landing-reveal]{opacity:1!important;transform:none!important}`}</style>
      </noscript>
      <LandingNav />
      <main>
        <Hero />
        <LandingSections />
        <LandingComparison />
      </main>
      <LandingFooter />
    </LandingShell>
  );
}
