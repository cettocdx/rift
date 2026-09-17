"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { RiftWordmark } from "@/components/icons/rift-wordmark";
import { navigateToAuth } from "@/app/hooks/useTauri";

const NAV = [
  { label: "Recon", id: "recon" },
  { label: "Arsenal", id: "arsenal" },
  { label: "Security", id: "security" },
  { label: "Pricing", id: "pricing" },
];

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

export function LandingHeaderRift2() {
  return (
    <header className="absolute inset-x-0 top-0 z-50 px-4 pt-5 sm:px-8">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="rounded-md focus-visible:outline-none"
          aria-label="RIFT home"
        >
          <RiftWordmark height={21} className="text-foreground" />
        </button>

        <nav className="hidden items-center gap-1 rounded-full border border-border/50 bg-background/40 px-1 py-1 backdrop-blur-md md:flex">
          {NAV.map(({ label, id }) => (
            <button
              key={id}
              type="button"
              onClick={() => scrollTo(id)}
              className="rounded-full px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:bg-surface-2/80 hover:text-foreground"
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigateToAuth("/login")}
            className="hidden rounded-full px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground sm:inline"
          >
            Log in
          </button>
          <button
            type="button"
            onClick={() =>
              navigateToAuth("/signup", { preferSignInForReturningUser: true })
            }
            className="rounded-full border border-border/60 bg-background/50 px-4 py-1.5 text-[12px] font-medium text-foreground backdrop-blur-sm transition-colors hover:bg-surface-2"
          >
            Get started
          </button>
        </div>
      </div>
    </header>
  );
}

export function Rift2OutlineButton({
  children,
  onClick,
  href,
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
}) {
  const className =
    "group inline-flex items-center gap-2 rounded-full border border-border/70 bg-transparent px-5 py-2.5 text-[13px] font-medium text-foreground transition-colors hover:border-signal/50 hover:bg-surface-2/40";

  if (href) {
    return (
      <Link href={href} className={className}>
        {children}
        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {children}
      <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}
