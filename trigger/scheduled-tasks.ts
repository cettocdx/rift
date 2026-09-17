import { withConvexClientScope } from "@/lib/db/convex-client-scope";
import { getConvexUrl } from "@/lib/db/convex-client";
import { createHash } from "node:crypto";
import { metadata, retry, schedules, task } from "@trigger.dev/sdk";

import { agentLongTask as scheduledAgentTask } from "./agent-long";
import { saveChat, saveMessage } from "@/lib/db/actions";
import {
  beginScheduledRun,
  claimDueScheduledRuns,
  finishScheduledRun,
  markScheduledRunDispatched,
  registerScheduledAgentRun,
  releaseScheduledRunDispatch,
} from "@/lib/tasks/scheduled-task-backend";

const DISPATCH_LIMIT = 10;
const DISPATCH_RETRY_DELAY_MS = 30_000;
const IDEMPOTENCY_TTL = "30d";

type ScheduledTaskWorkerPayload = {
  executionKey: string;
  convexUrl?: string;
};

function stableScheduledIds(executionKey: string) {
  const digest = createHash("sha256").update(executionKey).digest("hex");
  return {
    chatId: `scheduled_${digest.slice(0, 32)}`,
    messageId: `scheduled_user_${digest.slice(0, 32)}`,
  };
}

const transientRetry = {
  maxAttempts: 3,
  factor: 2,
  minTimeoutInMs: 500,
  maxTimeoutInMs: 5_000,
  randomize: true,
} as const;

/**
 * Executes one already-claimed occurrence. Its payload is only a lookup key;
 * Convex revalidates worker ownership, task ownership, lifecycle state, and
 * schedule version before any chat or model work is created.
 */
export const scheduledTaskWorker = task({
  id: "scheduled-task-worker",
  maxDuration: 120,
  retry: { maxAttempts: 1 },
  queue: { concurrencyLimit: 10 },
  run: async (payload: ScheduledTaskWorkerPayload, { ctx }) =>
    withConvexClientScope(payload.convexUrl, async () => {
      const workerRunId = ctx.run.id;
      let chatId: string | undefined;
      try {
        const snapshot = await retry.onThrow(async () => {
          const result = await beginScheduledRun({
            executionKey: payload.executionKey,
            workerRunId,
            now: Date.now(),
          });
          if (result.state === "pending") {
            throw new Error("Scheduled dispatch registration is pending");
          }
          return result;
        }, transientRetry);
        if (snapshot.state !== "ready") {
          return { state: snapshot.state };
        }
        if (
          !snapshot.userId ||
          !snapshot.title ||
          !snapshot.prompt ||
          !snapshot.purpose ||
          !snapshot.subscription
        ) {
          throw new Error("Scheduled task snapshot is incomplete");
        }

        const ids = {
          ...stableScheduledIds(payload.executionKey),
          ...(snapshot.chatId ? { chatId: snapshot.chatId } : {}),
        };
        chatId = ids.chatId;
        await retry.onThrow(async () => {
          if (!snapshot.chatId)
            await saveChat({
              id: ids.chatId,
              userId: snapshot.userId!,
              title: snapshot.title!.slice(0, 100),
              purpose: snapshot.purpose!,
              projectId: snapshot.projectId,
            });
          await saveMessage({
            chatId: ids.chatId,
            userId: snapshot.userId!,
            message: {
              id: ids.messageId,
              role: "user",
              parts: [{ type: "text", text: snapshot.prompt! }],
            },
            mode: "agent",
          });
        }, transientRetry);

        const triggerRequestedAt = Date.now();
        const handle = await retry.onThrow(
          async () =>
            scheduledAgentTask.trigger(
              {
                chatId: ids.chatId,
                userId: snapshot.userId!,
                subscription: snapshot.subscription!,
                messages: [],
                baseTodos: [],
                purpose: snapshot.purpose!,
                userLocation: {},
                isNewChat: !snapshot.chatId,
                convexUrl: getConvexUrl(),
                scheduledRun: { executionKey: payload.executionKey },
                requestTiming: {
                  routeStartedAt: triggerRequestedAt,
                  triggerRequestedAt,
                },
              },
              {
                delay: "5s",
                idempotencyKey: `scheduled-agent:${payload.executionKey}`,
                idempotencyKeyTTL: IDEMPOTENCY_TTL,
                tags: [
                  "scheduled",
                  `task_${createHash("sha256")
                    .update(payload.executionKey)
                    .digest("hex")
                    .slice(0, 16)}`,
                ],
                metadata: {
                  status: "scheduled",
                  chatId: ids.chatId,
                  executionKey: payload.executionKey,
                },
              },
            ),
          transientRetry,
        );

        const registered = await retry.onThrow(
          () =>
            registerScheduledAgentRun({
              executionKey: payload.executionKey,
              workerRunId,
              agentRunId: handle.id,
              chatId: ids.chatId,
            }),
          transientRetry,
        );
        if (!registered.success) {
          throw new Error("Scheduled agent run could not be registered");
        }
        metadata
          .set("status", "agent_queued")
          .set("chatId", ids.chatId)
          .set("agentRunId", handle.id);
        return {
          state: "running" as const,
          chatId: ids.chatId,
          runId: handle.id,
        };
      } catch (error) {
        await retry
          .onThrow(
            () =>
              finishScheduledRun({
                executionKey: payload.executionKey,
                workerRunId,
                status: "failed",
                finishedAt: Date.now(),
                chatId,
                errorMessage: "The scheduled agent could not be started",
              }),
            transientRetry,
          )
          .catch(() => undefined);
        throw error;
      }
    }),
});

