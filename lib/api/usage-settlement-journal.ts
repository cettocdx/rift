import {
  journalChargePoints,
  validWorkspaceIdentity,
} from "@/lib/console/workspace-usage";
import { randomUUID } from "node:crypto";
import { api } from "@/convex/_generated/api";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";

async function bounded<T>(request: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Settlement receipt timed out")),
          3000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Journal only: this is not atomic settlement across Redis and Convex.
 * A persisted pending/uncertain intent must never authorize a replayed debit. */
export async function settleWithJournal(
  input: { userId: string; runId: string; evidence: Record<string, unknown> },
  debit: () => Promise<void>,
): Promise<void> {
  const client = getConvexClient();
  const identity = {
    serviceKey: getConvexServiceKey()!,
    user_id: input.userId,
    run_id: input.runId,
    attempt_id: randomUUID(),
  };
  const actualPoints = journalChargePoints(input.evidence);
  const granted = await bounded(() =>
    client.mutation(api.usageLogs.beginSettlement, {
      ...identity,
      evidence: JSON.stringify(input.evidence),
      ...(validWorkspaceIdentity(input.evidence.chatId)
        ? { chat_id: input.evidence.chatId }
        : {}),
      ...(validWorkspaceIdentity(input.evidence.operationId)
        ? { operation_id: input.evidence.operationId }
        : {}),
      ...(actualPoints !== null ? { actual_points: actualPoints } : {}),
    }),
  );
  if (granted !== true)
    throw new Error(
      "Settlement requires reconciliation; debit was not repeated",
    );

  const finish = async (state: "acknowledged" | "uncertain") => {
    const receipt = { ...identity, state };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await bounded(() =>
          client.mutation(api.usageLogs.finishSettlement, receipt),
        );
        if (result !== true)
          throw new Error("Settlement receipt was not acknowledged");
        return;
      } catch (error) {
        if (attempt === 1) throw error;
      }
    }
  };
  try {
    await debit();
  } catch (error) {
    // A storage outage leaves the durable intent pending, which is also
    // unresolved. Preserve the debit failure without recording raw error text.
    await finish("uncertain").catch(() => {});
    throw error;
  }
  // Receipt failure does not imply debit failure. Never overwrite with an
  // uncertain outcome: an earlier same-key receipt may already have committed.
  await finish("acknowledged");
}
