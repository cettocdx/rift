"use client";

import React from "react";
import Link from "next/link";
import {
  ArrowRight,
  ChevronRight,
  Terminal,
  FileText,
  Radar,
  Bug,
  Lock,
  MessageCircle,
} from "lucide-react";
import { RiftLogo } from "@/components/icons/rift-logo";
import { RiftPixelMark } from "@/components/icons/rift-pixel-mark";
import { RiftWordmark } from "@/components/icons/rift-wordmark";
import { LandingHeader } from "./LandingHeader";
import { RiftHeroCanvas } from "./RiftHeroCanvas";
import { AttackSurfaceCanvas } from "./AttackSurfaceCanvas";
import { CapabilityFlow } from "./CapabilityFlow";
import { StatsBar } from "./StatsBar";
import { TrustedByStrip } from "./TrustedByStrip";
import { SectionHeading } from "./SectionHeading";
import { Reveal } from "./Reveal";
import { LandingVariantSwitcher } from "./LandingVariantSwitcher";
import { navigateToAuth } from "@/app/hooks/useTauri";

const ARSENAL: { name: string; cat: string; desc: string }[] = [
  {
    name: "subfinder",
    cat: "Recon",
    desc: "Passive subdomain discovery across 30+ sources.",
  },
  {
    name: "httpx",
    cat: "Recon",
    desc: "Fast HTTP probing — titles, status, tech fingerprint.",
  },
  {
    name: "katana",
    cat: "Recon",
    desc: "Headless crawling that maps every reachable endpoint.",
  },
  {
    name: "naabu",
    cat: "Scan",
    desc: "High-speed SYN / CONNECT port discovery.",
  },
  {
    name: "nmap",
    cat: "Scan",
    desc: "Service & version detection with scriptable NSE checks.",
  },
  {
    name: "nuclei",
    cat: "Exploit",
    desc: "Templated CVE & misconfiguration scanning at scale.",
  },
  {
    name: "ffuf",
    cat: "Fuzz",
    desc: "Directory, content and parameter fuzzing.",
  },
  {
    name: "sqlmap",
    cat: "Exploit",
    desc: "Automated SQL-injection detection & exploitation.",
  },
  {
    name: "hydra",
    cat: "Access",
    desc: "Credential brute-forcing across many protocols.",
  },
];

const CAT_CLASS: Record<string, string> = {
  Recon: "text-info border-info/30",
  Scan: "text-signal border-signal/30",
  Exploit: "text-destructive border-destructive/30",
  Fuzz: "text-warning border-warning/30",
  Access: "text-success border-success/30",
};

const FEATURES = [
  {
    icon: Radar,
    title: "Recon",
    desc: "Subdomains, live hosts, port scan, tech fingerprint — mapped in minutes.",
  },
  {
    icon: Bug,
    title: "Exploit",
    desc: "Targeted nuclei templates, fuzzing, and chained attacks on scoped hosts.",
  },
  {
    icon: FileText,
    title: "Report",
    desc: "Findings with severity, proof, and remediation — ready for your client.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Describe the target",
    desc: "Paste a domain, IP range, or describe what you need. RIFT scopes the operation.",
  },
  {
    n: "02",
    title: "Agent runs the tools",
    desc: "Real pentest tooling executes in an isolated cloud sandbox — you watch live.",
  },
  {
    n: "03",
    title: "Review the report",
    desc: "Structured output with evidence, CVSS context, and fix recommendations.",
  },
];

