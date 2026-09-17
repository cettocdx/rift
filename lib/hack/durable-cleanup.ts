import "server-only";
import {
  makeFunctionReference,
  type FunctionArgs,
  type ApiFromModules,
} from "convex/server";
import type * as receiptModule from "@/convex/agentDispatchRequests";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";

type CleanupApi = ApiFromModules<{
  agentDispatchRequests: typeof receiptModule;
}>;
type CleanupArgs = FunctionArgs<
  CleanupApi["agentDispatchRequests"]["recordCleanup"]
>;
const cleanupRef = makeFunctionReference<"mutation", CleanupArgs, boolean>(
  "agentDispatchRequests:recordCleanup",
);

/** Call after sealed tool settlement, confirmed remote process exits, and final
 * persistence attempts. This proves resource settlement, not successful billing
 * or transcript writes. Neither a timer nor Trigger terminality suffices. */
export async function recordHackRunCleanup(
  binding: Omit<CleanupArgs, "serviceKey">,
): Promise<boolean> {
  const serviceKey = getConvexServiceKey();
  if (!serviceKey) throw new Error("Missing Convex service key");
  return (
    (await getConvexClient().mutation(cleanupRef, {
      serviceKey,
      userId: binding.userId,
      chatId: binding.chatId,
      dispatchId: binding.dispatchId,
      claimId: binding.claimId,
      runId: binding.runId,
      ...(binding.workerEntryId
        ? { workerEntryId: binding.workerEntryId }
        : {}),
    })) === true
  );
}
