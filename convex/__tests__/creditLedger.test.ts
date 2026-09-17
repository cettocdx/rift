import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("../_generated/server", () => ({
  mutation: jest.fn((config: unknown) => config),
  internalMutation: jest.fn((config: unknown) => config),
  query: jest.fn((config: unknown) => config),
  internalQuery: jest.fn((config: unknown) => config),
}));

jest.mock("convex/values", () => ({
  v: {
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

jest.mock("../lib/utils", () => ({ validateServiceKey: jest.fn() }));
jest.mock("../lib/logger", () => ({
  convexLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../unitEconomicsLib", () => ({
  recordRevenueEventInternal: jest.fn(),
}));
jest.mock("../subscriptions", () => ({
  activeSubscriptionForUser: jest.fn().mockResolvedValue(null),
}));

type Row = Record<string, unknown> & { _id: string };

function makeContext(initialExtraUsage: Record<string, unknown> | null) {
  const tables: Record<string, Row[]> = {
    extra_usage: initialExtraUsage
      ? [{ _id: "extra-1", ...initialExtraUsage }]
      : [],
    processed_credit_refunds: [],
    processed_checkout_sessions: [],
    processed_webhooks: [],
  };
  let nextId = 1;
  const db = {
    query: jest.fn((table: string) => ({
      withIndex: jest.fn(
        (
          _index: string,
          predicate: (q: {
            eq: (field: string, value: string) => unknown;
          }) => unknown,
        ) => {
          let field = "";
          let value = "";
          predicate({
            eq: (nextField, nextValue) => {
              field = nextField;
              value = nextValue;
              return {};
            },
          });
          return {
            first: async () =>
              (tables[table] ?? []).find((row) => row[field] === value) ?? null,
            unique: async () =>
              (tables[table] ?? []).find((row) => row[field] === value) ?? null,
          };
        },
      ),
    })),
    patch: jest.fn(async (id: string, update: Record<string, unknown>) => {
      for (const rows of Object.values(tables)) {
        const row = rows.find((candidate) => candidate._id === id);
        if (row) Object.assign(row, update);
      }
    }),
    insert: jest.fn(async (table: string, value: Record<string, unknown>) => {
      const row = { _id: `${table}-${nextId++}`, ...value };
      (tables[table] ??= []).push(row);
      return row._id;
    }),
  };
  return { ctx: { db }, tables, db };
}

async function handlers() {
  const extraUsageModule = await import("../extraUsage");
  return {
    deduct: (extraUsageModule.deductPoints as any).handler,
    grant: (extraUsageModule.grantMonthlyAllowance as any).handler,
    migrate: (extraUsageModule.migrateLegacyIncludedUsage as any).handler,
    refund: (extraUsageModule.refundPlanCreditDeduction as any).handler,
  };
}

const baseRow = (overrides: Record<string, unknown> = {}) => ({
  user_id: "user-1",
  balance_points: 0,
  monthly_granted_points: 1_800_000,
  monthly_granted_used_points: 0,
  monthly_granted_cycle_key: "ls_subscription:sub-1:initial",
  monthly_granted_cycle_started_at: "2026-06-20T00:00:00.000Z",
  updated_at: 1,
  ...overrides,
});

describe("single paid account credit ledger", () => {
  beforeEach(() => jest.clearAllMocks());

  it("does not double-reset initial subscription + payment events and resets exactly once per renewal invoice", async () => {
    const { grant } = await handlers();
    const { ctx, tables } = makeContext(
      baseRow({ monthly_granted_used_points: 600_000 }),
    );

    await expect(
      grant(ctx, {
        serviceKey: "service",
        userId: "user-1",
        allowancePoints: 1_800_000,
        cycleKey: "ls_invoice:initial-1",
        resetUsage: false,
      }),
    ).resolves.toEqual({ ok: true, reset: false });
    expect(tables.extra_usage[0].monthly_granted_used_points).toBe(600_000);

    await expect(
      grant(ctx, {
        serviceKey: "service",
        userId: "user-1",
        allowancePoints: 1_800_000,
        cycleKey: "ls_invoice:renewal-2",
        cycleStartedAt: "2026-07-20T00:00:00.000Z",
        resetUsage: true,
      }),
    ).resolves.toEqual({ ok: true, reset: true });
    expect(tables.extra_usage[0].monthly_granted_used_points).toBe(0);

    tables.extra_usage[0].monthly_granted_used_points = 250_000;
    await expect(
      grant(ctx, {
        serviceKey: "service",
        userId: "user-1",
        allowancePoints: 1_800_000,
        cycleKey: "ls_invoice:renewal-2",
        cycleStartedAt: "2026-07-20T00:00:00.000Z",
        resetUsage: true,
      }),
    ).resolves.toEqual({ ok: true, reset: false });
    expect(tables.extra_usage[0].monthly_granted_used_points).toBe(250_000);
  });

  it("does not let a delayed older renewal invoice reset a newer cycle", async () => {
    const { grant } = await handlers();
    const { ctx, tables } = makeContext(
      baseRow({
        monthly_granted_used_points: 420_000,
        monthly_granted_cycle_key: "ls_invoice:newer",
        monthly_granted_cycle_started_at: "2026-07-20T00:00:00.000Z",
      }),
    );

    await expect(
      grant(ctx, {
        serviceKey: "service",
        userId: "user-1",
        allowancePoints: 1_800_000,
        cycleKey: "ls_invoice:older",
        cycleStartedAt: "2026-06-20T00:00:00.000Z",
        resetUsage: true,
      }),
    ).resolves.toEqual({ ok: true, reset: false });
    expect(tables.extra_usage[0]).toMatchObject({
      monthly_granted_used_points: 420_000,
      monthly_granted_cycle_key: "ls_invoice:newer",
      monthly_granted_cycle_started_at: "2026-07-20T00:00:00.000Z",
    });
  });

  it("spends included Max credits before purchased add-ons", async () => {
    const { deduct } = await handlers();
    const { ctx, tables } = makeContext(
      baseRow({
        balance_points: 50_000,
        monthly_granted_used_points: 1_790_000,
        monthly_cap_points: 20_000,
      }),
    );

    await expect(
      deduct(ctx, {
        serviceKey: "service",
        userId: "user-1",
        amountPoints: 25_000,
        includedAllowancePoints: 1_800_000,
      }),
    ).resolves.toMatchObject({
      success: true,
      includedPointsDeducted: 10_000,
      purchasedPointsDeducted: 15_000,
      includedRemainingPoints: 0,
      newBalancePoints: 35_000,
    });
    expect(tables.extra_usage[0]).toMatchObject({
      monthly_granted_used_points: 1_800_000,
      balance_points: 35_000,
      monthly_spent_points: 15_000,
    });
  });

  it("applies the add-on cap only to purchased overflow", async () => {
    const { deduct } = await handlers();
    const { ctx, tables } = makeContext(baseRow({ monthly_cap_points: 0 }));

    await expect(
      deduct(ctx, {
        serviceKey: "service",
        userId: "user-1",
        amountPoints: 100_000,
        includedAllowancePoints: 1_800_000,
      }),
    ).resolves.toMatchObject({
      success: true,
      includedPointsDeducted: 100_000,
      purchasedPointsDeducted: 0,
    });
    expect(tables.extra_usage[0].monthly_spent_points).toBe(0);
  });

  it("never remints an explicitly revoked allowance from a stale tier", async () => {
    const { deduct } = await handlers();
    const { ctx } = makeContext(
      baseRow({ monthly_granted_points: 0, balance_points: 0 }),
    );

    await expect(
      deduct(ctx, {
        serviceKey: "service",
        userId: "user-1",
        amountPoints: 1,
        includedAllowancePoints: 1_800_000,
      }),
    ).resolves.toMatchObject({
      success: false,
      includedTotalPoints: 0,
      includedPointsDeducted: 0,
    });
  });

  it("migrates Redis and duplicate-Convex spend once, clamped at 1.8M", async () => {
    const { migrate } = await handlers();
    const { ctx, tables } = makeContext(
      baseRow({ monthly_granted_used_points: 300_000 }),
    );

    await expect(
      migrate(ctx, {
        serviceKey: "service",
        userId: "user-1",
        allowancePoints: 1_800_000,
        legacyConsumedPoints: 1_700_000,
        migrationKey: "paid-account-ledger-v1",
      }),
    ).resolves.toEqual({
      alreadyMigrated: false,
      usedPoints: 1_800_000,
      remainingPoints: 0,
    });
    await expect(
      migrate(ctx, {
        serviceKey: "service",
        userId: "user-1",
        allowancePoints: 1_800_000,
        legacyConsumedPoints: 1_700_000,
        migrationKey: "paid-account-ledger-v1",
      }),
    ).resolves.toMatchObject({ alreadyMigrated: true, usedPoints: 1_800_000 });
    expect(tables.extra_usage[0].monthly_granted_used_points).toBe(1_800_000);
  });

  it("refunds exact sources once without converting included credits into add-ons", async () => {
    const { refund } = await handlers();
    const { ctx, tables } = makeContext(
      baseRow({
        balance_points: 50_000,
        monthly_granted_used_points: 100_000,
        monthly_spent_points: 20_000,
      }),
    );
    const args = {
      serviceKey: "service",
      userId: "user-1",
      refundKey: "request-1",
      includedPoints: 40_000,
      purchasedPoints: 10_000,
    };

    await expect(refund(ctx, args)).resolves.toMatchObject({
      success: true,
      alreadyProcessed: false,
      includedUsedPoints: 60_000,
      balancePoints: 60_000,
    });
    await expect(refund(ctx, args)).resolves.toMatchObject({
      success: true,
      alreadyProcessed: true,
    });
    expect(tables.extra_usage[0]).toMatchObject({
      monthly_granted_used_points: 60_000,
      balance_points: 60_000,
      monthly_spent_points: 10_000,
    });
  });

  it("settles existing debt from funded balance without refunding it with a new request", async () => {
    const { deduct, refund } = await handlers();
    const { ctx, tables } = makeContext(
      baseRow({
        balance_points: 2_000_000,
        credit_debt_points: 11_404,
        monthly_granted_used_points: 1_800_000,
      }),
    );
    const args = {
      serviceKey: "service",
      userId: "user-1",
      amountPoints: 100,
      includedAllowancePoints: 1_800_000,
    };
    await expect(deduct(ctx, args)).resolves.toMatchObject({
      success: true,
      purchasedPointsDeducted: 100,
      debtPoints: 0,
      newBalancePoints: 1_988_496,
    });
    await expect(
      deduct(ctx, { ...args, amountPoints: 0 }),
    ).resolves.toMatchObject({
      success: true,
      newBalancePoints: 1_988_496,
      debtPoints: 0,
    });
    await refund(ctx, {
      serviceKey: "service",
      userId: "user-1",
      refundKey: "funded-retry",
      includedPoints: 0,
      purchasedPoints: 100,
    });
    expect(tables.extra_usage[0]).toMatchObject({
      balance_points: 1_988_596,
      credit_debt_points: 0,
    });
  });

  it("does not forgive debt when the available balance only partially covers it", async () => {
    const { deduct } = await handlers();
    const { ctx, tables } = makeContext(
      baseRow({
        balance_points: 400,
        credit_debt_points: 1_000,
        monthly_granted_used_points: 1_800_000,
      }),
    );
    await expect(
      deduct(ctx, {
        serviceKey: "service",
        userId: "user-1",
        amountPoints: 100,
        includedAllowancePoints: 1_800_000,
      }),
    ).resolves.toMatchObject({
      success: false,
      purchasedPointsDeducted: 0,
      debtPoints: 600,
    });
    expect(tables.extra_usage[0]).toMatchObject({
      balance_points: 0,
      credit_debt_points: 600,
    });
  });

  it("records post-stream shortfall as debt instead of free output", async () => {
    const { deduct } = await handlers();
    const { ctx, tables } = makeContext(
      baseRow({
        balance_points: 5_000,
        monthly_granted_used_points: 1_800_000,
      }),
    );

    await expect(
      deduct(ctx, {
        serviceKey: "service",
        userId: "user-1",
        amountPoints: 20_000,
        includedAllowancePoints: 1_800_000,
        allowDebt: true,
      }),
    ).resolves.toMatchObject({
      success: false,
      purchasedPointsDeducted: 5_000,
      debtPoints: 15_000,
    });
    expect(tables.extra_usage[0]).toMatchObject({
      balance_points: 0,
      credit_debt_points: 15_000,
    });
  });
});
