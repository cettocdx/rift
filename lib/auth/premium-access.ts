import {
  isSubscriptionTier,
  type ChatPurpose,
  type SubscriptionTier,
} from "@/types";
import { ChatSDKError } from "@/lib/errors";

/**
 * Premium means any server-validated paid RIFT tier. Keeping the predicate in
 * one place prevents the page, navigation, and API from drifting apart as new
 * paid plans are added.
 */
export function hasPremiumAccess(subscription: SubscriptionTier): boolean {
  return isSubscriptionTier(subscription) && subscription !== "free";
}

/** Fail closed with a consistent 403 response for premium-only surfaces. */
export function assertPremiumAccess(
  subscription: SubscriptionTier,
  feature = "premium",
): void {
  if (hasPremiumAccess(subscription)) return;

  throw new ChatSDKError("forbidden:auth", "premium_required", {
    feature,
    upgradeUrl: "/upgrade",
  });
}

/**
 * Hack Workbench is the flagship capability of the customer-facing RIFT Max
 * plan. Billing persists that plan as the legacy `ultra` tier, so keep this
 * translation at the authorization boundary instead of scattering plan-name
 * checks through pages and API routes.
 */
export function hasHackWorkbenchAccess(
  subscription: SubscriptionTier,
): boolean {
  return isSubscriptionTier(subscription) && subscription === "ultra";
}

/** Fail closed with an upgrade response that names the required plan. */
export function assertHackWorkbenchAccess(
  subscription: SubscriptionTier,
): void {
  if (hasHackWorkbenchAccess(subscription)) return;

  throw new ChatSDKError("forbidden:auth", "max_required", {
    feature: "hack-mode",
    requiredPlan: "Max",
    requiredTier: "ultra",
    upgradeUrl: "/upgrade?feature=hack",
  });
}

/**
 * The offensive-security persona belongs exclusively to the dedicated Hack
 * Workbench transport. Keeping this invariant server-side prevents legacy
 * Security chats/projects (or a forged `purpose: "security"` body) from
 * recreating a second, ungated security surface through `/api/chat` or
 * `/api/agent-long`.
 */
export function assertHackWorkbenchPurposeRoute(
  purpose: ChatPurpose,
  isDedicatedHackRoute: boolean,
): void {
  if (purpose !== "security" || isDedicatedHackRoute) return;

  throw new ChatSDKError("forbidden:auth", "hack_workbench_required", {
    feature: "hack-mode",
    route: "/hack",
    upgradeUrl: "/upgrade?feature=hack",
  });
}
