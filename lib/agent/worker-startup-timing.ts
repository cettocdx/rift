const environmentTypes = new Set([
  "PRODUCTION",
  "STAGING",
  "DEVELOPMENT",
  "PREVIEW",
]);

function timestamp(value: unknown): number | undefined {
  const milliseconds = value instanceof Date ? value.getTime() : value;
  return typeof milliseconds === "number" &&
    Number.isSafeInteger(milliseconds) &&
    milliseconds > 0 &&
    milliseconds <= 8.64e15
    ? milliseconds
    : undefined;
}

/** Bounded evidence only; process age does not establish cold-start duration. */
export function captureWorkerStartupTiming(input: {
  handlerEnteredAt?: unknown;
  attemptStartedAt?: unknown;
  environmentType?: unknown;
  processUptimeSeconds?: unknown;
  moduleEvaluation?: unknown;
}) {
  const result: {
    handlerEnteredAt?: number;
    attemptStartedAt?: number;
    environmentType?: string;
    processUptimeMs?: number;
    moduleEvaluation?: {
      probeStartedAt: number;
      moduleReadyAt: number;
      evaluationWindowMs: number;
    };
  } = {};
  const handlerEnteredAt = timestamp(input.handlerEnteredAt);
  const attemptStartedAt = timestamp(input.attemptStartedAt);
  if (handlerEnteredAt !== undefined)
    result.handlerEnteredAt = handlerEnteredAt;
  if (attemptStartedAt !== undefined)
    result.attemptStartedAt = attemptStartedAt;
  if (
    typeof input.environmentType === "string" &&
    environmentTypes.has(input.environmentType)
  ) {
    result.environmentType = input.environmentType;
  }
  if (
    typeof input.processUptimeSeconds === "number" &&
    input.processUptimeSeconds >= 0
  ) {
    const processUptimeMs = Math.round(input.processUptimeSeconds * 1000);
    if (Number.isSafeInteger(processUptimeMs))
      result.processUptimeMs = processUptimeMs;
  }
  const moduleEvidence = input.moduleEvaluation;
  if (moduleEvidence && typeof moduleEvidence === "object") {
    const value = moduleEvidence as Record<string, unknown>;
    const probeStartedAt = timestamp(value.probeStartedAt);
    const moduleReadyAt = timestamp(value.moduleReadyAt);
    const duration = value.evaluationWindowMs;
    if (
      probeStartedAt !== undefined &&
      moduleReadyAt !== undefined &&
      typeof duration === "number" &&
      Number.isSafeInteger(duration) &&
      duration >= 0
    ) {
      result.moduleEvaluation = {
        probeStartedAt,
        moduleReadyAt,
        evaluationWindowMs: duration,
      };
    }
  }
  return result;
}
