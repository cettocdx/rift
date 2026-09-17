"use client";

import { RiftWordmark } from "@/components/icons/rift-wordmark";
import { RiftLogo } from "@/components/icons/rift-logo";

import { ClosingBand } from "./ClosingBand";
import { Reveal } from "./Reveal";

import {
  CLOSING_RHYTHM_CLASS,
  MICRO_LABEL_CLASS,
  CONTAINER_CLASS,
  SECTION_HEADING_CLASS,
} from "./type-scale";

/**
 * Closing call to action, then the footer.
 *
 * Every link here points at a route that exists — the legal column is the part
 * of a landing page people actually go looking for when they are deciding
 * whether to trust you with a codebase, so it gets real estate rather than a
 * grey line of six-pixel text.
 */

const FOOTER_COLUMNS: {
  heading: string;
  links: { label: string; href: string }[];
}[] = [
  {
    heading: "Product",
    links: [
      { label: "Build", href: "#build" },
      { label: "Studio", href: "#studio" },
      { label: "Hack Workbench", href: "#workbench" },
      { label: "Plugins & MCP", href: "#extend" },
      { label: "Compare", href: "#compare" },
    ],
  },
  {
    heading: "Get started",
    links: [
      { label: "Sign in", href: "/login" },
      { label: "Pricing", href: "/pricing" },
      { label: "Download", href: "/download" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy Policy", href: "/privacy-policy" },
      { label: "Terms of Service", href: "/terms-of-service" },
      { label: "Refund Policy", href: "/refund-policy" },
    ],
  },
];

export function LandingFooter() {
  return (
    <>
      <section className={`${CONTAINER_CLASS} ${CLOSING_RHYTHM_CLASS}`}>
        <Reveal>
          <ClosingBand />
        </Reveal>
      </section>

      {/* The page's own chrome: marks it for the 24px hit-area floor in
          globals, which deliberately does not reach inside the embedded
          mini-applications. */}
      <footer data-landing-chrome className="border-t border-border">
        <div className={`${CONTAINER_CLASS} py-14`}>
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
            <div>
              <div className="flex items-center gap-2.5">
                <RiftLogo size={22} className="text-foreground" />
                <RiftWordmark
                  decorative
                  height={20}
                  className="text-[13px] font-medium tracking-[0.02em] text-foreground"
                />
              </div>
              <p className="mt-4 max-w-[34ch] text-[12.5px] leading-[1.6] text-[var(--cursor-text-secondary)]">
                The agent workstation. Build, generate and test from one
                surface.
              </p>
            </div>

            {FOOTER_COLUMNS.map((column) => (
              <nav key={column.heading} aria-label={column.heading}>
                <h2 className={MICRO_LABEL_CLASS}>{column.heading}</h2>
                <ul className="mt-4 space-y-2.5">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        className="text-[13px] text-foreground/75 transition-colors hover:text-foreground motion-reduce:transition-none"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>

          <div className="mt-14 flex flex-col gap-2 border-t border-border pt-6 text-[12px] text-[var(--cursor-text-secondary)] sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} RIFT. All rights reserved.</p>
            <p>
              <a
                href="mailto:hello@riftsys.app"
                className="transition-colors hover:text-foreground motion-reduce:transition-none"
              >
                hello@riftsys.app
              </a>
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
