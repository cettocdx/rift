import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockHmget = jest.fn();
const mockRedisConstructor = jest.fn().mockImplementation(() => ({
  hmget: mockHmget,
}));

jest.mock("../_generated/server", () => ({
  action: jest.fn((config: unknown) => config),
}));

jest.mock("convex/values", () => ({
  v: {
    string: jest.fn(() => "string"),
    number: jest.fn(() => "number"),
    boolean: jest.fn(() => "boolean"),
    null: jest.fn(() => "null"),
    object: jest.fn(() => "object"),
    union: jest.fn(() => "union"),
    literal: jest.fn(() => "literal"),
  },
}));

jest.mock("../_generated/api", () => ({
  api: {
    subscriptions: {
      getActiveSubscription: "subscriptions.getActiveSubscription",
    },
    extraUsage: {
      getExtraUsageSettings: "extraUsage.getExtraUsageSettings",
    },
  },
}));

jest.mock("@upstash/redis", () => ({
  Redis: mockRedisConstructor,
}));

jest.mock("../../lib/rate-limit/token-bucket", () => ({
  getBudgetLimits: (tier: string) => ({
    monthly:
      tier === "ultra"
        ? 1_800_000
        : tier === "pro"
          ? 500_000
          : tier === "team"
            ? 400_000
            : 0,
  }),
  getSubscriptionPrice: (tier: string) =>
    tier === "ultra" ? 180 : tier === "pro" ? 50 : tier === "team" ? 40 : 0,
}));

const makeContext = (
  tier: string | null = "pro",
  included = { total: 500_000, used: 125_000, remaining: 375_000 },
) => ({
  auth: {
    getUserIdentity: jest.fn().mockResolvedValue({
      subject: "user-123|provider",
    }),
  },
  runQuery: jest.fn(async (queryRef: string) =>
    queryRef === "subscriptions.getActiveSubscription"
      ? tier
        ? { tier }
        : null
      : {
          includedCredits: {
            ...included,
            resetAt: "2026-08-20T00:00:00.000Z",
          },
        },
  ),
});

const invoke = async (
  ctx: ReturnType<typeof makeContext>,
  subscription: "free" | "pro" | "pro-plus" | "team" | "ultra" = "pro",
) => {
  const { getAgentRateLimitStatus } = await import("../rateLimitStatus");
  return (getAgentRateLimitStatus as any).handler(ctx, { subscription });
};

describe("getAgentRateLimitStatus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example";
    process.env.UPSTASH_REDIS_REST_TOKEN = "secret";
  });

  it("reads an existing bucket without executing a mutating limiter", async () => {
    const now = Date.now();
    mockHmget.mockResolvedValue({
      refilledAt: now - 1_000,
      tokens: 175_000,
    });

    const result = await invoke(makeContext("team"), "ultra");

    expect(mockHmget).toHaveBeenCalledWith(
      "usage:monthly:user-123:team",
      "refilledAt",
      "tokens",
    );
    expect(result).toEqual({
      available: true,
      monthly: {
        remaining: 175_000,
        limit: 400_000,
        used: 225_000,
        usagePercentage: 56,
        resetTime: new Date(
          now - 1_000 + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        cycleStarted: true,
      },
      monthlyBudgetUsd: 40,
    });
  });

  it("returns a full unstarted allowance for a missing hash", async () => {
    mockHmget.mockResolvedValue(null);

    const result = await invoke(makeContext("team"));

    expect(result).toEqual({
      available: true,
      monthly: {
        remaining: 400_000,
        limit: 400_000,
        used: 0,
        usagePercentage: 0,
        resetTime: null,
        cycleStarted: false,
      },
      monthlyBudgetUsd: 40,
    });
    expect(mockHmget).toHaveBeenCalledTimes(1);
  });

  it("treats an expired hash as unstarted without writing to Redis", async () => {
    mockHmget.mockResolvedValue({
      refilledAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
      tokens: 1,
    });

    const result = await invoke(makeContext("team"));

    expect(result.monthly).toMatchObject({
      remaining: 400_000,
      used: 0,
      resetTime: null,
      cycleStarted: false,
    });
    expect(mockHmget).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the bucket is malformed", async () => {
    mockHmget.mockResolvedValue({ refilledAt: Date.now(), tokens: null });

    await expect(invoke(makeContext("team"))).resolves.toMatchObject({
      available: false,
      monthly: { remaining: 0, limit: 0, used: 0 },
    });
  });

  it("derives the allowance from the authenticated entitlement", async () => {
    mockHmget.mockResolvedValue(null);

    const result = await invoke(makeContext("pro"), "ultra");

    expect(result.monthly).toMatchObject({
      limit: 500_000,
      used: 125_000,
      remaining: 375_000,
    });
    expect(result.monthlyBudgetUsd).toBe(50);
    expect(mockHmget).not.toHaveBeenCalled();
  });

  it("fails closed when Redis is not configured", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;

    await expect(invoke(makeContext("team"))).resolves.toMatchObject({
      available: false,
      monthly: { remaining: 0, limit: 0, used: 0 },
    });
    expect(mockHmget).not.toHaveBeenCalled();
  });
});
