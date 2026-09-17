import {
  productionCreditBinding,
  productionCreditDenial,
  validateProductionCreditBinding,
} from "./lib/accountCreditProductionAdmission";
import { accountCreditReservationState } from "./lib/accountCreditReservation";
import {
  assertCreditInteger,
  terminalCreditSettlementArgs,
  terminalCreditSettlementResult,
  validateTerminalCreditEvidence,
} from "./lib/accountCreditSettlement";
import type { Doc } from "./_generated/dataModel";
import {
  accountCreditReceipt,
  accountCreditReservationArgs,
  nextCreditAccountingGeneration,
} from "./lib/accountCreditReservation";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { v, type ObjectType } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { validateServiceKey } from "./lib/utils";
import { convexLogger } from "./lib/logger";
import { recordRevenueEventInternal } from "./unitEconomicsLib";
import { activeSubscriptionForUser } from "./subscriptions";
import {
  effectiveGrantedUsedPoints,
  getIncludedCreditsForTier,
  isAdminGrantedSubscription,
  nextUtcMonthStartIso,
} from "../lib/billing/included-credits";

// =============================================================================
// Stripe customer mapping (per-user, pay-as-you-go)
// =============================================================================

/** Read the user's stored Stripe customer id, or null if none yet. */
export const getStripeCustomerIdForUser = internalQuery({
  args: { userId: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("extra_usage")
      .withIndex("by_user_id", (q) => q.eq("user_id", args.userId))
      .first();
    return row?.stripe_customer_id ?? null;
  },
});

/** Persist the user's Stripe customer id (upsert the extra_usage row). */
export const setStripeCustomerIdForUser = internalMutation({
  args: { userId: v.string(), stripeCustomerId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("extra_usage")
      .withIndex("by_user_id", (q) => q.eq("user_id", args.userId))
      .first();
    if (row) {
      await ctx.db.patch(row._id, {
        stripe_customer_id: args.stripeCustomerId,
        updated_at: Date.now(),
      });
    } else {
      await ctx.db.insert("extra_usage", {
        user_id: args.userId,
        balance_points: 0,
        stripe_customer_id: args.stripeCustomerId,
        updated_at: Date.now(),
      });
    }
    return null;
  },
});

// =============================================================================
// Currency Conversion Helpers
// All monetary values are stored in POINTS internally for precision.
// 1 point = $0.0001 (10,000 points = $1), matching the rate limiting system.
// This avoids precision loss when deducting sub-cent amounts.
// =============================================================================

/** Points per dollar (1 point = $0.0001) - must match token-bucket.ts */
const POINTS_PER_DOLLAR = 10_000;

/** Convert dollars to points (for storage) */
const dollarsToPoints = (dollars: number): number =>
  Math.round(dollars * POINTS_PER_DOLLAR);

/** Convert points to dollars (for API response) */
const pointsToDollars = (points: number): number => points / POINTS_PER_DOLLAR;

// =============================================================================
// Webhook Idempotency
// =============================================================================

/**
 * Internal mutation: purge processed_webhooks rows older than cutoff.
 * Stripe only retries within ~72h, so retention of a week is plenty.
 * Iterates oldest-first via the implicit by_creation_time ordering.
 */
export const purgeOldProcessedWebhooks = internalMutation({
  args: {
    cutoffTimeMs: v.number(),
    limit: v.optional(v.number()),
  },
  returns: v.object({ deletedCount: v.number() }),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;

    const rows = await ctx.db
      .query("processed_webhooks")
      .order("asc")
      .take(limit);

    let deletedCount = 0;
    for (const row of rows) {
      if (row.processed_at < args.cutoffTimeMs) {
        await ctx.db.delete(row._id);
        deletedCount++;
      }
    }
    return { deletedCount };
  },
});

/**
 * Check-and-mark a webhook event as processed (idempotency guard).
 * Returns { alreadyProcessed: true } if the event was already recorded.
 * Pass checkOnly: true to only check without marking (mark after successful processing).
 */
export const checkAndMarkWebhook = mutation({
  args: {
    serviceKey: v.string(),
    eventId: v.string(),
    checkOnly: v.optional(v.boolean()),
  },
  returns: v.object({
    alreadyProcessed: v.boolean(),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);

    // .unique() throws if duplicates exist, surfacing any state-machine
    // invariant break instead of silently masking it.
    const existing = await ctx.db
      .query("processed_webhooks")
      .withIndex("by_event_id", (q) => q.eq("event_id", args.eventId))
      .unique();

    if (existing) {
      return { alreadyProcessed: true };
    }

    if (!args.checkOnly) {
      await ctx.db.insert("processed_webhooks", {
        event_id: args.eventId,
        processed_at: Date.now(),
        status: "completed",
      });
    }

    return { alreadyProcessed: false };
  },
});

/**
 * How long a `pending` claim is honored before it can be taken over by a
 * retrying delivery. Sized larger than any reasonable handler runtime so a
 * still-running first attempt is not pre-empted, but small enough that a
 * crashed first attempt unblocks the next Stripe webhook retry within the
 * same retry window (Stripe backs off exponentially over hours).
 */
const STALE_CLAIM_MS = 10 * 60 * 1000;

/**
 * Atomic claim for webhook processing.
 *
 * Replaces the read-then-write `checkAndMarkWebhook(checkOnly: true)` pattern,
 * which was a TOCTOU pair: two concurrent deliveries of the same event could
 * both pass the pre-check and both run side effects before either landed the
 * mark.
 *
 * Returns one of three states atomically:
 *   - "acquired"          : caller now owns the claim; run handler then call
 *                           finalizeWebhookProcessing on success
 *   - "already_processed" : event was finalized previously; skip with 200
 *   - "claim_held"        : another worker is currently processing this event;
 *                           skip with 200 (the holder will finalize, or its
 *                           claim will expire and a future retry takes over)
 *
 * If a `pending` row's claim is older than STALE_CLAIM_MS, this mutation
 * reclaims it and returns "acquired" — this is what allows Stripe webhook
 * retries to recover after a handler crash.
 */
export const claimWebhookProcessing = mutation({
  args: {
    serviceKey: v.string(),
    eventId: v.string(),
  },
  returns: v.object({
    state: v.union(
      v.literal("acquired"),
      v.literal("already_processed"),
      v.literal("claim_held"),
    ),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);

    const now = Date.now();
    // .unique() throws if duplicates exist, surfacing any state-machine
    // invariant break instead of silently masking it.
    const existing = await ctx.db
      .query("processed_webhooks")
      .withIndex("by_event_id", (q) => q.eq("event_id", args.eventId))
      .unique();

    if (!existing) {
      await ctx.db.insert("processed_webhooks", {
        event_id: args.eventId,
        processed_at: now,
        status: "pending",
        claimed_at: now,
      });
      return { state: "acquired" as const };
    }

    // Legacy rows without status were inserted under the older "mark on entry"
    // semantics for events whose lifecycle has already concluded.
    const status = existing.status ?? "completed";

    if (status === "completed") {
      return { state: "already_processed" as const };
    }

    const claimedAt = existing.claimed_at ?? existing.processed_at;
    if (now - claimedAt < STALE_CLAIM_MS) {
      return { state: "claim_held" as const };
    }

    // Stale claim — take it over so Stripe's retry can drive completion.
    await ctx.db.patch(existing._id, {
      status: "pending",
      claimed_at: now,
    });
    return { state: "acquired" as const };
  },
});

/**
 * Mark a previously-claimed webhook as completed.
 *
 * Idempotent: re-finalizing an already-completed event is a no-op. Missing
 * rows are also tolerated (the row should always exist when called immediately
 * after a successful claim, but we don't fail the request if it doesn't).
 */
export const finalizeWebhookProcessing = mutation({
  args: {
    serviceKey: v.string(),
    eventId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);

    // .unique() throws if duplicates exist, surfacing any state-machine
    // invariant break instead of silently masking it.
    const existing = await ctx.db
      .query("processed_webhooks")
      .withIndex("by_event_id", (q) => q.eq("event_id", args.eventId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "completed",
        processed_at: Date.now(),
      });
    }
    return null;
  },
});

// =============================================================================
// Balance Management (Mutations)
// =============================================================================

/**
 * Add credits to user balance (after successful Stripe payment).
 * Idempotent via optional idempotencyKey (Stripe event ID).
 */
