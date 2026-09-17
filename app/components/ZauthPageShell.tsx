"use client";

import Link from "next/link";
import { type CSSProperties, type ReactNode } from "react";
import { LANDING_PALETTE } from "@/app/components/landing-v2/palette";
import { PRIME_TOKENS } from "@/app/components/design/prime-scale";
import { X_TOKENS } from "@/app/components/landing-x/x-system";
import { RiftBrandLockup } from "@/components/icons/rift-brand-lockup";
import { AuthProductProof } from "./AuthProductProof";

/**
 * The notice surface — the auth-error page and the desktop hand-off.
 *
 * These two are the only pages on the default variant, and they are both a
 * card in the middle of an otherwise empty screen, reached from a sign-in that
 * did not complete. That makes them part of the auth flow, so they run the
 * same palette as the form: the landing's white ground and pure black ink,
 * with the legacy names repointed the same way `AUTH_SHELL` repoints them.
 *
 * It used to be `LANDING_PALETTE` — a blue-tinted near-black with a saturated
 * accent — which was correct when the public site was dark. Leaving it would
 * mean a failed sign-in inverts the screen, which reads as a second failure.
 */
const SHELL: CSSProperties = {
  ...LANDING_PALETTE,
  ...X_TOKENS,
  ["--background" as string]: "var(--x-ground)",
  ["--foreground" as string]: "var(--x-ink)",
  ["--muted-foreground" as string]: "var(--x-ink-45)",
  ["--border" as string]: "var(--x-line)",
  ["--card" as string]: "var(--x-ground)",
  ["--popover" as string]: "var(--x-ground)",
  ["--primary" as string]: "var(--x-ink)",
  ["--primary-foreground" as string]: "var(--x-ground)",
};

/**
 * The sign-in surface runs the landing's system, repointed — not its own.
 *
 * ── The history, because the variable names still carry it ──
 *
 * This surface has been three things. It ran the landing palette at a 13px
 * base — marketing type on the last screen before the workspace. Then it ran
 * `PRIME_TOKENS`, a product-UI scale measured off a real application: true
 * black ground, `#fafafa` ink, 16/24 base, 6px corners, every step recorded in
 * app/components/design/prime-scale.ts.
 *
 * The scale is still that one. The *palette* is now the landing's, because the
 * landing was rebuilt to gumloop's system — white ground, pure black ink, one
 * grotesk — and a visitor who clicks "Log in" from that page should not watch
 * the product invert underneath them. Sign-in is the seam between the
 * marketing site and the workspace, and a seam is exactly where a palette
 * change is most visible.
 *
 * The `--pa-*` names are kept and repointed rather than replaced. Every class
 * in AuthForm and AuthProductProof already reads them, so the surface flips in
 * one place, and if the light ground ever turns out to be wrong here the
 * values below are the only thing that has to move back. The steps are the
 * same ones the landing uses (x-system.ts) so the two agree by construction
 * rather than by two people picking similar greys.
 */
const AUTH_SHELL: CSSProperties = {
  ...LANDING_PALETTE,
  ...PRIME_TOKENS,
  ...X_TOKENS,

  /* The measured scale's names, pointed at the landing's values. */
  ["--pa-ground" as string]: "var(--x-ground)",
  ["--pa-surface" as string]: "var(--x-raise-strong)",
  ["--pa-surface-soft" as string]: "var(--x-raise)",
  ["--pa-surface-faint" as string]: "rgba(0,0,0,0.04)",
  ["--pa-active" as string]: "rgba(0,0,0,0.06)",
  ["--pa-line" as string]: "var(--x-line)",
  ["--pa-line-soft" as string]: "var(--x-line-soft)",
  ["--pa-ink" as string]: "var(--x-ink)",
  ["--pa-nav" as string]: "var(--x-ink-80)",
  ["--pa-muted" as string]: "var(--x-ink-45)",
  ["--pa-faint" as string]: "var(--x-ink-30)",

  /* shadcn's own names, so anything rendered inside the form agrees. */
  ["--background" as string]: "#ffffff",
  ["--foreground" as string]: "#000000",
  ["--card" as string]: "#ffffff",
  ["--popover" as string]: "#ffffff",
  ["--card-foreground" as string]: "#000000",
  ["--primary" as string]: "#000000",
  ["--primary-foreground" as string]: "#ffffff",
};

function AuthBrand() {
  return (
    <Link
      href="/"
      aria-label="RIFT home"
      className="inline-flex items-center rounded-md text-[var(--pa-ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--pa-ink)]"
    >
      <RiftBrandLockup decorative markSize={35} textSize={16} gap={10} />
    </Link>
  );
}

function AuthLegalLinks() {
  return (
    <nav
      aria-label="Legal"
      data-landing-chrome
      className="flex items-center gap-5 font-normal"
    >
      <Link
        href="/terms-of-service"
        className="rounded-sm transition-colors hover:text-[var(--pa-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pa-ink)]"
      >
        Terms
      </Link>
      <Link
        href="/privacy-policy"
        className="rounded-sm transition-colors hover:text-[var(--pa-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pa-ink)]"
      >
        Privacy
      </Link>
    </nav>
  );
}

