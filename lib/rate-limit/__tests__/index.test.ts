/**
 * Tests for rate limit routing logic (index.ts).
 *
 * Tests the main checkRateLimit function which routes to:
 * - Free users: sliding window (request counting)
 * - Paid users: token bucket (cost-based)
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

describe("checkRateLimit", () => {
  const mockEvalFn = jest.fn();
  const mockCheckTokenBucketLimit = jest.fn();
  const mockCheckAccountCreditLimit = jest.fn();
  const mockCheckBalanceLimit = jest.fn();
  const mockCreateRedisClient = jest.fn();
  const mockCheckFreeMonthlyCostLimit = jest.fn();
  const mockClaimFreeAgentRun = jest.fn();

  it("passes the server snapshot to the paid ledger while retaining atomic deduction", async () => {
    const { checkRateLimit } = getIsolatedModule();
    const snapshot = { userId: "user-123", state: null };
    await checkRateLimit(
      "user-123",
      "agent",
      "pro",
      1000,
      undefined,
      undefined,
      undefined,
      snapshot,
    );
    expect(mockCheckAccountCreditLimit).toHaveBeenCalledWith(
      "user-123",
      "pro",
      1000,
      undefined,
      undefined,
      snapshot,
    );
  });

  it.each([
    ["free", "agent", "free_agent_then_balance"],
    ["free", "ask", "free_ask_then_balance"],
    ["team", "agent", "legacy_token_bucket"],
  ] as const)(
    "reports only bounded routing context for %s/%s",
    async (tier, mode, strategy) => {
      const { checkRateLimit } = getIsolatedModule();
      mockCreateRedisClient.mockReturnValue({ eval: mockEvalFn });
      const observer = jest.fn();
      await checkRateLimit(
        "user-123",
        mode,
        tier,
        10,
        undefined,
        undefined,
        undefined,
        undefined,
        observer,
      );
      expect(observer).toHaveBeenCalledWith({ type: "strategy", strategy });
      expect(observer).toHaveBeenCalledTimes(1);
    },
  );

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    // Default mock responses
    mockEvalFn.mockResolvedValue([1, 5]);

    // Default: monthly free budget has room (not exhausted).
    mockCheckFreeMonthlyCostLimit.mockResolvedValue({
      monthlyLimitPoints: 2500,
      monthlyRemainingAtStart: 2500,
      monthlyResetTime: new Date(),
      extraUsageBalanceAtStart: 0,
      extraUsageAutoReload: false,
      monthlyExhausted: false,
    });

    // Default: the user still has their one free agent run available.
    mockClaimFreeAgentRun.mockResolvedValue(true);

    mockCheckTokenBucketLimit.mockResolvedValue({
      remaining: 5000,
      resetTime: new Date(),
      limit: 10000,
      pointsDeducted: 100,
    });
    mockCheckAccountCreditLimit.mockResolvedValue({
      remaining: 5000,
      resetTime: new Date(),
      limit: 500_000,
      pointsDeducted: 100,
      servedFrom: "account",
    });
  });

  const getIsolatedModule = () => {
    let isolatedModule: typeof import("../index");

    jest.isolateModules(() => {
      jest.doMock("../redis", () => ({
        createRedisClient: mockCreateRedisClient,
      }));

      jest.doMock("../token-bucket", () => ({
        checkTokenBucketLimit: mockCheckTokenBucketLimit,
        checkAccountCreditLimit: mockCheckAccountCreditLimit,
        checkBalanceLimit: mockCheckBalanceLimit,
        deductUsage: jest.fn(),
        deductBalanceUsage: jest.fn(),
        computeActualCostPoints: jest.fn(),
        refundUsage: jest.fn(),
        calculateTokenCost: jest.fn(),
        getBudgetLimits: jest.fn(),
        getSubscriptionPrice: jest.fn(),
      }));

      jest.doMock("../free-monthly-cost", () => ({
        checkFreeMonthlyCostLimit: mockCheckFreeMonthlyCostLimit,
        recordFreeMonthlyCost: jest.fn(),
      }));

      jest.doMock("@/lib/extra-usage", () => ({
        claimFreeAgentRun: mockClaimFreeAgentRun,
      }));

      isolatedModule = require("../index");
    });

    return isolatedModule!;
  };

  describe("free users", () => {
    it("serves the one free agent run for life (no daily window)", async () => {
      const { checkRateLimit } = getIsolatedModule();

      mockCreateRedisClient.mockReturnValue({ eval: mockEvalFn });
      mockClaimFreeAgentRun.mockResolvedValue(true);

      const result = await checkRateLimit("user-123", "agent", "free", 0);

      // Lifetime claim was made; the daily Ask window and balance are untouched.
      expect(mockClaimFreeAgentRun).toHaveBeenCalledWith("user-123");
      expect(mockEvalFn).not.toHaveBeenCalled();
      expect(mockCheckBalanceLimit).not.toHaveBeenCalled();
      expect(mockCheckTokenBucketLimit).not.toHaveBeenCalled();
      expect(result.servedFrom).toBe("free");
      expect(result.limit).toBe(1);
    });

    it("routes a free user's 2nd+ agent run to the prepaid balance", async () => {
      const { checkRateLimit } = getIsolatedModule();

      mockCreateRedisClient.mockReturnValue({ eval: mockEvalFn });
      // Lifetime free agent run already spent.
      mockClaimFreeAgentRun.mockResolvedValue(false);
      mockCheckBalanceLimit.mockResolvedValue({
        remaining: 4900,
        resetTime: new Date(),
        limit: 5000,
        pointsDeducted: 100,
        extraUsagePointsDeducted: 100,
        servedFrom: "balance",
      });

      const cfg = { enabled: true, hasBalance: true, autoReloadEnabled: false };
      const result = await checkRateLimit(
        "user-123",
        "agent",
        "free",
        1000,
        cfg,
        "model-x",
      );

      expect(mockClaimFreeAgentRun).toHaveBeenCalledWith("user-123");
      expect(mockCheckBalanceLimit).toHaveBeenCalledWith(
        "user-123",
        1000,
        "model-x",
        cfg,
      );
      // Agent never touches the daily Ask sliding window.
      expect(mockEvalFn).not.toHaveBeenCalled();
      expect(result.servedFrom).toBe("balance");
    });

    it("should use sliding window for free users in ask mode (3/day)", async () => {
      const { checkRateLimit } = getIsolatedModule();

      mockCreateRedisClient.mockReturnValue({ eval: mockEvalFn });

      const result = await checkRateLimit("user-123", "ask", "free", 0);

      expect(mockEvalFn).toHaveBeenCalledWith(
        expect.any(String),
        [
          expect.stringMatching(/^free_limit:user-123:free:\d+$/),
          "free_referral_bonus:user-123",
        ],
        [3, 1, expect.any(Number)],
      );
      expect(mockClaimFreeAgentRun).not.toHaveBeenCalled();
      expect(mockCheckTokenBucketLimit).not.toHaveBeenCalled();
      expect(result.remaining).toBe(5);
    });

    it("should skip rate limiting when Redis unavailable", async () => {
      const { checkRateLimit } = getIsolatedModule();

      mockCreateRedisClient.mockReturnValue(null);

      const result = await checkRateLimit("user-123", "ask", "free", 0);
      expect(result.remaining).toBe(3);
      expect(result.limit).toBe(3);
      expect(result.rateLimitSkipped).toBe(true);
    });

    it("should fall through to the prepaid balance when the free window is exhausted (PAYG)", async () => {
      const { checkRateLimit } = getIsolatedModule();

      mockCreateRedisClient.mockReturnValue({ eval: mockEvalFn });
      // Free window exhausted: script returns success=0, remaining=0.
      mockEvalFn.mockResolvedValue([0, 0]);
      mockCheckBalanceLimit.mockResolvedValue({
        remaining: 4900,
        resetTime: new Date(),
        limit: 5000,
        pointsDeducted: 100,
        extraUsagePointsDeducted: 100,
        servedFrom: "balance",
      });

      const cfg = { enabled: true, hasBalance: true, autoReloadEnabled: false };
      const result = await checkRateLimit(
        "user-123",
        "ask",
        "free",
        1000,
        cfg,
        "model-x",
      );

      // Routed to the balance path with the estimate + model + config.
      expect(mockCheckBalanceLimit).toHaveBeenCalledWith(
        "user-123",
        1000,
        "model-x",
        cfg,
      );
      expect(result.servedFrom).toBe("balance");
      expect(mockCheckTokenBucketLimit).not.toHaveBeenCalled();
    });

    it("should throw 'buy tokens' when free window is exhausted and balance is empty", async () => {
      const { checkRateLimit } = getIsolatedModule();
      const { ChatSDKError } = require("@/lib/errors");

      mockCreateRedisClient.mockReturnValue({ eval: mockEvalFn });
      mockEvalFn.mockResolvedValue([0, 0]);
      mockCheckBalanceLimit.mockRejectedValue(
        new ChatSDKError(
          "rate_limit:chat",
          "You're out of tokens. Buy more tokens in Settings to keep going.",
        ),
      );

      try {
        await checkRateLimit("user-123", "ask", "free", 0);
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error.cause).toContain("out of tokens");
      }
    });

    it("should fall through to the prepaid balance when the MONTHLY free cap is exhausted, without consuming the daily window", async () => {
      const { checkRateLimit } = getIsolatedModule();

      mockCreateRedisClient.mockReturnValue({ eval: mockEvalFn });
      // Daily window still has room — but it must NOT be consumed because the
      // monthly cap is spent and we route straight to balance.
      mockEvalFn.mockResolvedValue([1, 5]);
      mockCheckFreeMonthlyCostLimit.mockResolvedValue({
        monthlyLimitPoints: 2500,
        monthlyRemainingAtStart: 0,
        monthlyResetTime: new Date(),
        extraUsageBalanceAtStart: 0,
        extraUsageAutoReload: false,
        monthlyExhausted: true,
      });
      mockCheckBalanceLimit.mockResolvedValue({
        remaining: 4900,
        resetTime: new Date(),
        limit: 5000,
        pointsDeducted: 100,
        extraUsagePointsDeducted: 100,
        servedFrom: "balance",
      });

      const cfg = { enabled: true, hasBalance: true, autoReloadEnabled: false };
      const result = await checkRateLimit(
        "user-123",
        "ask",
        "free",
        1000,
        cfg,
        "model-x",
      );

      expect(mockCheckBalanceLimit).toHaveBeenCalledWith(
        "user-123",
        1000,
        "model-x",
        cfg,
      );
      // Daily sliding-window script must not run when the month is exhausted.
      expect(mockEvalFn).not.toHaveBeenCalled();
      expect(result.servedFrom).toBe("balance");
    });
  });

  describe("paid users", () => {
    it("uses the account ledger for Pro users in agent mode", async () => {
      const { checkRateLimit } = getIsolatedModule();

      const result = await checkRateLimit("user-123", "agent", "pro", 1000);

      expect(mockCheckAccountCreditLimit).toHaveBeenCalledWith(
        "user-123",
        "pro",
        1000,
        undefined,
        undefined,
      );
      expect(result.remaining).toBe(5000);
    });

    it("uses the account ledger for Pro users in ask mode", async () => {
      const { checkRateLimit } = getIsolatedModule();

      const result = await checkRateLimit("user-123", "ask", "pro", 1000);

      expect(mockCheckAccountCreditLimit).toHaveBeenCalledWith(
        "user-123",
        "pro",
        1000,
        undefined,
        undefined,
      );
      expect(result.remaining).toBe(5000);
    });

    it("uses the account ledger for Max users", async () => {
      const { checkRateLimit } = getIsolatedModule();

      await checkRateLimit("user-123", "agent", "ultra", 2000, {
        enabled: true,
        hasBalance: true,
        autoReloadEnabled: false,
      });

      expect(mockCheckAccountCreditLimit).toHaveBeenCalledWith(
        "user-123",
        "ultra",
        2000,
        { enabled: true, hasBalance: true, autoReloadEnabled: false },
        undefined,
      );
    });

    it("should use token bucket for team users", async () => {
      const { checkRateLimit } = getIsolatedModule();

      await checkRateLimit("user-123", "ask", "team", 500);

      expect(mockCheckTokenBucketLimit).toHaveBeenCalledWith(
        "user-123",
        "team",
        500,
        undefined,
        undefined,
        undefined,
      );
    });

    it("shares the same account ledger across modes", async () => {
      const { checkRateLimit } = getIsolatedModule();

      await checkRateLimit("user-123", "agent", "pro", 1000);
      await checkRateLimit("user-123", "ask", "pro", 1000);

      // Both should call the same function with the same parameters
      expect(mockCheckAccountCreditLimit).toHaveBeenCalledTimes(2);
      expect(mockCheckAccountCreditLimit).toHaveBeenNthCalledWith(
        1,
        "user-123",
        "pro",
        1000,
        undefined,
        undefined,
      );
      expect(mockCheckAccountCreditLimit).toHaveBeenNthCalledWith(
        2,
        "user-123",
        "pro",
        1000,
        undefined,
        undefined,
      );
    });
  });
});
