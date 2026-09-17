import { SummarizationTracker } from "@/lib/api/chat-stream-helpers";
import { UsageTracker } from "@/lib/usage-tracker";

jest.mock("@/lib/db/actions", () => ({
  getNotes: jest.fn(),
  logUsageRecord: jest.fn(),
}));

jest.mock("@/lib/chat/summarization", () => ({
  checkAndSummarizeIfNeeded: jest.fn(),
}));

const recordArgs = {
  selectedModel: "model-default",
  configuredModelId: "model-default",
  rateLimitInfo: {
    remaining: 1000,
    resetTime: new Date(),
    limit: 250000,
    pointsDeducted: 100,
  },
};

describe("summarization usage totals", () => {
  it("includes repeated summaries in totals while keeping response output and provider costs separate", () => {
    const tracker = new UsageTracker();
    const summaries = new SummarizationTracker();
    tracker.accumulateStep({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      raw: { cost: 0.01 },
    });
    summaries.recordSummarization(
      1,
      {
        inputTokens: 50,
        outputTokens: 20,
        cacheReadTokens: 30,
        cacheWriteTokens: 10,
        cost: 0.003,
      },
      tracker,
    );
    summaries.recordSummarization(
      2,
      { inputTokens: 10, outputTokens: 5, cost: 0.001 },
      tracker,
    );

    expect(tracker.totalTokens).toBe(235);
    expect(tracker.streamOutputTokens).toBe(50);
    expect(tracker.lastStepInputTokens).toBe(100);
    expect(tracker.modelProviderCost).toBe(0.01);
    expect(tracker.createUsageCostRecord(recordArgs)).toMatchObject({
      inputTokens: 160,
      outputTokens: 75,
      totalTokens: 235,
      cacheReadTokens: 30,
      cacheWriteTokens: 10,
      costSource: "provider",
    });
    expect(tracker.computeCostDollars("model-default")).toBeCloseTo(0.014);
  });

  it("records summary-only totals without treating summary cost as a reported model-step cost", () => {
    const tracker = new UsageTracker();
    new SummarizationTracker().recordSummarization(
      0,
      { inputTokens: 50, outputTokens: 20, cost: 0.003 },
      tracker,
    );

    expect(tracker.totalTokens).toBe(70);
    expect(tracker.streamOutputTokens).toBe(0);
    expect(tracker.hasModelProviderCost).toBe(false);
    expect(tracker.createUsageCostRecord(recordArgs)).toMatchObject({
      totalTokens: 70,
      costSource: "provider",
    });
  });

  it("preserves the existing model-leg reset policy before accumulating fallback totals", () => {
    const tracker = new UsageTracker();
    tracker.accumulateStep({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      raw: { cost: 0.01 },
    });
    new SummarizationTracker().recordSummarization(
      1,
      { inputTokens: 50, outputTokens: 20, cost: 0.003 },
      tracker,
    );
    tracker.resetModelLeg();

    expect(tracker.inputTokens).toBe(0);
    expect(tracker.totalTokens).toBe(20);
    expect(tracker.streamOutputTokens).toBe(0);
    expect(tracker.providerCost).toBeCloseTo(0.003);
    expect(tracker.hasModelProviderCost).toBe(false);

    tracker.accumulateStep({ inputTokens: 30, outputTokens: 10 });
    expect(tracker.totalTokens).toBe(60);
    expect(tracker.streamOutputTokens).toBe(10);
    expect(tracker.createUsageCostRecord(recordArgs)).toMatchObject({
      totalTokens: 60,
      costSource: "token_estimate",
    });
  });

  it("does not change usage when a summary has no usage data", () => {
    const tracker = new UsageTracker();
    tracker.accumulateStep({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
    new SummarizationTracker().recordSummarization(1, undefined, tracker);

    expect(tracker.totalTokens).toBe(150);
    expect(tracker.streamOutputTokens).toBe(50);
  });
});
