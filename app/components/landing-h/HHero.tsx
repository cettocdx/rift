import { HMachineMedia } from "./HMachineMedia";
import { H_BTN_SOLID, H_CONTAINER } from "./h-system";

/**
 * The hero — the machine, filling the fold, the way the references do.
 *
 * RIFT's own machine (HMachineMedia): a photoreal 4K compute unit, RIFT ·
 * ONLINE on its dial, copper heat-sinks glowing as it runs. One restrained
 * line names what it does. No side panel, no colour, no oversized type — the
 * machine carries it.
 */
export function HHero() {
  return (
    <section
      id="top"
      className="relative isolate overflow-hidden border-b border-[var(--h-line)] bg-[var(--h-ground)]"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(58%_58%_at_62%_44%,#ffffff,transparent_70%)]" />
        <HMachineMedia className="absolute inset-y-0 right-[-2%] size-full max-w-[62%] object-contain object-right lg:max-w-[56%]" />
      </div>

      <div
        className={`${H_CONTAINER} relative flex min-h-[80svh] flex-col justify-end pb-16 pt-36`}
      >
        <div className="font-[family-name:var(--h-mono)] text-[11px] uppercase tracking-[0.12em] text-[var(--h-ink-45)]">
          The agent workstation
        </div>

        <h1 className="mt-5 max-w-[18ch] text-[26px] font-medium leading-[1.08] tracking-[-0.02em] text-[var(--h-ink)] sm:text-[32px] lg:text-[38px]">
          RIFT is a real machine.{" "}
          <span className="text-[var(--h-ink-45)]">Give it the work.</span>
        </h1>

        <p className="mt-5 max-w-[46ch] text-[14px] leading-[1.6] text-[var(--h-ink-70)]">
          Spin one up and watch it work — a filesystem, a package manager and a
          terminal, every frontier model, verified before it says done.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <a href="/signup" className={H_BTN_SOLID}>
            Start building
          </a>
          <a
            href="#build"
            className="font-[family-name:var(--h-mono)] text-[12px] uppercase tracking-[0.08em] text-[var(--h-ink-70)] transition-colors hover:text-[var(--h-ink)]"
          >
            See it run &darr;
          </a>
        </div>
      </div>
    </section>
  );
}
