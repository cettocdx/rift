"use client";

import { MotionConfig } from "motion/react";

import { RiftMiniApp } from "@/app/components/landing-v2/RiftMiniApp";
import { LiveWorkbench } from "@/app/components/landing-v2/LiveWorkbench";

import { MEDIA_MODELS } from "@/types/chat";

import { XCapabilities } from "./XCapabilities";
import { XControl } from "./XControl";
import { XClose, XFooter, XPricing } from "./XClose";
import { XHero } from "./XHero";
import { XConnectorField } from "./XConnectorField";
import { XReceipt } from "./XReceipt";
import { XRenderers } from "./XRenderers";
import { XKnowledge } from "./XKnowledge";
import { XOptimize } from "./XOptimize";
import { XVendorOrbit } from "./XVendorOrbit";
import { XWorkbenchDeep } from "./XWorkbenchDeep";
import { XNav } from "./XNav";
import { XDivider } from "./x-pieces";
import { XScale } from "./XScale";
import { XTiles } from "./XTiles";
import { XProof } from "./XProof";
import { XSurface } from "./XSurface";
import { XTrust } from "./XTrust";
import { useHashAnchor } from "./use-hash-anchor";
import { X_TOKENS } from "./x-system";

/**
 * The third parallel landing, built to gumloop.com.
 *
 * ── Why a third, and why the reference moved twice ──
 *
 * /landing/v4 and /landing/pi are two finished arguments about what this page
 * should be, and neither has been chosen. This was a third, built to x.ai:
 * near-black, one grotesk, four claims at enormous size. Then to orchid.ai:
 * paper, a display serif, three times the vertical air. Both are recorded here
 * because the components below still carry comments that were written under
 * them.
 *
 * It is gumloop.com now, and the reason is the shape of what this page has to
 * carry. Orchid's sections are a heading, a line of copy and a photograph, and
 * its rhythm is built for that. Ours are a heading, a ruled list and a live
 * application window a thousand pixels tall. On orchid's spacing the page read
 * as a series of near-empty screens with something at the bottom of each.
 * Gumloop's sections are the same shape as ours — a claim over a picture of
 * the product — and its whole visual budget goes into the product stages.
 *
 * Every measurement is in docs/LANDING_X_TEARDOWN.md, taken with
 * `getComputedStyle` on the live page on 26 Aug 2026. Nothing is eyeballed.
 *
 * ── What is not borrowed ──
 *
 * Their typeface (Geist stands in), their palette — ours is pure black on
 * white where theirs carries a blue-leaning tint — their copy, and their
 * numbers. The three product stages hold the running product rather than a
 * rebuilt screenshot, which is the one place this page goes further than the
 * reference rather than following it.
 *
 * The closing band is ported from /landing/pi instead, and imports its mark
 * rather than copying it.
 */