export default function ZauthPageShell({
  children,
  header = true,
  footer = false,
  center = false,
  variant = "default",
  authVisual = "application",
  className,
}: {
  children: ReactNode;
  header?: boolean;
  center?: boolean;
  footer?: boolean;
  variant?: "default" | "auth";
  authVisual?: "application" | "login-artwork";
  className?: string;
}) {
  if (variant === "auth") {
    const isFullBleedLoginArtwork = authVisual === "login-artwork";

    return (
      <div
        style={AUTH_SHELL}
        data-auth-surface="split"
        className="min-h-[100dvh] bg-[var(--pa-ground)] text-[16px] font-normal leading-[24px] text-[var(--pa-ink)] antialiased"
      >
        <div
          aria-hidden
          data-rift-native-titlebar="auth-window"
          data-tauri-drag-region
          className="rift-native-window-drag-strip"
        />
        <main
          data-auth-layout={isFullBleedLoginArtwork ? "full-bleed" : "framed"}
          className={
            isFullBleedLoginArtwork
              ? "flex min-h-[100dvh] w-full"
              : "mx-auto flex min-h-[100dvh] w-full max-w-[1600px] md:p-4 lg:p-6"
          }
        >
          <div
            className={
              isFullBleedLoginArtwork
                ? "grid min-h-[100dvh] w-full overflow-hidden bg-[var(--pa-ground)] lg:grid-cols-2"
                : "grid min-h-[100dvh] w-full overflow-hidden bg-[var(--pa-ground)] md:min-h-[calc(100dvh-2rem)] md:rounded-[8px] md:border-[0.5px] md:border-[var(--pa-line-soft)] lg:min-h-[calc(100dvh-3rem)] lg:grid-cols-[minmax(430px,0.78fr)_minmax(0,1.22fr)]"
            }
          >
            <section className="flex min-h-[100dvh] min-w-0 flex-col px-5 py-5 sm:px-8 md:min-h-0 md:px-9 md:py-7 lg:px-12 xl:px-16">
              <header
                data-auth-window-header
                data-rift-native-titlebar="auth"
                data-tauri-drag-region
                // Marks the page's own chrome for the 24px hit-area floor in
                // globals. A sweep found "Back home" at 20px and the legal
                // links at 17 — standalone controls, not links inside a
                // sentence, so the WCAG inline exemption does not cover them.
                data-landing-chrome
                className="flex items-center justify-between gap-6"
              >
                <AuthBrand />
                <Link
                  href="/"
                  className="rounded-[6px] text-[14px] font-normal leading-[20px] text-[var(--pa-muted)] transition-colors hover:text-[var(--pa-ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--pa-ink)]"
                >
                  Back home
                </Link>
              </header>

              <div className="flex flex-1 items-center py-10 sm:py-12 md:py-8">
                <div className="mx-auto w-full max-w-[400px]">{children}</div>
              </div>

              <footer
                data-landing-chrome
                className="flex items-center justify-between gap-4 text-[14px] font-normal leading-[20px] text-[var(--pa-muted)]"
              >
                <RiftBrandLockup
                  markSize={16}
                  textSize={11}
                  gap={5}
                  className="text-[var(--pa-muted)]"
                />
                <AuthLegalLinks />
              </footer>
            </section>

            <AuthProductProof variant={authVisual} />
          </div>
        </main>
      </div>
    );
  }

  const showAuthChrome = center || header;

  return (
    <div
      style={SHELL}
      className="relative flex min-h-[100dvh] flex-col bg-background font-sans text-foreground antialiased"
    >
      {showAuthChrome ? (
        <header
          data-landing-chrome
          className="sticky top-0 z-10 shrink-0 border-b-[0.5px] border-b-[var(--x-line)] bg-[var(--x-ground)]/85 backdrop-blur-xl"
        >
          <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-4 sm:px-6">
            <Link
              href="/"
              aria-label="RIFT home"
              className="flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--x-ink)]"
            >
              <RiftBrandLockup decorative markSize={26} textSize={13} gap={8} />
            </Link>
            <Link
              href="/"
              className="rounded-md text-[14px] text-[var(--x-ink-45)] transition-colors hover:text-[var(--x-ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--x-ink)]"
            >
              Back to home
            </Link>
          </div>
        </header>
      ) : null}

      <main
        className={`relative flex-1 ${center ? "flex items-center justify-center px-4 py-10 sm:py-14" : ""} ${className ?? ""}`}
      >
        {children}
      </main>

      {footer || center ? (
        <footer
          data-landing-chrome
          className="relative shrink-0 border-t-[0.5px] border-t-[var(--x-line)] py-6 text-center text-[13px] font-normal text-[var(--x-ink-45)]"
        >
          <Link
            href="/terms-of-service"
            className="rounded-sm transition-colors hover:text-[var(--x-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--x-ink)]"
          >
            Terms
          </Link>
          {"  ·  "}
          <Link
            href="/privacy-policy"
            className="rounded-sm transition-colors hover:text-[var(--x-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--x-ink)]"
          >
            Privacy
          </Link>
        </footer>
      ) : null}
    </div>
  );
}
