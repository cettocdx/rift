import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("../_generated/server", () => ({
  mutation: jest.fn((config: unknown) => config),
  internalMutation: jest.fn((config: unknown) => config),
  query: jest.fn((config: unknown) => config),
  internalQuery: jest.fn((config: unknown) => config),
}));

jest.mock("convex/values", () => ({
  v: {
    array: jest.fn(() => "array"),
    boolean: jest.fn(() => "boolean"),
    literal: jest.fn(() => "literal"),
    null: jest.fn(() => "null"),
    number: jest.fn(() => "number"),
    object: jest.fn(() => "object"),
    optional: jest.fn(() => "optional"),
    string: jest.fn(() => "string"),
    union: jest.fn(() => "union"),
  },
}));

jest.mock("../lib/utils", () => ({
  validateServiceKey: jest.fn(),
}));

jest.mock("../lib/logger", () => ({
  convexLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

type PurchaseRow = {
  _id: string;
  session_key: string;
  processed_at: number;
  user_id?: string;
  credited_points?: number;
  refunded_usd_cents?: number;
  revoked_points?: number;
  refund_updated_at?: number;
};

type ExtraUsageRow = {
  _id: string;
  user_id: string;
  balance_points: number;
  credit_debt_points?: number;
  monthly_spent_points?: number;
  updated_at: number;
};

const makeContext = ({
  purchase,
  settings,
}: {
  purchase: PurchaseRow | null;
  settings: ExtraUsageRow | null;
}) => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const db = {
    query: jest.fn((table: string) => ({
      withIndex: jest.fn(
        (
          _indexName: string,
          predicate: (q: {
            eq: (field: string, value: string) => unknown;
          }) => unknown,
        ) => {
          let lookup = "";
          predicate({
            eq: (_field: string, value: string) => {
              lookup = value;
              return {};
            },
          });
          if (table === "processed_checkout_sessions") {
            return {
              unique: async () =>
                purchase?.session_key === lookup ? purchase : null,
            };
          }
          return {
            first: async () => (settings?.user_id === lookup ? settings : null),
          };
        },
      ),
    })),
    patch: jest.fn(async (id: string, value: Record<string, unknown>) => {
      patches.push({ id, value });
      if (purchase?._id === id) Object.assign(purchase, value);
      if (settings?._id === id) Object.assign(settings, value);
    }),
  };
  return { ctx: { db }, db, patches, purchase, settings };
};

const invoke = async (
  ctx: ReturnType<typeof makeContext>["ctx"],
  overrides: Partial<{
    purchaseKey: string;
    userId: string;
    originalGrantPoints: number;
    cumulativeRefundUsdCents: number;
    targetRevokedPoints: number;
  }> = {},
) => {
  const { revokeCreditsForRefund } = await import("../extraUsage");
  return (revokeCreditsForRefund as any).handler(ctx, {
    serviceKey: "service-key",
    purchaseKey: "ls_order-1",
    userId: "user-1",
    originalGrantPoints: 525_000,
    cumulativeRefundUsdCents: 6_000,
    targetRevokedPoints: 525_000,
    ...overrides,
  });
};

describe("revokeCreditsForRefund", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("removes an unspent full refund without changing historical usage", async () => {
    const purchase: PurchaseRow = {
      _id: "purchase-1",
      session_key: "ls_order-1",
      processed_at: 1,
      user_id: "user-1",
      credited_points: 525_000,
    };
    const settings: ExtraUsageRow = {
      _id: "settings-1",
      user_id: "user-1",
      balance_points: 600_000,
      credit_debt_points: 0,
      monthly_spent_points: 123_000,
      updated_at: 1,
    };
    const { ctx } = makeContext({ purchase, settings });

    await expect(invoke(ctx)).resolves.toMatchObject({
      alreadyProcessed: false,
      accountFound: true,
      revokedPoints: 525_000,
      totalRevokedPoints: 525_000,
      newBalancePoints: 75_000,
      debtPoints: 0,
    });
    expect(settings).toMatchObject({
      balance_points: 75_000,
      credit_debt_points: 0,
      monthly_spent_points: 123_000,
    });
    expect(purchase).toMatchObject({
      user_id: "user-1",
      credited_points: 525_000,
      refunded_usd_cents: 6_000,
      revoked_points: 525_000,
    });
  });

  it("moves already-spent refunded credits into debt and never makes balance negative", async () => {
    const purchase: PurchaseRow = {
      _id: "purchase-1",
      session_key: "ls_order-1",
      processed_at: 1,
      user_id: "user-1",
      credited_points: 525_000,
    };
    const settings: ExtraUsageRow = {
      _id: "settings-1",
      user_id: "user-1",
      balance_points: 100_000,
      credit_debt_points: 25_000,
      updated_at: 1,
    };
    const { ctx } = makeContext({ purchase, settings });

    await expect(invoke(ctx)).resolves.toMatchObject({
      revokedPoints: 525_000,
      newBalancePoints: 0,
      debtPoints: 450_000,
    });
    expect(settings).toMatchObject({
      balance_points: 0,
      credit_debt_points: 450_000,
    });
  });

  it("applies only the increasing cumulative delta and ignores duplicate or stale events", async () => {
    const purchase: PurchaseRow = {
      _id: "purchase-1",
      session_key: "ls_order-1",
      processed_at: 1,
      user_id: "user-1",
      credited_points: 525_000,
    };
    const settings: ExtraUsageRow = {
      _id: "settings-1",
      user_id: "user-1",
      balance_points: 525_000,
      updated_at: 1,
    };
    const { ctx } = makeContext({ purchase, settings });

    await expect(
      invoke(ctx, {
        cumulativeRefundUsdCents: 600,
        targetRevokedPoints: 75_000,
      }),
    ).resolves.toMatchObject({
      alreadyProcessed: false,
      revokedPoints: 75_000,
      newBalancePoints: 450_000,
    });
    await expect(
      invoke(ctx, {
        cumulativeRefundUsdCents: 1_200,
        targetRevokedPoints: 125_000,
      }),
    ).resolves.toMatchObject({
      alreadyProcessed: false,
      revokedPoints: 50_000,
      newBalancePoints: 400_000,
    });
    await expect(
      invoke(ctx, {
        cumulativeRefundUsdCents: 600,
        targetRevokedPoints: 75_000,
      }),
    ).resolves.toMatchObject({
      alreadyProcessed: true,
      revokedPoints: 0,
      totalRevokedPoints: 125_000,
      newBalancePoints: 400_000,
    });
    await expect(
      invoke(ctx, {
        cumulativeRefundUsdCents: 1_200,
        targetRevokedPoints: 125_000,
      }),
    ).resolves.toMatchObject({
      alreadyProcessed: true,
      revokedPoints: 0,
    });
    expect(settings.balance_points).toBe(400_000);
    expect(purchase).toMatchObject({
      refunded_usd_cents: 1_200,
      revoked_points: 125_000,
    });
  });

  it("normalizes a legacy negative balance into debt before adding the refund shortfall", async () => {
    const purchase: PurchaseRow = {
      _id: "purchase-1",
      session_key: "ls_order-1",
      processed_at: 1,
      user_id: "user-1",
      credited_points: 525_000,
    };
    const settings: ExtraUsageRow = {
      _id: "settings-1",
      user_id: "user-1",
      balance_points: -25_000,
      credit_debt_points: 10_000,
      updated_at: 1,
    };
    const { ctx } = makeContext({ purchase, settings });

    await expect(
      invoke(ctx, {
        cumulativeRefundUsdCents: 600,
        targetRevokedPoints: 50_000,
      }),
    ).resolves.toMatchObject({
      newBalancePoints: 0,
      debtPoints: 85_000,
    });
    expect(settings).toMatchObject({
      balance_points: 0,
      credit_debt_points: 85_000,
    });
  });

  it("backfills purchase provenance for legacy durable idempotency rows", async () => {
    const purchase: PurchaseRow = {
      _id: "purchase-1",
      session_key: "ls_order-1",
      processed_at: 1,
    };
    const settings: ExtraUsageRow = {
      _id: "settings-1",
      user_id: "user-1",
      balance_points: 525_000,
      updated_at: 1,
    };
    const { ctx } = makeContext({ purchase, settings });

    await expect(
      invoke(ctx, {
        cumulativeRefundUsdCents: 600,
        targetRevokedPoints: 75_000,
      }),
    ).resolves.toMatchObject({ revokedPoints: 75_000 });
    expect(purchase).toMatchObject({
      user_id: "user-1",
      credited_points: 525_000,
      refunded_usd_cents: 600,
      revoked_points: 75_000,
    });
  });

  it("uses stored purchase ownership when custom webhook data is absent", async () => {
    const purchase: PurchaseRow = {
      _id: "purchase-1",
      session_key: "ls_order-1",
      processed_at: 1,
      user_id: "user-1",
      credited_points: 525_000,
    };
    const settings: ExtraUsageRow = {
      _id: "settings-1",
      user_id: "user-1",
      balance_points: 525_000,
      updated_at: 1,
    };
    const { ctx } = makeContext({ purchase, settings });

    await expect(
      invoke(ctx, {
        userId: undefined,
        cumulativeRefundUsdCents: 600,
        targetRevokedPoints: 75_000,
      }),
    ).resolves.toMatchObject({ revokedPoints: 75_000 });
  });

  it("advances the refund watermark without creating debt after account deletion", async () => {
    const purchase: PurchaseRow = {
      _id: "purchase-1",
      session_key: "ls_order-1",
      processed_at: 1,
      user_id: "user-1",
      credited_points: 525_000,
    };
    const { ctx } = makeContext({ purchase, settings: null });

    await expect(invoke(ctx)).resolves.toMatchObject({
      alreadyProcessed: false,
      accountFound: false,
      revokedPoints: 525_000,
      newBalancePoints: 0,
      debtPoints: 0,
    });
    expect(purchase).toMatchObject({
      refunded_usd_cents: 6_000,
      revoked_points: 525_000,
    });
  });

  it.each([
    [
      "missing purchase",
      null,
      null,
      {},
      "Credited LemonSqueezy purchase not found",
    ],
    [
      "user mismatch",
      {
        _id: "purchase-1",
        session_key: "ls_order-1",
        processed_at: 1,
        user_id: "another-user",
        credited_points: 525_000,
      },
      null,
      {},
      "LemonSqueezy purchase user mismatch",
    ],
    [
      "grant mismatch",
      {
        _id: "purchase-1",
        session_key: "ls_order-1",
        processed_at: 1,
        user_id: "user-1",
        credited_points: 500_000,
      },
      null,
      {},
      "LemonSqueezy purchase grant mismatch",
    ],
    [
      "regressed target",
      {
        _id: "purchase-1",
        session_key: "ls_order-1",
        processed_at: 1,
        user_id: "user-1",
        credited_points: 525_000,
        refunded_usd_cents: 600,
        revoked_points: 75_000,
      },
      null,
      { cumulativeRefundUsdCents: 1_200, targetRevokedPoints: 70_000 },
      "LemonSqueezy cumulative refund regressed",
    ],
  ])(
    "fails closed on %s",
    async (_label, purchase, settings, overrides, message) => {
      const { ctx, db } = makeContext({
        purchase: purchase as PurchaseRow | null,
        settings: settings as ExtraUsageRow | null,
      });

      await expect(invoke(ctx, overrides)).rejects.toThrow(message as string);
      expect(db.patch).not.toHaveBeenCalled();
    },
  );
});
