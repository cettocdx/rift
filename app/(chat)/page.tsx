"use client";

import React from "react";
import { Authenticated, Unauthenticated } from "convex/react";
import Header from "../components/Header";
import Footer from "../components/Footer";
import { Chat } from "../components/chat";
import { RiftBackdrop } from "../components/rift/RiftBackdrop";
import { LandingSections } from "../components/landing/LandingSections";
import { navigateToAuth } from "../hooks/useTauri";

const CAPABILITIES = [
  { tag: "RECON", desc: "footprint, subdomains, open ports, tech stack" },
  { tag: "EXPLOIT", desc: "find & weaponize vulnerabilities autonomously" },
  { tag: "REPORT", desc: "write up findings with proof and remediation" },
];

// Marketing landing for unauthenticated visitors. A huge watching eye fills the
// background; the only call to action is "Launch App" (→ signup/chat).
const UnauthenticatedContent = () => {
  const launch = () =>
    navigateToAuth("/signup", { preferSignInForReturningUser: true });

  React.useEffect(() => {
    const checkHash = () => {
      if (
        window.location.hash === "#pricing" ||
        window.location.hash === "#team-pricing-seat-selection"
      ) {
        navigateToAuth("/signup?intent=pricing", {
          preferSignInForReturningUser: true,
        });
      }
    };
    checkHash();
    window.addEventListener("hashchange", checkHash);
    return () => window.removeEventListener("hashchange", checkHash);
  }, []);

  return (
    <div className="relative h-full flex flex-col overflow-hidden bg-transparent">
      {/* The huge watching RIFT — landing background only */}
      <RiftBackdrop />

      <div className="relative z-10 flex-shrink-0">
        <Header />
      </div>

      <div className="relative z-10 flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto">
          <section className="flex min-h-[86vh] flex-col items-center justify-center px-6 py-12">
            <div className="relative flex w-full max-w-2xl flex-col items-center text-center">
              {/* readability scrim: darkens just behind the copy so the eye stays
                visible around it without washing out the text */}
              <div
                className="pointer-events-none absolute inset-x-[-12%] inset-y-[-8%] -z-[1]"
                style={{
                  background:
                    "radial-gradient(60% 55% at 50% 50%, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.6) 55%, transparent 100%)",
                }}
              />
              {/* status line */}
              <div className="hud-label mb-5 text-primary/80">
                {"// RIFT v1.0 — AUTONOMOUS OFFENSIVE INTELLIGENCE"}
              </div>

              {/* headline */}
              <h1 className="animate-fade-in-up text-balance text-5xl font-normal leading-[1.04] tracking-tight text-foreground sm:text-6xl md:text-7xl text-rift-glow">
                <span className="block">See everything.</span>
                <span className="display-emphasis animate-hero-highlight block">
                  Miss nothing.
                </span>
              </h1>

              {/* what it does */}
              <p
                className="animate-fade-in-up mt-6 max-w-xl text-pretty text-sm leading-relaxed text-foreground/80 sm:text-base"
                style={{ animationDelay: "0.6s" }}
              >
                Point RIFT at a target and walk away. It runs reconnaissance,
                finds and exploits vulnerabilities, and writes the report — on
                its own, inside its own isolated sandbox. You watch. It works.
              </p>

              {/* capability chips (ASCII) */}
              <div className="mt-7 grid w-full max-w-xl gap-2 sm:grid-cols-3">
                {CAPABILITIES.map((c) => (
                  <div
                    key={c.tag}
                    className="hud bg-surface/60 px-3 py-2.5 text-left"
                  >
                    <span className="hud-corners" aria-hidden />
                    <div className="text-xs font-semibold tracking-widest text-primary">
                      {c.tag}
                    </div>
                    <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
                      {c.desc}
                    </div>
                  </div>
                ))}
              </div>

              {/* Launch App */}
              <button
                type="button"
                onClick={launch}
                className="sheen group mt-9 inline-flex items-center gap-2 rounded-full gradient-signal px-8 py-3.5 font-semibold uppercase tracking-widest transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110"
              >
                Launch App
                <span
                  aria-hidden
                  className="transition-transform group-hover:translate-x-0.5"
                >
                  ▸
                </span>
              </button>
              <div className="hud-label mt-3 text-muted-foreground">
                no setup · runs in the cloud
              </div>
              <div className="hud-label mt-10 animate-pulse text-muted-foreground/60">
                ▾ scroll
              </div>
            </div>
          </section>

          <LandingSections onLaunch={launch} />

          <Footer />
        </div>
      </div>
    </div>
  );
};

// Authenticated content that shows chat (UUID generated internally)
const AuthenticatedContent = () => {
  return <Chat autoResume={false} />;
};

// Main page component with Convex authentication
export default function Page() {
  return (
    <>
      <Authenticated>
        <AuthenticatedContent />
      </Authenticated>
      <Unauthenticated>
        <UnauthenticatedContent />
      </Unauthenticated>
    </>
  );
}
