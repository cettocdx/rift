import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";

export interface ExtraUsageBalance {
  balanceDollars: number;
  balancePoints: number;
  enabled: boolean;
  autoReloadEnabled: boolean;
  autoReloadThresholdDollars?: number;
  autoReloadThresholdPoints?: number;
  autoReloadAmountDollars?: number;
  includedTotalPoints: number;
  includedRemainingPoints: number;
  includedResetAt?: string;
  debtPoints: number;
  legacyRedisMigrated: boolean;
}

export interface DeductBalanceResult {
  success: boolean;
  newBalanceDollars: number;
  insufficientFunds: boolean;
  monthlyCapExceeded: boolean;
  autoReloadTriggered?: boolean;
  autoReloadResult?: {
    success: boolean;
    chargedAmountDollars?: number;
    reason?: string;
  };
  /** True if no deduction was performed (e.g., pointsUsed <= 0) */
  noOp?: boolean;
  /** Team-pool-only: per-member spending cap was the blocker */
  memberCapExceeded?: boolean;
  /** Team-pool-only: admin disabled this member's access to the pool */
  memberDisabled?: boolean;
  /** Team-pool-only: admin disabled the team pool entirely */
  poolDisabled?: boolean;
}

/**
 * Get user's extra usage balance and settings.
 * Used by the rate limit logic to check if user can use extra usage.
 */
export async function getExtraUsageBalance(
  userId: string,
): Promise<ExtraUsageBalance | null> {
  try {
    const convex = getConvexClient();
    const settings = await convex.query(
      api.extraUsage.getExtraUsageBalanceForBackend,
      {
        serviceKey: getConvexServiceKey()!,
        userId,
      },
    );
    return {
      balanceDollars: settings.balanceDollars,
      balancePoints: settings.balancePoints,
      enabled: settings.enabled,
      autoReloadEnabled: settings.autoReloadEnabled,
      autoReloadThresholdDollars: settings.autoReloadThresholdDollars,
      autoReloadThresholdPoints: settings.autoReloadThresholdPoints,
      autoReloadAmountDollars: settings.autoReloadAmountDollars,
      includedTotalPoints: settings.includedTotalPoints,
      includedRemainingPoints: settings.includedRemainingPoints,
      includedResetAt: settings.includedResetAt,
      debtPoints: settings.debtPoints,
      legacyRedisMigrated: settings.legacyRedisMigrated,
    };
  } catch (error) {
    console.error("Error getting extra usage balance:", error);
    return null;
  }
}

/**
 * Claim the user's one lifetime free Agent run. Returns true if THIS call
 * claimed it (first ever agent run), false if it was already used — in which
 * case the caller must draw from the prepaid balance. Errors propagate so a
 * Convex hiccup surfaces as a retryable rate-limit error rather than silently
 * granting or denying.
 */
export async function claimFreeAgentRun(userId: string): Promise<boolean> {
  const convex = getConvexClient();
  const result = await convex.mutation(
    api.extraUsage.claimFreeAgentRunForBackend,
    {
      serviceKey: getConvexServiceKey()!,
      userId,
    },
  );
  return result.granted;
}

/**
 * Refund (un-claim) the user's one free Agent run after a failed agent run, so
 * the lifetime gate is only spent on a run that actually completed. Resilient —
 * never throws (called from error handlers); returns true on success.
 */
export async function refundFreeAgentRun(userId: string): Promise<boolean> {
  try {
    const convex = getConvexClient();
    await convex.mutation(api.extraUsage.refundFreeAgentRunForBackend, {
      serviceKey: getConvexServiceKey()!,
      userId,
    });
    return true;
  } catch (error) {
    console.error("Error refunding free agent run:", error);
    return false;
  }
}

/**
 * Deduct from user's prepaid balance for extra usage.
 * Also triggers auto-reload if enabled and balance is below threshold.
 * All logic is handled internally by the Convex action.
 *
 * Passes points directly to Convex to avoid precision loss from dollar conversion.
 *
 * @param userId - User ID
 * @param pointsUsed - Number of points to deduct
 */
export interface RefundBalanceResult {
  success: boolean;
  newBalanceDollars: number;
  /** True if no refund was performed (e.g., pointsToRefund <= 0) */
  noOp?: boolean;
}

/**
 * Refund points to user's prepaid balance (for failed requests).
 * This is the reverse of deductFromBalance.
 *
 * @param userId - User ID
 * @param pointsToRefund - Number of points to refund
 */
