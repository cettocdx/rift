import "server-only";

import { api } from "@/convex/_generated/api";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";

export async function claimDueScheduledRuns(args: {
  now: number;
  leaseOwner: string;
  limit?: number;
}) {
  return getConvexClient().mutation(api.tasks.claimDueRunsForBackend, {
    serviceKey: getConvexServiceKey()!,
    ...args,
  });
}

export async function markScheduledRunDispatched(args: {
  executionKey: string;
  leaseOwner: string;
  workerRunId: string;
}) {
  return getConvexClient().mutation(api.tasks.markRunDispatchedForBackend, {
    serviceKey: getConvexServiceKey()!,
    ...args,
  });
}

export async function releaseScheduledRunDispatch(args: {
  executionKey: string;
  leaseOwner: string;
  retryAt: number;
}) {
  return getConvexClient().mutation(api.tasks.releaseRunDispatchForBackend, {
    serviceKey: getConvexServiceKey()!,
    ...args,
  });
}

export async function beginScheduledRun(args: {
  executionKey: string;
  workerRunId: string;
  now: number;
}) {
  return getConvexClient().mutation(api.tasks.beginScheduledRunForBackend, {
    serviceKey: getConvexServiceKey()!,
    ...args,
  });
}

export async function registerScheduledAgentRun(args: {
  executionKey: string;
  workerRunId: string;
  agentRunId: string;
  chatId: string;
}) {
  return getConvexClient().mutation(
    api.tasks.registerScheduledAgentRunForBackend,
    { serviceKey: getConvexServiceKey()!, ...args },
  );
}

export async function authorizeScheduledAgentRun(args: {
  executionKey: string;
  agentRunId: string;
  userId: string;
  chatId: string;
}) {
  return getConvexClient().mutation(
    api.tasks.authorizeScheduledAgentRunForBackend,
    { serviceKey: getConvexServiceKey()!, ...args },
  );
}

export async function finishScheduledRun(args: {
  executionKey: string;
  status: "succeeded" | "failed" | "canceled";
  finishedAt: number;
  workerRunId?: string;
  agentRunId?: string;
  chatId?: string;
  errorMessage?: string;
}) {
  return getConvexClient().mutation(api.tasks.finishScheduledRunForBackend, {
    serviceKey: getConvexServiceKey()!,
    ...args,
  });
}
