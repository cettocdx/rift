"use client";

import { RiftWordmark } from "@/components/icons/rift-wordmark";
import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "motion/react";
// The product's own icon set, at the product's own size and stroke.
import {
  ArrowUp,
  Blocks,
  Bot,
  ArrowLeft,
  Check,
  ChevronDown,
  Folder,
  Hammer,
  Image as ImageIcon,
  Images,
  ListTodo,
  PanelLeft,
  Plus,
  Search,
  SquareTerminal,
  ShieldCheck,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { RiftLogo } from "@/components/icons/rift-logo";
import { AgentPetAvatar } from "@/app/components/agents/AgentPetAvatar";
import {
  AGENT_PET_CATALOG,
  AGENT_PET_ROSTER,
} from "@/lib/ai/agents/pet-roster";
import {
  ACTIVITY_ARG_CLASS,
  ACTIVITY_ARG_MONO_CLASS,
  ACTIVITY_CONNECTOR_CLASS,
  ACTIVITY_CONNECTOR_TICK_CLASS,
  ACTIVITY_COUNTERS_ROW_CLASS,
  ACTIVITY_ICON_CLASS,
  ACTIVITY_LABEL_GROUP_CLASS,
  ACTIVITY_ROW_CLASS,
  ACTIVITY_SECTION_COUNT_CLASS,
  ACTIVITY_SECTION_TITLE_CLASS,
  ACTIVITY_VERB_CLASS,
  activityPlanIconClass,
  activityPlanRowClass,
  sidebarNavRowClass,
  SIDEBAR_SECTION_LABEL_CLASS,
} from "@/lib/ui/workspace-chrome";
import { GravityLab } from "./GravityLab";
import {
  WORKBENCH_SURFACE_CLASS,
  WorkbenchCards,
  WorkbenchScopeBar,
  WorkbenchStatusBar,
  WorkbenchTabRow,
  WorkbenchTitleBar,
} from "./WorkbenchChrome";
import { HERO_WORKSPACE_APPEARANCE } from "./hero-appearance";
import { HERO_RUN } from "./hero-run-data";

/**
 * The product, rebuilt in the page.
 *
 * Not a video and not a screenshot: this is the workspace as real DOM, which is
 * the only version a reader can actually touch — click the rail and a different
 * surface loads, and the run in Build replays under a control you own. Text
 * stays selectable, it scales with the viewport instead of resampling, and it
 * costs a few kilobytes rather than three megabytes of H.264.
 *
 * What is on screen is a transcription of one real run (see hero-run-data.ts) —
 * the same plan, the same shell commands, the same counters, the same app at
 * the end. Nothing here fetches; the data is literal.
 *
 * Composition follows the reference we studied: a 6px bezel with concentric
 * radii, a frame deliberately wider than its column so it reads as an
 * application that does not fit rather than a picture of one, and two gradient
 * fades instead of a hard crop. It plays once when it comes into view and then
 * sits still — no loop running in the corner of anyone's eye.
 */

const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const STEP_MS = 620;
/** Timeline: user message → thinking → checklist → plan → 4 operations → done. */
const STEPS = 11;

type Surface =
  | "build"
  | "studio"
  | "workbench"
  | "agents"
  | "tasks"
  | "plugins"
  | "artifacts";

/** The same two nav groups, icons and order the product's sidebar ships. */
const PRIMARY: { id: Surface; label: string; Icon: LucideIcon }[] = [
  { id: "build", label: "Build", Icon: Hammer },
  { id: "studio", label: "Studio", Icon: ImageIcon },
  { id: "workbench", label: "Hack Workbench", Icon: SquareTerminal },
];

/** Every row in the product's utility group, and every one of them opens. */
const UTILITIES: { id: Surface; label: string; Icon: LucideIcon }[] = [
  { id: "agents", label: "Agents", Icon: Bot },
  { id: "tasks", label: "Tasks", Icon: ListTodo },
  { id: "plugins", label: "Plugins", Icon: Blocks },
  { id: "artifacts", label: "Artifacts", Icon: Images },
];

/**
 * Studio's real library entries and their production references — the same
 * files the product serves from /studio/showcase-v3.
 */
const STUDIO_MODELS = [
  {
    name: "Nano Banana 2 Lite",
    tier: "Image / Fast",
    title: "Rapid art direction",
    note: "Tactile colour, clear negative space and fast concept-level composition",
    thumb: "/studio/showcase-v3/image-lite-thumb.webp",
    hero: "/studio/showcase-v3/image-lite-4k.webp",
  },
  {
    name: "Nano Banana 2",
    tier: "Image / Default",
    title: "Product storytelling",
    note: "Transparent product geometry, natural caustics and campaign detail",
    thumb: "/studio/showcase-v3/image-gemini-thumb.webp",
    hero: "/studio/showcase-v3/image-gemini-4k.webp",
  },
  {
    name: "Gemini 3 Pro Image",
    tier: "Image / Premium",
    title: "Spatial campaign",
    note: "Believable scale, material depth and precise blue-hour composition",
    thumb: "/studio/showcase-v3/image-gemini-pro-thumb.webp",
    hero: "/studio/showcase-v3/image-gemini-pro-4k.webp",
  },
  {
    name: "FLUX.2 Max",
    tier: "Image / Max",
    title: "Material study",
    note: "Precise reflections and product geometry",
    thumb: "/studio/showcase-v3/image-flux-thumb.webp",
    hero: "/studio/showcase-v3/image-flux-4k.webp",
  },
] as const;

/** Hack Workbench's opening state, as the product reports it. */
const WORKBENCH: {
  target: string;
  cards: {
    title: string;
    badge: string;
    stats: { label: string; value: string; accent?: boolean }[];
    meter: string;
    percent: number;
  }[];
} = {
  target: "scanme.nmap.org",
  cards: [
    {
      title: "Attack surface",
      badge: "AUTHORIZED",
      stats: [
        { label: "Hosts", value: "0" },
        { label: "Services", value: "0" },
        { label: "Endpoints", value: "0" },
        { label: "Resolved IP", value: "—" },
        { label: "Phase", value: "DISCOVER", accent: true },
        { label: "Target", value: "scanme…" },
      ],
      meter: "Scope readiness",
      percent: 50,
    },
    {
      title: "Verified risk",
      badge: "PENDING",
      stats: [
        { label: "Findings", value: "0" },
        { label: "Critical", value: "0" },
        { label: "High", value: "0" },
        { label: "Medium", value: "0" },
        { label: "Low", value: "0" },
        { label: "Posture", value: "PENDING" },
      ],
      meter: "Awaiting evidence",
      percent: 0,
    },
    {
      title: "Agent session",
      badge: "READY",
      stats: [
        { label: "Tasks", value: "50" },
        { label: "Model", value: "RIFT" },
        { label: "Mode", value: "AGENT" },
        { label: "State", value: "READY" },
        { label: "Runtime", value: "00:08" },
        { label: "Evidence", value: "0 lines" },
      ],
      meter: "Toolchain available",
      percent: 100,
    },
  ],
};

/** Providers the product ships logos for, with their real connection states. */
const PLUGIN_ROWS = [
  {
    name: "Higgsfield",
    tools: 86,
    logo: "/plugin-logos/higgsfield.svg",
    state: "connected",
  },
  {
    name: "Hugging Face",
    tools: 4,
    logo: "/plugin-logos/hugging-face.svg",
    state: "connected",
  },
  {
    name: "Exa Search",
    tools: 2,
    logo: "/plugin-logos/exa-search.svg",
    state: "connected",
  },
  {
    name: "Context7",
    tools: 2,
    logo: "/plugin-logos/context7.svg",
    state: "connected",
  },
  {
    name: "DeepWiki",
    tools: 3,
    logo: "/plugin-logos/deepwiki.svg",
    state: "connected",
  },
  {
    name: "GitHub",
    tools: 0,
    logo: "/plugin-logos/github.svg",
    state: "attention",
  },
] as const;

/** How far the run has got, as whole steps, mapped onto each panel's state. */
function readRun(step: number) {
  const planDone = [0, 0, 0, 0, 1, 1, 2, 3, 4, 5, 5][Math.min(step, STEPS - 1)];
  const opsShown = Math.max(0, Math.min(step - 3, HERO_RUN.operations.length));
  const progress = step / (STEPS - 1);
  return {
    planDone,
    opsShown,
    tools: Math.min(
      HERO_RUN.totals.tools,
      Math.round(progress * HERO_RUN.totals.tools),
    ),
    added: Math.round(progress * HERO_RUN.totals.added),
    cost: progress * HERO_RUN.totals.cost,
    context: Math.round(progress * HERO_RUN.totals.context),
    live: step >= STEPS - 1,
  };
}

export function HeroWorkspace() {
  const reduceMotion = useReducedMotion();
  const [surface, setSurface] = useState<Surface>("build");
  const [step, setStep] = useState(0);
  const frameRef = useRef<HTMLDivElement | null>(null);
  // once: the run plays when it arrives and then stops, rather than restarting
  // every time the hero scrolls back past.
  const inView = useInView(frameRef, { once: true, amount: 0.35 });

  // Under reduced motion the run is shown finished. The reader still gets the
  // whole story; it simply does not animate itself into place. Derived during
  // render rather than pushed through an effect, which would be a second render
  // pass for a value already known.
  const settled = reduceMotion && inView;
  const shown = settled ? STEPS - 1 : step;

  useEffect(() => {
    if (!inView || reduceMotion) return;
    const timer = setInterval(() => {
      setStep((current) => {
        if (current >= STEPS - 1) {
          clearInterval(timer);
          return current;
        }
        return current + 1;
      });
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [inView, reduceMotion]);

  const run = readRun(shown);
  const replay = () => setStep(0);

  return (
    <div className="w-full">
      <div ref={frameRef} className="relative">
        {/* 6px bezel; the inner radius is the outer minus the padding so the
            corners stay concentric. */}
        <div className="rounded-[14px] border border-white/[0.05] bg-white/[0.015] p-1.5">
          {/* The product's OLED palette, scoped to the frame — without it the
              replica falls back to the default dark theme and paints its
              sidebar a blue-grey the app never uses. */}
          <div
            style={HERO_WORKSPACE_APPEARANCE}
            className="flex h-[520px] min-w-[1200px] overflow-hidden rounded-[11px] border border-white/[0.07] bg-background"
          >
            {/* Hack Workbench takes the whole window in the product, so it
                takes the whole frame here. Every other surface keeps the rail. */}
            {surface !== "workbench" ? (
              <Rail active={surface} onSelect={setSurface} />
            ) : null}
            {surface === "build" ? (
              <BuildSurface run={run} step={shown} />
            ) : surface === "studio" ? (
              <StudioSurface />
            ) : surface === "workbench" ? (
              <WorkbenchSurface onExit={() => setSurface("build")} />
            ) : surface === "agents" ? (
              <AgentsSurface />
            ) : surface === "tasks" ? (
              <TasksSurface />
            ) : surface === "plugins" ? (
              <PluginsSurface />
            ) : (
              <ArtifactSurface />
            )}
          </div>
        </div>

        {/* No gradient fades. The reference dissolves its mock into the page,
            but ours holds the plan and the operations at the right edge, and a
            wash over them read as a black bar cutting the panel in half. The
            frame ends at its own border, like a window. */}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <p className="text-[11px] text-[var(--cursor-text-secondary)]">
          A real run, transcribed — {HERO_RUN.durationLabel},{" "}
          {HERO_RUN.totals.tools} tools,{" "}
          <span className="text-emerald-400">+{HERO_RUN.totals.added}</span>{" "}
          lines, ${HERO_RUN.totals.cost.toFixed(2)}.
        </p>
        <button
          type="button"
          onClick={replay}
          className="rounded-[7px] border border-white/[0.09] px-2 py-0.5 text-[11px] font-medium text-[var(--cursor-text-secondary)] transition-colors hover:text-foreground motion-reduce:transition-none"
        >
          Replay
        </button>
      </div>
    </div>
  );
}

function Rail({
  active,
  onSelect,
}: {
  active: Surface;
  onSelect: (surface: Surface) => void;
}) {
  return (
    <div className="flex w-[268px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      {/* The header row the product ships: lockup on the left, the same three
          utilities on the right. */}
      <div className="flex h-11 items-center gap-2 px-3">
        <RiftLogo size={18} className="text-foreground" />
        <RiftWordmark
          decorative
          height={20}
          className="text-[13px] font-semibold tracking-[0.1em] text-foreground"
        />
        <span className="ml-auto flex items-center gap-2 text-[var(--cursor-icon-secondary)]">
          <Search aria-hidden className="size-[14px]" strokeWidth={1.5} />
          <Sun aria-hidden className="size-[14px]" strokeWidth={1.5} />
          <PanelLeft aria-hidden className="size-[14px]" strokeWidth={1.5} />
        </span>
      </div>

      <nav aria-label="Primary workspaces" className="space-y-0.5 px-2">
        <span className={sidebarNavRowClass(false)}>
          <Plus aria-hidden className="size-[14px]" strokeWidth={1.5} />
          New chat
        </span>
        {PRIMARY.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-current={active === item.id ? "page" : undefined}
            className={`${sidebarNavRowClass(active === item.id)} ${
              active === item.id ? "text-foreground" : ""
            }`}
          >
            <item.Icon aria-hidden className="size-[14px]" strokeWidth={1.5} />
            {item.label}
          </button>
        ))}
      </nav>

      <nav
        aria-label="Utilities"
        className="mx-2 space-y-0.5 border-t border-sidebar-border/70 pb-1 pt-1.5"
      >
        {UTILITIES.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-current={active === item.id ? "page" : undefined}
            className={`${sidebarNavRowClass(active === item.id)} ${
              active === item.id ? "text-foreground" : ""
            }`}
          >
            <item.Icon
              aria-hidden
              className="size-[14px] shrink-0"
              strokeWidth={1.5}
            />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="mt-2 px-2">
        <div className="flex h-[31px] items-center justify-between px-2">
          <span
            className={`flex items-center gap-1 ${SIDEBAR_SECTION_LABEL_CLASS}`}
          >
            <ChevronDown aria-hidden className="size-3" strokeWidth={1.5} />
            Projects
          </span>
          <Plus
            aria-hidden
            className="size-3 text-[var(--cursor-icon-secondary)]"
            strokeWidth={1.5}
          />
        </div>
        <span className={sidebarNavRowClass(false)}>
          <Folder aria-hidden className="size-[14px]" strokeWidth={1.5} />
          New project
        </span>
      </div>

      <div className="mt-1 min-h-0 flex-1 border-t border-sidebar-border/70 px-2 pt-1.5">
        <div className="flex h-[31px] items-center justify-between px-2">
          <span className={SIDEBAR_SECTION_LABEL_CLASS}>Recent</span>
          <ChevronDown
            aria-hidden
            className="size-3 text-[var(--cursor-icon-secondary)]"
            strokeWidth={1.5}
          />
        </div>
        {[
          HERO_RUN.artifact.name,
          "Bouncing balls, one file",
          "Rate limiter audit",
        ].map((title) => (
          <span
            key={title}
            className="flex h-[30px] items-center truncate px-2 text-[13px] font-[550] leading-[19.5px] tracking-[-0.1px] text-[var(--cursor-text-secondary)]"
          >
            {title}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The heading every full-page surface opens with — title, then the one-line
 * description the product puts under it.
 */
function PageHeader({ title, lede }: { title: string; lede: string }) {
  return (
    <div className="px-4 pb-2.5 pt-3">
      <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-foreground">
        {title}
      </h3>
      <p className="mt-1 max-w-[62ch] text-[11.5px] leading-4 text-[var(--cursor-text-secondary)]">
        {lede}
      </p>
    </div>
  );
}

/** Shared chrome so every surface reads as the same application. */
function SurfaceHeader({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
      <span className="text-[11.5px] font-medium text-foreground">{title}</span>
      {meta ? (
        <span className="ml-auto font-mono text-[10.5px] text-[var(--cursor-text-secondary)]">
          {meta}
        </span>
      ) : null}
    </div>
  );
}

function Appear({
  show,
  delay = 0,
  children,
}: {
  show: boolean;
  delay?: number;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        opacity: show ? 1 : 0,
        transform: show ? "translateY(0)" : "translateY(4px)",
        transition: `opacity 300ms ${EASE_OUT} ${delay}ms, transform 300ms ${EASE_OUT} ${delay}ms`,
      }}
      className="motion-reduce:!transform-none motion-reduce:!transition-none"
    >
      {children}
    </div>
  );
}

function BuildSurface({
  run,
  step,
}: {
  run: ReturnType<typeof readRun>;
  step: number;
}) {
  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <SurfaceHeader
          title={
            HERO_RUN.plan[Math.min(run.planDone, HERO_RUN.plan.length - 1)]
          }
        />
        <div className="min-h-0 flex-1 space-y-2.5 overflow-hidden px-3 py-3">
          <Appear show={step >= 0}>
            <p className="rounded-[8px] border border-white/[0.07] bg-white/[0.02] px-2.5 py-1.5 font-mono text-[11px] leading-[1.5] text-foreground/90">
              {HERO_RUN.task}
            </p>
          </Appear>

          <Appear show={step >= 1}>
            <p className="text-[10.5px] text-[var(--cursor-text-secondary)]">
              Thought for {HERO_RUN.thoughtSeconds}s
            </p>
            <p className="mt-1 text-[11.5px] leading-[1.55] text-foreground/80">
              {HERO_RUN.reasoning}
            </p>
          </Appear>

          <Appear show={step >= 2}>
            <ul className="space-y-1">
              {HERO_RUN.checklist.map((item, index) => (
                <li
                  key={item}
                  style={{
                    // The reference staggers list children by 8ms; at four rows
                    // that is a ripple rather than a queue.
                    transitionDelay: `${index * 8}ms`,
                  }}
                  className="flex gap-1.5 text-[11px] leading-[1.5] text-[var(--cursor-text-secondary)]"
                >
                  <span aria-hidden className="text-foreground/40">
                    ·
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </Appear>
        </div>

        {/* The composer, with the same context chips, mode toggle, model chip
            and reasoning meter the product puts under every conversation. */}
        <div className="px-3 pb-3">
          <div className="mb-1.5 flex items-center gap-2 text-[11px] text-[var(--cursor-text-secondary)]">
            <span className="flex items-center gap-1">
              <Folder aria-hidden className="size-3" strokeWidth={1.5} />
              ~/rift
            </span>
            <span aria-hidden className="text-muted-foreground/40">
              |
            </span>
            <span>No project</span>
          </div>
          <div className="rounded-[12px] border border-border bg-input/40 px-2.5 pb-1.5 pt-2">
            <p className="text-[12px] leading-5 text-[var(--cursor-text-tertiary)]">
              Plan, Build, / for commands, @ for context
            </p>
            <div className="mt-1.5 flex items-center gap-1.5">
              <Plus
                aria-hidden
                className="size-3.5 text-[var(--cursor-icon-secondary)]"
                strokeWidth={1.5}
              />
              <span className="rounded-[6px] bg-foreground px-1.5 py-0.5 text-[11px] font-medium text-background">
                Agent
              </span>
              <span className="px-1 text-[11px] text-[var(--cursor-text-secondary)]">
                Plan
              </span>
              <span className="ml-1 text-[11px] text-[var(--cursor-text-secondary)]">
                GPT-5.6 Sol
              </span>
              <span aria-hidden className="ml-1 flex items-center gap-[2px]">
                {[0, 1, 2, 3].map((index) => (
                  <span
                    key={index}
                    className={`h-[7px] w-[2px] rounded-[1px] ${index <= 1 ? "bg-foreground/70" : "bg-foreground/20"}`}
                  />
                ))}
              </span>
              <span className="text-[11px] text-[var(--cursor-text-secondary)]">
                Medium
              </span>
              <ArrowUp
                aria-hidden
                className="ml-auto size-3.5 text-[var(--cursor-icon-secondary)]"
                strokeWidth={1.5}
              />
            </div>
          </div>
        </div>
      </div>

      {/* The activity panel, rendered from the same tokens the product's own
          panel uses: the counters status line, the plan list with its status
          glyph column, the operations rows. */}
      <aside
        aria-label="Agent activity"
        className="flex w-[330px] shrink-0 flex-col border-l border-border/70 bg-background"
      >
        <div className="flex h-9 items-center border-b border-border/70 px-3">
          <span className="text-[12px] font-medium text-foreground">
            Agent Activity
          </span>
        </div>
        <div className={ACTIVITY_COUNTERS_ROW_CLASS}>
          <span className="flex items-center gap-1.5">
            agents
            <span className="tabular-nums text-foreground">
              {HERO_RUN.totals.agents}
            </span>
          </span>
          <span aria-hidden className="text-muted-foreground/30">
            ·
          </span>
          <span className="flex items-center gap-1.5">
            tools
            <span className="tabular-nums text-foreground">
              {run.tools}/{HERO_RUN.totals.tools}
            </span>
          </span>
          <span aria-hidden className="text-muted-foreground/30">
            ·
          </span>
          <span className="flex items-center gap-1.5">
            diff
            <span className="tabular-nums text-foreground">
              +{run.added}/−{HERO_RUN.totals.removed}
            </span>
          </span>
          <span className="ml-auto shrink-0 tabular-nums">{run.context}</span>
        </div>

        {/* The environment row the panel carries under its counters. */}
        <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/70 px-3 py-1.5 text-[10.5px] text-muted-foreground">
          {["Public web", "Sandbox e2b", "Computer not shared"].map((chip) => (
            <span key={chip} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-1 rounded-full bg-muted-foreground/50"
              />
              {chip}
            </span>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="border-b border-border/70">
            <div className="flex items-center justify-between px-4 pb-2 pt-3">
              <h3 className={ACTIVITY_SECTION_TITLE_CLASS}>Plan</h3>
              <span className={ACTIVITY_SECTION_COUNT_CLASS}>
                {run.planDone} / {HERO_RUN.plan.length}
              </span>
            </div>
            <ol className="px-2 pb-2">
              {HERO_RUN.plan.map((item, index) => {
                const status =
                  index < run.planDone
                    ? "completed"
                    : index === run.planDone && !run.live
                      ? "in_progress"
                      : "pending";
                return (
                  <li
                    key={item}
                    className={activityPlanRowClass(status)}
                    aria-current={status === "in_progress" ? "step" : undefined}
                  >
                    <span className={activityPlanIconClass(status)}>
                      <span aria-hidden className="text-[11px] leading-none">
                        {status === "completed" ? "✓" : "○"}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1 break-words">{item}</span>
                  </li>
                );
              })}
            </ol>
          </div>

          <div>
            <div className="flex items-center justify-between px-4 pb-2 pt-3">
              <h3 className={ACTIVITY_SECTION_TITLE_CLASS}>Operations</h3>
            </div>
            <ol className="px-3 pb-3">
              {HERO_RUN.operations
                .slice(0, run.opsShown)
                .map((operation, index, shown) => (
                  <li key={operation.kind + operation.detail}>
                    <div className={ACTIVITY_ROW_CLASS}>
                      <span className={ACTIVITY_ICON_CLASS}>
                        <Check className="size-[14px] stroke-[1]" aria-hidden />
                      </span>
                      <span className={ACTIVITY_LABEL_GROUP_CLASS}>
                        <span className={ACTIVITY_VERB_CLASS}>
                          {operation.kind}
                        </span>
                        <span
                          className={
                            operation.code
                              ? ACTIVITY_ARG_MONO_CLASS
                              : ACTIVITY_ARG_CLASS
                          }
                        >
                          {operation.detail}
                        </span>
                      </span>
                    </div>
                    {index < shown.length - 1 ? (
                      <div className={ACTIVITY_CONNECTOR_CLASS} aria-hidden>
                        <span className={ACTIVITY_CONNECTOR_TICK_CLASS} />
                      </div>
                    ) : null}
                  </li>
                ))}
            </ol>
          </div>
        </div>
      </aside>
    </div>
  );
}

function ArtifactSurface() {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <SurfaceHeader title="Artifacts" meta={HERO_RUN.sandboxUrl} />
      <div className="flex min-h-0 flex-1 gap-3 px-3 py-3">
        {/* Running, not pictured. */}
        <GravityLab className="min-w-0 flex-1" />
        <div className="w-[210px] shrink-0">
          <p className={ACTIVITY_SECTION_TITLE_CLASS}>index.html</p>
          <p className="mt-0.5 text-[11.5px] leading-4 text-[var(--cursor-text-secondary)]">
            One standalone file — no dependencies, no build step.
          </p>
          <dl className="mt-3 space-y-1.5">
            {[
              { label: "Written", value: `+${HERO_RUN.totals.added} lines` },
              { label: "Served on", value: "port 4173" },
              { label: "Run time", value: HERO_RUN.durationLabel },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-baseline justify-between gap-2"
              >
                <dt className="text-[11.5px] text-muted-foreground">
                  {item.label}
                </dt>
                <dd className="font-mono text-[11.5px] tabular-nums text-foreground">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[10.5px] leading-[1.45] text-muted-foreground">
            Rebuilt from the run&rsquo;s own spec — its sandbox has since
            expired. Click the canvas to add a body.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Studio: model library, the reference frame, and the selected model's card. */
function StudioSurface() {
  const [selected, setSelected] = useState(1);
  const model = STUDIO_MODELS[selected];
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        title="Studio"
        lede="Compare every model with a truthful capability map and an original, art-directed production reference."
      />
      <div className="flex min-h-0 flex-1 gap-0 overflow-hidden border-t border-border/70">
        <div className="flex w-[210px] shrink-0 flex-col border-r border-border/70">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-[12px] font-medium text-foreground">
              Model library
            </span>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {STUDIO_MODELS.length}
            </span>
          </div>
          <ul className="min-h-0 flex-1 overflow-hidden px-2">
            {STUDIO_MODELS.map((entry, index) => (
              <li key={entry.name}>
                <button
                  type="button"
                  onClick={() => setSelected(index)}
                  aria-current={index === selected ? "true" : undefined}
                  className={`flex w-full items-center gap-2 rounded-[9px] px-1.5 py-1.5 text-left transition-colors motion-reduce:transition-none ${
                    index === selected
                      ? "bg-foreground/[0.06]"
                      : "hover:bg-foreground/[0.035]"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={entry.thumb}
                    alt=""
                    className="size-8 shrink-0 rounded-[6px] object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-foreground">
                      {entry.name}
                    </span>
                    <span className="block truncate text-[10.5px] text-muted-foreground">
                      {entry.tier}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative min-w-0 flex-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={model.hero}
            src={model.hero}
            alt={`${model.name} production reference`}
            className="size-full object-cover"
            loading="lazy"
            decoding="async"
          />
          <span className="absolute left-3 top-3 rounded-[7px] bg-black/60 px-2 py-1 text-[10.5px] text-white/85 backdrop-blur-sm">
            Original cinematic reference
          </span>
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-3 pb-3 pt-10">
            <p className="text-[10.5px] text-white/60">{model.title}</p>
            <p className="text-[15px] font-semibold text-white">{model.name}</p>
            <p className="mt-0.5 text-[11px] text-white/70">{model.note}</p>
          </div>
        </div>

        <div className="flex w-[212px] shrink-0 flex-col border-l border-border/70 px-3 py-2">
          <p className="text-[11px] text-muted-foreground">Selected model</p>
          <p className="mt-0.5 text-[13px] font-medium text-foreground">
            {model.name}
          </p>
          <dl className="mt-2 space-y-0">
            {[
              ["Execution", "Ask"],
              ["Resolution", "1K / 2K / 4K"],
              ["Framing", "9 ratios"],
              ["References", "Up to 14"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-baseline justify-between border-b border-border/70 py-1.5 text-[11.5px] last:border-b-0"
              >
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
            Images run in Ask for fast iteration and stay attached to the
            conversation.
          </p>
          <span className="mt-auto flex items-center gap-1.5 text-[11.5px] text-[var(--success)]">
            <Check aria-hidden className="size-3" strokeWidth={2} />
            Runtime ready
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Hack Workbench, which is not a panel inside the workspace — it takes the
 * whole window, with its own titlebar, its own monospace art direction and a
 * way back to the app. The replica does the same: selecting it in the rail
 * replaces the frame rather than filling a column, because that is what the
 * product does.
 */
function WorkbenchSurface({ onExit }: { onExit: () => void }) {
  return (
    <div className={WORKBENCH_SURFACE_CLASS}>
      <WorkbenchTitleBar onExit={onExit} />
      <WorkbenchScopeBar
        target={WORKBENCH.target}
        state="Ready"
        elapsed="00:08"
      />
      <WorkbenchCards cards={WORKBENCH.cards} />
      <WorkbenchTabRow path="~/security/discover" lines={0} findings={0} />

      <div className="min-h-0 flex-1 px-3 pt-4">
        <div className="flex items-start justify-between">
          <span className="flex items-center gap-1.5 font-mono text-[9px] tracking-[0.14em] text-white/45">
            <span aria-hidden className="size-1.5 bg-[#7fb0e8]" />
            AUTHORIZED SCOPE
          </span>
          <span className="font-mono text-[10px] text-white/45">
            {WORKBENCH.target}
          </span>
        </div>
        <p className="mt-3 text-[15px] font-semibold text-white">
          What should RIFT assess?
        </p>
        <p className="mt-1.5 max-w-[62ch] text-[11.5px] leading-4 text-white/60">
          Choose a task from the left or write a request below. RIFT will plan
          the work, run tools in an isolated terminal, and turn the verified
          evidence into a clear report.
        </p>
      </div>

      <div className="mx-3 mb-1.5 flex items-center gap-2 rounded-[7px] border border-white/10 bg-black/50 px-2 py-1.5">
        <span className="font-mono text-[10px] text-white/35">&rsaquo;</span>
        <span className="font-mono text-[11px] text-white/40">
          Ask RIFT to assess the authorized scope…
        </span>
        <span className="ml-auto font-mono text-[9.5px] text-white/45">
          RIFT · high
        </span>
      </div>
      <WorkbenchStatusBar target={WORKBENCH.target} />
    </div>
  );
}

/**
 * Agents: the whole roster, not a sample.
 *
 * This showed six because six ship enabled by default, which quietly told a
 * reader that six is what they get. The catalog is 29 archetypes, every one
 * selectable, so all 29 are here at portrait size with their names under them.
 * No cards: at this count a border around each one turns a crew into a
 * spreadsheet, and the portraits are already the thing worth looking at.
 */
function AgentsSurface() {
  const [lead, setLead] = useState(0);
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        title="Agents"
        lede="Configure real Build participants, capability packs, permissions, and team handoffs."
      />
      <div className="min-h-0 flex-1 overflow-hidden border-t border-border/70 px-4 py-3">
        <div className="flex items-baseline justify-between">
          <p className="text-[12px] font-medium text-foreground">
            Professional archetypes
          </p>
          <p className="text-[11px] text-muted-foreground">
            {AGENT_PET_CATALOG.length} available ·{" "}
            {AGENT_PET_CATALOG[lead].petName} leads
          </p>
        </div>
        <ul className="mt-2.5 grid grid-cols-[repeat(10,minmax(0,1fr))] gap-x-1 gap-y-2.5">
          {AGENT_PET_CATALOG.map((agent, index) => (
            <li key={agent.id}>
              <button
                type="button"
                onClick={() => setLead(index)}
                title={`${agent.petName} · ${agent.roleName}`}
                className="flex w-full flex-col items-center gap-1 rounded-[8px] px-0.5 py-1 transition-colors hover:bg-foreground/[0.05] motion-reduce:transition-none"
              >
                <AgentPetAvatar
                  accent={agent.accent}
                  agentName={agent.petName}
                  role={agent.visualPreset}
                  roleName={agent.roleName}
                  selected={index === lead}
                  size={26}
                />
                <span
                  className={`w-full truncate text-center text-[9.5px] leading-3 ${
                    index === lead ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {agent.petName}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Tasks: durable instructions and their run history. */
function TasksSurface() {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        title="Tasks"
        lede="Durable instructions, automatic schedules, and real run history in one place."
      />
      <div className="min-h-0 flex-1 overflow-hidden border-t border-border/70 px-4 py-3">
        <div className="inline-flex rounded-[9px] border border-border/70 p-0.5">
          {[
            ["All", "3"],
            ["Scheduled", "2"],
            ["Completed", "1"],
          ].map(([label, count], index) => (
            <span
              key={label}
              className={`flex items-center gap-1.5 rounded-[7px] px-2.5 py-1 text-[11.5px] ${
                index === 0
                  ? "bg-foreground/[0.07] text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              {label}
              <span className="tabular-nums text-muted-foreground">
                {count}
              </span>
            </span>
          ))}
        </div>
        <ul className="mt-3 overflow-hidden rounded-[10px] border border-border/70">
          {[
            {
              name: "Nightly dependency audit",
              when: "Every day · 03:00",
              state: "Scheduled",
            },
            {
              name: "Weekly changelog draft",
              when: "Mondays · 09:00",
              state: "Scheduled",
            },
            {
              name: "Rebuild pricing fixtures",
              when: "Ran 2h ago · 41s",
              state: "Completed",
            },
          ].map((task) => (
            <li
              key={task.name}
              className="flex items-center gap-2 border-b border-border/70 px-3 py-2 last:border-b-0"
            >
              <ListTodo
                aria-hidden
                className="size-3.5 shrink-0 text-[var(--cursor-icon-secondary)]"
                strokeWidth={1.5}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-foreground">
                  {task.name}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {task.when}
                </span>
              </span>
              <span
                className={`shrink-0 rounded-[6px] px-1.5 py-0.5 text-[10.5px] ${
                  task.state === "Completed"
                    ? "bg-[var(--success)]/12 text-[var(--success)]"
                    : "bg-foreground/[0.06] text-[var(--cursor-text-secondary)]"
                }`}
              >
                {task.state}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Plugins: connected providers, with the logos the product actually ships. */
function PluginsSurface() {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        title="Plugins"
        lede="Connect trusted provider tools once, inspect what was verified, and use them in compatible RIFT sessions."
      />
      <div className="min-h-0 flex-1 overflow-hidden border-t border-border/70 px-4 py-3">
        <div className="flex items-baseline justify-between">
          <p className="text-[12px] font-medium text-foreground">Connections</p>
          <p className="text-[11px] text-muted-foreground">
            5 connected · 1 attention
          </p>
        </div>
        <ul className="mt-2 grid grid-cols-2 gap-x-3">
          {PLUGIN_ROWS.map((plugin) => (
            <li
              key={plugin.name}
              className="flex h-11 items-center gap-2.5 rounded-[12px] px-1"
            >
              <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/[0.08] bg-white/[0.04]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={plugin.logo}
                  alt=""
                  className="size-4 object-contain"
                  loading="lazy"
                  decoding="async"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium tracking-[-0.1px] text-foreground">
                  {plugin.name}
                </span>
                <span className="block truncate text-[10.5px] text-muted-foreground">
                  {plugin.tools} tools
                </span>
              </span>
              <span
                className={`shrink-0 rounded-[6px] px-1.5 py-0.5 text-[10.5px] ${
                  plugin.state === "attention"
                    ? "bg-amber-500/12 text-amber-300"
                    : "bg-[var(--success)]/12 text-[var(--success)]"
                }`}
              >
                {plugin.state === "attention" ? "Needs attention" : "Connected"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
