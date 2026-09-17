"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import { BuildModels } from "./BuildModels";
import { HackWorkbenchSection } from "./HackWorkbenchSection";
import { PluginWall } from "./PluginWall";
import { Reveal, Section } from "./Reveal";
import { RiftMiniApp } from "./RiftMiniApp";
import { GridRule } from "./LandingGrid";
import { BODY_CLASS } from "./type-scale";
import { RunScrubber } from "./RunScrubber";
import { PricingSection, DownloadSection } from "./PricingAndDownload";
import { SubagentRoster } from "./SubagentRoster";
import { StudioVendors } from "./StudioVendors";
import { useInViewOnce } from "./use-in-view";

/**
 * The body of the page.
 *
 * Every claim here is read off the product rather than invented — the subagent
 * roster, the workbench's 87 tools across 25 categories, the plan prices. A
 * landing page that inflates those is a page the first session contradicts.
 *
 * Models are shown as vendor marks rather than named lists: a named list dates
 * the page the first time a model ships or retires.
 */

/* ── Build ──────────────────────────────────────────────────────────────── */

/**
 * The four things Build does that a suggestion engine does not.
 *
 * Each carries a fragment of the real interface rather than only a sentence.
 * That is the difference between these cards and the ones they replace, and it
 * is copied from the reference deliberately: every explanation card on axiom.co
 * contains a small piece of working UI — an invoice, a chart, a topology — so
 * the card demonstrates while it explains. Ours held words alone, which is how
 * a page ends up describing a product instead of showing one.
 *
 * The fragments are built from the same tokens the application uses, so they
 * cannot drift into looking like something the product does not have.
 */
const BUILD_STEPS = [
  {
    title: "Plan first, or don't",
    body: "Plan mode drafts the change and waits for you. Agent mode goes straight to work. The toggle is one key, not a mode switch you have to commit to.",
    artifact: "toggle" as const,
  },
  {
    title: "Runs in a real sandbox",
    body: "Not a diff preview. A filesystem, a package manager and a terminal — so the agent can install, run and read the failure it just caused.",
    artifact: "terminal" as const,
  },
  {
    title: "Verifies before it claims",
    body: "Tests and type-checks run inside the same sandbox. What you get back is a result, not a description of one.",
    artifact: "verify" as const,
  },
  {
    title: "You watch the meter",
    body: "Tools called, lines added and removed, context used and dollars burned — live, in the same strip, while it works.",
    artifact: "meter" as const,
  },
];

/**
 * A number that climbs to its value instead of appearing at it.
 *
 * Used by the meter card, which is the one making the claim about watching a
 * run happen. A static 17 asserts it; a 17 that arrives by counting shows it.
 * Cubic ease-out over eighteen frames, the same curve the counter inside the
 * product frame uses, so the page has one idea of how a number lands.
 */
function CountUp({
  to,
  run,
  prefix = "",
  suffix = "",
  decimals = 0,
}: {
  to: number;
  run: boolean;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}) {
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!run || reduceMotion) return;
    let frame = 0;
    const steps = 18;
    const timer = setInterval(() => {
      frame += 1;
      setShown(to * (1 - Math.pow(1 - frame / steps, 3)));
      if (frame >= steps) clearInterval(timer);
    }, 26);
    return () => clearInterval(timer);
  }, [run, to, reduceMotion]);

  const value = reduceMotion || !run ? to : shown;
  return (
    <span className="tabular-nums">
      {prefix}
      {value.toFixed(decimals)}
      {suffix}
    </span>
  );
}

/** A command that types itself, one character at a time. */
function TypedLine({
  text,
  run,
  delay,
}: {
  text: string;
  run: boolean;
  delay: number;
}) {
  const reduceMotion = useReducedMotion();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!run || reduceMotion) return;
    let index = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      timer = setInterval(() => {
        index += 1;
        setCount(index);
        if (index >= text.length && timer) clearInterval(timer);
      }, 24);
    }, delay);
    return () => {
      clearTimeout(start);
      if (timer) clearInterval(timer);
    };
  }, [run, text, delay, reduceMotion]);

  const shown = reduceMotion || !run ? text : text.slice(0, count);
  return (
    <>
      <span className="text-foreground/25">$ </span>
      {shown}
    </>
  );
}

/**
 * The working fragment inside a Build card — and the card's own argument.
 *
 * These used to be four static pictures of interface. Each card claims
 * something specific about the agent, and the fragment underneath sat there
 * being a screenshot of it: the toggle claimed a mode switch and did not
 * switch, the terminal claimed execution and showed two finished lines, the
 * verify card claimed a result and printed one, the meter claimed live
 * counters and displayed four constants.
 *
 * Now each performs its own sentence when the reader reaches it. The
 * distinction this whole section draws is between a tool that does the thing
 * and a tool that describes it, so this is where the page's motion is worth
 * spending — rather than on another rise-and-fade.
 */
