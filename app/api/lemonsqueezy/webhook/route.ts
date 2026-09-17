import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { bonusPointsForDollars } from "@/lib/billing/token-packages";
import { POINTS_PER_DOLLAR } from "@/lib/billing/credit-units";
import {
  getIncludedCreditsForTier,
  usesAccountCreditLedger,
} from "@/lib/billing/included-credits";
import { retireLegacyPaidBucketsForRenewal } from "@/lib/billing/paid-ledger-migration";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// Subscription statuses that should hold the monthly allowance. `cancelled`
// keeps access until the paid period ends (LemonSqueezy then sends `expired`).
const ALLOWANCE_STATUSES = new Set([
  "active",
  "on_trial",
  "past_due",
  "cancelled",
]);

function variantToTier(variantId: string | undefined): string | null {
  if (!variantId) return null;
  if (variantId === process.env.LEMONSQUEEZY_PRO_VARIANT_ID) return "pro";
  if (variantId === process.env.LEMONSQUEEZY_MAX_VARIANT_ID) return "ultra";
  return null;
}

const str = (v: unknown): string | undefined =>
  v === null || v === undefined ? undefined : String(v);

const grantPointsForPrincipalCents = (principalCents: number): number => {
  const dollars = principalCents / 100;
  return (
    principalCents * (POINTS_PER_DOLLAR / 100) + bonusPointsForDollars(dollars)
  );
};

/** Exact integer `round(value * numerator / denominator)` without overflow. */
const roundedProportion = (
  value: number,
  numerator: number,
  denominator: number,
): number => {
  const two = BigInt(2);
  const scaled = BigInt(value) * BigInt(numerator);
  return Number(
    (scaled * two + BigInt(denominator)) / (BigInt(denominator) * two),
  );
};

