"use client";

import { ArrowLeft, Box, Layers, Lock, PanelLeftClose } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { RiftLogo } from "@/components/icons/rift-logo";

import { useInViewOnce } from "./use-in-view";

/**
 * The Hack Workbench, as the product actually renders it.
 *
 * The landing showed this surface in the workstation's own chrome — a sidebar,
 * a chat column, an activity panel — because that is the shell every other
 * surface uses. The Hack Workbench is not one of them. In the product it is a
 * route of its own at /hack, `position:fixed;inset:0`, and it takes the whole
 * screen with a completely different language: a framed terminal on a scene
 * background, a header strip, three overview cards, an operations rail and a
 * status bar, set in JetBrains Mono with a pale-blue signal colour. A visitor
 * who signed up after seeing the old panel would not have recognised the thing
 * they were given.
 *
 * ── Where these values come from ──
 *
 * Read off the `.fui` stylesheet inside app/components/HackerMode.tsx — the
 * shipping skin, the last of the three defined there — rather than eyeballed
 * from a screenshot:
 *
 *   grid      204px rail, 64px header, 142-158px overview, 30px status bar
 *   panels    #050608 / #090b0e / #020305
 *   ink       #f3f6f9, dim #b3bdc7, faint #7e8993
 *   lines     #1c232a, cards bordered #192129 on #06080b
 *   signal    #a8d9ff, and it is the only colour on the surface
 *   type      Geist for chrome, JetBrains Mono for anything machine-written
 *   radii     2px. Not 8, not 10 — the product's security surface is square.
 *
 * They are copied rather than imported because HackerMode ships its CSS as one
 * 900-line template literal scoped to a `.fui` root that assumes a fixed,
 * full-viewport element. Importing it would drag the whole surface — the
 * mascot, the task browser, the session machinery — into a marketing page.
 * What is reproduced here is the shell, and the numbers above are the contract
 * between the two.
 */

/* ── The surface's own tokens ─────────────────────────────────────────── */

/**
 * The scene the panel floats on.
 *
 * This is the part that makes the real screen unmistakable, and the first
 * version of this component missed it entirely by treating the Workbench as a
 * dark panel. It is not. `.fui` paints a pixel-art daylight landscape — a
 * near-white sky, two clouds, two mountain ridges and a dark ground band —
 * lays a two-tone halftone dot grid over it in `multiply`, and then floats the
 * dark terminal panel on top, inset by a frame margin, with a bright edge and
 * a deep drop shadow.
 *
 * The gradients below are the stylesheet's, stop for stop. They are the reason
 * a security console in this product reads as a machine sitting in daylight
 * rather than as another black rectangle, and reproducing the panel without
 * them was reproducing the least distinctive half of the screen.
 */
const SCENE: CSSProperties = {
  "--scene-cloud-hi": "#fff",
  "--scene-cloud-lo": "#edf7ff",
  "--scene-sky-top": "#fcfeff",
  "--scene-sky-bottom": "#e5f3ff",
  "--scene-ridge-far": "#c9ddec",
  "--scene-ridge-mid": "#7b8c9c",
  "--scene-ridge-near": "#263542",
  "--scene-ground": "#0c131a",
  "--scene-dot-dark": "rgba(9,18,27,.42)",
  "--scene-dot-light": "rgba(255,255,255,.34)",
  "--scene-frame-edge": "rgba(188,226,255,.42)",
  "--scene-frame-shadow": "rgba(0,0,0,.68)",
} as CSSProperties;

/** The landscape itself, in the stylesheet's own layer order. */
const SCENE_BACKGROUND =
  "radial-gradient(ellipse 19% 10% at 7% 18%,var(--scene-cloud-hi) 0 43%,var(--scene-cloud-lo) 44% 59%,transparent 62%)," +
  "radial-gradient(ellipse 15% 8% at 83% 12%,var(--scene-cloud-hi) 0 43%,var(--scene-cloud-lo) 44% 59%,transparent 62%)," +
  "radial-gradient(ellipse 12% 7% at 99% 27%,var(--scene-cloud-hi) 0 43%,var(--scene-cloud-lo) 44% 59%,transparent 62%)," +
  "linear-gradient(148deg,transparent 0 50%,var(--scene-ridge-far) 50.4% 63%,transparent 63.4%) left bottom/59% 58% no-repeat," +
  "linear-gradient(211deg,transparent 0 49%,var(--scene-ridge-mid) 49.4% 65%,transparent 65.4%) right bottom/58% 62% no-repeat," +
  "linear-gradient(180deg,var(--scene-sky-top) 0,var(--scene-sky-bottom) 54%,var(--scene-ridge-far) 54% 62%,var(--scene-ridge-near) 62% 76%,var(--scene-ground) 76% 100%)";

