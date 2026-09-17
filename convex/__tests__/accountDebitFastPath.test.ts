import { getFunctionName } from "convex/server";

jest.mock("../_generated/server", () => ({
  mutation: (config: unknown) => config,
  internalMutation: (config: unknown) => config,
  query: (config: unknown) => config,
  internalQuery: (config: unknown) => config,
  action: (config: unknown) => config,
}));
jest.mock("../lib/logger", () => ({
  convexLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../unitEconomicsLib", () => ({
  recordRevenueEventInternal: jest.fn(),
}));
const mockSubscription = jest.fn();
jest.mock("../subscriptions", () => ({
  activeSubscriptionForUser: (...args: unknown[]) => mockSubscription(...args),
}));

const SERVICE = "isolated-test-key";
const NOW = Date.parse("2026-09-11T12:00:00Z");
const base = {
  serviceKey: SERVICE,
  userId: "owner",
  subscription: "pro" as const,
  amountPoints: 100,
};
const row = (patch: Record<string, unknown> = {}) => ({
  _id: "ledger",
  user_id: "owner",
  balance_points: 1000,
  monthly_granted_points: 500_000,
  monthly_granted_used_points: 0,
  monthly_granted_reset_date: "2026-09",
  monthly_reset_date: "2026-09",
  monthly_spent_points: 0,
  monthly_granted_resets_at: "2026-10-03T00:00:00Z",
  updated_at: 0,
  ...patch,
});
type Row = Record<string, any>;
function fixture(initial: Row | null) {
  const tables: Record<string, Row[]> = {
    extra_usage: initial ? [{ ...initial }] : [],
    user_customization: [],
    processed_credit_refunds: [],
  };
  const db = {
    query: jest.fn((table: string) => ({
      withIndex: (_index: string, predicate: (q: any) => unknown) => {
        const matches: Record<string, unknown> = {};
        const q = {
          eq: (field: string, value: unknown) => {
            matches[field] = value;
            return q;
          },
        };
        predicate(q);
        const read = async () =>
          tables[table]?.find((r) =>
            Object.entries(matches).every(([key, value]) => r[key] === value),
          ) ?? null;
        return { first: read, unique: read };
      },
    })),
    patch: jest.fn(async (id: string, patch: Row) => {
      const found = Object.values(tables)
        .flat()
        .find((r) => r._id === id);
      if (!found) throw new Error("missing row");
      Object.assign(found, patch);
    }),
    insert: jest.fn(async (table: string, value: Row) => {
      const next = { _id: `${table}-${tables[table]?.length ?? 0}`, ...value };
      (tables[table] ??= []).push(next);
      return next._id;
    }),
  };
  return { ctx: { db }, tables };
}
async function handlers() {
  const ledger = await import("../extraUsage");
  const action = await import("../extraUsageActions");
  return {
    fast: (ledger as any).deductPlanCreditsWithoutAutoReload?.handler,
    old: (action.deductWithAutoReload as any).handler,
    query: (ledger.getExtraUsageBalanceForBackend as any).handler,
    deduct: (ledger.deductPoints as any).handler,
    refund: (ledger.refundPlanCreditDeduction as any).handler,
  };
}
async function oldDebit(
  context: ReturnType<typeof fixture>,
  args: typeof base & { allowDebt?: boolean },
) {
  const h = await handlers();
  const ctx = {
    runQuery: jest.fn(async (ref: any, input: any) => {
      expect(getFunctionName(ref)).toBe(
        "extraUsage:getExtraUsageBalanceForBackend",
      );
      return h.query(context.ctx, input);
    }),
    runMutation: jest.fn(async (ref: any, input: any) => {
      expect(getFunctionName(ref)).toBe("extraUsage:deductPoints");
      return h.deduct(context.ctx, input);
    }),
  };
  return h.old(ctx, { ...args, allowAutoReload: false });
}
const originalService = process.env.CONVEX_SERVICE_ROLE_KEY;
beforeEach(() => {
  process.env.CONVEX_SERVICE_ROLE_KEY = SERVICE;
  jest.useFakeTimers().setSystemTime(NOW);
  mockSubscription.mockReset().mockResolvedValue({
    tier: "pro",
    ls_subscription_id: "sub-paid",
    renews_at: "2026-10-04T00:00:00Z",
  });
});
afterEach(() => {
  jest.useRealTimers();
  if (originalService === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
  else process.env.CONVEX_SERVICE_ROLE_KEY = originalService;
});

it.each([
  ["included", row(), 100],
  ["split", row({ monthly_granted_used_points: 499_950 }), 100],
  ["purchased", row({ monthly_granted_used_points: 500_000 }), 100],
  [
    "insufficient",
    row({ monthly_granted_used_points: 500_000, balance_points: 10 }),
    100,
  ],
  [
    "monthly cap",
    row({ monthly_granted_used_points: 499_950, monthly_cap_points: 49 }),
    100,
  ],
  ["included bypasses addon cap", row({ monthly_cap_points: 0 }), 100],
  ["existing debt", row({ credit_debt_points: 5 }), 100],
  ["revoked", row({ monthly_granted_points: 0, balance_points: 0 }), 100],
  ["zero", row({ credit_debt_points: 5, monthly_granted_points: 0 }), 0],
  ["negative", row(), -1],
  ["missing account", null, 100],
  ["fractional", row(), 1.5],
  [
    "autoreload enabled but not allowed",
    row({
      auto_reload_enabled: true,
      auto_reload_threshold_points: 999999,
      auto_reload_amount_dollars: 20,
    }),
    100,
  ],
] as const)(
  "matches the real action(false) result and ledger state: %s",
  async (_name, initial, amountPoints) => {
    const old = fixture(initial),
      fast = fixture(initial);
    const args = { ...base, amountPoints };
    const expected = await oldDebit(old, args);
    const actual = await (await handlers()).fast(fast.ctx, args);
    expect(actual).toEqual(expected);
    expect(fast.tables).toEqual(old.tables);
    if (amountPoints <= 0) {
      expect(fast.ctx.db.query).not.toHaveBeenCalled();
      expect(fast.ctx.db.patch).not.toHaveBeenCalled();
    }
  },
);

it.each(["admin_grant_test", "sub-paid"])(
  "preserves %s cycle rollover and reset metadata",
  async (provider) => {
    mockSubscription.mockResolvedValue({
      tier: "pro",
      ls_subscription_id: provider,
      renews_at: "2026-10-04T00:00:00Z",
    });
    const initial = row({
      monthly_granted_used_points: 500_000,
      monthly_granted_reset_date: "2026-08",
      monthly_reset_date: "2026-08",
      monthly_spent_points: 900,
      monthly_granted_resets_at: undefined,
    });
    const old = fixture(initial),
      fast = fixture(initial);
    const expected = await oldDebit(old, base);
    expect(await (await handlers()).fast(fast.ctx, base)).toEqual(expected);
    expect(fast.tables).toEqual(old.tables);
    expect(expected.includedResetAt).toBe(
      provider === "admin_grant_test"
        ? "2026-10-01T00:00:00.000Z"
        : "2026-10-04T00:00:00Z",
    );
  },
);

it("preserves allowDebt post-stream true-up without purchases", async () => {
  const initial = row({
    monthly_granted_used_points: 500_000,
    balance_points: 10,
  });
  const old = fixture(initial),
    fast = fixture(initial);
  const args = { ...base, allowDebt: true };
  const expected = await oldDebit(old, args);
  expect(await (await handlers()).fast(fast.ctx, args)).toEqual(expected);
  expect(expected).toMatchObject({
    success: false,
    purchasedPointsDeducted: 10,
    debtPoints: 90,
  });
  expect(fast.tables).toEqual(old.tables);
});

it("refunds a fast debit to exactly the original sources once", async () => {
  const f = fixture(row({ monthly_granted_used_points: 499_950 }));
  const h = await handlers();
  const debit = await h.fast(f.ctx, base);
  const args = {
    serviceKey: SERVICE,
    userId: "owner",
    refundKey: "refund-one",
    includedPoints: debit.includedPointsDeducted,
    purchasedPoints: debit.purchasedPointsDeducted,
  };
  expect(debit).toMatchObject({
    includedPointsDeducted: 50,
    purchasedPointsDeducted: 50,
  });
  await h.refund(f.ctx, args);
  const once = JSON.stringify(f.tables);
  await h.refund(f.ctx, args);
  expect(JSON.stringify(f.tables)).toBe(once);
  expect(f.tables.extra_usage[0]).toMatchObject({
    balance_points: 1000,
    monthly_granted_used_points: 499_950,
    monthly_spent_points: 0,
  });
});

it.each([100, 0, -1])(
  "matches authority rejection before reads for amount %s",
  async (amountPoints) => {
    const f = fixture(row());
    const args = { ...base, amountPoints, serviceKey: "wrong" };
    await expect(oldDebit(f, args)).rejects.toThrow(/Invalid service key/i);
    await expect((await handlers()).fast(f.ctx, args)).rejects.toThrow(
      /Invalid service key/i,
    );
    expect(f.ctx.db.query).not.toHaveBeenCalled();
    expect(f.ctx.db.patch).not.toHaveBeenCalled();
  },
);

it("preserves historical Max allowance reconciliation at the 1.8M ceiling", async () => {
  const initial = row({
    monthly_granted_points: 2_000_000,
    monthly_granted_used_points: 1_790_000,
    balance_points: 50_000,
  });
  const old = fixture(initial),
    fast = fixture(initial);
  const args = { ...base, subscription: "ultra" as any, amountPoints: 25_000 };
  const expected = await oldDebit(old, args);
  const actual = await (await handlers()).fast(fast.ctx, args);
  expect(actual).toEqual(expected);
  expect(fast.tables).toEqual(old.tables);
  expect(actual).toMatchObject({
    includedTotalPoints: 1_800_000,
    includedPointsDeducted: 10_000,
    purchasedPointsDeducted: 15_000,
  });
  expect(fast.tables.extra_usage[0].monthly_granted_points).toBe(1_800_000);
});

it("does not suppress a transactional write failure", async () => {
  const f = fixture(row());
  const failure = new Error("write failed");
  f.ctx.db.patch.mockRejectedValueOnce(failure);
  await expect((await handlers()).fast(f.ctx, base)).rejects.toBe(failure);
  expect(f.ctx.db.patch).toHaveBeenCalledTimes(1);
});

it("re-evaluates debit rules after a concurrent transaction conflict", async () => {
  // Deterministic OCC fixture: both calls initially read revision0; only one
  // snapshot commits, and the loser reruns the same handler on committed state.
  // This exercises the handler under conflicts, not a live Convex deployment.
  let committed = fixture(
    row({ monthly_granted_used_points: 500_000, balance_points: 150 }),
  ).tables;
  let revision = 0;
  let retries = 0;
  const h = await handlers();
  const transaction = async () => {
    for (;;) {
      const before = revision;
      const f = fixture(null);
      Object.assign(f.tables, JSON.parse(JSON.stringify(committed)));
      const result = await h.fast(f.ctx, base);
      if (before !== revision) {
        retries++;
        continue;
      }
      committed = f.tables;
      revision++;
      return result;
    }
  };
  const results = await Promise.all([transaction(), transaction()]);
  expect(retries).toBe(1);
  expect(results.filter((result) => result.success)).toHaveLength(1);
  expect(results.filter((result) => !result.success)[0]).toMatchObject({
    insufficientFunds: true,
    includedPointsDeducted: 0,
    purchasedPointsDeducted: 0,
  });
  expect(committed.extra_usage[0].balance_points).toBe(50);
});
