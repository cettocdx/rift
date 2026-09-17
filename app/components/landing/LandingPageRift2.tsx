"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, Lock, Radar, FileText, Terminal } from "lucide-react";
import { RiftPixelMark } from "@/components/icons/rift-pixel-mark";
import { RiftWordmark } from "@/components/icons/rift-wordmark";
import { LandingHeaderRift2, Rift2OutlineButton } from "./LandingHeaderRift2";
import { AttackSurfaceCanvas } from "./AttackSurfaceCanvas";
import { ReconFlowAscii } from "./ReconFlowAscii";
import { RiftHeroCanvas } from "./RiftHeroCanvas";
import { CapabilityFlow } from "./CapabilityFlow";
import { HeroDemoStage } from "./HeroDemoStage";
import { StatsBar } from "./StatsBar";
import { ReconProgressDemo } from "./ReconProgressDemo";
import { Reveal } from "./Reveal";
import { LandingVariantSwitcher } from "./LandingVariantSwitcher";
import { navigateToAuth } from "@/app/hooks/useTauri";

const ARSENAL = [
  {
    name: "subfinder",
    date: "Recon",
    title: "Passive subdomain discovery across 30+ sources.",
  },
  {
    name: "nuclei",
    date: "Exploit",
    title: "Templated CVE & misconfiguration scanning at scale.",
  },
  {
    name: "httpx",
    date: "Recon",
    title: "Fast HTTP probing — titles, status, tech fingerprint.",
  },
  {
    name: "nmap",
    date: "Scan",
    title: "Service & version detection with scriptable NSE checks.",
  },
  {
    name: "ffuf",
    date: "Fuzz",
    title: "Directory, content and parameter fuzzing.",
  },
  {
    name: "sqlmap",
    date: "Exploit",
    title: "Automated SQL-injection detection & exploitation.",
  },
] as const;

const MEDIA = [
  {
    title: "Introducing autonomous recon",
    date: "Launch · 2026",
    href: "#recon",
  },
  {
    title: "Inside the RIFT sandbox",
    date: "Engineering · 2026",
    href: "#security",
  },
  {
    title: "From scope to structured report",
    date: "Product · 2026",
    href: "#agent",
  },
  {
    title: "40+ offensive tools, one agent",
    date: "Arsenal · 2026",
    href: "#arsenal",
  },
] as const;

const WHY_ITEMS = [
  "Why autonomous pentesting",
  "Why real tooling",
  "Why isolated sandboxes",
  "Why agent-driven recon",
  "Why structured reports",
  "Why scope-first ops",
] as const;

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