export function XLanding() {
  /* Interior pages link into these sections; the anchor scroll has to survive
     the heavy ones mounting after hydration. See use-hash-anchor.ts. */
  useHashAnchor();

  return (
    <MotionConfig reducedMotion="user">
      <div
        id="x-top"
        style={X_TOKENS}
        className="min-h-full bg-[var(--x-ground)] text-[16px] leading-[24px] text-[var(--x-ink)] antialiased"
      >
        <XNav />

        <main>
          <XHero />

          {/*
           * Build sits directly under the fold, before the argument sections.
           *
           * The hero makes the claim ("give it the work"); Build is the claim
           * running, and a visitor who just read the headline is here to see
           * it, not to read three more sections first. XProof / XReceipt /
           * XTiles — the *why it is trustworthy* — follow the demonstration
           * rather than delaying it.
           */}
          <XSurface
            id="build"
            stageTitle="RIFT — Build"
            // 459 authored px with a run in it, measured; 104 of inset, then
            // headroom for a live answer longer than the prepared one.
            stageHeight={560}
            eyebrow="Build"
            title="An agent that finishes the job"
            lede="Build reads the code, makes the change, runs what it wrote, and hands back a verified result."
            bullets={[
              "Plan mode drafts the change and waits; agent mode goes straight to work",
              "A filesystem, a package manager and a terminal — not a diff preview",
              "Tests and type-checks run in the same sandbox that made the change",
              "Tools called, lines changed, context used and dollars spent, live",
            ]}
            action={{ label: "See everything it does", href: "#everything" }}
            note="The interface is the product's own. Type a task and the plan and answer are written live by a model; the sandbox and tool trace begin at sign-in."
            live="Type a task — the plan is written live"
            after={<XVendorOrbit />}
          >
            <RiftMiniApp variant="bare" initialSurface="build" />
          </XSurface>

          <XDivider />

          <XProof />

          <XReceipt />

          <XTiles />

          <XDivider />

          <XSurface
            id="studio"
            stageTitle="RIFT — Studio"
            // 583 measured with the render wall full, which is its only state.
            stageHeight={620}
            flip
            eyebrow="Studio"
            title="Every renderer, one prompt box"
            lede="Pick the model that suits the shot. Renders land in the same thread as the code that needed them."
            bullets={[
              // Derived. This read "Six image and video models" and there are
              // twelve — an undercount, on a page whose whole argument is that
              // its numbers can be checked.
              "Frontier image and video models behind one bill",
              "Billed together, so the model is a choice rather than a subscription",
              "Renders arrive in the thread, not in a second product",
              "The same run history as everything else",
            ]}
            /*
             * This section was briefly a screenshot of the signed-in Studio and
             * is a running surface again, which is the right call for a reason
             * worth writing down: a still of a render tool proves that renders
             * exist, and a prompt box that renders proves the product works.
             * The second is the argument this page is making everywhere else.
             *
             * What is live: the first render a visitor asks for is real, made
             * by a lightweight model against a fixed daily budget
             * (app/api/landing-image). After the day's budget is gone the wall
             * shows prepared frames, and the note says so rather than pretending.
             */
            note="Describe a shot and the day's first renders are real. Once the daily budget is spent the frames shown are prepared, and the surface says so."
            live="Describe a shot — the first render today is real"
            after={<XRenderers />}
          >
            <RiftMiniApp
              variant="bare"
              initialSurface="studio"
              showSidebar={false}
              autoDemo={false}
            />
          </XSurface>

          <XDivider />

          <XSurface
            id="workbench"
            stageTitle="RIFT Hack Workbench — scanme.nmap.org"
            // 904 measured with the pass finished and the report card open.
            stageHeight={860}
            eyebrow="Hack Workbench"
            title="A security lab that runs the tools"
            /*
             * Two corrections a review caught, both of which mattered.
             *
             * The lede sold "one authorised pass a day" as the product's
             * capability. It is not: that is the per-visitor throttle on the
             * demo below, in app/api/landing-probe/route.ts. Stated as a
             * product limit it is a reason not to buy.
             *
             * And the Workbench is gated to the Max tier —
             * `hasHackWorkbenchAccess` in lib/auth/premium-access.ts. The page
             * sold it in three prominent places and disclosed the price in
             * none of them, which converts people onto a plan that does not
             * include the thing they came for.
             */
            lede="Declare a scope, run an authorised pass, keep the evidence with the run. The pass below is real."
            bullets={[
              "A preinstalled offensive toolchain, scoped and authorised",
              "Findings are verified before they are reported",
              "Evidence is kept with the run, not summarised away",
              "Container isolation on every session",
              "Included with Max",
            ]}
            note="scanme.nmap.org is Nmap's own public test host. Addresses, ports, certificate and findings are read live, once a visitor a day; after that the recorded pass replays and the surface says so."
            live="Run the pass — one real scan a day, per visitor"
          >
            {/* `bare`, so the section's own frame is the only one. The default
                mat paints a second hairline and a second radius inside the
                first, which ProductFrame's own notes warn against and which is
                very visible against a dark surface on paper. */}
            <LiveWorkbench variant="bare" />
          </XSurface>

          <XWorkbenchDeep />

          <XDivider />

          <XKnowledge />

          <XConnectorField />

          <XDivider />

          <XOptimize />

          <XScale />

          <XCapabilities />

          <XControl />

          <XTrust />
          <XPricing />
          <XClose />
        </main>

        <XFooter />
      </div>
    </MotionConfig>
  );
}
