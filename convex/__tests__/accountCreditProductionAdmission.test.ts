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
    subscriptions: [
      {
        _id: "sub",
        user_id: "owner",
        tier: "pro",
        status: "active",
        updated_at: NOW,
        ls_subscription_id: "sub-real-fixture",
      },
    ],
    user_suspensions: [],
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
          order() {
            return this;
          },
          collect: async () =>
            tables[table]?.filter((r) =>
              Object.entries(matches).every(([key, value]) => r[key] === value),
            ) ?? [],
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
    productionReserve: (ledger as any).reserveProductionAccountCredits?.handler,
    admit: (ledger as any).admitProductionAccountCreditUse?.handler,
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
});
afterEach(() => {
  jest.useRealTimers();
  if (originalService === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
  else process.env.CONVEX_SERVICE_ROLE_KEY = originalService;
});

const reservation = { ...base, reservationKey: "agent:run-offline:preflight" };

const production = {
  ...reservation,
  binding: {
    version: 1,
    kind: "console_model",
    requestId: "550e8400-e29b-41d4-a716-446655440000",
  },
};
async function reserved(patch: Row = {}) {
  const f = fixture(row({ monthly_granted_used_points: 499950, ...patch }));
  const h = await handlers();
  expect((await h.productionReserve(f.ctx, production)).state).toBe("reserved");
  return { ...f, h };
}
it("admits current real entitlement exactly once and weak firstUse cannot bypass production checks", async () => {
  const f = await reserved();
  await expect(f.h.startUse(f.ctx, reservation)).rejects.toThrow("production");
  expect(await f.h.admit(f.ctx, production)).toEqual({
    state: "in_use",
    newlyGranted: true,
  });
  expect(await f.h.admit(f.ctx, production)).toEqual({
    state: "in_use",
    newlyGranted: false,
  });
});
it("same production binding replays one debit; same amount different keys charge independently", async () => {
  const f = await reserved();
  const before = JSON.stringify(f.tables);
  expect((await f.h.productionReserve(f.ctx, production)).state).toBe(
    "reserved",
  );
  expect(JSON.stringify(f.tables)).toBe(before);
  await f.h.productionReserve(f.ctx, {
    ...production,
    reservationKey: "other",
    binding: {
      ...production.binding,
      requestId: "550e8400-e29b-41d4-a716-446655440001",
    },
  });
  expect(f.tables.extra_usage[0].balance_points).toBe(850);
});
it.each(["paused", "unpaid", "expired"])(
  "known %s entitlement denial closes exact included+purchased sources once",
  async (status) => {
    const f = await reserved();
    f.tables.subscriptions[0].status = status;
    expect(await f.h.admit(f.ctx, production)).toEqual({
      state: "closed",
      newlyGranted: false,
      denialReason: "no_entitlement",
      refund: "confirmed",
    });
    expect(f.tables.extra_usage[0]).toMatchObject({
      balance_points: 1000,
      monthly_granted_used_points: 499950,
      monthly_spent_points: 0,
    });
    const before = JSON.stringify(f.tables);
    await f.h.admit(f.ctx, production);
    expect(JSON.stringify(f.tables)).toBe(before);
    f.tables.subscriptions[0].status = "active";
    expect((await f.h.admit(f.ctx, production)).newlyGranted).toBe(false);
  },
);
it.each(["active", "on_trial", "past_due", "cancelled"])(
  "preserves %s entitlement policy",
  async (status) => {
    const f = await reserved();
    f.tables.subscriptions[0].status = status;
    expect((await f.h.admit(f.ctx, production)).newlyGranted).toBe(true);
  },
);
it("missing entitlement is denied; strongest entitled changed tier is not masked by recent Pro", async () => {
  for (const missing of [true, false]) {
    const f = await reserved();
    f.tables.subscriptions = missing
      ? []
      : [
          ...f.tables.subscriptions,
          {
            _id: "max",
            user_id: "owner",
            tier: "ultra",
            status: "active",
            updated_at: 0,
          },
        ];
    const r = await f.h.admit(f.ctx, production);
    expect(r.denialReason).toBe(missing ? "no_entitlement" : "tier_changed");
    expect(r.refund).toBe("confirmed");
  }
});
it("active suspension added after reserve closes; resolved suspension does not deny", async () => {
  for (const status of ["active", "resolved"]) {
    const f = await reserved();
    f.tables.user_suspensions.push({
      _id: "s",
      user_id: "owner",
      status,
      source_id: "fixture",
      category: "dispute_billing_hold",
    });
    const r = await f.h.admit(f.ctx, production);
    expect(r.newlyGranted).toBe(status === "resolved");
    if (status === "active") expect(r.denialReason).toBe("suspended");
  }
});
it("another reservation debt denies new first use and restores only this reservation", async () => {
  const f = await reserved();
  f.tables.extra_usage[0].credit_debt_points = 75;
  const r = await f.h.admit(f.ctx, production);
  expect(r.denialReason).toBe("outstanding_debt");
  expect(r.refund).toBe("confirmed");
  expect(f.tables.extra_usage[0]).toMatchObject({
    balance_points: 1000,
    credit_debt_points: 75,
  });
});
it("close before admit stays closed; legacy unbound production admission is refused", async () => {
  const f = await reserved();
  await f.h.close(f.ctx, reservation);
  expect(await f.h.admit(f.ctx, production)).toEqual({
    state: "closed",
    newlyGranted: false,
    refund: "confirmed",
  });
  const g = fixture(row());
  await f.h.reserve(g.ctx, reservation);
  await expect(f.h.admit(g.ctx, production)).rejects.toThrow("production");
  await expect(f.h.productionReserve(g.ctx, production)).rejects.toThrow(
    "binding",
  );
  expect((await f.h.startUse(g.ctx, reservation)).newlyGranted).toBe(true);
});
it("generation ABA seals denial without restoring old source", async () => {
  const f = await reserved();
  await f.h.grant(f.ctx, {
    serviceKey: SERVICE,
    userId: "owner",
    allowancePoints: 0,
  });
  await f.h.grant(f.ctx, {
    serviceKey: SERVICE,
    userId: "owner",
    allowancePoints: 500000,
  });
  const before = { ...f.tables.extra_usage[0] };
  const r = await f.h.admit(f.ctx, production);
  expect(r).toEqual({
    state: "reconciliation_required",
    newlyGranted: false,
    denialReason: "source_changed",
    refund: "unresolved",
  });
  expect(f.tables.extra_usage[0]).toEqual(before);
  expect((await f.h.admit(f.ctx, production)).newlyGranted).toBe(false);
});
it.each([
  { userId: "foreign" },
  { amountPoints: 101 },
  { subscription: "ultra" },
  {
    binding: {
      ...production.binding,
      requestId: "550e8400-e29b-41d4-a716-446655440001",
    },
  },
])(
  "rejects conflicting identity %j before changing accounting",
  async (change) => {
    const f = await reserved();
    const before = JSON.stringify(f.tables);
    for (const method of [f.h.productionReserve, f.h.admit])
      await expect(method(f.ctx, { ...production, ...change })).rejects.toThrow(
        "binding",
      );
    expect(JSON.stringify(f.tables)).toBe(before);
  },
);
it.each([
  {
    version: 2,
    kind: "console_model",
    requestId: production.binding.requestId,
  },
  { version: 1, kind: "worker", requestId: production.binding.requestId },
  { ...production.binding, requestId: " " },
  { ...production.binding, requestId: "x".repeat(201) },
])("rejects malformed binding %j before debit", async (binding) => {
  const f = fixture(row());
  const h = await handlers();
  const before = JSON.stringify(f.tables);
  await expect(
    h.productionReserve(f.ctx, { ...production, binding }),
  ).rejects.toThrow();
  expect(JSON.stringify(f.tables)).toBe(before);
});
it("requires service authority and fails closed on duplicate source rows", async () => {
  const f = await reserved();
  const before = JSON.stringify(f.tables);
  await expect(
    f.h.admit(f.ctx, { ...production, serviceKey: "wrong" }),
  ).rejects.toThrow();
  expect(JSON.stringify(f.tables)).toBe(before);
  f.tables.extra_usage.push({ ...f.tables.extra_usage[0], _id: "duplicate" });
  await expect(f.h.admit(f.ctx, production)).rejects.toThrow("Duplicate");
});
it("malformed debt or source arithmetic never becomes a confirmed refund", async () => {
  for (const value of [-1, NaN, 0.5, Infinity]) {
    const f = await reserved();
    f.tables.extra_usage[0].credit_debt_points = value;
    await expect(f.h.admit(f.ctx, production)).rejects.toThrow("arithmetic");
    expect(f.tables.account_credit_reservations[0].state).toBe("reserved");
  }
});
it("lost first admission response replay cannot grant a second provider use", async () => {
  const f = await reserved();
  await f.h.admit(f.ctx, production);
  expect((await f.h.admit(f.ctx, production)).newlyGranted).toBe(false);
  expect(await f.h.close(f.ctx, reservation)).toEqual({ state: "unresolved" });
  expect(f.tables.extra_usage[0].balance_points).toBe(950);
});
it("cancellation before production reserve binds the closed tombstone without debit", async () => {
  const f = fixture(row());
  const h = await handlers();
  await h.close(f.ctx, reservation);
  const before = { ...f.tables.extra_usage[0] };
  expect((await h.productionReserve(f.ctx, production)).state).toBe("closed");
  expect((await h.admit(f.ctx, production)).newlyGranted).toBe(false);
  expect(f.tables.extra_usage[0]).toEqual(before);
});
it("zero-price production request cannot bypass missing or changed ledger lineage", async () => {
  for (const initial of [null, row()]) {
    const f = fixture(initial);
    const h = await handlers();
    const p = { ...production, amountPoints: 0 };
    await h.productionReserve(f.ctx, p);
    if (initial)
      await h.grant(f.ctx, {
        serviceKey: SERVICE,
        userId: "owner",
        allowancePoints: 0,
      });
    expect((await h.admit(f.ctx, p)).newlyGranted).toBe(false);
  }
});
it("real independent terminal debt blocks this reserved request without netting another receipt", async () => {
  const f = await reserved({ balance_points: 150 });
  const b = { ...reservation, reservationKey: "incurred" };
  await f.h.reserve(f.ctx, b);
  await f.h.startUse(f.ctx, b);
  const usage = {
    status: "known",
    source: "server_estimate",
    model: "fixture",
    inputTokens: 0,
    outputTokens: 0,
    modelCostDollars: 0,
    nonModelCostDollars: 0,
  };
  const evidence = {
    revision: 1,
    pricingVersion: "account-credit-v1",
    actualPoints: 175,
    usage,
  };
  const canonical = {
    reservationKey: b.reservationKey,
    userId: b.userId,
    amountPoints: b.amountPoints,
    subscription: b.subscription,
    ...evidence,
  };
  await f.h.settle(f.ctx, {
    ...b,
    ...evidence,
    usageDigest: createHash("sha256")
      .update(JSON.stringify(canonical))
      .digest("hex"),
  });
  expect(f.tables.extra_usage[0].credit_debt_points).toBe(75);
  expect(await f.h.admit(f.ctx, production)).toMatchObject({
    state: "closed",
    denialReason: "outstanding_debt",
    refund: "confirmed",
    newlyGranted: false,
  });
  expect(f.tables.extra_usage[0]).toMatchObject({
    balance_points: 50,
    credit_debt_points: 75,
    monthly_granted_used_points: 499950,
  });
});
it("admitted production receipt settles through existing terminal API and cannot be refunded or reauthorized", async () => {
  const f = await reserved();
  await f.h.admit(f.ctx, production);
  const usage = {
    status: "known",
    source: "server_estimate",
    model: "fixture",
    inputTokens: 0,
    outputTokens: 0,
    modelCostDollars: 0,
    nonModelCostDollars: 0,
  };
  const evidence = {
    revision: 1,
    pricingVersion: "account-credit-v1",
    actualPoints: 75,
    usage,
  };
  const canonical = {
    reservationKey: reservation.reservationKey,
    userId: reservation.userId,
    amountPoints: reservation.amountPoints,
    subscription: reservation.subscription,
    ...evidence,
  };
  const result = await f.h.settle(f.ctx, {
    ...reservation,
    ...evidence,
    usageDigest: createHash("sha256")
      .update(JSON.stringify(canonical))
      .digest("hex"),
  });
  expect(result.state).toBe("settled");
  expect(await f.h.admit(f.ctx, production)).toEqual({
    state: "settled",
    newlyGranted: false,
  });
  expect(await f.h.close(f.ctx, reservation)).toEqual({ state: "unresolved" });
  expect(f.tables.extra_usage[0]).toMatchObject({
    balance_points: 975,
    monthly_granted_used_points: 500000,
  });
});
it("denial refund overflow is rejected before writes, never labeled confirmed", async () => {
  const f = await reserved();
  f.tables.extra_usage[0].balance_points = Number.MAX_SAFE_INTEGER;
  f.tables.subscriptions[0].status = "expired";
  const before = JSON.stringify(f.tables);
  await expect(f.h.admit(f.ctx, production)).rejects.toThrow("arithmetic");
  expect(JSON.stringify(f.tables)).toBe(before);
});

it("independent: zero-cost current source admits once without balance changes", async () => {
  const f = fixture(row());
  const h = await handlers();
  const p = { ...production, amountPoints: 0 };
  const before = JSON.stringify(f.tables.extra_usage);
  await h.productionReserve(f.ctx, p);
  expect(await h.admit(f.ctx, p)).toEqual({
    state: "in_use",
    newlyGranted: true,
  });
  expect(await h.admit(f.ctx, p)).toEqual({
    state: "in_use",
    newlyGranted: false,
  });
  expect(JSON.stringify(f.tables.extra_usage)).toBe(before);
});
it("independent: replacement ledger with same numeric generation cannot grant or receive old refund", async () => {
  const f = await reserved();
  const replacement = { ...f.tables.extra_usage[0], _id: "replacement" };
  f.tables.extra_usage = [replacement];
  const before = JSON.stringify(replacement);
  expect(await f.h.admit(f.ctx, production)).toMatchObject({
    state: "reconciliation_required",
    newlyGranted: false,
    denialReason: "source_changed",
    refund: "unresolved",
  });
  expect(JSON.stringify(replacement)).toBe(before);
});
it.each(["monthly_granted_reset_date", "monthly_reset_date"])(
  "independent: %s rollover blocks split receipt without restoring into new period",
  async (field) => {
    const f = await reserved();
    f.tables.extra_usage[0][field] = "2026-10";
    const before = JSON.stringify(f.tables.extra_usage);
    expect(await f.h.admit(f.ctx, production)).toMatchObject({
      state: "reconciliation_required",
      newlyGranted: false,
      denialReason: "source_changed",
      refund: "unresolved",
    });
    expect(JSON.stringify(f.tables.extra_usage)).toBe(before);
  },
);
it("independent: purchased-only denial refunds purchased source and retains included spend", async () => {
  const f = await reserved({ monthly_granted_used_points: 500000 });
  f.tables.user_suspensions.push({
    _id: "s",
    user_id: "owner",
    status: "active",
  });
  expect(await f.h.admit(f.ctx, production)).toMatchObject({
    state: "closed",
    newlyGranted: false,
    denialReason: "suspended",
    refund: "confirmed",
  });
  expect(f.tables.extra_usage[0]).toMatchObject({
    balance_points: 1000,
    monthly_granted_used_points: 500000,
    monthly_spent_points: 0,
  });
});
it("independent: another owner's stronger subscription and active suspension do not affect owner", async () => {
  const f = await reserved();
  f.tables.subscriptions.push({
    ...f.tables.subscriptions[0],
    _id: "foreignsub",
    user_id: "other",
    tier: "ultra",
  });
  f.tables.user_suspensions.push({
    _id: "foreigns",
    user_id: "other",
    status: "active",
  });
  expect(await f.h.admit(f.ctx, production)).toEqual({
    state: "in_use",
    newlyGranted: true,
  });
});
it("independent: zero-cost ledger replacement closes no-op without authorizing or mutating replacement", async () => {
  const f = fixture(row());
  const h = await handlers();
  const p = { ...production, amountPoints: 0 };
  await h.productionReserve(f.ctx, p);
  f.tables.extra_usage[0]._id = "replacement";
  const before = JSON.stringify(f.tables.extra_usage);
  expect(await h.admit(f.ctx, p)).toMatchObject({
    state: "closed",
    newlyGranted: false,
    denialReason: "source_changed",
    refund: "confirmed",
  });
  expect(JSON.stringify(f.tables.extra_usage)).toBe(before);
});
