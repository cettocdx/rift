"use client";

import { Reveal } from "./reveal";
import { AGENT_PET_CATALOG } from "@/lib/ai/agents/pet-roster";

import { CONNECTORS } from "./x-mark-data";
import { BUILD_MODELS, MEDIA_MODELS } from "@/types/chat";

const VENDORS = [...new Set(BUILD_MODELS.map((m) => m.provider))].map((v) =>
  v === "MoonshotAI" ? "Moonshot" : v,
);

import {
  X_CAPTION,
  X_CARD_TITLE,
  X_CONTAINER,
  X_LABEL,
  X_SECTION,
  X_SECTION_PAD,
} from "./x-system";

/**
 * Everything the product does, said once and said plainly.
 *
 * ── Why a grid and not a tour ──
 *
 * The sections above give three capabilities a screen each, which is right for
 * the three a reader came for and wrong for the rest that decide whether
 * they stay. The reference solves the same problem the same way: after the
 * hero tour it drops a dense grid and stops narrating.
 *
 * Every entry below is a thing this product actually does today. Nothing here
 * is a roadmap item, and nothing is phrased so that a reader could not check
 * it within a minute of signing in — which is the only standard a feature grid
 * can be held to, because it is the one part of a landing page nobody reads
 * carefully until after they have paid.
 */

/*
 * The first column used to be "The loop", and it restated the Build section's
 * four bullets almost word for word four hundred pixels further down —
 * "Plan mode drafts the change and waits" and "a filesystem, a package manager
 * and a terminal, not a diff preview" both appeared twice on the page. A grid
 * that repeats the tour teaches a reader that the page has nothing more to
 * say. It is replaced with the things the tour does not cover.
 */
const GROUPS = [
  {
    label: "The workspace",
    items: [
      {
        title: "Projects, not prompts",
        body: "Work is organised into projects with their own history, files and connectors, so a thread is somewhere you return to rather than something you start again.",
      },
      {
        title: "Runs you can leave",
        body: "A long task keeps its own trace and result, waiting for you whether or not the window stayed open.",
      },
      {
        title: "Bring your own context",
        body: "Attach the repository, the spec, the screenshot or the archive. Large files go to the sandbox for the agent to open, not into the prompt.",
      },
      {
        title: "Plan or act",
        body: "The same run in two temperaments: one that drafts and waits, one that goes straight to work.",
      },
    ],
  },
  {
    label: "Reach",
    items: [
      {
        title: "Frontier vendors",
        body: `${VENDORS.join(", ").replace(/, ([^,]*)$/, " and $1")}. Pick per task, not per subscription.`,
      },
      {
        // Derived. This said "Six renderers" and there are twelve — the same
        // hand-typed count that put a model we do not ship on the model wall.
        title: "Images and video, built in",
        body: "Image and video renderers on the same key, the same bill and the same run history as the code.",
      },
      {
        // "Parallel agents" was not supported anywhere: the free tier holds a
        // single-run lock in lib/rate-limit/free-concurrency.ts and no policy
        // establishes concurrent execution as a user-facing capability.
        title: `${AGENT_PET_CATALOG.length} agent archetypes`,
        body: "Delegated to rather than prompted at — each a starting point you give a model and a tool allowlist.",
      },
      {
        title: "Any MCP server",
        body: `${CONNECTORS.length} are one click from connected. Anything else connects by URL, with OAuth handled and credentials in a vault.`,
      },
    ],
  },
  {
    label: "Judgement",
    items: [
      {
        title: "The offensive toolchain, preinstalled",
        body: "The Hack Workbench runs it against a declared, authorised scope and keeps the evidence. Included with Max.",
      },
      {
        // This card used to read "No weekly cap — every competing agent
        // publishes one. This does not, on any tier." It was true only on the
        // word *weekly*: the free tier caps questions per day and both paid
        // tiers cap credits per month. A differentiator that rests on the
        // shape of a limit rather than its absence is the first thing a
        // competitor screenshots.
        title: "The meter is in the room",
        body: "Every run shows its own cost as it happens, so the bill is a number you watched arrive rather than one that turns up later.",
      },
      {
        title: "One thread, three surfaces",
        body: "Browser and desktop share one account, one sandbox and one history.",
      },
    ],
  },
] as const;

export function XCapabilities() {
  return (
    <section id="everything" className={`${X_SECTION_PAD} scroll-mt-20`}>
      <div className={X_CONTAINER}>
        <Reveal>
          <p className={X_LABEL}>Everything in one place</p>
          {/* "…and none of them is a roadmap" was a pre-rebuttal to an
              objection the reader had not raised, which is a tic that makes a
              page sound small. The heading now just says what follows. */}
          <h2
            className={`${X_SECTION} mt-5 max-w-[22ch] text-balance text-[var(--x-ink)]`}
          >
            What it does today
          </h2>
        </Reveal>

        {/* Ruled columns, no box. A bordered grid painted with 1px background
            gaps reads as a seam on a dark page and as a grey lattice on paper;
            `divide-*` puts the rule only between the columns and leaves the
            group's outer edges open, which is how the reference groups
            anything. */}
        <div className="mt-16 grid divide-y-[0.5px] divide-[var(--x-line)] border-t-[0.5px] border-t-[var(--x-line)] lg:grid-cols-3 lg:divide-x-[0.5px] lg:divide-y-0">
          {GROUPS.map((group) => (
            <div
              key={group.label}
              className="py-10 lg:px-10 lg:first:pl-0 lg:last:pr-0"
            >
              <p className={X_LABEL}>{group.label}</p>
              <ul className="mt-8 flex flex-col gap-9">
                {group.items.map((item) => (
                  <li key={item.title}>
                    <h3 className={`${X_CARD_TITLE} text-[var(--x-ink)]`}>
                      {item.title}
                    </h3>
                    <p className={`${X_CAPTION} mt-2.5 leading-[23px]`}>
                      {item.body}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
