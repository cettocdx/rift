import { webcrypto } from "node:crypto";
import { getFunctionName } from "convex/server";
jest.mock("../../../convex/_generated/server", () => ({
  mutation: (config: unknown) => config,
  internalMutation: (config: unknown) => config,
  query: (config: unknown) => config,
  internalQuery: (config: unknown) => config,
  action: (config: unknown) => config,
}));
jest.mock("../../../convex/lib/logger", () => ({
  convexLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../../convex/unitEconomicsLib", () => ({
  recordRevenueEventInternal: jest.fn(),
}));
const mockSubscription = jest.fn();
jest.mock("../../../convex/subscriptions", () => ({
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

jest.mock("server-only", () => ({}), { virtual: true });
const mockMutation = jest.fn();
const mockGetClient = jest.fn();
jest.mock("@/lib/db/convex-client", () => ({
  ...jest.requireActual<typeof import("@/lib/db/convex-client")>(
    "@/lib/db/convex-client",
  ),
  getConvexClient: () => mockGetClient(),
}));
const originalService = process.env.CONVEX_SERVICE_ROLE_KEY;
let f: ReturnType<typeof fixture>;
let actual: (ref: any, args: any) => Promise<any>;
async function adapter() {
  return (await import("../account-credit-lifecycle")).AccountCreditLifecycle;
}
const binding = {
  userId: "owner",
  subscription: "pro" as const,
  amountPoints: 100,
  allowAutoReload: false as const,
};
const known = {
  status: "known" as const,
  modelName: "build-balanced",
  inputTokens: 10,
  outputTokens: 20,
  modelProviderCostDollars: 0.003,
  nonModelCostDollars: 0,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(async () => {
  process.env.CONVEX_SERVICE_ROLE_KEY = SERVICE;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
  jest.useFakeTimers().setSystemTime(NOW);
  mockSubscription
    .mockReset()
    .mockResolvedValue({ tier: "pro", ls_subscription_id: "sub-paid" });
  f = fixture(row({ monthly_granted_used_points: 499950 }));
  const h: any = await import("../../../convex/extraUsage");
  actual = async (ref, args) => {
    const name = getFunctionName(ref).split(":")[1];
    if (
      ![
        "reserveAccountCredits",
        "startAccountCreditReservationUse",
        "closeAccountCreditReservation",
        "settleAccountCreditReservation",
      ].includes(name)
    )
      throw new Error("unexpected nonkeyed API");
    return h[name].handler(f.ctx, args);
  };
  mockMutation.mockReset().mockImplementation(actual);
  mockGetClient.mockReset().mockReturnValue({ mutation: mockMutation });
});
afterEach(() => {
  jest.useRealTimers();
  if (originalService === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
  else process.env.CONVEX_SERVICE_ROLE_KEY = originalService;
});
it("binds before reserve awaits and exposes pending debit rather than an empty tracker", async () => {
  const a = (await adapter()).forChat(binding);
  const gate = deferred<any>();
  mockMutation.mockReturnValueOnce(gate.promise);
  expect(a.inspect()).toMatchObject({
    phase: "ready",
    reservationAttempted: false,
  });
  const pending = a.reserve();
  expect(a.inspect()).toMatchObject({
    phase: "reserving",
    reservationAttempted: true,
  });
  await Promise.resolve();
  const [ref, args] = mockMutation.mock.calls[0];
  expect(args).toMatchObject({
    userId: "owner",
    amountPoints: 100,
    subscription: "pro",
    serviceKey: SERVICE,
  });
  gate.resolve(await actual(ref, args));
  await pending;
  expect(a.inspect().phase).toBe("reserved");
});
it("uses stable Trigger identity and distinct server-created HTTP identities", async () => {
  const C = await adapter();
  const agent = {
    ...binding,
    runId: "run_server",
    chatId: "chat",
    claimId: "claim",
  };
  const a = C.forAgentRun(agent),
    b = C.forAgentRun(agent),
    c = C.forChat(binding),
    d = C.forChat(binding),
    e = C.forConsole(binding);
  expect(a.inspect().reservationKey).toBe(b.inspect().reservationKey);
  expect(
    new Set([
      c.inspect().reservationKey,
      d.inspect().reservationKey,
      e.inspect().reservationKey,
    ]).size,
  ).toBe(3);
  expect(c.operationId).toBeTruthy();
  expect(mockMutation).not.toHaveBeenCalled();
});
it("recovers a lost committed reserve response using only the same identity", async () => {
  const a = (await adapter()).forChat(binding);
  mockMutation.mockImplementationOnce(async (ref, args) => {
    await actual(ref, args);
    throw new Error("lost");
  });
  await a.reserve();
  expect(mockMutation).toHaveBeenCalledTimes(2);
  expect(mockMutation.mock.calls[0][1]).toEqual(mockMutation.mock.calls[1][1]);
  expect(f.tables.extra_usage[0]).toMatchObject({
    balance_points: 950,
    monthly_granted_used_points: 500000,
  });
});
it("adapter regression: two lost reserve receipts remain pending until keyed close restores50+1200", async () => {
  f = fixture(
    row({ monthly_granted_used_points: 499950, balance_points: 1000000 }),
  );
  const a = (await adapter()).forChat({ ...binding, amountPoints: 1250 });
  mockMutation.mockImplementation(async (ref, args) => {
    const r = await actual(ref, args);
    if (getFunctionName(ref).endsWith(":reserveAccountCredits"))
      throw new Error("lost");
    return r;
  });
  await expect(a.reserve()).rejects.toThrow();
  expect(a.inspect().phase).toBe("reserve_unknown");
  expect(f.tables.extra_usage[0].balance_points).toBe(998800);
  expect(await a.closeBeforeUse()).toEqual({ state: "closed" });
  expect(f.tables.extra_usage[0]).toMatchObject({
    balance_points: 1000000,
    monthly_granted_used_points: 499950,
    monthly_spent_points: 0,
  });
  expect(mockMutation.mock.calls.map(([r]) => getFunctionName(r))).toEqual([
    "extraUsage:reserveAccountCredits",
    "extraUsage:reserveAccountCredits",
    "extraUsage:closeAccountCreditReservation",
  ]);
});
it("failed close cannot report successful refund or clear uncertainty", async () => {
  const a = (await adapter()).forChat(binding);
  mockMutation.mockRejectedValue(new Error("offline"));
  await expect(a.reserve()).rejects.toThrow();
  await expect(a.closeBeforeUse()).rejects.toThrow();
  expect(a.inspect()).toMatchObject({
    phase: "close_unknown",
    reservationAttempted: true,
  });
});
it("cancellation while reserve is pending cannot return a usable late receipt", async () => {
  const a = (await adapter()).forChat(binding);
  const gate = deferred<void>();
  mockMutation.mockImplementationOnce(async (ref, args) => {
    await gate.promise;
    return actual(ref, args);
  });
  const pending = a.reserve();
  const rejection = expect(pending).rejects.toThrow();
  await Promise.resolve();
  expect(await a.closeBeforeUse()).toEqual({ state: "closed" });
  gate.resolve();
  await rejection;
  expect(f.tables.extra_usage[0].balance_points).toBe(1000);
  expect(a.inspect().phase).toBe("closed");
});
it("first use grants at most one local caller, including concurrent calls", async () => {
  const a = (await adapter()).forChat(binding);
  await a.reserve();
  const first = a.startUse();
  const second = a.startUse();
  await expect(first).resolves.toEqual({ newlyGranted: true });
  await expect(second).rejects.toThrow();
  await expect(a.startUse()).rejects.toThrow();
  expect(
    mockMutation.mock.calls.filter(([r]) =>
      getFunctionName(r).endsWith(":startAccountCreditReservationUse"),
    ),
  ).toHaveLength(1);
});
it("lost first-use response stops dispatch, is not retried and cannot imply zero usage", async () => {
  const a = (await adapter()).forChat(binding);
  await a.reserve();
  mockMutation.mockImplementationOnce(async (ref, args) => {
    await actual(ref, args);
    throw new Error("lost");
  });
  await expect(a.startUse()).rejects.toThrow();
  expect(a.inspect()).toMatchObject({
    phase: "use_unknown",
    dispatchGranted: false,
  });
  const calls = mockMutation.mock.calls.length;
  await expect(a.startUse()).rejects.toThrow();
  expect(await a.closeBeforeUse()).toEqual({ state: "unresolved" });
  expect(mockMutation).toHaveBeenCalledTimes(calls);
  expect(() => a.captureTerminalUsage(known)).toThrow();
});
it("a backend replay with newlyGranted:false never authorizes dispatch", async () => {
  const C = await adapter();
  const bound = {
    ...binding,
    runId: "run_same",
    chatId: "chat",
    claimId: "claim",
  };
  const a = C.forAgentRun(bound),
    b = C.forAgentRun(bound);
  await a.reserve();
  await b.reserve();
  await a.startUse();
  await expect(b.startUse()).rejects.toThrow();
  expect(b.inspect().dispatchGranted).toBe(false);
});
it("cancellation during first-use await denies the late grant locally", async () => {
  const a = (await adapter()).forChat(binding);
  await a.reserve();
  const gate = deferred<void>();
  mockMutation.mockImplementationOnce(async (ref, args) => {
    const result = await actual(ref, args);
    await gate.promise;
    return result;
  });
  const start = a.startUse();
  const rejected = expect(start).rejects.toThrow();
  await Promise.resolve();
  expect(await a.closeBeforeUse()).toEqual({ state: "unresolved" });
  gate.resolve();
  await rejected;
  expect(a.inspect().dispatchGranted).toBe(false);
});
it("freezes server observations and reuses one settlement snapshot after response loss", async () => {
  const a = (await adapter()).forChat(binding);
  await a.reserve();
  await a.startUse();
  const input = { ...known };
  const snapshot = a.captureTerminalUsage(input);
  input.modelProviderCostDollars = 200;
  mockMutation.mockImplementationOnce(async (ref, args) => {
    await actual(ref, args);
    throw new Error("lost");
  });
  await expect(a.settle(snapshot)).rejects.toThrow();
  expect(a.inspect().phase).toBe("settlement_unknown");
  const first = mockMutation.mock.calls.at(-1)![1];
  expect(first.actualPoints).toBe(75);
  expect((await a.settle(snapshot)).state).toBe("settled");
  expect(mockMutation.mock.calls.at(-1)![1]).toEqual(first);
  expect(f.tables.extra_usage[0].balance_points).toBe(975);
  const count = mockMutation.mock.calls.length;
  await a.settle(snapshot);
  expect(mockMutation).toHaveBeenCalledTimes(count);
  expect(() => a.captureTerminalUsage({ ...known, outputTokens: 21 })).toThrow(
    "immutable",
  );
});
it("settlement is single-flight and analytics failure cannot cause another charge", async () => {
  const a = (await adapter()).forChat(binding);
  await a.reserve();
  await a.startUse();
  const s = a.captureTerminalUsage(known);
  const gate = deferred<void>();
  mockMutation.mockImplementationOnce(async (ref, args) => {
    await gate.promise;
    return actual(ref, args);
  });
  const first = a.settle(s),
    second = a.settle(s);
  await Promise.resolve();
  gate.resolve();
  await Promise.all([first, second]);
  const count = mockMutation.mock.calls.length;
  await expect(
    (async () => {
      await a.settle(s);
      throw new Error("analytics");
    })(),
  ).rejects.toThrow("analytics");
  await a.settle(s);
  expect(mockMutation).toHaveBeenCalledTimes(count);
});
it("unknown usage seals reconciliation, never terminal zero", async () => {
  const a = (await adapter()).forChat(binding);
  await a.reserve();
  await a.startUse();
  const s = a.captureTerminalUsage({
    status: "unknown",
    reason: "missing_usage",
  });
  expect(await a.settle(s)).toEqual({
    state: "reconciliation_required",
    reason: "unknown_usage",
  });
  expect(mockMutation.mock.calls.at(-1)![1].actualPoints).toBeNull();
  expect(f.tables.extra_usage[0].balance_points).toBe(950);
  expect(() => a.captureTerminalUsage(known)).toThrow();
});
it("rejects serialized or another operation's terminal capability", async () => {
  const C = await adapter(),
    a = C.forChat(binding),
    b = C.forChat(binding);
  await a.reserve();
  await b.reserve();
  await a.startUse();
  await b.startUse();
  const s = a.captureTerminalUsage(known);
  const before = mockMutation.mock.calls.length;
  await expect(b.settle(s)).rejects.toThrow();
  await expect(a.settle(JSON.parse(JSON.stringify(s)))).rejects.toThrow();
  expect(mockMutation).toHaveBeenCalledTimes(before);
});
it("captures the Convex client before asynchronous work", async () => {
  const a = (await adapter()).forChat(binding);
  const foreign = jest.fn();
  mockGetClient.mockReturnValue({ mutation: foreign });
  await a.reserve();
  expect(foreign).not.toHaveBeenCalled();
  expect(mockGetClient).toHaveBeenCalledTimes(1);
});
it.each([
  { subscription: "free" },
  { allowAutoReload: true },
  { amountPoints: -1 },
  { amountPoints: 0.5 },
  { userId: "" },
])("rejects ineligible binding %j before any mutation", async (change) => {
  const C = await adapter();
  expect(() => C.forChat({ ...binding, ...change } as any)).toThrow();
  expect(mockMutation).not.toHaveBeenCalled();
});
it("copies the authenticated binding before a caller can mutate its object", async () => {
  const setup = { ...binding };
  const a = (await adapter()).forChat(setup);
  setup.userId = "other";
  setup.amountPoints = 999;
  await a.reserve();
  expect(mockMutation.mock.calls[0][1]).toMatchObject({
    userId: "owner",
    amountPoints: 100,
  });
});
it("reserve and close each share one in-flight keyed request", async () => {
  const a = (await adapter()).forChat(binding);
  await Promise.all([a.reserve(), a.reserve()]);
  expect(mockMutation).toHaveBeenCalledTimes(1);
  await Promise.all([a.closeBeforeUse(), a.closeBeforeUse()]);
  expect(mockMutation).toHaveBeenCalledTimes(2);
});
it("malformed reserve success never becomes admission", async () => {
  const a = (await adapter()).forChat(binding);
  mockMutation.mockResolvedValueOnce({
    state: "reserved",
    receipt: {
      success: true,
      includedPointsDeducted: 1,
      purchasedPointsDeducted: 1,
    },
  });
  await expect(a.reserve()).rejects.toThrow();
  expect(a.inspect().phase).toBe("reserve_unknown");
  await expect(a.startUse()).rejects.toThrow();
  expect(mockMutation).toHaveBeenCalledTimes(1);
});
it("wrong first-use state cannot grant even with newlyGranted:true", async () => {
  const a = (await adapter()).forChat(binding);
  await a.reserve();
  mockMutation.mockResolvedValueOnce({ state: "closed", newlyGranted: true });
  await expect(a.startUse()).rejects.toThrow();
  expect(a.inspect()).toMatchObject({
    phase: "reconciliation_required",
    dispatchGranted: false,
  });
});
it("malformed settlement acknowledgement is retryable with the original snapshot", async () => {
  const a = (await adapter()).forChat(binding);
  await a.reserve();
  await a.startUse();
  const snapshot = a.captureTerminalUsage(known);
  mockMutation.mockImplementationOnce(async (ref, args) => {
    const r = await actual(ref, args);
    return { ...r, receipt: { ...r.receipt, actualPoints: 0 } };
  });
  await expect(a.settle(snapshot)).rejects.toThrow();
  expect(a.inspect().phase).toBe("settlement_unknown");
  expect((await a.settle(snapshot)).state).toBe("settled");
  expect(f.tables.extra_usage[0].balance_points).toBe(975);
});
it("a synchronous transport throw clears the settlement flight for later retry", async () => {
  const a = (await adapter()).forChat(binding);
  await a.reserve();
  await a.startUse();
  const s = a.captureTerminalUsage(known);
  mockMutation.mockImplementationOnce(() => {
    throw new Error("synchronous");
  });
  await expect(a.settle(s)).rejects.toThrow();
  expect((await a.settle(s)).state).toBe("settled");
});
it("uses the existing pricing fallback and records its estimate provenance", async () => {
  const a = (await adapter()).forChat(binding);
  await a.reserve();
  await a.startUse();
  const snapshot = a.captureTerminalUsage({
    status: "known",
    modelName: "build-balanced",
    inputTokens: 100,
    outputTokens: 20,
    nonModelCostDollars: 0.0001,
  });
  await a.settle(snapshot);
  const args = mockMutation.mock.calls.at(-1)![1];
  const { computeActualCostPoints } =
    await import("@/lib/rate-limit/token-bucket");
  expect(args.actualPoints).toBe(
    computeActualCostPoints({
      actualInputTokens: 100,
      actualOutputTokens: 20,
      modelName: "build-balanced",
      nonModelCostDollars: 0.0001,
    }),
  );
  expect(args.usage.source).toBe("server_estimate");
});
it("rejects caller-supplied reservation keys and missing service authority", async () => {
  const C = await adapter();
  expect(() =>
    C.forChat({ ...binding, reservationKey: "body-key" } as any),
  ).toThrow();
  delete process.env.CONVEX_SERVICE_ROLE_KEY;
  expect(() => C.forChat(binding)).toThrow();
  expect(mockMutation).not.toHaveBeenCalled();
});
it.each([
  { inputTokens: -1 },
  { outputTokens: Infinity },
  { modelProviderCostDollars: -1 },
  { nonModelCostDollars: NaN },
  { modelName: "" },
])(
  "rejects invalid terminal observations %j before settlement",
  async (change) => {
    const a = (await adapter()).forChat(binding);
    await a.reserve();
    await a.startUse();
    const count = mockMutation.mock.calls.length;
    expect(() => a.captureTerminalUsage({ ...known, ...change })).toThrow();
    expect(mockMutation).toHaveBeenCalledTimes(count);
  },
);

jest.mock("@/lib/rate-limit/token-bucket", () => ({
  ...jest.requireActual("@/lib/rate-limit/token-bucket"),
  refundUsage: jest.fn(),
}));
jest.mock("@/lib/extra-usage", () => ({
  ...jest.requireActual("@/lib/extra-usage"),
  refundFreeAgentRun: jest.fn(),
}));
import { UsageRefundTracker } from "@/lib/rate-limit/refund";
import { runTrackedPreflight } from "@/lib/rate-limit/preflight";
import { refundUsage } from "@/lib/rate-limit/token-bucket";
import { refundFreeAgentRun } from "@/lib/extra-usage";
afterEach(() => {
  expect(refundUsage).not.toHaveBeenCalled();
  expect(refundFreeAgentRun).not.toHaveBeenCalled();
});
function keyedTracker(
  handle: Parameters<UsageRefundTracker["trackKeyedReservation"]>[0],
) {
  const tracker = new UsageRefundTracker();
  tracker.setUser("owner", "pro");
  tracker.trackKeyedReservation(handle);
  return tracker;
}
function metadata(receipt: {
  includedPointsDeducted: number;
  purchasedPointsDeducted: number;
}) {
  return {
    remaining: 0,
    resetTime: new Date(),
    limit: 500000,
    servedFrom: "account" as const,
    pointsDeducted: receipt.includedPointsDeducted,
    extraUsagePointsDeducted: receipt.purchasedPointsDeducted,
  };
}
it("tracker review: actual other-owner lifecycle is rejected on initial attachment", async () => {
  f = fixture(
    row({ user_id: "other-owner", monthly_granted_used_points: 499950 }),
  );
  const a = (await adapter()).forChat({ ...binding, userId: "other-owner" });
  await a.reserve();
  const tracker = new UsageRefundTracker();
  tracker.setUser("owner", "pro");
  expect(() => tracker.trackKeyedReservation(a)).toThrow();
  expect(f.tables.extra_usage[0].balance_points).toBe(950);
});
it("tracker review: lost1250reserve receipts survive real preflight and close acknowledgement loss", async () => {
  f = fixture(
    row({ monthly_granted_used_points: 499950, balance_points: 1000000 }),
  );
  const a = (await adapter()).forChat({ ...binding, amountPoints: 1250 });
  const tracker = keyedTracker(a);
  mockMutation.mockImplementation(async (ref, args) => {
    const result = await actual(ref, args);
    if (getFunctionName(ref).endsWith(":reserveAccountCredits"))
      throw Error("reserve reply lost");
    return result;
  });
  await expect(
    runTrackedPreflight({
      reserve: async () => metadata(await a.reserve()),
      snapshot: async () => ({}),
      moderation: Promise.resolve({}),
      tracker,
      agentMode: false,
    }),
  ).rejects.toThrow("reservation response unresolved");
  expect(tracker.getDeductionSummary()).toMatchObject({
    pointsDeducted: 0,
    extraUsagePointsDeducted: 0,
    reservationPhase: "reserve_unknown",
  });
  expect(tracker.hasDeductions()).toBe(true);
  expect(f.tables.extra_usage[0].balance_points).toBe(998800);
  mockMutation.mockImplementation(async (ref, args) => {
    await actual(ref, args);
    throw Error("close reply lost");
  });
  expect(await tracker.refund()).toBe(false);
  expect(a.inspect().phase).toBe("close_unknown");
  expect(f.tables.extra_usage[0]).toMatchObject({
    balance_points: 1000000,
    monthly_granted_used_points: 499950,
    monthly_spent_points: 0,
  });
  mockMutation.mockImplementation(actual);
  expect(await tracker.refund()).toBe(true);
  expect(await tracker.refund()).toBe(true);
  expect(f.tables.extra_usage[0].balance_points).toBe(1000000);
  expect(mockMutation.mock.calls.map(([ref]) => getFunctionName(ref))).toEqual([
    "extraUsage:reserveAccountCredits",
    "extraUsage:reserveAccountCredits",
    "extraUsage:closeAccountCreditReservation",
    "extraUsage:closeAccountCreditReservation",
    "extraUsage:closeAccountCreditReservation",
  ]);
});
it("tracker review: real preflight records successful keyed debit before propagating moderation failure", async () => {
  const a = (await adapter()).forChat(binding);
  const tracker = keyedTracker(a);
  const failure = Error("moderation failed");
  await expect(
    runTrackedPreflight({
      reserve: async () => metadata(await a.reserve()),
      snapshot: async () => ({}),
      moderation: Promise.reject(failure),
      tracker,
      agentMode: false,
    }),
  ).rejects.toBe(failure);
  expect(tracker.getDeductionSummary()).toMatchObject({
    pointsDeducted: 50,
    extraUsagePointsDeducted: 50,
    reservationPhase: "reserved",
  });
  expect(await tracker.refund()).toBe(true);
  expect(f.tables.extra_usage[0].balance_points).toBe(1000);
});
it("tracker review: cleanup during acknowledged-use settlement stays unresolved until durable settlement acknowledgement", async () => {
  const a = (await adapter()).forChat(binding);
  const tracker = keyedTracker(a);
  await a.reserve();
  await a.startUse();
  const snapshot = a.captureTerminalUsage(known);
  const gate = deferred<void>();
  mockMutation.mockImplementationOnce(async (ref, args) => {
    const result = await actual(ref, args);
    await gate.promise;
    return result;
  });
  const settled = a.settle(snapshot);
  await Promise.resolve();
  expect(await tracker.refund()).toBe(false);
  const calls = mockMutation.mock.calls.length;
  gate.resolve();
  await settled;
  expect(await tracker.refund()).toBe(true);
  expect(mockMutation).toHaveBeenCalledTimes(calls);
  expect(f.tables.extra_usage[0].balance_points).toBe(975);
});
it("tracker review: late first-use reply after cleanup never grants execution or invokes old refunds", async () => {
  const a = (await adapter()).forChat(binding);
  const tracker = keyedTracker(a);
  await a.reserve();
  const gate = deferred<void>();
  mockMutation.mockImplementationOnce(async (ref, args) => {
    const result = await actual(ref, args);
    await gate.promise;
    return result;
  });
  const pending = a.startUse();
  const rejected = expect(pending).rejects.toThrow();
  await Promise.resolve();
  expect(await tracker.refund()).toBe(false);
  const calls = mockMutation.mock.calls.length;
  gate.resolve();
  await rejected;
  expect(a.inspect().dispatchGranted).toBe(false);
  expect(await tracker.refund()).toBe(false);
  expect(mockMutation).toHaveBeenCalledTimes(calls);
  expect(f.tables.extra_usage[0].balance_points).toBe(950);
});
it("tracker review: a known closed first-use result preserves confirmed refund acknowledgement", async () => {
  const C = await adapter();
  const identity = {
    ...binding,
    runId: "run_closed",
    chatId: "chat",
    claimId: "claim",
  };
  const a = C.forAgentRun(identity),
    other = C.forAgentRun(identity);
  const tracker = keyedTracker(a);
  await a.reserve();
  await other.closeBeforeUse();
  await expect(a.startUse()).rejects.toThrow();
  expect(a.inspect().dispatchGranted).toBe(false);
  const calls = mockMutation.mock.calls.length;
  expect(await tracker.refund()).toBe(true);
  expect(mockMutation).toHaveBeenCalledTimes(calls);
  expect(f.tables.extra_usage[0].balance_points).toBe(1000);
});
it("tracker review: a positive closed acknowledgement survives cancellation while its response is pending", async () => {
  const C = await adapter();
  const identity = {
    ...binding,
    runId: "run_closed_late",
    chatId: "chat",
    claimId: "claim",
  };
  const a = C.forAgentRun(identity),
    other = C.forAgentRun(identity);
  const tracker = keyedTracker(a);
  await a.reserve();
  await other.closeBeforeUse();
  const gate = deferred<void>();
  mockMutation.mockImplementationOnce(async (ref, args) => {
    const result = await actual(ref, args);
    await gate.promise;
    return result;
  });
  const start = a.startUse();
  const rejected = expect(start).rejects.toThrow();
  await Promise.resolve();
  expect(await tracker.refund()).toBe(false);
  gate.resolve();
  await rejected;
  const calls = mockMutation.mock.calls.length;
  expect(await tracker.refund()).toBe(true);
  expect(mockMutation).toHaveBeenCalledTimes(calls);
  expect(a.inspect().dispatchGranted).toBe(false);
});
it("tracker review: contradictory closed and newlyGranted reply cannot become confirmed refund", async () => {
  const a = (await adapter()).forChat(binding);
  const tracker = keyedTracker(a);
  await a.reserve();
  mockMutation.mockResolvedValueOnce({ state: "closed", newlyGranted: true });
  await expect(a.startUse()).rejects.toThrow();
  expect(await tracker.refund()).toBe(false);
  expect(a.inspect().dispatchGranted).toBe(false);
  expect(f.tables.extra_usage[0].balance_points).toBe(950);
});

it("retains explicit zero provider cost through immutable settlement and refunds the original receipt", async () => {
  const before = { ...f.tables.extra_usage[0] };
  const a = (await adapter()).forChat(binding);
  await a.reserve();
  await a.startUse();
  const snapshot = a.captureTerminalUsage({
    ...known,
    inputTokens: 1_000_000,
    outputTokens: 0,
    modelProviderCostDollars: 0,
  });
  await a.settle(snapshot);
  const args = mockMutation.mock.calls.at(-1)![1];
  expect(args.actualPoints).toBe(0);
  expect(args.usage).toMatchObject({ source: "provider", modelCostDollars: 0 });
  expect(f.tables.extra_usage[0].monthly_granted_used_points).toBe(
    before.monthly_granted_used_points,
  );
  expect(f.tables.extra_usage[0].balance_points).toBe(before.balance_points);
});
