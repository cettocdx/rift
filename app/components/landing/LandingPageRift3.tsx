"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { RiftWordmark } from "@/components/icons/rift-wordmark";
import { CapabilityFlow } from "./CapabilityFlow";
import { CopyCodeBlock } from "./CopyCodeBlock";
import { ReconProgressDemo } from "./ReconProgressDemo";
import { LandingVariantSwitcher } from "./LandingVariantSwitcher";
import { navigateToAuth } from "@/app/hooks/useTauri";

const SCOPE_PROMPT = `Recon acme.com — live subdomains and obvious web vulns. Keep it fast.`;

const AGENT_COMMANDS = `/agent status     # see the live progress panel
/agent pause      # stop work, keep the scope
/agent resume     # pick back up
/agent clear      # drop the operation entirely`;

export function LandingPageRift3() {
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
    <div className="landing-rift3 min-h-full bg-background pb-24 text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/40 bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-12 max-w-[680px] items-center justify-between px-4">
          <Link href="/" className="rounded-md focus-visible:outline-none">
            <RiftWordmark height={20} className="text-foreground" />
          </Link>
          <button
            type="button"
            onClick={launch}
            className="rounded-full bg-foreground px-3.5 py-1.5 text-[12px] font-medium text-background transition-opacity hover:opacity-90"
          >
            Get started
          </button>
        </div>
      </header>

      <article className="mx-auto max-w-[680px] px-4 py-12 sm:py-16">
        <Link
          href="/"
          className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Back to home
        </Link>

        <time
          dateTime="2026-06-22"
          className="mt-6 block text-[13px] text-muted-foreground"
        >
          Jun 22, 2026
        </time>

        <h1 className="mt-4 text-[clamp(2rem,5vw,2.75rem)] font-semibold leading-[1.1] tracking-[-0.03em]">
          Introducing <span className="font-mono text-signal">/recon</span>
        </h1>

        <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">
          Use Agent mode for long-running autonomous pentest execution in RIFT.
        </p>

        <hr className="my-10 border-border/60" />

        <div className="space-y-5 text-[15px] leading-[1.75] text-foreground/90">
          <p>
            Today we&apos;re introducing{" "}
            <span className="font-mono text-[14px] text-signal">/recon</span> in
            RIFT Agent mode. This new mode yields long-running, autonomous
            execution — helping you hand off full recon and vulnerability
            assessment to the agent.
          </p>
          <p className="text-muted-foreground">
            Available now in RIFT. Sign up for free and start your first
            operation inside an isolated cloud sandbox.
          </p>
        </div>

        <div className="my-12 overflow-hidden rounded-xl border border-border sm:-mx-8">
          <CapabilityFlow />
        </div>

        <p className="text-[15px] leading-[1.75] text-foreground/90">
          Most pentest workflows require back-and-forth tool chaining and manual
          verification. With{" "}
          <span className="font-mono text-[14px] text-signal">/recon</span>, the
          agent continues until the scope is covered and verified — whether that
          means running subfinder, probing with httpx, or executing nuclei
          templates.
        </p>

        <h2 className="mt-14 text-xl font-semibold tracking-tight">
          Scope a target in one line
        </h2>
        <p className="mt-3 text-[15px] leading-[1.75] text-muted-foreground">
          Give the agent an objective and RIFT takes it from there:
        </p>
        <div className="mt-5">
          <CopyCodeBlock code={SCOPE_PROMPT} />
        </div>
        <p className="mt-5 text-[15px] leading-[1.75] text-foreground/90">
          It plans an approach, breaks the work into a progress checklist, and
          starts executing. You can keep sharing additional instructions with
          the agent as it works.
        </p>

        <h2 className="mt-14 text-xl font-semibold tracking-tight">
          Monitor and steer
        </h2>
        <p className="mt-3 text-[15px] leading-[1.75] text-muted-foreground">
          Agent mode offers ways to monitor and steer long-running operations:
        </p>
        <div className="mt-5">
          <CopyCodeBlock code={AGENT_COMMANDS} />
        </div>

        <div className="mt-8">
          <ReconProgressDemo />
        </div>

        <p className="mt-6 text-[15px] leading-[1.75] text-foreground/90">
          When the operation is finished, the panel flips to{" "}
          <strong className="font-medium text-foreground">Complete</strong> with
          every checklist item checked — and a structured report ready to
          export.
        </p>

        <h2 className="mt-14 text-xl font-semibold tracking-tight">
          Getting started
        </h2>
        <p className="mt-3 text-[15px] leading-[1.75] text-muted-foreground">
          Create a free account, open a session, switch to Agent mode, and hand
          off your first recon operation.
        </p>
        <button
          type="button"
          onClick={launch}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-[13px] font-medium text-background transition-opacity hover:opacity-90"
        >
          Start for free <ArrowRight className="size-4" />
        </button>
        <p className="mt-4 text-[13px] text-muted-foreground">
          No credit card · Cloud sandbox included · Beta access
        </p>
      </article>

      <LandingVariantSwitcher active="rift3" />
    </div>
  );
}
