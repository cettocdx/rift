"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { ArrowLeft, FileSearch, MessageSquare } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  CodexPageShell,
  CodexPageHeader,
  CodexEmptyState,
} from "@/app/components/page-shell/CodexPageShell";
import { RunStatusBadge } from "@/components/ui/run-status-badge";
import { runStatusMeta, toRunStatus } from "@/lib/runs/run-status";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { SURFACE_LABEL, formatCost } from "./RunsWorkbench";
import { describeRunTiming } from "@/lib/runs/run-duration";
import { cn } from "@/lib/utils";
import { purposeChatPath } from "@/lib/navigation/chat-routes";

/**
 * One run's ordered event log, and the evidence each event points at.
 *
 * This is what makes a run reviewable after the fact: the log is server
 * ordered, so it reads the same on a reload as it did live, and the evidence
 * survives the compaction that shrinks the message the run produced.
 */

const SEVERITY_TONE: Record<string, string> = {
  critical: "text-[var(--destructive)]",
  high: "text-[var(--destructive)]",
  medium: "text-[var(--warning)]",
  low: "text-muted-foreground",
  info: "text-muted-foreground",
};

function runDestinationHref(surface: string | undefined, chatId?: string) {
  const id = chatId?.trim();
  if (!id) return null;
  if (surface === "hack") {
    // Match the session contract in /hack. An invalid id there starts a new
    // session, which would misleadingly discard the run the user came from.
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      )
    ) {
      return null;
    }
    return `/hack?${new URLSearchParams({ session: id })}`;
  }
  return purposeChatPath(
    surface === "studio" ? "image" : "app",
    encodeURIComponent(id),
  );
}

function EvidenceBody({ evidenceId }: { evidenceId: Id<"evidence"> }) {
  const evidence = useQuery(api.runs.getEvidence, { evidenceId });

  if (evidence === undefined) {
    return (
      <Skeleton
        aria-label="Loading evidence"
        className="h-16 w-full rounded-md motion-reduce:animate-none"
      />
    );
  }

  if (evidence === null) {
    return (
      <p className="text-ui-nav text-muted-foreground">
        This evidence is no longer available.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {evidence.command ? (
        <div className="overflow-x-auto rounded-md bg-accent/40 px-2.5 py-1.5">
          <code className="whitespace-pre text-ui-label leading-5 text-foreground">
            {evidence.command}
          </code>
        </div>
      ) : null}

      <div className="max-h-[420px] overflow-auto rounded-md bg-accent/25 px-2.5 py-2">
        <pre className="whitespace-pre-wrap break-words font-mono text-ui-label leading-5 text-muted-foreground">
          {evidence.content}
        </pre>
      </div>

      {evidence.truncated ? (
        // Say so rather than letting a reader believe they have the whole thing.
        <p className="text-ui-label text-muted-foreground/80">
          Truncated for storage — {Math.round(evidence.byte_size / 1024)} KB
          originally.
        </p>
      ) : null}
    </div>
  );
}

type RunEventRow = {
  seq: number;
  type: string;
  at: number;
  summary?: string;
  tool_name?: string;
  tool_call_id?: string;
  severity?: string;
  exit_code?: number;
  duration_ms?: number;
  evidence_id?: Id<"evidence">;
};

function EventRow({ event }: { event: RunEventRow }) {
  const [open, setOpen] = useState(false);
  const failed = typeof event.exit_code === "number" && event.exit_code !== 0;
  const hasEvidence = Boolean(event.evidence_id);

  return (
    <li className="border-b border-white/[0.06] last:border-b-0">
      <div className="flex min-w-0 items-baseline gap-2.5 py-2">
        <span className="w-8 shrink-0 text-right font-mono text-ui-caption tabular-nums text-muted-foreground/50">
          {event.seq}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span
              className={cn(
                "min-w-0 truncate text-ui leading-5 text-foreground",
                event.severity ? SEVERITY_TONE[event.severity] : undefined,
              )}
            >
              {event.summary || event.type}
            </span>

            {failed ? (
              <span className="shrink-0 text-ui-label text-[var(--destructive)]">
                exit {event.exit_code}
              </span>
            ) : null}

            {typeof event.duration_ms === "number" &&
            event.duration_ms >= 1000 ? (
              <span className="shrink-0 text-ui-label tabular-nums text-muted-foreground">
                {(event.duration_ms / 1000).toFixed(1)}s
              </span>
            ) : null}
          </div>
        </div>

        {hasEvidence ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="shrink-0 rounded px-1.5 py-0.5 text-ui-label text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:text-foreground"
          >
            {open ? "Hide evidence" : "Evidence"}
          </button>
        ) : null}
      </div>

      {open && event.evidence_id ? (
        <div className="pb-3 pl-[42px] pr-1">
          <EvidenceBody evidenceId={event.evidence_id} />
        </div>
      ) : null}
    </li>
  );
}

