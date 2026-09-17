import {
  getAccountPricingMargin,
  normalizePricingMargin,
} from "@/lib/billing/account-pricing";
import type { NextRequest } from "next/server";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { cookies } from "next/headers";
import { ChatSDKError } from "@/lib/errors";
import type { SubscriptionTier } from "@/types";
import { api } from "@/convex/_generated/api";
import { resolveSubscriptionTier } from "@/lib/auth/entitlements";
import {
  MOCK_TIER_STORAGE_KEY,
  resolveMockTierFromCookie,
} from "@/lib/billing/mock-billing";
import { resolveApiKeyAuth } from "@/lib/auth/api-key";

/**
 * Resolve a browser session through Convex itself. `convexAuthNextjsToken()`
 * only reads the auth cookie; sending that token to an authenticated Convex
 * query is what verifies its signature, expiry, and subject.
 */
async function resolveVerifiedSessionUser(): Promise<{
  token: string;
  userId: string;
} | null> {
  const token = await convexAuthNextjsToken();
  if (!token) return null;

  try {
    const viewer = await fetchQuery(api.users.viewer, {}, { token });
    if (!viewer?._id) return null;
    return { token, userId: String(viewer._id) };
  } catch (error) {
    console.warn(
      "[auth] Convex rejected or could not verify the browser session:",
      error instanceof Error ? error.message : "unknown error",
    );
    return null;
  }
}

/**
 * Resolve both identity and live entitlements in parallel authenticated Convex
 * queries. A forged/expired token, missing user, or Convex verification failure
 * fails closed and never produces a paid tier.
 */
async function resolveVerifiedSessionAccess(): Promise<{
  userId: string;
  subscription: SubscriptionTier;
  pricingMargin?: number;
} | null> {
  const token = await convexAuthNextjsToken();
  if (!token) return null;

  try {
    const [viewer, entitlements] = await Promise.all([
      fetchQuery(api.users.viewer, {}, { token }),
      fetchQuery(api.subscriptions.getMyEntitlements, {}, { token }),
    ]);
    if (!viewer?._id) return null;

    return {
      userId: String(viewer._id),
      subscription: resolveSubscriptionTier(entitlements),
      pricingMargin: getAccountPricingMargin(viewer),
    };
  } catch (error) {
    console.warn(
      "[auth] Convex rejected or could not verify browser access:",
      error instanceof Error ? error.message : "unknown error",
    );
    return null;
  }
}

async function resolveRequestMockTier(
  req?: NextRequest,
): Promise<SubscriptionTier | null> {
  let cookieValue = req?.cookies.get(MOCK_TIER_STORAGE_KEY)?.value;

  // Server Components do not receive a NextRequest. Read the same cookie from
  // the current request context so local mock billing behaves consistently on
  // both the page gate and Route Handler gate.
  if (!cookieValue && process.env.MOCK_BILLING === "true") {
    try {
      cookieValue = (await cookies()).get(MOCK_TIER_STORAGE_KEY)?.value;
    } catch {
      // No request context (for example a background worker): no mock access.
    }
  }

  return resolveMockTierFromCookie(cookieValue);
}

/**
 * Get the current user ID from the authenticated session, or from a RIFT
 * personal API key (`Authorization: Bearer rift_live_...`) when present.
 * @throws ChatSDKError when neither is valid.
 */
export const getUserID = async (req?: NextRequest): Promise<string> => {
  const apiKeyAuth = await resolveApiKeyAuth(req);
  if (apiKeyAuth) return apiKeyAuth.userId;

  const session = await resolveVerifiedSessionUser();
  if (!session) {
    throw new ChatSDKError("unauthorized:auth");
  }
  return session.userId;
};

/**
 * Get the current user ID plus subscription tier.
 *
 * Checks for a RIFT personal API key first (`Authorization: Bearer
 * rift_live_...`) — issuing one already requires an active pro/ultra
 * subscription (see convex/apiKeys.ts), so its tier is used directly. This is
 * what lets a premium user drive the full agent from their own terminal.
 *
 * Otherwise resolves the browser session and its current LemonSqueezy-backed
 * entitlements through authenticated Convex queries. A local mock-billing
 * cookie may override the live tier only outside production.
 */
export const getUserIDAndPro = async (
  req?: NextRequest,
): Promise<{
  userId: string;
  subscription: SubscriptionTier;
  pricingMargin?: number;
  organizationId?: string;
}> => {
  const apiKeyAuth = await resolveApiKeyAuth(req);
  if (apiKeyAuth) {
    return {
      userId: apiKeyAuth.userId,
      subscription: apiKeyAuth.subscription,
      pricingMargin: normalizePricingMargin(apiKeyAuth.pricingMargin),
      organizationId: undefined,
    };
  }

  const session = await resolveVerifiedSessionAccess();
  if (!session) {
    throw new ChatSDKError("unauthorized:auth");
  }

  const mockTier = await resolveRequestMockTier(req);

  return {
    userId: session.userId,
    subscription: mockTier ?? session.subscription,
    pricingMargin: session.pricingMargin,
    organizationId: undefined,
  };
};

/**
 * Get the current user ID only for recently-authenticated sessions.
 *
 * The freshness window was enforced via a last-sign-in timestamp, which Convex
 * Auth does not expose; for now this is equivalent to {@link getUserID}. A
 * step-up re-auth check can be layered back on with the teams/MFA migration.
 */
export const getUserIDWithFreshLogin = async (
  _req?: NextRequest,
  _windowMs: number = 10 * 60 * 1000,
): Promise<string> => {
  const session = await resolveVerifiedSessionUser();
  if (!session) {
    throw new ChatSDKError("unauthorized:auth", "recent_login_required");
  }
  return session.userId;
};
