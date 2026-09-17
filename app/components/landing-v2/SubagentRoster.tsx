"use client";

import { motion, useReducedMotion } from "motion/react";

import { AgentPetAvatar } from "@/app/components/agents/AgentPetAvatar";
import { AGENT_PET_CATALOG } from "@/lib/ai/agents/pet-roster";

import { EASE_OUT } from "./landing-design-system";
import { useInViewOnce } from "./use-in-view";

/**
 * The roster, arriving as a crew rather than as a grid.
 *
 * The section's claim is a number — twenty-nine specialists — and the old
 * entrance actively worked against it: a 12ms stagger capped at the twelfth
 * item, which at that spacing is indistinguishable from all of them appearing
 * at once. Twenty-nine things appearing simultaneously reads as one texture,
 * and the reader never registers that they are looking at twenty-nine of
 * anything.
 *
 * So the wave is diagonal and slow enough to count. Delay is a function of row
 * plus column rather than of index, which sweeps across the grid from the top
 * left instead of running along each row and snapping back — the same reason a
 * lighting cue travels a stage rather than switching row by row. At eight
 * columns the last avatar lands 0.62s after the first, which is long enough to
 * read as a sequence and short enough that nobody waits for it.
 *
 * They also arrive from slightly below and slightly small, which is what makes
 * it read as a crew assembling rather than a list loading.
 */

/** Columns at each breakpoint, so the diagonal is a diagonal at every width. */
const COLUMNS = 8;

export function SubagentRoster() {
  const reduceMotion = useReducedMotion();
  const [ref, seen] = useInViewOnce<HTMLUListElement>(0.15);

  return (
    <ul
      ref={ref}
      className="mt-14 grid grid-cols-3 gap-x-4 gap-y-7 sm:grid-cols-5 lg:grid-cols-8"
    >
      {AGENT_PET_CATALOG.map((agent, index) => {
        const row = Math.floor(index / COLUMNS);
        const column = index % COLUMNS;
        const delay = (row + column) * 0.035;

        return (
          <li key={agent.id}>
            <motion.div
              initial={
                reduceMotion ? false : { opacity: 0, y: 14, scale: 0.92 }
              }
              animate={
                reduceMotion || seen
                  ? { opacity: 1, y: 0, scale: 1 }
                  : undefined
              }
              transition={{ duration: 0.5, delay, ease: EASE_OUT }}
              // Hover stays a spring rather than joining the entrance easing:
              // a lift under the pointer is a physical response to a gesture,
              // and the two kinds of motion should not feel like the same
              // thing.
              whileHover={reduceMotion ? undefined : { y: -3 }}
              className="flex flex-col items-center text-center"
            >
              <AgentPetAvatar
                accent={agent.accent}
                agentName={agent.petName}
                role={agent.visualPreset}
                roleName={agent.roleName}
                size={48}
              />
              <p className="mt-2 w-full truncate text-[12.5px] font-medium text-foreground">
                {agent.petName}
              </p>
              <p
                className="mt-0.5 w-full text-[10.5px] leading-[1.35] text-[var(--cursor-text-secondary)]"
                title={agent.roleName}
              >
                {agent.roleName}
              </p>
            </motion.div>
          </li>
        );
      })}
    </ul>
  );
}