export const addCredits = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    amountDollars: v.number(),
    // Volume-bonus tokens (points) granted on top of the dollar amount. Always
    // server-derived (see bonusPointsForDollars) — never client-supplied.
    bonusPoints: v.optional(v.number()),
    idempotencyKey: v.optional(v.string()), // Primary dedup key (session-scoped: `cs_<id>`)
    legacyIdempotencyKey: v.optional(v.string()), // Stripe event ID — checked only to guard pre-deploy webhook retries
    revenueSource: v.optional(
      v.union(
        v.literal("extra_usage_purchase"),
        v.literal("extra_usage_auto_reload"),
      ),
    ),
    stripeCustomerId: v.optional(v.string()),
    stripeCheckoutSessionId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
  },
  returns: v.object({
    newBalance: v.number(), // Returns dollars
    alreadyProcessed: v.boolean(),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);

    // Idempotency: skip if already processed (prevents double-credit on webhook retries
    // and across both the post-checkout confirm path and the async webhook path)
    const sessionKey = args.idempotencyKey;
    if (sessionKey) {
      const durableExisting = await ctx.db
        .query("processed_checkout_sessions")
        .withIndex("by_session_key", (q) => q.eq("session_key", sessionKey))
        .unique();
      if (durableExisting) {
        return { newBalance: 0, alreadyProcessed: true };
      }
    }

    const dedupKeys = [args.idempotencyKey, args.legacyIdempotencyKey].filter(
      (k): k is string => typeof k === "string" && k.length > 0,
    );
    for (const key of dedupKeys) {
      const existing = await ctx.db
        .query("processed_webhooks")
        .withIndex("by_event_id", (q) => q.eq("event_id", key))
        .first();

      if (existing) {
        return { newBalance: 0, alreadyProcessed: true };
      }
    }

    // Validate amount
    if (isNaN(args.amountDollars) || args.amountDollars <= 0) {
      throw new Error("Invalid amount: must be a positive number");
    }

    const bonusPoints =
      args.bonusPoints && args.bonusPoints > 0
        ? Math.floor(args.bonusPoints)
        : 0;
    const amountPoints = dollarsToPoints(args.amountDollars) + bonusPoints;

    // Get current settings
    const settings = await ctx.db
      .query("extra_usage")
      .withIndex("by_user_id", (q) => q.eq("user_id", args.userId))
      .first();

    const currentBalancePoints = settings?.balance_points ?? 0;
    const currentDebtPoints = Math.max(
      0,
      Math.floor(settings?.credit_debt_points ?? 0),
    );
    const debtSettledPoints = Math.min(currentDebtPoints, amountPoints);
    const creditedPoints = amountPoints - debtSettledPoints;
    const newBalancePoints = currentBalancePoints + creditedPoints;
    const newDebtPoints = currentDebtPoints - debtSettledPoints;

    // Update or create settings
    const now = Date.now();
    if (settings) {
      await ctx.db.patch(settings._id, {
        balance_points: newBalancePoints,
        credit_debt_points: newDebtPoints,
        updated_at: now,
      });
    } else {
      await ctx.db.insert("extra_usage", {
        user_id: args.userId,
        balance_points: newBalancePoints,
        updated_at: now,
      });
    }

    // Mark processed after success (so retries work if above fails)
    if (args.idempotencyKey) {
      await ctx.db.insert("processed_checkout_sessions", {
        session_key: args.idempotencyKey,
        processed_at: Date.now(),
        user_id: args.userId,
        credited_points: amountPoints,
      });
      await ctx.db.insert("processed_webhooks", {
        event_id: args.idempotencyKey,
        processed_at: Date.now(),
      });
    }

    await recordRevenueEventInternal(ctx, {
      entityType: "user",
      entityId: args.userId,
      userId: args.userId,
      source: "extra_usage",
      sourceEventId:
        args.stripeCheckoutSessionId ??
        args.stripePaymentIntentId ??
        args.idempotencyKey ??
        `extra_usage:${args.userId}:${Date.now()}`,
      idempotencyKey:
        args.idempotencyKey ??
        args.stripePaymentIntentId ??
        args.stripeCheckoutSessionId,
      grossRevenueDollars: args.amountDollars,
      currency: "usd",
      attributionStrategy: "direct",
      stripeCustomerId: args.stripeCustomerId,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      stripePaymentIntentId: args.stripePaymentIntentId,
      description: args.revenueSource ?? "extra_usage_purchase",
    });

    convexLogger.info("credits_added", {
      user_id: args.userId,
      amount_dollars: args.amountDollars,
      amount_points: amountPoints,
      credited_points: creditedPoints,
      debt_settled_points: debtSettledPoints,
      new_balance_points: newBalancePoints,
      new_balance_dollars: pointsToDollars(newBalancePoints),
      idempotency_key: args.idempotencyKey,
    });

    return {
      newBalance: pointsToDollars(newBalancePoints),
      alreadyProcessed: false,
    };
  },
});

/**
 * Revoke credits after a partial or full LemonSqueezy add-on order refund.
 *
 * `cumulativeRefundUsdCents` and `targetRevokedPoints` are both cumulative
 * high-water marks derived from the signed Order object. Keeping them on the
 * durable purchase row makes duplicate and out-of-order webhook delivery
 * idempotent: only the delta above the largest successfully processed refund
 * can change the account ledger.
 */
export const revokeCreditsForRefund = mutation({
  args: {
    serviceKey: v.string(),
    purchaseKey: v.string(),
    userId: v.optional(v.string()),
    originalGrantPoints: v.number(),
    cumulativeRefundUsdCents: v.number(),
    targetRevokedPoints: v.number(),
  },
  returns: v.object({
    alreadyProcessed: v.boolean(),
    accountFound: v.boolean(),
    revokedPoints: v.number(),
    totalRevokedPoints: v.number(),
    newBalancePoints: v.number(),
    debtPoints: v.number(),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);

    const optionalUserId = args.userId?.trim() || undefined;
    if (!args.purchaseKey.startsWith("ls_") || args.purchaseKey.length <= 3) {
      throw new Error("Invalid LemonSqueezy purchase key");
    }
    if (
      !Number.isSafeInteger(args.originalGrantPoints) ||
      args.originalGrantPoints <= 0 ||
      !Number.isSafeInteger(args.cumulativeRefundUsdCents) ||
      args.cumulativeRefundUsdCents <= 0 ||
      !Number.isSafeInteger(args.targetRevokedPoints) ||
      args.targetRevokedPoints < 0 ||
      args.targetRevokedPoints > args.originalGrantPoints
    ) {
      throw new Error("Invalid LemonSqueezy refund amounts");
    }

    const purchase = await ctx.db
      .query("processed_checkout_sessions")
      .withIndex("by_session_key", (q) => q.eq("session_key", args.purchaseKey))
      .unique();
    // A refund arriving before order_created must be retried rather than
    // revoking an order that this ledger never credited.
    if (!purchase) {
      throw new Error("Credited LemonSqueezy purchase not found");
    }

    const userId = purchase.user_id?.trim() || optionalUserId;
    if (!userId) {
      throw new Error("LemonSqueezy purchase user is unresolved");
    }
    if (
      purchase.user_id &&
      optionalUserId &&
      purchase.user_id !== optionalUserId
    ) {
      throw new Error("LemonSqueezy purchase user mismatch");
    }
    if (
      purchase.credited_points !== undefined &&
      purchase.credited_points !== args.originalGrantPoints
    ) {
      throw new Error("LemonSqueezy purchase grant mismatch");
    }

    const priorRefundUsdCents = purchase.refunded_usd_cents ?? 0;
    const priorRevokedPoints = purchase.revoked_points ?? 0;
    if (
      !Number.isSafeInteger(priorRefundUsdCents) ||
      priorRefundUsdCents < 0 ||
      !Number.isSafeInteger(priorRevokedPoints) ||
      priorRevokedPoints < 0 ||
      priorRevokedPoints > args.originalGrantPoints
    ) {
      throw new Error("Invalid stored LemonSqueezy refund state");
    }

    // Exact duplicate or a delayed event with a lower cumulative refund.
    if (args.cumulativeRefundUsdCents <= priorRefundUsdCents) {
      const settings = await ctx.db
        .query("extra_usage")
        .withIndex("by_user_id", (q) => q.eq("user_id", userId))
        .first();
      const rawBalance = Math.floor(settings?.balance_points ?? 0);
      const legacyNegativeDebt = Math.max(0, -rawBalance);
      return {
        alreadyProcessed: true,
        accountFound: !!settings,
        revokedPoints: 0,
        totalRevokedPoints: priorRevokedPoints,
        newBalancePoints: Math.max(0, rawBalance),
        debtPoints:
          Math.max(0, Math.floor(settings?.credit_debt_points ?? 0)) +
          legacyNegativeDebt,
      };
    }
    if (args.targetRevokedPoints < priorRevokedPoints) {
      throw new Error("LemonSqueezy cumulative refund regressed");
    }

    const revokedPoints = args.targetRevokedPoints - priorRevokedPoints;
    const settings = await ctx.db
      .query("extra_usage")
      .withIndex("by_user_id", (q) => q.eq("user_id", userId))
      .first();
    const rawBalance = Math.floor(settings?.balance_points ?? 0);
    const currentBalance = Math.max(0, rawBalance);
    // Older rows may encode debt as a negative balance. Normalize that legacy
    // state into credit_debt_points while applying the refund so balance_points
    // remains non-negative under the current ledger contract.
    const legacyNegativeDebt = Math.max(0, -rawBalance);
    const currentDebt =
      Math.max(0, Math.floor(settings?.credit_debt_points ?? 0)) +
      legacyNegativeDebt;
    const revokedFromBalance = Math.min(currentBalance, revokedPoints);
    const newBalancePoints = currentBalance - revokedFromBalance;
    const debtPoints = settings
      ? currentDebt + Math.max(0, revokedPoints - revokedFromBalance)
      : 0;
    const now = Date.now();

    if (settings) {
      await ctx.db.patch(settings._id, {
        balance_points: newBalancePoints,
        credit_debt_points: debtPoints,
        credit_accounting_generation: nextCreditAccountingGeneration(
          settings.credit_accounting_generation,
        ),
        updated_at: now,
      });
    }
    // If the user deleted their account, there is no balance left to revoke.
    // Still advance the purchase high-water mark so provider retries terminate.
    await ctx.db.patch(purchase._id, {
      user_id: userId,
      credited_points: args.originalGrantPoints,
      refunded_usd_cents: args.cumulativeRefundUsdCents,
      revoked_points: args.targetRevokedPoints,
      refund_updated_at: now,
    });

    convexLogger.info("credits_revoked_for_refund", {
      user_id: userId,
      purchase_key: args.purchaseKey,
      cumulative_refund_usd_cents: args.cumulativeRefundUsdCents,
      revoked_points: revokedPoints,
      total_revoked_points: args.targetRevokedPoints,
      new_balance_points: newBalancePoints,
      debt_points: debtPoints,
      account_found: !!settings,
    });

    return {
      alreadyProcessed: false,
      accountFound: !!settings,
      revokedPoints,
      totalRevokedPoints: args.targetRevokedPoints,
      newBalancePoints,
      debtPoints,
    };
  },
});

/**
 * Deduct points from user balance for usage (points-based API).
 * Accepts points directly, avoiding precision loss from dollar conversion.
 * Used by the rate limiting system which operates in points.
 */
const deductPointsArgs = {
  serviceKey: v.string(),
  userId: v.string(),
  amountPoints: v.number(),
  // Present only on the Pro/Max account-ledger path. Without this value the
  // mutation spends purchased balance only (free/legacy overflow).
  includedAllowancePoints: v.optional(v.number()),
  // An authoritative post-stream true-up can consume everything available
  // and record the uncovered remainder instead of silently giving output
  // away when preflight underestimated the final provider cost.
  allowDebt: v.optional(v.boolean()),
};

