/** @jest-environment node */
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
        "reserveProductionAccountCredits",
        "admitProductionAccountCreditUse",
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

const DEADLINE_MS = 10_000;
function observe<T>(promise: Promise<T>) {
  const state: { done: boolean; value?: T; error?: unknown } = { done: false };
  void promise.then(
    (value) => Object.assign(state, { done: true, value }),
    (error) => Object.assign(state, { done: true, error }),
  );
  return state;
}
it("never-resolving reserve stops after two same-key waits and ignores late responses", async () => {
  const a = (await adapter()).forConsole(binding);
  const first = deferred<any>(),
    second = deferred<any>();
  mockMutation
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const done = observe(a.reserve());
  await jest.advanceTimersByTimeAsync(DEADLINE_MS);
  expect(mockMutation).toHaveBeenCalledTimes(2);
  expect(done.done).toBe(false);
  expect(mockMutation.mock.calls[0][1]).toEqual(mockMutation.mock.calls[1][1]);
  await jest.advanceTimersByTimeAsync(DEADLINE_MS);
  expect(done.done).toBe(true);
  expect(done.error).toBeDefined();
  expect(a.inspect().phase).toBe("reserve_unknown");
  expect(jest.getTimerCount()).toBe(0);
  first.resolve(await actual(...(mockMutation.mock.calls[0] as [any, any])));
  second.reject(Error("late reserve rejection"));
  await jest.advanceTimersByTimeAsync(0);
  expect(a.inspect().phase).toBe("reserve_unknown");
  expect(a.inspect().dispatchGranted).toBe(false);
});
it.each(["forConsole", "forProductionConsole"] as const)(
  "%s first-use timeout never retries or grants after late success",
  async (factory) => {
    const a = (await adapter())[factory](binding);
    await a.reserve();
    const gate = deferred<any>();
    mockMutation.mockReturnValueOnce(gate.promise);
    const done = observe(a.startUse());
    await jest.advanceTimersByTimeAsync(DEADLINE_MS);
    expect(done.done).toBe(true);
    expect(done.error).toBeDefined();
    expect(a.inspect()).toMatchObject({
      phase: "use_unknown",
      dispatchGranted: false,
    });
    expect(mockMutation).toHaveBeenCalledTimes(2);
    expect(await a.closeBeforeUse()).toEqual({ state: "unresolved" });
    gate.resolve({ state: "in_use", newlyGranted: true });
    await jest.advanceTimersByTimeAsync(0);
    expect(a.inspect()).toMatchObject({
      phase: "use_unknown",
      dispatchGranted: false,
    });
    await expect(a.startUse()).rejects.toThrow();
    expect(mockMutation).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  },
);
it("late first-use rejection stays handled and cannot rewrite a timed-out phase", async () => {
  const a = (await adapter()).forConsole(binding);
  await a.reserve();
  const gate = deferred<any>();
  mockMutation.mockReturnValueOnce(gate.promise);
  const done = observe(a.startUse());
  await jest.advanceTimersByTimeAsync(DEADLINE_MS);
  expect(done.done).toBe(true);
  gate.reject(Error("late secret transport error"));
  await jest.advanceTimersByTimeAsync(0);
  expect(a.inspect().phase).toBe("use_unknown");
  expect(jest.getTimerCount()).toBe(0);
});
it("close request suppresses reserve timeout retry and late reserve cannot overwrite closed tombstone", async () => {
  const a = (await adapter()).forConsole(binding);
  const gate = deferred<void>();
  mockMutation.mockImplementationOnce(async (ref, args) => {
    await gate.promise;
    return actual(ref, args);
  });
  const done = observe(a.reserve());
  await jest.advanceTimersByTimeAsync(0);
  expect(await a.closeBeforeUse()).toEqual({ state: "closed" });
  await jest.advanceTimersByTimeAsync(DEADLINE_MS);
  expect(done.done).toBe(true);
  expect(mockMutation).toHaveBeenCalledTimes(2);
  gate.resolve();
  await jest.advanceTimersByTimeAsync(0);
  expect(a.inspect().phase).toBe("closed");
  expect(f.tables.extra_usage[0]).toMatchObject({
    balance_points: 1000,
    monthly_granted_used_points: 499950,
  });
  expect(jest.getTimerCount()).toBe(0);
});
it("two hanging close waits end unresolved, and a late close ack cannot report a refund", async () => {
  const a = (await adapter()).forConsole(binding);
  await a.reserve();
  const gates = [deferred<any>(), deferred<any>()];
  mockMutation
    .mockReturnValueOnce(gates[0].promise)
    .mockReturnValueOnce(gates[1].promise);
  const done = observe(a.closeBeforeUse());
  await jest.advanceTimersByTimeAsync(DEADLINE_MS * 2);
  expect(done.done).toBe(true);
  expect(done.error).toBeDefined();
  expect(a.inspect().phase).toBe("close_unknown");
  expect(mockMutation).toHaveBeenCalledTimes(3);
  expect(mockMutation.mock.calls[1][1]).toEqual(mockMutation.mock.calls[2][1]);
  gates[0].resolve({ state: "closed" });
  gates[1].reject(Error("late close"));
  await jest.advanceTimersByTimeAsync(0);
  expect(a.inspect().phase).toBe("close_unknown");
  expect(jest.getTimerCount()).toBe(0);
});
it("same-key close retry can acknowledge restoration before the first request responds", async () => {
  const a = (await adapter()).forConsole(binding);
  await a.reserve();
  const gate = deferred<any>();
  mockMutation.mockReturnValueOnce(gate.promise);
  const done = observe(a.closeBeforeUse());
  await jest.advanceTimersByTimeAsync(DEADLINE_MS);
  expect(done.value).toEqual({ state: "closed" });
  expect(a.inspect().phase).toBe("closed");
  gate.reject(Error("late close failure"));
  await jest.advanceTimersByTimeAsync(0);
  expect(a.inspect().phase).toBe("closed");
  expect(f.tables.extra_usage[0].balance_points).toBe(1000);
  expect(jest.getTimerCount()).toBe(0);
});
it.each(["success", "failure"])(
  "late settlement %s cannot race a fresh same-snapshot retry",
  async (late) => {
    const a = (await adapter()).forConsole(binding);
    await a.reserve();
    await a.startUse();
    const snapshot = a.captureTerminalUsage(known);
    const gate = deferred<void>();
    mockMutation.mockImplementationOnce(async (ref, args) => {
      const committed = await actual(ref, args);
      await gate.promise;
      if (late === "failure") throw Error("late settlement");
      return committed;
    });
    const done = observe(a.settle(snapshot));
    await jest.advanceTimersByTimeAsync(DEADLINE_MS);
    expect(done.done).toBe(true);
    expect(done.error).toBeDefined();
    expect(a.inspect().phase).toBe("settlement_unknown");
    expect(mockMutation).toHaveBeenCalledTimes(3);
    const retried = await a.settle(snapshot);
    expect(retried.state).toBe("settled");
    expect(mockMutation.mock.calls[2][1]).toEqual(
      mockMutation.mock.calls[3][1],
    );
    const ledger = JSON.stringify(f.tables.extra_usage);
    gate.resolve();
    await jest.advanceTimersByTimeAsync(0);
    expect(a.inspect().phase).toBe("settled");
    expect(JSON.stringify(f.tables.extra_usage)).toBe(ledger);
    expect(await a.settle(snapshot)).toEqual(retried);
    expect(mockMutation).toHaveBeenCalledTimes(4);
    expect(jest.getTimerCount()).toBe(0);
  },
);
it("never-resolving settlement returns unknown after one wait; retry remains caller-owned", async () => {
  const a = (await adapter()).forConsole(binding);
  await a.reserve();
  await a.startUse();
  const snapshot = a.captureTerminalUsage(known);
  mockMutation.mockReturnValueOnce(new Promise(() => {}));
  const done = observe(a.settle(snapshot));
  await jest.advanceTimersByTimeAsync(DEADLINE_MS);
  expect(done.done).toBe(true);
  expect(done.error).toBeDefined();
  expect(a.inspect().phase).toBe("settlement_unknown");
  expect(mockMutation).toHaveBeenCalledTimes(3);
  expect(jest.getTimerCount()).toBe(0);
});
it("pending deadline is unref'ed and successful requests clear the timer", async () => {
  const a = (await adapter()).forConsole(binding);
  const timer = jest.spyOn(globalThis, "setTimeout");
  const gate = deferred<any>();
  mockMutation.mockReturnValueOnce(gate.promise);
  const pending = a.reserve();
  await jest.advanceTimersByTimeAsync(0);
  expect(timer).toHaveBeenCalledWith(expect.any(Function), DEADLINE_MS);
  const handle = timer.mock.results.at(-1)!.value as NodeJS.Timeout;
  expect(handle.hasRef()).toBe(false);
  gate.resolve(await actual(...(mockMutation.mock.calls[0] as [any, any])));
  await pending;
  expect(jest.getTimerCount()).toBe(0);
  timer.mockRestore();
});
it("simultaneous hanging reserve and close finish unknown without a late phase rollback", async () => {
  const a = (await adapter()).forConsole(binding);
  const gates = [deferred<any>(), deferred<any>(), deferred<any>()];
  for (const gate of gates) mockMutation.mockReturnValueOnce(gate.promise);
  const reservation = observe(a.reserve());
  await jest.advanceTimersByTimeAsync(0);
  const closing = observe(a.closeBeforeUse());
  await jest.advanceTimersByTimeAsync(DEADLINE_MS);
  expect(reservation.done).toBe(true);
  expect(closing.done).toBe(false);
  expect(a.inspect().phase).toBe("closing");
  await jest.advanceTimersByTimeAsync(DEADLINE_MS);
  expect(closing.done).toBe(true);
  expect(closing.error).toBeDefined();
  expect(a.inspect().phase).toBe("close_unknown");
  expect(mockMutation).toHaveBeenCalledTimes(3);
  gates[0].resolve(await actual(...(mockMutation.mock.calls[0] as [any, any])));
  gates[1].resolve(await actual(...(mockMutation.mock.calls[1] as [any, any])));
  gates[2].reject(Error("late recovery close"));
  await jest.advanceTimersByTimeAsync(0);
  expect(a.inspect()).toMatchObject({
    phase: "close_unknown",
    dispatchGranted: false,
  });
  expect(jest.getTimerCount()).toBe(0);
});
it.each(["reserve", "startUse", "settle"] as const)(
  "%s early rejection clears every deadline timer",
  async (operation) => {
    const a = (await adapter()).forConsole(binding);
    if (operation !== "reserve") await a.reserve();
    if (operation === "settle") await a.startUse();
    mockMutation.mockImplementation(() =>
      Promise.reject(Error("transport rejected")),
    );
    if (operation === "reserve")
      await expect(a.reserve()).rejects.toThrow("unresolved");
    else if (operation === "startUse")
      await expect(a.startUse()).rejects.toThrow("unresolved");
    else
      await expect(a.settle(a.captureTerminalUsage(known))).rejects.toThrow(
        "unresolved",
      );
    expect(jest.getTimerCount()).toBe(0);
  },
);

