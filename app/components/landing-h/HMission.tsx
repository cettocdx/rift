import { HReveal } from "./HReveal";
import { H_CONTAINER, H_DISPLAY, H_LABEL, H_LEDE, H_PAD } from "./h-system";

/**
 * The thesis, at the reference's display scale (they run 94px). One statement,
 * no ornament — Hermeus's "Mission" screen is a single large sentence and a
 * hairline. This is RIFT's, in the same key: the whole product in a breath.
 */
export function HMission() {
  return (
    <section
      className={`${H_PAD} border-t border-[var(--h-line)] bg-[var(--h-ground)]`}
    >
      <div className={H_CONTAINER}>
        <HReveal>
          <p className={H_LABEL}>Mission</p>
        </HReveal>
        <HReveal delayMs={80}>
          <h2 className={`${H_DISPLAY} mt-8 max-w-[18ch] text-[var(--h-ink)]`}>
            Give it the work. It builds it on a real machine, proves it, and
            hands back something that runs.
          </h2>
        </HReveal>
        <div className="mt-14 grid gap-8 border-t border-[var(--h-line)] pt-10 sm:grid-cols-2 lg:grid-cols-3">
          {[
            [
              "A real machine",
              "A filesystem, a package manager and a terminal — not a diff preview. The agent runs what it wrote.",
            ],
            [
              "Proof, not opinion",
              "The build runs, the server is probed and the page is photographed before you ever see a preview.",
            ],
            [
              "Every model, one key",
              "Six reasoning vendors and twelve renderers behind one account and one bill. Pick per task.",
            ],
          ].map(([t, b], i) => (
            <HReveal key={t} delayMs={i * 90}>
              <p className={`${H_LABEL} text-[var(--h-ink)]`}>{t}</p>
              <p className={`${H_LEDE} mt-3 max-w-[42ch]`}>{b}</p>
            </HReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
