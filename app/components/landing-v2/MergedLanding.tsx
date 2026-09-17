"use client";

import { MotionConfig } from "motion/react";

import { LandingComparison } from "./LandingComparison";
import { LandingFooter } from "./LandingFooter";
import { LandingNav } from "./LandingNav";
import { LandingSections } from "./LandingSections";
import { LandingShell } from "./LandingShell";
import { LANDING_TOKENS } from "./landing-design-system";
import { IntegrationStrip } from "./IntegrationStrip";
import { MergedHero } from "./MergedHero";

/**
 * The merged landing page.
 *
 * Composed rather than rewritten: the sections below the hero are already live
 * DOM replicas of the product — the run demo, the scrubber, the workbench, the
 * studio surfaces — and those were never the problem. What changed is the hero,
 * the token set, and the removal of the captured screenshots.
 *
 * Every token comes from landing-design-system.ts, which records for each value
 * which of the two attempts it came from and what measurement settled it.
 */
export function MergedLanding() {
  return (
    <MotionConfig reducedMotion="user">
      <LandingShell
        style={LANDING_TOKENS}
        className="h-full overflow-y-auto bg-background font-sans text-foreground antialiased"
      >
        {/* The copy is in the HTML; a reader whose script never runs should not
          meet a blank page. */}
        <noscript>
          <style>{`[data-landing-reveal]{opacity:1!important;transform:none!important}`}</style>
        </noscript>
        <a
          href="#page-body"
          className="fixed left-4 top-3 z-50 -translate-y-24 rounded-full bg-foreground px-4 py-2 text-[13px] font-medium text-background transition-transform duration-150 focus:translate-y-0 focus:outline-none motion-reduce:transition-none"
        >
          Skip to content
        </a>
        <LandingNav />
        <main id="page-body" className="relative z-10">
          <MergedHero />
          {/* Directly under the frame, where claude.com puts the same device:
            the tools a reader already has, at the moment they are deciding
            whether this fits their stack. */}
          <IntegrationStrip />
          <LandingSections />
          <LandingComparison />
        </main>
        <LandingFooter />
      </LandingShell>
    </MotionConfig>
  );
}
