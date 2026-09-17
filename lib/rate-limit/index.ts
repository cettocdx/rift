import {
  reportBillingReservation,
  type BillingReservationDiagnostics,
} from "./reservation-diagnostics";
import type { PaidLedgerSnapshot } from "@/lib/billing/paid-ledger-migration";
/**
 * Rate Limiting Module
 *
 * Two rate limiting strategies based on subscription tier (NOT mode):
 *
 * 1. Token Bucket (Paid users - Pro, Pro+, Ultra, Team):
 *    - Used for both Agent and Ask modes (shared budget)
 *    - Points consumed based on token usage costs
 *    - Single monthly bucket: credits = subscription price, refills every 30 days
 *    - Supports extra usage (prepaid balance) when limits exceeded
 *
 * 2. Free users (PAYG):
 *    - Ask mode: daily fixed-window allowance (FREE_RATE_LIMIT_REQUESTS/day,
 *      resets at midnight UTC), then the prepaid balance.
 *    - Agent mode: ONE free run for life (claimed in Convex extra_usage), then
 *      the prepaid balance — must buy tokens.
 */

import { isAgentMode } from "@/lib/utils/mode-helpers";
import type {
  ChatMode,
  SubscriptionTier,
  RateLimitInfo,
  ExtraUsageConfig,
} from "@/types";

// Re-export token bucket functions
export {
  checkTokenBucketLimit,
  checkAccountCreditLimit,
  checkBalanceLimit,
  deductUsage,
  deductBalanceUsage,
  computeActualCostPoints,
  refundUsage,
  resetRateLimitBuckets,
  stashOldBucketRemaining,
  popOldBucketRemaining,
  initProratedBucket,
  calculateProratedCredits,
  getTeamMemberConsumed,
  addOrgRemovedUsage,
  clearOrgRemovedUsage,
  applyTeamSeatDebt,
  calculateTokenCost,
  getBudgetLimits,
  getSubscriptionPrice,
  POINTS_PER_DOLLAR,
} from "./token-bucket";

export { retireLegacyPaidBucketsForRenewal } from "@/lib/billing/paid-ledger-migration";

// Re-export sliding window functions
export {
  checkFreeUserRateLimit,
  checkFreeAgentRateLimit,
  grantFreeReferralBonusUnits,
} from "./sliding-window";

// Re-export utilities
export { createRedisClient, formatTimeRemaining } from "./redis";
export { UsageRefundTracker } from "./refund";
export { acquireFreeRunConcurrencyLock } from "./free-concurrency";
export {
  checkFreeMonthlyCostLimit,
  recordFreeMonthlyCost,
} from "./free-monthly-cost";

// Import for internal use
import {
  checkTokenBucketLimit,
  checkAccountCreditLimit,
  checkBalanceLimit,
} from "./token-bucket";
import { checkFreeMonthlyCostLimit } from "./free-monthly-cost";
import { FREE_ASK_REQUEST_COST } from "./free-config";
import { claimFreeAgentRun } from "@/lib/extra-usage";
import {
  checkFreeUserRateLimit,
  checkFreeAgentRateLimit,
} from "./sliding-window";

/**
 * Check rate limit for a user.
 *
 * Routes to the appropriate strategy based on subscription tier:
 * - Free users: Sliding window (simple request counting)
 * - Paid users: Token bucket (cost-based, shared budget for all modes)
 *
 * @param userId - The user's unique identifier
 * @param mode - The chat mode ("agent" or "ask") - used only for agent mode blocking
 * @param subscription - The user's subscription tier
 * @param estimatedInputTokens - Estimated input tokens (for token bucket)
 * @param extraUsageConfig - Optional config for extra usage charging
 * @returns Rate limit info including remaining quota
 */
