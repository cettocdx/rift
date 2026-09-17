import type { CSSProperties, ReactNode } from "react";

import { XNav } from "@/app/components/landing-x/XNav";
import { XFooter } from "@/app/components/landing-x/XClose";
import {
  X_CAPTION,
  X_CONTAINER,
  X_LABEL,
  X_SECTION,
  X_SECTION_PAD,
  X_TOKENS,
} from "@/app/components/landing-x/x-system";

/**
 * Every public page that is not the landing page itself.
 *
 * Pricing, download and the three legal documents each used to carry their own
 * palette, their own header and their own idea of what a heading weighs. A
 * reader who followed a footer link met a different product. This is the one
 * shell they share.
 *
 * ── Why it was rebuilt ──
 *
 * That shell was landing-v2's: near-black, a machined-metal photograph behind
 * the title, a 64px display at -0.06em. It was coherent with the landing page
 * of the time. The landing is gumloop's system now — white ground, pure black
 * ink, one grotesk, a 0.5px hairline where a border used to be — and these
 * pages are one click from it. A reader who clicks "Pricing" in the bar and
 * watches the site invert has been told the two pages are different products.
 *
 * So the metal plate is gone rather than recoloured. It was the hero's
 * material seen from closer, and the hero it belonged to no longer exists; a
 * photograph behind a title is not a device the current reference uses
 * anywhere. What replaces it is what the landing does at the top of every
 * section — a mono eyebrow, the heading, one line of copy, and a rule.
 *
 * The bar and the footer are the landing's own components in `interior` mode,
 * not copies of them, so a link added to either appears on all six pages.
 */

/**
 * The x palette, plus every legacy name the page bodies still read.
 *
 * The bodies below this shell — the download page's install panels, the legal
 * documents, the credit-pack grid — were written against the old shell's
 * vocabulary: `--surface` for a raised panel, `--border` for a hairline,
 * `--cursor-text-secondary` for running copy, `--signal-bright` for an accent.
 * Those names are all defined in globals.css with a light and a dark value, so
 * when this shell stopped supplying a palette they did not break — they
 * silently resolved against whatever the root theme was, which put a `#1c1c1c`
 * panel and an orange tick on a white page.
 *
 * Repointing the names here fixes every one of them at once. The alternative
 * was editing several hundred class strings across four files to say
 * `var(--x-raise)` instead of `var(--surface)`, which is the same change made
 * by hand, in more places, with more chances to miss one.
 *
 * `@theme inline` in globals.css maps `--color-border: var(--border)` and keeps
 * the reference rather than resolving it at build time, which is what makes an
 * override on an ancestor reach the `border-border` utility at all.
 */
const MARKETING_TOKENS: CSSProperties = {
  ...X_TOKENS,

  ["--background" as string]: "var(--x-ground)",
  ["--foreground" as string]: "var(--x-ink)",
  ["--muted-foreground" as string]: "var(--x-ink-45)",
  ["--cursor-text-secondary" as string]: "var(--x-ink-45)",
  ["--border" as string]: "var(--x-line)",
  ["--border-strong" as string]: "var(--x-line-soft)",
  ["--surface" as string]: "var(--x-raise)",
  ["--card" as string]: "var(--x-ground)",
  ["--popover" as string]: "var(--x-ground)",
  ["--primary" as string]: "var(--x-ink)",
  ["--primary-foreground" as string]: "var(--x-ground)",
  /*
   * The accent becomes ink, not a colour.
   *
   * `--signal-bright` was a blue on light and an orange on dark, and it is
   * what the download page ticks and the pack bonuses were drawn in. This
   * page's whole argument is monochrome; the one place colour is still spent
   * is the Hack Workbench flagship marker, which names `--x-live` directly.
   */
  ["--signal-bright" as string]: "var(--x-ink)",
};

export function MarketingPage({
  title,
  eyebrow,
  lede,
  meta,
  children,
}: {
  title: string;
  /** The mono label above the title. Defaults to nothing rather than a guess. */
  eyebrow?: string;
  /** One sentence. Anything longer belongs in the page body. */
  lede?: string;
  /** Small print beside the lede: a revision date, a platform note. */
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      style={MARKETING_TOKENS}
      className="min-h-full bg-[var(--x-ground)] text-[16px] leading-[24px] text-[var(--x-ink)] antialiased"
    >
      {/* The copy is in the HTML; a reader whose script never runs should not
          meet a blank page. */}
      <noscript>
        <style>{`[data-landing-reveal]{opacity:1!important;transform:none!important}`}</style>
      </noscript>
      <a
        href="#page-body"
        className="fixed left-4 top-3 z-50 -translate-y-24 rounded-full bg-[var(--x-ink)] px-3.5 py-2 text-[13px] font-medium text-[var(--x-ground)] transition-transform duration-150 focus:translate-y-0 focus:outline-none motion-reduce:transition-none"
      >
        Skip to content
      </a>
      <XNav interior />

      <main>
        {/* The bar is fixed and 76 tall; the title clears it rather than
            starting under it. */}
        <header className="border-b-[0.5px] border-b-[var(--x-line)] pb-14 pt-[132px] md:pb-16 md:pt-[148px]">
          <div className={X_CONTAINER}>
            {eyebrow ? <p className={X_LABEL}>{eyebrow}</p> : null}
            <h1
              className={`${X_SECTION} ${eyebrow ? "mt-5" : ""} max-w-[20ch] text-balance text-[var(--x-ink)]`}
            >
              {title}
            </h1>
            {lede ? (
              <p className={`${X_CAPTION} mt-5 max-w-[56ch]`}>{lede}</p>
            ) : null}
            {meta ? (
              <div className={`${X_CAPTION} mt-4 text-[13px]`}>{meta}</div>
            ) : null}
          </div>
        </header>

        <div id="page-body">{children}</div>
      </main>

      <XFooter interior />
    </div>
  );
}

/** The body container every interior page shares, so measures stay equal. */
export function MarketingBody({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`${X_CONTAINER} ${X_SECTION_PAD} ${className}`}>
      {children}
    </div>
  );
}