export async function refundToBalance(
  userId: string,
  pointsToRefund: number,
): Promise<RefundBalanceResult> {
  // No-op: nothing to refund, balance unchanged (actual balance not fetched to avoid extra call)
  if (pointsToRefund <= 0) {
    return {
      success: true,
      newBalanceDollars: 0,
      noOp: true,
    };
  }

  try {
    const convex = getConvexClient();

    const result = await convex.mutation(api.extraUsage.refundPoints, {
      serviceKey: getConvexServiceKey()!,
      userId,
      amountPoints: pointsToRefund,
    });

    return {
      success: result.success,
      newBalanceDollars: result.newBalanceDollars,
    };
  } catch (error) {
    console.error("Error refunding to balance:", error);
    return {
      success: false,
      newBalanceDollars: 0,
    };
  }
}

/**
 * Deduct from user's prepaid balance for extra usage.
 * Also triggers auto-reload if enabled and balance is below threshold.
 * All logic is handled internally by the Convex action.
 *
 * Passes points directly to Convex to avoid precision loss from dollar conversion.
 *
 * @param userId - User ID
 * @param pointsUsed - Number of points to deduct
 */
export async function deductFromBalance(
  userId: string,
  pointsUsed: number,
): Promise<DeductBalanceResult> {
  // No-op: nothing to deduct, balance unchanged (actual balance not fetched to avoid extra call)
  if (pointsUsed <= 0) {
    return {
      success: true,
      newBalanceDollars: 0,
      insufficientFunds: false,
      monthlyCapExceeded: false,
      noOp: true,
    };
  }

  try {
    const convex = getConvexClient();

    // Use the Convex action that handles deduction + auto-reload internally
    // Pass points directly to avoid precision loss from dollar conversion
    const result = await convex.action(
      api.extraUsageActions.deductWithAutoReload,
      {
        serviceKey: getConvexServiceKey()!,
        userId,
        amountPoints: pointsUsed,
      },
    );

    return {
      success: result.success,
      newBalanceDollars: result.newBalanceDollars,
      insufficientFunds: result.insufficientFunds,
      monthlyCapExceeded: result.monthlyCapExceeded,
      autoReloadTriggered: result.autoReloadTriggered,
      autoReloadResult: result.autoReloadResult,
    };
  } catch (error) {
    console.error("Error deducting from balance:", error);
    // Do NOT report as insufficientFunds — this was a service error, not an
    // empty balance. Returning insufficientFunds: false lets the caller
    // distinguish transient failures from actual balance exhaustion.
    return {
      success: false,
      newBalanceDollars: 0,
      insufficientFunds: false,
      monthlyCapExceeded: false,
    };
  }
}

export interface PlanCreditDeductResult extends DeductBalanceResult {
  includedPointsDeducted: number;
  purchasedPointsDeducted: number;
  includedTotalPoints: number;
  includedRemainingPoints: number;
  includedResetAt?: string;
  debtPoints: number;
}

/**
 * Atomically spend Pro/Max account credits: expiring included allowance first,
 * then permanent add-ons. This is the only authorization path for consumer
 * paid plans after the Redis-ledger cutover.
 */
export async function deductFromPlanCredits(
  userId: string,
  subscription: "pro" | "ultra",
  pointsUsed: number,
  options: { allowAutoReload?: boolean; allowDebt?: boolean } = {},
): Promise<PlanCreditDeductResult> {
  const convex = getConvexClient();
  // No retries or action fallback: a failed response can follow a committed debit.
  const result: PlanCreditDeductResult =
    options.allowAutoReload !== true
      ? await convex.mutation(
          api.extraUsage.deductPlanCreditsWithoutAutoReload,
          {
            serviceKey: getConvexServiceKey()!,
            userId,
            amountPoints: pointsUsed,
            subscription,
            allowDebt: options.allowDebt,
          },
        )
      : await convex.action(api.extraUsageActions.deductWithAutoReload, {
          serviceKey: getConvexServiceKey()!,
          userId,
          amountPoints: pointsUsed,
          subscription,
          allowAutoReload: options.allowAutoReload,
          allowDebt: options.allowDebt,
        });
  return {
    success: result.success,
    newBalanceDollars: result.newBalanceDollars,
    insufficientFunds: result.insufficientFunds,
    monthlyCapExceeded: result.monthlyCapExceeded,
    autoReloadTriggered: result.autoReloadTriggered,
    autoReloadResult: result.autoReloadResult,
    includedPointsDeducted: result.includedPointsDeducted,
    purchasedPointsDeducted: result.purchasedPointsDeducted,
    includedTotalPoints: result.includedTotalPoints,
    includedRemainingPoints: result.includedRemainingPoints,
    includedResetAt: result.includedResetAt,
    debtPoints: result.debtPoints,
  };
}

