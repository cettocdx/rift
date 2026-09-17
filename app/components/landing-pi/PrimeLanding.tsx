"use client";

import { MotionConfig } from "motion/react";

import { RiftLogo } from "@/components/icons/rift-logo";

import { PiCell, PiFeatureList, PiHeading, PiSectionTitle } from "./PiCell";
import { PiDotField } from "./PiDotField";
import { PiHero } from "./PiHero";
import { PiIsometric, PiRunChart } from "./PiIsometric";
import { PiWorkbench } from "./PiWorkbench";
import { PiCodeCells } from "./PiCodeCells";
import { PiPixelMark } from "./PiPixelMark";
import { PiConnectorMarks, PiModelMarks, PiStudioMarks } from "./PiMarks";
import { PiDownload, PiPricing } from "./PiPricing";
import { PiEvalTable } from "./PiTable";
import { PiNav } from "./PiNav";
import { RiftMiniApp } from "@/app/components/landing-v2/RiftMiniApp";
import {
  PI_BODY,
  PI_CONTAINER,
  PI_GAP,
  PI_FIG,
  PI_INDEX,
  PI_LABEL,
  PI_TOKENS,
} from "./pi-system";

/**
 * RIFT's landing, rebuilt from scratch in primeintellect.ai's language.
 *
 * This is a second, parallel page — /landing/pi — built to be compared against
 * the existing one rather than to replace it. Everything it does comes from
 * the measurement written up in pi-system.ts, and the summary is short:
 * small type, a visible modular grid, monospace on every machine fact,
 * decimal indices, two-tone headings, and a piece of real evidence inside
 * every cell.
 *
 * ── The one place we improve on the reference ──
 *
 * Prime Intellect fills its grid with *diagrams of* its product: a reward
 * curve, a leaderboard mock, an isometric of its inference core. Beautiful,
 * and one step removed from the thing itself. RIFT's cells can hold the
 * product running — the live plan, the real reconnaissance pass, the real
 * render — because those already exist and are already wired up on the other
 * landing. That is the strongest hand this page has, and the structure below
 * is built to hold it.
 */

/* ── Content, all of it read off the product ──────────────────────────── */

const BUILD_FEATURES = [
  "Plan mode drafts the change and waits; agent mode goes straight to work",
  "A filesystem, a package manager and a terminal — not a diff preview",
  "Tests and type-checks run in the same sandbox that made the change",
  "Tools called, lines changed, context used and dollars spent, live",
] as const;

const STUDIO_FEATURES = [
  "Every frontier image and video model behind one prompt box",
  "Billed together, so the model is a choice rather than a subscription",
  "Renders land in the same thread as the code that needed them",
] as const;

const WORKBENCH_FEATURES = [
  "Scope is declared before anything runs, and stays pinned to the session",
  "87 tools across 25 categories, preinstalled in an isolated container",
  "Findings are verified before they are reported, never asserted",
] as const;

const PLUGIN_FEATURES = [
  "Any MCP server connects by URL, with OAuth handled",
  "Credentials live in a vault rather than pasted into a prompt",
  "Schemas load on demand — a connected tool costs nothing until called",
] as const;

/** A real run's tool-call curve: fast at the start, flattening as it verifies. */
const RUN_CURVE = [
  0, 2, 5, 9, 14, 18, 23, 29, 33, 38, 41, 45, 47, 50, 52, 53, 55, 56, 56, 57,
  58, 58, 59, 59, 60,
] as const;

/**
 * Real routes only.
 *
 * A footer is the cheapest place on a page to invent links, and the most
 * expensive place to get caught doing it — a dead /careers is read as the
 * whole page being decoration. Every href below resolves.
 */
const FOOTER_COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Build", href: "#build" },
      { label: "Studio", href: "#studio" },
      { label: "Hack Workbench", href: "#workbench" },
      { label: "Plugins & MCP", href: "#plugins" },
    ],
  },
  {
    title: "Decide",
    links: [
      { label: "Compare", href: "#compare" },
      { label: "Pricing", href: "#pricing" },
      { label: "Download", href: "#download" },
    ],
  },
  {
    title: "Start",
    links: [
      { label: "Log in", href: "/login" },
      { label: "Create an account", href: "/signup" },
      { label: "Desktop app", href: "/download" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms of service", href: "/terms-of-service" },
      { label: "Privacy policy", href: "/privacy-policy" },
      { label: "Refund policy", href: "/refund-policy" },
    ],
  },
] as const;

