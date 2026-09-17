import "server-only";
import { api } from "@/convex/_generated/api";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";
export async function beginWorkspaceUsage(
  userId: string,
  identity: { sessionId: string; operationId: string },
  billingOperationId: string,
) {
  return getConvexClient().mutation(api.extraUsage.beginConsoleUsageOperation, {
    serviceKey: getConvexServiceKey()!,
    userId,
    ...identity,
    reservationKey: `credit:console:${billingOperationId}:preflight`,
  });
}
