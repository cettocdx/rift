/**
 * Scheduled ops alerts over the `runs` table.
 *
 * Per-run failure alerts fire from the worker (lib/ops/alerts.ts). They can
 * not see the two things that actually took production down: a *rate* of
 * failures that individually look like noise (today's incident was every run
 * failing the same way for hours -- OpenRouter 402, $0.66 left -- while each
 * one was filed under "provider error"), and runs that never fail because no
 * worker ever picks them up. Both are only visible from the database, on a
 * clock, which is what a Convex cron is.
 *
 * Two jobs live here:
 * - `checkFailureRate` every 15 minutes: fail ratio over the last cron
 *   window plus a count of runs still open past ten minutes. The window
 *   equals the cadence so each run is counted exactly once and a bad quarter
 *   hour pages once, not four times.
 * - `dailyRunDigest` at 08:00 UTC: the "was yesterday healthy" summary from
 *   lib/ops/run-digest.ts.
 *
 * Both read the table through one projected internal query that drops the
 * user's goal text and ids; Slack gets counts and short error shapes only.
 * If OPS_ALERT_WEBHOOK_URL is unset, `postOpsAlert` logs once and returns,
 * so this file is safe to deploy before the webhook exists.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { postOpsAlert, type OpsAlert } from "../lib/ops/alerts";
import {
  buildRunDigest,
  formatDigestText,
  normalizeErrorMessage,
  shouldAlertFailureRate,
  type DigestRun,
} from "../lib/ops/run-digest";
import { RUN_STATUS_META, toRunStatus } from "../lib/runs/run-status";

/** Cron cadence of the failure-rate check; also its look-back window. */
export const FAILURE_RATE_WINDOW_MS = 15 * 60 * 1_000;
/** A non-terminal run without `ended_at` older than this counts as stuck. */
export const STUCK_AFTER_MS = 10 * 60 * 1_000;
/**
 * How far back to look for stuck runs. Past the worker ceiling plus grace
 * the reconciler in crons.ts closes them, so older rows are already handled.
 */
export const STUCK_LOOKBACK_MS = 75 * 60 * 1_000;
export const DIGEST_WINDOW_MS = 24 * 60 * 60 * 1_000;
/** Hard cap on rows one query returns. Well above a day of real traffic. */
export const OPS_RUNS_SCAN_LIMIT = 5_000;
export const TOP_ERRORS_IN_ALERT = 3;
export const ERROR_SNIPPET_MAX_CHARS = 120;

const opsRunValidator = v.object({
  status: v.string(),
  started_at: v.number(),
  ended_at: v.optional(v.number()),
  cost_dollars: v.optional(v.number()),
  total_tokens: v.optional(v.number()),
  finish_reason: v.optional(v.string()),
  stop_reason: v.optional(v.string()),
  error: v.optional(v.string()),
  surface: v.optional(v.string()),
  model: v.optional(v.string()),
});

const clipError = (error: unknown): string | undefined => {
  if (typeof error !== "string") return undefined;
  const flat = error.replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  return flat.length > ERROR_SNIPPET_MAX_CHARS
    ? flat.slice(0, ERROR_SNIPPET_MAX_CHARS)
    : flat;
};

/** Projects a `runs` row down to what the ops jobs need. Exported for tests. */
export function projectRunForOps(row: {
  status: string;
  started_at: number;
  ended_at?: number;
  cost_dollars?: number;
  total_tokens?: number;
  finish_reason?: string;
  stop_reason?: string;
  error?: string;
  surface?: string;
  model?: string;
}): DigestRun {
  const projected: DigestRun = {
    status: row.status,
    started_at: row.started_at,
  };
  if (typeof row.ended_at === "number") projected.ended_at = row.ended_at;
  if (typeof row.cost_dollars === "number") projected.cost_dollars = row.cost_dollars;
  if (typeof row.total_tokens === "number") projected.total_tokens = row.total_tokens;
  if (typeof row.finish_reason === "string") projected.finish_reason = row.finish_reason;
  if (typeof row.stop_reason === "string") projected.stop_reason = row.stop_reason;
  if (typeof row.surface === "string") projected.surface = row.surface;
  if (typeof row.model === "string") projected.model = row.model;
  const error = clipError(row.error);
  if (error) projected.error = error;
  return projected;
}

/**
 * Runs started at or after `sinceMs`, newest first, projected. Uses the
 * `by_started_at` index so the scan is bounded by the window, not the table.
 */
export const recentRunsForOps = internalQuery({
  args: { sinceMs: v.number(), limit: v.optional(v.number()) },
  returns: v.array(opsRunValidator),
  handler: async (ctx, args) => {
    const limit = Math.min(
      Math.max(1, Math.floor(args.limit ?? OPS_RUNS_SCAN_LIMIT)),
      OPS_RUNS_SCAN_LIMIT,
    );
    const rows = await ctx.db
      .query("runs")
      .withIndex("by_started_at", (q) => q.gte("started_at", args.sinceMs))
      .order("desc")
      .take(limit);
    return rows.map(projectRunForOps);
  },
});

export interface FailureRateSummary {
  /** Runs started inside the failure-rate window. */
  total: number;
  failed: number;
  /** Non-terminal, never ended, older than STUCK_AFTER_MS (any look-back). */
  stuck: number;
  topErrors: Array<{ message: string; count: number }>;
}

/**
 * Pure aggregation over projected rows. `windowStart` bounds the rate; stuck
 * detection considers every row handed in, since a stuck run may have
 * started long before the current window.
 */
