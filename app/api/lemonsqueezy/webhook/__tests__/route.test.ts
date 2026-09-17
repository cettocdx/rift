import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { createHmac } from "crypto";
import {
  mockMutation as mockConvexMutation,
  mockQuery as mockConvexQuery,
} from "convex/browser";

const mockRetireLegacyPaidBucketsForRenewal = jest.fn(async () => undefined);

jest.mock("next/server", () => ({
  NextResponse: {
    json: jest.fn((body: unknown, init?: ResponseInit) => ({
      status: init?.status ?? 200,
      json: async () => body,
    })),
  },
}));

jest.mock("@/lib/billing/paid-ledger-migration", () => ({
  retireLegacyPaidBucketsForRenewal: mockRetireLegacyPaidBucketsForRenewal,
}));

const WEBHOOK_SECRET = "ls_test_webhook_secret";

type OrderPayloadOptions = {
  eventName?: string;
  id?: string;
  type?: string;
  userId?: string;
  kind?: string;
  metadataAmountDollars?: string;
  status?: string;
  currency?: unknown;
  subtotalUsd?: unknown;
  discountTotalUsd?: unknown;
  taxUsd?: unknown;
  totalUsd?: unknown;
  refundedAmountUsd?: unknown;
  refunded?: unknown;
};

function makeOrderPayload({
  eventName = "order_created",
  id = "order_123",
  type = "orders",
  userId = "user_123",
  kind = "extra_usage_purchase",
  metadataAmountDollars = "50",
  status = "paid",
  currency = "USD",
  subtotalUsd = 5_000,
  discountTotalUsd = 0,
  taxUsd = 1_000,
  totalUsd = 6_000,
  refundedAmountUsd,
  refunded,
}: OrderPayloadOptions = {}) {
  return {
    meta: {
      event_name: eventName,
      custom_data: {
        kind,
        user_id: userId,
        amount_dollars: metadataAmountDollars,
      },
    },
    data: {
      id,
      type,
      attributes: {
        status,
        currency,
        subtotal_usd: subtotalUsd,
        discount_total_usd: discountTotalUsd,
        tax_usd: taxUsd,
        total_usd: totalUsd,
        refunded_amount_usd: refundedAmountUsd,
        refunded,
      },
    },
  };
}

function makeSignedRequest(payload: unknown, signatureOverride?: string) {
  const rawBody = JSON.stringify(payload);
  const signature =
    signatureOverride ??
    createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");

  return {
    text: jest.fn(async () => rawBody),
    headers: {
      get: jest.fn((name: string) =>
        name.toLowerCase() === "x-signature" ? signature : null,
      ),
    },
  } as any;
}

async function invokeWebhook(request: ReturnType<typeof makeSignedRequest>) {
  const { POST } = await import("../route");
  return POST(request);
}

