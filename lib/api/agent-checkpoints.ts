import "server-only";
import { api } from "@/convex/_generated/api";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";
import type { AgentStepCheckpoint } from "@/lib/agent/checkpoint";

type Owner = { userId: string; chatId: string };
export type AgentCheckpointRun = Owner & { claimId: string; runId: string };
const withAuthority = <T extends Owner>(args: T) => ({
  ...args,
  serviceKey: getConvexServiceKey()!,
});

export function beginAgentCheckpointRun(
  args: AgentCheckpointRun & {
    requestMessageId: string;
    requestHash: string;
    model: string;
    executionTracking?: 1;
  },
) {
  return getConvexClient().mutation(
    api.agentCheckpoints.beginRun,
    withAuthority(args),
  );
}

export function markAgentCheckpointStep(
  args: AgentCheckpointRun & { stepIndex: number },
) {
  return getConvexClient().mutation(
    api.agentCheckpoints.markStep,
    withAuthority(args),
    // The runner awaits begin/save before reaching this fence. Unrelated
    // telemetry writes must not hold up admission; the server still checks
    // the exact owner, claim, run and next step atomically.
    { skipQueue: true },
  );
}

export function markAgentCheckpointExecution(
  args: AgentCheckpointRun & { stepIndex: number },
) {
  return getConvexClient().mutation(
    api.agentCheckpoints.markExecution,
    withAuthority(args),
  );
}

export function saveAgentCheckpoint(
  args: AgentCheckpointRun & { checkpoint: AgentStepCheckpoint },
) {
  return getConvexClient().mutation(
    api.agentCheckpoints.saveStep,
    withAuthority(args),
  );
}

/** On a size limit, await true before continuing without checkpoint hooks. */
export function disableAgentCheckpointRun(
  args: AgentCheckpointRun & {
    reason?: "checkpoint-too-large" | "model-changed";
  },
) {
  return getConvexClient().mutation(
    api.agentCheckpoints.disableRun,
    withAuthority(args),
  );
}

/** Call after terminal transcript persistence, before releasing the run claim. */
export function finishAgentCheckpointRun(
  args: AgentCheckpointRun & { discard?: boolean },
) {
  return getConvexClient().mutation(
    api.agentCheckpoints.finishRun,
    withAuthority(args),
  );
}

export function getAgentCheckpoint(args: Owner) {
  return getConvexClient().query(
    api.agentCheckpoints.getForBackend,
    withAuthority(args),
  );
}
