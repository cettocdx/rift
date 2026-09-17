import { runStatusMeta, toRunStatus } from "./run-status";

export function formatDuration(
  startedAt: number,
  endedAt = Date.now(),
): string {
  const seconds = Math.max(0, Math.round((endedAt - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** An open record is not proof that its worker is still executing. */
export function describeRunTiming(
  run: { status: string; started_at: number; ended_at?: number },
  lastActivityAt?: number,
  now = Date.now(),
): { label: string; value: string } {
  const status = toRunStatus(run.status);
  if (
    runStatusMeta(status).isTerminal &&
    typeof run.ended_at === "number" &&
    Number.isFinite(run.ended_at) &&
    run.ended_at >= run.started_at
  ) {
    return {
      label: "took",
      value: formatDuration(run.started_at, run.ended_at),
    };
  }
  if (status === "running" && run.ended_at === undefined) {
    return { label: "running for", value: formatDuration(run.started_at, now) };
  }
  if (
    typeof lastActivityAt === "number" &&
    Number.isFinite(lastActivityAt) &&
    lastActivityAt >= run.started_at &&
    lastActivityAt <= now
  ) {
    return {
      label: "last active",
      value: `${formatDuration(lastActivityAt, now)} ago`,
    };
  }
  return {
    label: "started",
    value: `${formatDuration(run.started_at, now)} ago`,
  };
}
