/** @jest-environment node */
import * as inspection from "../accountCreditInspection";
jest.mock("../_generated/server", () => ({
  query: (definition: unknown) => definition,
}));
const KEY = "inspection-test-authority";
const savedKey = process.env.CONVEX_SERVICE_ROLE_KEY;
beforeEach(() => {
  process.env.CONVEX_SERVICE_ROLE_KEY = KEY;
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
  else process.env.CONVEX_SERVICE_ROLE_KEY = savedKey;
});
const receipt = {
  success: true,
  includedPointsDeducted: 40,
  purchasedPointsDeducted: 60,
  includedRemainingPoints: 100,
  includedTotalPoints: 500,
};
const terminal = {
  revision: 1,
  pricingVersion: "account-credit-v1",
  actualPoints: null,
  usage: { status: "unknown", reason: "interrupted" },
  usageDigest: "a".repeat(64),
  result: { state: "reconciliation_required", reason: "unknown_usage" },
};
function row(key: string, state = "reserved", updated = 10, owner = "owner-a") {
  return {
    _id: key,
    _creationTime: updated,
    reservation_key: key,
    user_id: owner,
    amount_points: 100,
    subscription: "pro",
    state,
    receipt,
    accounting_generation: 2,
    ledger_id: "ledger",
    included_cycle_key: "paid-cycle",
    included_cycle_month: "2026-09",
    purchased_month: "2026-09",
    created_at: 1,
    updated_at: updated,
    production_admission: { version: 1, kind: "console_model", requestId: key },
  };
}
// Array storage exercises real handlers/selection/projection. It does not prove
// Convex index execution, native cursor encoding, snapshots or read budgets.
function fixture(rows: Record<string, any>[] = []) {
  const paginate = jest.fn();
  const db = {
    query: jest.fn((table: string) => {
      if (table !== "account_credit_reservations")
        throw Error("unexpected table");
      return {
        withIndex: jest.fn((index: string, range: (q: any) => unknown) => {
          if (!["by_reservation_key", "by_state_updated_at"].includes(index))
            throw Error("unexpected index");
          const conditions: ((r: any) => boolean)[] = [];
          const q = {
            eq: (k: string, v: unknown) => {
              conditions.push((r) => r[k] === v);
              return q;
            },
            lte: (k: string, v: number) => {
              conditions.push((r) => r[k] <= v);
              return q;
            },
          };
          range(q);
          const selected = () =>
            rows.filter((r) => conditions.every((c) => c(r)));
          return {
            unique: async () => {
              const selectedRows = selected();
              if (selectedRows.length > 1) throw Error("duplicate key");
              return selectedRows[0] ?? null;
            },
            order: (direction: string) => {
              if (direction !== "asc") throw Error("unexpected order");
              return {
                paginate: async (options: any) => {
                  paginate(options);
                  if (
                    options.cursor !== null &&
                    !/^offset:\d+$/.test(options.cursor)
                  )
                    throw Error("native invalid cursor");
                  const offset =
                    options.cursor === null
                      ? 0
                      : Number(options.cursor.slice(7));
                  const ordered = selected().sort(
                    (a, b) =>
                      a.updated_at - b.updated_at ||
                      a._creationTime - b._creationTime,
                  );
                  const page = ordered.slice(offset, offset + options.numItems);
                  return {
                    page,
                    isDone: offset + page.length >= ordered.length,
                    continueCursor: `offset:${offset + page.length}`,
                  };
                },
              };
            },
          };
        }),
      };
    }),
  };
  return { ctx: { db }, db, paginate };
}
const args = {
  serviceKey: KEY,
  state: "reserved",
  updatedBefore: 100,
  pageSize: 2,
  cursor: null,
};
function handler(
  name:
    | "getAccountCreditReservation"
    | "listUnresolvedAccountCreditReservations",
) {
  const fn = (inspection as any)[name]?.handler;
  expect(fn).toEqual(expect.any(Function));
  return fn;
}
it.each([
  "getAccountCreditReservation",
  "listUnresolvedAccountCreditReservations",
] as const)(
  "%s denies invalid/missing authority before reading",
  async (name) => {
    const h = handler(name);
    for (const key of [undefined, "", "wrong"]) {
      const f = fixture();
      await expect(
        h(f.ctx, { ...args, reservationKey: "a", serviceKey: key }),
      ).rejects.toThrow(/Unauthorized/);
      expect(f.db.query).not.toHaveBeenCalled();
    }
    for (const key of [undefined, ""]) {
      if (key === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
      else process.env.CONVEX_SERVICE_ROLE_KEY = key;
      const f = fixture();
      await expect(
        h(f.ctx, { ...args, reservationKey: "a", serviceKey: key }),
      ).rejects.toThrow(/Unauthorized/);
      expect(f.db.query).not.toHaveBeenCalled();
    }
  },
);
it("exact lookup returns null for absent key without writes or other tables", async () => {
  const f = fixture([row("a")]);
  expect(
    await handler("getAccountCreditReservation")(f.ctx, {
      serviceKey: KEY,
      reservationKey: "absent",
    }),
  ).toBeNull();
  expect(f.db.query).toHaveBeenCalledTimes(1);
});
it("exact lookup includes source lineage and immutable evidence, with no internal fields", async () => {
  const target = {
    ...row("b", "reconciliation_required", 20, "owner-b"),
    terminal_settlement: terminal,
    admission_denial: { reason: "source_changed", at: 19 },
  };
  const f = fixture([row("a"), target]);
  const before = JSON.stringify(target);
  const result = await handler("getAccountCreditReservation")(f.ctx, {
    serviceKey: KEY,
    reservationKey: "b",
  });
  expect(result).toMatchObject({
    reservationKey: "b",
    userId: "owner-b",
    accountingGeneration: 2,
    ledgerId: "ledger",
    includedCycleKey: "paid-cycle",
    includedCycleMonth: "2026-09",
    purchasedMonth: "2026-09",
    terminalSettlement: terminal,
    receipt,
  });
  expect(result).not.toHaveProperty("_id");
  expect(result).not.toHaveProperty("_creationTime");
  expect(JSON.stringify(target)).toBe(before);
});
it.each(["", " x ", "x".repeat(201)])(
  "rejects invalid exact key before reads: %s",
  async (reservationKey) => {
    const f = fixture();
    await expect(
      handler("getAccountCreditReservation")(f.ctx, {
        serviceKey: KEY,
        reservationKey,
      }),
    ).rejects.toThrow(/Invalid/);
    expect(f.db.query).not.toHaveBeenCalled();
  },
);
it("fails closed on a duplicate exact key", async () => {
  const f = fixture([row("a"), row("a")]);
  await expect(
    handler("getAccountCreditReservation")(f.ctx, {
      serviceKey: KEY,
      reservationKey: "a",
    }),
  ).rejects.toThrow(/duplicate/);
});
it("queue filters state and age, returns oldest first across owners and uses bounded native pagination", async () => {
  const f = fixture([
    row("late", "reserved", 101),
    row("other", "in_use", 1),
    row("z", "reserved", 30),
    row("b", "reserved", 20, "owner-b"),
    row("a", "reserved", 10),
    row("closed", "closed", 1),
  ]);
  const h = handler("listUnresolvedAccountCreditReservations");
  const first = await h(f.ctx, args);
  expect(first.page.map((r: any) => [r.reservationKey, r.userId])).toEqual([
    ["a", "owner-a"],
    ["b", "owner-b"],
  ]);
  expect(first.isDone).toBe(false);
  expect(first.continueCursor).toBe("offset:2");
  const second = await h(f.ctx, { ...args, cursor: first.continueCursor });
  expect(second.page.map((r: any) => r.reservationKey)).toEqual(["z"]);
  expect(second.isDone).toBe(true);
  expect(f.paginate).toHaveBeenCalledWith({
    numItems: 2,
    cursor: null,
    maximumRowsRead: 100,
    maximumBytesRead: 512 * 1024,
  });
});
it.each(["reserved", "in_use", "reconciliation_required"])(
  "queue supports %s and omits full evidence and digest",
  async (state) => {
    const f = fixture([{ ...row("a", state), terminal_settlement: terminal }]);
    const result = await handler("listUnresolvedAccountCreditReservations")(
      f.ctx,
      { ...args, state },
    );
    expect(result.page).toHaveLength(1);
    expect(result.page[0].terminal).toEqual({
      revision: 1,
      actualPoints: null,
      usageStatus: "unknown",
      result: { state: "reconciliation_required", reason: "unknown_usage" },
    });
    expect(result.page[0]).not.toHaveProperty("terminalSettlement");
    expect(JSON.stringify(result)).not.toContain("usageDigest");
    expect(JSON.stringify(result)).not.toContain("interrupted");
  },
);
it("preserves an empty nonterminal native page's continuation", async () => {
  const f = fixture();
  const nativePage = { page: [], isDone: false, continueCursor: "native-next" };
  f.db.query.mockReturnValue({
    withIndex: () => ({ order: () => ({ paginate: async () => nativePage }) }),
  } as any);
  expect(
    await handler("listUnresolvedAccountCreditReservations")(f.ctx, args),
  ).toEqual(nativePage);
});
it("does not swallow a rejected opaque cursor", async () => {
  await expect(
    handler("listUnresolvedAccountCreditReservations")(fixture().ctx, {
      ...args,
      cursor: "invalid",
    }),
  ).rejects.toThrow("native invalid cursor");
});
it.each([
  { pageSize: 0 },
  { pageSize: 101 },
  { pageSize: 1.5 },
  { pageSize: NaN },
  { updatedBefore: -1 },
  { updatedBefore: Infinity },
  { updatedBefore: 1.5 },
  { cursor: "x".repeat(8193) },
  { state: "closed" },
  { state: "settled" },
  { state: "denied" },
])("invalid queue bounds fail before reads: %j", async (change) => {
  const f = fixture();
  await expect(
    handler("listUnresolvedAccountCreditReservations")(f.ctx, {
      ...args,
      ...change,
    }),
  ).rejects.toThrow(/Invalid/);
  expect(f.db.query).not.toHaveBeenCalled();
});

it.each([1, 100])(
  "accepts bounded page size %i without widening the read budget",
  async (pageSize) => {
    const f = fixture(
      Array.from({ length: 105 }, (_, index) =>
        row(`key-${index}`, "reserved", index),
      ),
    );
    const result = await handler("listUnresolvedAccountCreditReservations")(
      f.ctx,
      { ...args, pageSize, updatedBefore: 200 },
    );
    expect(result.page).toHaveLength(pageSize);
    expect(result.isDone).toBe(false);
    expect(f.paginate).toHaveBeenCalledWith({
      numItems: pageSize,
      cursor: null,
      maximumRowsRead: 100,
      maximumBytesRead: 512 * 1024,
    });
  },
);
