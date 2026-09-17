"use node";

import { action, type ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import Stripe from "stripe";
import { convexLogger } from "./lib/logger";
import {
  getIncludedCreditsForTier,
  usesAccountCreditLedger,
} from "../lib/billing/included-credits";

// =============================================================================
// SDK Initialization (lazy, cached)
// =============================================================================

let stripeInstance: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
    stripeInstance = new Stripe(key);
  }
  return stripeInstance;
}

/** Points per dollar (1 point = $0.0001), mirrors convex/extraUsage.ts. */
const POINTS_PER_DOLLAR = 10_000;

/**
 * Volume-bonus tokens (points) for a top-up amount, tiered by spend.
 *
 * Thresholds mirror the package ladder in lib/billing/token-packages.ts so a
 * package's displayed bonus matches what gets credited:
 *   < $50  → +0%    ($20 Starter)
 *   ≥ $50  → +5%    ($50 Plus)
 *   ≥ $100 → +10%   ($100 Pro)
 *   ≥ $300 → +20%   ($300 Scale)
 * Custom amounts land in whichever tier their dollar value reaches.
 *
 * Server-derived from the validated dollar amount — never trust a client value.
 */
function bonusPointsForDollars(dollars: number): number {
  const basePoints = dollars * POINTS_PER_DOLLAR;
  let pct = 0;
  if (dollars >= 300) pct = 20;
  else if (dollars >= 100) pct = 10;
  else if (dollars >= 50) pct = 5;
  return Math.round((basePoints * pct) / 100);
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Resolve (and optionally lazily create) the per-user Stripe customer for
 * pay-as-you-go token purchases.
 *
 * - Reads the persisted `stripe_customer_id` from the user's extra_usage row.
 * - With `createIfMissing`, creates a Stripe customer on first checkout and
 *   persists it. Read-only callers (payment status, billing portal, auto-
 *   reload) pass createIfMissing=false and treat null as "no billing yet".
 */
async function getStripeCustomerId(
  ctx: ActionCtx,
  userId: string,
  opts?: { email?: string | null; createIfMissing?: boolean },
): Promise<string | null> {
  const existing = await ctx.runQuery(
    internal.extraUsage.getStripeCustomerIdForUser,
    { userId },
  );
  if (existing) return existing;
  if (!opts?.createIfMissing) return null;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: opts.email ?? undefined,
    metadata: { userId },
  });
  await ctx.runMutation(internal.extraUsage.setStripeCustomerIdForUser, {
    userId,
    stripeCustomerId: customer.id,
  });
  return customer.id;
}

async function getStripePaymentMethod(customerId: string): Promise<{
  hasPaymentMethod: boolean;
  last4?: string;
  brand?: string;
}> {
  const stripe = getStripe();

  // Get active subscriptions to find default payment method
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: "active",
    limit: 1,
  });

  let paymentMethodId: string | null = null;

  if (subscriptions.data && subscriptions.data.length > 0) {
    const sub = subscriptions.data[0];
    paymentMethodId =
      typeof sub.default_payment_method === "string"
        ? sub.default_payment_method
        : sub.default_payment_method?.id || null;
  }

  // If no payment method from subscription, check customer's default
  if (!paymentMethodId) {
    const customerResponse = await stripe.customers.retrieve(customerId);
    if (customerResponse.deleted) {
      return { hasPaymentMethod: false };
    }
    // Type narrowing: after the deleted check, we know it's a Customer
    const customer = customerResponse as Stripe.Customer;

    const invoiceSettings = customer.invoice_settings;
    paymentMethodId =
      typeof invoiceSettings?.default_payment_method === "string"
        ? invoiceSettings.default_payment_method
        : invoiceSettings?.default_payment_method?.id || null;
  }

  if (!paymentMethodId) {
    return { hasPaymentMethod: false };
  }

  // Get payment method details
  const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

  return {
    hasPaymentMethod: true,
    last4: paymentMethod.card?.last4,
    brand: paymentMethod.card?.brand ?? undefined,
  };
}

