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
it("replays a keyed receipt without a second debit", async () => {
  const f = fixture(row()),
    h = await handlers();
  const first = await h.reserve(f.ctx, reservation);
  const after = JSON.stringify(f.tables);
  expect(await h.reserve(f.ctx, reservation)).toEqual(first);
  expect(JSON.stringify(f.tables)).toBe(after);
  expect(first).toMatchObject({
    state: "reserved",
    receipt: { includedPointsDeducted: 100 },
  });
});
it("charges distinct keys with equal owner and amount independently", async () => {
  const f = fixture(row()),
    h = await handlers();
  await h.reserve(f.ctx, reservation);
  await h.reserve(f.ctx, {
    ...reservation,
    reservationKey: "agent:run-two:preflight",
  });
  expect(f.tables.extra_usage[0].monthly_granted_used_points).toBe(200);
  expect(f.tables.account_credit_reservations).toHaveLength(2);
});
it.each([
  { userId: "foreign" },
  { amountPoints: 101 },
  { subscription: "ultra" },
])("rejects a changed reservation binding %j", async (change) => {
  const f = fixture(row()),
    h = await handlers();
  await h.reserve(f.ctx, reservation);
  const after = JSON.stringify(f.tables);
  await expect(h.reserve(f.ctx, { ...reservation, ...change })).rejects.toThrow(
    "binding",
  );
  await expect(h.close(f.ctx, { ...reservation, ...change })).rejects.toThrow(
    "binding",
  );
  expect(JSON.stringify(f.tables)).toBe(after);
});
it("closes before a delayed debit and never allows it to charge", async () => {
  const f = fixture(row()),
    h = await handlers();
  expect(await h.close(f.ctx, reservation)).toMatchObject({ state: "closed" });
  const after = JSON.stringify(f.tables);
  expect(await h.reserve(f.ctx, reservation)).toEqual({ state: "closed" });
  expect(await h.startUse(f.ctx, reservation)).toEqual({
    state: "closed",
    newlyGranted: false,
  });
  expect(JSON.stringify(f.tables)).toBe(after);
  expect(f.ctx.db.patch).not.toHaveBeenCalled();
});
it("closes after debit and restores exact original sources once", async () => {
  const f = fixture(row({ monthly_granted_used_points: 499_950 })),
    h = await handlers();
  await h.reserve(f.ctx, reservation);
  expect(f.tables.extra_usage[0].balance_points).toBe(950);
  expect(await h.close(f.ctx, reservation)).toEqual({ state: "closed" });
  const after = JSON.stringify(f.tables);
  expect(await h.close(f.ctx, reservation)).toEqual({ state: "closed" });
  expect(JSON.stringify(f.tables)).toBe(after);
  expect(f.tables.extra_usage[0]).toMatchObject({
    balance_points: 1000,
    monthly_granted_used_points: 499_950,
    monthly_spent_points: 0,
  });
});
it("recovers a committed debit whose receipt transport is lost using only its key", async () => {
  const f = fixture(row({ monthly_granted_used_points: 499_950 })),
    h = await handlers();
  const transport = async () => {
    await h.reserve(f.ctx, reservation);
    throw new Error("lost receipt");
  };
  await expect(transport()).rejects.toThrow("lost receipt");
  expect(await h.close(f.ctx, reservation)).toEqual({ state: "closed" });
  expect(f.tables.extra_usage[0]).toMatchObject({
    balance_points: 1000,
    monthly_granted_used_points: 499_950,
    monthly_spent_points: 0,
  });
});
it("does not refund after the durable use fence", async () => {
  const f = fixture(row()),
    h = await handlers();
  await h.reserve(f.ctx, reservation);
  expect(await h.startUse(f.ctx, reservation)).toEqual({
    state: "in_use",
    newlyGranted: true,
  });
  const after = JSON.stringify(f.tables.extra_usage);
  expect(await h.close(f.ctx, reservation)).toEqual({ state: "unresolved" });
  expect(await h.reserve(f.ctx, reservation)).toEqual({
    state: "reconciliation_required",
  });
  expect(JSON.stringify(f.tables.extra_usage)).toBe(after);
  expect(f.tables.account_credit_reservations[0].state).toBe(
    "reconciliation_required",
  );
});
it("leaves ambiguous cross-cycle restoration unresolved without changing balance", async () => {
  const f = fixture(row()),
    h = await handlers();
  await h.reserve(f.ctx, reservation);
  Object.assign(f.tables.extra_usage[0], {
    monthly_granted_cycle_key: "renewal-new",
    monthly_granted_used_points: 80,
  });
  const after = JSON.stringify(f.tables.extra_usage);
  expect(await h.close(f.ctx, reservation)).toEqual({ state: "unresolved" });
  expect(JSON.stringify(f.tables.extra_usage)).toBe(after);
  expect(f.tables.account_credit_reservations[0].state).toBe(
    "reconciliation_required",
  );
});
it("replays a denied reservation without charging after a top-up", async () => {
  const f = fixture(
      row({ monthly_granted_used_points: 500_000, balance_points: 0 }),
    ),
    h = await handlers();
  const denied = await h.reserve(f.ctx, reservation);
  expect(denied).toMatchObject({
    state: "denied",
    receipt: { success: false },
  });
  f.tables.extra_usage[0].balance_points = 1000;
  expect(await h.reserve(f.ctx, reservation)).toEqual(denied);
  expect(await h.startUse(f.ctx, reservation)).toEqual({
    state: "denied",
    newlyGranted: false,
  });
  expect(f.tables.extra_usage[0].balance_points).toBe(1000);
});
it.each([NaN, Infinity, -1, 0.1])(
  "rejects invalid amount %s without writes",
  async (amountPoints) => {
    const f = fixture(row()),
      h = await handlers();
    await expect(
      h.reserve(f.ctx, { ...reservation, amountPoints }),
    ).rejects.toThrow();
    expect(f.ctx.db.patch).not.toHaveBeenCalled();
    expect(f.ctx.db.insert).not.toHaveBeenCalled();
  },
);
it("requires the service credential for all state changes", async () => {
  const f = fixture(row()),
    h = await handlers();
  for (const handler of [h.reserve, h.close, h.startUse]) {
    await expect(
      handler(f.ctx, { ...reservation, serviceKey: "wrong" }),
    ).rejects.toThrow();
  }
  expect(f.ctx.db.patch).not.toHaveBeenCalled();
  expect(f.ctx.db.insert).not.toHaveBeenCalled();
});

