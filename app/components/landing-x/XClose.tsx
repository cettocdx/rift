"use client";

import { RiftWordmark } from "@/components/icons/rift-wordmark";
import Link from "next/link";

import { Reveal } from "./reveal";
import { XShatterMark } from "./XShatterMark";

import { PLANS } from "@/lib/pricing/plans";
import { desktopReleaseStatus, downloadLinks } from "@/app/download/constants";
import { RiftLogo } from "@/components/icons/rift-logo";

import {
  X_BODY_SM,
  X_BTN_FILLED,
  X_BTN_GHOST,
  X_CAPTION,
  X_CARD_TITLE,
  X_CONTAINER,
  X_LABEL,
  X_NUMERAL,
  X_SECTION,
  X_SECTION_PAD,
  X_SECTION_PAD_TIGHT,
  X_SMALL,
} from "./x-system";

/**
 * Price, then the last frame, then the footer.
 *
 * The prices come from `lib/pricing/plans`, the module the checkout charges
 * from. A landing page carrying its own copy of a price is a page that will
 * eventually advertise a number nobody honours.
 */

const FOOTER = [
  {
    title: "Product",
    links: [
      { label: "Build", href: "#build" },
      { label: "Studio", href: "#studio" },
      { label: "Hack Workbench", href: "#workbench" },
      { label: "Connect", href: "#connect" },
      { label: "Everything", href: "#everything" },
    ],
  },
  {
    title: "Start",
    links: [
      { label: "Create an account", href: "/signup" },
      { label: "Log in", href: "/login" },
      { label: "Desktop app", href: "/download" },
      // `/pricing` from an interior page, the anchor from the landing — see
      // XNav's LINKS for why the real page wins where one exists.
      { label: "Pricing", href: "#pricing", interior: "/pricing" },
    ],
  },
  {
    // The two internal landing drafts used to be listed here, under a heading
    // that says Company. Publishing your own unfinished A/B experiments in the
    // footer tells a visitor the company has not decided who it is; they are
    // still reachable by URL for whoever is comparing them, and no longer
    // advertised.
    title: "Company",
    links: [
      { label: "Contact", href: "mailto:hello@riftsys.app" },
      { label: "Download", href: "/download" },
      { label: "Pricing", href: "#pricing", interior: "/pricing" },
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

/**
 * The footer's column headings, at reading size rather than as a mono eyebrow
 * — which is what makes a footer read as the end of a document rather than as
 * a sitemap. Local to this file because it is the only place that wants it.
 */
const X_FOOTER_HEADING =
  "text-[15px] font-medium leading-none tracking-[-0.025em] text-[var(--x-ink)]";

function Tick() {
  return (
    <span
      aria-hidden
      className="mt-[8px] size-1.5 shrink-0 rounded-full bg-[var(--x-ink-30)]"
    />
  );
}

/**
 * Three tiers as ruled columns, with the price set in the display serif.
 *
 * The reference has no pricing page, so this is its grammar applied rather
 * than a shape copied: a figure that matters is set in the reading serif, a
 * group of things is separated by 0.5px rules rather than closed in a box, and
 * the recommended tier is marked with a word instead of a coloured border.
 * That last one is the substantive change — the highlight used to be carried
 * only by which button was filled, which is a distinction a reader has to go
 * looking for.
 */
export function XPricing() {
  return (
    <section id="pricing" className={`${X_SECTION_PAD} scroll-mt-24`}>
      <div className={X_CONTAINER}>
        <Reveal>
          <p className={X_LABEL}>Pricing</p>
          {/* Was "Three tiers, and not one of them has a weekly cap." Free caps
              questions per day and both paid tiers cap credits per month, so the
              claim was true only of the word *weekly*. The heading now points at
              the thing the tiers actually differ on. */}
          <h2
            className={`${X_SECTION} mt-5 max-w-[18ch] text-balance text-[var(--x-ink)]`}
          >
            Three tiers. The machine is the same on all of them.
          </h2>
        </Reveal>

        <Reveal step={1}>
          <div className="mt-16">
            <XPlanTable />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/**
 * The three tiers, ruled.
 *
 * Rendered by the landing's pricing section and by /pricing, which is the
 * whole reason it is a component. Those two were separate drawings of the same
 * table — the landing's ruled columns against /pricing's three bordered cards
 * at deliberately unequal widths — and a reader who clicked "Pricing" in the
 * bar arrived at a differently-shaped version of what they had just scrolled
 * past. The asymmetry was a real idea and it loses to consistency here: the
 * plan a reader should take is marked by a label and a filled pill, which
 * survives the column widths being equal.
 */
export function XPlanTable() {
  return (
    <>
      <div className="grid divide-y-[0.5px] divide-[var(--x-line)] border-t-[0.5px] border-t-[var(--x-line)] lg:grid-cols-3 lg:divide-x-[0.5px] lg:divide-y-0">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            // Named for the tests: "Hack Workbench appears on Max and
            // nowhere else" is an invariant about what each tier includes,
            // and it needs a handle that does not depend on the styling.
            data-plan={plan.name.toLowerCase()}
            className="flex flex-col py-10 lg:px-10 lg:first:pl-0 lg:last:pr-0"
          >
            <div className="flex items-baseline justify-between gap-4">
              {/* A heading, not a styled span. A pricing table is a thing
                    people navigate by heading in a screen reader, and the
                    three plan names are its only landmarks. */}
              <h3 className={`${X_CARD_TITLE} text-[var(--x-ink)]`}>
                {plan.name}
              </h3>
              {plan.highlight ? (
                <span className={X_LABEL}>Recommended</span>
              ) : null}
            </div>
            <p className="mt-7 flex items-baseline gap-2">
              <span className={`${X_NUMERAL} text-[52px] text-[var(--x-ink)]`}>
                {plan.price}
              </span>
              <span className={X_CAPTION}>{plan.cadence}</span>
            </p>
            <p className={`${X_CAPTION} mt-4`}>{plan.blurb}</p>
            <ul className="mt-8 flex flex-col gap-3">
              {plan.features.map((feature) => {
                // The Hack Workbench is the flagship of the Max tier and
                // the one line a buyer is scanning for. It gets a filled
                // chip in the live accent instead of a grey tick, so its
                // weight on the page matches its weight in the product.
                const flagship = /hack workbench/i.test(feature);
                return (
                  <li key={feature} className="flex gap-3">
                    {flagship ? (
                      <span
                        aria-hidden
                        className="mt-[3px] flex size-4 shrink-0 items-center justify-center rounded-full bg-[var(--x-live)] text-[10px] font-bold text-white"
                      >
                        ★
                      </span>
                    ) : (
                      <Tick />
                    )}
                    <span
                      className={
                        flagship
                          ? "text-[15px] font-medium leading-[23px] tracking-[-0.025em] text-[var(--x-ink)]"
                          : `${X_BODY_SM} text-[var(--x-ink-80)]`
                      }
                    >
                      {feature}
                    </span>
                  </li>
                );
              })}
            </ul>
            {/* `mt-auto` on the wrapper, not the pill: the three columns
                  carry different numbers of features, and a button that sits
                  wherever its own list ended makes the row look unaligned. */}
            <div className="mt-auto pt-10">
              <a
                href={plan.href}
                className={`${plan.highlight ? X_BTN_FILLED : X_BTN_GHOST} w-full justify-center`}
              >
                {plan.cta}
              </a>
            </div>
          </div>
        ))}
      </div>
      {/*
       * Objection handling, adjacent to the price where it is read.
       *
       * Both audits flagged the pricing tiers as three bare cards with the
       * only reassurance a scroll away in the footer. On a page whose whole
       * argument is that its claims are checkable, "cancel anytime" and a
       * real refund policy cost nothing and are checkable — the refund link
       * points at the same policy the footer does.
       */}
      <p className={`${X_CAPTION} mt-12 text-center`}>
        Cancel anytime. Every paid plan is covered by the{" "}
        <a
          href="/refund-policy"
          className="text-[var(--x-ink-80)] underline decoration-[var(--x-line-soft)] underline-offset-4 transition-colors hover:text-[var(--x-ink)] hover:decoration-[var(--x-ink)] motion-reduce:transition-none"
        >
          refund policy
        </a>
        .
      </p>
    </>
  );
}

/**
 * The last frame.
 *
 * ── What this is now ──
 *
 * The reference closes on a single wide photograph with one line of white
 * serif set across it and one white pill underneath — no columns, no feature
 * list, nothing to compare. By that point in the page a reader has decided
 * *what*, and a closing section that hands them a choice matrix is asking them
 * to start deciding again.
 *
 * So the two doors moved below the frame and shrank to two ruled columns, and
 * the frame itself carries one sentence and one action. The horizon inside it
 * is the same `XAtmosphere` limb the page used to spend full-bleed on the
 * section's background — it is a better closing image than it was a backdrop,
 * because inside a corner it reads as a photograph of a horizon rather than as
 * the page fading out.
 */
export function XClose() {
  return (
    <section className={X_SECTION_PAD_TIGHT}>
      <div className={X_CONTAINER}>
        {/*
         * The closing band.
         *
         * The composition is /landing/pi's — copy held in the left third by a
         * left-to-right scrim, the mark filling the right — but the mark is no
         * longer the still `PiPixelMark`. `XShatterMark` rasterises the real
         * artwork into a grid and cycles it: the pieces fly apart and ease back
         * into the logo. "The pieces come together" is the right last note for
         * a page whose argument is that the agent finishes the job, and a still
         * graphic could not make it.
         *
         * Square corners and mono buttons are deliberate and are the one place
         * on this page that breaks its own rounded, sans grammar. It is the
         * last block on the page and reads as a plate rather than a section.
         */}
        <Reveal>
          <div className="relative overflow-hidden border border-[#202020] bg-[#0e0e0f]">
            <div className="absolute inset-0">
              <XShatterMark className="ml-auto h-full w-[62%]" />
            </div>
            {/* The scrim: opaque under the copy, gone by 58%. */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#0e0e0f_0%,rgba(14,14,15,0.88)_24%,rgba(14,14,15,0.32)_42%,transparent_58%)]" />

            <div className="relative px-7 py-20 md:px-12">
              <div className="max-w-[36ch]">
                <h2 className="max-w-[22ch] text-[22px] font-normal leading-[1.2] tracking-normal sm:text-[25px] lg:text-[28px]">
                  <span className="text-[#ededed]">Open a sandbox.</span>{" "}
                  <span className="text-white/50">Give it something hard.</span>
                </h2>
                <p className="mt-4 max-w-[46ch] text-[15px] leading-[1.55] text-white/[0.62]">
                  No install, no credit card. Your first agent run is free, on a
                  real machine, verified before it says done.
                </p>
                <div className="mt-8 flex flex-wrap gap-2">
                  {/* /signup, not /login: this page's traffic is cold and the
                      last control on it should not be a password field. */}
                  <a
                    href="/signup"
                    className="bg-[#ededed] px-4 py-2.5 font-mono text-[12px] uppercase text-[#0b0b0c] transition-transform duration-100 active:scale-[0.985] motion-reduce:transition-none"
                  >
                    Start building ›
                  </a>
                  <a
                    href="/download"
                    className="border border-[#202020] bg-white/[0.05] px-4 py-2.5 font-mono text-[12px] uppercase text-[#ededed] transition-transform duration-100 active:scale-[0.985] motion-reduce:transition-none"
                  >
                    Download
                  </a>
                </div>
              </div>
            </div>
          </div>
        </Reveal>

        {/* The two doors, demoted to a footnote of the frame above. */}
        <Reveal step={1}>
          <div className="mt-16 grid divide-y-[0.5px] divide-[var(--x-line)] border-t-[0.5px] border-t-[var(--x-line)] lg:grid-cols-2 lg:divide-x-[0.5px] lg:divide-y-0">
            <div className="flex flex-col py-10 lg:pr-14">
              <h3 className={`${X_CARD_TITLE} text-[var(--x-ink)]`}>
                In the browser
              </h3>
              <p className={`${X_CAPTION} mt-3 max-w-[420px]`}>
                Every Build and Studio model, an isolated cloud sandbox per run,
                and any MCP server by URL.
              </p>
            </div>

            <div className="flex flex-col py-10 lg:pl-14">
              <h3 className={`${X_CARD_TITLE} text-[var(--x-ink)]`}>
                On your machine
              </h3>
              <p className={`${X_CAPTION} mt-3 max-w-[420px]`}>
                The same account, the same sandboxes and the same history as the
                browser. The surface changes; the workspace does not.
              </p>
              {/* No tick beside Windows. `downloadLinks.windows` is null —
                  there is no Windows build — and a checkmark beside something
                  that does not exist is the kind of detail that costs a
                  reader's trust in the whole list. It is stated, not ticked. */}
              <p className={`${X_CAPTION} mt-3`}>
                macOS available now · Windows — not yet.{" "}
                {desktopReleaseStatus.windows}.
              </p>
              <a
                href={downloadLinks.macos}
                className={`${X_BTN_GHOST} mt-7 self-start`}
              >
                Download for macOS
              </a>
              <p className={`${X_CAPTION} mt-3`}>
                {desktopReleaseStatus.macos} First launch needs right-click →
                Open.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/**
 * The footer.
 *
 * Two details taken straight from the reference: the wordmark set in the
 * display serif beside the symbol, and a live status line under it — a small
 * emerald dot and four words, which is the only hue on the entire page and the
 * only place it is spent.
 */
/** `interior` — see XNav: the in-page anchors resolve against the landing. */
export function XFooter({ interior = false }: { interior?: boolean } = {}) {
  return (
    <footer data-landing-chrome className="pb-20 pt-8">
      <div className={X_CONTAINER}>
        <div className="grid gap-14 lg:grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))]">
          <div>
            {/* On the landing this is a scroll to the top; on an interior
                page it is the way back. `Link` rather than `<a>` because the
                second branch is a route, and a full reload from the footer of
                a document page is a slower way to do the same thing. */}
            <Link
              href={interior ? "/" : "#top"}
              aria-label="RIFT home"
              className="flex items-center gap-2.5"
            >
              <RiftLogo size={22} className="text-[var(--x-ink)]" />
              <RiftWordmark
                decorative
                height={28}
                className="text-[19px] font-medium leading-none tracking-[-0.025em]"
              />
            </Link>
            <p className="mt-5 flex items-center gap-2 text-[14px] leading-[20px] text-[var(--x-ink-80)]">
              <span
                aria-hidden
                className="size-1.5 rounded-full bg-[var(--x-live)]"
              />
              All systems operational
            </p>
            <p className={`${X_CAPTION} mt-5 max-w-[28ch]`}>
              The agent workstation. Plan, write, execute and verify from one
              surface.
            </p>
          </div>

          {FOOTER.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <p className={X_FOOTER_HEADING}>{column.title}</p>
              <ul className="mt-5 flex flex-col gap-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={
                        interior
                          ? "interior" in link
                            ? link.interior
                            : link.href.startsWith("#")
                              ? `/${link.href}`
                              : link.href
                          : link.href
                      }
                      className={`${X_SMALL} font-normal text-[var(--x-ink-50)] transition-colors hover:text-[var(--x-ink)] motion-reduce:transition-none`}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-20 flex flex-col gap-3 border-t-[0.5px] border-t-[var(--x-line)] pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className={X_CAPTION} suppressHydrationWarning>
            © {new Date().getFullYear()} RIFT
          </p>
          <a
            href="mailto:hello@riftsys.app"
            className={`${X_CAPTION} transition-colors hover:text-[var(--x-ink)] motion-reduce:transition-none`}
          >
            hello@riftsys.app
          </a>
        </div>
      </div>
    </footer>
  );
}