/**
 * One global minute-level schedule is sufficient for every tenant. Convex
 * owns recurrence calculation and atomically advances each occurrence, while
 * Trigger supplies durable dispatch, idempotency, retry, and observability.
 */
export const scheduledTaskDispatcher = schedules.task({
  id: "scheduled-task-dispatcher",
  cron: "* * * * *",
  maxDuration: 60,
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1_000,
    maxTimeoutInMs: 10_000,
    randomize: true,
  },
  run: async (_payload, { ctx }) =>
    withConvexClientScope(undefined, async () => {
      const leaseOwner = ctx.run.id;
      const claims = await retry.onThrow(
        () =>
          claimDueScheduledRuns({
            now: Date.now(),
            leaseOwner,
            limit: DISPATCH_LIMIT,
          }),
        transientRetry,
      );
      let failedDispatches = 0;

      for (const claim of claims) {
        try {
          const handle = await scheduledTaskWorker.trigger(
            {
              executionKey: claim.executionKey,
              convexUrl: getConvexUrl(),
            },
            {
              idempotencyKey: `scheduled-worker:${claim.executionKey}:${claim.dispatchAttempt}`,
              idempotencyKeyTTL: IDEMPOTENCY_TTL,
              tags: ["scheduled", "dispatcher"],
            },
          );
          const marked = await retry.onThrow(
            () =>
              markScheduledRunDispatched({
                executionKey: claim.executionKey,
                leaseOwner,
                workerRunId: handle.id,
              }),
            transientRetry,
          );
          if (!marked.success) failedDispatches += 1;
        } catch {
          failedDispatches += 1;
          await releaseScheduledRunDispatch({
            executionKey: claim.executionKey,
            leaseOwner,
            retryAt: Date.now() + DISPATCH_RETRY_DELAY_MS,
          }).catch(() => undefined);
        }
      }

      metadata
        .set("claimed", claims.length)
        .set("dispatchFailures", failedDispatches)
        .set("status", failedDispatches > 0 ? "partial" : "done");
      if (failedDispatches > 0) {
        throw new Error("One or more scheduled task dispatches failed");
      }
      return { claimed: claims.length };
    }),
});