const deductPointsDefinition = {
  args: deductPointsArgs,
  returns: v.object({
    success: v.boolean(),
    newBalancePoints: v.number(),
    newBalanceDollars: v.number(),
    insufficientFunds: v.boolean(),
    monthlyCapExceeded: v.boolean(),
    includedPointsDeducted: v.number(),
    purchasedPointsDeducted: v.number(),
    includedTotalPoints: v.number(),
    includedRemainingPoints: v.number(),
    debtPoints: v.number(),
  }),
  handler: async (
    ctx: MutationCtx,
    args: ObjectType<typeof deductPointsArgs>,
  ) => {
    validateServiceKey(args.serviceKey);

    let settings = await ctx.db
      .query("extra_usage")
      .withIndex("by_user_id", (q) => q.eq("user_id", args.userId))
      .first();
    // Older admin grants could leave funded balance alongside prior usage debt.
    // Settle that already-incurred usage atomically before authorizing new work.
    // It is not part of this request's refundable reservation or spending cap.
    const debtPayment = Math.min(
      Math.max(0, Math.floor(settings?.balance_points ?? 0)),
      Math.max(0, Math.floor(settings?.credit_debt_points ?? 0)),
    );
    if (settings && debtPayment > 0) {
      const settlement = {
        balance_points: (settings.balance_points ?? 0) - debtPayment,
        credit_debt_points: (settings.credit_debt_points ?? 0) - debtPayment,
        updated_at: Date.now(),
      };
      await ctx.db.patch(settings._id, settlement);
      settings = { ...settings, ...settlement };
    }
    const currentBalancePoints = settings?.balance_points ?? 0;
    const existingDebtPoints = Math.max(
      0,
      Math.floor(settings?.credit_debt_points ?? 0),
    );
    const accountLedgerDeduction = args.includedAllowancePoints !== undefined;
    // An explicit zero is a webhook revocation and wins over a stale tier
    // captured by an in-flight request. Rows without a grant are legacy paid
    // accounts and may be bootstrapped from the server-derived tier allowance.
    const explicitlyRevoked = settings?.monthly_granted_points === 0;
    const grantedTotal =
      accountLedgerDeduction && !explicitlyRevoked
        ? Math.max(0, Math.floor(args.includedAllowancePoints ?? 0))
        : 0;
    // Billing-cycle resets are webhook-driven for PAID plans. YYYY-MM is
    // deliberately not consulted for them; a calendar boundary is not a paid
    // renewal. An admin-granted plan is the one exception: no provider, no
    // webhook, so the calendar month is its cycle -- without this, an admin
    // account that exhausted its allowance once was enforced at zero forever
    // and silently burned its purchased balance instead.
    const deductSubscription = accountLedgerDeduction
      ? await activeSubscriptionForUser(ctx, args.userId)
      : null;
    const grantedCycle = effectiveGrantedUsedPoints({
      storedUsedPoints: settings?.monthly_granted_used_points ?? 0,
      storedCycleMonth: settings?.monthly_granted_reset_date,
      adminGranted: isAdminGrantedSubscription(
        deductSubscription?.ls_subscription_id,
      ),
      now: Date.now(),
    });
    const grantedUsed = accountLedgerDeduction
      ? Math.min(grantedTotal, grantedCycle.usedPoints)
      : 0;
    const grantedAvailable = Math.max(0, grantedTotal - grantedUsed);

    if (existingDebtPoints > 0 && !args.allowDebt) {
      return {
        success: false,
        newBalancePoints: currentBalancePoints,
        newBalanceDollars: pointsToDollars(currentBalancePoints),
        insufficientFunds: true,
        monthlyCapExceeded: false,
        includedPointsDeducted: 0,
        purchasedPointsDeducted: 0,
        includedTotalPoints: grantedTotal,
        includedRemainingPoints: grantedAvailable,
        debtPoints: existingDebtPoints,
      };
    }

    const now = new Date();
    const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const requestedPoints = Math.max(0, Math.floor(args.amountPoints));
    const availablePoints = grantedAvailable + currentBalancePoints;
    const amountToConsume = args.allowDebt
      ? Math.min(requestedPoints, availablePoints)
      : requestedPoints;
    const fromGranted = Math.min(grantedAvailable, amountToConsume);
    const fromBalance = amountToConsume - fromGranted;
    const uncoveredPoints = Math.max(0, requestedPoints - amountToConsume);

    if (availablePoints < requestedPoints && !args.allowDebt) {
      convexLogger.warn("deduct_points_failed", {
        user_id: args.userId,
        amount_points: requestedPoints,
        current_balance_points: currentBalancePoints,
        granted_available_points: grantedAvailable,
        reason: "insufficient_balance",
        insufficient_funds: true,
      });
      return {
        success: false,
        newBalancePoints: currentBalancePoints,
        newBalanceDollars: pointsToDollars(currentBalancePoints),
        insufficientFunds: true,
        monthlyCapExceeded: false,
        includedPointsDeducted: 0,
        purchasedPointsDeducted: 0,
        includedTotalPoints: grantedTotal,
        includedRemainingPoints: grantedAvailable,
        debtPoints: existingDebtPoints,
      };
    }

    // The add-on spending cap remains calendar-month based, but it applies
    // only to permanent purchased credits—not the included plan allowance.
    let monthlySpentPoints = settings?.monthly_spent_points ?? 0;
    const shouldResetMonthly = settings?.monthly_reset_date !== currentMonth;
    if (shouldResetMonthly) {
      monthlySpentPoints = 0;
    }

    const monthlyCapPoints = settings?.monthly_cap_points;
    if (monthlyCapPoints !== undefined) {
      const newMonthlySpent = monthlySpentPoints + fromBalance;
      if (newMonthlySpent > monthlyCapPoints) {
        convexLogger.warn("deduct_points_failed", {
          user_id: args.userId,
          amount_points: args.amountPoints,
          monthly_spent_points: monthlySpentPoints,
          monthly_cap_points: monthlyCapPoints,
          reason: "monthly_cap_exceeded",
          monthly_cap_exceeded: true,
        });
        return {
          success: false,
          newBalancePoints: currentBalancePoints,
          newBalanceDollars: pointsToDollars(currentBalancePoints),
          insufficientFunds: true,
          monthlyCapExceeded: true,
          includedPointsDeducted: 0,
          purchasedPointsDeducted: 0,
          includedTotalPoints: grantedTotal,
          includedRemainingPoints: grantedAvailable,
          debtPoints: existingDebtPoints,
        };
      }
    }

    monthlySpentPoints += fromBalance;
    const newGrantedUsedPoints = grantedUsed + fromGranted;
    const newBalancePoints = currentBalancePoints - fromBalance;
    const nextDebtPoints = existingDebtPoints + uncoveredPoints;
    const accountingRebased =
      shouldResetMonthly ||
      (accountLedgerDeduction &&
        (grantedUsed !== (settings?.monthly_granted_used_points ?? 0) ||
          grantedTotal !== settings?.monthly_granted_points ||
          grantedCycle.cycleMonth !== settings?.monthly_granted_reset_date));
    const update = {
      ...(accountingRebased && {
        credit_accounting_generation: nextCreditAccountingGeneration(
          settings?.credit_accounting_generation,
        ),
      }),
      balance_points: newBalancePoints,
      monthly_spent_points: monthlySpentPoints,
      monthly_reset_date: currentMonth,
      credit_debt_points: nextDebtPoints,
      ...(accountLedgerDeduction && {
        // Reconcile historical 2M Max rows to the canonical 1.8M ceiling on
        // every authoritative debit.
        monthly_granted_points: grantedTotal,
        monthly_granted_used_points: newGrantedUsedPoints,
        // Stamp the calendar cycle this debit was computed against, so the
        // rollover happens exactly once per month instead of on every read.
        monthly_granted_reset_date: grantedCycle.cycleMonth,
      }),
      updated_at: Date.now(),
    };
    if (settings) {
      await ctx.db.patch(settings._id, update);
    } else {
      await ctx.db.insert("extra_usage", {
        user_id: args.userId,
        ...update,
      });
    }

    convexLogger.info("points_deducted", {
      user_id: args.userId,
      amount_points: requestedPoints,
      previous_balance_points: currentBalancePoints,
      new_balance_points: newBalancePoints,
      monthly_spent_points: monthlySpentPoints,
      monthly_cap_points: monthlyCapPoints,
      included_points_deducted: fromGranted,
      purchased_points_deducted: fromBalance,
      debt_points: nextDebtPoints,
    });

    return {
      success: uncoveredPoints === 0,
      newBalancePoints,
      newBalanceDollars: pointsToDollars(newBalancePoints),
      insufficientFunds: uncoveredPoints > 0,
      monthlyCapExceeded: false,
      includedPointsDeducted: fromGranted,
      purchasedPointsDeducted: fromBalance,
      includedTotalPoints: grantedTotal,
      includedRemainingPoints: Math.max(0, grantedTotal - newGrantedUsedPoints),
      debtPoints: nextDebtPoints,
    };
  },
};

export const deductPoints = mutation(deductPointsDefinition);

/**
 * Grant (or revoke) a user's monthly subscription allowance. Called by the
 * LemonSqueezy webhook on each successful subscription payment (allowancePoints
 * = the tier's monthly allowance) and on cancel/expire (allowancePoints = 0).
 * A stable provider billing-cycle key, not YYYY-MM, controls resets.
 */