/** The halftone, multiplied over the scene. 4px pitch, two tones. */
const SCENE_DOTS =
  "radial-gradient(circle,var(--scene-dot-dark) 0 1px,transparent 1.25px) 0 0/4px 4px," +
  "radial-gradient(circle,var(--scene-dot-light) 0 .7px,transparent 1px) 2px 2px/4px 4px";

const FUI: CSSProperties = {
  "--panel": "#050608",
  "--panel-2": "#090b0e",
  "--panel-3": "#020305",
  "--ink": "#f3f6f9",
  "--dim": "#b3bdc7",
  "--faint": "#7e8993",
  "--line": "#1c232a",
  /* The rule *between* metric cells, a step darker than the panel rule —
     `.fui`'s own --line2. Without it the four-up report row reads as four
     boxes instead of one divided strip. */
  "--line2": "#172027",
  "--card-line": "#192129",
  "--card-bg": "#06080b",
  "--cy": "#a8d9ff",
  "--grn": "#8fa99a",
  "--amb": "#b7a47f",
} as CSSProperties;

const MONO = "font-mono text-[var(--ink)]";

/* ── Content ──────────────────────────────────────────────────────────── */

/**
 * The operations rail.
 *
 * The phases the product enforces, in the order it enforces them. Scope is
 * first and is not skippable — that is the whole safety model, and a rail that
 * listed it anywhere else would be describing a different tool.
 */
const OPS = [
  { phase: "scope", label: "Declare scope", detail: "target + authorisation" },
  { phase: "discover", label: "Resolve host", detail: "dns · A / AAAA" },
  { phase: "discover", label: "Probe ports", detail: "tcp connect" },
  { phase: "enumerate", label: "Read banners", detail: "service + version" },
  { phase: "assess", label: "Review headers", detail: "transport policy" },
  { phase: "report", label: "Verify findings", detail: "before reporting" },
] as const;

export type MiniFinding = { title: string; detail: string };

export type HackWorkbenchMiniProps = {
  host: string;
  /** The terminal's lines. Live when a pass ran, recorded otherwise. */
  lines: readonly string[];
  findings: readonly MiniFinding[];
  /** True when this visitor's daily live pass is already spent. */
  recorded?: boolean;
  onRerun?: () => void;
};

/* ── Parts ────────────────────────────────────────────────────────────── */