function BuildArtifact({
  kind,
  run,
}: {
  kind: (typeof BUILD_STEPS)[number]["artifact"];
  run: boolean;
}) {
  const reduceMotion = useReducedMotion();

  if (kind === "toggle") {
    // The lit plate travels between the two modes rather than being painted on
    // one of them. `layoutId` interpolates the position, so it reads as one
    // object moving instead of two things fading.
    return (
      <span className="inline-flex items-center gap-1 rounded-[6px] border border-border bg-background/60 p-0.5">
        {(["Agent", "Plan"] as const).map((label) => {
          const active = run ? label === "Agent" : label === "Plan";
          return (
            <span
              key={label}
              // The plate colour lives on this element as well as on the
              // travelling `layoutId` span underneath the label. They paint the
              // same rectangle in the same colour, so nothing changes visually
              // — but the label's own colour no longer depends on a sibling
              // rendering. It did, and a contrast sweep caught the result:
              // `text-background` on a dark ground, ratio 1.00, the word
              // "Agent" completely invisible whenever the plate had not
              // painted.
              className={`relative rounded-[6px] px-2 py-1 text-[11.5px] font-medium ${
                active ? "bg-foreground" : ""
              }`}
            >
              {active && (
                <motion.span
                  layoutId="build-mode-plate"
                  aria-hidden
                  className="absolute inset-0 rounded-[6px] bg-foreground"
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { type: "spring", bounce: 0, duration: 0.45 }
                  }
                />
              )}
              <span
                className={`relative ${
                  active ? "text-background" : "text-foreground/45"
                }`}
              >
                {label}
              </span>
            </span>
          );
        })}
      </span>
    );
  }

  if (kind === "terminal") {
    return (
      <span className="block rounded-[6px] border border-border bg-background/60 px-2.5 py-2 font-mono text-[11.5px] leading-[1.7] text-foreground/60">
        <TypedLine text="pnpm add zod" run={run} delay={120} />
        <br />
        <TypedLine text="node scripts/seed.ts" run={run} delay={560} />
      </span>
    );
  }

  if (kind === "verify") {
    return (
      <span className="block rounded-[6px] border border-border bg-background/60 px-2.5 py-2 font-mono text-[11.5px] leading-[1.7] text-foreground/60">
        <span className="text-foreground/25">$ </span>pnpm test pricing
        <br />
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: run ? 1 : 0 }}
          transition={{ duration: 0.28, delay: 0.55 }}
          className="text-foreground"
        >
          ✓ <CountUp to={41} run={run} /> passed
        </motion.span>
        <span className="text-foreground/35"> · 0 failed</span>
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[6px] border border-border bg-background/60 px-2.5 py-2 text-[11.5px] text-foreground/45 [font-variant-numeric:tabular-nums]">
      <span>
        tools{" "}
        <span className="text-foreground">
          <CountUp to={17} run={run} />
        </span>
      </span>
      <span>
        diff{" "}
        <span className="text-foreground/80">
          <CountUp to={145} run={run} prefix="+" />
        </span>{" "}
        <span className="text-foreground/40">
          <CountUp to={25} run={run} prefix="−" />
        </span>
      </span>
      <span>
        context{" "}
        <span className="text-foreground">
          <CountUp to={45} run={run} suffix="%" />
        </span>
      </span>
      <span>
        spent{" "}
        <span className="text-foreground">
          <CountUp to={0.25} run={run} prefix="$" decimals={2} />
        </span>
      </span>
    </span>
  );
}

function BuildSection() {
  const [buildRef, buildSeen] = useInViewOnce<HTMLDivElement>(0.3);

  return (
    <Section
      id="build"
      eyebrow="Build"
      title="An agent that finishes the job."
      lede="Most tools stop at a suggestion. Build runs the loop end to end — inside a sandbox that can actually execute what it wrote."
    >
      {/* One trigger for all four cards, not four.
 
          Each fragment performs itself, and staggering the *start* of those
          performances by card would have the terminal still typing while the
          meter had finished counting — four small animations running at four
          different times reads as a page that cannot decide what it is doing.
          They share a signal and are separated by the delays inside each
          fragment instead. */}
      <div
        ref={buildRef}
        className="mt-14 grid gap-px overflow-hidden rounded-[12px] border border-border bg-border sm:grid-cols-2"
      >
        {BUILD_STEPS.map((item, index) => (
          <Reveal key={item.title} delay={index * 0.06}>
            <div className="flex h-full flex-col bg-background p-7">
              {/* No 01/02/03. These four are parallel properties of one agent,
                  not steps in a sequence — numbering them implied an order that
                  does not exist and read as the stock "SECTION 01" device.
                  The Workbench cards keep their numbers, because that flow
                  genuinely runs in order. */}
              <h3 className="text-[15.5px] font-medium tracking-[-0.01em] text-foreground">
                {item.title}
              </h3>
              <p className="mt-2.5 text-[13.5px] leading-[1.62] text-[var(--cursor-text-secondary)]">
                {item.body}
              </p>
              {/* The card shows the thing it just described. */}
              <span className="mt-5 block">
                <BuildArtifact kind={item.artifact} run={buildSeen} />
              </span>
            </div>
          </Reveal>
        ))}
      </div>

      {/* The composer used to be demonstrated twice: once here, and once in the
          frame at the top of the page that a visitor can actually type into.
          The second copy argued nothing the first had not already proved, and
          it cost 400px in the middle of the section that has to land. What
          stays below is what the frame does not show — the run's cost over
          time, and the six vendors behind it. */}

      <RunScrubber />

      <BuildModels />
    </Section>
  );
}

