"use client";

import { RiftWordmark } from "@/components/icons/rift-wordmark";
import Image from "next/image";
import { DEMO_IMAGE_MODEL_LABEL } from "@/lib/landing/demo-image";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowUp,
  Blocks,
  Bot,
  Check,
  ChevronRight,
  FileDiff,
  Hammer,
  ImageIcon,
  Images,
  ListTodo,
  PanelLeft,
  Plus,
  Search,
  ShieldCheck,
  SquareTerminal,
  Sun,
  Terminal,
} from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import {
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
  type PlanStepStatus,
} from "@/lib/ui/workspace-chrome";

import { Figma, Github, Notion, Vercel } from "@lobehub/icons";

import { CursorActivityGlyph } from "@/components/ui/cursor-thinking";

import { AgentPetAvatar } from "@/app/components/agents/AgentPetAvatar";
import { RiftLogo } from "@/components/icons/rift-logo";
import { AGENT_PET_CATALOG } from "@/lib/ai/agents/pet-roster";

import { DURATION, EASE_OUT, MICRO } from "./landing-design-system";
import { useLandingScrollContainer } from "./LandingShell";
import { HackWorkbenchMini } from "./HackWorkbenchMini";
import { ProductFrame } from "./ProductFrame";
import {
  BUILD_RUNS,
  STUDIO_MODELS,
  STUDIO_SHOTS,
  PLUGINS,
  TASKS,
  WORKBENCH_FINDINGS,
  WORKBENCH_LINES,
  WORKBENCH_TARGET,
  routePrompt,
  type Op,
  type Run,
  type SurfaceId,
} from "./mini-app-surfaces";

/**
 * A working RIFT, small enough to fit in a section.
 *
 * The page used to argue for the product with three screenshots. A screenshot
 * is stale the day the chrome changes, it cannot be operated, and a reader has
 * no way to tell it apart from a mockup — which is the one thing a landing page
 * for a developer tool cannot afford.
 *
 * This is the interface instead. The sidebar is not a drawing of the product's
 * sidebar: it is the same 279px column, the same 32px rows on a 33px pitch, the
 * same 13px/18px labels and 18px icons at 1px stroke, because the classes come
 * from lib/ui/workspace-chrome.ts — the module the application itself renders
 * from. Change the row height in the product and it changes here on the same
 * commit. Nothing to re-capture, and no way for the two to drift.
 *
 * Every surface in the sidebar works. Build runs an agent loop, Studio renders
 * a queue, the Workbench streams an assessment, Agents is a selectable roster
 * and Tasks is a list you can tick. The runs are prepared rather than live,
 * which the caption under the frame says plainly.
 */

/* ── Timing ───────────────────────────────────────────────────────────── */

const OP_INTERVAL_MS = 620;
const THINK_MS = 900;
const LINE_INTERVAL_MS = 380;
const SHOT_INTERVAL_MS = 520;

type Phase = "idle" | "thinking" | "working" | "done";

const OP_ICON = {
  search: Search,
  term: Terminal,
  diff: FileDiff,
  image: ImageIcon,
  shield: ShieldCheck,
  check: Check,
} as const;

/** Primary workspaces, in the product's own order. */
const NAV: readonly { id: SurfaceId; label: string; Icon: typeof Hammer }[] = [
  { id: "build", label: "Build", Icon: Hammer },
  { id: "studio", label: "Studio", Icon: Images },
  { id: "workbench", label: "Hack Workbench", Icon: SquareTerminal },
];

/** The second group, below the rule — same split the application uses. */
const NAV_SECONDARY: readonly {
  id: SurfaceId;
  label: string;
  Icon: typeof Hammer;
}[] = [
  { id: "agents", label: "Agents", Icon: Bot },
  { id: "tasks", label: "Tasks", Icon: ListTodo },
  { id: "plugins", label: "Plugins", Icon: Blocks },
];

/**
 * Eight of the twenty-nine archetypes, taken from the product's own catalog.
 *
 * The portraits are drawn by AgentPetAvatar — the same component the
 * application renders in its Agents screen — so the crew on the landing page
 * is the crew in the product, with the same faces and the same accents. A
 * hand-written list here would be a second source of truth that drifts.
 */
const ROSTER = AGENT_PET_CATALOG.slice(0, 8);

/** Vendor marks for the MCP rows. */
const PLUGIN_LOGO = {
  github: Github,
  figma: Figma,
  notion: Notion,
  vercel: Vercel,
} as const;

/** Build's own composer routes through the same scorer as the hero. */
function pickRun(text: string): Run {
  const route = routePrompt(text);
  return route.run ?? BUILD_RUNS[0];
}

/* ── Parts ────────────────────────────────────────────────────────────── */

/** A number that counts up to its value rather than appearing at it. */
function Counter({
  value,
  active,
  reduceMotion,
}: {
  value: number;
  active: boolean;
  reduceMotion: boolean;
}) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    // Nothing is written to state synchronously here: the idle and
    // reduced-motion cases are derived below instead.
    if (!active || reduceMotion) return;

    let frame = 0;
    const steps = 18;
    const timer = setInterval(() => {
      frame += 1;
      const t = frame / steps;
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (frame >= steps) clearInterval(timer);
    }, 26);
    return () => clearInterval(timer);
  }, [active, value, reduceMotion]);

  const display = !active ? 0 : reduceMotion ? value : shown;
  return <span className="tabular-nums">{display}</span>;
}

/** The operation trace, revealed one row at a time. */
function Trace({
  ops,
  count,
  reduceMotion,
  keyPrefix,
}: {
  ops: readonly Op[];
  count: number;
  reduceMotion: boolean;
  keyPrefix: string;
}) {
  return (
    <AnimatePresence initial={false}>
      {ops.slice(0, count).map((op, index) => {
        const Icon = OP_ICON[op.icon];
        return (
          <motion.div
            key={`${keyPrefix}-${index}`}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DURATION.control, ease: EASE_OUT }}
          >
            {index > 0 && (
              <div className={ACTIVITY_CONNECTOR_CLASS}>
                <span className={ACTIVITY_CONNECTOR_TICK_CLASS} />
              </div>
            )}
            <div className={ACTIVITY_ROW_CLASS}>
              <span className={ACTIVITY_ICON_CLASS}>
                <Icon aria-hidden className="size-[14px]" strokeWidth={1} />
              </span>
              <span className={ACTIVITY_LABEL_GROUP_CLASS}>
                <span className={ACTIVITY_VERB_CLASS}>{op.verb}</span>
                <span className={ACTIVITY_ARG_MONO_CLASS}>{op.arg}</span>
              </span>
            </div>
          </motion.div>
        );
      })}
    </AnimatePresence>
  );
}

