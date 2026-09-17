import { HReveal } from "./HReveal";
import { H_CONTAINER } from "./h-system";

/**
 * The dark gradient moment — a terminal card floating on a coloured wash, the
 * x.ai "one API" card done in RIFT's register and without a trace of orange.
 *
 * It carries the one claim the light sections state but cannot show: the agent
 * does not announce "done", it earns it. What sits in the card is exactly what
 * the machine runs at the end of a task — the test suite, a probe of the
 * preview it just served — with the passes marked. Static: no blinking dots,
 * the success ticks are semantic, not decoration.
 */
const LINES: { p?: string; cmd?: string; ok?: string; out?: string; note?: string }[] = [
  { p: "agent@sandbox", cmd: "pnpm test" },
  { ok: "✓ collisions.spec.ts", out: "7 passed" },
  { ok: "✓ integrator.spec.ts", out: "4 passed" },
  { note: "11 passed · 0 failed · 1.2s" },
  { p: "agent@sandbox", cmd: "curl -sI localhost:3000" },
  { out: "HTTP/1.1 200 OK" },
  { p: "agent@sandbox", cmd: "screenshot ./preview.png" },
  { ok: "✓ preview built · served · photographed" },
];

export function HCode() {
  return (
    <section className="relative isolate overflow-hidden bg-[var(--h-dark)] py-24 lg:py-32">
      {/* Colour, quarantined to a wash behind a dark card — violet and ice, no orange. */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-[15%] top-[-10%] size-[62%] rounded-full bg-[radial-gradient(circle,rgba(124,92,255,0.32),transparent_62%)] blur-[30px]" />
        <div className="absolute -right-[12%] bottom-[-14%] size-[60%] rounded-full bg-[radial-gradient(circle,rgba(64,150,255,0.26),transparent_62%)] blur-[30px]" />
      </div>

      <div className={`${H_CONTAINER} relative`}>
        <div className="grid items-center gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <HReveal>
            <p className="text-[11px] font-medium uppercase tracking-[0.13em] text-[var(--h-dark-ink-45)]">
              Proof, not opinion
            </p>
            <h2 className="mt-5 max-w-[16ch] text-[28px] font-medium leading-[1.1] tracking-[-0.02em] text-[var(--h-dark-ink)] sm:text-[34px] lg:text-[40px]">
              It doesn&rsquo;t say done. It proves it.
            </h2>
            <p className="mt-6 max-w-[46ch] text-[15px] leading-[1.6] text-[var(--h-dark-ink-45)]">
              Every run ends the same way: the machine runs the tests it wrote,
              probes the preview it just served, and photographs the result —
              before the word &ldquo;done&rdquo; ever reaches you.
            </p>
          </HReveal>

          <HReveal delayMs={120}>
            <div className="overflow-hidden rounded-[12px] border border-[var(--h-dark-line)] bg-[#0c0d10] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.8)]">
              <div className="flex items-center gap-2 border-b border-[var(--h-dark-line)] px-4 py-3">
                <span className="size-2.5 rounded-full bg-white/15" />
                <span className="size-2.5 rounded-full bg-white/15" />
                <span className="size-2.5 rounded-full bg-white/15" />
                <span className="ml-2 font-[family-name:var(--h-mono)] text-[11px] tracking-[0.02em] text-[var(--h-dark-ink-45)]">
                  machine-01 — verify
                </span>
              </div>
              <div className="p-5 font-[family-name:var(--h-mono)] text-[12.5px] leading-[1.85]">
                {LINES.map((l, i) => (
                  <div key={i} className="flex flex-wrap gap-x-2">
                    {l.cmd ? (
                      <>
                        <span className="text-[var(--h-live)]">{l.p} ▸</span>
                        <span className="text-white">{l.cmd}</span>
                      </>
                    ) : null}
                    {l.ok ? (
                      <span className="text-[var(--h-live)]">{l.ok}</span>
                    ) : null}
                    {l.out ? (
                      <span className="text-white/55">{l.out}</span>
                    ) : null}
                    {l.note ? (
                      <span className="text-white/40">{l.note}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </HReveal>
        </div>
      </div>
    </section>
  );
}
