// Keep this leaf module dependency-free and first in the worker entry imports.
// This is an evaluation window, not total loading/parsing or queue duration.
const probeStartedAt = Date.now();
const startedUptime = process.uptime();
let timing:
  | Readonly<{
      probeStartedAt: number;
      moduleReadyAt: number;
      evaluationWindowMs: number;
    }>
  | undefined;

export function markWorkerModuleReady(): void {
  if (timing) return;
  timing = Object.freeze({
    probeStartedAt,
    moduleReadyAt: Date.now(),
    evaluationWindowMs: Math.max(
      0,
      Math.round((process.uptime() - startedUptime) * 1000),
    ),
  });
}

export function readWorkerModuleTiming() {
  return timing;
}
