"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

import { navigateToAuth } from "@/app/hooks/useTauri";
import { buildAuthLink } from "@/lib/routing/auth-link";
import { RiftBrandLockup } from "@/components/icons/rift-brand-lockup";

const NAV = [
  { label: "How Build works", id: "how" },
  { label: "Models", id: "models" },
  { label: "Studio", id: "studio" },
  { label: "Hack Workbench", id: "hack-workbench" },
  { label: "Pricing", id: "pricing" },
] as const;

const FOCUS = "focus-visible:outline-none";

function reduceMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({
    behavior: reduceMotion() ? "auto" : "smooth",
    block: "start",
  });
}

export function LandingHeader({
  sectionLinksToHome = false,
  authReturnPath,
}: {
  /** Use real home-page hash links when this shared header appears on a subpage. */
  sectionLinksToHome?: boolean;
  authReturnPath?: string;
} = {}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const visit = (id: string) => {
    setMobileOpen(false);
    scrollToSection(id);
  };

  return (
    <header className="relative z-20 border-b border-white/[0.08] bg-[#070a10] text-[#f6f7fb]">
      <a
        href="#landing-main"
        className="absolute left-4 top-2 -translate-y-20 rounded-md bg-[#f6f7fb] px-3 py-2 text-sm font-medium text-[#070a10] transition-transform focus:translate-y-0 focus:outline-none"
      >
        Skip to content
      </a>

      <div className="mx-auto flex min-h-[68px] max-w-[1500px] items-center justify-between gap-3 px-5 sm:px-7 lg:px-10">
        {sectionLinksToHome ? (
          <Link
            href="/"
            className={`flex min-h-11 shrink-0 cursor-pointer items-center rounded-md text-[#f6f7fb] transition-colors hover:text-white ${FOCUS}`}
            aria-label="Go to RIFT home"
          >
            <RiftBrandLockup decorative markSize={30} textSize={15} gap={10} />
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => visit("landing-main")}
            className={`flex min-h-11 shrink-0 cursor-pointer items-center rounded-md text-[#f6f7fb] transition-colors hover:text-white ${FOCUS}`}
            aria-label="Go to RIFT home"
          >
            <RiftBrandLockup decorative markSize={30} textSize={15} gap={10} />
          </button>
        )}

        <nav
          aria-label="Primary navigation"
          className="hidden items-center gap-1 xl:flex"
        >
          {NAV.map(({ label, id }) =>
            sectionLinksToHome ? (
              <Link
                key={id}
                href={`/#${id}`}
                className={`inline-flex min-h-11 cursor-pointer items-center rounded-full px-3 text-[13px] font-medium text-[#aab3c1] transition-colors hover:bg-white/[0.07] hover:text-white ${FOCUS}`}
              >
                {label}
              </Link>
            ) : (
              <button
                key={id}
                type="button"
                onClick={() => visit(id)}
                className={`min-h-11 cursor-pointer rounded-full px-3 text-[13px] font-medium text-[#aab3c1] transition-colors hover:bg-white/[0.07] hover:text-white ${FOCUS}`}
              >
                {label}
              </button>
            ),
          )}
        </nav>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <Link
            href="/download"
            className={`hidden min-h-11 items-center rounded-full px-3 text-[13px] font-medium text-[#aab3c1] transition-colors hover:bg-white/[0.07] hover:text-white md:inline-flex ${FOCUS}`}
          >
            Download
          </Link>
          <button
            type="button"
            onClick={() =>
              navigateToAuth(buildAuthLink("/login", authReturnPath))
            }
            className={`hidden min-h-11 cursor-pointer items-center rounded-full px-3 text-[13px] font-medium text-[#aab3c1] transition-colors hover:bg-white/[0.07] hover:text-white sm:inline-flex ${FOCUS}`}
          >
            Log in
          </button>
          <button
            type="button"
            onClick={() =>
              navigateToAuth(buildAuthLink("/signup", authReturnPath), {
                preferSignInForReturningUser: true,
              })
            }
            className={`inline-flex min-h-11 cursor-pointer items-center whitespace-nowrap rounded-full bg-[#f6f7fb] px-4 text-[13px] font-semibold text-[#070a10] transition-[background-color,transform] duration-200 hover:bg-white active:translate-y-px motion-reduce:transition-none ${FOCUS}`}
          >
            Start building
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            className={`inline-flex size-11 cursor-pointer items-center justify-center rounded-full border border-white/[0.14] bg-white/[0.05] text-[#e8ebf2] transition-colors hover:bg-white/[0.1] xl:hidden ${FOCUS}`}
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileOpen}
            aria-controls="landing-mobile-navigation"
          >
            {mobileOpen ? (
              <X aria-hidden="true" className="size-5" strokeWidth={1.8} />
            ) : (
              <Menu aria-hidden="true" className="size-5" strokeWidth={1.8} />
            )}
          </button>
        </div>
      </div>

      {mobileOpen ? (
        <nav
          id="landing-mobile-navigation"
          aria-label="Mobile navigation"
          className="border-t border-white/[0.08] bg-[#0b0f18] px-5 py-3 xl:hidden"
        >
          <div className="mx-auto grid max-w-[1400px] gap-1 sm:grid-cols-2">
            {NAV.map(({ label, id }) =>
              sectionLinksToHome ? (
                <Link
                  key={id}
                  href={`/#${id}`}
                  onClick={() => setMobileOpen(false)}
                  className={`flex min-h-11 cursor-pointer items-center rounded-[12px] px-3 text-left text-[14px] font-medium text-[#c0c7d2] transition-colors hover:bg-white/[0.07] hover:text-white ${FOCUS}`}
                >
                  {label}
                </Link>
              ) : (
                <button
                  key={id}
                  type="button"
                  onClick={() => visit(id)}
                  className={`min-h-11 cursor-pointer rounded-[12px] px-3 text-left text-[14px] font-medium text-[#c0c7d2] transition-colors hover:bg-white/[0.07] hover:text-white ${FOCUS}`}
                >
                  {label}
                </button>
              ),
            )}
            <Link
              href="/download"
              onClick={() => setMobileOpen(false)}
              className={`flex min-h-11 items-center rounded-[12px] px-3 text-[14px] font-medium text-[#c0c7d2] transition-colors hover:bg-white/[0.07] hover:text-white md:hidden ${FOCUS}`}
            >
              Download
            </Link>
            <button
              type="button"
              onClick={() => {
                setMobileOpen(false);
                void navigateToAuth(buildAuthLink("/login", authReturnPath));
              }}
              className={`min-h-11 cursor-pointer rounded-[12px] px-3 text-left text-[14px] font-medium text-[#c0c7d2] transition-colors hover:bg-white/[0.07] hover:text-white sm:hidden ${FOCUS}`}
            >
              Log in
            </button>
          </div>
        </nav>
      ) : null}
    </header>
  );
}
