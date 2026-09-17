import type { BrowserContext } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { canonicalizeEmail } from "../../convex/emailCanonical";
import { resolveSubscriptionTier } from "../../lib/auth/entitlements";
import type { SubscriptionTier } from "../../types";

export interface VerifiedTestSession {
  userId: string;
  email: string;
  tier: SubscriptionTier;
}

export async function hasConvexSessionCookie(
  context: BrowserContext,
  baseURL: string,
): Promise<boolean> {
  return Boolean(await sessionToken(context, baseURL));
}

async function sessionToken(context: BrowserContext, baseURL: string) {
  const url = new URL(baseURL);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  const name = `${local ? "" : "__Host-"}__convexAuthJWT`;
  const cookies = await context.cookies(url.origin);
  return cookies.find((cookie) => cookie.name === name)?.value;
}

/** Verify the real session against Convex; cookie presence alone is insufficient. */
export async function verifyAuthenticatedSession(
  context: BrowserContext,
  baseURL: string,
  expectedUser?: { email: string; tier?: SubscriptionTier },
): Promise<VerifiedTestSession> {
  const convexURL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexURL) {
    throw new Error(
      "NEXT_PUBLIC_CONVEX_URL is required to verify the E2E session.",
    );
  }
  const token = await sessionToken(context, baseURL);
  if (!token) throw new Error("No Convex session exists for the test origin.");

  let viewer;
  let entitlements;
  try {
    const client = new ConvexHttpClient(convexURL, { logger: false });
    client.setAuth(token);
    [viewer, entitlements] = await Promise.all([
      client.query(api.users.viewer, {}),
      client.query(api.subscriptions.getMyEntitlements, {}),
    ]);
  } catch {
    // Never include SDK errors, cookie contents or auth responses in test output.
    throw new Error(
      "Convex could not verify the E2E session and entitlements.",
    );
  }
  if (
    !viewer?._id ||
    typeof viewer.email !== "string" ||
    !Array.isArray(entitlements) ||
    !entitlements.every((entry) => typeof entry === "string")
  ) {
    throw new Error("Convex did not return an authenticated E2E identity.");
  }
  if (
    expectedUser &&
    canonicalizeEmail(viewer.email) !== canonicalizeEmail(expectedUser.email)
  ) {
    throw new Error("The saved session belongs to a different E2E account.");
  }
  const tier = resolveSubscriptionTier(entitlements);
  if (expectedUser?.tier && expectedUser.tier !== tier) {
    throw new Error(
      "The E2E account does not have the required live subscription tier.",
    );
  }
  return { userId: String(viewer._id), email: viewer.email, tier };
}
