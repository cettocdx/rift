const environmentTypes = new Set([
  "PRODUCTION",
  "STAGING",
  "DEVELOPMENT",
  "PREVIEW",
]);

function timestamp(value) {
  const milliseconds =
    value instanceof Date
      ? value.getTime()
      : typeof value === "string" &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
        ? Date.parse(value)
        : value;
  return typeof milliseconds === "number" &&
    Number.isSafeInteger(milliseconds) &&
    milliseconds > 0 &&
    milliseconds <= 8.64e15
    ? milliseconds
    : undefined;
}

/** Never copy arbitrary run payload, metadata, context or provider trace data. */
function startupTimingEvidence(run) {
  const worker = run?.metadata?.startupTiming;
  const result = {};
  for (const [name, value] of [
    ["providerCreatedAt", run?.createdAt],
    ["providerStartedAt", run?.startedAt],
    ["handlerEnteredAt", worker?.handlerEnteredAt],
    ["attemptStartedAt", worker?.attemptStartedAt],
  ]) {
    const milliseconds = timestamp(value);
    if (milliseconds !== undefined) result[name] = milliseconds;
  }
  if (Number.isSafeInteger(run?.attemptCount) && run.attemptCount >= 0) {
    result.providerAttemptCount = run.attemptCount;
  }
  if (
    typeof run?.region === "string" &&
    /^[a-z][a-z0-9-]{0,39}$/.test(run.region)
  ) {
    result.providerRegion = run.region;
  }
  if (environmentTypes.has(worker?.environmentType))
    result.environmentType = worker.environmentType;
  if (
    Number.isSafeInteger(worker?.processUptimeMs) &&
    worker.processUptimeMs >= 0
  ) {
    result.processUptimeMs = worker.processUptimeMs;
  }
  for (const [name, start, end] of [
    ["providerPreStartMs", result.providerCreatedAt, result.providerStartedAt],
    [
      "providerStartToAttemptMs",
      result.providerStartedAt,
      result.attemptStartedAt,
    ],
  ]) {
    if (start !== undefined && end !== undefined && end >= start)
      result[name] = end - start;
  }
  if (
    result.handlerEnteredAt !== undefined &&
    result.attemptStartedAt !== undefined
  ) {
    result.attemptToHandlerWallClockDeltaMs =
      result.handlerEnteredAt - result.attemptStartedAt;
  }
  if (Object.keys(result).length === 0) return undefined;
  result.interpretation =
    "Provider intervals use provider timestamps, not queue or cold-start measurements. Attempt-to-handler is a signed cross-runtime wall-clock delta and may include clock skew. Process uptime is process age, not initialization duration.";
  return result;
}

const setupPhaseNames = new Set([
  "tags",
  "claim",
  "balance",
  "entitlement",
  "billingConfig",
  "historyFetch",
  "skills",
  "historyRetarget",
  "messages",
  "moderation",
  "estimate",
  "checkpoint",
  "mcp",
  "github",
  "billingReserve",
  "monthlySnapshot",
  "runRecord",
  "tools",
  "executionFence",
  "turnSandbox",
  "systemPrompt",
]);

/** Allowlisted monotonic worker intervals, excluding arbitrary metadata. */
function setupPhaseTimingEvidence(metadata) {
  const spans = {};
  for (const name of setupPhaseNames) {
    const span = metadata?.setupSpansMs?.[name];
    if (
      !span ||
      ![span.startedMs, span.endedMs, span.durationMs].every(
        (value) =>
          Number.isSafeInteger(value) && value >= 0 && value <= 3_600_000,
      )
    )
      continue;
    if (
      span.endedMs < span.startedMs ||
      span.durationMs !== span.endedMs - span.startedMs
    )
      continue;
    if (span.outcome !== "completed" && span.outcome !== "failed") continue;
    spans[name] = {
      startedMs: span.startedMs,
      endedMs: span.endedMs,
      durationMs: span.durationMs,
      outcome: span.outcome,
    };
  }
  if (Object.keys(spans).length === 0) return undefined;
  return {
    origin: "worker setup timer creation (monotonic)",
    interpretation:
      "Phases can overlap. Do not sum durations or subtract these offsets from wall-clock timestamps.",
    spans,
  };
}

module.exports = { startupTimingEvidence, setupPhaseTimingEvidence };