it("rejects duplicate reservation rows without choosing a receipt", async () => {
  const f = fixture(row()),
    h = await handlers();
  await h.reserve(f.ctx, reservation);
  f.tables.account_credit_reservations.push({
    ...f.tables.account_credit_reservations[0],
    _id: "duplicate",
  });
  const after = JSON.stringify(f.tables);
  for (const handler of [h.reserve, h.close, h.startUse]) {
    await expect(handler(f.ctx, reservation)).rejects.toThrow("Duplicate");
  }
  expect(JSON.stringify(f.tables)).toBe(after);
});
it("keeps zero-cost requests keyed without changing the credit ledger", async () => {
  const f = fixture(row()),
    h = await handlers();
  const args = { ...reservation, amountPoints: 0 };
  const first = await h.reserve(f.ctx, args);
  expect(await h.reserve(f.ctx, args)).toEqual(first);
  expect(await h.close(f.ctx, args)).toEqual({ state: "closed" });
  expect(f.tables.extra_usage[0]).toEqual(row());
});
it.each([
  { monthly_granted_points: 0 },
  { monthly_reset_date: "2026-10" },
  { monthly_spent_points: 0 },
])("does not guess a refund after ledger changes %j", async (change) => {
  const f = fixture(row({ monthly_granted_used_points: 499_950 })),
    h = await handlers();
  await h.reserve(f.ctx, reservation);
  Object.assign(f.tables.extra_usage[0], change);
  const after = JSON.stringify(f.tables.extra_usage);
  expect(await h.close(f.ctx, reservation)).toEqual({ state: "unresolved" });
  expect(JSON.stringify(f.tables.extra_usage)).toBe(after);
  expect(f.tables.account_credit_reservations[0].state).toBe(
    "reconciliation_required",
  );
});

