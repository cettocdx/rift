import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { bonusPointsForDollars } from "@/lib/billing/token-packages";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

/**
 * RIFT no longer creates new crypto invoices (card-only via LemonSqueezy now)
 * — see convex/extraUsageActions.ts, `createCryptoInvoice` was removed. This
 * receiver stays live only to correctly credit any invoices created before
 * that change; do not wire new crypto purchase flows to it.
 */

/**
 * Recursively sort object keys so the JSON string is canonical — NowPayments
 * computes the IPN HMAC over the body with keys sorted alphabetically, so we
 * must reproduce the exact same serialization to verify the signature.
 */
function sortedStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(sortedStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${sortedStringify(obj[k])}`,
  );
  return `{${entries.join(",")}}`;
}

/**
 * POST /api/extra-usage/nowpayments-ipn
 *
 * NowPayments Instant Payment Notification. Verifies the `x-nowpayments-sig`
 * HMAC-SHA512 over the sorted JSON body, then credits the prepaid balance
 * (base + server-derived volume bonus) once the payment reaches `finished`.
 *
 * Configure in NowPayments dashboard:
 *   - IPN callback URL: https://your-domain.com/api/extra-usage/nowpayments-ipn
 *   - Set the IPN secret; mirror it into NOWPAYMENTS_IPN_SECRET here.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-nowpayments-sig");

  if (!signature) {
    console.error("[NowPayments IPN] Missing x-nowpayments-sig header");
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!ipnSecret) {
    console.error("[NowPayments IPN] NOWPAYMENTS_IPN_SECRET is not configured");
    return NextResponse.json(
      { error: "IPN secret not configured" },
      { status: 500 },
    );
  }

  // Verify signature over the canonical (sorted-key) serialization.
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const expected = crypto
    .createHmac("sha512", ipnSecret)
    .update(sortedStringify(payload))
    .digest("hex");

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (
    sigBuf.length !== expBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expBuf)
  ) {
    console.error("[NowPayments IPN] Signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const status = String(payload.payment_status ?? "");
  const orderId = String(payload.order_id ?? "");
  const paymentId = String(payload.payment_id ?? payload.invoice_id ?? "");
  const amountDollars = Number(payload.price_amount);

  // order_id format: "<userId>::<suffix>" (see createCryptoInvoice).
  const userId = orderId.split("::")[0];

  // Only fully-settled payments credit the balance. Intermediate states
  // (waiting/confirming/sending) and partial/failed states are acked (200) and
  // ignored — NowPayments retries until `finished`, and addCredits is
  // idempotent on the payment id.
  if (status !== "finished") {
    return NextResponse.json({ received: true, status });
  }

  if (!userId || !Number.isFinite(amountDollars) || amountDollars <= 0) {
    console.error("[NowPayments IPN] Invalid order metadata:", orderId);
    return NextResponse.json({ error: "Invalid metadata" }, { status: 400 });
  }

  const bonusPoints = bonusPointsForDollars(amountDollars);

  try {
    const result = await convex.mutation(api.extraUsage.addCredits, {
      serviceKey: process.env.CONVEX_SERVICE_ROLE_KEY!,
      userId,
      amountDollars,
      bonusPoints,
      idempotencyKey: `np_${paymentId}`,
      revenueSource: "extra_usage_purchase",
    });

    console.log(
      `[NowPayments IPN] Credited user ${userId}: $${amountDollars} (+${bonusPoints} bonus)`,
      result.alreadyProcessed ? "(already processed)" : "",
    );
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[NowPayments IPN] addCredits failed:", err);
    // 500 → NowPayments retries the IPN.
    return NextResponse.json({ error: "Crediting failed" }, { status: 500 });
  }
}
