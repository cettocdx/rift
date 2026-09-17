import "server-only";
import { createHash } from "node:crypto";
import { api } from "@/convex/_generated/api";
import type { AgentRunInputReceipt } from "@/convex/agentRunInputs";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";

export type AgentRunInputScope = Readonly<{
  userId: string;
  chatId: string;
  requestMessageId: string;
  requestHash: string;
  claimId: string;
  runId: string;
}>;

/**
 * Create only from authenticated, server-resolved run identity. Capture before
 * moderation or other awaits; delayed methods keep this exact deployment and
 * authority even when invoked outside their original worker scope. No runtime
 * intake is enabled here: moderation and transactional admission remain separate.
 */
export function createAgentRunInputBridge(scope: AgentRunInputScope) {
  const serviceKey = getConvexServiceKey();
  if (!serviceKey?.trim())
    throw new Error("Agent input service key is missing");
  const owner = Object.freeze({
    userId: scope.userId,
    chatId: scope.chatId,
    requestMessageId: scope.requestMessageId,
    requestHash: scope.requestHash,
    claimId: scope.claimId,
    runId: scope.runId,
  });
  if (
    Object.values(owner).some(
      (value) => typeof value !== "string" || !value.trim(),
    )
  ) {
    throw new Error("Agent input run identity is incomplete");
  }
  const client = getConvexClient();

  return Object.freeze({
    enqueue(input: {
      clientRequestId: string;
      text: string;
    }): Promise<AgentRunInputReceipt> {
      // Explicit fields prevent extra caller properties from replacing authority
      // or supplying a hash for different text. Preserve exact UTF-8 text bytes.
      const { clientRequestId, text } = input;
      const payloadHash = createHash("sha256")
        .update(text, "utf8")
        .digest("hex");
      return client.mutation(api.agentRunInputs.enqueueForBackend, {
        ...owner,
        serviceKey,
        clientRequestId,
        payloadHash,
        text,
      });
    },
    get(clientRequestId: string): Promise<AgentRunInputReceipt | null> {
      return client.query(api.agentRunInputs.getForBackend, {
        userId: owner.userId,
        chatId: owner.chatId,
        serviceKey,
        clientRequestId,
      });
    },
  });
}
