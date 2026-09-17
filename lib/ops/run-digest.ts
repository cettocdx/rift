/**
 * Daily run digest: the "is the agent healthy today" view.
 *
 * Per-run alerts (see ./alerts.ts) tell an operator that *one* run broke.
 * They cannot answer the questions that actually decide whether the product
 * is working: what fraction of runs failed, whether stream drops are a blip
 * or a trend, how much money the day cost, whether runs are silently stuck
 * in `starting` because a worker never picked them up. Before this digest
 * existed those questions were answered by scrolling the Trigger dashboard,
 * which nobody did until a user complained.
 *
 * This module is deliberately pure and dependency-free so a Convex cron can
 * import it directly: it takes rows shaped like the `runs` table, a time
 * window, and returns numbers. Posting the result to Slack is the caller's
 * job (`formatDigestText` produces the message body).
 *
 * Why these particular numbers:
 * - `disconnected` is called out separately because it is NOT terminal in
 *   the run vocabulary; a pile of disconnected runs means the reconciler or
 *   the stream is unhealthy, not that users are failing.
 * - `reconciled` counts runs the 15-minute reconciler had to close because
 *   the worker never did. A non-zero number is a worker-lifecycle bug.
 * - `doomLoop` / `budgetExhausted` / `contextLimit` are the agent's own
 *   circuit breakers; their rate tells us whether prompts or limits drifted.
 * - `stuckStarting` catches the failure mode where `/api/agent-long` returns
 *   200 but no Trigger worker ever runs the task -- the run sits in a
 *   non-terminal status forever and no error is ever written.
 * - `topErrors` are normalised (digits masked) so that "timeout after 30001ms"
 *   and "timeout after 30047ms" group together instead of hiding in a long
 *   tail of unique strings.
 */

import { RUN_STATUS_META, toRunStatus } from "../runs/run-status";

export interface DigestRun {
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
}

export interface RunDigest {
  windowStart: number;
  windowEnd: number;
  total: number;
  byStatus: Record<string, number>;
  disconnected: number;
  reconciled: number;
  costDollars: number;
  totalTokens: number;
  durationMsP50: number | null;
  durationMsP95: number | null;
  doomLoop: number;
  budgetExhausted: number;
  contextLimit: number;
  topErrors: Array<{ message: string; count: number }>;
  stuckStarting: number;
}

export interface BuildRunDigestOptions {
  /** How long a non-terminal run may sit without ending before it counts as stuck. Default 10 minutes. */
  stuckStartingAfterMs?: number;
  /** Clock for stuck detection. Defaults to `window.end`. */
  now?: number;
}

export const DEFAULT_STUCK_STARTING_AFTER_MS = 10 * 60 * 1_000;
export const TOP_ERRORS_LIMIT = 5;
export const NORMALIZED_ERROR_MAX_CHARS = 120;

/**
 * Nearest-rank percentile. `p` in [0, 1]. Returns null for an empty sample
 * rather than 0, because "no completed runs" and "instant runs" are different
 * facts and the digest should not blur them.
 */
export function percentileNearestRank(
  sortedAscending: number[],
  p: number,
): number | null {
  const n = sortedAscending.length;
  if (n === 0) return null;
  const clamped = Math.min(1, Math.max(0, p));
  const rank = Math.max(1, Math.ceil(clamped * n));
  return sortedAscending[rank - 1];
}

/**
 * Collapses an error string so near-identical messages group together:
 * lowercase, digits masked to `#`, whitespace squashed, capped in length.
 */
export function normalizeErrorMessage(error: string): string {
  const normalized = error
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > NORMALIZED_ERROR_MAX_CHARS
    ? normalized.slice(0, NORMALIZED_ERROR_MAX_CHARS)
    : normalized;
}

const isInWindow = (run: DigestRun, start: number, end: number): boolean =>
  typeof run.started_at === "number" &&
  run.started_at >= start &&
  run.started_at < end;

