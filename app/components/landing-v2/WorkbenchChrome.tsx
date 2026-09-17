"use client";

import { ArrowLeft, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import { RiftLogo } from "@/components/icons/rift-logo";

/**
 * Hack Workbench's shell, as the product draws it.
 *
 * Two places on the landing page show this surface — the hero's replica of the
 * workspace, and the section further down where it runs an assessment on a loop
 * — and they must be the same interface, not two impressions of one. So the
 * chrome lives here and both import it: the titlebar with its way back to the
 * app, the scope line that has to be filled before anything can run, the three
 * status cards, and the terminal tab strip.
 *
 * Its art direction is deliberately its own. The workbench does not inherit the
 * workspace's appearance tokens in the product either — it is a lab, and it
 * looks like one.
 */

export const WORKBENCH_SURFACE_CLASS =
  "flex min-w-0 flex-1 flex-col bg-[#050506] font-sans text-[#e8e8ea]";

export function WorkbenchTitleBar({ onExit }: { onExit?: () => void }) {
  return (
    <>
      <div className="flex items-center gap-2.5 px-3 pb-1.5 pt-2.5">
        {onExit ? (
          <button
            type="button"
            onClick={onExit}
            className="flex items-center gap-1 rounded-[6px] border border-white/12 px-1.5 py-0.5 font-mono text-[9.5px] tracking-[0.08em] text-white/70 transition-colors hover:text-white motion-reduce:transition-none"
          >
            <ArrowLeft aria-hidden className="size-2.5" strokeWidth={1.8} />
            APP
          </button>
        ) : (
          <span className="flex items-center gap-1 rounded-[6px] border border-white/12 px-1.5 py-0.5 font-mono text-[9.5px] tracking-[0.08em] text-white/70">
            <ArrowLeft aria-hidden className="size-2.5" strokeWidth={1.8} />
            APP
          </span>
        )}
        <RiftLogo size={13} className="text-white" />
        <span className="text-[12.5px] font-semibold text-white">
          RIFT Hack Workbench
        </span>
        <span className="rounded-[5px] border border-white/12 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.08em] text-white/70">
          &gt;_ AGENT
        </span>
        <span className="ml-auto hidden items-center gap-3 font-mono text-[9.5px] text-white/55 sm:flex">
          {["Container Isolation", "Secure Evidence", "Multi-tool Agent"].map(
            (label) => (
              <span key={label} className="flex items-center gap-1">
                <ShieldCheck
                  aria-hidden
                  className="size-2.5"
                  strokeWidth={1.5}
                />
                {label}
              </span>
            ),
          )}
        </span>
      </div>
      <p className="px-3 pb-2 pl-[52px] text-[10px] text-white/45">
        Authorized security assessment and evidence orchestration
      </p>
    </>
  );
}

export function WorkbenchScopeBar({
  target,
  state,
  elapsed,
  caret = false,
}: {
  target: string;
  state: string;
  elapsed: string;
  /** Draw a blinking caret after the target, while it is being typed. */
  caret?: boolean;
}) {
  return (
    <div className="mx-3 flex items-center gap-2 rounded-[7px] border border-white/10 bg-black/50 px-2 py-1">
      <span className="font-mono text-[9.5px] tracking-[0.08em] text-white/45">
        &rsaquo; SCOPE
      </span>
      <span className="min-w-0 truncate font-mono text-[11.5px] text-white">
        {target || <span className="text-white/25">target…</span>}
        {caret ? (
          <span
            aria-hidden
            className="ml-px inline-block h-[11px] w-[6px] translate-y-[1px] bg-white/70"
          />
        ) : null}
      </span>
      <span className="ml-auto shrink-0 rounded-[5px] border border-white/15 px-2 py-0.5 text-[10px] text-white/85">
        Run Selected
      </span>
      <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-white/55">
        <span
          aria-hidden
          className={`size-1.5 ${state === "Running" ? "bg-[#7fb0e8]" : "bg-white/60"}`}
        />
        {state}
        <span className="text-white/35">T+ {elapsed}</span>
      </span>
    </div>
  );
}

export type WorkbenchStat = { label: string; value: string; accent?: boolean };

export type WorkbenchCard = {
  title: string;
  badge: string;
  stats: WorkbenchStat[];
  meter: string;
  percent: number;
};

export function WorkbenchCards({ cards }: { cards: WorkbenchCard[] }) {
  return (
    <div className="grid grid-cols-3 gap-2 px-3 py-2">
      {cards.map((card) => (
        <div
          key={card.title}
          className="rounded-[8px] border border-white/10 bg-white/[0.02] px-2.5 py-2"
        >
          <div className="flex items-center gap-1.5">
            <span className="text-[11.5px] font-medium text-white">
              {card.title}
            </span>
            <span className="rounded-[4px] border border-white/12 px-1 py-px font-mono text-[8px] tracking-[0.08em] text-white/60">
              {card.badge}
            </span>
          </div>
          <dl className="mt-1.5 grid grid-cols-3 gap-x-2 gap-y-1.5">
            {card.stats.map((stat) => (
              <div key={stat.label}>
                <dt className="text-[8.5px] text-white/40">{stat.label}</dt>
                {/* Tabular figures: these count up, and proportional digits
                    would make every card twitch sideways as they do. */}
                <dd
                  className={`font-mono text-[11px] tabular-nums ${
                    stat.accent ? "text-[#d9b06a]" : "text-white"
                  }`}
                >
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-2 flex items-center justify-between text-[8.5px] text-white/40">
            {card.meter}
            <span className="font-mono tabular-nums">{card.percent}%</span>
          </div>
          <div className="mt-1 h-px w-full bg-white/10">
            <div
              className="h-px bg-[#7fb0e8] transition-[width] duration-300 ease-out motion-reduce:transition-none"
              style={{ width: `${card.percent}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function WorkbenchTabRow({
  path,
  lines,
  findings,
  reportReady = false,
}: {
  path: string;
  lines: number;
  findings: number;
  reportReady?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 border-y border-white/10 px-3 py-1.5 font-mono text-[10px]">
      <span className="border-b border-white/70 pb-0.5 text-white">
        &gt;_ rift / hack
      </span>
      <span className="text-white/45">{path}</span>
      <span className="tabular-nums text-white/35">{lines} lines</span>
      <span className="ml-auto tabular-nums text-white/45">
        Findings {findings}
      </span>
      <span className={reportReady ? "text-[#7fb0e8]" : "text-white/70"}>
        Open Report
      </span>
    </div>
  );
}

export function WorkbenchStatusBar({
  target,
  children,
}: {
  target: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 border-t border-white/10 px-3 py-1 font-mono text-[9px] text-white/40">
      {children ?? (
        <>
          <span className="text-white/60">Shift+Tab mode</span>
          <span>Ctrl+B tasks</span>
          <span>ready</span>
        </>
      )}
      <span className="ml-auto truncate">
        RIFT (high) · sandboxed · {target}
      </span>
    </div>
  );
}