export function PrimeLanding() {
  return (
    <MotionConfig reducedMotion="user">
      <div
        id="pi-top"
        style={PI_TOKENS}
        className="min-h-full bg-[var(--pi-ground)] font-sans text-[var(--pi-ink)] antialiased"
      >
        <PiNav />
        <PiHero />

        {/* No bottom padding: the footer carries the page's one gap value
          (40px) like every other seam. 96px here plus the footer's own 40
          put 136px of dead ground under a page whose entire argument is
          that its blocks sit 40px apart. */}
        <main className={PI_CONTAINER}>
          {/* ── 01 Build ────────────────────────────────────────────────── */}
          <div id="build" className={`${PI_GAP} scroll-mt-28`}>
            <PiCell bleed>
              <div className="relative h-[240px] overflow-hidden sm:h-[300px] lg:h-[340px]">
                <PiDotField shape="columns" />
                <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--pi-cell)_0%,rgba(14,14,15,0.82)_22%,rgba(14,14,15,0.34)_38%,transparent_54%)]" />
                <div className="absolute inset-0 flex flex-col justify-center px-7">
                  <PiHeading
                    lead="Build."
                    rest="An agent that finishes the job, inside a sandbox that can run it."
                    className="max-w-[34ch]"
                  />
                  <div className="mt-5 flex flex-wrap gap-2">
                    <a
                      href="/login"
                      className="bg-[var(--pi-ink)] px-3.5 py-2 font-mono text-[11.5px] uppercase text-[var(--pi-ground)] transition-transform duration-100 active:scale-[0.985] motion-reduce:transition-none"
                    >
                      Start building ›
                    </a>
                    <a
                      href="#workbench"
                      className="border border-[var(--pi-line)] bg-[rgba(255,255,255,0.05)] px-3.5 py-2 font-mono text-[11.5px] uppercase transition-transform duration-100 active:scale-[0.985] motion-reduce:transition-none"
                    >
                      See a run
                    </a>
                  </div>
                </div>
              </div>
            </PiCell>

            {/*
             * Fig.1 is the product, running.
             *
             * This is the whole reason to build this page. primeintellect.ai
             * fills its grid with *diagrams of* its product — a reward curve, a
             * leaderboard mock, an isometric of an inference core — and they are
             * beautiful and one step removed from the thing. RIFT's cells can
             * hold the thing: a real agent loop, a real reconnaissance pass
             * against an authorised host, a real render. Putting a drawing here
             * instead would be losing the only argument this page has that the
             * reference cannot make.
             *
             * `variant="bare"` because the cell already draws the frame. The
             * mini app keeps the application's own colours inside it.
             */}
            <div className="relative mt-px border border-[var(--pi-line)] bg-[var(--pi-cell)]">
              <span
                className={`absolute -left-px -top-px z-10 border border-l-0 border-t-0 border-[var(--pi-line)] bg-[var(--pi-cell)] px-2.5 py-1.5 ${PI_FIG}`}
              >
                The product, running
              </span>
              <div className="pt-11">
                <RiftMiniApp variant="bare" />
              </div>
            </div>

            <div className="mt-px grid gap-px border border-[var(--pi-line)] bg-[var(--pi-line)] lg:grid-cols-2">
              <div className="relative bg-[var(--pi-cell)]">
                <div className="px-7 pb-8 pt-14">
                  <div className="h-[240px]">
                    <PiIsometric />
                  </div>
                </div>
              </div>
              <div className="relative bg-[var(--pi-cell)]">
                <div className="px-7 pb-8 pt-14">
                  <div className="flex items-baseline justify-between">
                    <span className={PI_LABEL}>Tool calls</span>
                    <span className="font-mono text-[13px] tabular-nums text-[var(--pi-ink)]">
                      60
                    </span>
                  </div>
                  <div className="mt-4 h-[180px]">
                    <PiRunChart points={RUN_CURVE} />
                  </div>
                  <dl className="mt-5 grid grid-cols-2 gap-x-8">
                    {[
                      ["elapsed", "1m 51s"],
                      ["diff", "+145 −25"],
                      ["context", "45%"],
                      ["spent", "$0.25"],
                    ].map(([k, v]) => (
                      <div
                        key={k}
                        className="flex items-baseline justify-between border-t border-[var(--pi-line-soft)] py-2"
                      >
                        <dt className={PI_INDEX}>{k}</dt>
                        <dd className="font-mono text-[12.5px] tabular-nums text-[var(--pi-ink)]">
                          {v}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            </div>

            {/* The vendors sit here, with the surface that routes to them,
              rather than stacked on the connector wall further down. */}
            <div className="mt-px">
              <PiModelMarks />
            </div>

            <div className="mt-px grid gap-px border border-[var(--pi-line)] bg-[var(--pi-line)] lg:grid-cols-2">
              <div className="bg-[var(--pi-cell)] p-7">
                <PiSectionTitle index="01" name="Plan, edit, run, verify" />
                <p className={`mt-4 max-w-[38ch] ${PI_BODY}`}>
                  Most tools stop at a suggestion. Build runs the loop end to
                  end and hands back a result rather than a description of one.
                </p>
                <a
                  href="/login"
                  className="mt-7 inline-block bg-[var(--pi-ink)] px-3.5 py-2 font-mono text-[11.5px] uppercase text-[var(--pi-ground)] transition-transform duration-100 active:scale-[0.985] motion-reduce:transition-none"
                >
                  Start building ›
                </a>
              </div>
              <div className="bg-[var(--pi-cell)] p-7">
                <PiFeatureList items={BUILD_FEATURES} />
              </div>
            </div>
          </div>

          {/* ── 02 Studio ───────────────────────────────────────────────── */}
          <div id="studio" className={`${PI_GAP} scroll-mt-28`}>
            <PiCell bleed>
              <div className="relative h-[240px] overflow-hidden sm:h-[300px] lg:h-[340px]">
                <PiDotField shape="flare" />
                <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--pi-cell)_0%,rgba(14,14,15,0.82)_22%,rgba(14,14,15,0.34)_38%,transparent_54%)]" />
                <div className="absolute inset-0 flex flex-col justify-center px-7">
                  <PiHeading
                    lead="Studio."
                    rest="Every frontier image and video model behind one prompt box."
                    className="max-w-[34ch]"
                  />
                </div>
              </div>
            </PiCell>

            {/* Fig.5 renders one real image per visitor per day. */}
            <div className="relative mt-px border border-[var(--pi-line)] bg-[var(--pi-cell)]">
              <span
                className={`absolute -left-px -top-px z-10 border border-l-0 border-t-0 border-[var(--pi-line)] bg-[var(--pi-cell)] px-2.5 py-1.5 ${PI_FIG}`}
              >
                Describe a shot, it renders
              </span>
              <div className="pt-11">
                <RiftMiniApp
                  variant="bare"
                  initialSurface="studio"
                  showSidebar={false}
                  autoDemo={false}
                />
              </div>
            </div>

            {/* The renderers, between the running demo and the claims about
                it — the same position the model wall holds under Build. */}
            <div className="mt-px">
              <PiStudioMarks />
            </div>

            <div className="mt-px grid gap-px border border-[var(--pi-line)] bg-[var(--pi-line)] lg:grid-cols-2">
              <div className="bg-[var(--pi-cell)] p-7">
                <PiSectionTitle index="02" name="Every frontier renderer" />
                <p className={`mt-4 max-w-[38ch] ${PI_BODY}`}>
                  Pick the model that suits the shot instead of the one you
                  happen to have a subscription to.
                </p>
              </div>
              <div className="bg-[var(--pi-cell)] p-7">
                <PiFeatureList items={STUDIO_FEATURES} />
              </div>
            </div>
          </div>

          {/* ── 03 Workbench ────────────────────────────────────────────── */}
          <div id="workbench" className={`${PI_GAP} scroll-mt-28`}>
            <PiCell bleed>
              <div className="relative h-[240px] overflow-hidden sm:h-[300px] lg:h-[340px]">
                <PiDotField shape="horizon" speed={0.8} />
                <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--pi-cell)_0%,rgba(14,14,15,0.82)_22%,rgba(14,14,15,0.34)_38%,transparent_54%)]" />
                <div className="absolute inset-0 flex flex-col justify-center px-7">
                  <PiHeading
                    lead="Workbench."
                    rest="A security lab that runs the tools rather than naming them."
                    className="max-w-[34ch]"
                  />
                </div>
              </div>
            </PiCell>

            {/* Fig.4 runs one real reconnaissance pass a day per visitor against
              scanme.nmap.org — Nmap's own public test host. The addresses,
              port timings, certificate and findings are read live. */}
            <div className="relative mt-px border border-[var(--pi-line)] bg-[var(--pi-cell)]">
              <span
                className={`absolute -left-px -top-px z-10 border border-l-0 border-t-0 border-[var(--pi-line)] bg-[var(--pi-cell)] px-2.5 py-1.5 ${PI_FIG}`}
              >
                One real pass, read live
              </span>
              <div className="pt-11">
                <PiWorkbench />
              </div>
            </div>

            <div className="mt-px grid gap-px border border-[var(--pi-line)] bg-[var(--pi-line)] lg:grid-cols-2">
              <div className="bg-[var(--pi-cell)] p-7">
                <PiSectionTitle index="03" name="Authorised assessment" />
                <p className={`mt-4 max-w-[38ch] ${PI_BODY}`}>
                  Recon, enumeration, assessment and the written report happen
                  in one session, against a target you declared first.
                </p>
              </div>
              <div className="bg-[var(--pi-cell)] p-7">
                <PiFeatureList items={WORKBENCH_FEATURES} />
              </div>
            </div>
          </div>

          {/* ── 04 Plugins ──────────────────────────────────────────────── */}
          <div id="plugins" className={`${PI_GAP} scroll-mt-28`}>
            <PiConnectorMarks />

            <div className="mt-px grid gap-px border border-[var(--pi-line)] bg-[var(--pi-line)] lg:grid-cols-2">
              <div className="bg-[var(--pi-cell)] p-7">
                <PiSectionTitle index="04" name="Bring your own tools" />
                <p className={`mt-4 max-w-[38ch] ${PI_BODY}`}>
                  Bring your own tools. Your issue tracker, your database, your
                  internal APIs.
                </p>
              </div>
              <div className="bg-[var(--pi-cell)] p-7">
                <PiFeatureList items={PLUGIN_FEATURES} />
              </div>
            </div>
          </div>

          {/*
           * The paste block.
           *
           * Sits between the tour and the argument on purpose. Everything above
           * it is the product running, everything below it is a claim about the
           * product, and this is the seam: three artefacts a reader can copy out
           * and check for themselves before deciding whether to believe the rest
           * of the page.
           */}
          <div className={PI_GAP}>
            <PiCodeCells />
          </div>

          {/* ── 05 Compare ──────────────────────────────────────────────── */}
          <div id="compare" className={`${PI_GAP} scroll-mt-28`}>
            <div className="mb-px grid gap-px border border-[var(--pi-line)] bg-[var(--pi-line)] lg:grid-cols-2">
              <div className="bg-[var(--pi-cell)] p-7">
                <PiSectionTitle index="05" name="Against the other agents" />
                <p className={`mt-4 max-w-[38ch] ${PI_BODY}`}>
                  Where RIFT differs from the other agents, and where it does
                  not.
                </p>
              </div>
              <div className="bg-[var(--pi-cell)] p-7">
                <PiHeading
                  lead="Checkable."
                  rest="Every row is a claim laid out one at a time, ties included."
                  className="max-w-[34ch]"
                />
              </div>
            </div>
            <PiEvalTable />
          </div>

          {/* ── 06 Pricing ──────────────────────────────────────────────── */}
          <div id="pricing" className={`${PI_GAP} scroll-mt-28`}>
            <div className="mb-px grid gap-px border border-[var(--pi-line)] bg-[var(--pi-line)] lg:grid-cols-2">
              <div className="bg-[var(--pi-cell)] p-7">
                <PiSectionTitle index="06" name="What it costs" />
                <p className={`mt-4 max-w-[38ch] ${PI_BODY}`}>
                  Read from the same module the checkout charges from. No weekly
                  cap on any tier.
                </p>
              </div>
              <div className="bg-[var(--pi-cell)] p-7">
                <PiHeading
                  lead="Free."
                  rest="A full agent run every month, no card, in a real sandbox."
                  className="max-w-[34ch]"
                />
              </div>
            </div>
            <PiPricing />
          </div>

          {/* ── 07 Download ─────────────────────────────────────────────── */}
          <div id="download" className={`${PI_GAP} scroll-mt-28`}>
            <PiDownload />
          </div>

          {/* ── Close ───────────────────────────────────────────────────── */}
          <div className={PI_GAP}>
            <PiCell bleed>
              <div className="relative overflow-hidden">
                {/*
                 * The mark, full-bleed, cut out of its own field.
                 *
                 * The reference's research card is a wide graphic with the
                 * logo rendered as coarse pixels inside the same scattered
                 * material that surrounds it — not a badge placed on a
                 * background. This band was a dot field with the flat SVG
                 * logo sitting on top of it in the right-hand column, which
                 * is the arrangement that construction exists to avoid.
                 *
                 * Anchored at 66% so the copy keeps the left third.
                 */}
                <div className="absolute inset-0">
                  <PiPixelMark anchorX={0.66} scale={0.92} />
                </div>
                <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--pi-cell)_0%,rgba(14,14,15,0.88)_24%,rgba(14,14,15,0.32)_42%,transparent_58%)]" />
                <div className="relative px-7 py-20">
                  <div className="max-w-[36ch]">
                    <PiHeading
                      lead="Open a sandbox."
                      rest="Give it something hard."
                      className="max-w-[22ch]"
                    />
                    <p className={`mt-4 max-w-[46ch] ${PI_BODY}`}>
                      No install, no credit card. The first run tells you more
                      than this page can.
                    </p>
                    <div className="mt-8 flex flex-wrap gap-2">
                      <a
                        href="/login"
                        className="bg-[var(--pi-ink)] px-4 py-2.5 font-mono text-[12px] uppercase text-[var(--pi-ground)] transition-transform duration-100 active:scale-[0.985] motion-reduce:transition-none"
                      >
                        Start building ›
                      </a>
                      <a
                        href="/download"
                        className="border border-[var(--pi-line)] bg-[rgba(255,255,255,0.05)] px-4 py-2.5 font-mono text-[12px] uppercase transition-transform duration-100 active:scale-[0.985] motion-reduce:transition-none"
                      >
                        Download
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </PiCell>
          </div>
        </main>

        {/*
         * The footer, in the same grammar as everything above it.
         *
         * Prime Intellect's is a set of hairline columns rather than a centred
         * row of links, which is the right ending for a page that has spent
         * 10,000px insisting it is a document. Column heads are indexed like the
         * sections; the links are the real routes this product has, not a
         * plausible-looking site map.
         */}
        <footer className={`${PI_GAP} border-t border-[var(--pi-line)]`}>
          <div className={PI_CONTAINER}>
            <div className="grid gap-px bg-[var(--pi-line)] sm:grid-cols-2 lg:grid-cols-4">
              {FOOTER_COLUMNS.map((column) => (
                /*
                 * `px-7`, and none of it on the outer edges.
                 *
                 * The cells sat flush against the hairlines between them, so
                 * every link in the middle two columns read as though it were
                 * printed on the rule. The padding gives the rules their own
                 * space; dropping it on the first and last column keeps the
                 * outermost text aligned with the container edge, and with the
                 * copyright row underneath, which it was not before either.
                 */
                <div
                  key={column.title}
                  className="bg-[var(--pi-ground)] px-7 py-9 first:pl-0 last:pr-0"
                >
                  <p className={PI_LABEL}>{column.title}</p>
                  <ul className="mt-5 flex flex-col gap-3">
                    {column.links.map((link) => (
                      <li key={link.label}>
                        <a
                          href={link.href}
                          className="text-[13.5px] leading-[1.35] text-[var(--pi-dim)] transition-colors hover:text-[var(--pi-ink)] motion-reduce:transition-none"
                        >
                          {link.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-3 border-t border-[var(--pi-line)] py-7 sm:flex-row sm:items-center sm:justify-between">
              <span className="flex items-center gap-2.5">
                <RiftLogo size={17} className="text-[var(--pi-ink)]" />
                <span className={PI_INDEX}>
                  © {new Date().getFullYear()} RIFT
                </span>
              </span>
              <span className="flex items-center gap-4">
                <a
                  href="mailto:hello@riftsys.app"
                  className={`${PI_INDEX} normal-case transition-colors hover:text-[var(--pi-ink)] motion-reduce:transition-none`}
                >
                  hello@riftsys.app
                </a>
                <span aria-hidden className="h-3 w-px bg-[var(--pi-line)]" />
                <span className={PI_INDEX}>Parallel build · /landing/v4</span>
              </span>
            </div>
          </div>
        </footer>
      </div>
    </MotionConfig>
  );
}
