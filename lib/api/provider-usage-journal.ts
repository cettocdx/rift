import { randomUUID } from "node:crypto";
import type { LanguageModelUsage } from "ai";
import { api } from "@/convex/_generated/api";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";

/** Immutable observed spend. It is never authorization to replay a debit. */
export async function persistProviderUsage(args: {
  userId: string;
  runId: string;
  chatId?: string;
  model: string;
  usage: LanguageModelUsage;
}): Promise<void> {
  const u = args.usage;
  const rawCost = u.raw?.cost;
  const receipt = {
    serviceKey: getConvexServiceKey()!,
    receipt_id: randomUUID(),
    user_id: args.userId,
    run_id: args.runId,
    chat_id: args.chatId,
    model: args.model,
    usage: {
      input_tokens: u.inputTokens,
      output_tokens: u.outputTokens,
      total_tokens: u.totalTokens,
      cache_read_tokens: u.inputTokenDetails?.cacheReadTokens,
      cache_write_tokens: u.inputTokenDetails?.cacheWriteTokens,
      reasoning_tokens: u.outputTokenDetails?.reasoningTokens,
      cost_dollars: typeof rawCost === "number" ? rawCost : undefined,
    },
  };
  // Identity and payload are frozen before retry. A timed-out request may
  // still commit; the backend transaction makes the later replay a no-op.
  const client = getConvexClient();
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const acknowledged = await Promise.race([
        client.mutation(api.usageLogs.recordProviderReceipt, receipt),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Usage receipt acknowledgment timed out")),
            3000,
          );
        }),
      ]);
      if (acknowledged !== true)
        throw new Error("Usage receipt was not acknowledged");
      return;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Could not save the provider usage receipt", {
    cause: lastError,
  });
}