function OverviewCard({
  title,
  tag,
  metrics,
  progressLabel,
  progress,
}: {
  title: string;
  tag: string;
  metrics: readonly { label: string; value: string; tone?: string }[];
  progressLabel: string;
  progress: number;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <article className="flex min-h-0 flex-col overflow-hidden rounded-[2px] border border-[var(--card-line)] bg-[var(--card-bg)] px-2.5 py-[7px]">
      <header className="flex min-h-[21px] items-center justify-between gap-2">
        <h3 className="truncate text-[11.5px] font-semibold tracking-[-0.01em] text-[#f7f9fb]">
          {title}
        </h3>
        <span className="whitespace-nowrap rounded-[1px] border border-[#303238] px-[5px] py-[2px] font-mono text-[9px] tracking-[0.03em] text-[#8f9298]">
          {tag}
        </span>
      </header>

      <dl className="mx-0 my-[5px] grid grid-cols-3 gap-x-2.5 gap-y-1">
        {metrics.map((metric) => (
          <div key={metric.label} className="min-w-0">
            <dt className="truncate text-[9px] leading-[1.2] text-[#7d8086]">
              {metric.label}
            </dt>
            <dd
              className="mt-0.5 truncate font-mono text-[13px] leading-[1.15] tabular-nums"
              style={{ color: metric.tone ?? "#edf2f6" }}
            >
              {metric.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-auto flex items-center justify-between text-[9px] text-[#7d8086]">
        <span>{progressLabel}</span>
        <b className="font-mono font-medium tabular-nums text-[#aeb1b7]">
          {Math.round(progress * 100)}%
        </b>
      </div>
      {/* 2px, and the only place the signal colour appears outside the
          terminal prompt. */}
      <div className="mt-1 h-[2px] overflow-hidden bg-[#172029]">
        <motion.i
          className="block h-full bg-[var(--cy)]"
          initial={{ width: 0 }}
          animate={{ width: `${Math.round(progress * 100)}%` }}
          transition={{ duration: 0.42, ease: "easeOut" }}
        />
      </div>
    </article>
  );
}

/* ── The surface ──────────────────────────────────────────────────────── */

export function HackWorkbenchMini({
  host,
  lines,
  findings,
  recorded = false,
  onRerun,
}: HackWorkbenchMiniProps) {
  const reduceMotion = useReducedMotion();
  const [ref, seen] = useInViewOnce<HTMLDivElement>(0.2);
  const [streamed, setStreamed] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clear = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  /** 240ms a line, scheduled — never written synchronously. */
  const schedule = useCallback(() => {
    clear();
    timers.current = lines.map((_, index) =>
      setTimeout(() => setStreamed(index + 1), 240 * (index + 1)),
    );
  }, [clear, lines]);

  // The effect only *schedules*; it writes no state of its own. Resetting the
  // counter here would be a synchronous setState inside an effect, which
  // cascades a render before paint — and it is unnecessary, because the
  // counter starts at zero and only a deliberate replay needs it put back.
  useEffect(() => {
    if (!seen || reduceMotion) return;
    schedule();
    return clear;
  }, [seen, reduceMotion, schedule, clear]);

  useEffect(() => clear, [clear]);

  // Reduced motion gets the finished trace rather than an empty terminal: the
  // preference is for less movement, not for less information.
  const shown = reduceMotion ? lines.length : streamed;

  const replay = () => {
    setStreamed(0);
    schedule();
  };

  const done = shown >= lines.length;

  /**
   * The T+mm:ss the product's own header shows.
   *
   * Derived from how far the trace has played rather than from a wall clock:
   * a timer that keeps counting after the output stops would be claiming work
   * that is not happening.
   */
  const elapsed = Math.round(shown * 0.24 * 10) / 10;
  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(
    Math.floor(elapsed % 60),
  ).padStart(2, "0")}`;
  // Whitespace-tolerant on purpose. A live pass writes "22/tcp open ssh ·
  // 288ms" with single spaces; the recorded trace is column-aligned with
  // several ("22/tcp   open  ssh"). A regex that assumed one space counted the
  // recorded run as a single open port and put a wrong number on the card.
  const openPorts = lines.filter((line) => /\/tcp\s+open\b/.test(line)).length;

  /** Pulled out of the live trace's A record when a real pass ran. */
  const resolvedIp =
    lines
      .find((line) => /^A\s+\d/.test(line))
      ?.replace(/^A\s+/, "")
      .split(",")[0]
      ?.trim() ?? "—";
  const phase = done
    ? "report"
    : shown > 4
      ? "assess"
      : shown > 1
        ? "discover"
        : "scope";

  return (
    <div
      ref={ref}
      style={{ ...SCENE, backgroundImage: SCENE_BACKGROUND }}
      className="relative isolate p-4 sm:p-7 lg:px-12 lg:py-8"
    >
      {/* The halftone, multiplied over the scene exactly as `.fui::before`
          does. `multiply` is what keeps the dark dots from washing the sky
          out — a plain overlay at this opacity turns the whole landscape
          grey. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.34] [mix-blend-mode:multiply]"
        style={{ backgroundImage: SCENE_DOTS }}
      />

      {/* The panel, floating. `.fui::after` insets it by the frame margin and
          gives it a lit edge and a 28/72 shadow; both are what make it read as
          hardware sitting in the scene rather than a hole cut in it. */}
      <div
        style={FUI}
        className="relative z-[1] grid min-h-[420px] grid-cols-1 border border-[var(--scene-frame-edge)] bg-[var(--panel)] text-[12.5px] text-[var(--ink)] shadow-[0_28px_72px_var(--scene-frame-shadow)] lg:grid-cols-[204px_minmax(0,1fr)]"
      >
        {/* ── top ──
        Read off HackerMode.tsx's own render tree, not approximated from its
        stylesheet. The first pass here was built from the CSS alone and got
        the structure wrong in five places: the wordmark is "RIFT Hack
        Workbench" rather than "Hack Workbench", there is an `AGENT` chip
        beside it, the subtitle is "Authorized security assessment and evidence
        orchestration", the target field is labelled SCOPE and carries a
        Run Selected button rather than a static chip, and the clock shows a
        live T+mm:ss beside a Ready/Working state. */}
        <div className="col-span-full grid grid-cols-1 items-center gap-x-4 gap-y-[3px] border-b border-[var(--line)] bg-[var(--panel-2)] px-4 py-1 sm:grid-cols-[minmax(220px,0.75fr)_minmax(0,1.35fr)]">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex h-[26px] items-center gap-1 rounded-[2px] border border-[var(--line)] bg-[var(--panel-3)] px-[7px] font-mono text-[8px] tracking-[0.06em] text-[var(--faint)]">
                <ArrowLeft aria-hidden className="size-3" />
                APP
              </span>
              <span className="flex size-[26px] items-center justify-center rounded-[2px] border border-[var(--line)] bg-[var(--panel-3)] text-[var(--dim)]">
                <PanelLeftClose aria-hidden className="size-[15px]" />
              </span>
              <span className="flex min-w-0 items-center gap-[7px]">
                <RiftLogo size={21} className="shrink-0 text-white" />
                <span className="truncate text-[12px] font-semibold tracking-[-0.01em] text-white">
                  RIFT Hack Workbench
                </span>
              </span>
              <span className="hidden h-[23px] shrink-0 items-center rounded-[2px] border border-[#202932] bg-[#05080b] px-[7px] font-mono text-[9px] tracking-[0.03em] text-[#b6c1cb] lg:inline-flex">
                <span aria-hidden className="mr-1">
                  ›_
                </span>
                <b className="font-medium">AGENT</b>
              </span>
            </div>
            <p className="ml-[34px] mt-1 truncate text-[9.5px] leading-[1.25] text-[var(--faint)]">
              Authorized security assessment and evidence orchestration
            </p>
          </div>

          <div className="flex min-w-0 flex-col items-end gap-[3px]">
            {/* Capabilities row, theirs: three items with 12px icons. */}
            <div className="hidden items-center gap-1.5 lg:flex">
              {[
                { Icon: Box, label: "Container Isolation" },
                { Icon: Lock, label: "Secure Evidence" },
                { Icon: Layers, label: "Multi-tool Agent" },
              ].map(({ Icon, label }) => (
                <span
                  key={label}
                  className="flex min-h-[18px] items-center gap-[5px] whitespace-nowrap px-1.5 text-[9px] text-[#7d8086]"
                >
                  <Icon aria-hidden className="size-3 text-[#878a90]" />
                  {label}
                </span>
              ))}
            </div>

            <div className="flex w-full min-w-0 items-center justify-end gap-2.5">
              <span className="flex h-[27px] w-full max-w-[420px] items-center gap-2 rounded-[2px] border border-[var(--line)] bg-[var(--panel-3)] px-2">
                <span className="font-mono text-[12px] text-[var(--cy)]">
                  ›
                </span>
                <span className="shrink-0 font-mono text-[9px] tracking-[0.04em] text-[var(--faint)]">
                  SCOPE
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--dim)]">
                  {host}
                </span>
                <button
                  type="button"
                  onClick={
                    onRerun
                      ? () => {
                          onRerun();
                          replay();
                        }
                      : replay
                  }
                  className="shrink-0 rounded-[2px] border border-[#26313a] bg-[#0e1318] px-[7px] py-[3px] text-[9px] text-[#dce4eb] transition-colors hover:border-[#426c8c] hover:bg-[#101a22] hover:text-white motion-reduce:transition-none"
                >
                  {done ? "Run Selected" : "Stop"}
                </button>
              </span>
              <span className="hidden items-center gap-[9px] border-l border-[var(--line)] pl-2.5 font-mono text-[9.5px] text-[var(--faint)] sm:flex">
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  <i
                    className={`size-[5px] rounded-[1px] ${
                      done ? "bg-[#46515b]" : "bg-[var(--cy)]"
                    }`}
                  />
                  <b className="font-medium text-[#dbe2e8]">
                    {done ? "Ready" : "Working"}
                  </b>
                </span>
                <span className="whitespace-nowrap">
                  T+<b className="font-medium text-[#dbe2e8]">{clock}</b>
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* ── overview ──
        Three cards with six metrics each, and these are the product's own
        titles, badges, metric labels and progress captions. The first pass
        invented three cards of three metrics; this is what /hack actually
        renders. */}
        <div className="col-span-full grid grid-cols-1 gap-2.5 overflow-hidden border-b border-[var(--line)] bg-[var(--panel-2)] px-4 pb-2.5 pt-[9px] sm:grid-cols-3">
          <OverviewCard
            title="Attack surface"
            tag="AUTHORIZED"
            metrics={[
              { label: "Hosts", value: "1" },
              { label: "Services", value: String(openPorts) },
              { label: "Endpoints", value: done ? "1" : "0" },
              { label: "Resolved IP", value: resolvedIp },
              { label: "Phase", value: phase, tone: "#b7a47f" },
              { label: "Target", value: host.replace(/^www\./, "") },
            ]}
            progressLabel="Scope readiness"
            progress={1}
          />
          <OverviewCard
            title="Assessment"
            tag={done ? "ASSESSED" : "PENDING"}
            metrics={[
              {
                label: "Findings",
                value: done ? String(findings.length) : "0",
              },
              {
                label: "Verified",
                value: done ? String(findings.length) : "0",
              },
              { label: "Evidence", value: `${shown} lines` },
              {
                label: "State",
                value: done ? "READY" : "SCANNING",
                tone: done ? "#8fa99a" : "#b7a47f",
              },
            ]}
            progressLabel={done ? "Findings verified" : "Awaiting evidence"}
            progress={done ? 1 : 0}
          />
          <OverviewCard
            title="Agent session"
            tag={done ? "READY" : "LIVE"}
            metrics={[
              { label: "Toolchain", value: "FULL" },
              { label: "Model", value: "RIFT" },
              { label: "Mode", value: "AGENT" },
              {
                label: "State",
                value: done ? "READY" : "WORKING",
                tone: done ? "#8fa99a" : "#b7a47f",
              },
              { label: "Runtime", value: clock },
              { label: "Evidence", value: `${shown} lines` },
            ]}
            progressLabel="Toolchain available"
            progress={1}
          />
        </div>

        {/* ── ops rail ── */}
        <aside className="hidden border-r border-[var(--line)] bg-[var(--panel-2)] lg:block">
          {/* "Tasks · N CAPABILITIES" and a filter field — the product's own
          rail header, not a renamed one. */}
          <div className="flex h-[30px] items-center justify-between border-b border-[var(--line)] px-[11px]">
            <span className="text-[10.5px] font-semibold tracking-[0.01em] text-[var(--ink)]">
              Tasks
            </span>
            <span className="font-mono text-[9px] tracking-[0.03em] text-[var(--faint)]">
              TOOLCHAIN
            </span>
          </div>
          <div className="mx-2 mb-1 mt-[7px] flex h-7 items-center gap-2 rounded-[2px] border border-[var(--line)] bg-[var(--panel-3)] px-2">
            <span aria-hidden className="text-[11px] text-[var(--faint)]">
              ⌕
            </span>
            <span className="truncate text-[11px] text-[var(--faint)]">
              Filter tasks…
            </span>
          </div>
          <div className="px-[5px] py-1.5">
            {OPS.map((op, index) => {
              // A rail row lights when the terminal has passed the point it
              // describes, so the two halves of the surface agree.
              const reached = shown > index;
              const active = shown === index + 1 && !done;
              return (
                <div
                  key={op.label}
                  className={`flex min-h-[34px] items-center gap-[7px] rounded-[2px] px-2 py-[5px] transition-colors duration-150 ${
                    active
                      ? "bg-[#0e1922] text-white shadow-[inset_2px_0_var(--cy)]"
                      : reached
                        ? "text-[var(--dim)]"
                        : "text-[var(--faint)]"
                  }`}
                >
                  <i
                    className={`size-[5px] shrink-0 rounded-[1px] ${
                      active
                        ? "bg-[var(--cy)]"
                        : reached
                          ? "bg-[#5c6873]"
                          : "bg-[#2a333c]"
                    }`}
                  />
                  <span className="flex min-w-0 flex-col">
                    <b className="truncate text-[11px] font-medium">
                      {op.label}
                    </b>
                    <small className="truncate text-[9px] text-[var(--faint)]">
                      {op.detail}
                    </small>
                  </span>
                </div>
              );
            })}
          </div>
        </aside>

        {/* ── terminal ── */}
        <div className="flex min-w-0 flex-col bg-[var(--panel-3)]">
          <div className="flex h-[30px] items-center bg-[var(--panel-2)]">
            <span className="flex h-full items-center border-r border-[var(--line)] px-3 font-mono text-[10px] text-[#f3f7fa] shadow-[inset_0_-1px_var(--cy)]">
              <span className="mr-[7px] text-[var(--cy)]">›_</span>
              console
            </span>
            <span className="ml-[9px] truncate font-mono text-[9px] tracking-[0.03em] text-[var(--faint)]">
              {recorded ? "recorded pass" : "live pass"}
            </span>
            {onRerun ? (
              <button
                type="button"
                onClick={() => {
                  onRerun();
                  replay();
                }}
                className="ml-auto h-full border-l border-[var(--line)] px-[13px] text-[9.5px] text-[#7a7d83] transition-colors hover:bg-[#0e151b] hover:text-[#f4f8fb] motion-reduce:transition-none"
              >
                RUN AGAIN
              </button>
            ) : null}
          </div>

          <div
            className={`min-h-[200px] flex-1 px-6 py-[18px] ${MONO} text-[12.5px] leading-[1.7]`}
          >
            {recorded ? (
              <p className="mb-3.5 border-l border-[#33424f] px-2.5 py-1.5 font-mono text-[10px] leading-[1.45] text-[#7f8b95]">
                One live pass per visitor a day, and today&rsquo;s is spent.
                What follows is the recorded one.
              </p>
            ) : null}

            {lines.slice(0, shown).map((line, index) => (
              <motion.p
                key={line}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.12 }}
                className={
                  index === 0 ? "text-[var(--cy)]" : "text-[var(--dim)]"
                }
              >
                <span className="mr-2 select-none text-[#3a4650]">$</span>
                {line}
              </motion.p>
            ))}

            {!done && !reduceMotion ? (
              <span className="inline-block h-[13px] w-[7px] animate-pulse bg-[var(--cy)] align-middle" />
            ) : null}

            {/*
             * The assessment report, as /hack actually renders it.
             *
             * A pass used to end here in a bordered list captioned
             * "FINDINGS · N", which is not what the product does. The real
             * surface closes a run with `.answer-report`: a kicker, a title
             * over the target, an evidence state chip, a four-up metric strip,
             * the answer, and two actions. That card is the thing a buyer is
             * actually being sold — the evidence, assembled — and the landing
             * was ending one step before it.
             *
             * Geometry is `.answer-report` in HackerMode's own stylesheet,
             * declaration for declaration: 6px radius on a #3b515c border, the
             * cyan-to-transparent 3px cap, an 18/18/14 head over a rule, a
             * four-column strip divided by --line2, 18px of copy, and a right
             * aligned action bar on black/18.
             *
             * ── The metrics are the probe's, not the product's ──
             *
             * The real card reads Findings / Critical / Services / Paths.
             * /api/landing-probe returns findings, openPorts and elapsed and
             * has no notion of severity or of enumerated paths, so two of
             * those four would have to be invented. On a page whose argument
             * is that its numbers can be checked, inventing two is worse than
             * showing four that are real — so the strip carries what the pass
             * measured and the labels say so.
             */}
            {done && findings.length ? (
              <article className="relative mt-4 overflow-hidden rounded-[6px] border border-[#3b515c] bg-[linear-gradient(145deg,rgba(168,217,255,.085),rgba(11,15,19,.96)_28%,rgba(6,8,10,.98))] shadow-[0_18px_48px_rgba(0,0,0,.3),inset_0_1px_rgba(255,255,255,.045)]">
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-[3px] bg-[linear-gradient(90deg,var(--cy),rgba(168,217,255,.2),transparent_78%)]"
                />

                <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] bg-black/[0.13] px-[18px] pb-[14px] pt-[18px]">
                  <div className="min-w-0">
                    <span className="mb-[5px] block font-mono text-[9px] font-bold tracking-[0.2em] text-[var(--cy)]">
                      ASSESSMENT REPORT
                    </span>
                    <h4 className="font-sans text-[20px] leading-[1.2] tracking-[-0.01em] text-white">
                      Assessment result
                    </h4>
                    <p className="mt-[5px] max-w-[460px] truncate font-mono text-[9.5px] tracking-[0.06em] text-[var(--faint)]">
                      {host}
                    </p>
                  </div>
                  <span className="mt-[3px] flex shrink-0 items-center gap-[7px] rounded-full border border-[rgba(143,169,154,.34)] px-2 py-1 font-mono text-[8.5px] font-bold tracking-[0.12em] text-[var(--grn)]">
                    <i
                      aria-hidden
                      className="size-1.5 rounded-full bg-[var(--grn)] shadow-[0_0_8px_rgba(143,169,154,.7)]"
                    />
                    EVIDENCE READY
                  </span>
                </header>

                <dl className="m-0 grid grid-cols-4 border-b border-[var(--line)]">
                  {[
                    { label: "Findings", value: findings.length },
                    { label: "Services", value: openPorts },
                    { label: "Evidence", value: shown },
                    { label: "Seconds", value: elapsed },
                  ].map((metric) => (
                    <div
                      key={metric.label}
                      className="flex min-w-0 items-center justify-between gap-[7px] border-r border-[var(--line2)] px-[13px] py-[10px] last:border-r-0"
                    >
                      <dt className="truncate font-mono text-[8.5px] uppercase tracking-[0.08em] text-[var(--faint)]">
                        {metric.label}
                      </dt>
                      <dd className="m-0 text-[15px] font-bold tabular-nums text-white">
                        {metric.value}
                      </dd>
                    </div>
                  ))}
                </dl>

                <div className="px-[18px] py-[18px]">
                  <ul className="flex flex-col gap-2">
                    {findings.map((finding) => (
                      <li
                        key={`${finding.title}-${finding.detail}`}
                        className="font-sans text-[13.5px] leading-[1.6] text-[#d9e1e5]"
                      >
                        <span className="text-white">{finding.title}</span>
                        <span className="text-[var(--faint)]"> · </span>
                        <span className="font-mono text-[11.5px]">
                          {finding.detail}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/*
                 * Links, not buttons. In the product these open the evidence
                 * overlay and print a PDF; neither exists for a visitor who is
                 * not signed in, and a control that looks live and does
                 * nothing is the one thing worse than not showing it. They go
                 * where the feature is.
                 */}
                <footer className="flex justify-end gap-[7px] border-t border-[var(--line)] bg-black/[0.18] px-3 py-2.5">
                  <a
                    href="/signup"
                    className="inline-flex min-h-8 items-center rounded-[3px] border border-[#3c4b53] bg-white/[0.02] px-2.5 py-1.5 font-mono text-[9px] font-bold tracking-[0.07em] text-[var(--dim)] transition-colors hover:border-[#64747c] hover:bg-white/[0.05] hover:text-white motion-reduce:transition-none"
                  >
                    OPEN EVIDENCE REPORT
                  </a>
                  <a
                    href="/signup"
                    className="inline-flex min-h-8 items-center rounded-[3px] border border-[var(--cy)] bg-[var(--cy)] px-2.5 py-1.5 font-mono text-[9px] font-bold tracking-[0.07em] text-[#041015] transition-opacity hover:opacity-90 motion-reduce:transition-none"
                  >
                    PRINT / SAVE PDF
                  </a>
                </footer>
              </article>
            ) : null}
          </div>
        </div>

        {/* ── status bar ── */}
        <div className="col-span-full flex h-[30px] items-center gap-4 border-t border-[var(--line)] bg-[var(--panel-2)] px-4 font-mono text-[9px] tracking-[0.04em] text-[var(--faint)]">
          <span>
            PHASE <b className="font-medium text-[#dbe2e8]">{phase}</b>
          </span>
          <span>
            HOST <b className="font-medium text-[#dbe2e8]">{host}</b>
          </span>
          <span className="hidden sm:inline">
            PORTS <b className="font-medium text-[#dbe2e8]">{openPorts}</b>
          </span>
          <span className="ml-auto">AUTHORISED TARGETS ONLY</span>
        </div>
      </div>
    </div>
  );
}