export const grantMonthlyAllowance = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    allowancePoints: v.number(),
    cycleKey: v.optional(v.string()),
    cycleStartedAt: v.optional(v.string()),
    resetsAt: v.optional(v.string()),
    resetUsage: v.optional(v.boolean()),
  },
  returns: v.object({ ok: v.boolean(), reset: v.boolean() }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const allowance = Math.max(0, Math.floor(args.allowancePoints));
    const settings = await ctx.db
      .query("extra_usage")
      .withIndex("by_user_id", (q) => q.eq("user_id", args.userId))
      .first();
    if (settings) {
      const hasExistingGrant = settings.monthly_granted_points !== undefined;
      const incomingCycleStartedAt = args.cycleStartedAt
        ? Date.parse(args.cycleStartedAt)
        : Number.NaN;
      const existingCycleStartedAt = settings.monthly_granted_cycle_started_at
        ? Date.parse(settings.monthly_granted_cycle_started_at)
        : Number.NaN;
      const cycleIsNotOlder =
        !Number.isFinite(existingCycleStartedAt) ||
        (Number.isFinite(incomingCycleStartedAt) &&
          incomingCycleStartedAt >= existingCycleStartedAt);
      const newPaidCycle =
        args.resetUsage === true &&
        !!args.cycleKey &&
        settings.monthly_granted_cycle_key !== args.cycleKey &&
        cycleIsNotOlder;
      const shouldReset = !hasExistingGrant || newPaidCycle;
      const existingDebt = Math.max(
        0,
        Math.floor(settings.credit_debt_points ?? 0),
      );
      const debtPaidFromAllowance =
        shouldReset && allowance > 0 ? Math.min(existingDebt, allowance) : 0;
      const used = shouldReset
        ? debtPaidFromAllowance
        : Math.max(0, settings.monthly_granted_used_points ?? 0);
      await ctx.db.patch(settings._id, {
        ...((shouldReset || settings.monthly_granted_points !== allowance) && {
          credit_accounting_generation: nextCreditAccountingGeneration(
            settings.credit_accounting_generation,
          ),
        }),
        monthly_granted_points: allowance,
        monthly_granted_used_points: used,
        monthly_granted_cycle_key: shouldReset
          ? args.cycleKey
          : settings.monthly_granted_cycle_key,
        monthly_granted_cycle_started_at: shouldReset
          ? args.cycleStartedAt
          : settings.monthly_granted_cycle_started_at,
        monthly_granted_resets_at:
          args.resetsAt ?? settings.monthly_granted_resets_at,
        credit_debt_points: Math.max(0, existingDebt - debtPaidFromAllowance),
        updated_at: Date.now(),
      });
      return { ok: true, reset: shouldReset };
    } else {
      await ctx.db.insert("extra_usage", {
        user_id: args.userId,
        balance_points: 0,
        credit_accounting_generation: 1,
        monthly_granted_points: allowance,
        monthly_granted_used_points: 0,
        monthly_granted_cycle_key: args.cycleKey,
        monthly_granted_cycle_started_at: args.cycleStartedAt,
        monthly_granted_resets_at: args.resetsAt,
        updated_at: Date.now(),
      });
      return { ok: true, reset: true };
    }
  },
});

/**
 * Fold the retired Redis bucket's already-consumed points into the account
 * ledger exactly once. The caller deletes the Redis keys only after this
 * mutation succeeds, making the cutover retry-safe under concurrent requests.
 */
export const migrateLegacyIncludedUsage = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    allowancePoints: v.number(),
    legacyConsumedPoints: v.number(),
    migrationKey: v.string(),
  },
  returns: v.object({
    alreadyMigrated: v.boolean(),
    usedPoints: v.number(),
    remainingPoints: v.number(),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const requestedAllowance = Math.max(0, Math.floor(args.allowancePoints));
    const legacyConsumed = Math.max(0, Math.floor(args.legacyConsumedPoints));
    const settings = await ctx.db
      .query("extra_usage")
      .withIndex("by_user_id", (q) => q.eq("user_id", args.userId))
      .first();

    const allowance =
      settings?.monthly_granted_points === 0 ? 0 : requestedAllowance;
    if (settings?.legacy_redis_migration_key === args.migrationKey) {
      const used = Math.min(
        allowance,
        Math.max(0, settings.monthly_granted_used_points ?? 0),
      );
      return {
        alreadyMigrated: true,
        usedPoints: used,
        remainingPoints: Math.max(0, allowance - used),
      };
    }

    // Some users had already spilled into Convex's duplicate allowance. Add
    // that spend to the Redis consumption and clamp at the new canonical cap.
    const priorUsed = Math.max(
      0,
      Math.floor(settings?.monthly_granted_used_points ?? 0),
    );
    const used = Math.min(allowance, priorUsed + legacyConsumed);
    const update = {
      credit_accounting_generation: nextCreditAccountingGeneration(
        settings?.credit_accounting_generation,
      ),
      monthly_granted_points: allowance,
      monthly_granted_used_points: used,
      legacy_redis_migration_key: args.migrationKey,
      legacy_redis_consumed_points: legacyConsumed,
      updated_at: Date.now(),
    };
    if (settings) {
      await ctx.db.patch(settings._id, update);
    } else {
      await ctx.db.insert("extra_usage", {
        user_id: args.userId,
        balance_points: 0,
        ...update,
      });
    }
    return {
      alreadyMigrated: false,
      usedPoints: used,
      remainingPoints: Math.max(0, allowance - used),
    };
  },
});

/** Restore a failed request to the exact sources used by its preflight debit. */
export const refundPlanCreditDeduction = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    refundKey: v.string(),
    includedPoints: v.number(),
    purchasedPoints: v.number(),
  },
  returns: v.object({
    success: v.boolean(),
    alreadyProcessed: v.boolean(),
    includedUsedPoints: v.number(),
    balancePoints: v.number(),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const settings = await ctx.db
      .query("extra_usage")
      .withIndex("by_user_id", (q) => q.eq("user_id", args.userId))
      .first();
    if (!settings) {
      return {
        success: false,
        alreadyProcessed: false,
        includedUsedPoints: 0,
        balancePoints: 0,
      };
    }

    const processed = await ctx.db
      .query("processed_credit_refunds")
      .withIndex("by_refund_key", (q) => q.eq("refund_key", args.refundKey))
      .first();
    if (processed) {
      return {
        success: true,
        alreadyProcessed: true,
        includedUsedPoints: Math.max(
          0,
          settings.monthly_granted_used_points ?? 0,
        ),
        balancePoints: settings.balance_points ?? 0,
      };
    }

    const includedRefund = Math.max(0, Math.floor(args.includedPoints));
    const purchasedRefund = Math.max(0, Math.floor(args.purchasedPoints));
    const currentUsed = Math.max(
      0,
      Math.floor(settings.monthly_granted_used_points ?? 0),
    );
    // Never mint permanent balance for included credits. Each source is
    // reversed independently, and purchased-spend tracking is reversed too.
    const includedUsedPoints = Math.max(0, currentUsed - includedRefund);
    const balancePoints = (settings.balance_points ?? 0) + purchasedRefund;
    const monthlySpentPoints = Math.max(
      0,
      (settings.monthly_spent_points ?? 0) - purchasedRefund,
    );
    await ctx.db.patch(settings._id, {
      ...((includedRefund > 0 || purchasedRefund > 0) && {
        credit_accounting_generation: nextCreditAccountingGeneration(
          settings.credit_accounting_generation,
        ),
      }),
      monthly_granted_used_points: includedUsedPoints,
      balance_points: balancePoints,
      monthly_spent_points: monthlySpentPoints,
      updated_at: Date.now(),
    });
    await ctx.db.insert("processed_credit_refunds", {
      refund_key: args.refundKey,
      user_id: args.userId,
      processed_at: Date.now(),
    });
    return {
      success: true,
      alreadyProcessed: false,
      includedUsedPoints,
      balancePoints,
    };
  },
});

/**
 * Refund points to user balance (for failed requests).
 * This is the reverse of deductPoints - adds points back to the balance.
 * Does NOT affect monthly spending tracking (refunds don't reduce spent amount).
 */
export const refundPoints = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    amountPoints: v.number(),
  },
  returns: v.object({
    success: v.boolean(),
    newBalancePoints: v.number(),
    newBalanceDollars: v.number(),
    noOp: v.optional(v.boolean()),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);

    // No-op: nothing to refund
    if (args.amountPoints <= 0) {
      return {
        success: true,
        newBalancePoints: 0,
        newBalanceDollars: 0,
        noOp: true,
      };
    }

    // Get current settings
    const settings = await ctx.db
      .query("extra_usage")
      .withIndex("by_user_id", (q) => q.eq("user_id", args.userId))
      .first();

    if (!settings) {
      // No settings record means no balance to refund to - create one
      await ctx.db.insert("extra_usage", {
        user_id: args.userId,
        balance_points: args.amountPoints,
        credit_accounting_generation: 1,
        updated_at: Date.now(),
      });

      convexLogger.info("points_refunded", {
        user_id: args.userId,
        amount_points: args.amountPoints,
        previous_balance_points: 0,
        new_balance_points: args.amountPoints,
        created_new_record: true,
      });

      return {
        success: true,
        newBalancePoints: args.amountPoints,
        newBalanceDollars: pointsToDollars(args.amountPoints),
      };
    }

    const currentBalancePoints = settings.balance_points ?? 0;
    const newBalancePoints = currentBalancePoints + args.amountPoints;

    await ctx.db.patch(settings._id, {
      credit_accounting_generation: nextCreditAccountingGeneration(
        settings.credit_accounting_generation,
      ),
      balance_points: newBalancePoints,
      updated_at: Date.now(),
    });

    convexLogger.info("points_refunded", {
      user_id: args.userId,
      amount_points: args.amountPoints,
      previous_balance_points: currentBalancePoints,
      new_balance_points: newBalancePoints,
    });

    return {
      success: true,
      newBalancePoints,
      newBalanceDollars: pointsToDollars(newBalancePoints),
    };
  },
});

// =============================================================================
// Queries
// =============================================================================

/**
 * Atomically claim the user's one lifetime free Agent run. Returns
 * `{ granted: true }` on the first claim, `{ granted: false }` if already used.
 * The check-then-set runs inside one Convex mutation, so concurrent agent
 * starts can never both be granted.
 */