it("review: unresolved close permanently denies late provider admission", async () => {
  const f = fixture(row()),
    h = await handlers();
  await h.reserve(f.ctx, reservation);
  await h.grant(f.ctx, {
    serviceKey: SERVICE,
    userId: "owner",
    allowancePoints: 0,
  });
  expect(await h.close(f.ctx, reservation)).toEqual({ state: "unresolved" });
  expect(await h.startUse(f.ctx, reservation)).toEqual({
    state: "reconciliation_required",
    newlyGranted: false,
  });
  expect(await h.reserve(f.ctx, reservation)).toEqual({
    state: "reconciliation_required",
  });
  expect(await h.close(f.ctx, reservation)).toEqual({ state: "unresolved" });
});
it("review: use fence distinguishes newly granted from replay", async () => {
  const f = fixture(row()),
    h = await handlers();
  await h.reserve(f.ctx, reservation);
  expect(await h.startUse(f.ctx, reservation)).toEqual({
    state: "in_use",
    newlyGranted: true,
  });
  expect(await h.startUse(f.ctx, reservation)).toEqual({
    state: "in_use",
    newlyGranted: false,
  });
});
it.each([false, true])(
  "review: downgrade/clamp then upgrade=%s cannot restore erased included use",
  async (upgrade) => {
    const f = fixture(
        row({
          monthly_granted_points: 1_800_000,
          monthly_granted_used_points: 1_000_000,
        }),
      ),
      h = await handlers();
    const args = { ...reservation, subscription: "ultra" };
    await h.reserve(f.ctx, args);
    await h.grant(f.ctx, {
      serviceKey: SERVICE,
      userId: "owner",
      allowancePoints: 500_000,
    });
    await h.fast(f.ctx, { ...base, amountPoints: 1 });
    expect(f.tables.extra_usage[0]).toMatchObject({
      monthly_granted_points: 500_000,
      monthly_granted_used_points: 500_000,
      balance_points: 999,
    });
    if (upgrade)
      await h.grant(f.ctx, {
        serviceKey: SERVICE,
        userId: "owner",
        allowancePoints: 1_800_000,
      });
    const before = { ...f.tables.extra_usage[0] };
    expect(await h.close(f.ctx, args)).toEqual({ state: "unresolved" });
    expect(f.tables.extra_usage[0]).toEqual(before);
    expect(await h.startUse(f.ctx, args)).toEqual({
      state: "reconciliation_required",
      newlyGranted: false,
    });
  },
);
it("review: revoke then regrant the same ceiling and cycle invalidates old receipts", async () => {
  const f = fixture(row()),
    h = await handlers();
  await h.reserve(f.ctx, reservation);
  await h.grant(f.ctx, {
    serviceKey: SERVICE,
    userId: "owner",
    allowancePoints: 0,
  });
  await h.grant(f.ctx, {
    serviceKey: SERVICE,
    userId: "owner",
    allowancePoints: 500_000,
  });
  const before = { ...f.tables.extra_usage[0] };
  expect(await h.close(f.ctx, reservation)).toEqual({ state: "unresolved" });
  expect(f.tables.extra_usage[0]).toEqual(before);
});