async function getDefaultPaymentMethodId(
  customerId: string,
): Promise<string | null> {
  const stripe = getStripe();

  // First check active subscriptions
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: "active",
    limit: 1,
  });

  if (subscriptions.data?.[0]?.default_payment_method) {
    const pm = subscriptions.data[0].default_payment_method;
    return typeof pm === "string" ? pm : pm?.id || null;
  }

  // Fall back to customer's default payment method
  const customerResponse = await stripe.customers.retrieve(customerId);
  if (customerResponse.deleted) {
    return null;
  }
  // Type narrowing: after the deleted check, we know it's a Customer
  const customer = customerResponse as Stripe.Customer;

  const invoiceSettings = customer.invoice_settings;
  const pm = invoiceSettings?.default_payment_method;
  return typeof pm === "string" ? pm : pm?.id || null;
}

async function createAutoReloadPayment(
  customerId: string,
  paymentMethodId: string,
  amountCents: number,
  userId: string,
): Promise<{ success: boolean; paymentIntentId?: string; error?: string }> {
  const stripe = getStripe();

  try {
    // Create the invoice first (empty), then add item to it
    // This avoids picking up stale invoice items from failed attempts
    const invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: "send_invoice",
      days_until_due: 0,
      auto_advance: false,
      pending_invoice_items_behavior: "exclude", // Don't pick up any pending items
      metadata: {
        type: "extra_usage_auto_reload",
        userId,
        amountDollars: String(amountCents / 100),
      },
    });

    // Add the invoice item directly to this invoice
    await stripe.invoiceItems.create({
      customer: customerId,
      invoice: invoice.id,
      amount: amountCents,
      currency: "usd",
      description: `RIFT Extra Usage Auto-Reload ($${amountCents / 100})`,
    });

    // Finalize the invoice
    const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);

    // Check if already paid (shouldn't happen, but handle it)
    if (finalizedInvoice.status === "paid") {
      const paymentIntent = (
        finalizedInvoice as unknown as {
          payment_intent?: string | { id: string };
        }
      ).payment_intent;
      return {
        success: true,
        paymentIntentId:
          typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id,
      };
    }

    // Pay the invoice with the specified payment method
    const paidInvoice = await stripe.invoices.pay(finalizedInvoice.id, {
      payment_method: paymentMethodId,
    });

    if (paidInvoice.status === "paid") {
      const paymentIntent = (
        paidInvoice as unknown as { payment_intent?: string | { id: string } }
      ).payment_intent;
      return {
        success: true,
        paymentIntentId:
          typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id,
      };
    }

    return {
      success: false,
      error: `Invoice status: ${paidInvoice.status}`,
    };
  } catch (error) {
    const message =
      error instanceof Stripe.errors.StripeError
        ? error.message
        : "Payment failed";
    return { success: false, error: message };
  }
}

// =============================================================================
// Convex Actions
// =============================================================================

/**
 * Get user's payment status (has valid payment method)
 */
export const getPaymentStatus = action({
  args: {},
  returns: v.object({
    hasPaymentMethod: v.boolean(),
    paymentMethodLast4: v.union(v.string(), v.null()),
    paymentMethodBrand: v.union(v.string(), v.null()),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return {
        hasPaymentMethod: false,
        paymentMethodLast4: null,
        paymentMethodBrand: null,
      };
    }

    try {
      const stripeCustomerId = await getStripeCustomerId(
        ctx,
        identity.subject.split("|")[0],
      );
      if (!stripeCustomerId) {
        return {
          hasPaymentMethod: false,
          paymentMethodLast4: null,
          paymentMethodBrand: null,
        };
      }

      const paymentInfo = await getStripePaymentMethod(stripeCustomerId);

      return {
        hasPaymentMethod: paymentInfo.hasPaymentMethod,
        paymentMethodLast4: paymentInfo.last4 || null,
        paymentMethodBrand: paymentInfo.brand || null,
      };
    } catch (error) {
      console.error("Payment status check failed:", error);
      return {
        hasPaymentMethod: false,
        paymentMethodLast4: null,
        paymentMethodBrand: null,
      };
    }
  },
});

