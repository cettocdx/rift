"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

import {
  WORKBENCH_SURFACE_CLASS,
  WorkbenchCards,
  WorkbenchScopeBar,
  WorkbenchStatusBar,
  WorkbenchTabRow,
  WorkbenchTitleBar,
} from "./WorkbenchChrome";

/**
 * An assessment running, on a loop.
 *
 * The section used to open on a screenshot, which is the one thing a security
 * tool should not be sold with: a still frame proves nothing about whether the
 * tools run. This is the workbench itself, playing a full assessment — the
 * scope typed in, discovery, enumeration, findings arriving unverified, two of
 * them thrown out under verification, and the report existing only at the end.
 * Then it starts again. No play button, because a reader should not have to ask
 * for the evidence.
 *
 * The order is the product's order, and the tools are the ones it ships. The
 * target is nmap's own public test host, which exists to be scanned. The
 * figures are a plausible run rather than a recording of one, and the caption
 * on the page says so — a security tool whose demo can be mistaken for a real
 * result has already taught the wrong lesson.
 *
 * Costs nothing when nobody is looking: the timer only runs while the panel is
 * on screen, and reduced motion gets the finished state with no loop at all.
 */

const TARGET = "scanme.nmap.org";
const TICK_MS = 70;

/** Frame numbers, so every panel below can be read from one clock. */
const T = {
  typeStart: 6,
  typeEnd: 6 + TARGET.length * 2,
  discover: 60,
  enumerate: 110,
  assess: 165,
  verify: 225,
  report: 268,
  end: 300,
  hold: 46,
};

type LogLine = { at: number; tool: string; text: string };

/** Real tools, in the order the workbench runs them. */
const LOG: LogLine[] = [
  { at: 62, tool: "nmap", text: "-sV -Pn --top-ports 1000 scanme.nmap.org" },
  { at: 78, tool: "nmap", text: "45.33.32.156 · 4 open ports" },
  { at: 96, tool: "dig", text: "A scanme.nmap.org → 45.33.32.156" },
  {
    at: 114,
    tool: "whatweb",
    text: "Apache/2.4.7 · Ubuntu · X-Powered-By absent",
  },
  { at: 132, tool: "ffuf", text: "-w common.txt · 2 paths (200)" },
  { at: 150, tool: "nikto", text: "server headers · 6 checks" },
  { at: 170, tool: "nuclei", text: "-t http/misconfiguration · 14 templates" },
  { at: 188, tool: "nuclei", text: "missing-hsts · medium" },
  { at: 204, tool: "nuclei", text: "dir-listing · low" },
  {
    at: 228,
    tool: "verify",
    text: "re-running 5 candidates with evidence capture",
  },
  { at: 244, tool: "verify", text: "2 discarded · not reproducible" },
  { at: 272, tool: "report", text: "evidence.md · 3 findings, 41 lines" },
];

type Finding = {
  at: number;
  severity: "medium" | "low" | "info";
  title: string;
  discardedAt?: number;
};

const FINDINGS: Finding[] = [
  { at: 188, severity: "medium", title: "HSTS not set on the origin" },
  { at: 196, severity: "low", title: "Server banner discloses version" },
  { at: 204, severity: "low", title: "Directory listing enabled on /shared" },
  {
    at: 212,
    severity: "info",
    title: "TRACE method responds",
    discardedAt: 240,
  },
  {
    at: 218,
    severity: "info",
    title: "Weak cipher advertised",
    discardedAt: 244,
  },
];

const PHASES = [
  { at: 0, label: "READY" },
  { at: T.discover, label: "DISCOVER" },
  { at: T.enumerate, label: "ENUMERATE" },
  { at: T.assess, label: "ASSESS" },
  { at: T.verify, label: "VERIFY" },
  { at: T.report, label: "REPORT" },
];

/** Count from 0 to `to` between two frames, eased so it settles rather than stops. */
function ramp(frame: number, from: number, to: number, value: number) {
  if (frame <= from) return 0;
  if (frame >= to) return value;
  const t = (frame - from) / (to - from);
  return Math.round(value * (t * t * (3 - 2 * t)));
}