/** A step row in the right-hand panel, in either of its two states. */
function StepRow({
  status,
  children,
}: {
  status: PlanStepStatus;
  children: string;
}) {
  return (
    <div className={activityPlanRowClass(status)}>
      <span className={activityPlanIconClass(status)}>
        {status === "completed" ? (
          <Check aria-hidden className="size-3" strokeWidth={2} />
        ) : (
          <span
            className={`size-1.5 rounded-full ${
              status === "in_progress"
                ? "bg-foreground"
                : "bg-current opacity-40"
            }`}
          />
        )}
      </span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function PanelHead({ title, count }: { title: string; count?: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className={ACTIVITY_SECTION_TITLE_CLASS}>{title}</span>
      {count ? (
        <span className={ACTIVITY_SECTION_COUNT_CLASS}>{count}</span>
      ) : null}
    </div>
  );
}

/* ── The app ──────────────────────────────────────────────────────────── */

/** What the hero can ask this frame to do. */
export type MiniAppHandle = { run: (text: string) => void };

/**
 * How this frame is being used on the page.
 *
 * The hero renders the whole workstation — every surface, every tab, driven by
 * the hero's own input. The Studio and Workbench sections render the same
 * component focused on one surface with the tab strip off, so each section
 * gets a real, operable instance of that tool rather than a picture of it.
 *
 * One component for all three rather than three: a second implementation of
 * Studio written for the marketing page is a second thing to keep true, and it
 * would be wrong the first time the real Studio changed.
 */
export type MiniAppProps = {
  /** The surface to open on. Defaults to Build. */
  initialSurface?: SurfaceId;
  /**
   * Whether this instance carries the workstation's sidebar.
   *
   * On for the hero frame, which is the whole product; off for the focused
   * Studio and Workbench instances, which are one surface each.
   *
   * There used to be a tab strip welded to the frame's top edge as well —
   * databuddy.cc's device, and a good one for a marketing page. It came out
   * because the product does not have it: RIFT navigates from the sidebar, and
   * a frame that claims to be the application cannot invent a control the
   * application has never had.
   */
  showSidebar?: boolean;
  /** Off for the focused instances; the hero's frame is the one that demos. */
  autoDemo?: boolean;
  caption?: string;
  note?: string;
  /** "bare" for hosts that draw their own frame. See ProductFrame. */
  variant?: "mat" | "bare";
};

export const RiftMiniApp = forwardRef<MiniAppHandle, MiniAppProps>(
  function RiftMiniApp(
    {
      initialSurface = "build",
      showSidebar = true,
      autoDemo = true,
      // "The product, running ·" was a category label in front of the only half
      // that told the reader anything. What is left is the affordance: this frame
      // is not a screenshot, and you can use it.
      caption = "Type into it, or pick a surface",
      note = "Built from the application’s own chrome · ask it something and the plan and the answer are written live",
      variant = "mat",
    },
    ref,
  ) {
    const reduceMotion = useReducedMotion() ?? false;
    const scrollContainer = useLandingScrollContainer();
    const [surface, setSurface] = useState<SurfaceId>(initialSurface);

    /* Build */
    const [value, setValue] = useState("");
    const [run, setRun] = useState<Run>(BUILD_RUNS[0]);
    const [phase, setPhase] = useState<Phase>("idle");
    const [opCount, setOpCount] = useState(0);

    /* Studio */
    const [model, setModel] = useState<string>(STUDIO_MODELS[0]);
    /**
     * Studio opens on its finished state, not on an empty one.
     *
     * Starting at 0 meant the surface's resting appearance was three black
     * rectangles and a queue reading "0 / 3", and it stayed that way whenever
     * the auto-start did not fire — an observer that never triggered, a tab
     * that was backgrounded when the frame scrolled past, `touched` already
     * latched by an earlier interaction. A reveal that fails closed leaves a
     * reader looking at a product that appears broken, and this one failed
     * closed twice in review.
     *
     * Starting at the full count inverts that: the reveal is now something the
     * run takes *away* and gives back, so the worst case is a finished render
     * wall rather than an empty one. `startRender` still sets it to 0 and
     * stages the reveal whenever it actually runs. Same principle as
     * FAIL_OPEN_MS in landing-v2/use-in-view.ts.
     */
    const [shotCount, setShotCount] = useState(STUDIO_SHOTS.length);
    const [rendering, setRendering] = useState(false);

    /* Workbench */
    const [lineCount, setLineCount] = useState(0);
    const [scanning, setScanning] = useState(false);

    /* Agents */
    const [agent, setAgent] = useState(0);

    /**
     * A plan the model wrote for this visitor's prompt.
     *
     * Null means "use the prepared run's plan". The endpoint plans and nothing
     * else — no sandbox is opened — so the operation trace below stays the
     * prepared one either way, and the caption says which half is which.
     */
    const [livePlan, setLivePlan] = useState<{
      reply: string;
      answer: string;
      steps: string[];
    } | null>(null);

    /**
     * The lines a real probe returned, when one ran.
     *
     * Null means the prepared trace. The Workbench frame asks the server for
     * one live reconnaissance pass the first time it runs — a fixed,
     * operator-authorised target, once per visitor per day — and swaps the
     * replayed lines for whatever actually came back. When the limit is spent
     * or the network refuses, the prepared trace stays and the caption already
     * says which is which.
     */
    const [liveProbe, setLiveProbe] = useState<string[] | null>(null);

    /** The findings the probe actually derived, when one ran. */
    const [liveFindings, setLiveFindings] = useState<
      { title: string; detail: string }[] | null
    >(null);

    /** Set when this visitor's daily pass is already spent. */
    const [probeSpent, setProbeSpent] = useState(false);

    /** True while a real model call is in flight for the current prompt. */
    const [answering, setAnswering] = useState(false);

    /* Studio's one real render. */
    const [shotPrompt, setShotPrompt] = useState("");
    const [rendered, setRendered] = useState<{
      dataUrl: string;
      prompt: string;
    } | null>(null);
    const [renderState, setRenderState] = useState<
      "idle" | "working" | "spent" | "failed"
    >("idle");

    /**
     * Set when the server refuses because this visitor has spent their share.
     *
     * Without it the frame silently fell back to the prepared run while the
     * caption underneath still promised the plan was written live — which is
     * the page telling a reader something untrue about what they are looking
     * at. Now it says which one they got.
     */
    const [spent, setSpent] = useState(false);

    /* Plugins */
    const [plugins, setPlugins] = useState(() =>
      PLUGINS.map((p) => ({ ...p })),
    );

    /* Tasks */
    const [tasks, setTasks] = useState(() =>
      TASKS.map((task) => ({ ...task })),
    );

    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
    const clearTimers = useCallback(() => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    }, []);
    useEffect(() => clearTimers, [clearTimers]);

    /**
     * Whether the visitor has done anything in this frame yet.
     *
     * Set by every entry point below, and read once by the self-demo effect so
     * the frame never starts playing on top of somebody who is already using
     * it. A ref rather than state: nothing renders from it.
     */
    const touched = useRef(false);
    const markTouched = useCallback(() => {
      touched.current = true;
    }, []);

    const startRun = useCallback(
      (
        text: string,
        live?: { reply: string; answer: string; steps: string[] } | null,
      ) => {
        const next = pickRun(text);
        markTouched();
        clearTimers();
        setRun(next);
        setLivePlan(live ?? null);
        setOpCount(0);
        setPhase("thinking");
        const think = reduceMotion ? 0 : THINK_MS;
        const step = reduceMotion ? 0 : OP_INTERVAL_MS;
        timers.current.push(
          setTimeout(() => setPhase("working"), think),
          ...next.ops.map((_, index) =>
            setTimeout(() => setOpCount(index + 1), think + step * (index + 1)),
          ),
          setTimeout(
            () => setPhase("done"),
            think + step * (next.ops.length + 1),
          ),
        );
      },
      [clearTimers, markTouched, reduceMotion],
    );

    /**
     * Render one real image.
     *
     * Studio's queue below replays three prepared stills; this is the frame's
     * one genuine render, and the only thing on this page that spends money —
     * $0.04 a call at a hard daily ceiling, see lib/landing/demo-image.ts. It
     * takes about three and a half seconds measured against the provider, so
     * the surface says it is working rather than freezing on a dead button.
     *
     * Refused, out of budget or broken: the prepared stills stay and the frame
     * says which one the visitor is looking at. It never shows an error where
     * a picture should be.
     */
    const renderReal = useCallback(
      (prompt: string) => {
        markTouched();
        setRenderState("working");
        void fetch("/api/landing-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
        })
          .then(async (response) => {
            const data = await response.json().catch(() => null);
            if (response.ok && data?.ok && typeof data.dataUrl === "string") {
              setRendered({ dataUrl: data.dataUrl, prompt });
              setRenderState("idle");
              return;
            }
            setRenderState(response.status === 429 ? "spent" : "failed");
          })
          .catch(() => setRenderState("failed"));
      },
      [markTouched],
    );

    const startRender = useCallback(() => {
      markTouched();
      clearTimers();
      setShotCount(0);
      setRendering(true);
      const step = reduceMotion ? 0 : SHOT_INTERVAL_MS;
      timers.current.push(
        ...STUDIO_SHOTS.map((_, index) =>
          setTimeout(() => setShotCount(index + 1), step * (index + 1)),
        ),
        setTimeout(() => setRendering(false), step * (STUDIO_SHOTS.length + 1)),
      );
    }, [clearTimers, markTouched, reduceMotion]);

    /**
     * How many reveal timers a scan schedules.
     *
     * Not `WORKBENCH_LINES.length`. The scan starts before the live probe has
     * answered, so at schedule time the run does not yet know how many lines
     * it will have — and a real pass returns thirteen against the prepared
     * eight. Sized to the prepared list, the reveal stopped at eight and the
     * last five live lines, which are every one of the header findings, never
     * appeared. Timers past the end of the array are harmless: `slice` caps
     * the render and the completion check reads the array's own length.
     */
    const SCAN_REVEAL_STEPS = 20;

    const startScan = useCallback(() => {
      markTouched();
      clearTimers();

      // Ask for a real pass. It resolves in under a second in practice, well
      // inside the replay, so the live lines are usually on screen before the
      // prepared ones would have finished. If it is refused or slow, nothing
      // waits on it.
      void fetch("/api/landing-probe", { method: "POST" })
        .then((response) => {
          if (response.status === 429) {
            setProbeSpent(true);
            return null;
          }
          return response.ok ? response.json() : null;
        })
        .then((data) => {
          if (!data?.ok || !Array.isArray(data.lines)) return;
          setLiveProbe(
            data.lines
              .map((line: { text?: unknown }) =>
                typeof line?.text === "string" ? line.text : null,
              )
              .filter((line: string | null): line is string => Boolean(line)),
          );
          if (Array.isArray(data.findings)) setLiveFindings(data.findings);
        })
        .catch(() => {});

      setLineCount(0);
      setScanning(true);
      const step = reduceMotion ? 0 : LINE_INTERVAL_MS;
      timers.current.push(
        ...Array.from({ length: SCAN_REVEAL_STEPS }, (_, index) =>
          setTimeout(() => setLineCount(index + 1), step * (index + 1)),
        ),
        setTimeout(() => setScanning(false), step * (SCAN_REVEAL_STEPS + 1)),
      );
    }, [clearTimers, markTouched, reduceMotion]);

    /**
     * Ask the server for a real plan and a real answer.
     *
     * Fire-and-forget alongside the prepared run, never in front of it: the
     * frame reacts on the same frame as the click and the model's words swap in
     * when they land. A spinner here would make the fastest part of the product
     * look like the slowest.
     *
     * Rate limited, offline or refused: the prepared plan is already on screen
     * and stays there. The caption under the frame says which half is live.
     */
    const requestLivePlan = useCallback((text: string) => {
      setAnswering(true);
      setSpent(false);
      void fetch("/api/landing-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, surface: "build" }),
      })
        .then((response) => {
          if (response.status === 429) {
            setSpent(true);
            return null;
          }
          return response.ok ? response.json() : null;
        })
        .then((data) => {
          if (!data?.ok || !Array.isArray(data.steps)) return;
          setLivePlan({
            reply: data.reply,
            answer: typeof data.answer === "string" ? data.answer : "",
            steps: data.steps,
          });
        })
        .catch(() => {})
        .finally(() => setAnswering(false));
    }, []);

    /**
     * What the hero can ask this frame to do.
     *
     * The hero's input is the page's first control, and a visitor who types into
     * it expects something to happen here rather than being scrolled to a second
     * box they have to fill in again. An imperative handle rather than a watched
     * prop: a prop would need an effect to notice it changed, and setting state
     * synchronously inside an effect schedules a second render before the browser
     * paints. This is a command, so it is modelled as one.
     */
    useImperativeHandle(
      ref,
      () => ({
        run(text: string) {
          const route = routePrompt(text);
          setSurface(route.surface);

          if (route.surface === "workbench") {
            startScan();
            return;
          }
          if (route.surface === "studio") {
            startRender();
            return;
          }

          setValue(text);
          // Start on the prepared plan immediately so the frame reacts on the
          // same frame as the click, then swap in the model's plan when it
          // lands. A spinner while a completion streams would make the fastest
          // part of the product look like the slowest.
          startRun(text);

          requestLivePlan(text);
        },
      }),
      [requestLivePlan, startRender, startRun, startScan],
    );

    /**
     * The frame starts itself when the reader arrives at it.
     *
     * On a timer from mount this was worse than useless: the Studio and
     * Workbench instances are 3,592px and 6,000px down the page, so their runs
     * finished about a second after load and were long over by the time anyone
     * scrolled to them — the reader met a queue reading "0 / 3" and three
     * renders sitting at 20% opacity, which looks like a broken screenshot
     * rather than a product.
     *
     * So it waits for the frame to actually be on screen. One shot: `started`
     * latches, and any interaction sets `touched` first, so a reader who is
     * already using the frame never has it start something underneath them.
     */
    const viewRef = useRef<HTMLDivElement>(null);
    const started = useRef(false);

    useEffect(() => {
      const node = viewRef.current;
      if (!node) return;

      const begin = () => {
        if (started.current || touched.current) return;
        started.current = true;
        if (surface === "studio") startRender();
        else if (surface === "workbench") startScan();
        else if (autoDemo) startRun(BUILD_RUNS[0].prompt);
      };

      // A beat after the frame lands, so its own entrance reads first and the
      // two motions are a sequence rather than one busy moment.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          observer.disconnect();
          timer = setTimeout(begin, reduceMotion ? 0 : 700);
        },
        // `root` for the same reason every observer on this page needs it: the
        // document does not scroll, its container does.
        { root: scrollContainer?.current ?? null, threshold: 0.25 },
      );
      observer.observe(node);

      return () => {
        observer.disconnect();
        if (timer) clearTimeout(timer);
      };
      // Mount only: this is a first-impression demo, not a reaction to state.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const goTo = useCallback(
      (next: SurfaceId) => {
        markTouched();
        clearTimers();
        // Leaving a build run mid-flight used to freeze it: the timers were
        // cleared but the phase stayed "working", so coming back showed a run
        // stopped halfway with no way to finish it. Settle it instead — a run
        // that was still thinking goes back to idle, one that had started
        // working is completed.
        if (phase === "thinking") {
          setPhase("idle");
        } else if (phase === "working") {
          setOpCount(run.ops.length);
          setPhase("done");
        }
        setSurface(next);
        if (next === "studio" && shotCount === 0) startRender();
        if (next === "workbench" && lineCount === 0) startScan();
      },
      [
        clearTimers,
        lineCount,
        markTouched,
        phase,
        run.ops.length,
        shotCount,
        startRender,
        startScan,
      ],
    );

    const running = phase !== "idle";

    /** The probe's own lines when one ran, the prepared trace otherwise. */
    const scanLines = liveProbe?.length ? liveProbe : WORKBENCH_LINES;

    /**
     * The findings panel's rows.
     *
     * A real pass derives these from what the host actually returned — a
     * disclosed `Server:` banner, a missing CSP, a certificate about to
     * expire — so they change when the operator changes the host. The prepared
     * set is the fallback for a visitor whose daily run is already spent, and
     * it is shaped the same way so the panel does not have two layouts.
     */
    const workbenchFindings = liveFindings?.length
      ? liveFindings
      : WORKBENCH_FINDINGS.map((finding) => {
          const [title, ...rest] = finding.text.split(" — ");
          return {
            title: title.trim(),
            detail: rest.join(" — ").trim() || finding.severity,
          };
        });

    const scanFindings = liveFindings?.length
      ? liveFindings.map((finding) => ({
          key: `${finding.title}-${finding.detail}`,
          text: `${finding.title} · ${finding.detail}`,
          strong: !/Missing security header/i.test(finding.title),
        }))
      : WORKBENCH_FINDINGS.map((finding) => ({
          key: finding.text,
          text: finding.text,
          strong: finding.severity === "medium",
        }));

    /** The live plan when the model wrote one, the prepared plan otherwise. */
    const planSteps = livePlan?.steps.length ? livePlan.steps : run.plan;

    const planStatus = useCallback(
      (index: number): PlanStepStatus => {
        if (phase === "done") return "completed";
        if (phase !== "working") return "pending";
        const reached = Math.ceil(
          (opCount / run.ops.length) * planSteps.length,
        );
        if (index < reached - 1) return "completed";
        if (index === reached - 1) return "in_progress";
        return "pending";
      },
      [opCount, phase, run.ops.length, planSteps.length],
    );

    const planDone = useMemo(
      () =>
        planSteps.filter((_, index) => planStatus(index) === "completed")
          .length,
      [planStatus, planSteps],
    );

    const doneTasks = tasks.filter((task) => task.done).length;

    /* ── Centre ── */

    const centre = () => {
      switch (surface) {
        case "build":
          return (
            <div className="flex min-h-0 flex-1 flex-col justify-center gap-3 p-4">
              {running ? (
                <div className="flex flex-col gap-3">
                  <p className="rounded-[8px] border border-border bg-background/60 px-3 py-2 text-[13px] leading-[1.6] text-foreground">
                    {value || run.prompt}
                  </p>
                  {phase === "thinking" ? (
                    /*
                     * The product's own reasoning row, not an approximation of
                     * it. The glyph is CursorActivityGlyph itself — the braille
                     * spinner that cycles at 80ms and settles to a diamond —
                     * imported rather than redrawn, and the rest of the row is
                     * components/ai-elements/reasoning.tsx's ReasoningTrigger,
                     * class for class: min-h-6, mono 12px on a 20px line, the
                     * secondary text colour, and a chevron that points right
                     * while the run is collapsed.
                     *
                     * A page claiming to show the application cannot invent the
                     * one row a reader watches for the whole time it thinks.
                     */
                    <p className="flex min-h-6 w-full items-center gap-1.5 py-0.5 text-left font-mono text-[12px] font-normal leading-5 text-[var(--cursor-text-secondary)]">
                      <CursorActivityGlyph
                        active
                        className="text-[var(--cursor-text-secondary)]"
                      />
                      <span className="flex min-w-0 items-baseline gap-1 truncate">
                        <span className="truncate">Thinking</span>
                      </span>
                      <ChevronRight
                        aria-hidden
                        className="size-3 shrink-0 text-muted-foreground"
                      />
                    </p>
                  ) : (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: DURATION.control }}
                      className="flex flex-col gap-2.5"
                    >
                      <p className="text-[13.5px] leading-[1.62] text-foreground/75">
                        {livePlan?.reply || run.reply}
                      </p>
                      {/* The answer itself, when a model wrote one.
 
                          The frame used to stop at the one-line "here is what I
                          am about to do", which is the least interesting thing
                          an agent says. A visitor typing a real problem is
                          judging whether it understood — so the finding, the
                          cause or the change goes on screen too, and it is
                          written for their prompt rather than replayed. */}
                      {/* The wait, made visible.
 
                          The prepared run finishes in about five seconds and
                          the model's answer lands at about the same time, so
                          without this the frame sat on a completed plan and
                          then text appeared from nowhere. Measured at 5.4s
                          against the endpoint, which is short enough to wait
                          for and far too long to leave unexplained. */}
                      {spent && !livePlan?.answer ? (
                        <p className="text-[12.5px] leading-[1.6] text-[var(--cursor-text-tertiary)]">
                          Live answers are limited to a few per visitor — this
                          one is the prepared example. Sign in to run it
                          properly.
                        </p>
                      ) : null}
                      {answering && !livePlan?.answer ? (
                        <p className="flex items-center gap-2 text-[13px] text-[var(--cursor-text-secondary)]">
                          <span className="relative flex size-1.5">
                            {!reduceMotion && (
                              <span className="absolute inline-flex size-full animate-ping rounded-full bg-foreground opacity-60" />
                            )}
                            <span className="relative inline-flex size-1.5 rounded-full bg-foreground" />
                          </span>
                          Writing the answer
                        </p>
                      ) : null}
                      {livePlan?.answer ? (
                        <motion.p
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{
                            duration: DURATION.enter,
                            ease: EASE_OUT,
                          }}
                          className="text-[13.5px] leading-[1.68] text-foreground"
                        >
                          {livePlan.answer}
                        </motion.p>
                      ) : null}
                    </motion.div>
                  )}
                </div>
              ) : (
                <div className="flex flex-1 flex-col justify-center gap-3">
                  <p className={MICRO}>Try it</p>
                  <div className="flex flex-wrap gap-2">
                    {BUILD_RUNS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          setValue(option.prompt);
                          startRun(option.prompt);
                        }}
                        className="rounded-full border border-border px-3 py-1.5 text-left text-[12.5px] text-[var(--cursor-text-secondary)] transition-[color,border-color,transform] duration-100 hover:border-border-strong hover:text-foreground active:scale-[0.98] focus-visible:outline-none motion-reduce:transition-none"
                      >
                        {option.prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );

        case "studio":
          return (
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
              {/*
               * The visitor's own render, when they asked for one.
               *
               * It leads rather than joining the strip below. The three stills
               * under it are prepared and say so; this one was made from the
               * sentence sitting under it, seconds ago, and that difference is
               * the entire argument this section is making.
               */}
              {rendered ? (
                <motion.figure
                  initial={
                    reduceMotion
                      ? false
                      : { opacity: 0, scale: 0.99, filter: "blur(10px)" }
                  }
                  animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                  transition={{ duration: DURATION.settle, ease: EASE_OUT }}
                  className="m-0 flex flex-col gap-2"
                >
                  <span className="block aspect-[16/9] overflow-hidden rounded-[8px] border border-border-strong bg-black">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={rendered.dataUrl}
                      alt={rendered.prompt}
                      className="size-full object-cover"
                    />
                  </span>
                  <figcaption className="flex flex-col gap-0.5">
                    <span className={MICRO}>Yours · rendered just now</span>
                    <span className="text-[12.5px] leading-snug text-foreground">
                      {rendered.prompt}
                    </span>
                  </figcaption>
                </motion.figure>
              ) : null}

              {/* One real render per visitor. The button says what it costs the
                reader — nothing — and what it will do. */}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const text = shotPrompt.trim();
                  if (text.length >= 3 && renderState !== "working") {
                    renderReal(text);
                  }
                }}
                className="flex items-center gap-2 rounded-[8px] border border-border bg-background/60 px-3 py-2"
              >
                <input
                  value={shotPrompt}
                  onChange={(event) => setShotPrompt(event.target.value)}
                  placeholder="Describe a shot and render it for real"
                  aria-label="Studio prompt"
                  maxLength={240}
                  className="min-w-0 flex-1 bg-transparent py-0.5 text-[13px] text-foreground outline-none placeholder:text-foreground/35"
                />
                <button
                  type="submit"
                  disabled={
                    renderState === "working" || shotPrompt.trim().length < 3
                  }
                  className="inline-flex h-7 shrink-0 items-center rounded-full bg-foreground px-3 text-[12px] font-medium text-background transition-transform duration-100 active:scale-[0.97] disabled:opacity-35 motion-reduce:transition-none"
                >
                  {renderState === "working" ? "Rendering" : "Render"}
                </button>
              </form>
              {renderState === "spent" ? (
                <p className="text-[12.5px] leading-[1.55] text-[var(--cursor-text-tertiary)]">
                  One real render per visitor a day, and today&rsquo;s is spent.
                  The frames below are prepared.
                </p>
              ) : null}
              {renderState === "failed" ? (
                <p className="text-[12.5px] leading-[1.55] text-[var(--cursor-text-tertiary)]">
                  That render did not come back. The frames below are prepared.
                </p>
              ) : null}

              <p className={MICRO}>Model</p>
              <div className="flex flex-wrap gap-1.5">
                {STUDIO_MODELS.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setModel(name)}
                    className={`rounded-full border px-2.5 py-1 text-[12px] transition-[color,border-color,transform] duration-100 active:scale-[0.97] focus-visible:outline-none motion-reduce:transition-none ${
                      model === name
                        ? "border-foreground/40 bg-foreground/10 text-foreground"
                        : "border-border text-[var(--cursor-text-secondary)] hover:border-border-strong hover:text-foreground"
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
              {/* The chips are the roster you pick from signed in. The free
                  preview below renders on one lightweight model regardless, so
                  the picker is a catalogue here, not a live control. */}
              <p className={`${MICRO} mt-2 text-[var(--cursor-text-tertiary)]`}>
                The roster, signed in. The free preview renders on one
                lightweight model.
              </p>
              <div className="mt-1 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {STUDIO_SHOTS.map((shot, index) => {
                  const shown = index < shotCount;
                  return (
                    /*
                     * The reveal animates a scrim over the picture, never the
                     * element that holds it.
                     *
                     * Animating this figure's own opacity promoted the subtree
                     * to a composited layer, and Chrome painted that layer
                     * before the lazily-decoded render had arrived — so the
                     * tiles stayed empty for good, no matter how long anyone
                     * waited. It looked like a broken image and was in fact a
                     * painted-once layer; any forced repaint brought all three
                     * back at once. The connector wall on /landing/x had the
                     * identical failure, and the fix is the same: keep the
                     * image out of anything that animates.
                     */
                    <figure
                      key={shot.label}
                      className="m-0 flex flex-col gap-2"
                    >
                      {/* No caption over the picture. These are dark product
                        renders — the brightest measures 51 of 255 — so a scrim
                        laid over them to carry text takes the picture with it.
                        The label sits underneath instead, and the frame gets a
                        small lift so the render reads at thumbnail size. */}
                      <span className="relative block aspect-[4/3] overflow-hidden rounded-[8px] border border-border bg-black">
                        <Image
                          src={shot.src}
                          alt=""
                          fill
                          sizes="(max-width: 1024px) 33vw, 220px"
                          // Eager *and* synchronous. Eager alone was not
                          // enough: the first tile (35KB) decoded in time to
                          // make the layer's one paint and the other two
                          // (72KB and 83KB) did not, so the surface rendered
                          // one render and two black rectangles — which is a
                          // worse advertisement for an image product than
                          // showing nothing at all. `decoding="sync"` blocks
                          // the paint until the bitmap is ready, which is what
                          // this needs and what it costs almost nothing to do
                          // for three small assets.
                          loading="eager"
                          decoding="sync"
                          className="object-cover [filter:brightness(1.35)_contrast(1.05)]"
                        />
                        <span
                          aria-hidden
                          className="absolute inset-0 bg-black transition-opacity duration-500 ease-out motion-reduce:transition-none"
                          style={{
                            opacity: reduceMotion || shown ? 0 : 0.82,
                          }}
                        />
                      </span>
                      <figcaption className="flex flex-col gap-0.5">
                        <span className={MICRO}>{shot.kind}</span>
                        <span className="text-[12.5px] font-medium leading-snug text-foreground">
                          {shot.label}
                        </span>
                      </figcaption>
                    </figure>
                  );
                })}
              </div>
            </div>
          );

        case "workbench":
          return (
            <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
              <p className={MICRO}>Target · {WORKBENCH_TARGET}</p>
              {/* The caption under this frame says the scan is read live, so
                a visitor seeing the replay instead has to be told — otherwise
                the page is claiming something about the screen in front of
                them that is not true for them. */}
              {probeSpent ? (
                <p className="text-[12.5px] leading-[1.55] text-[var(--cursor-text-tertiary)]">
                  One live pass per visitor a day, and today&rsquo;s is spent.
                  What follows is the recorded one.
                </p>
              ) : null}
              <div className="flex-1 rounded-[8px] border border-border bg-background/60 p-3 font-mono text-[12px] leading-[1.8]">
                {scanLines.slice(0, lineCount).map((line, index) => (
                  <motion.p
                    key={line}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: DURATION.tap }}
                    className={
                      index === 0
                        ? "text-foreground"
                        : "text-[var(--cursor-text-secondary)]"
                    }
                  >
                    <span className="select-none text-foreground/25">$ </span>
                    {line}
                  </motion.p>
                ))}
                {/* The caret belongs to the output, not to the timer.
 
                  `scanning` runs for a fixed twenty reveal steps because the
                  scan is scheduled before the live probe has said how many
                  lines it will produce. Tied to that flag, the caret kept
                  blinking for seconds after the last line had landed. Tied to
                  the lines themselves, it stops when the output does. */}
                {scanning && lineCount < scanLines.length && !reduceMotion && (
                  <span className="inline-block h-[13px] w-[7px] animate-pulse bg-foreground/70 align-middle" />
                )}
              </div>
            </div>
          );

        case "agents": {
          const active = ROSTER[agent];
          return (
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
              <p className={MICRO}>8 of 29 archetypes</p>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                {ROSTER.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setAgent(index)}
                    aria-pressed={index === agent}
                    className="group flex flex-col items-center gap-1.5 rounded-[6px] px-1 py-1.5 transition-[background-color,transform] duration-100 hover:bg-foreground/[0.04] active:scale-[0.97] focus-visible:outline-none motion-reduce:transition-none"
                  >
                    <motion.span
                      animate={
                        reduceMotion
                          ? undefined
                          : {
                              scale: index === agent ? 1 : 0.92,
                              opacity: index === agent ? 1 : 0.55,
                            }
                      }
                      transition={{
                        duration: DURATION.control,
                        ease: EASE_OUT,
                      }}
                    >
                      <AgentPetAvatar
                        accent={item.accent}
                        agentName={item.petName}
                        role={item.visualPreset}
                        roleName={item.roleName}
                        selected={index === agent}
                        size={40}
                      />
                    </motion.span>
                    <span
                      className={`block max-w-full truncate text-[11.5px] ${
                        index === agent
                          ? "text-foreground"
                          : "text-foreground/45"
                      }`}
                    >
                      {item.petName}
                    </span>
                  </button>
                ))}
              </div>
              <motion.div
                key={active.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: DURATION.control, ease: EASE_OUT }}
                className="mt-auto"
              >
                <p className="text-[13px] text-foreground">
                  {active.petName}{" "}
                  <span className="text-foreground/40">
                    · {active.roleName}
                  </span>
                </p>
                <p className="mt-1 text-[13px] leading-[1.6] text-foreground/70">
                  {active.description}
                </p>
              </motion.div>
            </div>
          );
        }

        case "plugins":
          return (
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-4">
              <p className={`${MICRO} mb-1`}>Tools the agent can reach</p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {plugins.map((plugin) => {
                  const Logo = plugin.logo ? PLUGIN_LOGO[plugin.logo] : null;
                  return (
                    <button
                      key={plugin.name}
                      type="button"
                      aria-pressed={plugin.on}
                      onClick={() =>
                        setPlugins((current) =>
                          current.map((item) =>
                            item.name === plugin.name
                              ? { ...item, on: !item.on }
                              : item,
                          ),
                        )
                      }
                      className={`flex items-start gap-2.5 rounded-[6px] border px-2.5 py-2 text-left transition-[background-color,border-color,transform] duration-100 active:scale-[0.99] focus-visible:outline-none motion-reduce:transition-none ${
                        plugin.on
                          ? "border-foreground/30 bg-foreground/[0.06]"
                          : "border-border hover:border-border-strong"
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-3.5 w-6 shrink-0 items-center rounded-full px-0.5 transition-colors duration-100 ${
                          plugin.on ? "bg-foreground" : "bg-foreground/15"
                        }`}
                      >
                        <motion.span
                          className={`size-2.5 rounded-full ${plugin.on ? "bg-background" : "bg-foreground/50"}`}
                          animate={
                            reduceMotion ? undefined : { x: plugin.on ? 10 : 0 }
                          }
                          transition={{
                            duration: DURATION.tap,
                            ease: EASE_OUT,
                          }}
                        />
                      </span>
                      {Logo ? (
                        <span className="mt-px flex size-4 shrink-0 items-center justify-center text-foreground">
                          <Logo size={14} />
                        </span>
                      ) : null}
                      <span className="min-w-0">
                        <span className="block text-[12.5px] font-medium text-foreground">
                          {plugin.name}{" "}
                          <span className="font-normal text-foreground/35">
                            {plugin.kind}
                          </span>
                        </span>
                        <span className="block text-[11.5px] leading-[1.45] text-foreground/45">
                          {plugin.note}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );

        case "tasks":
          return (
            <div className="flex min-h-0 flex-1 flex-col gap-1 p-4">
              <p className={`${MICRO} mb-1`}>Queue</p>
              {tasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() =>
                    setTasks((current) =>
                      current.map((item) =>
                        item.id === task.id
                          ? { ...item, done: !item.done }
                          : item,
                      ),
                    )
                  }
                  className="flex items-center gap-2.5 rounded-[6px] px-2 py-2 text-left transition-[background-color,transform] duration-100 hover:bg-foreground/[0.04] active:scale-[0.995] focus-visible:outline-none motion-reduce:transition-none"
                >
                  <span
                    className={`flex size-[15px] shrink-0 items-center justify-center rounded-[6px] border transition-colors duration-100 ${
                      task.done
                        ? "border-foreground bg-foreground text-background"
                        : "border-border-strong"
                    }`}
                  >
                    {task.done && (
                      <Check aria-hidden className="size-2.5" strokeWidth={3} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-[13px] ${
                        task.done
                          ? "text-foreground/40 line-through"
                          : "text-foreground"
                      }`}
                    >
                      {task.title}
                    </span>
                    <span className="block text-[11px] text-foreground/35">
                      {task.meta}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          );
      }
    };

    /* ── Right panel ── */

    const panel = () => {
      switch (surface) {
        case "build":
          return (
            <>
              {/* The meter counts the prepared run. With a live plan on
                screen there is nothing for it to be counting, so it goes
                rather than reporting somebody else's seventeen tool calls. */}
              <div
                className={ACTIVITY_COUNTERS_ROW_CLASS}
                hidden={Boolean(livePlan)}
              >
                <span>
                  tools{" "}
                  <span className="text-foreground">
                    <Counter
                      key={`${run.id}-tools`}
                      value={running ? run.tools : 0}
                      active={phase === "done"}
                      reduceMotion={reduceMotion}
                    />
                  </span>
                </span>
                <span>
                  diff{" "}
                  <span className="text-foreground/80">
                    +
                    <Counter
                      key={`${run.id}-added`}
                      value={run.diff.added}
                      active={phase === "done"}
                      reduceMotion={reduceMotion}
                    />
                  </span>{" "}
                  <span className="text-foreground/40">
                    −
                    <Counter
                      key={`${run.id}-removed`}
                      value={run.diff.removed}
                      active={phase === "done"}
                      reduceMotion={reduceMotion}
                    />
                  </span>
                </span>
              </div>

              <PanelHead
                title="Plan"
                count={`${planDone} / ${planSteps.length}`}
              />
              <div className="border-y border-border/70">
                {/* planSteps, not run.plan. The panel rendered the prepared
                  list while the counter above it counted the live one, so a
                  visitor whose prompt got a five-step plan back saw "5 / 4"
                  over four steps that had nothing to do with what they
                  asked. */}
                {planSteps.map((stepText, index) => (
                  <StepRow key={stepText} status={planStatus(index)}>
                    {stepText}
                  </StepRow>
                ))}
              </div>

              <div className="flex min-h-0 flex-1 flex-col px-3 py-2.5">
                {/* The prepared trace, and only when the run itself is the
                  prepared one.
 
                  Once the model has written a plan for the visitor's own
                  prompt, a tool trace reading "Searched pricing.test.ts · Ran
                  pnpm test pricing" is not merely filler — it contradicts the
                  five steps sitting directly above it. Asking about an ETL job
                  and being shown a pricing test is the page telling the reader
                  something false about what just happened, which the caption
                  underneath cannot undo. Opening a sandbox per anonymous
                  visitor is the only honest way to fill this panel, and that
                  is a different decision with a different bill; until then it
                  stays empty and says why. */}
                {livePlan ? (
                  <p className="text-[12.5px] leading-[1.6] text-[var(--cursor-text-tertiary)]">
                    The plan and the answer above were written for your prompt.
                    The tool trace needs a sandbox, which starts at sign-in.
                  </p>
                ) : (
                  <>
                    <Trace
                      ops={run.ops}
                      count={opCount}
                      reduceMotion={reduceMotion}
                      keyPrefix={run.id}
                    />
                    {phase === "done" && (
                      <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className={`${MICRO} mt-auto pt-3`}
                      >
                        Done in {Math.floor(run.seconds / 60)}m{" "}
                        {String(run.seconds % 60).padStart(2, "0")}s
                      </motion.p>
                    )}
                  </>
                )}
              </div>
            </>
          );

        case "studio":
          return (
            <>
              {/* The model that actually ran, not the chip that is selected.

                The chips are the roster — what Studio offers a signed-in user.
                The one free render on this page always goes through a single
                lightweight model we pay for (not one of the roster's twelve),
                so naming the selected chip beside a picture a different model
                produced would be the panel asserting something untrue about
                the thing next to it. The label is derived from the endpoint's
                own constant so the two cannot drift. */}
              <div className={ACTIVITY_COUNTERS_ROW_CLASS}>
                <span>
                  model{" "}
                  <span className="text-foreground">
                    {rendered ? DEMO_IMAGE_MODEL_LABEL : model}
                  </span>
                </span>
                {rendered ? (
                  <span className="text-[var(--cursor-text-tertiary)]">
                    yours · live
                  </span>
                ) : null}
              </div>
              <PanelHead
                title={rendered ? "Prepared queue" : "Render queue"}
                count={`${shotCount} / ${STUDIO_SHOTS.length}`}
              />
              <div className="border-y border-border/70">
                {STUDIO_SHOTS.map((shot, index) => (
                  <StepRow
                    key={shot.label}
                    status={
                      index < shotCount
                        ? "completed"
                        : index === shotCount && rendering
                          ? "in_progress"
                          : "pending"
                    }
                  >
                    {shot.label}
                  </StepRow>
                ))}
              </div>
              <p className={`${MICRO} px-3 py-3`}>
                {rendered
                  ? "The frame above is yours · the queue is prepared"
                  : "One prompt box, one bill, one thread"}
              </p>
            </>
          );

        case "workbench":
          return (
            <>
              <div className={ACTIVITY_COUNTERS_ROW_CLASS}>
                <span>
                  tools <span className="text-foreground">87</span>
                </span>
                <span>
                  findings{" "}
                  <span className="text-foreground">
                    {lineCount >= scanLines.length ? scanFindings.length : 0}
                  </span>
                </span>
              </div>
              <PanelHead
                title="Findings"
                count={
                  lineCount >= scanLines.length
                    ? String(scanFindings.length)
                    : undefined
                }
              />
              <div className="flex flex-col gap-2 px-3 py-2.5">
                {lineCount >= scanLines.length ? (
                  scanFindings.map((finding) => (
                    <motion.div
                      key={finding.key}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: DURATION.control,
                        ease: EASE_OUT,
                      }}
                      className="flex gap-2"
                    >
                      <span
                        className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                          finding.strong
                            ? "bg-foreground/80"
                            : "bg-foreground/35"
                        }`}
                      />
                      <span className="text-[12.5px] leading-[1.55] text-foreground/70">
                        {finding.text}
                      </span>
                    </motion.div>
                  ))
                ) : (
                  <p className={MICRO}>Verifying before reporting</p>
                )}
              </div>
            </>
          );

        case "agents":
          return (
            <>
              <div className={ACTIVITY_COUNTERS_ROW_CLASS}>
                <span>
                  roster <span className="text-foreground">29</span>
                </span>
                <span>
                  active{" "}
                  <span className="text-foreground">
                    {ROSTER[agent].petName}
                  </span>
                </span>
              </div>
              <PanelHead title="Mission" />
              <p className="px-3 pb-3 text-[12.5px] leading-[1.55] text-foreground/70">
                {ROSTER[agent].mission}
              </p>
              <p className={`${MICRO} border-t border-border/70 px-3 py-3`}>
                Each role carries its own instructions and its own standard for
                done
              </p>
            </>
          );

        case "plugins":
          return (
            <>
              <div className={ACTIVITY_COUNTERS_ROW_CLASS}>
                <span>
                  enabled{" "}
                  <span className="text-foreground">
                    {plugins.filter((plugin) => plugin.on).length} /{" "}
                    {plugins.length}
                  </span>
                </span>
              </div>
              <PanelHead title="Reachable this run" />
              <div className="flex flex-col gap-1.5 px-3 pb-3">
                {plugins
                  .filter((plugin) => plugin.on)
                  .map((plugin) => (
                    <motion.span
                      key={plugin.name}
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: DURATION.tap }}
                      className="text-[12.5px] text-foreground/70"
                    >
                      {plugin.name}
                    </motion.span>
                  ))}
              </div>
              <p
                className={`${MICRO} mt-auto border-t border-border/70 px-3 py-3`}
              >
                Anything off is unreachable, not just hidden
              </p>
            </>
          );

        case "tasks":
          return (
            <>
              <div className={ACTIVITY_COUNTERS_ROW_CLASS}>
                <span>
                  done{" "}
                  <span className="text-foreground">
                    {doneTasks} / {tasks.length}
                  </span>
                </span>
              </div>
              <PanelHead title="Across surfaces" />
              <div className="px-3 pb-3">
                <div className="h-1 overflow-hidden rounded-full bg-foreground/10">
                  <motion.div
                    className="h-full bg-foreground"
                    animate={{ width: `${(doneTasks / tasks.length) * 100}%` }}
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { duration: DURATION.control, ease: EASE_OUT }
                    }
                  />
                </div>
              </div>
              <p className={`${MICRO} border-t border-border/70 px-3 py-3`}>
                Build, Studio and the Workbench report into one queue
              </p>
            </>
          );
      }
    };

    /* ── Frame ── */

    return (
      <ProductFrame caption={caption} note={note} variant={variant}>
        <div ref={viewRef} className="bg-[var(--surface)]">
          {/*
           * The Workbench takes the whole frame, because in the product it
           * takes the whole screen.
           *
           * Every other surface here lives inside the workstation shell — the
           * sidebar, a working column, the activity panel. The Hack Workbench
           * does not: it is a route of its own at /hack, fixed to the viewport,
           * with a different grid, a different palette and a different
           * typeface. Rendering it inside the workstation chrome was showing a
           * screen the product does not have, so the tab hands the frame over
           * to the real surface instead.
           */}
          {surface === "workbench" ? (
            <HackWorkbenchMini
              host={WORKBENCH_TARGET}
              lines={scanLines}
              findings={workbenchFindings}
              recorded={probeSpent}
              onRerun={startScan}
            />
          ) : (
            <>
              {/* 279px is the application's own sidebar width, measured against
            Cursor's on 18 Aug 2026 and held by lib/ui/workspace-chrome.ts. */}
              <div
                className={`grid min-h-[392px] grid-cols-1 ${showSidebar ? "grid-cols-[188px_minmax(0,1fr)] lg:grid-cols-[279px_minmax(0,1fr)_268px]" : "lg:grid-cols-[minmax(0,1fr)_268px]"}`}
              >
                {/* Flat, like the product's own sidebar. The replica used to opt
                    into a "polished metal" material by class — translucent fill,
                    blur, lit edges, a raked specular. That material is gone from
                    the product, and the frame and the application must not end up
                    with two different ideas of what the sidebar is made of. */}
                <aside
                  className={`flex-col border-r border-sidebar-border bg-sidebar p-1.5 ${showSidebar ? "flex" : "hidden"}`}
                >
                  {/* The product's header row: the mark, then the three chrome
                controls. Sizes are the application's, not approximations. */}
                  <div className="flex items-center justify-between px-1.5 pb-2 pt-1">
                    <span className="flex items-center gap-2">
                      <RiftLogo size={20} className="text-foreground" />
                      <RiftWordmark
                        decorative
                        height={20}
                        className="text-[13px] font-semibold tracking-[0.06em] text-foreground"
                      />
                    </span>
                    <span className="flex items-center gap-0.5 text-[var(--cursor-icon-secondary)]">
                      <Search
                        aria-hidden
                        className="size-[14px]"
                        strokeWidth={1.5}
                      />
                      <Sun
                        aria-hidden
                        className="ms-1.5 size-[14px]"
                        strokeWidth={1.5}
                      />
                      <PanelLeft
                        aria-hidden
                        className="ms-1.5 size-[14px]"
                        strokeWidth={1.5}
                      />
                    </span>
                  </div>

                  <nav aria-label="Primary workspaces" className="space-y-px">
                    <button
                      type="button"
                      onClick={() => {
                        clearTimers();
                        setSurface("build");
                        setPhase("idle");
                        setOpCount(0);
                        setValue("");
                      }}
                      className={sidebarNavRowClass(false)}
                    >
                      <Plus aria-hidden className="shrink-0" />
                      New chat
                    </button>
                    {NAV.map(({ id, label, Icon }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => goTo(id)}
                        aria-current={surface === id ? "page" : undefined}
                        className={`${sidebarNavRowClass(surface === id)} transition-transform active:scale-[0.99]`}
                      >
                        <Icon aria-hidden className="shrink-0" />
                        {label}
                      </button>
                    ))}
                  </nav>

                  <nav
                    aria-label="Workspace"
                    className="mt-1.5 space-y-px border-t border-sidebar-border pt-1.5"
                  >
                    {NAV_SECONDARY.map(({ id, label, Icon }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => goTo(id)}
                        aria-current={surface === id ? "page" : undefined}
                        className={`${sidebarNavRowClass(surface === id)} transition-transform active:scale-[0.99]`}
                      >
                        <Icon aria-hidden className="shrink-0" />
                        {label}
                      </button>
                    ))}
                  </nav>

                  <p className={`${SIDEBAR_SECTION_LABEL_CLASS} mt-4 px-2`}>
                    Recent
                  </p>
                  <span className="truncate px-2 py-1 text-[13px] leading-[18px] text-[var(--cursor-text-secondary)]">
                    {run.prompt}
                  </span>
                  <span className="truncate px-2 py-1 text-[13px] leading-[18px] text-[var(--cursor-text-secondary)]">
                    Audit {WORKBENCH_TARGET}
                  </span>
                </aside>

                {/* ── The surface ── */}
                <div className="flex min-w-0 flex-col">
                  {/* The sidebar is hidden below `lg`, and a frame that shows five
                working surfaces should not hide four of them on a phone. */}
                  <div className="flex gap-1.5 overflow-x-auto border-b border-border p-2 lg:hidden">
                    {[...NAV, ...NAV_SECONDARY].map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => goTo(id)}
                        className={`shrink-0 rounded-full px-3 py-1 text-[12px] transition-colors duration-100 motion-reduce:transition-none ${
                          surface === id
                            ? "bg-foreground/10 text-foreground"
                            : "text-[var(--cursor-text-secondary)]"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* Keyed remount rather than AnimatePresence. `mode="wait"` holds
                the incoming surface until the outgoing one has finished
                leaving, and a second click during that window left the frame
                empty — Studio rendered nothing at all, and Agents froze
                half-faded. A surface that can be switched five times in five
                seconds must never depend on an exit completing. */}
                  <motion.div
                    key={surface}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: DURATION.control, ease: EASE_OUT }}
                    className="flex min-h-0 flex-1 flex-col"
                  >
                    {centre()}
                  </motion.div>

                  {surface === "build" ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const typed = value.trim();
                        const text = typed || BUILD_RUNS[0].prompt;
                        // The echo above the composer shows what was asked, so the
                        // composer clears the way the product's own does — leaving
                        // the text in both places reads as "nothing happened".
                        setValue(text);
                        startRun(text);
                        // Only a real question earns a model call. Pressing send on
                        // an empty box replays the prepared example instead.
                        if (typed.length >= 3) requestLivePlan(typed);
                      }}
                      className="border-t border-border p-3"
                    >
                      <div className="flex items-center gap-2 rounded-[8px] border border-border bg-background/60 px-3 py-2 transition-colors focus-within:border-border-strong motion-reduce:transition-none">
                        <input
                          value={value}
                          onChange={(event) => setValue(event.target.value)}
                          placeholder="Ask RIFT to build, fix or investigate something"
                          aria-label="Prompt"
                          className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-[var(--cursor-text-tertiary)]"
                        />
                        <button
                          type="submit"
                          aria-label="Run"
                          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-transform duration-100 active:scale-95 motion-reduce:transition-none"
                        >
                          <ArrowUp
                            aria-hidden
                            className="size-3.5"
                            strokeWidth={2}
                          />
                        </button>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className={MICRO}>
                          Agent · GPT-5.6 Sol Pro · Max
                        </span>
                        {running ? (
                          <button
                            type="button"
                            onClick={() => {
                              clearTimers();
                              setPhase("idle");
                              setOpCount(0);
                              setValue("");
                            }}
                            className="text-[11px] text-[var(--cursor-text-secondary)] underline-offset-2 transition-colors hover:text-foreground hover:underline motion-reduce:transition-none"
                          >
                            Reset
                          </button>
                        ) : null}
                      </div>
                    </form>
                  ) : (
                    <div className="flex items-center justify-between gap-3 border-t border-border p-3">
                      {/* No workbench arm here any more: that surface is rendered
                    whole, above, because the product gives it its own screen.
                    Leaving the branch in would be dead code that reads as a
                    second, contradicting Workbench footer. */}
                      <span className={MICRO}>
                        {surface === "studio"
                          ? "Studio · one prompt box"
                          : surface === "agents"
                            ? "29 archetypes, one thread"
                            : surface === "plugins"
                              ? "Built in, plus anything over MCP"
                              : `${doneTasks} of ${tasks.length} done`}
                      </span>
                      {surface === "studio" ? (
                        <button
                          type="button"
                          onClick={startRender}
                          className="inline-flex h-7 items-center rounded-full bg-foreground px-3.5 text-[12px] font-medium text-background transition-transform duration-100 active:scale-[0.97] motion-reduce:transition-none"
                        >
                          Render again
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>

                {/* ── Activity. Same classes the product's own panel uses. ── */}
                {/* Stacks under the surface below `lg` rather than disappearing.
              Hidden, it took the plan, the tool trace and the running counters
              with it — which is the half of the frame that proves the claim
              about watching every call and every dollar. A visitor on a phone
              was being shown the chat and none of the evidence. */}
                <aside className="flex min-w-0 flex-col border-t border-border lg:border-l lg:border-t-0">
                  <p className="border-b border-border px-3 py-2 text-[12px] font-medium text-foreground">
                    Agent Activity
                  </p>
                  <motion.div
                    key={surface}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: DURATION.tap }}
                    className="flex min-h-0 flex-1 flex-col"
                  >
                    {panel()}
                  </motion.div>
                </aside>
              </div>
            </>
          )}
        </div>
      </ProductFrame>
    );
  },
);