// =============================================================================
// LemonSqueezy (card + subscription — merchant of record, handles VAT/tax)
// Crypto stays on NowPayments; LemonSqueezy is the card path. Checkout is a
// hosted page; the user_id rides along in checkout_data.custom so the webhook
// can attribute the subscription/credit back to the RIFT user.
// =============================================================================

/** Create a LemonSqueezy hosted checkout, returning its URL (or null). */
async function createLsCheckout(opts: {
  variantId: string;
  email?: string;
  custom: Record<string, string>;
  redirectUrl: string;
  customPriceCents?: number;
}): Promise<string | null> {
  const apiKey = process.env.LEMONSQUEEZY_API_KEY;
  const storeId = process.env.LEMONSQUEEZY_STORE_ID;
  if (!apiKey || !storeId) return null;

  const attributes: Record<string, unknown> = {
    checkout_data: {
      ...(opts.email ? { email: opts.email } : {}),
      custom: opts.custom,
    },
    product_options: { redirect_url: opts.redirectUrl },
  };
  if (typeof opts.customPriceCents === "number") {
    attributes.custom_price = opts.customPriceCents;
  }

  const res = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
    },
    body: JSON.stringify({
      data: {
        type: "checkouts",
        attributes,
        relationships: {
          store: { data: { type: "stores", id: String(storeId) } },
          variant: { data: { type: "variants", id: String(opts.variantId) } },
        },
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    convexLogger.error("lemonsqueezy_checkout_failed", {
      status: res.status,
      detail: detail.slice(0, 500),
    });
    return null;
  }
  const data = (await res.json()) as {
    data?: { attributes?: { url?: string } };
  };
  return data?.data?.attributes?.url ?? null;
}

/** Subscribe to RIFT Pro ($39) or RIFT Max ($129 → "ultra") via LemonSqueezy. */
export const createLemonsqueezySubscription = action({
  args: {
    tier: v.union(v.literal("pro"), v.literal("ultra")),
    baseUrl: v.string(),
  },
  returns: v.object({
    url: v.union(v.string(), v.null()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { url: null, error: "Not authenticated" };
    const userId = identity.subject.split("|")[0];
    if (!args.baseUrl || !args.baseUrl.startsWith("http")) {
      return { url: null, error: "Invalid base URL" };
    }

    const variantId =
      args.tier === "ultra"
        ? process.env.LEMONSQUEEZY_MAX_VARIANT_ID
        : process.env.LEMONSQUEEZY_PRO_VARIANT_ID;
    if (!variantId) {
      return { url: null, error: "Subscriptions are not configured." };
    }

    try {
      const url = await createLsCheckout({
        variantId,
        email: (identity.email as string | undefined) ?? undefined,
        custom: { user_id: userId, kind: "subscription", tier: args.tier },
        redirectUrl: `${args.baseUrl}/?sub=success`,
      });
      if (!url) return { url: null, error: "Could not start checkout." };
      return { url };
    } catch (error) {
      convexLogger.error("lemonsqueezy_subscription_error", {
        user_id: userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return { url: null, error: "Could not start checkout." };
    }
  },
});

/** One-time token top-up via LemonSqueezy card checkout (custom price). */
export const createLemonsqueezyTopup = action({
  args: {
    amountDollars: v.number(),
    baseUrl: v.string(),
  },
  returns: v.object({
    url: v.union(v.string(), v.null()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { url: null, error: "Not authenticated" };
    const userId = identity.subject.split("|")[0];

    // Add-on credits are a paid-plan perk: only active Pro/Max subscribers may
    // top up. Free users must pick a plan first. Enforced server-side so the UI
    // gate cannot be bypassed (e.g. calling the action directly).
    const activeSub = await ctx.runQuery(
      api.subscriptions.getActiveSubscription,
      {},
    );
    if (!activeSub || !usesAccountCreditLedger(activeSub.tier)) {
      return {
        url: null,
        error: "Add-on credits require an active Pro or Max plan.",
      };
    }

    if (!Number.isInteger(args.amountDollars)) {
      return { url: null, error: "Amount must be a whole dollar value" };
    }
    if (args.amountDollars < 10) {
      return { url: null, error: "Minimum amount is $10" };
    }
    if (args.amountDollars > 999_999) {
      return { url: null, error: "Maximum amount is $999,999" };
    }
    if (!args.baseUrl || !args.baseUrl.startsWith("http")) {
      return { url: null, error: "Invalid base URL" };
    }

    const variantId = process.env.LEMONSQUEEZY_CREDITS_VARIANT_ID;
    if (!variantId) {
      return { url: null, error: "Top-ups are not configured." };
    }

    // Bonus is recomputed server-side at webhook time; passing it along is only
    // a hint. The webhook recomputes from the paid amount (never trusts client).
    const bonusPoints = bonusPointsForDollars(args.amountDollars);
    try {
      const url = await createLsCheckout({
        variantId,
        email: (identity.email as string | undefined) ?? undefined,
        custom: {
          user_id: userId,
          kind: "extra_usage_purchase",
          amount_dollars: String(args.amountDollars),
          bonus_points: String(bonusPoints),
        },
        redirectUrl: `${args.baseUrl}/?tokens-pending=1`,
        customPriceCents: args.amountDollars * 100,
      });
      if (!url) return { url: null, error: "Could not start checkout." };
      return { url };
    } catch (error) {
      convexLogger.error("lemonsqueezy_topup_error", {
        user_id: userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return { url: null, error: "Could not start checkout." };
    }
  },
});

export const createPurchaseSession = action({
  args: {
    amountDollars: v.number(),
    baseUrl: v.string(),
  },
  returns: v.object({
    url: v.union(v.string(), v.null()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { url: null, error: "Not authenticated" };
    }

    // Validate amount
    if (!Number.isInteger(args.amountDollars)) {
      return { url: null, error: "Amount must be a whole dollar value" };
    }
    if (args.amountDollars < 10) {
      return { url: null, error: "Minimum amount is $10" };
    }
    if (args.amountDollars > 999_999) {
      return { url: null, error: "Maximum amount is $999,999" };
    }

    // Server-derived volume bonus (tokens granted on top of the dollar amount).
    // Tiered by spend so packages AND custom amounts both reward larger top-ups.
    // Thresholds match the package ladder in lib/billing/token-packages.ts.
    const bonusPoints = bonusPointsForDollars(args.amountDollars);

    // Basic URL validation
    if (!args.baseUrl || !args.baseUrl.startsWith("http")) {
      return { url: null, error: "Invalid base URL" };
    }

    try {
      // Lazily create the per-user Stripe customer on first purchase.
      const stripeCustomerId = await getStripeCustomerId(
        ctx,
        identity.subject.split("|")[0],
        {
          email: identity.email ?? null,
          createIfMissing: true,
        },
      );
      if (!stripeCustomerId) {
        return {
          url: null,
          error: "Could not initialize billing account. Please try again.",
        };
      }

      const stripe = getStripe();
      const amountCents = args.amountDollars * 100;

      const session = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: "RIFT Extra Usage Credits",
                description: `$${args.amountDollars} in extra usage credits`,
              },
              unit_amount: amountCents,
            },
            quantity: 1,
          },
        ],
        invoice_creation: { enabled: true },
        // Show saved payment methods in Checkout UI
        saved_payment_method_options: {
          allow_redisplay_filters: ["always", "limited"],
          payment_method_save: "enabled",
        },
        metadata: {
          type: "extra_usage_purchase",
          userId: identity.subject.split("|")[0],
          amountDollars: String(args.amountDollars),
          bonusPoints: String(bonusPoints),
        },
        success_url: `${args.baseUrl}/api/extra-usage/confirm?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: args.baseUrl,
      });

      convexLogger.info("purchase_session_created", {
        user_id: identity.subject.split("|")[0],
        amount_dollars: args.amountDollars,
        session_id: session.id,
      });

      return { url: session.url };
    } catch (error) {
      convexLogger.error("purchase_session_failed", {
        user_id: identity.subject.split("|")[0],
        amount_dollars: args.amountDollars,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      const message =
        error instanceof Stripe.errors.StripeError
          ? error.message
          : error instanceof Error
            ? error.message
            : "An error occurred";
      return { url: null, error: message };
    }
  },
});

/**
 * Create a Stripe Billing Portal session URL.
 * Returns the URL for the frontend to redirect to.
 *
 * @param flow - Optional flow type: "payment_method" to go directly to payment method update
 * @param baseUrl - The base URL for the return URL (passed from client)
 */
export const createBillingPortalSession = action({
  args: {
    flow: v.optional(v.string()),
    baseUrl: v.string(),
  },
  returns: v.object({
    url: v.union(v.string(), v.null()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { url: null, error: "Not authenticated" };
    }

    // Basic URL validation
    if (!args.baseUrl || !args.baseUrl.startsWith("http")) {
      return { url: null, error: "Invalid base URL" };
    }

    try {
      const stripeCustomerId = await getStripeCustomerId(
        ctx,
        identity.subject.split("|")[0],
      );
      if (!stripeCustomerId) {
        return { url: null, error: "No billing account found" };
      }

      const stripe = getStripe();

      const sessionParams: Parameters<
        typeof stripe.billingPortal.sessions.create
      >[0] = {
        customer: stripeCustomerId,
        return_url: args.baseUrl,
      };

      // If flow=payment_method, direct user to update payment method
      if (args.flow === "payment_method") {
        sessionParams!.flow_data = {
          type: "payment_method_update",
        };
      }

      const session = await stripe.billingPortal.sessions.create(sessionParams);

      return { url: session.url };
    } catch (error) {
      console.error("Billing portal session creation failed:", error);
      const message =
        error instanceof Stripe.errors.StripeError
          ? error.message
          : error instanceof Error
            ? error.message
            : "An error occurred";
      return { url: null, error: message };
    }
  },
});

/**
 * Deduct from user's balance with auto-reload support.
 * This is called from the backend rate limit logic.
 *
 * Accepts points directly to avoid precision loss from dollar conversion.
 * (1 point = $0.0001, so sub-cent amounts are preserved)
 *
 * Flow:
 * 1. Get user's settings and current balance (in points)
 * 2. Check if auto-reload is needed (balance below threshold)
 * 3. If needed, charge via Stripe and add credits
 * 4. Deduct the requested points
 */
export const deductWithAutoReload = action({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    amountPoints: v.number(),
    subscription: v.optional(v.union(v.literal("pro"), v.literal("ultra"))),
    allowAutoReload: v.optional(v.boolean()),
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
    autoReloadResult: v.optional(
      v.object({
        success: v.boolean(),
        chargedAmountDollars: v.optional(v.number()),
        reason: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    // Validate service key
    if (args.serviceKey !== process.env.CONVEX_SERVICE_ROLE_KEY) {
      throw new Error("Invalid service key");
    }

    if (args.amountPoints <= 0) {
      return {
        success: true,
        newBalanceDollars: 0,
        insufficientFunds: false,
        monthlyCapExceeded: false,
        includedPointsDeducted: 0,
        purchasedPointsDeducted: 0,
        includedTotalPoints: getIncludedCreditsForTier(args.subscription ?? ""),
        includedRemainingPoints: getIncludedCreditsForTier(
          args.subscription ?? "",
        ),
        debtPoints: 0,
        autoReloadTriggered: false,
      };
    }

    // Get current settings (balance in both dollars and points)
    const settings: {
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
    } = await ctx.runQuery(api.extraUsage.getExtraUsageBalanceForBackend, {
      serviceKey: args.serviceKey,
      userId: args.userId,
      subscription: args.subscription,
    });

    // Use points for threshold comparison (more precise)
    const thresholdPoints: number = settings.autoReloadThresholdPoints ?? 0;
    const reloadAmount: number = settings.autoReloadAmountDollars ?? 0;
    let autoReloadTriggered = false;
    let autoReloadResult:
      | { success: boolean; chargedAmountDollars?: number; reason?: string }
      | undefined;

    // Check auto-reload conditions individually for debugging
    // Auto-reload triggers when balance drops to/below threshold, not when balance can't cover request
    const purchasedRequired =
      Math.max(0, args.amountPoints - settings.includedRemainingPoints) +
      settings.debtPoints;
    const projectedBalance = settings.balancePoints - purchasedRequired;
    const autoReloadConditions = {
      auto_reload_enabled:
        settings.autoReloadEnabled && args.allowAutoReload === true,
      purchased_credits_required: purchasedRequired > 0,
      balance_at_or_below_threshold: projectedBalance <= thresholdPoints,
      reload_amount_configured: reloadAmount > 0,
    };

    const allConditionsMet =
      autoReloadConditions.auto_reload_enabled &&
      autoReloadConditions.purchased_credits_required &&
      autoReloadConditions.balance_at_or_below_threshold &&
      autoReloadConditions.reload_amount_configured;

    // Check if auto-reload is needed (compare in points for precision)
    if (allConditionsMet) {
      autoReloadTriggered = true;

      // Get Stripe customer ID (must already exist from a prior purchase)
      const stripeCustomerId = await getStripeCustomerId(ctx, args.userId);
      if (!stripeCustomerId) {
        autoReloadResult = { success: false, reason: "no_stripe_customer" };
      } else {
        try {
          // Check if customer is blocked (fraud flagged) before attempting charge
          const customerObj =
            await getStripe().customers.retrieve(stripeCustomerId);
          const isBlocked =
            !customerObj.deleted &&
            (customerObj as Stripe.Customer).metadata?.blocked === "true";

          if (isBlocked) {
            autoReloadResult = { success: false, reason: "customer_blocked" };
          } else {
            // Get default payment method
            const paymentMethodId =
              await getDefaultPaymentMethodId(stripeCustomerId);
            if (!paymentMethodId) {
              autoReloadResult = {
                success: false,
                reason: "no_default_payment_method",
              };
            } else {
              // Charge enough to cover the purchased portion of this request
              // (and any prior true-up debt), then leave the configured target
              // balance available for subsequent work.
              const currentBalanceDollars = settings.balanceDollars;
              const targetBalanceDollars = reloadAmount;
              const amountToCharge = Math.max(
                0,
                purchasedRequired / POINTS_PER_DOLLAR +
                  targetBalanceDollars -
                  currentBalanceDollars,
              );

              // Minimum charge of $1 to avoid tiny transactions
              const MIN_CHARGE_DOLLARS = 1;
              if (amountToCharge < MIN_CHARGE_DOLLARS) {
                autoReloadResult = {
                  success: false,
                  reason: "amount_to_charge_below_minimum",
                };
              } else {
                // Create payment (Stripe uses cents)
                const amountToChargeCents = Math.round(amountToCharge * 100);
                const paymentResult = await createAutoReloadPayment(
                  stripeCustomerId,
                  paymentMethodId,
                  amountToChargeCents,
                  args.userId,
                );

                if (paymentResult.success) {
                  // Add credits (dollars -> points conversion happens in mutation)
                  await ctx.runMutation(api.extraUsage.addCredits, {
                    serviceKey: args.serviceKey,
                    userId: args.userId,
                    amountDollars: amountToCharge,
                    idempotencyKey: paymentResult.paymentIntentId,
                    revenueSource: "extra_usage_auto_reload",
                    stripeCustomerId,
                    stripePaymentIntentId: paymentResult.paymentIntentId,
                  });
                  autoReloadResult = {
                    success: true,
                    chargedAmountDollars: amountToCharge,
                  };
                } else {
                  autoReloadResult = {
                    success: false,
                    reason: paymentResult.error || "payment_failed",
                  };
                }
              }
            }
          }
        } catch {
          autoReloadResult = {
            success: false,
            reason: "stripe_lookup_failed",
          };
        }
      }
    }

    // Record outcome of auto-reload attempt for failure tracking / auto-disable.
    // Only count *real charge outcomes*: a successful charge, or a charge that
    // was actually attempted and declined by Stripe. Pre-charge configuration
    // / lookup problems (no_stripe_customer, customer_blocked,
    // no_default_payment_method, stripe_lookup_failed,
    // amount_to_charge_below_minimum) must NOT increment the consecutive
    // failure counter — they aren't card declines and shouldn't auto-disable
    // auto-reload.
    const PRE_CHARGE_REASONS = new Set([
      "no_stripe_customer",
      "customer_blocked",
      "no_default_payment_method",
      "stripe_lookup_failed",
      "amount_to_charge_below_minimum",
    ]);
    if (
      autoReloadTriggered &&
      autoReloadResult &&
      (autoReloadResult.success ||
        !PRE_CHARGE_REASONS.has(autoReloadResult.reason ?? ""))
    ) {
      await ctx.runMutation(internal.extraUsage.recordAutoReloadOutcome, {
        userId: args.userId,
        success: autoReloadResult.success,
        failureReason: autoReloadResult.reason,
      });
    }

    // Now deduct from balance using points directly (no precision loss)
    const deductResult: {
      success: boolean;
      newBalancePoints: number;
      newBalanceDollars: number;
      insufficientFunds: boolean;
      monthlyCapExceeded: boolean;
      includedPointsDeducted: number;
      purchasedPointsDeducted: number;
      includedTotalPoints: number;
      includedRemainingPoints: number;
      debtPoints: number;
    } = await ctx.runMutation(api.extraUsage.deductPoints, {
      serviceKey: args.serviceKey,
      userId: args.userId,
      amountPoints: args.amountPoints,
      includedAllowancePoints:
        args.subscription !== undefined
          ? getIncludedCreditsForTier(args.subscription)
          : undefined,
      allowDebt: args.allowDebt,
    });

    convexLogger.info("deduct_with_auto_reload", {
      user_id: args.userId,
      amount_points: args.amountPoints,
      success: deductResult.success,
      new_balance_dollars: deductResult.newBalanceDollars,
      insufficient_funds: deductResult.insufficientFunds,
      monthly_cap_exceeded: deductResult.monthlyCapExceeded,
      auto_reload_triggered: autoReloadTriggered,
      auto_reload_success: autoReloadResult?.success,
      auto_reload_charged_dollars: autoReloadResult?.chargedAmountDollars,
      auto_reload_failure_reason: autoReloadResult?.reason,
    });

    return {
      success: deductResult.success,
      newBalanceDollars: deductResult.newBalanceDollars,
      insufficientFunds: deductResult.insufficientFunds,
      monthlyCapExceeded: deductResult.monthlyCapExceeded,
      includedPointsDeducted: deductResult.includedPointsDeducted,
      purchasedPointsDeducted: deductResult.purchasedPointsDeducted,
      includedTotalPoints: deductResult.includedTotalPoints,
      includedRemainingPoints: deductResult.includedRemainingPoints,
      includedResetAt: settings.includedResetAt,
      debtPoints: deductResult.debtPoints,
      autoReloadTriggered,
      autoReloadResult,
    };
  },
});