function elapsedLabel(frame: number) {
  const seconds = Math.max(0, Math.round((frame * TICK_MS) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function WorkbenchLive() {
  const reduceMotion = useReducedMotion();
  const [tick, setTick] = useState(0);
  const hostRef = useRef<HTMLDivElement | null>(null);

  // Derived, not seeded: useReducedMotion resolves after the first render, so a
  // state initialiser reading it would have left the panel frozen on frame zero
  // for exactly the readers who need the finished state.
  const frame = reduceMotion ? T.end : tick;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || reduceMotion) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (timer) return;
          timer = setInterval(() => {
            setTick((previous) =>
              previous >= T.end + T.hold ? 0 : previous + 1,
            );
          }, TICK_MS);
        } else if (timer) {
          clearInterval(timer);
          timer = null;
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(host);
    return () => {
      observer.disconnect();
      if (timer) clearInterval(timer);
    };
  }, [reduceMotion]);

  const typed = Math.max(
    0,
    Math.min(TARGET.length, Math.floor((frame - T.typeStart) / 2)),
  );
  const target = TARGET.slice(0, typed);
  const typing = frame >= T.typeStart && frame < T.typeEnd;
  const running = frame >= T.discover && frame < T.report;

  const phase =
    [...PHASES].reverse().find((entry) => frame >= entry.at) ?? PHASES[0];

  const hosts = ramp(frame, T.discover, T.discover + 22, 1);
  const services = ramp(frame, T.discover + 10, T.enumerate + 20, 4);
  const endpoints = ramp(frame, T.enumerate, T.assess, 14);
  const evidence = ramp(frame, T.assess, T.report + 20, 41);

  const shown = FINDINGS.filter((finding) => frame >= finding.at);
  const live = shown.filter(
    (finding) => !finding.discardedAt || frame < finding.discardedAt,
  );
  const discarded = shown.length - live.length;
  const medium = live.filter((f) => f.severity === "medium").length;
  const low = live.filter((f) => f.severity === "low").length;

  const logLines = LOG.filter((line) => frame >= line.at).slice(-7);

  const scopeReady = target.length === TARGET.length;
  const posture =
    frame >= T.report ? "GRADED" : frame >= T.verify ? "VERIFYING" : "PENDING";

  const cards = [
    {
      title: "Attack surface",
      badge: scopeReady ? "AUTHORIZED" : "AWAITING SCOPE",
      stats: [
        { label: "Hosts", value: String(hosts) },
        { label: "Services", value: String(services) },
        { label: "Endpoints", value: String(endpoints) },
        {
          label: "Resolved IP",
          value: frame >= T.discover + 18 ? "45.33.32.156" : "—",
        },
        { label: "Phase", value: phase.label, accent: true },
        { label: "Target", value: scopeReady ? "scanme…" : "—" },
      ],
      meter: "Scope readiness",
      percent: scopeReady ? (frame >= T.enumerate ? 100 : 50) : 0,
    },
    {
      title: "Verified risk",
      badge: posture === "GRADED" ? "GRADED" : "PENDING",
      stats: [
        { label: "Findings", value: String(live.length) },
        { label: "Critical", value: "0" },
        { label: "High", value: "0" },
        { label: "Medium", value: String(medium) },
        { label: "Low", value: String(low) },
        { label: "Posture", value: posture },
      ],
      meter: discarded > 0 ? `${discarded} discarded` : "Awaiting evidence",
      percent:
        frame >= T.report
          ? 100
          : frame >= T.verify
            ? 70
            : frame >= T.assess
              ? 35
              : 0,
    },
    {
      title: "Agent session",
      badge: running ? "RUNNING" : frame >= T.report ? "COMPLETE" : "READY",
      stats: [
        { label: "Tasks", value: "50" },
        { label: "Model", value: "RIFT" },
        { label: "Mode", value: "AGENT" },
        { label: "State", value: running ? "RUNNING" : "READY" },
        { label: "Runtime", value: elapsedLabel(frame) },
        { label: "Evidence", value: `${evidence} lines` },
      ],
      meter: "Toolchain available",
      percent: 100,
    },
  ];

  return (
    <div
      ref={hostRef}
      className="rounded-[14px] border border-white/[0.05] bg-white/[0.015] p-1.5"
    >
      <div className="overflow-hidden rounded-[11px] border border-white/[0.07]">
        <div className={WORKBENCH_SURFACE_CLASS}>
          <WorkbenchTitleBar />
          <WorkbenchScopeBar
            target={target}
            state={
              running ? "Running" : frame >= T.report ? "Complete" : "Ready"
            }
            elapsed={elapsedLabel(frame)}
            caret={typing}
          />
          <WorkbenchCards cards={cards} />
          <WorkbenchTabRow
            path={`~/security/${phase.label.toLowerCase()}`}
            lines={evidence}
            findings={live.length}
            reportReady={frame >= T.report}
          />

          <div className="grid min-h-[168px] grid-cols-[1fr_290px] gap-0">
            {/* The tool log: what actually ran, in the order it ran. */}
            <ol className="min-w-0 space-y-1 px-3 py-2 font-mono text-[10.5px]">
              {logLines.map((line) => (
                <li key={line.at} className="flex min-w-0 gap-2">
                  <span className="shrink-0 text-[#7fb0e8]">{line.tool}</span>
                  <span className="truncate text-white/55">{line.text}</span>
                </li>
              ))}
              {running ? (
                <li aria-hidden className="text-white/30">
                  <span className="inline-block h-[10px] w-[6px] animate-pulse bg-white/40 align-middle" />
                </li>
              ) : null}
            </ol>

            <div className="border-l border-white/10 px-3 py-2">
              <p className="font-mono text-[9px] tracking-[0.14em] text-white/40">
                FINDINGS
              </p>
              <ul className="mt-1.5 space-y-1">
                {shown.map((finding) => {
                  const dropped =
                    finding.discardedAt !== undefined &&
                    frame >= finding.discardedAt;
                  return (
                    <li
                      key={finding.title}
                      className={`flex items-start gap-1.5 text-[10.5px] leading-4 transition-opacity duration-300 motion-reduce:transition-none ${
                        dropped ? "opacity-35" : ""
                      }`}
                    >
                      <span
                        className={`mt-[3px] size-1.5 shrink-0 ${
                          dropped
                            ? "bg-white/25"
                            : finding.severity === "medium"
                              ? "bg-[#d9b06a]"
                              : finding.severity === "low"
                                ? "bg-[#7fb0e8]"
                                : "bg-white/40"
                        }`}
                      />
                      <span
                        className={`min-w-0 ${dropped ? "text-white/40 line-through" : "text-white/75"}`}
                      >
                        {finding.title}
                      </span>
                    </li>
                  );
                })}
                {shown.length === 0 ? (
                  <li className="text-[10.5px] leading-4 text-white/35">
                    Nothing runs until a scope is declared.
                  </li>
                ) : null}
              </ul>
              {discarded > 0 ? (
                <p className="mt-2 text-[10px] text-white/40">
                  {discarded} discarded under verification — not reproducible.
                </p>
              ) : null}
            </div>
          </div>

          <WorkbenchStatusBar target={TARGET}>
            <span className="text-white/60">{phase.label}</span>
            <span>{live.length} findings</span>
            <span>{evidence} lines</span>
          </WorkbenchStatusBar>
        </div>
      </div>
    </div>
  );
}
