import { RiftWordmark } from "@/components/icons/rift-wordmark";
import { RiftLogo } from "@/components/icons/rift-logo";

import { H_BTN_SOLID, H_CONTAINER, H_NAV } from "./h-system";

const LINKS = [
  { label: "Build", href: "#build" },
  { label: "Studio", href: "#studio" },
  { label: "Workbench", href: "#workbench" },
  { label: "Specs", href: "#specs" },
  { label: "Pricing", href: "#pricing" },
] as const;

/**
 * The bar. Hermeus sets its nav uppercase and letter-spaced, hard right, with
 * the winged mark hard left and one shop control. Ours mirrors the arrangement
 * and the register: mark left, uppercase links, one solid square CTA — no pill,
 * which is the fastest single tell that this is not the x landing.
 */
export function HNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--h-line)] bg-[var(--h-ground)]/85 backdrop-blur-md">
      <div className={`${H_CONTAINER} flex h-16 items-center justify-between`}>
        <a
          href="#top"
          aria-label="RIFT home"
          className="flex items-center gap-2.5"
        >
          <RiftLogo size={22} className="text-[var(--h-ink)]" />
          <RiftWordmark
            decorative
            height={22}
            className="text-[15px] font-semibold uppercase tracking-[0.18em] text-[var(--h-ink)]"
          />
        </a>
        <nav
          aria-label="Sections"
          className="hidden items-center gap-9 lg:flex"
        >
          {LINKS.map((l) => (
            <a key={l.label} href={l.href} className={H_NAV}>
              {l.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <a href="/login" className={`${H_NAV} hidden sm:inline`}>
            Log in
          </a>
          <a href="/signup" className={H_BTN_SOLID}>
            Start
          </a>
        </div>
      </div>
    </header>
  );
}
