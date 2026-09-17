import type { ProfilerOnRenderCallback } from "react";

type Entry = Record<string, unknown> & {
  kind: string;
  time: number;
  phase: string;
};
const host = window as any;
export function recordCompletion(
  kind: string,
  values: Record<string, unknown> = {},
) {
  const state = host.__completionProfile;
  if (!state || state.entries.length >= 5000) return;
  state.entries.push({
    kind,
    time: performance.now(),
    phase: state.phase,
    ...values,
  } satisfies Entry);
}
export const completionProfiler: ProfilerOnRenderCallback = (
  id,
  reactPhase,
  actualDuration,
  baseDuration,
  startTime,
  commitTime,
) =>
  recordCompletion("react-commit", {
    id,
    reactPhase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime,
  });
export function profileCompletionCall<T>(kind: string, fn: () => T): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    recordCompletion(kind, { duration: performance.now() - start });
  }
}
export function beginCompletionPhase(phase: string) {
  host.__completionProfile ??= { phase, entries: [] };
  host.__completionProfile.phase = phase;
  recordCompletion("checkpoint");
}
