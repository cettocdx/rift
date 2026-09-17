import { webcrypto, createHash } from "node:crypto";
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
    account_credit_reservations: [],
    processed_checkout_sessions: [],
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
        return {
          first: read,
          unique: async () => {
            const found =
              tables[table]?.filter((r) =>
                Object.entries(matches).every(
                  ([key, value]) => r[key] === value,
                ),
              ) ?? [];
            if (found.length > 1) throw new Error("Duplicate indexed rows");
            return found[0] ?? null;
          },
        };
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

  return {
    settle: (ledger as any).settleAccountCreditReservation?.handler,
    fast: (ledger as any).deductPlanCreditsWithoutAutoReload?.handler,
    reserve: (ledger as any).reserveAccountCredits?.handler,
    close: (ledger as any).closeAccountCreditReservation?.handler,
    startUse: (ledger as any).startAccountCreditReservationUse?.handler,

    query: (ledger.getExtraUsageBalanceForBackend as any).handler,
    deduct: (ledger.deductPoints as any).handler,
    refund: (ledger.refundPlanCreditDeduction as any).handler,
    grant: (ledger.grantMonthlyAllowance as any).handler,
    migrate: (ledger.migrateLegacyIncludedUsage as any).handler,
    refundPoints: (ledger.refundPoints as any).handler,
    revoke: (ledger.revokeCreditsForRefund as any).handler,
  };
}
const originalService = process.env.CONVEX_SERVICE_ROLE_KEY;
beforeEach(() => {
  process.env.CONVEX_SERVICE_ROLE_KEY = SERVICE;
  jest.useFakeTimers().setSystemTime(NOW);
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
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

const reservation = { ...base, reservationKey: "agent:run-offline:preflight" };

const knownUsage = {
  status: "known" as const,
  source: "provider" as const,
  model: "offline-model",
  inputTokens: 10,
  outputTokens: 20,
  modelCostDollars: 0.001,
  nonModelCostDollars: 0,
};
function terminal(actualPoints: number | null = 75, usage: any = knownUsage) {
  const input = {
    revision: 1,
    pricingVersion: "account-credit-v1",
    actualPoints,
    usage,
  };
  // The API's canonical digest deliberately ignores object insertion order.
  const canonicalUsage =
    usage.status === "known"
      ? {
          status: usage.status,
          source: usage.source,
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          modelCostDollars: usage.modelCostDollars,
          nonModelCostDollars: usage.nonModelCostDollars,
        }
      : { status: usage.status, reason: usage.reason };
  return {
    ...reservation,
    ...input,
    usageDigest: createHash("sha256")
      .update(
        JSON.stringify({
          reservationKey: reservation.reservationKey,
          userId: reservation.userId,
          amountPoints: reservation.amountPoints,
          subscription: reservation.subscription,
          revision: 1,
          pricingVersion: input.pricingVersion,
          actualPoints,
          usage: canonicalUsage,
        }),
      )
      .digest("hex"),
  };
}
async function prepared(patch: Row = {}) {
  const f = fixture(row({ monthly_granted_used_points: 499_950, ...patch }));
  const h = await handlers();
  await h.reserve(f.ctx, reservation);
  expect(await h.startUse(f.ctx, reservation)).toEqual({
    state: "in_use",
    newlyGranted: true,
  });
  return { ...f, h };
}
it("settles negative adjustment from the stored purchased source and replays exactly", async () => {
  const f = await prepared();
  const result = await f.h.settle(f.ctx, terminal());
  expect(result).toMatchObject({
    state: "settled",
    receipt: {
      actualPoints: 75,
      adjustmentPoints: -25,
      includedPoints: 50,
      purchasedPoints: 25,
      debtPointsAdded: 0,
      purchasedPointsRefunded: 25,
      includedPointsRefunded: 0,
    },
  });
  expect(f.tables.extra_usage[0]).toMatchObject({
    balance_points: 975,
    monthly_granted_used_points: 500_000,
    monthly_spent_points: 25,
  });
  const after = JSON.stringify(f.tables);
  expect(await f.h.settle(f.ctx, terminal())).toEqual(result);
  expect(JSON.stringify(f.tables)).toBe(after);
  expect(await f.h.reserve(f.ctx, reservation)).toEqual({ state: "settled" });
  expect(await f.h.startUse(f.ctx, reservation)).toEqual({
    state: "settled",
    newlyGranted: false,
  });
  expect(await f.h.close(f.ctx, reservation)).toEqual({ state: "unresolved" });
  expect(JSON.stringify(f.tables)).toBe(after);
});
it("restores purchased then included for a terminal zero cost without authorizing reuse", async () => {
  const f = await prepared();
  expect(await f.h.settle(f.ctx, terminal(0))).toMatchObject({
    state: "settled",
    receipt: {
      includedPoints: 0,
      purchasedPoints: 0,
      includedPointsRefunded: 50,
      purchasedPointsRefunded: 50,
    },
  });
  expect(f.tables.extra_usage[0]).toMatchObject({
    balance_points: 1000,
    monthly_granted_used_points: 499_950,
    monthly_spent_points: 0,
  });
});
it("records positive usage beyond monthly purchased cap as attributable debt", async () => {
  const f = await prepared({ monthly_cap_points: 60 });
  const result = await f.h.settle(f.ctx, terminal(175));
  expect(result).toMatchObject({
    state: "settled",
    receipt: {
      actualPoints: 175,
      adjustmentPoints: 75,
      includedPoints: 50,
      purchasedPoints: 60,
      debtPointsAdded: 65,
    },
  });
  expect(f.tables.extra_usage[0]).toMatchObject({
    balance_points: 940,
    monthly_spent_points: 60,
    credit_debt_points: 65,
  });
  expect((await f.h.fast(f.ctx, base)).success).toBe(false);
});
it("uses included points before purchased credits for positive settlement", async () => {
  const f = await prepared({ monthly_granted_used_points: 0 });
  expect(await f.h.settle(f.ctx, terminal(175))).toMatchObject({
    state: "settled",
    receipt: {
      includedPoints: 175,
      purchasedPoints: 0,
      debtPointsAdded: 0,
    },
  });
  expect(f.tables.extra_usage[0]).toMatchObject({
    balance_points: 1000,
    monthly_granted_used_points: 175,
  });
});
it("records exhaustion as debt even when no credits remain", async () => {
  const f = await prepared({ balance_points: 50 });
  expect(await f.h.settle(f.ctx, terminal(150))).toMatchObject({
    state: "settled",
    receipt: { debtPointsAdded: 50 },
  });
  expect(f.tables.extra_usage[0]).toMatchObject({
    balance_points: 0,
    credit_debt_points: 50,
  });
});
it("settles equal actual cost without a second debit", async () => {
  const f = await prepared();
  const before = { ...f.tables.extra_usage[0] };
  expect(await f.h.settle(f.ctx, terminal(100))).toMatchObject({
    state: "settled",
    receipt: { adjustmentPoints: 0 },
  });
  expect(f.tables.extra_usage[0]).toEqual(before);
});
it("recovers a committed settlement response loss without another adjustment", async () => {
  const f = await prepared();
  const lost = async () => {
    await f.h.settle(f.ctx, terminal(175));
    throw new Error("lost");
  };
  await expect(lost()).rejects.toThrow("lost");
  const after = JSON.stringify(f.tables);
  expect(await f.h.settle(f.ctx, terminal(175))).toMatchObject({
    state: "settled",
  });
  expect(JSON.stringify(f.tables)).toBe(after);
});
it.each([
  { userId: "other" },
  { amountPoints: 101 },
  { subscription: "ultra" },
  { revision: 2 },
  { usageDigest: "0".repeat(64) },
  { pricingVersion: "unknown" },
])(
  "rejects binding, revision or digest change %j without writes",
  async (change) => {
    const f = await prepared();
    const before = JSON.stringify(f.tables);
    await expect(
      f.h.settle(f.ctx, { ...terminal(), ...change }),
    ).rejects.toThrow();
    expect(JSON.stringify(f.tables)).toBe(before);
  },
);
it("rejects changed final points or evidence even with a new internally consistent digest", async () => {
  const f = await prepared();
  await f.h.settle(f.ctx, terminal());
  const before = JSON.stringify(f.tables);
  await expect(f.h.settle(f.ctx, terminal(80))).rejects.toThrow("immutable");
  await expect(
    f.h.settle(f.ctx, terminal(75, { ...knownUsage, outputTokens: 21 })),
  ).rejects.toThrow("immutable");
  expect(JSON.stringify(f.tables)).toBe(before);
});
it.each(["closed", "reserved", "denied"])(
  "cannot settle a %s reservation",
  async (state) => {
    const f = fixture(row());
    const h = await handlers();
    if (state === "closed") await h.close(f.ctx, reservation);
    else {
      await h.reserve(f.ctx, reservation);
      if (state === "denied")
        f.tables.account_credit_reservations[0].state = state;
    }
    const before = JSON.stringify(f.tables);
    await expect(h.settle(f.ctx, terminal())).rejects.toThrow("not in use");
    expect(JSON.stringify(f.tables)).toBe(before);
  },
);
it("unknown usage cannot finalize as zero, and durably blocks admission", async () => {
  const f = await prepared();
  const before = { ...f.tables.extra_usage[0] };
  const args = terminal(null, { status: "unknown", reason: "missing_usage" });
  const result = await f.h.settle(f.ctx, args);
  expect(result).toEqual({
    state: "reconciliation_required",
    reason: "unknown_usage",
  });
  expect(f.tables.extra_usage[0]).toEqual(before);
  expect(await f.h.settle(f.ctx, args)).toEqual(result);
  expect(await f.h.reserve(f.ctx, reservation)).toEqual({
    state: "reconciliation_required",
  });
  await expect(f.h.settle(f.ctx, terminal(0))).rejects.toThrow("immutable");
});
it("a generation change leaves positive and negative adjustments unresolved", async () => {
  for (const actual of [75, 175]) {
    const f = await prepared();
    await f.h.grant(f.ctx, {
      serviceKey: SERVICE,
      userId: "owner",
      allowancePoints: 0,
    });
    const before = { ...f.tables.extra_usage[0] };
    expect(await f.h.settle(f.ctx, terminal(actual))).toEqual({
      state: "reconciliation_required",
      reason: "source_changed",
    });
    expect(f.tables.extra_usage[0]).toEqual(before);
    expect((await f.h.startUse(f.ctx, reservation)).newlyGranted).toBe(false);
  }
});
it("independent keyed close and settlement preserve each other's allocations", async () => {
  const f = await prepared();
  const other = { ...reservation, reservationKey: "other" };
  await f.h.reserve(f.ctx, other);
  await f.h.settle(f.ctx, terminal(75));
  expect(await f.h.close(f.ctx, other)).toEqual({ state: "closed" });
  expect(f.tables.extra_usage[0]).toMatchObject({
    balance_points: 975,
    monthly_spent_points: 25,
    monthly_granted_used_points: 500_000,
  });
});
it("requires service authentication before settlement", async () => {
  const f = await prepared();
  const before = JSON.stringify(f.tables);
  await expect(
    f.h.settle(f.ctx, { ...terminal(), serviceKey: "wrong" }),
  ).rejects.toThrow();
  expect(JSON.stringify(f.tables)).toBe(before);
});
it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
  "rejects invalid actual points %s",
  async (actual) => {
    const f = await prepared();
    const before = JSON.stringify(f.tables);
    await expect(f.h.settle(f.ctx, terminal(actual))).rejects.toThrow();
    expect(JSON.stringify(f.tables)).toBe(before);
  },
);
it("rejects arithmetic overflow before any write", async () => {
  const f = await prepared();
  f.tables.extra_usage[0].credit_debt_points = Number.MAX_SAFE_INTEGER;
  f.tables.extra_usage[0].balance_points = 0;
  const before = JSON.stringify(f.tables);
  await expect(f.h.settle(f.ctx, terminal(200))).rejects.toThrow("arithmetic");
  expect(JSON.stringify(f.tables)).toBe(before);
});
it("replays the committed receipt even after later account changes", async () => {
  const f = await prepared();
  const first = await f.h.settle(f.ctx, terminal(175));
  await f.h.grant(f.ctx, {
    serviceKey: SERVICE,
    userId: "owner",
    allowancePoints: 0,
  });
  const before = JSON.stringify(f.tables);
  expect(await f.h.settle(f.ctx, terminal(175))).toEqual(first);
  expect(JSON.stringify(f.tables)).toBe(before);
});
it.each([
  { inputTokens: -1 },
  { outputTokens: Infinity },
  { modelCostDollars: NaN },
  { nonModelCostDollars: -0.01 },
  { model: "" },
  { source: "request_body" },
])("rejects invalid service usage evidence %j", async (change) => {
  const f = await prepared();
  const before = JSON.stringify(f.tables);
  await expect(
    f.h.settle(f.ctx, terminal(75, { ...knownUsage, ...change })),
  ).rejects.toThrow();
  expect(JSON.stringify(f.tables)).toBe(before);
});
it("rejects known-null and unknown-zero without sealing either as a settlement", async () => {
  const f = await prepared();
  const before = JSON.stringify(f.tables);
  await expect(f.h.settle(f.ctx, terminal(null))).rejects.toThrow();
  await expect(
    f.h.settle(
      f.ctx,
      terminal(0, { status: "unknown", reason: "missing_usage" }),
    ),
  ).rejects.toThrow();
  expect(JSON.stringify(f.tables)).toBe(before);
});
it("requires a unique reservation and a unique ledger row", async () => {
  for (const table of ["account_credit_reservations", "extra_usage"]) {
    const f = await prepared();
    f.tables[table].push({ ...f.tables[table][0], _id: "duplicate" });
    const before = JSON.stringify(f.tables);
    await expect(f.h.settle(f.ctx, terminal())).rejects.toThrow("Duplicate");
    expect(JSON.stringify(f.tables)).toBe(before);
  }
});
it("a replaced ledger cannot settle an old receipt", async () => {
  const f = await prepared();
  f.tables.extra_usage[0]._id = "replacement";
  const before = { ...f.tables.extra_usage[0] };
  expect(await f.h.settle(f.ctx, terminal())).toEqual({
    state: "reconciliation_required",
    reason: "source_changed",
  });
  expect(f.tables.extra_usage[0]).toEqual(before);
});
it("keeps zero-cost reservations without an original ledger unresolved", async () => {
  const f = fixture(null);
  const h = await handlers();
  const bound = { ...reservation, amountPoints: 0 };
  await h.reserve(f.ctx, bound);
  await h.startUse(f.ctx, bound);
  const args = { ...terminal(0), amountPoints: 0 };
  const canonical = {
    reservationKey: args.reservationKey,
    userId: args.userId,
    amountPoints: 0,
    subscription: args.subscription,
    revision: 1,
    pricingVersion: args.pricingVersion,
    actualPoints: 0,
    usage: knownUsage,
  };
  args.usageDigest = createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
  expect(await h.settle(f.ctx, args)).toEqual({
    state: "reconciliation_required",
    reason: "source_changed",
  });
  expect(f.tables.extra_usage).toHaveLength(0);
});
it.each([
  "balance_points",
  "monthly_granted_used_points",
  "monthly_spent_points",
  "credit_debt_points",
  "monthly_cap_points",
])("rejects malformed ledger arithmetic %s", async (field) => {
  const f = await prepared();
  f.tables.extra_usage[0][field] = 0.5;
  const before = JSON.stringify(f.tables);
  await expect(f.h.settle(f.ctx, terminal(175))).rejects.toThrow("arithmetic");
  expect(JSON.stringify(f.tables)).toBe(before);
});
it("zero cap headroom creates debt rather than violating the cap", async () => {
  const f = await prepared({ monthly_cap_points: 50 });
  expect(await f.h.settle(f.ctx, terminal(175))).toMatchObject({
    state: "settled",
    receipt: { purchasedPoints: 50, debtPointsAdded: 75 },
  });
  expect(f.tables.extra_usage[0]).toMatchObject({
    monthly_spent_points: 50,
    balance_points: 950,
  });
});
