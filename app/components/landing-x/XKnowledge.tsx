import { Reveal } from "./reveal";
import { XKnowledgeGlobe } from "./XKnowledgeGlobe";
import {
  X_CONTAINER,
  X_CAPTION,
  X_INTRO,
  X_LABEL,
  X_SECTION,
  X_SECTION_PAD,
} from "./x-system";

/**
 * The connector globe as a section, gumloop's "company knowledge" shape.
 *
 * Their arrangement is a large graphic on one side and a short claim on the
 * other: a globe of tool logos orbiting a centre mark, captioned "connect your
 * team's shared knowledge into a centralized brain". Ours is the same figure
 * with our own claim — the connectors are what a RIFT run can reach, and the
 * centre mark is the run they feed.
 *
 * The globe (XKnowledgeGlobe) draws the real connector list. This section is
 * only the frame around it and the words beside it; the count in the copy is
 * `CONNECTORS.length`, the same number the grid below the fold shows, so the
 * two can never disagree.
 */
export function XKnowledge() {
  return (
    <section className={X_SECTION_PAD}>
      <div className={X_CONTAINER}>
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <Reveal>
            <XKnowledgeGlobe />
          </Reveal>

          <Reveal step={1} className="lg:order-first">
            <p className={X_LABEL}>One reach</p>
            <h2
              className={`${X_SECTION} mt-5 max-w-[16ch] text-balance text-[var(--x-ink)]`}
            >
              Your whole stack, one prompt away
            </h2>
            <p className={`${X_INTRO} mt-5 max-w-[470px]`}>
              Your services connect out of the box. A run reads from all of
              them without leaving the thread, and a model only ever sees the
              tool, never the key.
            </p>
            <p className={`${X_CAPTION} mt-4`}>Drag to turn it.</p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
