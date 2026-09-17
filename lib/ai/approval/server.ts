import { setTimeout as delay } from "node:timers/promises";
import { api } from "@/convex/_generated/api";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";
import {
  requiresToolApproval,
  type ApprovalMode,
  type ToolApprovalGate,
} from "./policy";

export function createToolApprovalGate(context: {
  userId: string;
  chatId: string;
  runId: string;
  mode: ApprovalMode;
}): ToolApprovalGate {
  let stopped = false;
  const gate: ToolApprovalGate = async ({
    toolName,
    input,
    toolCallId,
    signal,
  }) => {
    if (stopped)
      throw new Error("Approval stopped this run. No action was executed.");
    try {
      if (!requiresToolApproval(context.mode, toolName, input)) return;
      signal?.throwIfAborted();
      const serviceKey = getConvexServiceKey();
      if (!serviceKey)
        throw new Error(
          "Approval service is unavailable. No action was executed.",
        );
      const client = getConvexClient();
      const id = await client.mutation(api.approvals.request, {
        serviceKey,
        userId: context.userId,
        chatId: context.chatId,
        runId: context.runId,
        toolName,
        toolCallId,
        preview: (JSON.stringify(input, null, 2) ?? "{}").slice(0, 6000),
      });
      const args = {
        serviceKey,
        id,
        userId: context.userId,
        runId: context.runId,
      };
      try {
        const deadline = Date.now() + 10 * 60_000;
        while (Date.now() < deadline) {
          if (stopped)
            throw new Error(
              "Approval stopped this run. No action was executed.",
            );
          signal?.throwIfAborted();
          const status = await client.mutation(api.approvals.consume, args);
          if (status === "approved" && !stopped) return;
          if (status !== "pending")
            throw new Error(
              `Action ${status}. Do not retry it without a new user instruction.`,
            );
          await delay(1200, undefined, { signal });
        }
        throw new Error("Approval expired. No action was executed.");
      } finally {
        await client.mutation(api.approvals.close, args).catch(() => undefined);
      }
    } catch (error) {
      stopped = true;
      throw error;
    }
  };
  gate.isStopped = () => stopped;
  return gate;
}