export const checkRateLimit = async (
  userId: string,
  mode: ChatMode,
  subscription: SubscriptionTier,
  estimatedInputTokens?: number,
  extraUsageConfig?: ExtraUsageConfig,
  modelName?: string,
  organizationId?: string,
  ledgerSnapshot?: PaidLedgerSnapshot,
  diagnostics?: BillingReservationDiagnostics,
  pricingMargin?: number,
): Promise<RateLimitInfo> => {
  // Only the account-ledger path reports autoReloadAllowed: its exact action option.
  if (subscription !== "pro" && subscription !== "ultra") {
    reportBillingReservation(diagnostics, {
      type: "strategy",
      strategy:
        subscription === "free"
          ? isAgentMode(mode)
            ? "free_agent_then_balance"
            : "free_ask_then_balance"
          : "legacy_token_bucket",
    });
  }
  // Free users (PAYG).
  if (subscription === "free") {
    // Agent mode: ONE free run per calendar month, then it must be paid from
    // the prepaid balance. The monthly claim lives in Convex (extra_usage,
    // keyed by month), separate from the daily ask-mode window.
    if (isAgentMode(mode)) {
      const granted = await claimFreeAgentRun(userId);
      if (granted) {
        // This month's free agent run — served free, no balance charge.
        const now = new Date();
        const nextMonth = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
        );
        return {
          remaining: 0,
          limit: 1,
          resetTime: nextMonth,
          servedFrom: "free",
        };
      }
      // Free agent run already spent — draw from the prepaid balance; throws a
      // "buy tokens" error when empty and auto-reload is off.
      return checkBalanceLimit(
        userId,
        estimatedInputTokens || 0,
        modelName,
        extraUsageConfig,
        ...(pricingMargin === undefined ? [] : [pricingMargin]),
      );
    }

    // Ask mode: daily free allowance (FREE_RATE_LIMIT_REQUESTS/day), then the
    // prepaid balance once the day's allowance or the monthly cost cap is spent.
    // Peek the monthly free-cost cap WITHOUT throwing or consuming, so an
    // exhausted month falls through to the prepaid balance instead of a hard
    // block — mirroring the daily-window fall-through below.
    const monthly = await checkFreeMonthlyCostLimit(userId, {
      throwOnExhaustion: false,
    });

    if (!monthly.monthlyExhausted) {
      // Monthly budget still has room — consume the daily free window WITHOUT
      // throwing on exhaustion so we can still fall through to balance.
      const free = await checkFreeUserRateLimit(userId, FREE_ASK_REQUEST_COST, {
        throwOnExhaustion: false,
      });

      if (!free.freeExhausted) {
        // Served within both the daily allowance and the monthly free cap —
        // no balance charge.
        return free;
      }
    }

    // Daily or monthly free budget spent. Draw from the prepaid token balance;
    // throws a "buy tokens" error when empty and auto-reload is off.
    return checkBalanceLimit(
      userId,
      estimatedInputTokens || 0,
      modelName,
      extraUsageConfig,
      ...(pricingMargin === undefined ? [] : [pricingMargin]),
    );
  }

  // Consumer paid plans use the single Convex account ledger. Included
  // credits are spent first, then permanent add-ons; Redis is migration-only.
  if (subscription === "pro" || subscription === "ultra") {
    const ledgerArgs: [
      PaidLedgerSnapshot?,
      BillingReservationDiagnostics?,
      number?,
    ] =
      pricingMargin !== undefined
        ? [ledgerSnapshot, diagnostics, pricingMargin]
        : diagnostics
          ? [ledgerSnapshot, diagnostics]
          : ledgerSnapshot
            ? [ledgerSnapshot]
            : [];
    return checkAccountCreditLimit(
      userId,
      subscription,
      estimatedInputTokens || 0,
      extraUsageConfig,
      modelName,
      ...ledgerArgs,
    );
  }

  // Team / legacy Pro+ users retain their existing token bucket.
  return checkTokenBucketLimit(
    userId,
    subscription,
    estimatedInputTokens || 0,
    extraUsageConfig,
    modelName,
    organizationId,
    ...(pricingMargin === undefined ? [] : [pricingMargin]),
  );
};