export function LandingPageRift1() {
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
    <div className="landing-grid-bg min-h-full bg-background text-foreground">
      <LandingHeader />

      <section className="relative overflow-hidden border-b border-border/40">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-x-0 top-0 h-[720px] opacity-45">
            <RiftHeroCanvas />
          </div>
          <div
            className="absolute inset-0 bg-[radial-gradient(ellipse_80%_55%_at_50%_-10%,rgba(217, 119, 87,0.08),transparent_60%)]"
            aria-hidden
          />
        </div>

        <div className="relative z-10 mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pb-20 sm:pt-20">
          <div className="grid items-center gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:gap-14">
            <div className="text-center lg:text-left">
              <h1 className="text-balance text-[2.35rem] font-semibold leading-[1.06] tracking-[-0.035em] sm:text-5xl lg:text-[3.5rem]">
                The agent that breaks in
                <span className="text-muted-foreground">
                  {" "}
                  so you don&apos;t have to
                </span>
              </h1>

              <p className="mx-auto mt-5 max-w-lg text-pretty text-[15px] leading-relaxed text-muted-foreground sm:text-[16px] lg:mx-0">
                Point RIFT at a target. It runs recon, hunts vulnerabilities,
                and writes the report — autonomously, inside an isolated cloud
                sandbox.
              </p>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
                <button
                  type="button"
                  onClick={launch}
                  className="inline-flex items-center gap-2 rounded-lg bg-foreground px-5 py-2.5 text-[14px] font-medium text-background shadow-lg transition-opacity hover:opacity-90"
                >
                  Start for free <ArrowRight className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    document
                      .getElementById("recon")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-2/70 px-5 py-2.5 text-[14px] font-medium text-foreground backdrop-blur-sm transition-colors hover:bg-surface-3"
                >
                  See it work
                </button>
              </div>

              <p className="mt-4 text-[13px] text-muted-foreground/75">
                No credit card · Cloud sandbox included · Beta access
              </p>

              <StatsBar className="mt-10 border-t border-border/50 pt-8" />
            </div>

            <Reveal>
              <CapabilityFlow />
            </Reveal>
          </div>
        </div>
      </section>

      <TrustedByStrip />

      <section
        id="recon"
        className="scroll-mt-16 border-b border-border/40 py-20 sm:py-24"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal>
            <SectionHeading
              label="Live recon"
              title="Watch the attack surface light up"
              description="RIFT maps every host, fingerprints the stack, and flags what's exploitable — streaming each finding as it goes."
            />
          </Reveal>
          <div className="mt-10">
            <AttackSurfaceCanvas />
          </div>
        </div>
      </section>

      <section
        id="arsenal"
        className="scroll-mt-16 border-b border-border/40 py-20 sm:py-24"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal>
            <SectionHeading
              label="The arsenal"
              title="Real tools. Not toy prompts."
              description="RIFT drives the same battle-tested offensive tooling a human operator would — chaining them autonomously inside the sandbox."
            />
          </Reveal>

          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ARSENAL.map((tool, i) => (
              <Reveal key={tool.name} delay={i * 50}>
                <div className="group h-full rounded-xl border border-border/60 bg-card/40 p-4 transition-colors hover:border-border hover:bg-card/70">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[14px] font-medium text-foreground">
                      {tool.name}
                    </span>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        CAT_CLASS[tool.cat] ??
                        "text-muted-foreground border-border"
                      }`}
                    >
                      {tool.cat}
                    </span>
                  </div>
                  <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                    {tool.desc}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>

          <p className="mt-6 text-[13px] text-muted-foreground/75">
            + dozens more — RIFT picks the right tool for each phase, no setup
            required.
          </p>
        </div>
      </section>

      <section
        id="features"
        className="scroll-mt-16 border-b border-border/40 py-20 sm:py-24"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal>
            <SectionHeading
              title="Full offensive pipeline"
              description="From footprint to final report — one conversation, one sandbox, zero local setup."
            />
          </Reveal>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, desc }, i) => (
              <Reveal key={title} delay={i * 70}>
                <div className="h-full rounded-xl border border-border/60 bg-card/40 p-5 transition-colors hover:border-border hover:bg-card/70">
                  <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-accent text-muted-foreground">
                    <Icon className="size-4" />
                  </div>
                  <h3 className="text-[15px] font-semibold text-foreground">
                    {title}
                  </h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                    {desc}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section
        id="how"
        className="scroll-mt-16 border-b border-border/40 py-20 sm:py-24"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid items-start gap-12 lg:grid-cols-2 lg:gap-16">
            <Reveal>
              <SectionHeading
                title="How it works"
                description="Three steps. You scope it — RIFT executes."
              />
              <ol className="mt-8 space-y-6">
                {STEPS.map(({ n, title, desc }) => (
                  <li key={n} className="flex gap-4">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-[11px] font-medium text-muted-foreground">
                      {n}
                    </span>
                    <div>
                      <h3 className="text-[15px] font-medium text-foreground">
                        {title}
                      </h3>
                      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                        {desc}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </Reveal>

            <Reveal delay={80}>
              <div className="overflow-hidden rounded-xl border border-border bg-surface-2 shadow-lg">
                <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
                  <RiftLogo size={37} />
                  <div className="text-left leading-tight">
                    <RiftWordmark height={14} className="text-foreground" />
                    <div className="text-[10px] text-muted-foreground">
                      ~/session · Agent
                    </div>
                  </div>
                  <span className="ml-auto text-[10px] text-signal">
                    sandbox ready
                  </span>
                </div>
                <div className="space-y-4 p-4 text-left text-[13px]">
                  <p className="text-foreground/90">
                    Do recon on{" "}
                    <code className="rounded bg-background/60 px-1.5 py-0.5 font-mono text-[12px] text-signal">
                      acme.com
                    </code>{" "}
                    — subdomains and web vulns, keep it fast.
                  </p>
                  <div className="rounded-lg border border-border/60 bg-background/40">
                    <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2 text-[11px] text-muted-foreground">
                      <Terminal className="size-3.5" />
                      <span className="truncate font-mono">
                        Ran terminal command
                      </span>
                      <span className="ml-auto text-success">Done</span>
                    </div>
                    <pre className="overflow-x-auto p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                      <span className="text-signal">https://api.acme.com</span>{" "}
                      [200] nginx, Express{"\n"}
                      <span className="text-warning">
                        https://staging.acme.com
                      </span>{" "}
                      [401] Restricted{"\n"}
                      <span className="text-muted-foreground/60">
                        4 live hosts · 1.8s
                      </span>
                    </pre>
                  </div>
                  <p className="text-muted-foreground">
                    Found outdated OpenVPN on{" "}
                    <code className="rounded bg-background/60 px-1 font-mono text-[12px]">
                      vpn.acme.com
                    </code>
                    . Running nuclei…
                  </p>
                </div>
              </div>
            </Reveal>
          </div>

          <div className="mt-16 grid gap-4 sm:grid-cols-2">
            <Reveal>
              <div className="h-full rounded-xl border border-border/60 bg-card/30 p-5">
                <div className="mb-2 flex items-center gap-2">
                  <MessageCircle className="size-4 text-muted-foreground" />
                  <span className="text-[13px] font-semibold">Ask mode</span>
                </div>
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  Security Q&amp;A — CVE breakdowns, payload ideas, methodology.
                  No execution.
                </p>
              </div>
            </Reveal>
            <Reveal delay={60}>
              <div className="h-full rounded-xl border border-signal/20 bg-signal-soft p-5">
                <div className="mb-2 flex items-center gap-2">
                  <span className="size-2 rounded-full bg-signal" />
                  <span className="text-[13px] font-semibold">Agent mode</span>
                </div>
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  Full autonomous operation — RIFT plans, runs tools, adapts,
                  and delivers a report.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <section
        id="security"
        className="scroll-mt-16 border-b border-border/40 py-20 sm:py-24"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal>
            <SectionHeading
              label="Security"
              title="Isolated by design"
              description="Every operation runs in a disposable cloud sandbox. Nothing touches your machine."
            />
          </Reveal>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              {
                icon: Lock,
                title: "Sandboxed",
                desc: "Per-run container. No persistence.",
              },
              {
                icon: Radar,
                title: "Scoped",
                desc: "Only targets you authorize.",
              },
              {
                icon: FileText,
                title: "Auditable",
                desc: "Every command logged for review.",
              },
            ].map(({ icon: Icon, title, desc }, i) => (
              <Reveal key={title} delay={i * 60}>
                <div className="h-full rounded-xl border border-border/60 bg-card/30 p-5">
                  <Icon className="mb-3 size-4 text-muted-foreground" />
                  <h3 className="text-[14px] font-medium">{title}</h3>
                  <p className="mt-1.5 text-[13px] text-muted-foreground">
                    {desc}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="scroll-mt-16 py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal>
            <SectionHeading
              label="Pricing"
              title="Simple pricing"
              description="Full access during beta. No credit card."
            />
          </Reveal>
          <div className="mt-10 grid gap-4 sm:max-w-2xl sm:grid-cols-2">
            <Reveal>
              <div className="h-full rounded-xl border border-border bg-card/50 p-6">
                <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
                  Beta
                </p>
                <p className="mt-2 text-4xl font-semibold tracking-tight">
                  Free
                </p>
                <ul className="mt-5 space-y-2 text-[13px] text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <ChevronRight className="size-3.5 shrink-0" />
                    Ask &amp; Agent modes
                  </li>
                  <li className="flex items-center gap-2">
                    <ChevronRight className="size-3.5 shrink-0" />
                    Cloud sandbox included
                  </li>
                  <li className="flex items-center gap-2">
                    <ChevronRight className="size-3.5 shrink-0" />
                    Full reporting export
                  </li>
                </ul>
                <button
                  type="button"
                  onClick={launch}
                  className="mt-6 w-full rounded-lg bg-foreground py-2.5 text-[13px] font-medium text-background hover:opacity-90"
                >
                  Get started
                </button>
              </div>
            </Reveal>
            <Reveal delay={60}>
              <div className="h-full rounded-xl border border-border/60 bg-card/20 p-6 opacity-80">
                <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
                  Team
                </p>
                <p className="mt-2 text-4xl font-semibold tracking-tight text-muted-foreground">
                  Soon
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="border-t border-border/40 py-20">
        <Reveal className="mx-auto flex max-w-6xl flex-col items-center px-4 text-center sm:px-6">
          <div className="mb-6 scale-125">
            <RiftLogo size={74} />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Ready to run your first op?
          </h2>
          <p className="mt-3 max-w-md text-[15px] text-muted-foreground">
            Launch RIFT, point it at a target, and let the agent work.
          </p>
          <button
            type="button"
            onClick={launch}
            className="mt-8 inline-flex items-center gap-2 rounded-lg bg-foreground px-6 py-3 text-[14px] font-medium text-background hover:opacity-90"
          >
            Start for free <ArrowRight className="size-4" />
          </button>
        </Reveal>
      </section>

      <footer className="border-t border-border/40 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-center text-[12px] text-muted-foreground sm:flex-row sm:px-6 sm:text-left">
          <div className="flex items-center gap-2">
            <RiftPixelMark size={21} />
            <RiftWordmark height={17} />
            <span className="text-muted-foreground">· Pentest AI</span>
          </div>
          <p>
            <Link
              href="/terms-of-service"
              className="underline hover:text-foreground"
            >
              Terms
            </Link>
            {" · "}
            <Link
              href="/privacy-policy"
              className="underline hover:text-foreground"
            >
              Privacy
            </Link>
          </p>
        </div>
      </footer>
      <LandingVariantSwitcher active="rift1" />
    </div>
  );
}
