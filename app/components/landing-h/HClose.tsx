import { PiPixelMark } from "@/app/components/landing-pi/PiPixelMark";

import { HReveal } from "./HReveal";
import { H_CONTAINER } from "./h-system";

/**
 * The close — the reference's pixel-mark sign-off ("give it something hard"),
 * here on a dark gradient rather than flat black. The RIFT mark is drawn as
 * pixels (the real artwork, at a coarse grain), the colour is quarantined to a
 * violet/ice wash with no orange in it, and the two controls invert to light so
 * they carry on the dark ground.
 */
const BTN =
  "inline-flex h-11 items-center justify-center rounded-[3px] px-6 font-[family-name:var(--h-mono)] text-[12px] font-medium uppercase tracking-[0.08em] transition-colors";

export function HClose() {
  return (
    <section
      id="pricing"
      className="relative isolate overflow-hidden border-t border-[var(--h-dark-line)] bg-[var(--h-dark)]"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-20%] size-[70%] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(124,92,255,0.30),transparent_60%)] blur-[40px]" />
        <div className="absolute -right-[10%] bottom-[-25%] size-[60%] rounded-full bg-[radial-gradient(circle,rgba(64,150,255,0.24),transparent_62%)] blur-[40px]" />
        <div className="absolute -left-[10%] bottom-[-20%] size-[52%] rounded-full bg-[radial-gradient(circle,rgba(150,120,255,0.18),transparent_62%)] blur-[40px]" />
      </div>

      <div className={`${H_CONTAINER} relative flex flex-col items-center py-28 text-center lg:py-40`}>
        <HReveal>
          <PiPixelMark
            className="h-[92px] w-[240px] sm:h-[112px] sm:w-[300px]"
            scale={0.92}
          />
        </HReveal>
        <HReveal delayMs={80}>
          <h2 className="mt-8 max-w-[16ch] text-[32px] font-medium leading-[1.06] tracking-[-0.025em] text-[var(--h-dark-ink)] sm:text-[42px] lg:text-[52px]">
            Spin up a machine. Give it something hard.
          </h2>
        </HReveal>
        <HReveal delayMs={140}>
          <p className="mx-auto mt-6 max-w-[42ch] text-[15px] leading-[1.6] text-[var(--h-dark-ink-45)]">
            No install, no card. Your first agent run is free, on a real
            machine, verified before it says done.
          </p>
        </HReveal>
        <HReveal delayMs={200}>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <a
              href="/signup"
              className={`${BTN} bg-white text-[#0a0a0a] hover:bg-white/90`}
            >
              Start building
            </a>
            <a
              href="/download"
              className={`${BTN} border border-white/25 text-white hover:border-white/60`}
            >
              Download for macOS
            </a>
          </div>
        </HReveal>
      </div>
    </section>
  );
}
