"use client";

import { RiftWordmark } from "@/components/icons/rift-wordmark";
import { useEffect, useState } from "react";

import { RiftLogo } from "@/components/icons/rift-logo";

import { X_BTN_FILLED, X_BTN_GHOST, X_CONTAINER, X_SMALL } from "./x-system";

/**
 * The bar, built to the reference's arrangement.
 *
 * Rebuilt to orchid.ai. Theirs: mark hard left, a row of links immediately
 * beside it rather than centred, and two controls hard right — a soft-white
 * pill and a filled ink one, both small. The links sit at 14/500 in ink/55 and
 * come to full ink on hover, which is the only state change in the whole bar.
 *
 * Their bar is `absolute`, not fixed: it belongs to the fold and scrolls away
 * with it, because their page is short enough to end where it started. Ours is
 * eleven sections with anchor links pointing into them, so it stays — but it
 * stays the reference's way, transparent over the fold and taking paper only
 * once the page has moved, rather than sitting in a permanent bordered strip.
 *
 * The one thing worth copying beyond the measurements is what is *absent*:
 * no search, no theme switch, no locale picker, no badge counting anything.
 * A bar with two actions in it tells a reader there are two things to do.
 */

/**
 * `interior` is the href a page other than the landing should use.
 *
 * Most of these are sections of the landing and have nowhere else to go, so
 * they resolve against `/`. Pricing is different: `/pricing` is a real page
 * with the same table plus the credit packs, and sending a reader to the
 * landing's anchor instead would be sending them to the shorter version of the
 * page they asked for — from, in one case, the pricing page itself.
 */
const LINKS = [
  { label: "Build", href: "#build", interior: "/#build" },
  { label: "Studio", href: "#studio", interior: "/#studio" },
  { label: "Hack", href: "#workbench", interior: "/#workbench" },
  { label: "Connect", href: "#connect", interior: "/#connect" },
  { label: "Pricing", href: "#pricing", interior: "/pricing" },
  { label: "Download", href: "/download", interior: "/download" },
] as const;

/**
 * `interior` — the bar on a page that is not the landing.
 *
 * Pricing, download and the legal documents share this bar, and on those pages
 * an `#build` href resolves against the current document and does nothing. The
 * flag switches every link to its `interior` destination and points the mark
 * at `/`.
 *
 * It is a flag rather than making every href absolute everywhere because the
 * landing also serves `/landing/x`, where `/#build` would navigate away from
 * the page the reader is on.
 */
export function XNav({ interior = false }: { interior?: boolean } = {}) {
  const [lifted, setLifted] = useState(false);

  useEffect(() => {
    // The bar is transparent over the fold and takes a ground once the page
    // moves, so the hero reads full-bleed and the bar stays legible over
    // everything after it.
    const onScroll = () => setLifted(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      data-landing-chrome
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-200 motion-reduce:transition-none ${
        lifted
          ? "border-b-[0.5px] border-b-[var(--x-line)] bg-[var(--x-ground)]/85 backdrop-blur-xl"
          : "border-b-[0.5px] border-b-transparent"
      }`}
    >
      <div className={`${X_CONTAINER} flex h-[76px] items-center gap-8`}>
        <a
          href={interior ? "/" : "#top"}
          aria-label="RIFT home"
          className="flex shrink-0 items-center gap-2.5"
        >
          <RiftLogo size={22} className="text-[var(--x-ink)]" />
          <RiftWordmark
            decorative
            height={28}
            className="text-[19px] font-medium leading-none tracking-[-0.025em]"
          />
        </a>

        {/*
         * Below lg the link row is hidden and the bar was a mark and one
         * button — Pricing unreachable except by scrolling the whole page. The
         * row now scrolls horizontally on small screens instead of vanishing,
         * which is a smaller change than a sheet and removes the dead end.
         */}
        <nav
          aria-label="Sections"
          className="-mx-2 flex items-center overflow-x-auto px-2 [mask-image:linear-gradient(to_right,transparent,#000_12px,#000_calc(100%-28px),transparent)] [scrollbar-width:none] lg:[mask-image:none] [&::-webkit-scrollbar]:hidden"
        >
          {LINKS.map((link) => (
            <a
              key={link.label}
              href={interior ? link.interior : link.href}
              className={`${X_SMALL} shrink-0 rounded-full px-3 py-1.5 font-normal text-[var(--x-ink-50)] transition-colors hover:text-[var(--x-ink)] motion-reduce:transition-none`}
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/*
         * One primary action, and a way back in — not "Contact sales".
         *
         * That button pointed at a mailto and promised an organisation that
         * does not exist: there are no seats, no SSO and no enterprise tier in
         * lib/pricing/plans.ts, and the top plan is described as "for power
         * users and small teams". It also contradicted the note above this
         * component in its own words — a bar with two actions tells a reader
         * there are two things to do — by making three.
         */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <a
            href="/login"
            className={`${X_BTN_GHOST} hidden text-[var(--x-ink-50)] hover:text-[var(--x-ink)] sm:inline-flex`}
          >
            Log in
          </a>
          {/* /signup, not /login. "Start building" is the primary call on a
              page whose traffic is cold; sending a first-time visitor to a
              password field is the cheapest conversion loss on the page. */}
          <a href="/signup" className={X_BTN_FILLED}>
            Start building
          </a>
        </div>
      </div>
    </header>
  );
}
