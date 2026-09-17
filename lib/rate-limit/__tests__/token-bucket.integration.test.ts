/**
 * Tests for token-bucket async functions.
 *
 * These tests use jest.isolateModules() to get fresh module instances
 * with fully mocked dependencies (Redis, Ratelimit, extra-usage).
 * No real external services are called.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

describe("token-bucket async functions", () => {
  // Mock functions we can control
  const mockCreateRedisClient = jest.fn();
  const mockLimitFn = jest.fn();
  const mockHincrbyFn = jest.fn();
  const mockHsetFn = jest.fn();
  const mockDelFn = jest.fn();
  const mockExpireFn = jest.fn();
  const mockDeductFromBalance = jest.fn();
  const mockRefundToBalance = jest.fn();
  const mockDeductFromTeamBalance = jest.fn();
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    // Default mock responses
    mockLimitFn.mockResolvedValue({
      success: true,
      remaining: 10000,
      reset: Date.now() + 3600000,
      limit: 10000,
    });
    mockHincrbyFn.mockResolvedValue(5000);
    mockHsetFn.mockResolvedValue(1);
    mockDelFn.mockResolvedValue(1);
    mockExpireFn.mockResolvedValue(1);
    mockDeductFromBalance.mockResolvedValue({
      success: true,
      newBalanceDollars: 10,
      insufficientFunds: false,
      monthlyCapExceeded: false,
    });
    mockRefundToBalance.mockResolvedValue({
      success: true,
      newBalanceDollars: 10,
    });
    mockDeductFromTeamBalance.mockResolvedValue({ success: true });
    mockCreateRedisClient.mockReturnValue({
      hincrby: mockHincrbyFn,
      hset: mockHsetFn,
      del: mockDelFn,
      expire: mockExpireFn,
    });
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  const getIsolatedModule = () => {
    let isolatedModule: typeof import("../token-bucket");

    jest.isolateModules(() => {
      // Mock dependencies INSIDE isolateModules
      const MockRatelimit = jest.fn().mockImplementation(() => ({
        limit: mockLimitFn,
      }));
      // Add static method used by the code
      (MockRatelimit as any).tokenBucket = jest.fn().mockReturnValue({});

      jest.doMock("@upstash/ratelimit", () => ({
        Ratelimit: MockRatelimit,
      }));

      jest.doMock("@upstash/redis", () => ({
        Redis: jest.fn().mockImplementation(() => ({
          hincrby: mockHincrbyFn,
          hset: mockHsetFn,
          del: mockDelFn,
          expire: mockExpireFn,
        })),
      }));

      jest.doMock("../redis", () => ({
        createRedisClient: mockCreateRedisClient,
        formatTimeRemaining: jest.fn(() => "5 hours"),
      }));

      jest.doMock("../../extra-usage", () => ({
        deductFromBalance: mockDeductFromBalance,
        refundToBalance: mockRefundToBalance,
        deductFromTeamBalance: mockDeductFromTeamBalance,
      }));

      // Now require the module with fresh mocks
      isolatedModule = require("../token-bucket");
    });

    return isolatedModule!;
  };

  describe("checkTokenBucketLimit", () => {
    it("should throw error for free tier users (safety check)", async () => {
      const { checkTokenBucketLimit } = getIsolatedModule();

      try {
        await checkTokenBucketLimit("user-123", "free", 1000);
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error.cause).toContain("not available on the free tier");
      }
    });

    it("should return rate limit info for paid users", async () => {
      const { checkTokenBucketLimit } = getIsolatedModule();

      const result = await checkTokenBucketLimit("user-123", "pro", 1000);

      expect(result).toHaveProperty("remaining");
      expect(result).toHaveProperty("resetTime");
      expect(result).toHaveProperty("limit");
      expect(result.pointsDeducted).toBeDefined();
      expect(mockLimitFn).toHaveBeenCalled();
    });

    it("should skip paid rate limiting outside production when Redis is unavailable", async () => {
      mockCreateRedisClient.mockReturnValue(null);
      const { checkTokenBucketLimit } = getIsolatedModule();

      const result = await checkTokenBucketLimit("user-123", "pro", 1000);

      expect(result.rateLimitSkipped).toBe(true);
      expect(result.remaining).toBe(result.limit);
      expect(mockLimitFn).not.toHaveBeenCalled();
    });

    it("should fail closed for paid users in production when Redis is unavailable", async () => {
      process.env.NODE_ENV = "production";
      mockCreateRedisClient.mockReturnValue(null);
      const { checkTokenBucketLimit } = getIsolatedModule();

      await expect(
        checkTokenBucketLimit("user-123", "pro", 1000),
      ).rejects.toMatchObject({
        type: "rate_limit",
        surface: "chat",
        cause: "Rate limiting service is not configured",
      });
      expect(mockLimitFn).not.toHaveBeenCalled();
    });

    it("should throw rate limit error when limits exceeded", async () => {
      const { checkTokenBucketLimit } = getIsolatedModule();

      mockLimitFn.mockResolvedValue({
        success: true,
        remaining: 0,
        reset: Date.now() + 3600000,
        limit: 250000,
      });

      try {
        await checkTokenBucketLimit("user-123", "pro", 1000);
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error.cause).toContain("usage limit");
      }
    });

    it("should use extra usage when limits exceeded and balance available", async () => {
      const { checkTokenBucketLimit } = getIsolatedModule();

      mockLimitFn.mockResolvedValue({
        success: true,
        remaining: 0,
        reset: Date.now() + 3600000,
        limit: 250000,
      });

      const result = await checkTokenBucketLimit("user-123", "pro", 1000, {
        enabled: true,
        hasBalance: true,
        autoReloadEnabled: false,
      });

      expect(mockDeductFromBalance).toHaveBeenCalled();
      expect(result.extraUsagePointsDeducted).toBeGreaterThan(0);
    });

    it("should return monthly nested field matching top-level fields", async () => {
      const { checkTokenBucketLimit } = getIsolatedModule();

      const result = await checkTokenBucketLimit("user-123", "pro", 1000);

      expect(result.monthly).toBeDefined();
      expect(result.monthly!.remaining).toBe(result.remaining);
      expect(result.monthly!.limit).toBe(result.limit);
      expect(result.monthly!.resetTime).toEqual(result.resetTime);
    });

    it("should throw when the final monthly deduction fails after a successful peek", async () => {
      const { checkTokenBucketLimit } = getIsolatedModule();

      mockLimitFn
        .mockResolvedValueOnce({
          success: true,
          remaining: 7,
          reset: Date.now() + 3600000,
          limit: 250000,
        })
        .mockResolvedValueOnce({
          success: false,
          remaining: 0,
          reset: Date.now() + 3600000,
          limit: 250000,
        });

      try {
        await checkTokenBucketLimit("user-123", "pro", 1000);
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error.cause).toContain("monthly usage limit");
      }
    });

    it("should throw monthly cap exceeded error when extra usage cap hit", async () => {
      const { checkTokenBucketLimit } = getIsolatedModule();

      mockLimitFn.mockResolvedValue({
        success: true,
        remaining: 0,
        reset: Date.now() + 3600000,
        limit: 250000,
      });

      mockDeductFromBalance.mockResolvedValue({
        success: false,
        newBalanceDollars: 0,
        insufficientFunds: true,
        monthlyCapExceeded: true,
      });

      try {
        await checkTokenBucketLimit("user-123", "pro", 1000, {
          enabled: true,
          hasBalance: true,
          autoReloadEnabled: false,
        });
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error.cause).toContain("monthly extra usage spending limit");
      }
    });

    it("should throw insufficient funds error when extra usage fails", async () => {
      const { checkTokenBucketLimit } = getIsolatedModule();

      mockLimitFn.mockResolvedValue({
        success: true,
        remaining: 0,
        reset: Date.now() + 3600000,
        limit: 250000,
      });

      mockDeductFromBalance.mockResolvedValue({
        success: false,
        newBalanceDollars: 0,
        insufficientFunds: true,
        monthlyCapExceeded: false,
      });

      try {
        await checkTokenBucketLimit("user-123", "pro", 1000, {
          enabled: true,
          hasBalance: true,
          autoReloadEnabled: false,
        });
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error.cause).toContain("extra usage balance is empty");
      }
    });
  });

  describe("deductUsage", () => {
    it("should deduct additional cost after processing", async () => {
      const { deductUsage } = getIsolatedModule();

      await deductUsage("user-123", "pro", 1000, 1200, 500);

      expect(mockLimitFn).toHaveBeenCalled();
    });

    it("should skip usage deduction outside production when Redis is unavailable", async () => {
      mockCreateRedisClient.mockReturnValue(null);
      const { deductUsage } = getIsolatedModule();

      await expect(
        deductUsage("user-123", "pro", 1000, 1200, 500),
      ).resolves.toBeUndefined();
      expect(mockLimitFn).not.toHaveBeenCalled();
    });

    it("should fail closed for paid usage deduction in production when Redis is unavailable", async () => {
      process.env.NODE_ENV = "production";
      mockCreateRedisClient.mockReturnValue(null);
      const { deductUsage } = getIsolatedModule();

      await expect(
        deductUsage("user-123", "pro", 1000, 1200, 500),
      ).rejects.toMatchObject({
        type: "rate_limit",
        surface: "chat",
        cause: "Rate limiting service is not configured",
      });
      expect(mockLimitFn).not.toHaveBeenCalled();
    });

    it("should use extra usage when bucket depleted", async () => {
      const { deductUsage, calculateTokenCost } = getIsolatedModule();

      // Atomic deduction goes negative when bucket is depleted
      mockLimitFn.mockResolvedValue({
        success: true,
        remaining: -30,
        reset: Date.now() + 3600000,
        limit: 250000,
      });

      await deductUsage("user-123", "pro", 1000, 1000, 1000, {
        enabled: true,
        hasBalance: true,
        autoReloadEnabled: false,
      });

      // Overflow charged to balance = actual cost minus the pre-deducted estimate.
      const overflow =
        calculateTokenCost(1000, "input") +
        calculateTokenCost(1000, "output") -
        calculateTokenCost(1000, "input");
      expect(mockDeductFromBalance).toHaveBeenCalledWith("user-123", overflow);
    });

    it("should skip deduction for free tier", async () => {
      const { deductUsage } = getIsolatedModule();

      await deductUsage("user-123", "free", 1000, 1000, 500);

      expect(mockLimitFn).not.toHaveBeenCalled();
    });

    it("should refund when provider cost is less than estimated (over-estimation)", async () => {
      const { deductUsage, calculateTokenCost, RETAIL_MARGIN } =
        getIsolatedModule();

      const estimatedInputTokens = 10000;
      const estimatedCost = calculateTokenCost(estimatedInputTokens, "input");

      // Actual provider cost (small enough that marked-up actual < estimate)
      const providerCostDollars = 0.002;

      await deductUsage(
        "user-123",
        "pro",
        estimatedInputTokens,
        5000, // actual input (ignored when provider cost provided)
        500, // actual output (ignored when provider cost provided)
        undefined,
        providerCostDollars,
      );

      // Provider cost is marked up by RETAIL_MARGIN in production; refund is the
      // difference vs the pre-deducted estimate.
      const expectedRefund =
        estimatedCost - Math.ceil(providerCostDollars * 10000 * RETAIL_MARGIN);
      expect(mockHincrbyFn).toHaveBeenCalledWith(
        expect.stringContaining("usage:monthly"),
        "tokens",
        expectedRefund,
      );
      // Should NOT call limiter to deduct more
      expect(mockLimitFn).not.toHaveBeenCalled();
    });

    it("should refund when token-based actual cost is less than estimated", async () => {
      const { deductUsage, calculateTokenCost } = getIsolatedModule();

      // Estimate: 10000 input tokens = 50 points (pre-deducted)
      const estimatedInputTokens = 10000;
      const estimatedCost = calculateTokenCost(estimatedInputTokens, "input");

      // Actual: 2000 input + 500 output = 10 + 15 = 25 points
      const actualInputTokens = 2000;
      const actualOutputTokens = 500;
      const actualCost =
        calculateTokenCost(actualInputTokens, "input") +
        calculateTokenCost(actualOutputTokens, "output");

      await deductUsage(
        "user-123",
        "pro",
        estimatedInputTokens,
        actualInputTokens,
        actualOutputTokens,
        undefined,
        undefined, // no provider cost, use token calculation
      );

      // Should refund the difference (50 - 25 = 25 points)
      const expectedRefund = estimatedCost - actualCost;
      expect(mockHincrbyFn).toHaveBeenCalledWith(
        expect.stringContaining("usage:monthly"),
        "tokens",
        expectedRefund,
      );
    });

    it("should not refund or charge when actual cost equals estimated", async () => {
      const { deductUsage, calculateTokenCost, RETAIL_MARGIN } =
        getIsolatedModule();

      const estimatedInputTokens = 1000;
      const estimatedCost = calculateTokenCost(estimatedInputTokens, "input");

      // Choose provider cost so the marked-up actual equals the estimate:
      // ceil(providerCost * 10000 * margin) === estimatedCost.
      const providerCostDollars = estimatedCost / 10000 / RETAIL_MARGIN;

      await deductUsage(
        "user-123",
        "pro",
        estimatedInputTokens,
        1000,
        0,
        undefined,
        providerCostDollars,
      );

      // Should neither refund nor charge additional
      expect(mockHincrbyFn).not.toHaveBeenCalled();
      expect(mockLimitFn).not.toHaveBeenCalled();
    });

    it("should charge additional when actual cost exceeds estimated", async () => {
      const { deductUsage, calculateTokenCost } = getIsolatedModule();

      // Estimate: 1000 input tokens = 5 points (pre-deducted)
      const estimatedInputTokens = 1000;

      // Actual provider cost: $0.005 = 50 points (much more than 5)
      const providerCostDollars = 0.005;

      await deductUsage(
        "user-123",
        "pro",
        estimatedInputTokens,
        5000,
        1000,
        undefined,
        providerCostDollars,
      );

      // Should NOT refund
      expect(mockHincrbyFn).not.toHaveBeenCalled();
      // Should charge additional via limiter
      expect(mockLimitFn).toHaveBeenCalled();
    });
  });

  describe("legacy settlement acknowledgment", () => {
    it.each([
      undefined,
      { enabled: false, hasBalance: true, autoReloadEnabled: false },
      { enabled: true, hasBalance: false, autoReloadEnabled: false },
    ])("retains unfunded overflow as unresolved (%j)", async (config) => {
      const { deductUsage } = getIsolatedModule();
      mockLimitFn.mockResolvedValue({ success: true, remaining: 10 });
      await expect(
        deductUsage("user-123", "pro", 0, 1000, 1000, config, 0.05),
      ).rejects.toThrow("Usage overflow has no eligible funding source");
      expect(mockLimitFn).toHaveBeenCalledTimes(2);
      expect(mockDeductFromBalance).not.toHaveBeenCalled();
      expect(mockDeductFromTeamBalance).not.toHaveBeenCalled();
    });

    it.each([false, true])(
      "rejects a declined final bucket debit (team: %s)",
      async (team) => {
        const { deductUsage } = getIsolatedModule();
        mockLimitFn
          .mockResolvedValueOnce({ success: true, remaining: 10 })
          .mockResolvedValueOnce({ success: false, remaining: 0 });
        await expect(
          deductUsage(
            "user-123",
            team ? "team" : "pro",
            0,
            1000,
            1000,
            { enabled: true, hasBalance: true, autoReloadEnabled: false },
            0.05,
            undefined,
            0,
            team ? "org" : undefined,
          ),
        ).rejects.toThrow("Bucket usage adjustment was not confirmed");
        expect(mockLimitFn).toHaveBeenCalledTimes(2);
        expect(mockDeductFromBalance).not.toHaveBeenCalled();
        expect(mockDeductFromTeamBalance).not.toHaveBeenCalled();
      },
    );

    it("propagates an unknown bucket debit without retry", async () => {
      const { deductUsage } = getIsolatedModule();
      mockLimitFn
        .mockResolvedValueOnce({ success: true, remaining: 10000 })
        .mockRejectedValueOnce(new Error("lost debit acknowledgment"));
      await expect(
        deductUsage("user-123", "pro", 0, 1000, 1000),
      ).rejects.toThrow("lost debit acknowledgment");
      expect(mockLimitFn).toHaveBeenCalledTimes(2);
    });

    it("propagates an unknown true-up refund", async () => {
      const { deductUsage } = getIsolatedModule();
      mockHincrbyFn.mockRejectedValueOnce(
        new Error("lost refund acknowledgment"),
      );
      await expect(deductUsage("user-123", "pro", 10000, 0, 0)).rejects.toThrow(
        "lost refund acknowledgment",
      );
      expect(mockHincrbyFn).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])(
      "rejects unconfirmed overflow (team: %s)",
      async (team) => {
        const { deductUsage } = getIsolatedModule();
        mockLimitFn.mockResolvedValue({ success: true, remaining: 0 });
        mockDeductFromBalance.mockResolvedValue({ success: false });
        mockDeductFromTeamBalance.mockResolvedValue({ success: false });
        await expect(
          deductUsage(
            "user-123",
            team ? "team" : "pro",
            0,
            1000,
            1000,
            { enabled: true, hasBalance: true, autoReloadEnabled: false },
            undefined,
            undefined,
            0,
            team ? "org" : undefined,
          ),
        ).rejects.toThrow("usage adjustment was not confirmed");
        expect(
          team ? mockDeductFromTeamBalance : mockDeductFromBalance,
        ).toHaveBeenCalledTimes(1);
      },
    );
  });

  describe("refundUsage", () => {
    it("does not confirm a positive bucket refund when Redis is unavailable", async () => {
      const { refundUsage } = getIsolatedModule();
      mockCreateRedisClient.mockReturnValue(null);
      await expect(refundUsage("user-123", "pro", 50, 0)).rejects.toThrow(
        "Bucket refund was not confirmed",
      );
      expect(mockHincrbyFn).not.toHaveBeenCalled();
    });

    it("waits for the other refund leg after one leg fails", async () => {
      const { refundUsage } = getIsolatedModule();
      mockHincrbyFn.mockRejectedValue(new Error("Bucket acknowledgment lost"));
      let finish!: (value: unknown) => void;
      mockRefundToBalance.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      let settled = false;
      const outcome = refundUsage("user-123", "pro", 50, 50).then(
        () => {
          settled = true;
          return null;
        },
        (e) => {
          settled = true;
          return e;
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(settled).toBe(false);
      finish({ success: true });
      expect(await outcome).toBeInstanceOf(Error);
      expect(mockRefundToBalance).toHaveBeenCalledTimes(1);
    });

    it("rejects an unacknowledged balance refund", async () => {
      const { refundUsage } = getIsolatedModule();
      mockRefundToBalance.mockResolvedValue({ success: false });
      await expect(refundUsage("user-123", "free", 0, 50)).rejects.toThrow();
      expect(mockRefundToBalance).toHaveBeenCalledTimes(1);
    });
    it("rejects a failed bucket refund", async () => {
      const { refundUsage } = getIsolatedModule();
      mockHincrbyFn.mockRejectedValue(new Error("Lost bucket receipt"));
      await expect(refundUsage("user-123", "pro", 50, 0)).rejects.toThrow();
      expect(mockHincrbyFn).toHaveBeenCalledTimes(1);
    });

    it("should refund bucket tokens via Redis hincrby", async () => {
      const { refundUsage } = getIsolatedModule();

      await refundUsage("user-123", "pro", 1000, 0);

      expect(mockHincrbyFn).toHaveBeenCalledWith(
        expect.stringContaining("usage:monthly"),
        "tokens",
        1000,
      );
    });

    it("should refund extra usage balance when provided", async () => {
      const { refundUsage } = getIsolatedModule();

      await refundUsage("user-123", "pro", 1000, 500);

      expect(mockRefundToBalance).toHaveBeenCalledWith("user-123", 500);
    });

    it("should not refund if no points deducted", async () => {
      const { refundUsage } = getIsolatedModule();

      await refundUsage("user-123", "pro", 0, 0);

      expect(mockHincrbyFn).not.toHaveBeenCalled();
      expect(mockRefundToBalance).not.toHaveBeenCalled();
    });

    it("should cap refunded tokens at bucket limit", async () => {
      const { refundUsage, getBudgetLimits } = getIsolatedModule();
      const { monthly: monthlyLimit } = getBudgetLimits("pro");

      mockHincrbyFn.mockResolvedValue(monthlyLimit + 10000);

      await refundUsage("user-123", "pro", 50000, 0);

      expect(mockHsetFn).toHaveBeenCalled();
    });
  });

  describe("resetRateLimitBuckets", () => {
    it("should delete the monthly Redis key and set explicit TTL", async () => {
      const { resetRateLimitBuckets } = getIsolatedModule();

      await resetRateLimitBuckets("user-123", "pro");

      expect(mockDelFn).toHaveBeenCalledWith("usage:monthly:user-123:pro");
      // Verify explicit 30-day TTL is set
      expect(mockExpireFn).toHaveBeenCalledWith(
        "usage:monthly:user-123:pro",
        30 * 24 * 60 * 60,
      );
    });

    it("should not throw when Redis delete fails", async () => {
      const { resetRateLimitBuckets } = getIsolatedModule();

      mockDelFn.mockRejectedValue(new Error("Redis down"));
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await expect(
        resetRateLimitBuckets("user-123", "pro"),
      ).resolves.toBeUndefined();

      consoleSpy.mockRestore();
    });
  });

  describe("deductUsage - split deduction (peek-then-deduct)", () => {
    it("should deduct overflow from extra usage when bucket has insufficient balance", async () => {
      const { deductUsage, calculateTokenCost, RETAIL_MARGIN } =
        getIsolatedModule();

      // Peek: bucket has 10 remaining
      mockLimitFn.mockResolvedValueOnce({
        success: true,
        remaining: 10,
        reset: Date.now() + 3600000,
        limit: 250000,
      });
      // Deduct fromBucket (10) from bucket
      mockLimitFn.mockResolvedValueOnce({
        success: true,
        remaining: 0,
        reset: Date.now() + 3600000,
        limit: 250000,
      });

      const providerCostDollars = 0.005;
      await deductUsage(
        "user-123",
        "pro",
        1000,
        5000,
        1000,
        { enabled: true, hasBalance: true, autoReloadEnabled: false },
        providerCostDollars,
      );

      // Should peek first (rate: 0), then deduct only what bucket can cover (rate: 10)
      expect(mockLimitFn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ rate: 0 }),
      );
      expect(mockLimitFn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ rate: 10 }),
      );
      // Overflow = marked-up actual − pre-deducted estimate − what the bucket covered (10).
      const actualCost = Math.ceil(providerCostDollars * 10000 * RETAIL_MARGIN);
      const overflow = actualCost - calculateTokenCost(1000, "input") - 10;
      expect(mockDeductFromBalance).toHaveBeenCalledWith("user-123", overflow);
    });

    it("should not call extra usage when bucket covers the full amount", async () => {
      const { deductUsage } = getIsolatedModule();

      // Peek: bucket has plenty remaining (well above any margin-scaled cost)
      mockLimitFn.mockResolvedValueOnce({
        success: true,
        remaining: 100_000,
        reset: Date.now() + 3600000,
        limit: 250000,
      });
      // Deduct the full additional cost from the bucket — leaves plenty.
      mockLimitFn.mockResolvedValueOnce({
        success: true,
        remaining: 99_000,
        reset: Date.now() + 3600000,
        limit: 250000,
      });

      await deductUsage(
        "user-123",
        "pro",
        1000,
        5000,
        1000,
        { enabled: true, hasBalance: true, autoReloadEnabled: false },
        0.005,
      );

      expect(mockDeductFromBalance).not.toHaveBeenCalled();
    });
  });

  describe("concurrent deduction safety", () => {
    it("should reject a concurrent check when its final deduction fails", async () => {
      const { checkTokenBucketLimit, calculateTokenCost } = getIsolatedModule();

      // Peek shows exactly enough for one request (sized to the current cost).
      const oneRequestCost = calculateTokenCost(1000, "input");

      // Simulate two concurrent requests seeing the same bucket state
      let deductionCalls = 0;
      let callCount = 0;
      mockLimitFn.mockImplementation(
        async (_key: string, opts: { rate: number }) => {
          callCount++;
          // Peek calls (rate: 0) return enough remaining for one request.
          if (opts.rate === 0) {
            return {
              success: true,
              remaining: oneRequestCost,
              reset: Date.now() + 3600000,
              limit: 250000,
            };
          }

          deductionCalls++;
          if (deductionCalls === 1) {
            return {
              success: true,
              remaining: 0,
              reset: Date.now() + 3600000,
              limit: 250000,
            };
          }

          return {
            success: false,
            remaining: 0,
            reset: Date.now() + 3600000,
            limit: 250000,
          };
        },
      );

      // Run two concurrent checks
      const results = await Promise.allSettled([
        checkTokenBucketLimit("user-123", "pro", 1000),
        checkTokenBucketLimit("user-123", "pro", 1000),
      ]);

      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      // Limiter was called for both requests (peek + deduct each)
      expect(callCount).toBeGreaterThanOrEqual(4);
    });
  });

  describe("provider cost vs token cost paths", () => {
    it("should produce different deductions when provider cost differs from token calculation", async () => {
      const { deductUsage, calculateTokenCost } = getIsolatedModule();

      const estimatedInput = 10000;
      const estimatedCost = calculateTokenCost(estimatedInput, "input");

      // Path 1: token-based (actual = 10000 input + 1000 output)
      const tokenActualCost =
        calculateTokenCost(10000, "input") + calculateTokenCost(1000, "output");

      // Path 2: provider cost ($0.01 = 100 points)
      const providerCost = 0.01;
      const providerCostPoints = Math.ceil(providerCost * 10000);

      // These should differ
      expect(tokenActualCost).not.toBe(providerCostPoints);

      // Both paths should execute without error
      await deductUsage("user-123", "pro", estimatedInput, 10000, 1000);
      mockLimitFn.mockClear();
      mockHincrbyFn.mockClear();

      await deductUsage(
        "user-123",
        "pro",
        estimatedInput,
        10000,
        1000,
        undefined,
        providerCost,
      );
    });
  });

  describe("end-to-end scenarios", () => {
    it("typical conversation flow: check -> deduct -> complete", async () => {
      const { checkTokenBucketLimit, deductUsage } = getIsolatedModule();

      const rateLimitInfo = await checkTokenBucketLimit(
        "user-123",
        "pro",
        2000,
      );
      expect(rateLimitInfo.pointsDeducted).toBeDefined();

      await deductUsage("user-123", "pro", 2000, 2500, 800);

      expect(mockLimitFn.mock.calls.length).toBeGreaterThan(2);
    });

    it("failed request flow: check -> error -> refund", async () => {
      const { checkTokenBucketLimit, refundUsage } = getIsolatedModule();

      const rateLimitInfo = await checkTokenBucketLimit(
        "user-123",
        "pro",
        2000,
      );
      const deducted = rateLimitInfo.pointsDeducted ?? 0;

      await refundUsage("user-123", "pro", deducted, 0);

      expect(mockHincrbyFn).toHaveBeenCalledWith(
        expect.any(String),
        "tokens",
        deducted,
      );
    });
  });

  // ==========================================================================
  // checkBalanceLimit — PAYG pre-flight (free allowance exhausted)
  // ==========================================================================
  describe("checkBalanceLimit", () => {
    const cfg = { enabled: true, hasBalance: true, autoReloadEnabled: false };

    it("pre-charges the estimated input cost to the balance and reports servedFrom=balance", async () => {
      const { checkBalanceLimit, calculateTokenCost } = getIsolatedModule();

      mockDeductFromBalance.mockResolvedValueOnce({
        success: true,
        newBalanceDollars: 9.5,
        insufficientFunds: false,
        monthlyCapExceeded: false,
      });

      const result = await checkBalanceLimit("user-123", 1000, "model-x", cfg);

      const estimate = calculateTokenCost(1000, "input", "model-x");
      expect(mockDeductFromBalance).toHaveBeenCalledWith("user-123", estimate);
      expect(result.servedFrom).toBe("balance");
      expect(result.pointsDeducted).toBe(estimate);
      expect(result.extraUsagePointsDeducted).toBe(estimate);
      // remaining derived from newBalanceDollars × POINTS_PER_DOLLAR
      expect(result.remaining).toBe(95_000);
    });

    it("throws 'buy tokens' when there is no balance and no auto-reload", async () => {
      const { checkBalanceLimit } = getIsolatedModule();

      try {
        await checkBalanceLimit("user-123", 1000, "model-x", {
          enabled: true,
          hasBalance: false,
          autoReloadEnabled: false,
        });
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error.cause).toContain("out of tokens");
      }
      expect(mockDeductFromBalance).not.toHaveBeenCalled();
    });

    it("throws 'buy tokens' when the config is undefined (no funding)", async () => {
      const { checkBalanceLimit } = getIsolatedModule();

      await expect(
        checkBalanceLimit("user-123", 1000, "model-x", undefined),
      ).rejects.toMatchObject({ type: "rate_limit" });
      expect(mockDeductFromBalance).not.toHaveBeenCalled();
    });

    it("throws 'buy tokens' when the deduction reports insufficient funds", async () => {
      const { checkBalanceLimit } = getIsolatedModule();

      mockDeductFromBalance.mockResolvedValueOnce({
        success: false,
        newBalanceDollars: 0,
        insufficientFunds: true,
        monthlyCapExceeded: false,
      });

      try {
        await checkBalanceLimit("user-123", 1000, "model-x", cfg);
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error.cause).toContain("out of tokens");
      }
    });

    it("allows auto-reload users with $0 balance to proceed", async () => {
      const { checkBalanceLimit } = getIsolatedModule();

      mockDeductFromBalance.mockResolvedValueOnce({
        success: true,
        newBalanceDollars: 0,
        insufficientFunds: false,
        monthlyCapExceeded: false,
      });

      const result = await checkBalanceLimit("user-123", 1000, "model-x", {
        enabled: true,
        hasBalance: false,
        autoReloadEnabled: true,
      });

      expect(result.servedFrom).toBe("balance");
      expect(mockDeductFromBalance).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // deductBalanceUsage — PAYG post-stream true-up against the balance
  // ==========================================================================
  describe("deductBalanceUsage", () => {
    it("reports an unconfirmed debit without replaying it", async () => {
      const { deductBalanceUsage } = getIsolatedModule();
      mockDeductFromBalance.mockResolvedValue({ success: false });
      await expect(
        deductBalanceUsage("user-123", 0, 1000, 5000, 0.01, "model-x"),
      ).rejects.toThrow("Balance usage adjustment was not confirmed");
      expect(mockDeductFromBalance).toHaveBeenCalledTimes(1);
      expect(mockRefundToBalance).not.toHaveBeenCalled();
    });

    it("reports an unconfirmed refund without replaying it", async () => {
      const { deductBalanceUsage } = getIsolatedModule();
      mockRefundToBalance.mockResolvedValue({ success: false });
      await expect(
        deductBalanceUsage("user-123", 1000, 0, 0, 0, "model-x"),
      ).rejects.toThrow("Balance usage adjustment was not confirmed");
      expect(mockRefundToBalance).toHaveBeenCalledTimes(1);
      expect(mockDeductFromBalance).not.toHaveBeenCalled();
    });

    it("preserves transport failure instead of returning successful settlement", async () => {
      const { deductBalanceUsage } = getIsolatedModule();
      const error = new Error("Acknowledgment lost");
      mockDeductFromBalance.mockRejectedValue(error);
      await expect(
        deductBalanceUsage("user-123", 0, 1000, 5000, 0.01, "model-x"),
      ).rejects.toBe(error);
      expect(mockDeductFromBalance).toHaveBeenCalledTimes(1);
    });

    it("charges the difference between actual cost and the pre-charged input estimate", async () => {
      const {
        deductBalanceUsage,
        calculateTokenCost,
        computeActualCostPoints,
      } = getIsolatedModule();

      // estimate = input(1000); actual = input(1000)+output(5000) via tokens
      await deductBalanceUsage(
        "user-123",
        1000, // estimatedInputTokens (pre-charged)
        1000, // actualInputTokens
        5000, // actualOutputTokens
        undefined, // no providerCost → token-based path
        "model-x",
        0,
      );

      const estimate = calculateTokenCost(1000, "input", "model-x");
      const actual = computeActualCostPoints({
        actualInputTokens: 1000,
        actualOutputTokens: 5000,
        providerCostDollars: undefined,
        modelName: "model-x",
        nonModelCostDollars: 0,
      });
      expect(mockDeductFromBalance).toHaveBeenCalledWith(
        "user-123",
        actual - estimate,
      );
      expect(mockRefundToBalance).not.toHaveBeenCalled();
    });

    it("refunds the balance when the pre-charged estimate exceeded the actual cost", async () => {
      const {
        deductBalanceUsage,
        calculateTokenCost,
        computeActualCostPoints,
      } = getIsolatedModule();

      // Pre-charged a big input estimate; actual turned out tiny.
      await deductBalanceUsage(
        "user-123",
        100_000, // estimatedInputTokens (over-estimate)
        100, // actualInputTokens
        0, // actualOutputTokens
        undefined,
        "model-x",
        0,
      );

      const estimate = calculateTokenCost(100_000, "input", "model-x");
      const actual = computeActualCostPoints({
        actualInputTokens: 100,
        actualOutputTokens: 0,
        providerCostDollars: undefined,
        modelName: "model-x",
        nonModelCostDollars: 0,
      });
      expect(mockRefundToBalance).toHaveBeenCalledWith(
        "user-123",
        estimate - actual,
      );
      expect(mockDeductFromBalance).not.toHaveBeenCalled();
    });

    it("uses the marked-up provider cost when available (clean completion)", async () => {
      const { deductBalanceUsage, calculateTokenCost } = getIsolatedModule();
      const { RETAIL_MARGIN, POINTS_PER_DOLLAR } = getIsolatedModule();

      const providerCostDollars = 0.01;
      await deductBalanceUsage(
        "user-123",
        1000,
        1000,
        5000,
        providerCostDollars,
        "model-x",
        0,
      );

      const estimate = calculateTokenCost(1000, "input", "model-x");
      const actual = Math.ceil(
        providerCostDollars * POINTS_PER_DOLLAR * RETAIL_MARGIN,
      );
      expect(mockDeductFromBalance).toHaveBeenCalledWith(
        "user-123",
        actual - estimate,
      );
    });

    it("does nothing when actual cost equals the pre-charged estimate", async () => {
      const { deductBalanceUsage } = getIsolatedModule();

      // input-only request: estimate == actual (both = input(1000))
      await deductBalanceUsage(
        "user-123",
        1000,
        1000,
        0,
        undefined,
        "model-x",
        0,
      );

      expect(mockDeductFromBalance).not.toHaveBeenCalled();
      expect(mockRefundToBalance).not.toHaveBeenCalled();
    });
  });
});
