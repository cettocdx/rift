"use client";

import { RiftWordmark } from "@/components/icons/rift-wordmark";
import { useEffect, useState } from "react";

import { RiftLogo } from "@/components/icons/rift-logo";

import { useLandingScrollContainer } from "./LandingShell";

import { CONTAINER_CLASS } from "./type-scale";
import { CONTROL } from "./landing-design-system";

/**
 * Floating chrome.
 *
 * The bar is a translucent material with the page moving underneath it rather
 * than an opaque strip that eats a fixed band of the screen. It stays invisible
 * over the hero — where the brand is already the largest thing on screen — and
 * materialises once the page has scrolled past it, so it never competes with
 * the opening frame.
 */

const LINKS = [
  { label: "Build", href: "#build" },
  { label: "Studio", href: "#studio" },
  { label: "Workbench", href: "#workbench" },
  { label: "Compare", href: "#compare" },
  { label: "Pricing", href: "#pricing" },
  { label: "Download", href: "#download" },
];

export function LandingNav() {
  const [lifted, setLifted] = useState(false);
  const scrollContainer = useLandingScrollContainer();

  useEffect(() => {
    // The page scrolls in its own element, so the window never fires here.
    const element = scrollContainer?.current;
    if (!element) return;
    const onScroll = () => setLifted(element.scrollTop > 80);
    onScroll();
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, [scrollContainer]);

  return (
    <header
      data-landing-chrome
      data-lifted={lifted ? "true" : "false"}
      // `group/nav` so the edge fade can read the lifted state.
      // A hairline under floating chrome draws a line the page does not have.
      // Apple's rule for this is a scroll edge effect: where content passes
      // under the bar, fade it out instead of ruling it off. The gradient below
      // does that; the bar keeps its blur, and nothing is underlined.
      className="group/nav fixed inset-x-0 top-0 z-50 transition-[background-color,backdrop-filter] duration-300 data-[lifted=true]:bg-background/70 data-[lifted=true]:backdrop-blur-xl motion-reduce:transition-none"
    >
      {/* The edge itself: a short fade from the bar's ground to nothing, so
          content dissolves under the chrome rather than meeting a rule. Only
          drawn once the page has scrolled, because there is nothing to fade
          against at the top. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-full h-6 bg-[linear-gradient(to_bottom,var(--background),transparent)] opacity-0 transition-opacity duration-300 group-data-[lifted=true]/nav:opacity-70 motion-reduce:transition-none"
      />
      <div
        className={`${CONTAINER_CLASS} flex h-14 items-center justify-between`}
      >
        <a
          href="#top"
          aria-label="RIFT — top of page"
          className="flex items-center gap-2.5"
        >
          <RiftLogo size={20} className="text-foreground" />
          <RiftWordmark
            decorative
            height={20}
            className="text-[13px] font-medium tracking-[0.02em] text-foreground"
          />
        </a>

        <nav
          aria-label="Sections"
          className="hidden items-center gap-1 md:flex"
        >
          {LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className={`rounded-full px-3 py-1.5 ${CONTROL} text-foreground/60 transition-colors hover:bg-foreground/5 hover:text-foreground motion-reduce:transition-none`}
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Two actions, not one. Every page in the benchmark separates the
            returning user from the new one — Axiom pairs "Sign in" with a
            filled "Start free", Cursor with "Download", Linear with "Sign up".
            A nav offering only "Sign in" asks the visitor to already have an
            account, which is the one thing a landing page can assume they do
            not. */}
        <div className="flex items-center gap-2">
          <a
            href="/login"
            className={`hidden h-8 items-center rounded-full px-3 ${CONTROL} text-foreground/60 transition-colors hover:text-foreground motion-reduce:transition-none sm:inline-flex`}
          >
            Sign in
          </a>
          <a
            href="/login"
            className={`inline-flex h-8 items-center rounded-full bg-foreground px-3.5 ${CONTROL} text-background transition-transform duration-100 active:scale-[0.985] motion-reduce:transition-none`}
          >
            Start building
          </a>
        </div>
      </div>

      {/* Below `md` the six links were simply hidden, with nothing in their
          place and no menu button — every section of the page was unreachable
          on a phone. A scrolling strip rather than a hamburger: these are six
          in-page anchors, so hiding them behind a disclosure adds a tap and a
          piece of state to reach something that fits on one line. The mini app
          switches its own surfaces the same way, two hundred pixels below. */}
      <nav
        aria-label="Sections"
        className="flex gap-1 overflow-x-auto px-6 pb-2 [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden"
      >
        {LINKS.map((link) => (
          <a
            key={link.label}
            href={link.href}
            className={`shrink-0 rounded-full px-3 py-1.5 ${CONTROL} text-foreground/60 transition-colors hover:text-foreground active:scale-[0.98] motion-reduce:transition-none`}
          >
            {link.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
