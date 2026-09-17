"use client";

import { useMemo, useState } from "react";
import styles from "./RunsWorkbench.module.css";
import Link from "next/link";
import { useQuery } from "convex/react";
import { History, ExternalLink } from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  CodexPageShell,
  CodexPageHeader,
  CodexEmptyState,
} from "@/app/components/page-shell/CodexPageShell";
import { RunStatusBadge } from "@/components/ui/run-status-badge";
import {
  RUN_STATUS_FILTERS,
  matchesRunFilter,
  runStatusMeta,
  toRunStatus,
  type RunStatusFilterId,
} from "@/lib/runs/run-status";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { describeRunTiming, formatDuration } from "@/lib/runs/run-duration";

/**
 * Runs as a first-class destination.
 *
 * Runs already produced a durable record; nothing showed it. A user could not
 * answer "what did that agent actually do" without scrolling the conversation
 * it happened in, and a run that ended while they were on another page left no
 * trace at all.
 */

type FilterId = RunStatusFilterId | "all";

const SURFACE_LABEL: Record<string, string> = {
  build: "Build",
  studio: "Studio",
  hack: "Hack",
  task: "Task",
};

function formatCost(dollars?: number): string | undefined {
  if (typeof dollars !== "number" || dollars <= 0) return undefined;
  return dollars < 0.01 ? "<$0.01" : `$${dollars.toFixed(2)}`;
}

/** One fact on a Run card. Rendered only when the fact is actually known. */
function Fact({ label, value }: { label: string; value?: string | number }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1">
      <span className="shrink-0 text-muted-foreground/70">{label}</span>
      <span className="truncate text-muted-foreground">{value}</span>
    </span>
  );
}

type RunRow = {
  id: string;
  chat_id: string;
  status: string;
  surface?: string;
  goal?: string;
  phase?: string;
  model?: string;
  started_at: number;
  ended_at?: number;
  stop_reason?: string;
  finish_reason?: string;
  error?: string;
  cost_dollars?: number;
  total_tokens?: number;
  output_count?: number;
};

function RunCard({ run }: { run: RunRow }) {
  const status = toRunStatus(run.status);
  const meta = runStatusMeta(status);
  const timing = describeRunTiming(run);

  // Only explain an outcome that needs explaining. "Completed · stop" is noise;
  // "Failed · provider timeout" is the whole point of the row.
  const reason =
    status === "failed"
      ? run.error || run.finish_reason
      : status === "cancelled" && run.stop_reason === "user"
        ? "you stopped it"
        : undefined;

  return (
    <li>
      <Link
        href={`/runs/${encodeURIComponent(run.id)}`}
        className="group flex w-full flex-col gap-2 rounded-[14px] border border-white/[0.08] p-3.5 text-left transition-colors duration-(--duration-hover) hover:bg-accent/25 focus-visible:outline-none focus-visible:bg-accent/25"
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <span className="min-w-0 flex-1 truncate text-ui font-medium leading-5 tracking-[-0.1px] text-foreground">
            {run.goal?.trim() || "Untitled run"}
          </span>
          <RunStatusBadge
            status={status}
            reason={reason}
            className="shrink-0"
          />
        </div>

        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-ui-label leading-4">
          <Fact
            label=""
            value={SURFACE_LABEL[run.surface ?? ""] ?? undefined}
          />
          <Fact label="" value={run.model} />
          {/* A phase only means something while the run is still moving. */}
          {!meta.isTerminal ? <Fact label="phase" value={run.phase} /> : null}
          <Fact label={timing.label} value={timing.value} />
          <Fact label="" value={formatCost(run.cost_dollars)} />
          <Fact label="outputs" value={run.output_count} />
        </div>
      </Link>
    </li>
  );
}

export function RunsWorkbench() {
  const runs = useQuery(api.runs.listRuns, {});
  const [filter, setFilter] = useState<FilterId>("all");

  const counts = useMemo(() => {
    const result: Record<string, number> = { all: runs?.length ?? 0 };
    for (const entry of RUN_STATUS_FILTERS) {
      result[entry.id] = (runs ?? []).filter((run) =>
        matchesRunFilter(toRunStatus(run.status), entry.id),
      ).length;
    }
    return result;
  }, [runs]);

  const visible = useMemo(
    () =>
      (runs ?? []).filter((run) =>
        matchesRunFilter(toRunStatus(run.status), filter),
      ),
    [runs, filter],
  );

  const loading = runs === undefined;

  return (
    <CodexPageShell busy={loading}>
      <CodexPageHeader
        title="Runs"
        description="Every agent run, what it did, and the evidence it left behind."
        leading={
          <History
            aria-hidden
            className="mt-1 size-5 shrink-0 text-muted-foreground"
            strokeWidth={1.7}
          />
        }
      />

      <div
        role="group"
        aria-label="Filter runs by status"
        className="mb-5 flex flex-wrap gap-1.5"
      >
        {[{ id: "all" as const, label: "All" }, ...RUN_STATUS_FILTERS].map(
          (entry) => {
            const active = filter === entry.id;
            const count = counts[entry.id] ?? 0;
            return (
              <button
                key={entry.id}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(entry.id as FilterId)}
                className={cn(
                  styles.filter,
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-ui-nav leading-4 transition-colors duration-(--duration-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/60",
                  active
                    ? "bg-sidebar-accent text-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )}
              >
                {entry.label}
                {/* A zero is worth showing: it answers the question the filter
                    asks without making the user click it. */}
                <span className="tabular-nums text-muted-foreground/70">
                  {count}
                </span>
              </button>
            );
          },
        )}
      </div>

      {loading ? (
        <div className="space-y-2" role="status" aria-label="Loading runs">
          <span className="sr-only">Loading runs…</span>
          {[0, 1, 2].map((index) => (
            <Skeleton
              key={index}
              aria-hidden
              className="h-[74px] w-full rounded-[14px] motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <CodexEmptyState
          icon={<History className="size-4" strokeWidth={1.7} aria-hidden />}
          title={filter === "all" ? "No runs yet" : "Nothing in this filter"}
          description={
            filter === "all"
              ? "Start a Build, Studio or Hack session and it will be recorded here with its full event log."
              : "No run currently has this status. Choose another filter to see the rest."
          }
        />
      ) : (
        <ul className="space-y-2">
          {visible.map((run) => (
            <RunCard key={run.id} run={run as RunRow} />
          ))}
        </ul>
      )}
    </CodexPageShell>
  );
}

export { SURFACE_LABEL, formatDuration, formatCost };
