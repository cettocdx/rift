import type { NextRequest } from "next/server";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import type { SubscriptionTier } from "@/types";

const KEY_PREFIX = "rift_live_";

export interface ApiKeyAuth {
  userId: string;
  subscription: SubscriptionTier;
  pricingMargin?: number;
}

/**
 * Resolve a RIFT personal API key from the `Authorization: Bearer <key>`
 * header. Pro and Max keys can drive Build/Studio through `/api/chat`; the
 * dedicated `/api/hack-chat` route independently requires the key's live Max
 * (`ultra`) entitlement. See convex/apiKeys.ts for issuance and resolution.
 *
 * Returns null for any request that isn't presenting a RIFT key (the normal,
 * session-cookie case) or whose key is invalid/revoked/no-longer-premium —
 * callers fall back to the existing session-based auth in that case.
 */
export async function resolveApiKeyAuth(
  req?: NextRequest,
): Promise<ApiKeyAuth | null> {
  const header = req?.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;

  const key = header.slice("Bearer ".length).trim();
  if (!key.startsWith(KEY_PREFIX)) return null;

  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;

  try {
    const resolved = await getConvexClient().mutation(
      api.apiKeys.resolveForBackend,
      { serviceKey, key },
      // This is a self-contained live auth transaction. It must not wait for
      // unrelated log/usage writes on the process-wide HTTP client's queue.
      // Callers still await verification before accessing user resources.
      { skipQueue: true },
    );
    if (!resolved) return null;
    return {
      userId: resolved.userId,
      subscription: resolved.tier,
      pricingMargin: resolved.pricingMargin,
    };
  } catch (error) {
    console.warn("[api-key] resolution failed:", error);
    return null;
  }
}