export function RunDetail({ runId }: { runId: string }) {
  const data = useQuery(api.runs.getRunLog, { runId });
  const loading = data === undefined;
  const run = data?.run ?? null;
  const events = data?.events ?? [];

  if (loading) {
    return (
      <CodexPageShell busy>
        <div role="status" aria-label="Loading run">
          <span className="sr-only">Loading run…</span>
          <Skeleton className="mb-4 h-7 w-64 motion-reduce:animate-none" />
          <Skeleton className="h-48 w-full motion-reduce:animate-none" />
        </div>
      </CodexPageShell>
    );
  }

  if (!run) {
    return (
      <CodexPageShell>
        <CodexEmptyState
          icon={<FileSearch className="size-4" strokeWidth={1.7} aria-hidden />}
          title="Run not found"
          description="This run does not exist, or it belongs to another account."
          action={
            <Button asChild size="sm" variant="outline">
              <Link href="/runs">Back to runs</Link>
            </Button>
          }
        />
      </CodexPageShell>
    );
  }

  const status = toRunStatus(run.status);
  const meta = runStatusMeta(status);
  // getRunLog returns the first 500 events by default. A full page may omit
  // newer events, so it cannot establish the run's last recorded activity.
  const lastActivityAt =
    events.length > 0 && events.length < 500
      ? Math.max(...events.map((event) => event.at))
      : undefined;
  const timing = describeRunTiming(run, lastActivityAt);
  const destinationHref = runDestinationHref(run.surface, run.chat_id);

  return (
    <CodexPageShell>
      <Link
        href="/runs"
        className="mb-4 inline-flex items-center gap-1.5 text-ui-nav text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        Runs
      </Link>

      <CodexPageHeader
        title={run.goal?.trim() || "Untitled run"}
        description={
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <RunStatusBadge
              status={status}
              timestamp={run.ended_at ?? run.started_at}
              reason={
                status === "failed"
                  ? run.error || run.finish_reason
                  : status === "cancelled" && run.stop_reason === "user"
                    ? "you stopped it"
                    : undefined
              }
            />
            {run.surface ? (
              <span className="text-muted-foreground">
                {SURFACE_LABEL[run.surface] ?? run.surface}
              </span>
            ) : null}
            {run.model ? (
              <span className="text-muted-foreground">{run.model}</span>
            ) : null}
            <span className="text-muted-foreground">
              {timing.label} {timing.value}
            </span>
            {formatCost(run.cost_dollars) ? (
              <span className="text-muted-foreground">
                {formatCost(run.cost_dollars)}
              </span>
            ) : null}
            {typeof run.total_tokens === "number" && run.total_tokens > 0 ? (
              <span className="text-muted-foreground">
                {run.total_tokens.toLocaleString()} tokens
              </span>
            ) : null}
          </span>
        }
        actions={
          destinationHref ? (
            <Button asChild size="sm" variant="outline">
              <Link href={destinationHref}>
                <MessageSquare aria-hidden className="size-3.5" />
                {run.surface === "hack"
                  ? "Open Hack session"
                  : "Open conversation"}
              </Link>
            </Button>
          ) : undefined
        }
      />

      {events.length === 0 ? (
        <CodexEmptyState
          icon={<FileSearch className="size-4" strokeWidth={1.7} aria-hidden />}
          title="No recorded events"
          description={
            meta.isTerminal
              ? "This run finished without a detailed event log. Open its conversation to read the response."
              : "This run has not recorded an event yet."
          }
        />
      ) : (
        <section aria-label="Run event log">
          <ul className="rounded-[14px] border border-white/[0.08] px-3">
            {events.map((event) => (
              <EventRow key={event.seq} event={event as RunEventRow} />
            ))}
          </ul>
        </section>
      )}
    </CodexPageShell>
  );
}