/* ── Subagents ──────────────────────────────────────────────────────────── */

const SUBAGENTS = [
  { role: "Build engineer", body: "Writes and repairs the code." },
  { role: "Product designer", body: "Owns layout, type and interaction." },
  { role: "Research", body: "Reads sources before conclusions get drawn." },
  { role: "Quality", body: "Reproduces, tests, refuses to sign off early." },
  { role: "Marketing", body: "Turns the work into words that ship." },
  {
    role: "Video director",
    body: "Storyboards and directs generated footage.",
  },
];

function SubagentsSection() {
  return (
    <Section
      eyebrow="Subagents"
      title="Twenty-nine specialists, one thread."
      lede="Delegation only helps when the delegate is actually different. Each role carries its own instructions and its own standard for done — and reports back into the run you are already watching."
    >
      <SubagentRoster />
    </Section>
  );
}

/* ── Studio ─────────────────────────────────────────────────────────────── */

function StudioSection() {
  return (
    <Section
      id="studio"
      eyebrow="Studio"
      title="Every frontier image and video model, one prompt box."
      lede="The frontier image and video models sit behind a single prompt box, billed together. Pick the one that suits the shot instead of the one you happen to have a subscription to."
    >
      {/* Studio itself, operable, before anything it produced.
 
          The section used to open with three stills and a vendor row — output,
          then logos, and no way to tell whether the thing that made them
          works. It now opens with the surface: pick a model, send a prompt,
          watch the queue render. The stills stay below as what it returns,
          which is the order a reader actually needs them in. */}
      <div className="mt-12">
        <RiftMiniApp
          initialSurface="studio"
          showSidebar={false}
          autoDemo={false}
          caption="Studio, running · describe a shot and it renders for real"
          note="Type a shot and it renders for real, once a visitor a day · the queue below it is prepared"
        />
      </div>

      <StudioVendors />
    </Section>
  );
}

/* ── Plugins & MCP ──────────────────────────────────────────────────────── */

function PluginsSection() {
  return (
    <Section
      id="extend"
      eyebrow="Plugins & MCP"
      title="Bring your own tools."
      lede="Connect any MCP server — your issue tracker, your database, your internal APIs — with OAuth handled and credentials held in a vault rather than pasted into a prompt. Skills stay opt-in: the agent suggests one, you decide whether to spend the context."
    >
      {/* The providers that ship wired, read from the product's own catalog. */}
      <PluginWall />

      <div className="mt-12 grid gap-px overflow-hidden rounded-[12px] border border-border bg-border sm:grid-cols-3">
        {[
          {
            title: "OAuth, not API keys in chat",
            body: "Servers authenticate properly. Tokens live in the credential vault.",
          },
          {
            title: "Schemas load on demand",
            body: "Connected tools cost nothing until they are actually called.",
          },
          {
            title: "Skills stay suggestions",
            body: "Names and one-liners only. Nothing loads until you accept it.",
          },
        ].map((item, index) => (
          <Reveal key={item.title} delay={index * 0.06}>
            <div className="h-full bg-background p-7">
              <h3 className="text-[14.5px] font-medium tracking-[-0.01em] text-foreground">
                {item.title}
              </h3>
              <p className="mt-2.5 text-[13px] leading-[1.6] text-[var(--cursor-text-secondary)]">
                {item.body}
              </p>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/**
 * The sections, separated by drafting rules rather than by empty space.
 *
 * They used to be seven slabs stacked with 96px of nothing between them, which
 * is why the page read as a set of unrelated pages rather than one document —
 * there was no visible evidence that any two of them belonged to the same
 * object. A rule at each boundary, crossing the two continuous verticals,
 * makes the structure legible: every section is now measured against the same
 * column, and the reader can see where they are in the stack.
 */
export function LandingSections() {
  return (
    <>
      <GridRule />
      <BuildSection />
      <GridRule />
      <SubagentsSection />
      <GridRule />
      <StudioSection />
      <GridRule />
      <HackWorkbenchSection />
      <GridRule />
      <PluginsSection />
      <GridRule />
      <PricingSection />
      <GridRule />
      <DownloadSection />
    </>
  );
}