export function summarizeRecentRuns(
  runs: DigestRun[],
  input: { now: number; windowStart: number; stuckAfterMs?: number },
): FailureRateSummary {
  const stuckAfter = input.stuckAfterMs ?? STUCK_AFTER_MS;
  const errorCounts = new Map<string, number>();
  let total = 0;
  let failed = 0;
  let stuck = 0;

  for (const run of runs) {
    const status = toRunStatus(run.status);
    if (
      !RUN_STATUS_META[status].isTerminal &&
      run.ended_at === undefined &&
      input.now - run.started_at > stuckAfter
    ) {
      stuck += 1;
    }

    if (run.started_at < input.windowStart || run.started_at > input.now) continue;
    total += 1;
    if (status === "failed") {
      failed += 1;
      if (run.error) {
        const key = normalizeErrorMessage(run.error);
        if (key) errorCounts.set(key, (errorCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const topErrors = [...errorCounts.entries()]
    .map(([message, count]) => ({ message, count }))
    .sort((a, b) => b.count - a.count || a.message.localeCompare(b.message))
    .slice(0, TOP_ERRORS_IN_ALERT);

  return { total, failed, stuck, topErrors };
}

export function buildFailureRateAlert(
  summary: FailureRateSummary,
  input: { windowMs: number },
): OpsAlert {
  const pct =
    summary.total > 0
      ? ((summary.failed / summary.total) * 100).toFixed(0)
      : "0";
  const minutes = Math.round(input.windowMs / 60_000);
  const fields: OpsAlert["fields"] = [
    { label: "Window", value: `last ${minutes} min` },
    { label: "Runs", value: String(summary.total) },
    { label: "Failed", value: `${summary.failed} (${pct}%)` },
  ];
  if (summary.stuck > 0) {
    fields.push({
      label: "Open > 10 min",
      value: `${summary.stuck} (starting/running, never ended)`,
    });
  }
  summary.topErrors.forEach((entry, index) => {
    fields.push({
      label: `Error ${index + 1}`,
      value: `${entry.count}× ${entry.message}`,
    });
  });
  return {
    title: `Agent failure rate ${pct}% (${summary.failed}/${summary.total}) in the last ${minutes} min`,
    severity: summary.failed === summary.total ? "critical" : "warning",
    fields,
  };
}

/**
 * Turns the plain-text digest into label/value pairs so the Slack grid stays
 * scannable. Lines are "Label: rest"; the bullet lines under "Top errors:"
 * fold into that entry.
 */
export function digestTextToFields(text: string): OpsAlert["fields"] {
  const fields: OpsAlert["fields"] = [];
  let current: { label: string; value: string } | null = null;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    if (/^\s+•/.test(line)) {
      if (current) {
        current.value = current.value
          ? `${current.value}\n${line.trim()}`
          : line.trim();
      }
      continue;
    }
    // A label is a short run of words before ": " (or a bare "Label:"). The
    // header line carries clock times, so a naive first-colon split is wrong.
    const match = /^([A-Za-z][A-Za-z ]{0,40}):(?:\s+(.*))?$/.exec(line);
    current = match
      ? { label: match[1].trim(), value: (match[2] ?? "").trim() }
      : { label: "Digest", value: line.trim() };
    fields.push(current);
  }
  return fields;
}

export const checkFailureRate = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const windowStart = now - FAILURE_RATE_WINDOW_MS;
    try {
      const runs = await ctx.runQuery(internal.opsAlerts.recentRunsForOps, {
        sinceMs: now - STUCK_LOOKBACK_MS,
      });
      const summary = summarizeRecentRuns(runs, { now, windowStart });
      const trip = shouldAlertFailureRate({
        failed: summary.failed,
        total: summary.total,
      });
      let sent = false;
      let reason: string | undefined;
      if (trip) {
        const result = await postOpsAlert(
          buildFailureRateAlert(summary, { windowMs: FAILURE_RATE_WINDOW_MS }),
        );
        sent = result.sent;
        reason = result.reason;
      }
      console.log(
        JSON.stringify({
          event: "ops-failure-rate",
          total: summary.total,
          failed: summary.failed,
          stuck: summary.stuck,
          tripped: trip,
          sent,
          ...(reason ? { reason } : {}),
        }),
      );
    } catch (error) {
      // The monitor must not become a second incident. Log and move on; the
      // next tick retries.
      console.error(
        JSON.stringify({
          event: "ops-failure-rate",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    return null;
  },
});

export const dailyRunDigest = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const end = Date.now();
    const start = end - DIGEST_WINDOW_MS;
    try {
      const runs = await ctx.runQuery(internal.opsAlerts.recentRunsForOps, {
        sinceMs: start,
      });
      const digest = buildRunDigest(runs, { start, end }, { now: end });
      const text = formatDigestText(digest);
      const result = await postOpsAlert({
        title: `Daily agent run digest — ${digest.total} runs, ${digest.byStatus.failed ?? 0} failed`,
        severity: "info",
        fields: digestTextToFields(text),
      });
      console.log(
        JSON.stringify({
          event: "ops-daily-digest",
          total: digest.total,
          failed: digest.byStatus.failed ?? 0,
          stuck: digest.stuckStarting,
          costDollars: digest.costDollars,
          sent: result.sent,
          ...(result.reason ? { reason: result.reason } : {}),
        }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "ops-daily-digest",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    return null;
  },
});
