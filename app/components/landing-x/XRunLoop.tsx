"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The run, drawn — a real terminal executing the verify loop.
 *
 * ── What this is and why ──
 *
 * The section's claim is "it has to make it work before it says it works", and
 * the picture beside it was a photograph of light. A picture of weather cannot
 * make that claim; a terminal running the checks can. This plays the loop
 * `verify_app` actually runs — build, probe, then render at desktop and mobile
 * widths — and holds the "preview released" line back until every gate has
 * passed, because that is exactly what `expose-preview.ts` does: it refuses to
 * publish a preview for a port that has not cleared those checks. The animation
 * is the argument.
 *
 * ── What changed from the first version ──
 *
 * The first was a static list that faded in a line at a time. This is a run:
 *
 *  - a window frame with the sandbox's own chrome, so it reads as software;
 *  - a caret that advances line by line, so the eye follows the execution;
 *  - each gate resolving from a spinner to a green check *in place*, so the
 *    checks look performed rather than pre-decided;
 *  - a result bar that arrives only after the last gate clears, then a hold,
 *    then the loop restarts.
 *
 * Every string is the product's: the commands are what the sandbox runs, and
 * the totals are HERO_RUN's, the same transcribed run the receipt below is
 * built from.
 *
 * ── Motion (apple-design) ──
 *
 * Compositor-only (`opacity`/`transform`), critically damped, no overshoot —
 * a line of machine output that bounces reads as a toy. It runs only while on
 * screen. Reduced motion shows the finished frame, settled, and never loops.
 */

type Step = {
  prompt: string;
  cmd: string;
  /** Lines the command prints, revealed together a beat after the command. */
  out: string[];
  /** A gate resolves spinner → ✓; a plain step just prints. */
  gate?: boolean;
  /** The single value shown at the right when a gate passes. */
  pass?: string;
};

const STEPS: readonly Step[] = [
  {
    prompt: "agent@sandbox",
    cmd: "read src/pricing.ts",
    out: ["218 lines · found the off-by-one in the rounding path"],
  },
  {
    prompt: "agent@sandbox",
    cmd: "edit src/pricing.ts",
    out: ["+34 −6 · integer cents, no float"],
  },
  {
    prompt: "agent@sandbox",
    cmd: "pnpm build",
    out: ["compiled · 0 errors"],
    gate: true,
    pass: "build",
  },
  {
    prompt: "agent@sandbox",
    cmd: "curl -s -o /dev/null -w '%{http_code}' :4173",
    out: ["200"],
    gate: true,
    pass: "serves",
  },
  {
    prompt: "verify_app",
    cmd: "render 1440×900",
    out: ["frame captured · layout intact"],
    gate: true,
    pass: "desktop",
  },
  {
    prompt: "verify_app",
    cmd: "render 390×844",
    out: ["frame captured · layout intact"],
    gate: true,
    pass: "mobile",
  },
] as const;

/** Two phases per step — the command, then its output. */
const PHASE_MS = 460;
/** The finished frame holds before the loop restarts. */
const HOLD_MS = 3200;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/** A gate that has printed but not yet resolved shows a spinner this long. */
const RESOLVE_MS = 340;