const finite = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export function buildRunDigest(
  runs: DigestRun[],
  window: { start: number; end: number },
  options: BuildRunDigestOptions = {},
): RunDigest {
  const stuckAfter =
    options.stuckStartingAfterMs ?? DEFAULT_STUCK_STARTING_AFTER_MS;
  const now = options.now ?? window.end;

  const inWindow = runs.filter((run) => isInWindow(run, window.start, window.end));

  const byStatus: Record<string, number> = {};
  const durations: number[] = [];
  const errorCounts = new Map<string, number>();

  let disconnected = 0;
  let reconciled = 0;
  let costDollars = 0;
  let totalTokens = 0;
  let doomLoop = 0;
  let budgetExhausted = 0;
  let contextLimit = 0;
  let stuckStarting = 0;

  for (const run of inWindow) {
    const rawStatus = typeof run.status === "string" ? run.status : "unknown";
    byStatus[rawStatus] = (byStatus[rawStatus] ?? 0) + 1;

    const status = toRunStatus(run.status);
    if (status === "disconnected") disconnected += 1;
    if (run.stop_reason === "reconciled") reconciled += 1;

    costDollars += finite(run.cost_dollars);
    totalTokens += finite(run.total_tokens);

    if (typeof run.ended_at === "number" && run.ended_at >= run.started_at) {
      durations.push(run.ended_at - run.started_at);
    }

    switch (run.finish_reason) {
      case "doom-loop":
        doomLoop += 1;
        break;
      case "budget-exhausted":
        budgetExhausted += 1;
        break;
      case "context-limit":
        contextLimit += 1;
        break;
      default:
        break;
    }

    if (typeof run.error === "string" && run.error.trim()) {
      const key = normalizeErrorMessage(run.error);
      if (key) errorCounts.set(key, (errorCounts.get(key) ?? 0) + 1);
    }

    const meta = RUN_STATUS_META[status];
    if (
      !meta.isTerminal &&
      run.ended_at === undefined &&
      now - run.started_at > stuckAfter
    ) {
      stuckStarting += 1;
    }
  }

  durations.sort((a, b) => a - b);

  const topErrors = [...errorCounts.entries()]
    .map(([message, count]) => ({ message, count }))
    .sort((a, b) => b.count - a.count || a.message.localeCompare(b.message))
    .slice(0, TOP_ERRORS_LIMIT);

  return {
    windowStart: window.start,
    windowEnd: window.end,
    total: inWindow.length,
    byStatus,
    disconnected,
    reconciled,
    costDollars: Math.round(costDollars * 1_000_000) / 1_000_000,
    totalTokens,
    durationMsP50: percentileNearestRank(durations, 0.5),
    durationMsP95: percentileNearestRank(durations, 0.95),
    doomLoop,
    budgetExhausted,
    contextLimit,
    topErrors,
    stuckStarting,
  };
}

/**
 * Rate-based gate for the noisy categories that per-run alerts skip. Both
 * thresholds must trip: an absolute floor so one bad run out of two does not
 * page at 3 a.m., and a ratio so three failures out of three thousand do not
 * either.
 */
export function shouldAlertFailureRate(input: {
  failed: number;
  total: number;
  minFailed?: number;
  minRatio?: number;
}): boolean {
  const minFailed = input.minFailed ?? 3;
  const minRatio = input.minRatio ?? 0.2;
  if (input.total <= 0) return false;
  if (input.failed < minFailed) return false;
  return input.failed / input.total >= minRatio;
}

const fmtInt = (n: number): string => n.toLocaleString("en-US");
const fmtUsd = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function formatDurationMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "n/a";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest.toString().padStart(2, "0")}s`;
}

const fmtDate = (ts: number): string => new Date(ts).toISOString().slice(0, 16).replace("T", " ");

/**
 * Multi-line Slack text. Plain `text`, no blocks: digests are read once in
 * the morning and searched later, and plain text survives both better than
 * a block grid does.
 */
export function formatDigestText(d: RunDigest): string {
  const failed = d.byStatus.failed ?? 0;
  const completed =
    (d.byStatus.completed ?? 0) + (d.byStatus.completed_with_warnings ?? 0);
  const cancelled = d.byStatus.cancelled ?? 0;
  const failRate = d.total > 0 ? ((failed / d.total) * 100).toFixed(1) : "0.0";

  const statusLine = Object.entries(d.byStatus)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([status, count]) => `${status} ${fmtInt(count)}`)
    .join(", ");

  const lines: string[] = [
    `*Agent run digest* — ${fmtDate(d.windowStart)} → ${fmtDate(d.windowEnd)} UTC`,
    `Runs: ${fmtInt(d.total)} total · ${fmtInt(completed)} completed · ${fmtInt(failed)} failed (${failRate}%) · ${fmtInt(cancelled)} cancelled`,
    `By status: ${statusLine || "none"}`,
    `Health: ${fmtInt(d.disconnected)} disconnected · ${fmtInt(d.reconciled)} reconciled by cron · ${fmtInt(d.stuckStarting)} stuck (non-terminal, never ended)`,
    `Limits: ${fmtInt(d.doomLoop)} doom-loop · ${fmtInt(d.budgetExhausted)} budget-exhausted · ${fmtInt(d.contextLimit)} context-limit`,
    `Cost: ${fmtUsd(d.costDollars)} · ${fmtInt(d.totalTokens)} tokens`,
    `Duration: p50 ${formatDurationMs(d.durationMsP50)} · p95 ${formatDurationMs(d.durationMsP95)}`,
  ];

  if (d.topErrors.length > 0) {
    lines.push("Top errors:");
    for (const entry of d.topErrors) {
      lines.push(`  • ${fmtInt(entry.count)}× ${entry.message}`);
    }
  } else {
    lines.push("Top errors: none");
  }

  return lines.join("\n");
}