export async function migrateLegacyPlanCredits(
  userId: string,
  allowancePoints: number,
  legacyConsumedPoints: number,
  migrationKey: string,
): Promise<{ usedPoints: number; remainingPoints: number }> {
  const convex = getConvexClient();
  return convex.mutation(api.extraUsage.migrateLegacyIncludedUsage, {
    serviceKey: getConvexServiceKey()!,
    userId,
    allowancePoints,
    legacyConsumedPoints,
    migrationKey,
  });
}

/** Restore a failed account-ledger reservation to the exact original sources. */
export async function refundPlanCredits(
  userId: string,
  refundKey: string,
  includedPoints: number,
  purchasedPoints: number,
): Promise<void> {
  if (includedPoints <= 0 && purchasedPoints <= 0) return;
  const convex = getConvexClient();
  const result = await convex.mutation(
    api.extraUsage.refundPlanCreditDeduction,
    {
      serviceKey: getConvexServiceKey()!,
      userId,
      refundKey,
      includedPoints,
      purchasedPoints,
    },
  );
  if (!result.success) {
    throw new Error("Failed to refund account credit reservation");
  }
}

// =============================================================================
// Team-pool variants
// Same shape as the per-user functions above but org-scoped: balance lives on
// the org and per-member caps are enforced inside the Convex mutation.
// =============================================================================

export interface TeamExtraUsageState {
  enabled: boolean;
  balanceDollars: number;
  balancePoints: number;
  autoReloadEnabled: boolean;
  memberDisabled: boolean;
}

/**
 * Get the org's team-pool state plus this member's disabled flag.
 * Used by the rate limiter to build the ExtraUsageConfig for team users.
 */
export async function getTeamExtraUsageState(
  organizationId: string,
  userId: string,
): Promise<TeamExtraUsageState | null> {
  try {
    const convex = getConvexClient();
    const state = await convex.query(
      api.teamExtraUsage.getTeamExtraUsageStateForBackend,
      {
        serviceKey: getConvexServiceKey()!,
        organizationId,
        userId,
      },
    );
    return {
      enabled: state.enabled,
      balanceDollars: state.balanceDollars,
      balancePoints: state.balancePoints,
      autoReloadEnabled: state.autoReloadEnabled,
      memberDisabled: state.memberDisabled,
    };
  } catch (error) {
    console.error("Error getting team extra usage state:", error);
    return null;
  }
}

/**
 * Deduct from team balance for a specific member. Enforces per-member cap,
 * member-disabled flag, and team-wide cap. Triggers auto-reload on the org's
 * Stripe customer when applicable.
 */
export async function deductFromTeamBalance(
  organizationId: string,
  userId: string,
  pointsUsed: number,
): Promise<DeductBalanceResult> {
  if (pointsUsed <= 0) {
    return {
      success: true,
      newBalanceDollars: 0,
      insufficientFunds: false,
      monthlyCapExceeded: false,
      noOp: true,
    };
  }

  try {
    const convex = getConvexClient();
    const result = await convex.action(
      api.teamExtraUsageActions.deductWithAutoReloadForTeam,
      {
        serviceKey: getConvexServiceKey()!,
        organizationId,
        userId,
        amountPoints: pointsUsed,
      },
    );

    return {
      success: result.success,
      newBalanceDollars: result.newBalanceDollars,
      insufficientFunds: result.insufficientFunds,
      monthlyCapExceeded: result.monthlyCapExceeded,
      autoReloadTriggered: result.autoReloadTriggered,
      autoReloadResult: result.autoReloadResult,
      memberCapExceeded: result.memberCapExceeded,
      memberDisabled: result.memberDisabled,
      poolDisabled: result.poolDisabled,
    };
  } catch (error) {
    console.error("Error deducting from team balance:", error);
    return {
      success: false,
      newBalanceDollars: 0,
      insufficientFunds: false,
      monthlyCapExceeded: false,
    };
  }
}

/**
 * Refund points to team balance (for failed requests). Also decrements
 * the member's monthly_spent so they can spend again later.
 */
export async function refundToTeamBalance(
  organizationId: string,
  userId: string,
  pointsToRefund: number,
): Promise<RefundBalanceResult> {
  if (pointsToRefund <= 0) {
    return {
      success: true,
      newBalanceDollars: 0,
      noOp: true,
    };
  }

  try {
    const convex = getConvexClient();
    const result = await convex.mutation(api.teamExtraUsage.refundTeamPoints, {
      serviceKey: getConvexServiceKey()!,
      organizationId,
      userId,
      amountPoints: pointsToRefund,
    });
    return {
      success: result.success,
      newBalanceDollars: result.newBalanceDollars,
    };
  } catch (error) {
    console.error("Error refunding to team balance:", error);
    return {
      success: false,
      newBalanceDollars: 0,
    };
  }
}