it.each(["reserve", "close", "startUse", "settle"])(
  "independent: synchronous %s transport throw clears deadlines",
  async (operation) => {
    const a = (await adapter()).forConsole(binding);
    if (operation === "startUse" || operation === "settle") await a.reserve();
    if (operation === "settle") await a.startUse();
    const before = mockMutation.mock.calls.length;
    mockMutation.mockImplementation(() => {
      throw Error("synchronous transport failure");
    });
    const pending =
      operation === "reserve"
        ? a.reserve()
        : operation === "close"
          ? a.closeBeforeUse()
          : operation === "startUse"
            ? a.startUse()
            : a.settle(a.captureTerminalUsage(known));
    await expect(pending).rejects.toThrow("unresolved");
    expect(jest.getTimerCount()).toBe(0);
    expect(mockMutation.mock.calls.length - before).toBe(
      operation === "reserve" || operation === "close" ? 2 : 1,
    );
  },
);
it("independent: late first reserve rejection cannot replace successful retry state", async () => {
  const a = (await adapter()).forConsole(binding);
  const gate = deferred<any>();
  mockMutation.mockReturnValueOnce(gate.promise);
  const pending = observe(a.reserve());
  await jest.advanceTimersByTimeAsync(DEADLINE_MS);
  expect(pending.value).toBeDefined();
  expect(a.inspect().phase).toBe("reserved");
  gate.reject(Error("first response rejected late"));
  await jest.advanceTimersByTimeAsync(0);
  expect(a.inspect().phase).toBe("reserved");
  expect(mockMutation).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
});
