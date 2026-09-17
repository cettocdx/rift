import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { UsageTracker } from "../usage-tracker";

// Usage telemetry records raw provider/base dollars consistently.
const ONE_M_DEFAULT_INPUT_DOLLARS = 0.5;

describe("UsageTracker", () => {
  let tracker: UsageTracker;

  beforeEach(() => {
    tracker = new UsageTracker();
    jest.clearAllMocks();
  });

  describe("accumulateStep", () => {
    it("should sum tokens across multiple steps", () => {
      tracker.accumulateStep({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });
      tracker.accumulateStep({
        inputTokens: 200,
        outputTokens: 75,
        totalTokens: 275,
      });

      expect(tracker.inputTokens).toBe(300);
      expect(tracker.outputTokens).toBe(125);
      expect(tracker.totalTokens).toBe(425);
    });

    it.each([true, false])(
      "derives each missing total when the reported-total step is first: %s",
      (reportedFirst) => {
        const reported = {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        };
        const missing = { inputTokens: 200, outputTokens: 75 };
        for (const usage of reportedFirst
          ? [reported, missing]
          : [missing, reported]) {
          tracker.accumulateStep(usage);
        }

        expect(tracker.totalTokens).toBe(425);
        expect(
          tracker.createUsageCostRecord({
            selectedModel: "model-default",
            configuredModelId: "model-default",
            rateLimitInfo: {
              remaining: 1000,
              resetTime: new Date(),
              limit: 250000,
              pointsDeducted: 100,
            },
          }).totalTokens,
        ).toBe(425);
      },
    );

    it("derives missing totals from available input and output without adding token details again", () => {
      tracker.accumulateStep({ inputTokens: 100 });
      tracker.accumulateStep({ outputTokens: 20 });
      tracker.accumulateStep({
        inputTokens: 50,
        outputTokens: 30,
        inputTokenDetails: { cacheReadTokens: 40, cacheWriteTokens: 10 },
        outputTokenDetails: { reasoningTokens: 15 },
      });
      tracker.accumulateStep({});

      expect(tracker.totalTokens).toBe(200);
    });

    it("preserves supplied totals including zero instead of deriving them", () => {
      tracker.accumulateStep({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 160,
      });
      tracker.accumulateStep({
        inputTokens: 20,
        outputTokens: 10,
        totalTokens: 0,
      });

      expect(tracker.totalTokens).toBe(160);
    });

    it("should accumulate cache tokens", () => {
      tracker.accumulateStep({
        inputTokens: 100,
        outputTokens: 50,
        inputTokenDetails: { cacheReadTokens: 30, cacheWriteTokens: 10 },
      });
      tracker.accumulateStep({
        inputTokens: 100,
        outputTokens: 50,
        inputTokenDetails: { cacheReadTokens: 20 },
      });

      expect(tracker.cacheReadTokens).toBe(50);
      expect(tracker.cacheWriteTokens).toBe(10);
    });

    it("should accumulate provider cost", () => {
      tracker.accumulateStep({
        inputTokens: 100,
        outputTokens: 50,
        raw: { cost: 0.001 },
      });
      tracker.accumulateStep({
        inputTokens: 100,
        outputTokens: 50,
        raw: { cost: 0.002 },
      });

      expect(tracker.providerCost).toBeCloseTo(0.003);
    });

    it("should track lastStepInputTokens from most recent step", () => {
      tracker.accumulateStep({ inputTokens: 100, outputTokens: 0 });
      tracker.accumulateStep({ inputTokens: 200, outputTokens: 0 });

      expect(tracker.lastStepInputTokens).toBe(200);
    });

    it("should handle missing fields gracefully", () => {
      tracker.accumulateStep({});

      expect(tracker.inputTokens).toBe(0);
      expect(tracker.outputTokens).toBe(0);
      expect(tracker.providerCost).toBe(0);
    });
  });

  describe("streamOutputTokens", () => {
    it("should exclude summarization tokens from output", () => {
      tracker.accumulateStep({ inputTokens: 0, outputTokens: 500 });
      tracker.summarizationOutputTokens = 100;

      expect(tracker.streamOutputTokens).toBe(400);
    });

    it("should return all output tokens when no summarization", () => {
      tracker.accumulateStep({ inputTokens: 0, outputTokens: 500 });

      expect(tracker.streamOutputTokens).toBe(500);
    });
  });

  describe("hasUsage", () => {
    it("should return false when all zeros", () => {
      expect(tracker.hasUsage).toBe(false);
    });

    it("should return true when inputTokens > 0", () => {
      tracker.accumulateStep({ inputTokens: 1 });
      expect(tracker.hasUsage).toBe(true);
    });

    it("should return true when outputTokens > 0", () => {
      tracker.accumulateStep({ outputTokens: 1 });
      expect(tracker.hasUsage).toBe(true);
    });

    it("should return true when providerCost > 0", () => {
      tracker.accumulateStep({ raw: { cost: 0.001 } });
      expect(tracker.hasUsage).toBe(true);
    });
  });

  describe("cacheHitRate", () => {
    it("includes summary receipt coverage in the aggregate ratio", () => {
      tracker.accumulateStep({
        inputTokens: 100,
        inputTokenDetails: { cacheReadTokens: 80 },
      });
      tracker.accumulateSummary({ inputTokens: 100, outputTokens: 10 });
      expect(tracker.cacheHitRate).toBeNull();
    });
    it("should return null when no cache data", () => {
      expect(tracker.cacheHitRate).toBeNull();
    });

    it("should return null when both cache tokens are zero", () => {
      tracker.accumulateStep({ inputTokens: 100, outputTokens: 50 });
      expect(tracker.cacheHitRate).toBeNull();
    });

    it("should compute the fraction of total input served from cache", () => {
      tracker.accumulateStep({
        inputTokens: 100,
        inputTokenDetails: { cacheReadTokens: 80, cacheWriteTokens: 20 },
      });
      expect(tracker.cacheHitRate).toBe(0.8);
    });

    it("should return 0 when all writes and no reads", () => {
      tracker.accumulateStep({
        inputTokens: 100,
        inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 50 },
      });
      expect(tracker.cacheHitRate).toBe(0);
    });

    it("should return 1 when all reads and no writes", () => {
      tracker.accumulateStep({
        inputTokens: 100,
        inputTokenDetails: { cacheReadTokens: 100, cacheWriteTokens: 0 },
      });
      expect(tracker.cacheHitRate).toBe(1);
    });

    it("does not report a perfect hit when most input is uncached", () => {
      tracker.accumulateStep({
        inputTokens: 10_000,
        inputTokenDetails: { cacheReadTokens: 100 },
      });
      expect(tracker.cacheHitRate).toBe(0.01);
    });

    it("leaves missing or inconsistent input coverage unknown", () => {
      tracker.accumulateStep({ inputTokenDetails: { cacheReadTokens: 100 } });
      expect(tracker.cacheHitRate).toBeNull();
      tracker.accumulateStep({ inputTokens: 50 });
      expect(tracker.cacheHitRate).toBeNull();
    });

    it("does not hide a missing input total behind later complete receipts", () => {
      tracker.accumulateStep({ inputTokenDetails: { cacheReadTokens: 100 } });
      tracker.accumulateStep({
        inputTokens: 1000,
        inputTokenDetails: { cacheReadTokens: 0 },
      });
      expect(tracker.cacheHitRate).toBeNull();
    });

    it("does not count missing cache metadata as a confirmed cache miss", () => {
      tracker.accumulateStep({
        inputTokens: 100,
        inputTokenDetails: { cacheReadTokens: 80 },
      });
      tracker.accumulateStep({ inputTokens: 100 });
      expect(tracker.cacheHitRate).toBeNull();
      tracker.resetModelLeg();
      tracker.accumulateStep({
        inputTokens: 100,
        inputTokenDetails: { cacheReadTokens: 50 },
      });
      expect(tracker.cacheHitRate).toBe(0.5);
    });

    it("reports only the retained fallback leg after reset", () => {
      tracker.accumulateStep({
        inputTokens: 10000,
        inputTokenDetails: { cacheReadTokens: 9000 },
      });
      tracker.resetModelLeg();
      tracker.accumulateStep({
        inputTokens: 200,
        inputTokenDetails: { cacheReadTokens: 20 },
      });
      expect(tracker.cacheReadTokens).toBe(20);
      expect(tracker.cacheHitRate).toBe(0.1);
    });

    it("should accumulate across steps", () => {
      tracker.accumulateStep({
        inputTokens: 100,
        inputTokenDetails: { cacheReadTokens: 60, cacheWriteTokens: 40 },
      });
      tracker.accumulateStep({
        inputTokens: 100,
        inputTokenDetails: { cacheReadTokens: 40, cacheWriteTokens: 10 },
      });
      // total: reads=100, input=200 → rate = 0.5
      expect(tracker.cacheHitRate).toBe(0.5);
    });
  });

  describe("hasCacheData", () => {
    it("should return false when no cache tokens", () => {
      expect(tracker.hasCacheData).toBe(false);
    });

    it("should return true when cache read tokens exist", () => {
      tracker.accumulateStep({
        inputTokens: 100,
        inputTokenDetails: { cacheReadTokens: 10 },
      });
      expect(tracker.hasCacheData).toBe(true);
    });

    it("should return true when cache write tokens exist", () => {
      tracker.accumulateStep({
        inputTokens: 100,
        inputTokenDetails: { cacheWriteTokens: 10 },
      });
      expect(tracker.hasCacheData).toBe(true);
    });
  });

  describe("computeCostDollars", () => {
    it("should use providerCost when available", () => {
      tracker.accumulateStep({
        inputTokens: 1000,
        outputTokens: 500,
        raw: { cost: 0.05 },
      });

      expect(tracker.computeCostDollars("model-default")).toBe(0.05);
    });

    it("should fall back to token calculation when no provider cost", () => {
      tracker.accumulateStep({ inputTokens: 1_000_000, outputTokens: 0 });

      const cost = tracker.computeCostDollars("model-default");
      // 1M input tokens at the raw $0.50/1M price
      expect(cost).toBeCloseTo(ONE_M_DEFAULT_INPUT_DOLLARS, 5);
    });

    it("should include non-model costs when provider cost is unavailable", () => {
      tracker.accumulateStep({ inputTokens: 1_000_000, outputTokens: 0 });
      tracker.nonModelCost = 0.25;

      expect(tracker.computeCostDollars("model-default")).toBeCloseTo(
        ONE_M_DEFAULT_INPUT_DOLLARS + 0.25,
        5,
      );
    });

    it("should use token-based model cost + nonModelCost when modelProviderCost is 0 but providerCost is positive from sandbox/tool spend (post-resetModelLeg scenario)", () => {
      // Simulate the state after resetModelLeg() has stripped the primary
      // leg's model cost and the fallback leg ran without reporting raw.cost.
      tracker.accumulateStep({ inputTokens: 1_000_000, outputTokens: 0 });
      tracker.providerCost = 0.25; // nonModelCost baked in
      tracker.nonModelCost = 0.25;
      // modelProviderCost stays 0 because the fallback provider didn't emit cost.

      // Must include BOTH the token-based model cost AND the sandbox spend
      // (0.25). The old implementation returned just providerCost = 0.25.
      expect(tracker.computeCostDollars("model-default")).toBeCloseTo(
        ONE_M_DEFAULT_INPUT_DOLLARS + 0.25,
        5,
      );
    });
  });

  describe("resolveUsageType", () => {
    it("should return 'extra' when extraUsagePointsDeducted > 0", () => {
      const result = tracker.resolveUsageType({
        remaining: 0,
        resetTime: new Date(),
        limit: 250000,
        pointsDeducted: 100,
        extraUsagePointsDeducted: 50,
      });
      expect(result).toBe("extra");
    });

    it("should return 'included' when no extra usage", () => {
      const result = tracker.resolveUsageType({
        remaining: 1000,
        resetTime: new Date(),
        limit: 250000,
        pointsDeducted: 100,
      });
      expect(result).toBe("included");
    });

    it("should return 'included' when extraUsagePointsDeducted is 0", () => {
      const result = tracker.resolveUsageType({
        remaining: 1000,
        resetTime: new Date(),
        limit: 250000,
        pointsDeducted: 100,
        extraUsagePointsDeducted: 0,
      });
      expect(result).toBe("included");
    });
  });

  describe("resolveModelName", () => {
    it("should return 'auto' when no override or override is 'auto'", () => {
      expect(
        tracker.resolveModelName({
          configuredModelId: "model-x",
          selectedModel: "model-y",
        }),
      ).toBe("auto");

      expect(
        tracker.resolveModelName({
          selectedModelOverride: "auto",
          configuredModelId: "model-x",
          selectedModel: "model-y",
        }),
      ).toBe("auto");
    });

    it("should prefer responseModel when override is set", () => {
      expect(
        tracker.resolveModelName({
          selectedModelOverride: "model-custom",
          responseModel: "model-response",
          configuredModelId: "model-config",
          selectedModel: "model-selected",
        }),
      ).toBe("model-response");
    });

    it("should fall back to configuredModelId", () => {
      expect(
        tracker.resolveModelName({
          selectedModelOverride: "model-custom",
          configuredModelId: "model-config",
          selectedModel: "model-selected",
        }),
      ).toBe("model-config");
    });

    it("should fall back to selectedModel as last resort", () => {
      expect(
        tracker.resolveModelName({
          selectedModelOverride: "model-custom",
          configuredModelId: "",
          selectedModel: "model-selected",
        }),
      ).toBe("model-selected");
    });
  });

  describe("log", () => {
    it("should call logUsageRecord with resolved values", () => {
      const localMockLog = jest.fn();

      let IsolatedTracker: typeof UsageTracker;
      jest.isolateModules(() => {
        jest.doMock("@/lib/db/actions", () => ({
          logUsageRecord: localMockLog,
        }));
        jest.doMock("@/lib/rate-limit", () => ({
          calculateTokenCost: jest.fn(),
          POINTS_PER_DOLLAR: 10_000,
        }));
        IsolatedTracker = require("../usage-tracker").UsageTracker;
      });

      const t = new IsolatedTracker!();
      t.accumulateStep({
        inputTokens: 1000,
        outputTokens: 500,
        raw: { cost: 0.01 },
      });

      t.log({
        userId: "user-123",
        selectedModel: "model-default",
        configuredModelId: "model-config",
        rateLimitInfo: {
          remaining: 1000,
          resetTime: new Date(),
          limit: 250000,
          pointsDeducted: 100,
        },
      });

      expect(localMockLog).toHaveBeenCalledWith({
        userId: "user-123",
        organizationId: undefined,
        chatId: undefined,
        endpoint: undefined,
        mode: undefined,
        subscription: undefined,
        model: "auto",
        type: "included",
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
        costDollars: 0.01,
        modelCostDollars: 0.01,
        nonModelCostDollars: 0,
        costSource: "provider",
      });
    });
  });
});

describe("UsageTracker — reasoning tokens", () => {
  // Recorded, not billed: whether output tokens already include reasoning is
  // provider-specific, and when raw.cost is present the provider's total wins.
  // Without this counter the estimate path could not even be audited.
  it("accumulates reasoning tokens from either provider shape", () => {
    const tracker = new UsageTracker();
    tracker.accumulateStep({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      outputTokenDetails: { reasoningTokens: 40 },
    });
    tracker.accumulateStep({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      reasoningTokens: 2,
    });
    expect(tracker.reasoningTokens).toBe(42);
  });

  it("leaves the counter at zero when nothing is reported", () => {
    const tracker = new UsageTracker();
    tracker.accumulateStep({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
    expect(tracker.reasoningTokens).toBe(0);
  });
});
