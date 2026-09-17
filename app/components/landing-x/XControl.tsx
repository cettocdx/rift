"use client";

import { useEffect, useRef, useState } from "react";

import { INCLUDED_CREDITS_BY_TIER } from "@/lib/billing/included-credits";
import { POINTS_PER_DOLLAR } from "@/lib/billing/credit-units";

import { Reveal } from "./reveal";
import {
  X_CAPTION,
  X_CONTAINER,
  X_INTRO,
  X_LABEL,
  X_SECTION,
  X_SECTION_PAD,
} from "./x-system";

/**
 * The control band — gumloop's enterprise section, with our facts.
 *
 * Their arrangement is a wide usage card beside a stack of smaller ones, each
 * naming a governance capability with a small figure. It is the part of a
 * landing page that answers "what happens when this is not just me", and this
 * page had no answer at all.
 *
 * ── Every figure is derived, and the ones we do not have are absent ──
 *
 * The credit allowances come from `INCLUDED_CREDITS_BY_TIER` converted at
 * `POINTS_PER_DOLLAR`, the same two modules `lib/pricing/plans.ts` uses to
 * print the price — so the dollars here and the dollars in the pricing table
 * cannot drift. The hour is `trigger/agent-long.ts` (`maxDuration: 60 * 60`).
 * The vault is `lib/ai/mcp` credential storage. The isolation is E2B, one
 * sandbox per run.
 *
 * What is deliberately *not* here: SOC 2, SAML/SSO, SCIM, VPC deployment, audit
 * export, role management. gumloop's band leads with those and ours cannot,
 * because none of them exists in this repository. A landing page that claims a
 * compliance posture it does not have is the one class of error on this page
 * that becomes a legal problem rather than an embarrassing one — the same
 * reasoning `XTrust` already records. When they ship, they belong here.
 */

const dollars = (credits: number) =>
  Math.round(credits / POINTS_PER_DOLLAR).toLocaleString("en-US");

/** The two metered tiers, as the ledger defines them. */
const TIERS = [
  { name: "Pro", credits: INCLUDED_CREDITS_BY_TIER.pro },
  { name: "Max", credits: INCLUDED_CREDITS_BY_TIER.ultra },
] as const;

/** The spend curve — illustrative shape, real endpoint. */
const CURVE = [8, 14, 19, 27, 33, 41, 48, 52, 61, 68, 74, 79];

function SpendCard() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState(0);
  /**
   * Whether the draw has already played.
   *
   * A ref, not the state value: `drawn` changing every frame would re-run the
   * effect, cancel its own rAF and reset the start time — which is exactly why
   * the curve stalled on the first bar. The effect must mount once and own the
   * animation for its whole life.
   */
  const playedRef = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      const t = setTimeout(() => setDrawn(1), 0);
      return () => clearTimeout(t);
    }

    let raf = 0;
    let start = 0;
    const step = (now: number) => {
      if (!start) start = now;
      const p = Math.min(1, (now - start) / 1200);
      setDrawn(p);
      if (p < 1) raf = requestAnimationFrame(step);
      else raf = 0;
    };

    const play = () => {
      if (playedRef.current || raf) return;
      playedRef.current = true;
      raf = requestAnimationFrame(step);
    };

    if (typeof IntersectionObserver === "undefined") {
      play();
      return () => {
        if (raf) cancelAnimationFrame(raf);
      };
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) play();
      },
      { threshold: 0.3 },
    );
    io.observe(host);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, []);

  const shown = Math.max(1, Math.round(CURVE.length * drawn));

  return (
    <div
      ref={hostRef}
      className="flex h-full flex-col rounded-[16px] bg-[var(--x-raise)] p-6 md:p-8"
    >
      <p className={X_LABEL}>Metered, not capped</p>
      <div className="mt-5 flex flex-wrap items-baseline gap-x-6 gap-y-2">
        {TIERS.map((t) => (
          <span key={t.name} className="flex items-baseline gap-2">
            <span className="text-[22px] font-medium tracking-[-0.025em] text-[var(--x-ink)]">
              ${dollars(t.credits)}
            </span>
            <span className={X_CAPTION}>of usage on {t.name}</span>
          </span>
        ))}
      </div>

      {/* The curve — a run's spend accruing, drawn once on entry. */}
      <div className="mt-6 flex flex-1 items-end gap-1.5">
        {CURVE.map((h, i) => (
          <span
            key={i}
            className="w-full rounded-[2px]"
            style={{
              height: `${h}%`,
              minHeight: 4,
              background:
                i < shown ? "var(--x-ink)" : "color-mix(in srgb, var(--x-ink) 12%, transparent)",
              opacity: i < shown ? 1 : 0.4,
              transition: "background 300ms ease-out, opacity 300ms ease-out",
            }}
          />
        ))}
      </div>
      <p className={`${X_CAPTION} mt-4`}>
        Every run prices itself as it happens. Spend past the allowance and it
        bills at the same rate — no tier jump, no surprise.
      </p>
    </div>
  );
}

/** The governance facts that exist today. */
const FACTS = [
  {
    label: "One sandbox per run",
    body: "Work executes in a container issued for that run and torn down after it. No two runs share a filesystem, and nothing touches your machine.",
  },
  {
    label: "Credentials in a vault",
    body: "Connector auth is stored separately and exchanged at call time. A model sees the tool, never the key.",
  },
  {
    label: "An hour of server time",
    body: "A long task runs for up to an hour on the server, not in the tab. Close the window; the trace is waiting when you come back.",
  },
  {
    label: "Every run on the record",
    body: "Tools called, files touched, context used and dollars spent are attached to the run and stay with it.",
  },
] as const;

export function XControl() {
  return (
    <section className={X_SECTION_PAD}>
      <div className={X_CONTAINER}>
        <Reveal>
          <p className={X_LABEL}>Control</p>
          <h2
            className={`${X_SECTION} mt-4 max-w-[18ch] text-balance text-[var(--x-ink)]`}
          >
            You can see what it spends and where it runs
          </h2>
          <p className={`${X_INTRO} mt-4 max-w-[520px]`}>
            The meter, the isolation and the record are the same on every tier.
            Only the allowance changes.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <Reveal>
            <SpendCard />
          </Reveal>

          <Reveal step={1}>
            <div className="grid h-full gap-4 sm:grid-cols-2">
              {FACTS.map((f) => (
                <div
                  key={f.label}
                  className="rounded-[16px] bg-[var(--x-raise)] p-5"
                >
                  <p className="text-[14px] font-medium tracking-[-0.025em] text-[var(--x-ink)]">
                    {f.label}
                  </p>
                  <p className={`${X_CAPTION} mt-1.5`}>{f.body}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
