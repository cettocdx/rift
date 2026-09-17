// Re-enabled after the Trigger.dev us-east-1 incident (2026-06-22) was resolved.
// This every-5-minutes scheduled task keeps a warm container around so
// agent-long runs avoid cold starts.
import { schedules } from "@trigger.dev/sdk";

export const keepWarmTask = schedules.task({
  id: "keep-warm",
  cron: "*/5 * * * *",
  maxDuration: 5,
  machine: { preset: "medium-1x" },
  run: async () => {
    // intentional noop — the run itself keeps a machine warm in the pool.
  },
});
