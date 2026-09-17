"use client";

import { LandingComparison } from "./LandingComparison";
import { LandingFooter } from "./LandingFooter";
import { LandingHero } from "./LandingHero";
import { LandingNav } from "./LandingNav";
import { LandingSections } from "./LandingSections";
import { LandingShell } from "./LandingShell";
import { LANDING_PALETTE } from "./palette";

/**
 * The public landing page, composed once.
 *
 * Two routes render it: `/` for a signed-out visitor, and `/landing/v2`, which
 * stays available (and noindexed) so the page can be opened directly while it
 * is being worked on. Both must show the same page — a marketing surface that
 * drifts between two copies of its own layout is how a product ends up with
 * two headlines.
 */
export function LandingV2() {
  return (
    <LandingShell
      style={LANDING_PALETTE}
      className="h-full overflow-y-auto bg-background font-sans text-foreground antialiased"
    >
      {/* The reveals start at opacity 0 and are animated in by script. Without
          this, a reader whose JavaScript never runs gets a blank black page —
          the copy is in the HTML, so there is no reason to hide it from them. */}
      <noscript>
        <style>{`[data-landing-reveal]{opacity:1!important;transform:none!important}`}</style>
      </noscript>
      <LandingNav />
      <main>
        <LandingHero />
        <LandingSections />
        <LandingComparison />
      </main>
      <LandingFooter />
    </LandingShell>
  );
}