describe("LemonSqueezy add-on credit webhook", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.LEMONSQUEEZY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.CONVEX_SERVICE_ROLE_KEY = "service_key";
    mockConvexMutation.mockResolvedValue({
      alreadyProcessed: false,
      newBalance: 50,
    } as never);
    mockConvexQuery.mockResolvedValue(null as never);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("credits the signed USD product principal, excluding tax, and derives its tier bonus", async () => {
    const payload = makeOrderPayload({
      subtotalUsd: 5_000,
      taxUsd: 1_000,
      totalUsd: 6_000,
      // Prove checkout metadata cannot inflate or reduce the credited amount.
      metadataAmountDollars: "300",
    });

    const response = await invokeWebhook(makeSignedRequest(payload));

    await expect(response.json()).resolves.toEqual({ received: true });
    expect(response.status).toBe(200);
    expect(mockConvexMutation).toHaveBeenCalledTimes(1);
    expect(mockConvexMutation).toHaveBeenCalledWith(expect.anything(), {
      serviceKey: "service_key",
      userId: "user_123",
      amountDollars: 50,
      bonusPoints: 25_000,
      idempotencyKey: "ls_order_123",
      revenueSource: "extra_usage_purchase",
    });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("using signed USD principal"),
    );
  });

  it("subtracts a provider-confirmed discount before applying the bonus tier", async () => {
    const payload = makeOrderPayload({
      id: "order_discounted",
      subtotalUsd: 10_000,
      discountTotalUsd: 2_000,
      taxUsd: 1_600,
      totalUsd: 9_600,
      metadataAmountDollars: "100",
    });

    const response = await invokeWebhook(makeSignedRequest(payload));

    expect(response.status).toBe(200);
    expect(mockConvexMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        amountDollars: 80,
        bonusPoints: 40_000,
        idempotencyKey: "ls_order_discounted",
      }),
    );
  });

  it("uses the same durable order idempotency key for duplicate deliveries", async () => {
    mockConvexMutation
      .mockResolvedValueOnce({
        alreadyProcessed: false,
        newBalance: 20,
      } as never)
      .mockResolvedValueOnce({
        alreadyProcessed: true,
        newBalance: 0,
      } as never);
    const payload = makeOrderPayload({
      id: "order_duplicate",
      subtotalUsd: 2_000,
      taxUsd: 400,
      totalUsd: 2_400,
      metadataAmountDollars: "20",
    });

    const firstResponse = await invokeWebhook(makeSignedRequest(payload));
    const duplicateResponse = await invokeWebhook(makeSignedRequest(payload));

    expect(firstResponse.status).toBe(200);
    expect(duplicateResponse.status).toBe(200);
    expect(mockConvexMutation).toHaveBeenCalledTimes(2);
    expect(
      mockConvexMutation.mock.calls.map(
        ([, args]) => (args as { idempotencyKey: string }).idempotencyKey,
      ),
    ).toEqual(["ls_order_duplicate", "ls_order_duplicate"]);
  });

  it("fully revokes the tax-exclusive principal and its bonus on a full refund", async () => {
    mockConvexMutation.mockResolvedValue({
      alreadyProcessed: false,
      revokedPoints: 525_000,
      totalRevokedPoints: 525_000,
      newBalancePoints: 0,
      debtPoints: 0,
    } as never);
    const payload = makeOrderPayload({
      eventName: "order_refunded",
      status: "refunded",
      refundedAmountUsd: 6_000,
      refunded: true,
      // Metadata is not authoritative for either the original grant or refund.
      metadataAmountDollars: "300",
    });

    const response = await invokeWebhook(makeSignedRequest(payload));

    await expect(response.json()).resolves.toEqual({ received: true });
    expect(response.status).toBe(200);
    expect(mockConvexMutation).toHaveBeenCalledTimes(1);
    expect(mockConvexMutation).toHaveBeenCalledWith(expect.anything(), {
      serviceKey: "service_key",
      purchaseKey: "ls_order_123",
      userId: "user_123",
      originalGrantPoints: 525_000,
      cumulativeRefundUsdCents: 6_000,
      targetRevokedPoints: 525_000,
    });
  });

  it("maps a tax-bearing partial refund to principal and unwinds a crossed bonus tier", async () => {
    const payload = makeOrderPayload({
      eventName: "order_refunded",
      id: "order_threshold",
      subtotalUsd: 10_000,
      discountTotalUsd: 0,
      taxUsd: 2_000,
      totalUsd: 12_000,
      refundedAmountUsd: 120,
      refunded: false,
      status: "partial_refund",
    });

    const response = await invokeWebhook(makeSignedRequest(payload));

    expect(response.status).toBe(200);
    // $1.20 of a tax-inclusive $120 total maps to $1 of principal. The
    // remaining $99 no longer qualifies for the original 10% bonus, so the
    // cumulative clawback is 1,100,000 - 1,039,500 = 60,500 points.
    expect(mockConvexMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        purchaseKey: "ls_order_threshold",
        originalGrantPoints: 1_100_000,
        cumulativeRefundUsdCents: 120,
        targetRevokedPoints: 60_500,
      }),
    );
  });

  it("forwards cumulative refund high-water marks so duplicate and stale events are atomic no-ops in Convex", async () => {
    mockConvexMutation
      .mockResolvedValueOnce({
        alreadyProcessed: false,
        revokedPoints: 75_000,
      } as never)
      .mockResolvedValueOnce({
        alreadyProcessed: false,
        revokedPoints: 50_000,
      } as never)
      .mockResolvedValueOnce({
        alreadyProcessed: true,
        revokedPoints: 0,
      } as never);
    const partial = makeOrderPayload({
      eventName: "order_refunded",
      id: "order_cumulative",
      status: "partial_refund",
      refundedAmountUsd: 600,
      refunded: false,
    });
    const laterPartial = makeOrderPayload({
      eventName: "order_refunded",
      id: "order_cumulative",
      status: "partial_refund",
      refundedAmountUsd: 1_200,
      refunded: false,
    });

    expect((await invokeWebhook(makeSignedRequest(partial))).status).toBe(200);
    expect((await invokeWebhook(makeSignedRequest(laterPartial))).status).toBe(
      200,
    );
    expect((await invokeWebhook(makeSignedRequest(partial))).status).toBe(200);

    expect(
      mockConvexMutation.mock.calls.map(([, args]) => ({
        purchaseKey: (args as { purchaseKey: string }).purchaseKey,
        cumulativeRefundUsdCents: (args as { cumulativeRefundUsdCents: number })
          .cumulativeRefundUsdCents,
        targetRevokedPoints: (args as { targetRevokedPoints: number })
          .targetRevokedPoints,
      })),
    ).toEqual([
      {
        purchaseKey: "ls_order_cumulative",
        cumulativeRefundUsdCents: 600,
        targetRevokedPoints: 75_000,
      },
      {
        purchaseKey: "ls_order_cumulative",
        cumulativeRefundUsdCents: 1_200,
        targetRevokedPoints: 125_000,
      },
      {
        purchaseKey: "ls_order_cumulative",
        cumulativeRefundUsdCents: 600,
        targetRevokedPoints: 75_000,
      },
    ]);
  });

  it("can resolve a refund from the stored purchase when legacy custom user data is absent", async () => {
    const response = await invokeWebhook(
      makeSignedRequest(
        makeOrderPayload({
          eventName: "order_refunded",
          userId: "",
          status: "partial_refund",
          refundedAmountUsd: 600,
          refunded: false,
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(mockConvexMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ userId: expect.anything() }),
    );
  });

  it("ignores refunded subscription orders without touching add-on credits", async () => {
    const response = await invokeWebhook(
      makeSignedRequest(
        makeOrderPayload({
          eventName: "order_refunded",
          kind: "subscription",
          refundedAmountUsd: 6_000,
          refunded: true,
        }),
      ),
    );

    await expect(response.json()).resolves.toEqual({
      received: true,
      ignored: "non-credit order refund",
    });
    expect(response.status).toBe(200);
    expect(mockConvexMutation).not.toHaveBeenCalled();
  });

  it.each([
    ["missing order id", { id: "" }],
    ["wrong resource type", { type: "subscriptions" }],
    ["zero cumulative refund", { refundedAmountUsd: 0 }],
    ["fractional cumulative refund", { refundedAmountUsd: 100.5 }],
    ["refund above order total", { refundedAmountUsd: 6_001 }],
    ["missing order total", { totalUsd: null }],
    ["discount above subtotal", { discountTotalUsd: 5_001 }],
  ])("rejects a credit refund with %s", async (_label, overrides) => {
    const response = await invokeWebhook(
      makeSignedRequest(
        makeOrderPayload({
          eventName: "order_refunded",
          status: "partial_refund",
          refundedAmountUsd: 600,
          refunded: false,
          ...(overrides as OrderPayloadOptions),
        }),
      ),
    );

    await expect(response.json()).resolves.toEqual({
      error: "Invalid credit order refund",
    });
    expect(response.status).toBe(400);
    expect(mockConvexMutation).not.toHaveBeenCalled();
  });

  it("returns 500 when atomic refund revocation fails so LemonSqueezy retries", async () => {
    mockConvexMutation.mockRejectedValueOnce(
      new Error("credited purchase not found") as never,
    );
    const response = await invokeWebhook(
      makeSignedRequest(
        makeOrderPayload({
          eventName: "order_refunded",
          status: "partial_refund",
          refundedAmountUsd: 600,
          refunded: false,
        }),
      ),
    );

    await expect(response.json()).resolves.toEqual({
      error: "Handler failed",
    });
    expect(response.status).toBe(500);
  });

  it("acknowledges a non-paid credit order without adding credits", async () => {
    const response = await invokeWebhook(
      makeSignedRequest(makeOrderPayload({ status: "pending" })),
    );

    await expect(response.json()).resolves.toEqual({
      received: true,
      status: "pending",
    });
    expect(response.status).toBe(200);
    expect(mockConvexMutation).not.toHaveBeenCalled();
  });

  it.each([
    ["missing user attribution", { userId: "" }],
    ["missing order id", { id: "" }],
    ["wrong resource type", { type: "subscriptions" }],
    ["non-numeric USD subtotal", { subtotalUsd: "5000" }],
    ["fractional USD cents", { subtotalUsd: 5_000.5 }],
    ["non-positive USD subtotal", { subtotalUsd: 0 }],
    ["negative discount", { discountTotalUsd: -1 }],
    ["a discount larger than the subtotal", { discountTotalUsd: 5_001 }],
  ])("rejects %s as an invalid credit order", async (_label, overrides) => {
    const response = await invokeWebhook(
      makeSignedRequest(makeOrderPayload(overrides as OrderPayloadOptions)),
    );

    await expect(response.json()).resolves.toEqual({
      error: "Invalid credit order",
    });
    expect(response.status).toBe(400);
    expect(mockConvexMutation).not.toHaveBeenCalled();
  });

  it("ignores order_created events that are not add-on credit purchases", async () => {
    const response = await invokeWebhook(
      makeSignedRequest(makeOrderPayload({ kind: "subscription" })),
    );

    await expect(response.json()).resolves.toEqual({
      received: true,
      ignored: "non-credit order",
    });
    expect(response.status).toBe(200);
    expect(mockConvexMutation).not.toHaveBeenCalled();
  });

  it("rejects an invalid webhook signature before touching the ledger", async () => {
    const response = await invokeWebhook(
      makeSignedRequest(makeOrderPayload(), "not-a-valid-signature"),
    );

    await expect(response.json()).resolves.toEqual({
      error: "Invalid signature",
    });
    expect(response.status).toBe(400);
    expect(mockConvexMutation).not.toHaveBeenCalled();
  });

  it("fails closed instead of defaulting an unknown subscription variant to Pro", async () => {
    const payload = {
      meta: {
        event_name: "subscription_created",
        custom_data: { user_id: "user_123" },
      },
      data: {
        id: "sub_unknown",
        type: "subscriptions",
        attributes: {
          status: "active",
          variant_id: "variant_unknown",
        },
      },
    };

    const response = await invokeWebhook(makeSignedRequest(payload));

    await expect(response.json()).resolves.toEqual({
      error: "Unresolved subscription",
    });
    expect(response.status).toBe(500);
    expect(mockConvexMutation).not.toHaveBeenCalled();
  });

  it("uses the provider invoice timestamp to open a renewal cycle", async () => {
    const payload = {
      meta: {
        event_name: "subscription_payment_success",
        custom_data: { user_id: "user_123", tier: "ultra" },
      },
      data: {
        id: "invoice_renewal_2",
        type: "subscription-invoices",
        attributes: {
          subscription_id: "sub_123",
          billing_reason: "renewal",
          created_at: "2026-07-20T10:00:00.000Z",
        },
      },
    };

    const response = await invokeWebhook(makeSignedRequest(payload));

    expect(response.status).toBe(200);
    expect(mockRetireLegacyPaidBucketsForRenewal).toHaveBeenCalledWith(
      "user_123",
      "ultra",
    );
    expect(mockConvexMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user_123",
        allowancePoints: 1_800_000,
        cycleKey: "ls_invoice:invoice_renewal_2",
        cycleStartedAt: "2026-07-20T10:00:00.000Z",
        resetUsage: true,
      }),
    );
  });

  it("rejects a renewal without a provider timestamp before resetting credits", async () => {
    const payload = {
      meta: {
        event_name: "subscription_payment_success",
        custom_data: { user_id: "user_123", tier: "ultra" },
      },
      data: {
        id: "invoice_missing_time",
        type: "subscription-invoices",
        attributes: {
          subscription_id: "sub_123",
          billing_reason: "renewal",
        },
      },
    };

    const response = await invokeWebhook(makeSignedRequest(payload));

    expect(response.status).toBe(500);
    expect(mockRetireLegacyPaidBucketsForRenewal).not.toHaveBeenCalled();
    expect(mockConvexMutation).not.toHaveBeenCalled();
  });

  it("rejects a subscription payment without a provider invoice id", async () => {
    const payload = {
      meta: {
        event_name: "subscription_payment_success",
        custom_data: { user_id: "user_123", tier: "ultra" },
      },
      data: {
        id: "",
        type: "subscription-invoices",
        attributes: {
          subscription_id: "sub_123",
          billing_reason: "renewal",
          created_at: "2026-07-20T10:00:00.000Z",
        },
      },
    };

    const response = await invokeWebhook(makeSignedRequest(payload));

    await expect(response.json()).resolves.toEqual({
      error: "Invalid subscription payment",
    });
    expect(response.status).toBe(500);
    expect(mockRetireLegacyPaidBucketsForRenewal).not.toHaveBeenCalled();
    expect(mockConvexMutation).not.toHaveBeenCalled();
  });
});
