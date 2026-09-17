"use client";

import Link from "next/link";
import {
  ArrowRight,
  Shield,
  Terminal,
  Radio,
  Keyboard,
  Layers,
  GitBranch,
  Search,
  Sparkles,
} from "lucide-react";
import { RiftPixelMark } from "@/components/icons/rift-pixel-mark";
import { RiftWordmark } from "@/components/icons/rift-wordmark";
import { CapabilityFlow } from "../landing/CapabilityFlow";
import { Reveal } from "../landing/Reveal";
import { navigateToAuth } from "@/app/hooks/useTauri";

const FEATURES = [
  {
    icon: Terminal,
    title: "Unified workspace",
    body: "Chat, terminal, files and browser in one resizable shell — no tab hopping.",
  },
  {
    icon: Shield,
    title: "Security-native",
    body: "Recon, vuln scans, and exploit workflows built into the agent loop.",
  },
  {
    icon: Radio,
    title: "Stream everything",
    body: "Live tool output, queued messages, and branchable sessions.",
  },
  {
    icon: Search,
    title: "Command palette",
    body: "⌘K to jump anywhere — chats, settings, terminal, plugins.",
  },
  {
    icon: Layers,
    title: "Glass UI",
    body: "Dark, focused interface tuned for long sessions and deep work.",
  },
  {
    icon: GitBranch,
    title: "Branch & share",
    body: "Fork conversations, share read-only links, pick up where you left off.",
  },
] as const;

const SHORTCUTS = [
  ["⌘K", "Command palette"],
  ["⌘N", "New chat"],
  ["⌘B", "Toggle sidebar"],
  ["⌘J", "Toggle terminal"],
  ["⌘,", "Settings"],
  ["@", "Context menu"],
  ["/", "Slash commands"],
] as const;

const STEPS = [
  {
    n: "01",
    title: "Open the lab",
    body: "Sign in and land in the Pro shell at /lab/app — same backend, new chrome.",
  },
  {
    n: "02",
    title: "Run an operation",
    body: "Use /recon or quick prompts. Agent streams into the terminal panel.",
  },
  {
    n: "03",
    title: "Iterate fast",
    body: "Queue follow-ups, resize panels, branch when you need a fresh angle.",
  },
] as const;

export function ProLandingPage() {
  return (
    <div className="pro-landing min-h-dvh bg-[#060608] text-foreground">
      <div
        className="pro-shell-bg pointer-events-none fixed inset-0 opacity-90"
        aria-hidden
      />
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <RiftPixelMark size={33} />
          <RiftWordmark height={14} />
          <span className="ml-2 hidden rounded-md border border-violet-500/25 bg-violet-500/10 px-2 py-0.5 text-ui-caption uppercase tracking-wider text-violet-300/90 sm:inline">
            Pro Lab
          </span>
        </div>
        <nav className="flex items-center gap-3 text-ui">
          <Link
            href="/lab"
            className="hidden text-muted-foreground transition-colors hover:text-foreground sm:inline"
          >
            Dev hub
          </Link>
          <Link
            href="/lab/app"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Open app
          </Link>
          <button
            type="button"
            onClick={() => navigateToAuth("/login?redirect=%2Flab%2Fapp")}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 transition-colors hover:bg-white/[0.08]"
          >
            Sign in
          </button>
        </nav>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-6 pb-24 pt-6">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal>
            <p className="mb-4 text-ui-caption uppercase tracking-[0.24em] text-muted-foreground">
              Cursor-grade shell · localhost preview
            </p>
            <h1 className="mb-5 text-4xl font-medium leading-[1.06] tracking-tight md:text-[3.25rem]">
              The security agent workspace you actually want to use.
            </h1>
            <p className="mb-8 max-w-lg text-ui-section leading-relaxed text-muted-foreground">
              RIFT Pro Lab — command palette, resizable terminal, @ context and
              / slash commands. Production backend, experimental UI. Not
              deployed until you approve it.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/lab/app"
                className="inline-flex items-center gap-2 rounded-xl bg-foreground px-5 py-2.5 text-ui font-medium text-background transition-opacity hover:opacity-90"
              >
                Launch lab app
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/lab/landing#features"
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-5 py-2.5 text-ui text-muted-foreground transition-colors hover:border-white/20 hover:text-foreground"
              >
                See features
              </Link>
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="pro-workspace overflow-hidden rounded-2xl p-1 shadow-2xl ring-1 ring-white/[0.06]">
              <CapabilityFlow variant="hero" />
            </div>
          </Reveal>
        </div>

        <section id="features" className="mt-28">
          <h2 className="mb-3 text-center text-2xl font-medium tracking-tight">
            Built like an IDE
          </h2>
          <p className="mx-auto mb-12 max-w-xl text-center text-ui text-muted-foreground">
            Every surface — landing to composer — tuned for flow state.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }, i) => (
              <Reveal key={title} delay={i * 0.05}>
                <article className="pro-feature-card h-full rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 backdrop-blur-sm">
                  <Icon className="mb-4 size-5 text-foreground/75" />
                  <h3 className="mb-2 text-ui-section font-medium">{title}</h3>
                  <p className="text-ui leading-relaxed text-muted-foreground">
                    {body}
                  </p>
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="mt-28 grid gap-10 lg:grid-cols-2">
          <Reveal>
            <div className="flex items-center gap-2 text-ui-caption uppercase tracking-[0.2em] text-muted-foreground">
              <Keyboard className="size-4" /> Keyboard-first
            </div>
            <h2 className="mt-3 mb-6 text-2xl font-medium">
              Shortcuts that stay out of your way
            </h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {SHORTCUTS.map(([key, desc]) => (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-ui"
                >
                  <span className="text-muted-foreground">{desc}</span>
                  <kbd className="rounded border border-white/10 bg-black/30 px-2 py-0.5 font-mono text-ui-caption text-foreground/80">
                    {key}
                  </kbd>
                </div>
              ))}
            </div>
          </Reveal>
          <Reveal delay={0.08}>
            <div className="flex items-center gap-2 text-ui-caption uppercase tracking-[0.2em] text-muted-foreground">
              <Sparkles className="size-4" /> Workflow
            </div>
            <h2 className="mt-3 mb-6 text-2xl font-medium">
              Three steps to first finding
            </h2>
            <ol className="space-y-4">
              {STEPS.map(({ n, title, body }) => (
                <li
                  key={n}
                  className="flex gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
                >
                  <span className="font-mono text-ui-label text-violet-300/80">
                    {n}
                  </span>
                  <div>
                    <h3 className="text-ui font-medium">{title}</h3>
                    <p className="mt-1 text-ui text-muted-foreground">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Reveal>
        </section>

        <section className="pro-cta mt-28 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-8 py-12 text-center backdrop-blur-md">
          <h2 className="text-2xl font-medium tracking-tight">
            Ready to try Pro Lab?
          </h2>
          <p className="mx-auto mt-3 max-w-md text-ui text-muted-foreground">
            Localhost only. Sign in once — you&apos;ll return to the lab app
            automatically.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/lab/app"
              className="inline-flex items-center gap-2 rounded-xl bg-foreground px-6 py-3 text-ui font-medium text-background"
            >
              Open lab app <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/"
              className="text-ui text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Compare with production UI
            </Link>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/[0.06] py-8 text-center text-ui-label text-muted-foreground">
        RIFT Pro Lab · dev preview · not deployed to riftsys.app
      </footer>
    </div>
  );
}