export const claimFreeAgentRunForBackend = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
  },
  returns: v.object({ granted: v.boolean() }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);

    const settings = await ctx.db
      .query("extra_usage")
      .withIndex("by_user_id", (q) => q.eq("user_id", args.userId))
      .first();

    const claimDate = new Date();
    const currentMonth = `${claimDate.getUTCFullYear()}-${String(claimDate.getUTCMonth() + 1).padStart(2, "0")}`;

    // One free Agent run per calendar month (was lifetime; now resets monthly).
    if (settings?.free_agent_run_month === currentMonth) {
      return { granted: false };
    }

    const now = Date.now();
    if (settings) {
      await ctx.db.patch(settings._id, {
        free_agent_run_month: currentMonth,
        updated_at: now,
      });
    } else {
      await ctx.db.insert("extra_usage", {
        user_id: args.userId,
        balance_points: 0,
        free_agent_run_month: currentMonth,
        updated_at: now,
      });
    }

    return { granted: true };
  },
});

/**
 * Un-claim the user's free Agent run — used to refund the lifetime claim when
 * the agent run that consumed it fails. No-op if it wasn't claimed.
 */
export const refundFreeAgentRunForBackend = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
  },
  returns: v.object({ refunded: v.boolean() }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);

    const settings = await ctx.db
      .query("extra_usage")
      .withIndex("by_user_id", (q) => q.eq("user_id", args.userId))
      .first();

    const refundDate = new Date();
    const currentMonth = `${refundDate.getUTCFullYear()}-${String(refundDate.getUTCMonth() + 1).padStart(2, "0")}`;

    // Only refund the claim if it was made THIS month.
    if (!settings || settings.free_agent_run_month !== currentMonth) {
      return { refunded: false };
    }

    await ctx.db.patch(settings._id, {
      free_agent_run_month: undefined,
      updated_at: Date.now(),
    });
    return { refunded: true };
  },
});

/**
 * Get user's extra usage balance and settings (for backend).
 * Returns balance in both dollars and points for flexibility.
 */
const balanceForBackendArgs = {
  serviceKey: v.string(),
  userId: v.string(),
  subscription: v.optional(v.string()),
};

const balanceForBackendDefinition = {
  args: balanceForBackendArgs,
  returns: v.object({
    balanceDollars: v.number(),
    balancePoints: v.number(),
    enabled: v.boolean(),
    autoReloadEnabled: v.boolean(),
    autoReloadThresholdDollars: v.optional(v.number()),
    autoReloadThresholdPoints: v.optional(v.number()),
    autoReloadAmountDollars: v.optional(v.number()),
    includedTotalPoints: v.number(),
    includedRemainingPoints: v.number(),
    includedResetAt: v.optional(v.string()),
    debtPoints: v.number(),
    legacyRedisMigrated: v.boolean(),
  }),
  handler: async (
    ctx: QueryCtx,
    args: ObjectType<typeof balanceForBackendArgs>,
  ) => {
    validateServiceKey(args.serviceKey);

    // Get enabled flag from user_customization
    const customization = await ctx.db
      .query("user_customization")
      .withIndex("by_user_id", (q) => q.eq("user_id", args.userId))
      .first();

    // Get balance and settings from extra_usage
    const settings = await ctx.db
      .query("extra_usage")
      .withIndex("by_user_id", (q) => q.eq("user_id", args.userId))
      .first();

    const balancePoints = settings?.balance_points ?? 0;
    const thresholdPoints = settings?.auto_reload_threshold_points;
    const activeSubscription = await activeSubscriptionForUser(
      ctx,
      args.userId,
    );
    const tier = args.subscription ?? activeSubscription?.tier ?? "";
    const includedTotalPoints = getIncludedCreditsForTier(tier);
    // Same calendar rollover the debit applies for admin-granted plans, so
    // preflight cannot refuse a run the authoritative deduction would allow.
    const backendAdminGranted = isAdminGrantedSubscription(
      activeSubscription?.ls_subscription_id,
    );
    const backendNow = Date.now();
    const includedUsedPoints = Math.min(
      includedTotalPoints,
      effectiveGrantedUsedPoints({
        storedUsedPoints: settings?.monthly_granted_used_points ?? 0,
        storedCycleMonth: settings?.monthly_granted_reset_date,
        adminGranted: backendAdminGranted,
        now: backendNow,
      }).usedPoints,
    );

    return {
      balanceDollars: pointsToDollars(balancePoints),
      balancePoints,
      enabled: customization?.extra_usage_enabled ?? false,
      autoReloadEnabled: settings?.auto_reload_enabled ?? false,
      autoReloadThresholdDollars: thresholdPoints
        ? pointsToDollars(thresholdPoints)
        : undefined,
      autoReloadThresholdPoints: thresholdPoints,
      autoReloadAmountDollars: settings?.auto_reload_amount_dollars,
      includedTotalPoints,
      includedRemainingPoints: Math.max(
        0,
        includedTotalPoints - includedUsedPoints,
      ),
      includedResetAt: backendAdminGranted
        ? nextUtcMonthStartIso(backendNow)
        : (settings?.monthly_granted_resets_at ??
          activeSubscription?.renews_at ??
          activeSubscription?.ends_at),
      debtPoints: Math.max(0, settings?.credit_debt_points ?? 0),
      legacyRedisMigrated:
        settings?.legacy_redis_migration_key === "paid-account-ledger-v1",
    };
  },
};

export const getExtraUsageBalanceForBackend = query(
  balanceForBackendDefinition,
);

/** Same account debit as the action, without Node dispatch or any payment path. */
const planCreditDebitDefinition = {
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    amountPoints: v.number(),
    subscription: v.union(v.literal("pro"), v.literal("ultra")),
    allowDebt: v.optional(v.boolean()),
  },
  returns: v.object({
    success: v.boolean(),
    newBalanceDollars: v.number(),
    insufficientFunds: v.boolean(),
    monthlyCapExceeded: v.boolean(),
    includedPointsDeducted: v.number(),
    purchasedPointsDeducted: v.number(),
    includedTotalPoints: v.number(),
    includedRemainingPoints: v.number(),
    includedResetAt: v.optional(v.string()),
    debtPoints: v.number(),
    autoReloadTriggered: v.boolean(),
  }),
  handler: async (
    ctx: MutationCtx,
    args: {
      serviceKey: string;
      userId: string;
      amountPoints: number;
      subscription: "pro" | "ultra";
      allowDebt?: boolean;
    },
  ) => {
    validateServiceKey(args.serviceKey);
    // Preserve the action's no-op result, including no ledger reads or writes.
    if (args.amountPoints <= 0) {
      return {
        success: true,
        newBalanceDollars: 0,
        insufficientFunds: false,
        monthlyCapExceeded: false,
        includedPointsDeducted: 0,
        purchasedPointsDeducted: 0,
        includedTotalPoints: getIncludedCreditsForTier(args.subscription),
        includedRemainingPoints: getIncludedCreditsForTier(args.subscription),
        debtPoints: 0,
        autoReloadTriggered: false,
      };
    }
    // Both existing handlers run inside this mutation's transaction. The reset
    // metadata and debit observe the same ledger state, including concurrent changes.
    const settings = await balanceForBackendDefinition.handler(ctx, {
      serviceKey: args.serviceKey,
      userId: args.userId,
      subscription: args.subscription,
    });
    const result = await deductPointsDefinition.handler(ctx, {
      serviceKey: args.serviceKey,
      userId: args.userId,
      amountPoints: args.amountPoints,
      includedAllowancePoints: getIncludedCreditsForTier(args.subscription),
      allowDebt: args.allowDebt,
    });
    return {
      success: result.success,
      newBalanceDollars: result.newBalanceDollars,
      insufficientFunds: result.insufficientFunds,
      monthlyCapExceeded: result.monthlyCapExceeded,
      includedPointsDeducted: result.includedPointsDeducted,
      purchasedPointsDeducted: result.purchasedPointsDeducted,
      includedTotalPoints: result.includedTotalPoints,
      includedRemainingPoints: result.includedRemainingPoints,
      includedResetAt: settings.includedResetAt,
      debtPoints: result.debtPoints,
      autoReloadTriggered: false,
    };
  },
};

export const deductPlanCreditsWithoutAutoReload = mutation(
  planCreditDebitDefinition,
);

/**
 * Get user's extra usage settings (for frontend).
 * Returns all values in dollars (converted from points storage).
 */
