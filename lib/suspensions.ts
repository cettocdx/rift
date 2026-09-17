import "server-only";

import { api } from "@/convex/_generated/api";
import { ChatSDKError } from "@/lib/errors";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";
import { getSuspensionMessage } from "@/lib/suspensionMessage";

export async function getActiveSuspensionForUser(userId: string) {
  return await getConvexClient().query(api.userSuspensions.getActiveByUser, {
    serviceKey: getConvexServiceKey()!,
    userId,
  });
}

export async function assertUserCanMakeCostIncurringRequest(userId: string) {
  const suspension = await getActiveSuspensionForUser(userId);
  if (!suspension) return;

  throw new ChatSDKError(
    "forbidden:chat",
    getSuspensionMessage(`${suspension.category}:${suspension.source_id}`),
    {
      suspensionCategory: suspension.category,
      suspensionSource: suspension.source,
    },
  );
}