it("blocks use directly after generation change, before close is called", async () => {
  const f = fixture(row()),
    h = await handlers();
  await h.reserve(f.ctx, reservation);
  await h.grant(f.ctx, {
    serviceKey: SERVICE,
    userId: "owner",
    allowancePoints: 0,
  });
  expect(await h.startUse(f.ctx, reservation)).toEqual({
    state: "reconciliation_required",
    newlyGranted: false,
  });
  expect(await h.reserve(f.ctx, reservation)).toEqual({
    state: "reconciliation_required",
  });
});
it("binds the receipt to the ledger row, rejecting delete/recreate ABA", async () => {
  const f = fixture(row()),
    h = await handlers();
  await h.reserve(f.ctx, reservation);
  f.tables.extra_usage[0] = {
    ...f.tables.extra_usage[0],
    _id: "replacement-ledger",
  };
  const before = { ...f.tables.extra_usage[0] };
  expect(await h.close(f.ctx, reservation)).toEqual({ state: "unresolved" });
  expect(f.tables.extra_usage[0]).toEqual(before);
});
it("ordinary distinct debits and keyed closes do not invalidate each other", async () => {
  const f = fixture(row()),
    h = await handlers();
  await h.reserve(f.ctx, reservation);
  const second = { ...reservation, reservationKey: "agent:second:preflight" };
  await h.reserve(f.ctx, second);
  expect(await h.close(f.ctx, reservation)).toEqual({ state: "closed" });
  expect(await h.close(f.ctx, second)).toEqual({ state: "closed" });
  expect(f.tables.extra_usage[0]).toMatchObject({
    monthly_granted_used_points: 0,
    balance_points: 1000,
  });
});
it.each([
  "legacy account refund",
  "legacy purchased refund",
  "migration",
  "admin rollover",
  "purchase month rollover",
])("fences source history changed by %s", async (writer) => {
  const f = fixture(row({ monthly_granted_used_points: 499_950 })),
    h = await handlers();
  await h.reserve(f.ctx, reservation);
  const generation = f.tables.extra_usage[0].credit_accounting_generation ?? 0;
  if (writer === "legacy account refund")
    await h.refund(f.ctx, {
      serviceKey: SERVICE,
      userId: "owner",
      refundKey: "legacy",
      includedPoints: 10,
      purchasedPoints: 0,
    });
  if (writer === "legacy purchased refund")
    await h.refundPoints(f.ctx, {
      serviceKey: SERVICE,
      userId: "owner",
      amountPoints: 10,
    });
  if (writer === "migration")
    await h.migrate(f.ctx, {
      serviceKey: SERVICE,
      userId: "owner",
      allowancePoints: 500_000,
      legacyConsumedPoints: 1,
      migrationKey: "migration",
    });
  if (writer === "admin rollover") {
    mockSubscription.mockResolvedValue({
      tier: "pro",
      ls_subscription_id: "admin_grant_test",
    });
    jest.setSystemTime(Date.parse("2026-10-01T12:00:00Z"));
    await h.fast(f.ctx, { ...base, amountPoints: 1 });
  }
  if (writer === "purchase month rollover") {
    jest.setSystemTime(Date.parse("2026-10-01T12:00:00Z"));
    await h.deduct(f.ctx, {
      serviceKey: SERVICE,
      userId: "owner",
      amountPoints: 1,
    });
  }
  expect(f.tables.extra_usage[0].credit_accounting_generation).toBeGreaterThan(
    generation,
  );
  const before = { ...f.tables.extra_usage[0] };
  expect(await h.close(f.ctx, reservation)).toEqual({ state: "unresolved" });
  expect(f.tables.extra_usage[0]).toEqual(before);
});

it("purchase revocation invalidates source history without changing its existing debit result", async () => {
  const f = fixture(row()),
    h = await handlers();
  await h.reserve(f.ctx, reservation);
  f.tables.processed_checkout_sessions.push({
    _id: "purchase",
    session_key: "ls_audit",
    user_id: "owner",
    credited_points: 1000,
  });
  const result = await h.revoke(f.ctx, {
    serviceKey: SERVICE,
    purchaseKey: "ls_audit",
    userId: "owner",
    originalGrantPoints: 1000,
    cumulativeRefundUsdCents: 10,
    targetRevokedPoints: 100,
  });
  expect(result).toMatchObject({
    revokedPoints: 100,
    newBalancePoints: 900,
    debtPoints: 0,
  });
  const before = { ...f.tables.extra_usage[0] };
  expect(await h.close(f.ctx, reservation)).toEqual({ state: "unresolved" });
  expect(f.tables.extra_usage[0]).toEqual(before);
});