export function LandingPageRift2() {
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
    <div className="landing-rift2-bg min-h-full text-foreground">
      <LandingHeaderRift2 />

      {/* Hero — split like Rift 1, Extropic typography */}
      <section className="relative overflow-hidden border-b border-border/30">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-x-0 top-0 h-[640px] opacity-[0.28]">
            <RiftHeroCanvas />
          </div>
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_80%_20%,rgba(217, 119, 87,0.1),transparent_55%)]" />
          <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/70 to-background" />
        </div>

        <div className="relative z-10 mx-auto max-w-7xl px-4 pb-16 pt-[4.5rem] sm:px-8 sm:pb-20 sm:pt-24">
          <div className="grid items-center gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:gap-14 xl:gap-16">
            <div className="text-center lg:text-left">
              <p className="rift2-display text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                Computing
              </p>
              <h1 className="rift2-display mt-4 text-[clamp(2.25rem,6vw,4.25rem)] font-medium leading-[0.92] tracking-[-0.04em]">
                AUTONOMOUS
                <br />
                <span className="rift2-serif text-[0.94em] font-normal italic text-foreground/90">
                  Offensive Intelligence
                </span>
              </h1>
              <p className="mx-auto mt-5 max-w-md text-[15px] leading-relaxed text-muted-foreground sm:text-[16px] lg:mx-0">
                RIFT runs real pentest tooling in isolated cloud sandboxes —
                radically faster than manual recon and reporting workflows.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
                <button
                  type="button"
                  onClick={launch}
                  className="inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-2.5 text-[13px] font-medium text-background transition-opacity hover:opacity-90"
                >
                  Start for free <ArrowRight className="size-4" />
                </button>
                <Rift2OutlineButton onClick={() => scrollTo("recon")}>
                  See attack surface
                </Rift2OutlineButton>
              </div>
              <StatsBar className="mt-10 border-t border-border/30 pt-8" />
            </div>

            <Reveal>
              <HeroDemoStage compact>
                <CapabilityFlow variant="embedded" />
              </HeroDemoStage>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Manifesto — full-bleed Extropic statement */}
      <section className="relative flex min-h-[70vh] items-center border-b border-border/30 py-24 sm:py-32">
        <div className="pointer-events-none absolute inset-0 opacity-[0.12]">
          <AttackSurfaceCanvas />
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-background via-background/92 to-background" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-8">
          <Reveal>
            <p className="rift2-display max-w-5xl text-[clamp(2.25rem,6vw,4.5rem)] font-medium leading-[1.02] tracking-[-0.035em]">
              Autonomous software, meet{" "}
              <span className="rift2-serif italic text-muted-foreground">
                real offensive tooling.
              </span>
            </p>
            <p className="mt-10 max-w-2xl text-[16px] leading-relaxed text-muted-foreground sm:text-[17px]">
              RIFT agents are inherently action-oriented — the perfect fit for
              recon, exploitation, and reporting workloads that demand real
              execution, not chat-only answers.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Product block — XTR-0 style */}
      <section
        id="agent"
        className="scroll-mt-20 border-b border-border/30 py-20 sm:py-28"
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-8">
          <div className="grid gap-16 lg:grid-cols-2 lg:items-end lg:gap-20">
            <Reveal>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Software
              </p>
              <h2 className="rift2-display mt-4 text-[clamp(3rem,8vw,5.5rem)] font-medium leading-[0.9] tracking-[-0.04em]">
                RIFT
                <br />
                Session
              </h2>
              <p className="mt-6 max-w-md text-[15px] leading-relaxed text-muted-foreground">
                Scope a target in natural language. Watch the agent plan, run
                tools, adapt, and deliver structured findings — all inside an
                isolated cloud sandbox.
              </p>
              <div className="mt-8">
                <Rift2OutlineButton onClick={() => scrollTo("recon")}>
                  Inside the session
                </Rift2OutlineButton>
              </div>
            </Reveal>
            <Reveal delay={60}>
              <ReconProgressDemo />
            </Reveal>
          </div>
        </div>
      </section>

      {/* Recon — architecture ASCII + attack surface */}
      <section
        id="recon"
        className="scroll-mt-20 border-b border-border/30 py-20 sm:py-28"
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-8">
          <Reveal>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Recon
            </p>
            <h2 className="rift2-display mt-3 max-w-3xl text-[clamp(2.5rem,7vw,4.5rem)] font-medium leading-[0.95] tracking-[-0.035em]">
              Attack surface,
              <br />
              <span className="rift2-serif italic text-foreground/85">
                mapped live
              </span>
            </h2>
            <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
              From your prompt to OpenRouter, through an isolated Kali sandbox,
              back to a live stream — every hop in the RIFT pipeline,
              visualized.
            </p>
          </Reveal>

          <Reveal className="mt-12">
            <ReconFlowAscii />
          </Reveal>

          <Reveal className="mt-10 overflow-hidden rounded-2xl border border-border/50 shadow-[0_40px_100px_-40px_rgba(0,0,0,0.75)]">
            <AttackSurfaceCanvas />
          </Reveal>
        </div>
      </section>

      {/* THRML-style intro block */}
      <section className="border-b border-border/30 py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-8">
          <Reveal>
            <div className="flex flex-col gap-6 border-t border-border/40 pt-12 lg:flex-row lg:items-start lg:justify-between lg:gap-16">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Platform
                </p>
                <h2 className="rift2-display mt-3 text-[clamp(2rem,5vw,3.25rem)] font-medium tracking-[-0.03em]">
                  Introducing /agent
                </h2>
              </div>
              <p className="max-w-xl text-[15px] leading-relaxed text-muted-foreground lg:pt-8">
                Natural-language scope, real tool execution, and structured
                output — built for security teams who need speed without
                sacrificing auditability.
              </p>
            </div>
            <div className="mt-12 overflow-hidden rounded-xl border border-border/50 bg-surface-1/50">
              <div className="flex items-center gap-2 border-b border-border/40 px-4 py-3 font-mono text-[12px] text-muted-foreground">
                <Terminal className="size-3.5 text-signal" />
                rift session — acme.com
              </div>
              <div className="grid gap-px bg-border/30 sm:grid-cols-3">
                {[
                  { k: "Scope", v: "acme.com + *.acme.com" },
                  { k: "Tools", v: "subfinder · httpx · nuclei" },
                  { k: "Sandbox", v: "isolated · ephemeral" },
                ].map(({ k, v }) => (
                  <div key={k} className="bg-background/80 px-5 py-4">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {k}
                    </p>
                    <p className="mt-1 font-mono text-[13px] text-foreground">
                      {v}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Marquee */}
      <section className="relative overflow-hidden border-b border-border/30 py-24 sm:py-28">
        <div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
          <div className="flex w-max animate-marquee gap-12 motion-reduce:animate-none motion-reduce:flex-wrap motion-reduce:justify-center motion-reduce:w-full">
            {[...WHY_ITEMS, ...WHY_ITEMS].map((item, i) => (
              <span
                key={`${item}-${i}`}
                className="rift2-display shrink-0 text-[clamp(2rem,4vw,3.5rem)] font-medium tracking-[-0.025em] text-foreground/20"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Arsenal grid */}
      <section
        id="arsenal"
        className="scroll-mt-20 border-b border-border/30 py-20 sm:py-28"
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-8">
          <Reveal>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Arsenal
            </p>
            <h2 className="rift2-display mt-3 text-[clamp(2rem,5vw,3.75rem)] font-medium tracking-[-0.03em]">
              Real tools. Not toy prompts.
            </h2>
          </Reveal>
          <div className="mt-14 grid gap-px bg-border/40 sm:grid-cols-2 lg:grid-cols-3">
            {ARSENAL.map((item, i) => (
              <Reveal key={item.name} delay={i * 40}>
                <article className="group h-full bg-background/90 p-7 transition-colors hover:bg-surface-1/60 sm:p-9">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                    {item.date}
                  </p>
                  <h3 className="rift2-display mt-4 text-2xl font-medium tracking-tight">
                    {item.name}
                  </h3>
                  <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
                    {item.title}
                  </p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Media / Writing — Extropic editorial */}
      <section className="border-b border-border/30 py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-8">
          <Reveal>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Writing
            </p>
            <h2 className="rift2-display mt-3 text-[clamp(2rem,5vw,3.25rem)] font-medium tracking-[-0.03em]">
              From the lab
            </h2>
          </Reveal>
          <div className="mt-12 divide-y divide-border/40 border-t border-border/40">
            {MEDIA.map((item, i) => (
              <Reveal key={item.title} delay={i * 50}>
                <button
                  type="button"
                  onClick={() => scrollTo(item.href.slice(1))}
                  className="group flex w-full flex-col gap-2 py-6 text-left transition-colors hover:text-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-8"
                >
                  <span className="rift2-display text-lg font-medium tracking-tight sm:text-xl">
                    {item.title}
                  </span>
                  <span className="shrink-0 text-[13px] text-muted-foreground group-hover:text-muted-foreground/80">
                    {item.date}
                  </span>
                </button>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Security */}
      <section
        id="security"
        className="scroll-mt-20 border-b border-border/30 py-20 sm:py-28"
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-8">
          <Reveal>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Security
            </p>
            <h2 className="rift2-display mt-3 max-w-2xl text-[clamp(2rem,5vw,3.5rem)] font-medium tracking-[-0.03em]">
              Isolated by design
            </h2>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
              Every operation runs in a disposable cloud sandbox. Nothing
              touches your machine.
            </p>
          </Reveal>
          <div className="mt-14 grid gap-8 sm:grid-cols-3">
            {[
              { icon: Lock, title: "Sandboxed", desc: "Per-run container." },
              {
                icon: Radar,
                title: "Scoped",
                desc: "Authorized targets only.",
              },
              {
                icon: FileText,
                title: "Auditable",
                desc: "Every command logged.",
              },
            ].map(({ icon: Icon, title, desc }, i) => (
              <Reveal key={title} delay={i * 50}>
                <div className="border-t border-border/50 pt-8">
                  <Icon className="mb-5 size-4 text-muted-foreground" />
                  <h3 className="text-[16px] font-medium">{title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
                    {desc}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing + hire CTA — Extropic footer block */}
      <section id="pricing" className="scroll-mt-20 py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-8">
          <Reveal>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Pricing
            </p>
            <h2 className="rift2-display mt-3 text-[clamp(2.5rem,6vw,4rem)] font-medium tracking-[-0.035em]">
              Free during beta
            </h2>
            <p className="mt-5 max-w-lg text-[16px] leading-relaxed text-muted-foreground">
              Full access. No credit card. Cloud sandbox included.
            </p>
            <button
              type="button"
              onClick={launch}
              className="mt-10 inline-flex items-center gap-2 rounded-full bg-foreground px-7 py-3 text-[14px] font-medium text-background transition-opacity hover:opacity-90"
            >
              Get started <ArrowRight className="size-4" />
            </button>
            <p className="rift2-display mt-16 max-w-2xl text-[clamp(1.25rem,3vw,1.75rem)] font-medium leading-snug tracking-[-0.02em] text-muted-foreground">
              We are building the agent layer for offensive security — scope
              first, execute fast, report clean.
            </p>
          </Reveal>
        </div>
      </section>

      <footer className="border-t border-border/30 py-10 pb-24">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-4 px-4 sm:flex-row sm:items-center sm:px-8">
          <div className="flex items-center gap-2">
            <RiftPixelMark size={21} />
            <RiftWordmark height={17} />
          </div>
          <p className="text-[12px] text-muted-foreground">
            <Link href="/terms-of-service" className="hover:text-foreground">
              Terms
            </Link>
            {" · "}
            <Link href="/privacy-policy" className="hover:text-foreground">
              Privacy
            </Link>
          </p>
        </div>
      </footer>

      <LandingVariantSwitcher active="rift2" />
    </div>
  );
}