export const getExtraUsageSettings = query({
  args: {
    // Local-dev mock billing runs without subscription rows, so the client's
    // mock tier is accepted as the allowance source — but ONLY when the
    // deployment itself opts in via the MOCK_BILLING env var. Production
    // deployments never set it, so this argument is inert there and the
    // ledger's own subscription remains the single authorization source.
    mockTier: v.optional(v.string()),
  },
  returns: v.union(
    v.null(),
    v.object({
      balanceDollars: v.number(),
      // Prepaid balance as displayed tokens (1 token = 1 point). Source of
      // truth for the "X tokens left" UI.
      balancePoints: v.number(),
      autoReloadEnabled: v.boolean(),
      autoReloadThresholdDollars: v.optional(v.number()),
      autoReloadAmountDollars: v.optional(v.number()),
      monthlyCapDollars: v.optional(v.number()),
      monthlySpentDollars: v.number(),
      includedCredits: v.object({
        total: v.number(),
        used: v.number(),
        remaining: v.number(),
        resetAt: v.union(v.string(), v.null()),
      }),
      // If auto-reload was auto-disabled because the saved card kept failing,
      // surface a human-readable reason so the UI can prompt the user to fix it.
      autoReloadDisabledReason: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const userId = identity.subject.split("|")[0];

    const settings = await ctx.db
      .query("extra_usage")
      .withIndex("by_user_id", (q) => q.eq("user_id", userId))
      .first();

    const activeSubscription = await activeSubscriptionForUser(ctx, userId);
    const mockBillingTier =
      process.env.MOCK_BILLING === "true" ? (args.mockTier ?? "") : "";
    // Active entitlement + canonical plan contract drive the ceiling. This
    // both caps historical 2M Max rows at 1.8M and hides a revoked allowance
    // immediately after the subscription is no longer entitled.
    const includedCreditsTotal = getIncludedCreditsForTier(
      activeSubscription?.tier ?? mockBillingTier,
    );
    // Admin-granted plans renew by calendar month -- no webhook ever arrives
    // to reset them, and without this an admin account that once exhausted
    // its allowance reported (and was enforced at) zero forever.
    const adminGranted = isAdminGrantedSubscription(
      activeSubscription?.ls_subscription_id,
    );
    const grantedNow = Date.now();
    const includedCreditsUsed = Math.min(
      includedCreditsTotal,
      effectiveGrantedUsedPoints({
        storedUsedPoints: settings?.monthly_granted_used_points ?? 0,
        storedCycleMonth: settings?.monthly_granted_reset_date,
        adminGranted,
        now: grantedNow,
      }).usedPoints,
    );

    return {
      balanceDollars: pointsToDollars(settings?.balance_points ?? 0),
      balancePoints: settings?.balance_points ?? 0,
      autoReloadEnabled: settings?.auto_reload_enabled ?? false,
      autoReloadThresholdDollars: settings?.auto_reload_threshold_points
        ? pointsToDollars(settings.auto_reload_threshold_points)
        : undefined,
      autoReloadAmountDollars: settings?.auto_reload_amount_dollars,
      monthlyCapDollars: settings?.monthly_cap_points
        ? pointsToDollars(settings.monthly_cap_points)
        : undefined,
      monthlySpentDollars: pointsToDollars(settings?.monthly_spent_points ?? 0),
      includedCredits: {
        total: includedCreditsTotal,
        used: includedCreditsUsed,
        remaining: includedCreditsTotal - includedCreditsUsed,
        resetAt: adminGranted
          ? nextUtcMonthStartIso(grantedNow)
          : (settings?.monthly_granted_resets_at ??
            activeSubscription?.renews_at ??
            activeSubscription?.ends_at ??
            null),
      },
      autoReloadDisabledReason: settings?.auto_reload_disabled_reason,
    };
  },
});

/**
 * Update extra usage settings (auto-reload config).
 * Accepts dollars for threshold, converts to points for storage.
 * Auto-reload amount stays in dollars (for Stripe charges).
 */
export const updateExtraUsageSettings = mutation({
  args: {
    autoReloadEnabled: v.optional(v.boolean()),
    autoReloadThresholdDollars: v.optional(v.number()),
    autoReloadAmountDollars: v.optional(v.number()),
    monthlyCapDollars: v.optional(v.union(v.null(), v.number())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    // Validate whole dollar amounts (no cents allowed)
    if (
      args.autoReloadThresholdDollars !== undefined &&
      !Number.isInteger(args.autoReloadThresholdDollars)
    ) {
      throw new Error("Threshold must be a whole dollar amount");
    }
    if (
      args.autoReloadAmountDollars !== undefined &&
      !Number.isInteger(args.autoReloadAmountDollars)
    ) {
      throw new Error("Reload amount must be a whole dollar amount");
    }
    // Validate minimum threshold of $5
    if (
      args.autoReloadThresholdDollars !== undefined &&
      args.autoReloadThresholdDollars < 5
    ) {
      throw new Error("Threshold must be at least $5");
    }
    // Validate minimum reload amount of $15
    if (
      args.autoReloadAmountDollars !== undefined &&
      args.autoReloadAmountDollars < 15
    ) {
      throw new Error("Reload amount must be at least $15");
    }
    // Validate reload amount is at least $10 more than threshold
    if (
      args.autoReloadAmountDollars !== undefined &&
      args.autoReloadThresholdDollars !== undefined &&
      args.autoReloadAmountDollars < args.autoReloadThresholdDollars + 10
    ) {
      throw new Error("Reload amount must be at least $10 more than threshold");
    }

    const settings = await ctx.db
      .query("extra_usage")
      .withIndex("by_user_id", (q) =>
        q.eq("user_id", identity.subject.split("|")[0]),
      )
      .first();

    const updateData: Record<string, unknown> = {
      updated_at: Date.now(),
    };

    if (args.autoReloadEnabled !== undefined) {
      updateData.auto_reload_enabled = args.autoReloadEnabled;
      // When the user re-enables auto-reload, clear the prior failure state so
      // the auto-disable banner goes away and the failure counter restarts.
      if (args.autoReloadEnabled) {
        updateData.auto_reload_disabled_reason = undefined;
        updateData.auto_reload_consecutive_failures = 0;
      }
    }
    if (args.autoReloadThresholdDollars !== undefined) {
      updateData.auto_reload_threshold_points = dollarsToPoints(
        args.autoReloadThresholdDollars,
      );
    }
    if (args.autoReloadAmountDollars !== undefined) {
      // Keep in dollars for Stripe charges
      updateData.auto_reload_amount_dollars = args.autoReloadAmountDollars;
    }
    if (args.monthlyCapDollars !== undefined) {
      // null means unlimited (clear the cap), number sets a specific cap
      updateData.monthly_cap_points =
        args.monthlyCapDollars === null
          ? undefined
          : dollarsToPoints(args.monthlyCapDollars);
    }

    if (settings) {
      await ctx.db.patch(settings._id, updateData);
    } else {
      await ctx.db.insert("extra_usage", {
        user_id: identity.subject.split("|")[0],
        balance_points: 0,
        ...updateData,
        updated_at: Date.now(),
      });
    }

    return null;
  },
});

/**
 * Record the outcome of an auto-reload attempt.
 *
 * On success: reset the consecutive-failure counter.
 * On failure: increment the counter, and after MAX_AUTO_RELOAD_FAILURES
 * consecutive failures auto-disable auto-reload and store a human-readable
 * reason. This prevents a broken saved card from retrying every overage
 * request.
 */
const MAX_AUTO_RELOAD_FAILURES = 2;

export const recordAutoReloadOutcome = internalMutation({
  args: {
    userId: v.string(),
    success: v.boolean(),
    failureReason: v.optional(v.string()),
  },
  returns: v.object({
    autoReloadDisabled: v.boolean(),
    consecutiveFailures: v.number(),
  }),
  handler: async (ctx, args) => {
    const settings = await ctx.db
      .query("extra_usage")
      .withIndex("by_user_id", (q) => q.eq("user_id", args.userId))
      .first();

    if (!settings) {
      return { autoReloadDisabled: false, consecutiveFailures: 0 };
    }

    if (args.success) {
      if ((settings.auto_reload_consecutive_failures ?? 0) === 0) {
        return { autoReloadDisabled: false, consecutiveFailures: 0 };
      }
      await ctx.db.patch(settings._id, {
        auto_reload_consecutive_failures: 0,
        updated_at: Date.now(),
      });
      return { autoReloadDisabled: false, consecutiveFailures: 0 };
    }

    const next = (settings.auto_reload_consecutive_failures ?? 0) + 1;
    const shouldDisable = next >= MAX_AUTO_RELOAD_FAILURES;

    await ctx.db.patch(settings._id, {
      auto_reload_consecutive_failures: next,
      ...(shouldDisable
        ? {
            auto_reload_enabled: false,
            auto_reload_disabled_reason: args.failureReason ?? "payment_failed",
          }
        : {}),
      updated_at: Date.now(),
    });

    convexLogger.info("auto_reload_outcome", {
      user_id: args.userId,
      success: false,
      failure_reason: args.failureReason,
      consecutive_failures: next,
      auto_reload_disabled: shouldDisable,
    });

    return { autoReloadDisabled: shouldDisable, consecutiveFailures: next };
  },
});

// These additive primitives are intentionally not called by current billing
// clients. They require a reviewed caller lifecycle before activation: reserve,
// then startUse before any external work; close is valid only before startUse.
type AccountReservationArgs = ObjectType<typeof accountCreditReservationArgs>;

function validateAccountReservationArgs(args: AccountReservationArgs): void {
  validateServiceKey(args.serviceKey);
  if (
    !args.reservationKey.trim() ||
    args.reservationKey.length > 200 ||
    !args.userId.trim() ||
    !Number.isSafeInteger(args.amountPoints) ||
    args.amountPoints < 0
  )
    throw new Error("Invalid account credit reservation");
}

async function getBoundAccountReservation(
  ctx: MutationCtx,
  args: AccountReservationArgs,
) {
  validateAccountReservationArgs(args);
  const row = await ctx.db
    .query("account_credit_reservations")
    .withIndex("by_reservation_key", (q) =>
      q.eq("reservation_key", args.reservationKey),
    )
    .unique();
  if (
    row &&
    (row.user_id !== args.userId ||
      row.amount_points !== args.amountPoints ||
      row.subscription !== args.subscription)
  ) {
    throw new Error("Account credit reservation binding mismatch");
  }
  return row;
}

function reservationFields(args: AccountReservationArgs) {
  return {
    reservation_key: args.reservationKey,
    user_id: args.userId,
    amount_points: args.amountPoints,
    subscription: args.subscription,
  };
}

/** Service-only atomic receipt + debit. A closed key cannot authorize work. */
const reserveAccountCreditsDefinition = {
  args: accountCreditReservationArgs,
  returns: v.union(
    v.object({ state: v.literal("reserved"), receipt: accountCreditReceipt }),
    v.object({ state: v.literal("denied"), receipt: accountCreditReceipt }),
    v.object({ state: v.literal("closed") }),
    v.object({ state: v.literal("in_use") }),
    v.object({ state: v.literal("settled") }),
    v.object({ state: v.literal("reconciliation_required") }),
  ),
  handler: async (ctx: MutationCtx, args: AccountReservationArgs) => {
    const prior = await getBoundAccountReservation(ctx, args);
    if (prior) {
      if (
        prior.state === "closed" ||
        prior.state === "in_use" ||
        prior.state === "settled" ||
        prior.state === "reconciliation_required"
      )
        return { state: prior.state };
      if (!prior.receipt)
        throw new Error("Missing account reservation receipt");
      return { state: prior.state, receipt: prior.receipt };
    }
    // Reject duplicate ledger rows rather than choosing an arbitrary balance.
    await ctx.db
      .query("extra_usage")
      .withIndex("by_user_id", (q) => q.eq("user_id", args.userId))
      .unique();
    const receipt = await planCreditDebitDefinition.handler(ctx, args);
    const ledger = await ctx.db
      .query("extra_usage")
      .withIndex("by_user_id", (q) => q.eq("user_id", args.userId))
      .unique();
    const state = receipt.success ? ("reserved" as const) : ("denied" as const);
    await ctx.db.insert("account_credit_reservations", {
      ...reservationFields(args),
      state,
      receipt,
      accounting_generation: ledger?.credit_accounting_generation ?? 0,
      ledger_id: ledger?._id,
      included_cycle_key: ledger?.monthly_granted_cycle_key,
      included_cycle_month: ledger?.monthly_granted_reset_date,
      purchased_month: ledger?.monthly_reset_date,
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    return { state, receipt };
  },
};
export const reserveAccountCredits = mutation(reserveAccountCreditsDefinition);

/** A successful durable fence must precede external work. No auto-refund after it. */
export const startAccountCreditReservationUse = mutation({
  args: accountCreditReservationArgs,
  returns: v.object({
    state: v.union(
      v.literal("in_use"),
      v.literal("settled"),
      v.literal("closed"),
      v.literal("denied"),
      v.literal("reconciliation_required"),
    ),
    newlyGranted: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const prior = await getBoundAccountReservation(ctx, args);
    if (!prior) throw new Error("Missing account credit reservation");
    if (prior.production_admission)
      throw new Error("Use production credit admission for this reservation");
    if (prior.state !== "reserved")
      return { state: prior.state, newlyGranted: false };
    const ledger = await ctx.db
      .query("extra_usage")
      .withIndex("by_user_id", (q) => q.eq("user_id", args.userId))
      .unique();
    if (!canRestoreAccountReservation(prior, ledger)) {
      await ctx.db.patch(prior._id, {
        state: "reconciliation_required",
        updated_at: Date.now(),
      });
      return { state: "reconciliation_required" as const, newlyGranted: false };
    }
    if (!prior.receipt?.success)
      throw new Error("Invalid account reservation receipt");
    await ctx.db.patch(prior._id, { state: "in_use", updated_at: Date.now() });
    return { state: "in_use" as const, newlyGranted: true };
  },
});

function canRestoreAccountReservation(
  row: Doc<"account_credit_reservations">,
  ledger: Doc<"extra_usage"> | null,
): boolean {
  const receipt = row.receipt;
  if (!receipt) return false;
  if (
    receipt.includedPointsDeducted === 0 &&
    receipt.purchasedPointsDeducted === 0
  )
    return true;
  if (
    !ledger ||
    row.ledger_id !== ledger._id ||
    row.accounting_generation !== (ledger.credit_accounting_generation ?? 0)
  )
    return false;
  // Cross-cycle/revocation reconciliation needs a separate policy. Leave it
  // unresolved instead of restoring old credits into the current allowance.
  if (
    receipt.includedPointsDeducted > 0 &&
    (row.included_cycle_key !== ledger.monthly_granted_cycle_key ||
      row.included_cycle_month !== ledger.monthly_granted_reset_date ||
      ledger.monthly_granted_points !== receipt.includedTotalPoints ||
      (ledger.monthly_granted_points ?? 0) <= 0 ||
      (ledger.monthly_granted_used_points ?? 0) <
        receipt.includedPointsDeducted)
  )
    return false;
  if (
    receipt.purchasedPointsDeducted > 0 &&
    (row.purchased_month !== ledger.monthly_reset_date ||
      (ledger.monthly_spent_points ?? 0) < receipt.purchasedPointsDeducted)
  )
    return false;
  return true;
}

/**
 * Close/refund only before external work. Missing keys become tombstones in the
 * same indexed transaction, so a delayed reserve cannot debit after cancellation.
 * Unknown lifecycle/cycle state is explicitly unresolved, never "refunded".
 */
const closeAccountCreditReservationDefinition = {
  args: accountCreditReservationArgs,
  returns: v.object({
    state: v.union(v.literal("closed"), v.literal("unresolved")),
  }),
  handler: async (ctx: MutationCtx, args: AccountReservationArgs) => {
    const prior = await getBoundAccountReservation(ctx, args);
    if (!prior) {
      await ctx.db.insert("account_credit_reservations", {
        ...reservationFields(args),
        state: "closed",
        accounting_generation: 0,
        created_at: Date.now(),
        updated_at: Date.now(),
      });
      return { state: "closed" as const };
    }
    if (prior.state === "closed") return { state: "closed" as const };
    if (prior.state === "settled" || prior.state === "reconciliation_required")
      return { state: "unresolved" as const };
    if (prior.state === "in_use") {
      await ctx.db.patch(prior._id, {
        state: "reconciliation_required",
        updated_at: Date.now(),
      });
      return { state: "unresolved" as const };
    }
    const ledger = await ctx.db
      .query("extra_usage")
      .withIndex("by_user_id", (q) => q.eq("user_id", args.userId))
      .unique();
    if (!canRestoreAccountReservation(prior, ledger)) {
      await ctx.db.patch(prior._id, {
        state: "reconciliation_required",
        updated_at: Date.now(),
      });
      return { state: "unresolved" as const };
    }
    const receipt = prior.receipt!;
    if (
      ledger &&
      (receipt.includedPointsDeducted > 0 ||
        receipt.purchasedPointsDeducted > 0)
    ) {
      await ctx.db.patch(ledger._id, {
        monthly_granted_used_points:
          (ledger.monthly_granted_used_points ?? 0) -
          receipt.includedPointsDeducted,
        balance_points:
          (ledger.balance_points ?? 0) + receipt.purchasedPointsDeducted,
        monthly_spent_points:
          (ledger.monthly_spent_points ?? 0) - receipt.purchasedPointsDeducted,
        updated_at: Date.now(),
      });
    }
    await ctx.db.patch(prior._id, { state: "closed", updated_at: Date.now() });
    return { state: "closed" as const };
  },
};
export const closeAccountCreditReservation = mutation(
  closeAccountCreditReservationDefinition,
);

/** Inactive terminal settlement: one immutable usage revision, one transaction.
 * No payment calls and no caller-provided source allocation. The authenticated
 * server supplies priced usage evidence; this API does not verify provider truth. */
export const settleAccountCreditReservation = mutation({
  args: { ...accountCreditReservationArgs, ...terminalCreditSettlementArgs },
  returns: terminalCreditSettlementResult,
  handler: async (ctx, args) => {
    const row = await getBoundAccountReservation(ctx, args);
    await validateTerminalCreditEvidence(args);
    if (!row) throw new Error("Missing account credit reservation");
    if (row.terminal_settlement) {
      if (
        row.terminal_settlement.revision !== args.revision ||
        row.terminal_settlement.actualPoints !== args.actualPoints ||
        row.terminal_settlement.usageDigest !== args.usageDigest
      )
        throw new Error("Terminal credit settlement is immutable");
      return row.terminal_settlement.result;
    }
    if (row.state !== "in_use")
      throw new Error("Credit reservation is not in use");
    const evidence = {
      revision: args.revision,
      pricingVersion: args.pricingVersion,
      actualPoints: args.actualPoints,
      usage: args.usage,
      usageDigest: args.usageDigest,
    };
    const unresolved = async (reason: "unknown_usage" | "source_changed") => {
      const result = { state: "reconciliation_required" as const, reason };
      await ctx.db.patch(row._id, {
        state: "reconciliation_required",
        terminal_settlement: { ...evidence, result },
        updated_at: Date.now(),
      });
      return result;
    };
    if (args.usage.status === "unknown" || args.actualPoints === null)
      return unresolved("unknown_usage");
    const ledger = await ctx.db
      .query("extra_usage")
      .withIndex("by_user_id", (q) => q.eq("user_id", args.userId))
      .unique();
    // Zero-cost reservations can have no original ledger. Do not bootstrap an
    // unrelated source here; nonzero settlement needs reviewed source lineage.
    if (
      !ledger ||
      row.ledger_id !== ledger._id ||
      row.accounting_generation !== (ledger.credit_accounting_generation ?? 0)
    )
      return unresolved("source_changed");
    const original = row.receipt;
    if (!original?.success)
      throw new Error("Invalid settlement reservation receipt");
    const included = original.includedPointsDeducted;
    const purchased = original.purchasedPointsDeducted;
    assertCreditInteger(included);
    assertCreditInteger(purchased);
    assertCreditInteger(included + purchased);
    if (included + purchased !== row.amount_points)
      throw new Error("Invalid credit settlement arithmetic allocation");
    const balance = ledger.balance_points ?? 0;
    const used = ledger.monthly_granted_used_points ?? 0;
    const allowance = ledger.monthly_granted_points ?? 0;
    const spent = ledger.monthly_spent_points ?? 0;
    const debt = ledger.credit_debt_points ?? 0;
    const cap = ledger.monthly_cap_points ?? Number.MAX_SAFE_INTEGER;
    for (const value of [balance, used, allowance, spent, debt, cap])
      assertCreditInteger(value);
    if (!canRestoreAccountReservation(row, ledger))
      return unresolved("source_changed");
    const delta = args.actualPoints - row.amount_points;
    let includedAdded = 0,
      purchasedAdded = 0,
      debtAdded = 0;
    let includedRefunded = 0,
      purchasedRefunded = 0;
    if (delta < 0) {
      purchasedRefunded = Math.min(-delta, purchased);
      includedRefunded = -delta - purchasedRefunded;
      if (includedRefunded > included || purchasedRefunded > purchased)
        throw new Error("Invalid credit settlement arithmetic refund");
    } else if (delta > 0) {
      includedAdded = Math.min(delta, Math.max(0, allowance - used));
      purchasedAdded = Math.min(
        delta - includedAdded,
        balance,
        Math.max(0, cap - spent),
      );
      debtAdded = delta - includedAdded - purchasedAdded;
    }
    const next = {
      balance_points: balance - purchasedAdded + purchasedRefunded,
      monthly_granted_used_points: used + includedAdded - includedRefunded,
      monthly_spent_points: spent + purchasedAdded - purchasedRefunded,
      credit_debt_points: debt + debtAdded,
    };
    for (const value of Object.values(next)) assertCreditInteger(value);
    const result = {
      state: "settled" as const,
      receipt: {
        revision: 1 as const,
        actualPoints: args.actualPoints,
        adjustmentPoints: delta,
        includedPoints: included + includedAdded - includedRefunded,
        purchasedPoints: purchased + purchasedAdded - purchasedRefunded,
        debtPointsAdded: debtAdded,
        includedPointsRefunded: includedRefunded,
        purchasedPointsRefunded: purchasedRefunded,
        balancePoints: next.balance_points,
        includedUsedPoints: next.monthly_granted_used_points,
        monthlySpentPoints: next.monthly_spent_points,
        accountDebtPoints: next.credit_debt_points,
      },
    };
    if (delta !== 0)
      await ctx.db.patch(ledger._id, { ...next, updated_at: Date.now() });
    await ctx.db.patch(row._id, {
      state: "settled",
      terminal_settlement: { ...evidence, result },
      updated_at: Date.now(),
    });
    return result;
  },
});

const productionCreditArgs = {
  ...accountCreditReservationArgs,
  binding: productionCreditBinding,
};
type ProductionCreditArgs = ObjectType<typeof productionCreditArgs>;
function assertProductionBinding(
  row: Doc<"account_credit_reservations">,
  args: ProductionCreditArgs,
) {
  const binding = row.production_admission;
  if (
    !binding ||
    binding.version !== args.binding.version ||
    binding.kind !== args.binding.kind ||
    binding.requestId !== args.binding.requestId
  )
    throw new Error("Account credit production binding mismatch");
}

/** Additive, console-only production path. The service creates requestId before
 * debit. Other caller kinds require separately reviewed ownership contracts. */
export const reserveProductionAccountCredits = mutation({
  args: productionCreditArgs,
  returns: reserveAccountCreditsDefinition.returns,
  handler: async (ctx, args) => {
    const prior = await getBoundAccountReservation(ctx, args);
    validateProductionCreditBinding(args.binding);
    if (prior && (prior.production_admission || prior.state !== "closed"))
      assertProductionBinding(prior, args);
    // An unbound closed tombstone may come from cancellation before reserve.
    // Attach its binding without reviving it or running a debit.
    const result = await reserveAccountCreditsDefinition.handler(ctx, args);
    if (!prior?.production_admission) {
      const row = await getBoundAccountReservation(ctx, args);
      if (!row) throw new Error("Missing production credit reservation");
      await ctx.db.patch(row._id, { production_admission: args.binding });
    }
    return result;
  },
});

export const admitProductionAccountCreditUse = mutation({
  args: productionCreditArgs,
  returns: v.object({
    state: accountCreditReservationState,
    newlyGranted: v.boolean(),
    denialReason: v.optional(productionCreditDenial),
    refund: v.optional(
      v.union(v.literal("confirmed"), v.literal("unresolved")),
    ),
  }),
  handler: async (ctx, args) => {
    const row = await getBoundAccountReservation(ctx, args);
    validateProductionCreditBinding(args.binding);
    if (!row) throw new Error("Missing production credit reservation");
    assertProductionBinding(row, args);
    const noGrant = () => ({
      state: row.state,
      newlyGranted: false,
      ...(row.admission_denial
        ? { denialReason: row.admission_denial.reason }
        : {}),
      ...(row.state === "closed"
        ? { refund: "confirmed" as const }
        : row.state === "reconciliation_required"
          ? { refund: "unresolved" as const }
          : {}),
    });
    if (row.state !== "reserved") return noGrant();
    const ledger = await ctx.db
      .query("extra_usage")
      .withIndex("by_user_id", (q) => q.eq("user_id", args.userId))
      .unique();
    if (ledger) {
      for (const value of [
        ledger.balance_points ?? 0,
        ledger.monthly_granted_points ?? 0,
        ledger.monthly_granted_used_points ?? 0,
        ledger.monthly_spent_points ?? 0,
        ledger.credit_debt_points ?? 0,
        ledger.credit_accounting_generation ?? 0,
        row.accounting_generation,
      ])
        assertCreditInteger(value);
    }
    if (!row.receipt?.success)
      throw new Error("Invalid production credit receipt");
    const included = row.receipt.includedPointsDeducted;
    const purchased = row.receipt.purchasedPointsDeducted;
    assertCreditInteger(included);
    assertCreditInteger(purchased);
    assertCreditInteger(included + purchased);
    if (included + purchased !== row.amount_points)
      throw new Error("Invalid credit admission arithmetic allocation");
    // The low-level zero-amount primitive intentionally needs no ledger.
    // Production admission must still bind the current accounting source.
    const sourceValid =
      !!ledger &&
      row.ledger_id === ledger._id &&
      row.accounting_generation ===
        (ledger.credit_accounting_generation ?? 0) &&
      (ledger.monthly_granted_points ?? 0) > 0 &&
      canRestoreAccountReservation(row, ledger);
    const subscription = await activeSubscriptionForUser(ctx, args.userId);
    const suspension = await ctx.db
      .query("user_suspensions")
      .withIndex("by_user_status_source_created", (q) =>
        q.eq("user_id", args.userId).eq("status", "active"),
      )
      .order("desc")
      .first();
    const reason = !sourceValid
      ? ("source_changed" as const)
      : !subscription
        ? ("no_entitlement" as const)
        : subscription.tier !== row.subscription
          ? ("tier_changed" as const)
          : suspension
            ? ("suspended" as const)
            : (ledger?.credit_debt_points ?? 0) > 0
              ? ("outstanding_debt" as const)
              : undefined;
    if (reason) {
      // Validate refundable sums before calling the unchanged transaction-local
      // close implementation. Never report a rounded/overflowed refund.
      if (sourceValid && ledger)
        assertCreditInteger((ledger.balance_points ?? 0) + purchased);
      const closed = await closeAccountCreditReservationDefinition.handler(
        ctx,
        args,
      );
      await ctx.db.patch(row._id, {
        admission_denial: { reason, at: Date.now() },
      });
      return {
        state:
          closed.state === "closed"
            ? ("closed" as const)
            : ("reconciliation_required" as const),
        newlyGranted: false,
        denialReason: reason,
        refund:
          closed.state === "closed"
            ? ("confirmed" as const)
            : ("unresolved" as const),
      };
    }
    await ctx.db.patch(row._id, { state: "in_use", updated_at: Date.now() });
    return { state: "in_use" as const, newlyGranted: true };
  },
});

/** Owner-scoped receipt correlation. A duplicate is never dispatch permission. */
export const beginConsoleUsageOperation = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    sessionId: v.string(),
    operationId: v.string(),
    reservationKey: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    for (const value of [
      args.userId,
      args.sessionId,
      args.operationId,
      args.reservationKey,
    ])
      if (!value.trim() || value.length > 200)
        throw new Error("Invalid usage identity");
    const prior = await ctx.db
      .query("console_usage_operations")
      .withIndex("by_owner_operation", (q) =>
        q.eq("user_id", args.userId).eq("operation_id", args.operationId),
      )
      .unique();
    if (prior) return false;
    await ctx.db.insert("console_usage_operations", {
      user_id: args.userId,
      session_id: args.sessionId,
      operation_id: args.operationId,
      reservation_key: args.reservationKey,
      created_at: Date.now(),
    });
    return true;
  },
});

export const getConsoleUsageReceipts = query({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    sessionId: v.optional(v.string()),
    chatId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    if (!args.userId.trim() || !!args.sessionId === !!args.chatId)
      throw new Error("Invalid usage selector");
    if (args.chatId) {
      const chat = await ctx.db
        .query("chats")
        .withIndex("by_chat_id", (q) => q.eq("id", args.chatId!))
        .unique();
      if (!chat || chat.user_id !== args.userId)
        throw new Error("Usage not found");
      const rows = await ctx.db
        .query("usage_settlements")
        .withIndex("by_user_chat", (q) =>
          q.eq("user_id", args.userId).eq("chat_id", args.chatId!),
        )
        .take(1001);
      if (rows.length > 1000) throw new Error("Usage receipt limit exceeded");
      const operations = await ctx.db
        .query("console_workspace_operations")
        .withIndex("by_chat", (q) => q.eq("chat_id", args.chatId!))
        .take(1001);
      if (operations.length > 1000)
        throw new Error("Usage receipt limit exceeded");
      // A receipt is written only at settlement. Missing or still-running turns
      // must not vanish behind the exact charges of older completed turns.
      const unresolved = operations
        .filter((operation) => {
          if (operation.user_id !== args.userId) return false;
          return (
            operation.status !== "completed" ||
            !rows.some((row) => row.operation_id === operation.operation_id)
          );
        })
        .map((operation) => ({
          operationId: `workspace:${operation.operation_id}`,
          status:
            operation.status === "running" ||
            operation.status === "cancel_requested"
              ? ("pending" as const)
              : ("unknown" as const),
          credits: null,
        }));
      return [
        ...rows.map((row) => ({
          operationId: row.run_id,
          status:
            row.state === "acknowledged" && row.actual_points !== undefined
              ? ("settled" as const)
              : row.state === "pending"
                ? ("pending" as const)
                : ("unknown" as const),
          credits:
            row.state === "acknowledged" ? (row.actual_points ?? null) : null,
        })),
        ...unresolved,
      ];
    }
    const links = await ctx.db
      .query("console_usage_operations")
      .withIndex("by_owner_session", (q) =>
        q.eq("user_id", args.userId).eq("session_id", args.sessionId!),
      )
      .take(1001);
    if (links.length > 1000) throw new Error("Usage receipt limit exceeded");
    return Promise.all(
      links.map(async (link) => {
        const row = await ctx.db
          .query("account_credit_reservations")
          .withIndex("by_reservation_key", (q) =>
            q.eq("reservation_key", link.reservation_key),
          )
          .unique();
        if (!row || row.user_id !== args.userId)
          return {
            operationId: link.operation_id,
            status: "unknown" as const,
            credits: null,
          };
        const result = row.terminal_settlement?.result;
        if (result?.state === "settled")
          return {
            operationId: link.operation_id,
            status: "settled" as const,
            credits: result.receipt.actualPoints,
          };
        if (row.state === "closed" || row.state === "denied")
          return {
            operationId: link.operation_id,
            status: "settled" as const,
            credits: 0,
          };
        return {
          operationId: link.operation_id,
          status:
            row.state === "reconciliation_required"
              ? ("unknown" as const)
              : ("pending" as const),
          credits: null,
        };
      }),
    );
  },
});
