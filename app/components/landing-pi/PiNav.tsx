"use client";

import { RiftWordmark } from "@/components/icons/rift-wordmark";
import { RiftLogo } from "@/components/icons/rift-logo";

import { desktopReleaseStatus, downloadLinks } from "@/app/download/constants";

import { PI_CONTAINER, PI_INDEX, PI_LABEL } from "./pi-system";

/**
 * The numbered navigation, and the announcement bar above it.
 *
 * Two devices from primeintellect.ai, both measured:
 *
 *   1. The nav sections are numbered — `TRAINING 01 · INFERENCE 02 · COMPUTE
 *      03 · RESEARCH 04` — with the label at 88% white and the index at 45%,
 *      each pair inside its own bordered segment. It turns a nav into a table
 *      of contents, which is the single clearest signal that the page intends
 *      to be read as a document.
 *
 *   2. Above it sits a thin bar carrying one announcement and one hard fact
 *      about getting the product. Theirs is a copyable `pip install`.
 *
 * ── What used to be here ──
 *
 * A copyable `curl -fsSL https://riftsys.app/install.sh | sh`. It was checked
 * and that URL returns 404 — in production, not just locally. There is no
 * install script and no CLI package in this repo; the line was written because
 * the reference page had one in that slot.
 *
 * That is the worst kind of thing to put above the fold, because it is the one
 * element on the page that looks like proof rather than copy. What replaced it
 * is the build that genuinely exists, carrying the disclosure the download page
 * carries — an unsigned direct build, Apple verification pending. A smaller
 * claim that is true beats a larger one that a reader can falsify in one
 * paste.
 *
 * Pricing and Download point at anchors rather than at /pricing and /download.
 * Both sections are on this page now, and sending a reader to another route
 * for something two screens below them is how a landing page loses them.
 */

const SECTIONS = [
  { id: "build", label: "Build", index: "01" },
  { id: "studio", label: "Studio", index: "02" },
  { id: "workbench", label: "Workbench", index: "03" },
  { id: "plugins", label: "Plugins", index: "04" },
] as const;

export function PiNav() {
  return (
    <header
      // Marks the page's own chrome, so the 24px hit-area floor in globals
      // applies here and not inside the embedded mini-applications — those are
      // pixel-identical to the product and must stay that way.
      data-landing-chrome
      className="sticky top-0 z-50 bg-[var(--pi-ground)]/92 backdrop-blur-sm"
    >
      {/* Announcement bar. */}
      <div className="border-b border-[var(--pi-line)]">
        <div
          className={`${PI_CONTAINER} flex h-9 items-center justify-center gap-4`}
        >
          <span className="hidden text-[12.5px] text-[var(--pi-dim)] sm:inline">
            The agent workstation is in preview{" "}
            <span aria-hidden className="text-[var(--pi-faint)]">
              ↗
            </span>
          </span>
          <span
            aria-hidden
            className="hidden h-4 w-px bg-[var(--pi-line)] sm:block"
          />
          <a
            href={downloadLinks.macos}
            className="group flex items-center gap-2.5 font-mono text-[11.2px] text-[rgba(255,255,255,0.75)] transition-colors hover:text-[var(--pi-ink)] motion-reduce:transition-none"
          >
            <span className="truncate">Download for macOS</span>
            <span className="shrink-0 text-[var(--pi-faint)] group-hover:text-[var(--pi-ink)]">
              {desktopReleaseStatus.macos}
            </span>
          </a>
        </div>
      </div>

      {/* The numbered nav. */}
      <div className="border-b border-[var(--pi-line)]">
        <div className={`${PI_CONTAINER} flex h-14 items-center gap-6`}>
          <a href="#top" className="flex shrink-0 items-center gap-2.5">
            <RiftLogo size={19} className="text-[var(--pi-ink)]" />
            <RiftWordmark
              decorative
              height={22}
              className="text-[15px] font-medium tracking-[0.01em] text-[var(--pi-ink)]"
            />
          </a>

          <nav aria-label="Sections" className="hidden items-center lg:flex">
            {SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                // Each pair inside its own segment, sharing one border with
                // its neighbour — theirs exactly.
                className="flex w-[164px] items-center justify-between border border-r-0 border-[var(--pi-line)] px-3 py-1.5 transition-colors last:border-r hover:bg-[rgba(255,255,255,0.04)] motion-reduce:transition-none"
              >
                <span className={PI_LABEL}>{section.label}</span>
                <span className={PI_INDEX}>{section.index}</span>
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-5">
            <a
              href="#pricing"
              className="hidden text-[13px] text-[var(--pi-dim)] transition-colors hover:text-[var(--pi-ink)] sm:block motion-reduce:transition-none"
            >
              Pricing
            </a>
            <a
              href="#download"
              className="hidden text-[13px] text-[var(--pi-dim)] transition-colors hover:text-[var(--pi-ink)] sm:block motion-reduce:transition-none"
            >
              Download
            </a>
            <a
              href="/login"
              className={`border border-[var(--pi-line)] px-3 py-1.5 ${PI_LABEL} transition-[background-color,transform] duration-100 hover:bg-[rgba(255,255,255,0.06)] active:scale-[0.985] motion-reduce:transition-none`}
            >
              Log in
            </a>
            <a
              href="/login"
              className={`bg-[var(--pi-ink)] px-3 py-1.5 font-mono text-[12px] uppercase text-[var(--pi-ground)] transition-transform duration-100 active:scale-[0.98] motion-reduce:transition-none`}
            >
              Start building ›
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}