export function XRunLoop({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  // `phase` counts half-steps: even = command typed, odd = output shown.
  const [phase, setPhase] = useState(0);
  const [reduced, setReduced] = useState(false);
  const phaseRef = useRef(0);

  const TOTAL = STEPS.length * 2;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (still?.matches) {
      timer = setTimeout(() => {
        setReduced(true);
        setPhase(TOTAL + 1); // everything shown, released
      }, 0);
      return () => clearTimeout(timer);
    }

    let running = false;
    const advance = () => {
      const next = phaseRef.current > TOTAL ? 0 : phaseRef.current + 1;
      phaseRef.current = next;
      setPhase(next);
      timer = setTimeout(advance, next > TOTAL ? HOLD_MS : PHASE_MS);
    };
    const start = () => {
      if (running) return;
      running = true;
      timer = setTimeout(advance, PHASE_MS);
    };
    const stop = () => {
      running = false;
      if (timer) clearTimeout(timer);
    };

    if (typeof IntersectionObserver === "undefined") {
      start();
      return stop;
    }
    const io = new IntersectionObserver(
      ([e]) => (e.isIntersecting ? start() : stop()),
      { threshold: 0.25 },
    );
    io.observe(host);
    return () => {
      io.disconnect();
      stop();
    };
  }, [TOTAL]);

  const released = phase > TOTAL;
  // How many command lines and output lines are visible.
  const cmdShown = Math.min(STEPS.length, Math.ceil(phase / 2));
  const outShown = Math.min(STEPS.length, Math.floor(phase / 2));

  return (
    <div
      ref={hostRef}
      className={`flex flex-col overflow-hidden bg-[#0a0b0d] ${className ?? ""}`}
    >
      {/* Window chrome. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-b-white/[0.06] px-4 py-3">
        <span className="size-2.5 rounded-full bg-white/12" />
        <span className="size-2.5 rounded-full bg-white/12" />
        <span className="size-2.5 rounded-full bg-white/12" />
        <span className="ml-2 font-mono text-[11px] tracking-[0.02em] text-white/40">
          machine-01 — verify run
        </span>
      </div>

      {/* The run. */}
      <div className="flex-1 overflow-hidden p-5 font-mono text-[12.5px] leading-[1.85] sm:p-6">
        {STEPS.map((step, i) => {
          const cmdOn = i < cmdShown;
          const outOn = i < outShown;
          // A gate is "resolving" for a beat after its output appears.
          const justResolved = i === outShown - 1;
          const spinning = step.gate && outOn && justResolved && !released;
          return (
            <div key={step.cmd} className="mb-1.5">
              {/* Command line. */}
              <div
                className="flex items-baseline gap-2"
                style={{
                  opacity: cmdOn ? 1 : 0,
                  transform: cmdOn ? "none" : "translateY(4px)",
                  transition: reduced
                    ? "none"
                    : `opacity 220ms ${EASE}, transform 220ms ${EASE}`,
                }}
              >
                <span className="shrink-0 select-none text-[var(--x-live)]">
                  {step.prompt} ▸
                </span>
                <span className="min-w-0 break-all text-white/90">
                  {step.cmd}
                </span>
              </div>
              {/* Output line. */}
              <div
                className="flex items-baseline gap-2 pl-4"
                style={{
                  opacity: outOn ? 1 : 0,
                  transform: outOn ? "none" : "translateY(4px)",
                  transition: reduced
                    ? "none"
                    : `opacity 220ms ${EASE}, transform 220ms ${EASE}`,
                }}
              >
                {step.gate ? (
                  <span
                    className="shrink-0"
                    style={{ color: "var(--x-live)" }}
                  >
                    {spinning ? (
                      <span className="inline-block animate-spin motion-reduce:animate-none">
                        ◠
                      </span>
                    ) : (
                      "✓"
                    )}
                  </span>
                ) : (
                  <span className="shrink-0 text-white/25">·</span>
                )}
                <span className="min-w-0 text-white/55">{step.out[0]}</span>
                {step.pass ? (
                  <span className="ml-auto shrink-0 pl-3 font-mono text-[11px] text-[var(--x-live)]">
                    {spinning ? "…" : `gate: ${step.pass}`}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}

        {/* The caret, while the run is still going. */}
        {!released ? (
          <span
            aria-hidden
            className="ml-4 inline-block h-[14px] w-[7px] translate-y-[2px] animate-pulse bg-[var(--x-live)]/70 motion-reduce:animate-none"
          />
        ) : null}

        {/*
         * The release bar — the point of the whole thing. The preview is not
         * announced by the agent; it is released by the gates above.
         */}
        <div
          className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-white/10 pt-4"
          style={{
            opacity: released ? 1 : 0,
            transform: released ? "none" : "translateY(6px)",
            transition: reduced
              ? "none"
              : `opacity 340ms ${EASE}, transform 340ms ${EASE}`,
          }}
        >
          <span className="shrink-0 font-medium text-[var(--x-live)]">
            ▸ preview released
          </span>
          <span className="text-white/40">
            — all four gates passed · +34 lines · 2 tools · $2.10
          </span>
        </div>
      </div>
    </div>
  );
}
