/** @jest-environment node */
import { webcrypto } from "node:crypto";
import { getFunctionName } from "convex/server";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { UsageTracker } from "@/lib/usage-tracker";
import { BUILD_MODELS } from "@/types/chat";
import { getUserIDAndPro } from "@/lib/auth/get-user-id";
import {
  buildExtraUsageConfig,
  buildProviderOptions,
} from "@/lib/api/chat-stream-helpers";
import { migratePaidPlanLedger } from "@/lib/billing/paid-ledger-migration";
import {
  checkRateLimit,
  checkBalanceLimit,
  deductUsage,
  deductBalanceUsage,
} from "@/lib/rate-limit";
const mockMutation = jest.fn();
const mockStream = jest.fn();
const mockRefund = jest.fn();
const mockLog = jest.fn();
jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/auth/get-user-id", () => ({ getUserIDAndPro: jest.fn() }));
jest.mock("@/lib/suspensions", () => ({
  assertUserCanMakeCostIncurringRequest: jest.fn(),
}));
jest.mock("@/lib/db/actions", () => ({
  getUserCustomization: jest.fn().mockResolvedValue(null),
  logUsageRecord: (...args: unknown[]) => mockLog(...args),
}));
jest.mock("@/lib/db/convex-client", () => ({
  ...jest.requireActual<typeof import("@/lib/db/convex-client")>(
    "@/lib/db/convex-client",
  ),
  getConvexClient: () => ({ mutation: mockMutation }),
}));
jest.mock("@/lib/billing/paid-ledger-migration", () => ({
  migratePaidPlanLedger: jest.fn(),
}));
jest.mock("@/lib/ai/providers", () => ({
  createTrackedProvider: () => ({ languageModel: jest.fn() }),
  isAnthropicModel: () => false,
}));
jest.mock("@/lib/api/chat-stream-helpers", () => ({
  buildExtraUsageConfig: jest.fn(),
  buildProviderOptions: jest.fn().mockReturnValue({}),
  buildSystemPrompt: (s: string) => s,
  addCacheBreakpointToLastUserMessage: (m: unknown) => m,
}));
jest.mock("@/lib/ai/console-model-agent", () => ({
  CONSOLE_MODEL_TIMEOUT: {},
  createConsoleModelAgent: (settings: unknown) => ({
    stream: (call: any) => mockStream({ ...(settings as object), ...call }),
  }),
}));
jest.mock("@/lib/rate-limit", () => ({
  ...jest.requireActual("@/lib/rate-limit/token-bucket"),
  checkRateLimit: jest.fn(),
  checkBalanceLimit: jest.fn(),
  deductUsage: jest.fn(),
  deductBalanceUsage: jest.fn(),
  UsageRefundTracker: class {
    setUser() {}
    recordDeductions() {}
    refund() {
      return mockRefund();
    }
  },
}));
jest.mock("@/convex/_generated/server", () => ({
  mutation: (c: unknown) => c,
  internalMutation: (c: unknown) => c,
  query: (c: unknown) => c,
  internalQuery: (c: unknown) => c,
  action: (c: unknown) => c,
}));
jest.mock("@/convex/lib/logger", () => ({
  convexLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("@/convex/unitEconomicsLib", () => ({
  recordRevenueEventInternal: jest.fn(),
}));
type Row = Record<string, any>;
function fixture(initial: Row | null) {
  const tables: Record<string, Row[]> = {
    extra_usage: initial ? [{ ...initial }] : [],
    subscriptions: [
      {
        _id: "subscription",
        user_id: "owner",
        tier: "pro",
        status: "active",
        updated_at: Date.now(),
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

const savedGate = process.env.RIFT_CONSOLE_KEYED_CREDITS_ENABLED;
const savedKey = process.env.CONVEX_SERVICE_ROLE_KEY;
let f: ReturnType<typeof fixture>;
let actual: (ref: any, args: any) => Promise<any>;
const name = (ref: any) => getFunctionName(ref).split(":")[1];
const calls = (n: string) =>
  mockMutation.mock.calls.filter(([ref]) => name(ref) === n);
const request = (signal?: AbortSignal, extra = {}) =>
  new NextRequest("http://localhost/api/console/model", {
    method: "POST",
    signal,
    body: JSON.stringify({
      model: BUILD_MODELS[0].id,
      messages: [{ role: "user", content: "hello" }],
      ...extra,
    }),
  });
const records = () => f.tables.account_credit_reservations;
function success({ onStepFinish }: any) {
  return {
    fullStream: (async function* () {
      yield { type: "text-delta", text: "done" };
      onStepFinish({ usage: { inputTokens: 20, outputTokens: 2 } });
      yield { type: "finish", finishReason: "stop" };
    })(),
    response: Promise.resolve({ messages: [] }),
  };
}
const events = async (r: Response) =>
  (await r.text())
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
beforeEach(async () => {
  jest.clearAllMocks();
  process.env.RIFT_CONSOLE_KEYED_CREDITS_ENABLED = "true";
  process.env.CONVEX_SERVICE_ROLE_KEY = "isolated-console-test";
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
  const now = new Date();
  const cycle = now.toISOString().slice(0, 7);
  f = fixture({
    _id: "ledger",
    user_id: "owner",
    balance_points: 1200,
    monthly_granted_points: 500000,
    monthly_granted_used_points: 499950,
    monthly_granted_reset_date: cycle,
    monthly_reset_date: cycle,
    monthly_spent_points: 0,
    monthly_granted_resets_at: new Date(
      now.getTime() + 86400000 * 20,
    ).toISOString(),
    updated_at: 0,
  });
  const h: any = await import("@/convex/extraUsage");
  actual = (ref, args) => h[name(ref)].handler(f.ctx, args);
  mockMutation.mockReset().mockImplementation(actual);
  mockStream.mockReset().mockImplementation(success);
  mockLog.mockReset().mockResolvedValue(undefined);
  mockRefund.mockReset().mockResolvedValue(true);
  jest.mocked(migratePaidPlanLedger).mockReset().mockResolvedValue(undefined);
  jest
    .mocked(getUserIDAndPro)
    .mockResolvedValue({ userId: "owner", subscription: "pro" } as any);
  jest.mocked(buildExtraUsageConfig).mockReset().mockResolvedValue(undefined);
  jest.mocked(buildProviderOptions).mockReset().mockReturnValue({});
  jest.mocked(checkRateLimit).mockResolvedValue({
    servedFrom: "account",
    remaining: 10,
    limit: 100,
    resetTime: new Date(),
  });
  jest.mocked(checkBalanceLimit).mockResolvedValue({
    servedFrom: "balance",
    remaining: 10,
    limit: 100,
    resetTime: new Date(),
  });
});
afterEach(() => {
  for (const [key, value] of [
    ["RIFT_CONSOLE_KEYED_CREDITS_ENABLED", savedGate],
    ["CONVEX_SERVICE_ROLE_KEY", savedKey],
  ]) {
    if (value === undefined) delete process.env[key!];
    else process.env[key!] = value;
  }
});
it("uses actual keyed handlers, migration before reserve and first-use before provider, no legacy trueup", async () => {
  const order: string[] = [];
  jest.mocked(migratePaidPlanLedger).mockImplementation(async () => {
    order.push("migrate");
  });
  mockMutation.mockImplementation(async (ref, args) => {
    order.push(name(ref));
    return actual(ref, args);
  });
  mockStream.mockImplementation((args) => {
    order.push("stream");
    return success(args);
  });
  expect((await events(await POST(request()))).at(-1).type).toBe("complete");
  expect(order).toEqual([
    "migrate",
    "reserveProductionAccountCredits",
    "admitProductionAccountCreditUse",
    "stream",
    "settleAccountCreditReservation",
  ]);
  expect(records()[0].state).toBe("settled");
  expect(checkRateLimit).not.toHaveBeenCalled();
  expect(deductUsage).not.toHaveBeenCalled();
  expect(mockRefund).not.toHaveBeenCalled();
});
it("lost committed reserve replies close the same bound key and restore exact source balances", async () => {
  const before = { ...f.tables.extra_usage[0] };
  mockMutation.mockImplementation(async (ref, args) => {
    const r = await actual(ref, args);
    if (name(ref) === "reserveProductionAccountCredits")
      throw new Error("lost response");
    return r;
  });
  expect((await POST(request())).status).toBe(429);
  expect(calls("reserveProductionAccountCredits")).toHaveLength(2);
  expect(
    new Set(mockMutation.mock.calls.map(([, args]) => args.reservationKey))
      .size,
  ).toBe(1);
  expect(records()[0].state).toBe("closed");
  expect(f.tables.extra_usage[0]).toMatchObject({
    balance_points: before.balance_points,
    monthly_granted_used_points: before.monthly_granted_used_points,
    monthly_spent_points: before.monthly_spent_points,
  });
  expect(mockStream).not.toHaveBeenCalled();
  expect(mockRefund).not.toHaveBeenCalled();
});
it("lost terminal receipt recovers identical evidence and delivers the paid completion exactly once", async () => {
  const proposals = [
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call-once",
          toolName: "read_file",
          input: { path: "README.md" },
        },
      ],
    },
  ];
  mockStream.mockImplementation(({ onStepFinish }: any) => ({
    fullStream: (async function* () {
      onStepFinish({ usage: { inputTokens: 20, outputTokens: 2 } });
      yield { type: "finish", finishReason: "tool-calls" };
    })(),
    response: Promise.resolve({ messages: proposals }),
  }));
  let lose = true;
  let after: Row | undefined;
  mockMutation.mockImplementation(async (ref, args) => {
    const r = await actual(ref, args);
    if (name(ref) === "settleAccountCreditReservation" && lose) {
      lose = false;
      after = { ...f.tables.extra_usage[0] };
      throw new Error("lost response");
    }
    return r;
  });
  const output = await events(await POST(request()));
  expect(output.filter((event) => event.type === "complete")).toHaveLength(1);
  expect(output.at(-1)).toMatchObject({
    type: "complete",
    messages: proposals,
  });
  expect(calls("settleAccountCreditReservation")).toHaveLength(2);
  expect(calls("settleAccountCreditReservation")[0][1]).toEqual(
    calls("settleAccountCreditReservation")[1][1],
  );
  expect(f.tables.extra_usage[0]).toEqual(after);
  expect(records()[0].state).toBe("settled");
  expect(mockStream).toHaveBeenCalledTimes(1);
  expect(mockRefund).not.toHaveBeenCalled();
  expect(deductUsage).not.toHaveBeenCalled();
});
it("lost first-use receipt never dispatches or refunds an uncertain use", async () => {
  mockMutation.mockImplementation(async (ref, args) => {
    const r = await actual(ref, args);
    if (name(ref) === "admitProductionAccountCreditUse")
      throw new Error("lost start");
    return r;
  });
  expect((await POST(request())).status).toBe(429);
  expect(calls("admitProductionAccountCreditUse")).toHaveLength(1);
  expect(records()[0].state).toBe("in_use");
  expect(mockStream).not.toHaveBeenCalled();
  expect(mockRefund).not.toHaveBeenCalled();
});
it("SDK start failure after admission records unknown usage, never zero or source refund", async () => {
  mockStream.mockRejectedValue(new Error("start uncertain"));
  expect((await POST(request())).status).toBe(429);
  expect(records()[0].state).toBe("reconciliation_required");
  expect(calls("settleAccountCreditReservation")[0][1]).toMatchObject({
    actualPoints: null,
    usage: { status: "unknown" },
  });
  expect(mockRefund).not.toHaveBeenCalled();
});
it("already-canceled request closes reserved credit without provider dispatch", async () => {
  const abort = new AbortController();
  abort.abort();
  expect((await POST(request(abort.signal))).status).toBe(429);
  expect(mockStream).not.toHaveBeenCalled();
  expect(calls("admitProductionAccountCreditUse")).toHaveLength(0);
  expect(mockRefund).not.toHaveBeenCalled();
});
it("cancel during acknowledged admission cannot start SDK and settles unknown conservatively", async () => {
  const abort = new AbortController();
  mockMutation.mockImplementation(async (ref, args) => {
    const r = await actual(ref, args);
    if (name(ref) === "admitProductionAccountCreditUse") abort.abort();
    return r;
  });
  expect((await POST(request(abort.signal))).status).toBe(429);
  expect(mockStream).not.toHaveBeenCalled();
  expect(records()[0].state).toBe("reconciliation_required");
  expect(mockRefund).not.toHaveBeenCalled();
});
it("clean stream without any usage observation is unknown, not a free completed step", async () => {
  mockStream.mockReturnValue({
    fullStream: (async function* () {
      yield { type: "finish", finishReason: "stop" };
    })(),
    response: Promise.resolve({ messages: [] }),
  });
  expect((await events(await POST(request()))).at(-1).type).toBe("error");
  expect(records()[0].state).toBe("reconciliation_required");
  expect(mockRefund).not.toHaveBeenCalled();
});
it("server gate defaults off and ignores caller body overrides", async () => {
  delete process.env.RIFT_CONSOLE_KEYED_CREDITS_ENABLED;
  expect(
    (
      await events(
        await POST(
          request(undefined, {
            RIFT_CONSOLE_KEYED_CREDITS_ENABLED: true,
            reservationKey: "attacker",
          }),
        ),
      )
    ).at(-1).type,
  ).toBe("complete");
  expect(checkRateLimit).toHaveBeenCalledTimes(1);
  expect(mockMutation).not.toHaveBeenCalled();
});
it.each(["free", "team", "pro-auto", "ultra-auto"])(
  "preserves legacy %s routing",
  async (tier) => {
    const subscription = tier.replace("-auto", "");
    jest.mocked(getUserIDAndPro).mockResolvedValue({
      userId: "owner",
      subscription,
      organizationId: tier === "team" ? "org" : undefined,
    } as any);
    if (tier.endsWith("auto"))
      jest
        .mocked(buildExtraUsageConfig)
        .mockResolvedValue({ enabled: true, autoReloadEnabled: true } as any);
    expect((await events(await POST(request()))).at(-1).type).toBe("complete");
    expect(mockMutation).not.toHaveBeenCalled();
    expect(migratePaidPlanLedger).not.toHaveBeenCalled();
    expect(
      tier === "free" ? checkBalanceLimit : checkRateLimit,
    ).toHaveBeenCalledTimes(1);
    expect(
      tier === "free" ? deductBalanceUsage : deductUsage,
    ).toHaveBeenCalledTimes(1);
  },
);
it("migration failure retains an exclusive key and tombstones it without any debit or legacy cleanup", async () => {
  jest
    .mocked(migratePaidPlanLedger)
    .mockRejectedValue(new Error("migration unavailable"));
  expect((await POST(request())).status).toBe(429);
  expect(calls("reserveProductionAccountCredits")).toHaveLength(0);
  expect(calls("closeAccountCreditReservation")).toHaveLength(1);
  expect(records()[0].state).toBe("closed");
  expect(mockRefund).not.toHaveBeenCalled();
  expect(mockStream).not.toHaveBeenCalled();
});
it("response cancellation after dispatch records unknown and does not refund partial work", async () => {
  mockStream.mockImplementation(({ abortSignal }: any) => ({
    fullStream: (async function* () {
      yield { type: "text-delta", text: "partial" };
      await new Promise<void>((resolve) => {
        if (abortSignal.aborted) resolve();
        else
          abortSignal.addEventListener("abort", () => resolve(), {
            once: true,
          });
      });
      throw new Error("canceled");
    })(),
    response: Promise.resolve({ messages: [] }),
  }));
  const r = await POST(request());
  const reader = r.body!.getReader();
  await reader.read();
  await reader.cancel();
  for (
    let i = 0;
    i < 20 && records()[0]?.state !== "reconciliation_required";
    i++
  )
    await new Promise((resolve) => setImmediate(resolve));
  expect(records()[0].state).toBe("reconciliation_required");
  expect(calls("settleAccountCreditReservation")[0][1].actualPoints).toBeNull();
  expect(mockRefund).not.toHaveBeenCalled();
  expect(deductUsage).not.toHaveBeenCalled();
});
it("acknowledged terminal debt never releases local tool proposals", async () => {
  mockStream.mockImplementation(({ onStepFinish }: any) => ({
    fullStream: (async function* () {
      onStepFinish({
        usage: { inputTokens: 20, outputTokens: 2, raw: { cost: 10 } },
      });
      yield { type: "finish", finishReason: "tool-calls" };
    })(),
    response: Promise.resolve({
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool-call", toolName: "write_file" }],
        },
      ],
    }),
  }));
  expect((await events(await POST(request()))).at(-1).type).toBe("error");
  expect(records()[0].state).toBe("settled");
  expect(f.tables.extra_usage[0].credit_debt_points).toBeGreaterThan(0);
  expect(calls("settleAccountCreditReservation")).toHaveLength(1);
  expect(mockRefund).not.toHaveBeenCalled();
});
it("an explicitly observed zero-token completion can settle zero", async () => {
  mockStream.mockImplementation(({ onStepFinish }: any) => ({
    fullStream: (async function* () {
      onStepFinish({ usage: { inputTokens: 0, outputTokens: 0 } });
      yield { type: "finish", finishReason: "stop" };
    })(),
    response: Promise.resolve({ messages: [] }),
  }));
  expect((await events(await POST(request()))).at(-1).type).toBe("complete");
  expect(calls("settleAccountCreditReservation")[0][1]).toMatchObject({
    actualPoints: 0,
    usage: { status: "known", inputTokens: 0, outputTokens: 0 },
  });
});
it("double lost settlement acknowledgement remains durable and never triggers unkeyed fallback", async () => {
  mockMutation.mockImplementation(async (ref, args) => {
    const r = await actual(ref, args);
    if (name(ref) === "settleAccountCreditReservation") throw new Error("lost");
    return r;
  });
  expect((await events(await POST(request()))).at(-1).type).toBe("error");
  expect(calls("settleAccountCreditReservation")).toHaveLength(2);
  expect(calls("settleAccountCreditReservation")[0][1]).toEqual(
    calls("settleAccountCreditReservation")[1][1],
  );
  expect(records()[0].state).toBe("settled");
  expect(mockRefund).not.toHaveBeenCalled();
  expect(deductUsage).not.toHaveBeenCalled();
  expect(mockLog).not.toHaveBeenCalled();
});
it("server UUIDs bind separate console steps, ignoring request identities", async () => {
  const extra = {
    reservationKey: "caller-key",
    userId: "victim",
    operationId: "caller-operation",
  };
  await (await POST(request(undefined, extra))).text();
  await (await POST(request(undefined, extra))).text();
  const args = calls("reserveProductionAccountCredits").map(([, a]) => a);
  expect(args).toHaveLength(2);
  expect(new Set(args.map((a) => a.reservationKey)).size).toBe(2);
  for (const a of args) {
    expect(a.userId).toBe("owner");
    expect(a.reservationKey).toMatch(
      /^credit:console:[0-9a-f-]{36}:preflight$/,
    );
  }
});

it("an ended stream without the SDK finish frame cannot commit partial usage or tools", async () => {
  mockStream.mockImplementation(({ onStepFinish }: any) => ({
    fullStream: (async function* () {
      onStepFinish({ usage: { inputTokens: 20, outputTokens: 2 } });
      yield { type: "text-delta", text: "partial" };
    })(),
    response: Promise.resolve({ messages: [] }),
  }));
  expect((await events(await POST(request()))).at(-1).type).toBe("error");
  expect(records()[0].state).toBe("reconciliation_required");
});

it("provider setup failure before first use closes and restores reserved sources", async () => {
  const before = { ...f.tables.extra_usage[0] };
  jest.mocked(buildProviderOptions).mockImplementation(() => {
    throw new Error("provider setup failed");
  });
  expect((await POST(request())).status).toBe(429);
  expect(records()[0].state).toBe("closed");
  expect(f.tables.extra_usage[0]).toMatchObject({
    balance_points: before.balance_points,
    monthly_granted_used_points: before.monthly_granted_used_points,
    monthly_spent_points: before.monthly_spent_points,
  });
  expect(calls("admitProductionAccountCreditUse")).toHaveLength(0);
  expect(mockRefund).not.toHaveBeenCalled();
  expect(mockStream).not.toHaveBeenCalled();
});
it("a replayed first-use grant never starts the provider again", async () => {
  mockMutation.mockImplementation(async (ref, args) => {
    if (name(ref) === "admitProductionAccountCreditUse")
      await actual(ref, args);
    return actual(ref, args);
  });
  expect((await POST(request())).status).toBe(429);
  expect(mockStream).not.toHaveBeenCalled();
  expect(mockRefund).not.toHaveBeenCalled();
  expect(calls("admitProductionAccountCreditUse")).toHaveLength(1);
  expect(records()[0].state).toBe("in_use");
});
it.each(["pro", "ultra"])(
  "preserves organization accounting for resolved %s tier",
  async (subscription) => {
    jest.mocked(getUserIDAndPro).mockResolvedValue({
      userId: "owner",
      subscription,
      organizationId: "organization",
    } as any);
    expect((await events(await POST(request()))).at(-1).type).toBe("complete");
    expect(mockMutation).not.toHaveBeenCalled();
    expect(migratePaidPlanLedger).not.toHaveBeenCalled();
    expect(checkRateLimit).toHaveBeenCalledWith(
      "owner",
      "agent",
      subscription,
      expect.any(Number),
      undefined,
      BUILD_MODELS[0].providerKey,
      "organization",
      undefined,
      undefined,
      undefined,
    );
    expect(deductUsage).toHaveBeenCalledTimes(1);
  },
);
it("synchronous analytics failure after settlement cannot discard paid model completion", async () => {
  mockLog.mockImplementation(() => {
    throw new Error("logger failed");
  });
  expect((await events(await POST(request()))).at(-1).type).toBe("complete");
  expect(calls("settleAccountCreditReservation")).toHaveLength(1);
  expect(records()[0].state).toBe("settled");
  expect(mockLog).toHaveBeenCalledTimes(1);
  expect(mockRefund).not.toHaveBeenCalled();
  expect(deductUsage).not.toHaveBeenCalled();
});

it("a future asynchronous analytics sink rejection cannot invalidate completion", async () => {
  const sink = jest
    .spyOn(UsageTracker.prototype, "log")
    .mockImplementation(
      () => Promise.reject(new Error("async sink unavailable")) as any,
    );
  try {
    expect((await events(await POST(request()))).at(-1).type).toBe("complete");
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls("settleAccountCreditReservation")).toHaveLength(1);
    expect(mockRefund).not.toHaveBeenCalled();
    expect(sink).toHaveBeenCalledTimes(1);
  } finally {
    sink.mockRestore();
  }
});

it.each(["expired", "suspended", "tier_changed", "debt"])(
  "live production admission blocks %s changes after reserve and confirms exact refund",
  async (reason) => {
    const before = { ...f.tables.extra_usage[0] };
    mockMutation.mockImplementation(async (ref, args) => {
      if (name(ref) === "admitProductionAccountCreditUse") {
        if (reason === "expired") f.tables.subscriptions[0].status = "expired";
        if (reason === "tier_changed") f.tables.subscriptions[0].tier = "ultra";
        if (reason === "suspended")
          f.tables.user_suspensions.push({
            _id: "suspension",
            user_id: "owner",
            status: "active",
          });
        if (reason === "debt") f.tables.extra_usage[0].credit_debt_points = 50;
      }
      return actual(ref, args);
    });
    expect((await POST(request())).status).toBe(429);
    expect(records()[0].state).toBe("closed");
    expect(f.tables.extra_usage[0]).toMatchObject({
      balance_points: before.balance_points,
      monthly_granted_used_points: before.monthly_granted_used_points,
      monthly_spent_points: before.monthly_spent_points,
    });
    expect(mockStream).not.toHaveBeenCalled();
    expect(mockRefund).not.toHaveBeenCalled();
    expect(calls("closeAccountCreditReservation")).toHaveLength(0);
  },
);
it("source generation change before production admission remains unresolved without provider or refund", async () => {
  mockMutation.mockImplementation(async (ref, args) => {
    if (name(ref) === "admitProductionAccountCreditUse")
      f.tables.extra_usage[0].credit_accounting_generation = 1;
    return actual(ref, args);
  });
  expect((await POST(request())).status).toBe(429);
  expect(records()[0].state).toBe("reconciliation_required");
  expect(mockStream).not.toHaveBeenCalled();
  expect(mockRefund).not.toHaveBeenCalled();
});

it("cancellation during lost settlement acknowledgement never releases paid tool proposals", async () => {
  const abort = new AbortController();
  let lose = true;
  mockMutation.mockImplementation(async (ref, args) => {
    const r = await actual(ref, args);
    if (name(ref) === "settleAccountCreditReservation" && lose) {
      lose = false;
      abort.abort();
      throw new Error("lost");
    }
    return r;
  });
  const output = await events(await POST(request(abort.signal)));
  expect(output.some((event) => event.type === "complete")).toBe(false);
  expect(calls("settleAccountCreditReservation")).toHaveLength(2);
  expect(calls("settleAccountCreditReservation")[0][1]).toEqual(
    calls("settleAccountCreditReservation")[1][1],
  );
  expect(mockStream).toHaveBeenCalledTimes(1);
  expect(mockRefund).not.toHaveBeenCalled();
});

it("independent: rejected final SDK response with finish and usage still withholds proposals and settles unknown", async () => {
  mockStream.mockImplementation(({ onStepFinish }: any) => ({
    fullStream: (async function* () {
      onStepFinish({ usage: { inputTokens: 20, outputTokens: 2 } });
      yield { type: "finish", finishReason: "tool-calls" };
    })(),
    get response() {
      return Promise.reject(new Error("final SDK response lost"));
    },
  }));
  const out = await events(await POST(request()));
  expect(out.filter((e) => e.type === "complete")).toHaveLength(0);
  expect(out.at(-1).type).toBe("error");
  expect(calls("settleAccountCreditReservation")[0][1].actualPoints).toBeNull();
  expect(records()[0].state).toBe("reconciliation_required");
  expect(mockStream).toHaveBeenCalledTimes(1);
  expect(mockRefund).not.toHaveBeenCalled();
});
it("independent: abort during recovered settlement acknowledgement withholds completion without a third write", async () => {
  const abort = new AbortController();
  let attempts = 0;
  mockMutation.mockImplementation(async (ref, args) => {
    const r = await actual(ref, args);
    if (name(ref) === "settleAccountCreditReservation") {
      attempts++;
      if (attempts === 1) throw Error("first reply lost");
      abort.abort();
    }
    return r;
  });
  const out = await events(await POST(request(abort.signal)));
  expect(out.filter((e) => e.type === "complete")).toHaveLength(0);
  expect(out.at(-1).type).toBe("error");
  expect(calls("settleAccountCreditReservation")).toHaveLength(2);
  expect(records()[0].state).toBe("settled");
  expect(mockStream).toHaveBeenCalledTimes(1);
  expect(mockRefund).not.toHaveBeenCalled();
});
it("independent: a late usage callback cannot alter the immutable recovered settlement", async () => {
  let late: any;
  mockStream.mockImplementation((s: any) => {
    late = s.onStepFinish;
    return success(s);
  });
  let first = true;
  mockMutation.mockImplementation(async (ref, args) => {
    const r = await actual(ref, args);
    if (name(ref) === "settleAccountCreditReservation" && first) {
      first = false;
      late({ usage: { inputTokens: 999999, outputTokens: 999999 } });
      throw Error("lost after commit");
    }
    return r;
  });
  const out = await events(await POST(request()));
  expect(out.filter((e) => e.type === "complete")).toHaveLength(1);
  const c = calls("settleAccountCreditReservation");
  expect(c).toHaveLength(2);
  expect(c[0][1]).toEqual(c[1][1]);
  expect(c[1][1].usage).toMatchObject({ inputTokens: 20, outputTokens: 2 });
  expect(mockStream).toHaveBeenCalledTimes(1);
  expect(mockRefund).not.toHaveBeenCalled();
});
it("independent: permanently pending analytics cannot block acknowledged completion", async () => {
  const sink = jest
    .spyOn(UsageTracker.prototype, "log")
    .mockImplementation(() => new Promise(() => {}) as any);
  try {
    const out = await events(await POST(request()));
    expect(out.at(-1).type).toBe("complete");
    expect(calls("settleAccountCreditReservation")).toHaveLength(1);
  } finally {
    sink.mockRestore();
  }
});

it("independent: two hanging console settlement attempts terminate after20s without complete or provider replay", async () => {
  jest.useFakeTimers();
  try {
    mockMutation.mockImplementation((ref, args) =>
      name(ref) === "settleAccountCreditReservation"
        ? new Promise(() => {})
        : actual(ref, args),
    );
    const pending = POST(request()).then(events);
    let done = false;
    void pending.then(() => {
      done = true;
    });
    await jest.advanceTimersByTimeAsync(9999);
    expect(done).toBe(false);
    expect(calls("settleAccountCreditReservation")).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(done).toBe(false);
    expect(calls("settleAccountCreditReservation")).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(10000);
    const out = await pending;
    expect(out.at(-1).type).toBe("error");
    expect(out.some((e) => e.type === "complete")).toBe(false);
    expect(calls("settleAccountCreditReservation")).toHaveLength(2);
    expect(mockStream).toHaveBeenCalledTimes(1);
    expect(mockRefund).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

it.each([
  { cost: 0, source: "provider", points: 0 },
  { cost: undefined, source: "server_estimate", points: undefined },
])(
  "keeps reported zero distinct from absent model cost through the real route ($source)",
  async ({ cost, source, points }) => {
    mockStream.mockImplementation(({ onStepFinish }: any) => ({
      fullStream: (async function* () {
        onStepFinish({
          usage: {
            inputTokens: 20,
            outputTokens: 2,
            ...(cost !== undefined ? { raw: { cost } } : {}),
          },
        });
        yield { type: "finish", finishReason: "stop" };
      })(),
      response: Promise.resolve({ messages: [] }),
    }));
    expect((await events(await POST(request()))).at(-1).type).toBe("complete");
    const args = calls("settleAccountCreditReservation")[0][1];
    expect(args.usage.source).toBe(source);
    if (points === 0) expect(args.actualPoints).toBe(0);
    else expect(args.actualPoints).toBeGreaterThan(0);
    expect(calls("settleAccountCreditReservation")).toHaveLength(1);
  },
);