/**
 * POST /api/lemonsqueezy/webhook
 *
 * Verifies the `X-Signature` (HMAC-SHA256 of the raw body with the webhook
 * signing secret), then:
 *  - `subscription_*` → upsert the subscription row + grant/revoke the monthly
 *    allowance (this drives the Pro/Max entitlement via getMyEntitlements).
 *  - `subscription_payment_success` → re-grant the allowance on each renewal.
 *  - `order_created` (our RIFT Credits top-up) → credit the prepaid balance.
 *  - `order_refunded` (our RIFT Credits top-up) → revoke the cumulative
 *    refunded share, moving any already-spent amount into credit debt.
 *
 * Configure in LemonSqueezy → Settings → Webhooks:
 *  - URL: https://<public-domain>/api/lemonsqueezy/webhook
 *  - Signing secret → LEMONSQUEEZY_WEBHOOK_SECRET
 *  - Events: subscription_created / _updated / _cancelled / _resumed /
 *    _expired / _paused / _unpaused, subscription_payment_success,
 *    order_created, order_refunded
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature =
    req.headers.get("X-Signature") ?? req.headers.get("x-signature");

  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[LemonSqueezy] LEMONSQUEEZY_WEBHOOK_SECRET not configured");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 },
    );
  }
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const sigBuf = Buffer.from(signature, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (
    sigBuf.length !== expBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expBuf)
  ) {
    console.error("[LemonSqueezy] Signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let payload: {
    meta?: { event_name?: string; custom_data?: Record<string, string> };
    data?: { id?: string; type?: string; attributes?: Record<string, unknown> };
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventName = payload.meta?.event_name ?? "";
  const custom = payload.meta?.custom_data ?? {};
  const data = payload.data ?? {};
  const attrs = data.attributes ?? {};
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY!;

  // Resolve the RIFT user + tier for a subscription id: prefer the checkout
  // custom_data, fall back to the stored row (later events may omit it).
  async function resolveUserTier(
    lsSubscriptionId: string,
    variantId: string | undefined,
    email?: string,
  ): Promise<{ userId: string; tier: string }> {
    let userId = custom.user_id ?? "";
    let tier = custom.tier ?? variantToTier(variantId) ?? "";
    if ((!userId || !tier) && lsSubscriptionId) {
      const existing = await convex.query(api.subscriptions.lookupByLsId, {
        serviceKey,
        lsSubscriptionId,
      });
      if (existing) {
        userId = userId || existing.userId;
        tier = tier || existing.tier;
      }
    }
    // Last-resort fallback: resolve by the subscription's customer email. A
    // checkout that didn't carry custom_data.user_id (or a first event that
    // arrives before the row exists) would otherwise drop a paid signup on the
    // floor — the LemonSqueezy payload's user_email still identifies the account.
    if (!userId && email) {
      const byEmail = await convex.query(api.subscriptions.findUserIdByEmail, {
        serviceKey,
        email,
      });
      if (byEmail) userId = byEmail.userId;
    }
    return { userId, tier };
  }

  try {
    // ---- Partial/full refund of a one-time RIFT Credits order ----
    if (eventName === "order_refunded") {
      // Subscription purchases also produce Order events. Only a checkout
      // explicitly tagged as an add-on credit purchase belongs to this ledger.
      if (custom.kind !== "extra_usage_purchase") {
        return NextResponse.json({
          received: true,
          ignored: "non-credit order refund",
        });
      }

      const userId = (custom.user_id ?? "").trim();
      const orderId = str(data.id)?.trim() ?? "";
      const subtotalUsdCents = attrs.subtotal_usd;
      const discountUsdCents = attrs.discount_total_usd;
      const totalUsdCents = attrs.total_usd;
      const cumulativeRefundUsdCents = attrs.refunded_amount_usd;
      if (
        data.type !== "orders" ||
        !orderId ||
        typeof subtotalUsdCents !== "number" ||
        !Number.isSafeInteger(subtotalUsdCents) ||
        subtotalUsdCents <= 0 ||
        typeof discountUsdCents !== "number" ||
        !Number.isSafeInteger(discountUsdCents) ||
        discountUsdCents < 0 ||
        typeof totalUsdCents !== "number" ||
        !Number.isSafeInteger(totalUsdCents) ||
        totalUsdCents <= 0 ||
        typeof cumulativeRefundUsdCents !== "number" ||
        !Number.isSafeInteger(cumulativeRefundUsdCents) ||
        cumulativeRefundUsdCents <= 0 ||
        cumulativeRefundUsdCents > totalUsdCents
      ) {
        return NextResponse.json(
          { error: "Invalid credit order refund" },
          { status: 400 },
        );
      }

      const paidPrincipalCents = subtotalUsdCents - discountUsdCents;
      if (
        paidPrincipalCents <= 0 ||
        !Number.isSafeInteger(paidPrincipalCents) ||
        paidPrincipalCents > totalUsdCents
      ) {
        return NextResponse.json(
          { error: "Invalid credit order refund" },
          { status: 400 },
        );
      }

      // Refund dollars include tax while RIFT Credits never did. Convert the
      // cumulative refund to its proportional tax-free principal, then compute
      // the entitlement that the remaining principal would grant today. This
      // also unwinds a volume bonus when a partial refund crosses a tier.
      const fullyRefunded =
        attrs.refunded === true || cumulativeRefundUsdCents === totalUsdCents;
      const refundedPrincipalCents = fullyRefunded
        ? paidPrincipalCents
        : Math.min(
            paidPrincipalCents,
            roundedProportion(
              paidPrincipalCents,
              cumulativeRefundUsdCents,
              totalUsdCents,
            ),
          );
      const remainingPrincipalCents = Math.max(
        0,
        paidPrincipalCents - refundedPrincipalCents,
      );
      const originalGrantPoints =
        grantPointsForPrincipalCents(paidPrincipalCents);
      const targetRevokedPoints = Math.max(
        0,
        originalGrantPoints -
          grantPointsForPrincipalCents(remainingPrincipalCents),
      );

      const result = await convex.mutation(
        api.extraUsage.revokeCreditsForRefund,
        {
          serviceKey,
          purchaseKey: `ls_${orderId}`,
          ...(userId ? { userId } : {}),
          originalGrantPoints,
          cumulativeRefundUsdCents,
          targetRevokedPoints,
        },
      );
      console.log(
        `[LemonSqueezy] order_refunded revoked user=${userId || "stored"} order=${orderId} points=${result.revokedPoints}`,
        result.alreadyProcessed ? "(dup/stale)" : "",
      );
      return NextResponse.json({ received: true });
    }

    // ---- One-time token top-up (RIFT Credits) ----
    if (eventName === "order_created") {
      // Only our credit orders carry kind=extra_usage_purchase; a subscription's
      // first payment also fires order_created and must be skipped here.
      if (custom.kind !== "extra_usage_purchase") {
        return NextResponse.json({
          received: true,
          ignored: "non-credit order",
        });
      }
      if (attrs.status !== "paid") {
        return NextResponse.json({ received: true, status: str(attrs.status) });
      }

      // The signed Order object is the source of truth for money. `custom_data`
      // is useful for attribution, but it is checkout metadata and must never
      // decide how many credits a paid order receives. Use the USD product
      // subtotal after discounts, excluding tax/VAT from credited principal.
      const userId = (custom.user_id ?? "").trim();
      const orderId = str(data.id)?.trim() ?? "";
      const subtotalUsdCents = attrs.subtotal_usd;
      const discountUsdCents = attrs.discount_total_usd;
      if (
        data.type !== "orders" ||
        !userId ||
        !orderId ||
        typeof subtotalUsdCents !== "number" ||
        !Number.isSafeInteger(subtotalUsdCents) ||
        subtotalUsdCents <= 0 ||
        typeof discountUsdCents !== "number" ||
        !Number.isSafeInteger(discountUsdCents) ||
        discountUsdCents < 0
      ) {
        return NextResponse.json(
          { error: "Invalid credit order" },
          { status: 400 },
        );
      }

      const paidPrincipalCents = Math.max(
        0,
        subtotalUsdCents - discountUsdCents,
      );
      if (paidPrincipalCents <= 0) {
        return NextResponse.json(
          { error: "Invalid credit order" },
          { status: 400 },
        );
      }

      const amountDollars = paidPrincipalCents / 100;
      const metadataAmountDollars = Number(custom.amount_dollars);
      if (
        Number.isFinite(metadataAmountDollars) &&
        Math.round(metadataAmountDollars * 100) !== paidPrincipalCents
      ) {
        console.warn(
          `[LemonSqueezy] order_created amount metadata mismatch order=${orderId}; using signed USD principal`,
        );
      }

      const result = await convex.mutation(api.extraUsage.addCredits, {
        serviceKey,
        userId,
        amountDollars,
        bonusPoints: bonusPointsForDollars(amountDollars),
        idempotencyKey: `ls_${orderId}`,
        revenueSource: "extra_usage_purchase",
      });
      console.log(
        `[LemonSqueezy] order_created credited ${userId}: $${amountDollars}`,
        result.alreadyProcessed ? "(dup)" : "",
      );
      return NextResponse.json({ received: true });
    }

    // ---- Renewal payment → refresh the monthly allowance ----
    if (eventName === "subscription_payment_success") {
      const invoiceId = str(data.id)?.trim() ?? "";
      const lsSubscriptionId = str(attrs.subscription_id) ?? "";
      if (!invoiceId) {
        console.error(
          "[LemonSqueezy] subscription payment missing invoice id",
          lsSubscriptionId,
        );
        return NextResponse.json(
          { error: "Invalid subscription payment" },
          { status: 500 },
        );
      }
      const { userId, tier } = await resolveUserTier(
        lsSubscriptionId,
        undefined,
        str(attrs.user_email),
      );
      if (!userId || !usesAccountCreditLedger(tier)) {
        console.error(
          "[LemonSqueezy] payment event without resolvable consumer plan",
          invoiceId,
          lsSubscriptionId,
        );
        return NextResponse.json(
          { error: "Unresolved subscription payment" },
          { status: 500 },
        );
      }
      const billingReason = str(attrs.billing_reason) ?? "";
      const isRenewal = billingReason === "renewal";
      const invoiceCreatedAt = str(attrs.created_at);
      if (
        isRenewal &&
        (!invoiceCreatedAt || !Number.isFinite(Date.parse(invoiceCreatedAt)))
      ) {
        console.error(
          "[LemonSqueezy] renewal invoice missing a valid created_at",
          invoiceId,
          lsSubscriptionId,
        );
        return NextResponse.json(
          { error: "Invalid subscription renewal" },
          { status: 500 },
        );
      }
      // `subscription_payment_success` also fires for the initial invoice.
      // Only a true renewal starts a new credit cycle; otherwise the adjacent
      // subscription_created event and this invoice would reset usage twice.
      if (isRenewal) {
        await retireLegacyPaidBucketsForRenewal(userId, tier);
      }
      await convex.mutation(api.extraUsage.grantMonthlyAllowance, {
        serviceKey,
        userId,
        allowancePoints: getIncludedCreditsForTier(tier),
        cycleKey: `ls_invoice:${invoiceId}`,
        cycleStartedAt: invoiceCreatedAt,
        resetUsage: isRenewal,
      });
      console.log(
        `[LemonSqueezy] payment allowance reconciled user=${userId} reason=${billingReason}`,
      );
      return NextResponse.json({ received: true });
    }

    // ---- Status-bearing subscription lifecycle events ----
    if (
      data.type === "subscriptions" &&
      eventName.startsWith("subscription_")
    ) {
      const lsSubscriptionId = str(data.id) ?? "";
      if (!lsSubscriptionId) {
        return NextResponse.json({ received: true, ignored: "no sub id" });
      }
      const status = str(attrs.status) ?? "";
      const variantId = str(attrs.variant_id);
      const { userId, tier: resolvedTier } = await resolveUserTier(
        lsSubscriptionId,
        variantId,
        str(attrs.user_email),
      );
      if (!userId || !usesAccountCreditLedger(resolvedTier)) {
        // Could not resolve the account from custom_data, the stored row, or the
        // customer email. Return 500 so LemonSqueezy retries rather than silently
        // dropping a paid subscription — a transient race (event arriving before
        // the user row commits) then recovers on the retry.
        console.error(
          "[LemonSqueezy] subscription event without resolvable consumer plan — returning 500 for retry",
          eventName,
          lsSubscriptionId,
          str(attrs.user_email),
        );
        return NextResponse.json(
          { error: "Unresolved subscription" },
          { status: 500 },
        );
      }
      const tier = resolvedTier;

      await convex.mutation(api.subscriptions.upsertSubscriptionFromWebhook, {
        serviceKey,
        userId,
        lsSubscriptionId,
        lsCustomerId: str(attrs.customer_id),
        lsVariantId: variantId,
        lsOrderId: str(attrs.order_id),
        tier,
        status,
        renewsAt: str(attrs.renews_at),
        endsAt: str(attrs.ends_at),
      });

      const allowance = ALLOWANCE_STATUSES.has(status)
        ? getIncludedCreditsForTier(tier)
        : 0;
      await convex.mutation(api.extraUsage.grantMonthlyAllowance, {
        serviceKey,
        userId,
        allowancePoints: allowance,
        cycleKey: `ls_subscription:${lsSubscriptionId}:initial`,
        resetsAt: str(attrs.renews_at) ?? str(attrs.ends_at),
        // Lifecycle/status events update the ceiling and reset timestamp only.
        // The paid renewal invoice is the sole authority that resets usage.
        resetUsage: false,
      });

      console.log(
        `[LemonSqueezy] ${eventName} user=${userId} tier=${tier} status=${status} allowance=${allowance}`,
      );
      return NextResponse.json({ received: true });
    }

    return NextResponse.json({ received: true, ignored: eventName });
  } catch (err) {
    console.error("[LemonSqueezy] webhook handler failed:", err);
    // 500 → LemonSqueezy retries the webhook.
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }
}
