export type StartupPhaseSpan = {
  startedMs: number;
  endedMs: number;
  durationMs: number;
  outcome: "completed" | "failed";
};

/** Relative monotonic timings only: never capture operation inputs or errors. */
export function createStartupPhaseTimer(
  publish: (name: string, span: StartupPhaseSpan) => void,
  now: () => number = () => performance.now(),
) {
  const origin = now();
  const elapsed = () => Math.max(0, Math.round(now() - origin));
  const finish = (name: string, startedMs: number, completed: boolean) => {
    const endedMs = Math.max(startedMs, elapsed());
    try {
      publish(name, {
        startedMs,
        endedMs,
        durationMs: endedMs - startedMs,
        outcome: completed ? "completed" : "failed",
      });
    } catch {
      // Diagnostics are best-effort. Never fail completed work or replace an
      // authorization/cancellation error with a metadata transport exception.
    }
  };
  return {
    async measure<T>(name: string, operation: () => Promise<T>): Promise<T> {
      const startedMs = elapsed();
      let completed = false;
      try {
        const result = await operation();
        completed = true;
        return result;
      } finally {
        finish(name, startedMs, completed);
      }
    },
    measureSync<T>(name: string, operation: () => T): T {
      const startedMs = elapsed();
      let completed = false;
      try {
        const result = operation();
        completed = true;
        return result;
      } finally {
        finish(name, startedMs, completed);
      }
    },
  };
}
