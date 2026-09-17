"use client";

import { RiftWordmark } from "@/components/icons/rift-wordmark";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { RiftLogo } from "@/components/icons/rift-logo";

import { F1_NAV_LINKS } from "./f1-content";
import { F1_CONTAINER_CLASS } from "./f1-design";
import { useLandingScrollContainer } from "./LandingShell";

const FOCUS_RING_CLASS = "focus-visible:outline-none";

export function F1LandingNav() {
  const [lifted, setLifted] = useState(false);
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const scrollContainer = useLandingScrollContainer();

  useEffect(() => {
    const element = scrollContainer?.current;
    if (!element) return;

    const onScroll = () => setLifted(element.scrollTop > 80);
    onScroll();
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, [scrollContainer]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <header
      data-lifted={lifted ? "true" : "false"}
      className="fixed inset-x-0 top-0 z-50 border-b border-transparent transition-[background-color,border-color,backdrop-filter] duration-200 data-[lifted=true]:border-border data-[lifted=true]:bg-background/85 data-[lifted=true]:backdrop-blur-xl motion-reduce:transition-none"
    >
      <div
        className={`${F1_CONTAINER_CLASS} flex h-14 items-center gap-3 lg:h-16`}
      >
        <a
          href="#top"
          aria-label="RIFT home"
          className={`flex min-h-11 items-center gap-2.5 ${FOCUS_RING_CLASS}`}
        >
          <RiftLogo size={21} className="text-foreground" />
          <RiftWordmark
            decorative
            height={20}
            className="text-[13px] font-medium tracking-[0.02em]"
          />
        </a>

        <nav
          aria-label="Primary"
          className="ml-auto hidden items-center gap-1 lg:flex"
        >
          {F1_NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`inline-flex h-10 items-center rounded-full px-3 text-[13px] text-foreground/65 transition-colors duration-200 hover:bg-foreground/5 hover:text-foreground ${FOCUS_RING_CLASS}`}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-4">
          <Link
            href="/login"
            className={`hidden h-10 items-center rounded-full px-3 text-[13px] text-foreground/70 transition-colors duration-200 hover:text-foreground sm:inline-flex ${FOCUS_RING_CLASS}`}
          >
            Sign in
          </Link>
          <Link
            href="/download"
            className={`inline-flex h-10 items-center rounded-full bg-[var(--primary)] px-4 text-[13px] font-medium text-[#080808] transition-transform duration-200 active:translate-y-px ${FOCUS_RING_CLASS}`}
          >
            Download
          </Link>
          <button
            ref={toggleRef}
            type="button"
            aria-expanded={open}
            aria-controls="f1-mobile-nav"
            aria-label={open ? "Close navigation" : "Open navigation"}
            onClick={() => setOpen((value) => !value)}
            className={`inline-flex size-11 items-center justify-center rounded-full border border-border text-foreground lg:hidden ${FOCUS_RING_CLASS}`}
          >
            {open ? (
              <X aria-hidden="true" className="size-4" />
            ) : (
              <Menu aria-hidden="true" className="size-4" />
            )}
          </button>
        </div>
      </div>

      {open ? (
        <nav
          id="f1-mobile-nav"
          aria-label="Mobile"
          className="border-t border-border bg-background px-5 py-3 lg:hidden"
        >
          <div className="mx-auto flex max-w-[1240px] flex-col">
            {F1_NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={`flex min-h-11 items-center border-b border-border text-[15px] text-foreground last:border-0 ${FOCUS_RING_CLASS}`}
              >
                {link.label}
              </a>
            ))}
          </div>
        </nav>
      ) : null}
    </header>
  );
}
