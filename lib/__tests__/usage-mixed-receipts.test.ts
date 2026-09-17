import { UsageTracker } from "../usage-tracker";
import { SummarizationTracker } from "../api/chat-stream-helpers";
import {
  computeActualCostPoints,
  POINTS_PER_DOLLAR,
  RETAIL_MARGIN,
} from "../rate-limit/token-bucket";
jest.mock("../db/actions", () => ({
  logUsageRecord: jest.fn(),
  getNotes: jest.fn(),
}));
jest.mock("../chat/summarization", () => ({
  checkAndSummarizeIfNeeded: jest.fn(),
}));
const model = "model-grok-4.3";
const record = (tracker: UsageTracker) =>
  tracker.createUsageCostRecord({
    selectedModel: model,
    configuredModelId: model,
    rateLimitInfo: {
      remaining: 1,
      limit: 1,
      pointsDeducted: 0,
      resetTime: new Date(),
    },
  });

it.each([0, 0.2])(
  "keeps the %s provider receipt and estimates only the unpriced step",
  (cost) => {
    const usage = new UsageTracker();
    usage.accumulateStep({
      inputTokens: 500_000,
      outputTokens: 0,
      raw: { cost },
    });
    usage.accumulateStep({ inputTokens: 500_000, outputTokens: 0 });
    expect(usage.hasModelProviderCost).toBe(false);
    expect(usage.computeCostDollars(model)).toBeCloseTo(cost + 0.625);
    expect(record(usage)).toMatchObject({
      costSource: "token_estimate",
      costDollars: cost + 0.625,
    });
  },
);

it("adds a priced summary once while estimating an unpriced response", () => {
  const usage = new UsageTracker();
  usage.accumulateStep({ inputTokens: 1_000_000, outputTokens: 0 });
  new SummarizationTracker().recordSummarization(
    1,
    { inputTokens: 100_000, outputTokens: 50, cost: 0.01 },
    usage,
  );
  expect(usage.computeCostDollars(model)).toBeCloseTo(1.26);
  expect(record(usage).costSource).toBe("token_estimate");
});

it("does not drop an unpriced summary when the main response reports its price", () => {
  const usage = new UsageTracker();
  usage.accumulateStep({
    inputTokens: 1_000_000,
    outputTokens: 0,
    raw: { cost: 0.1 },
  });
  new SummarizationTracker().recordSummarization(
    1,
    { inputTokens: 100_000, outputTokens: 0 },
    usage,
  );
  expect(usage.computeCostDollars(model)).toBeCloseTo(0.225);
  expect(record(usage).costSource).toBe("token_estimate");
});

it("preserves a zero-priced summary and non-model charges without repricing its tokens", () => {
  const usage = new UsageTracker();
  new SummarizationTracker().recordSummarization(
    0,
    { inputTokens: 1_000_000, outputTokens: 20, cost: 0 },
    usage,
  );
  usage.providerCost += 0.25;
  usage.nonModelCost += 0.25;
  expect(usage.computeCostDollars(model)).toBe(0.25);
  expect(record(usage).costSource).toBe("provider");
});

it("uses the same resolved total for logging and one-margin settlement", () => {
  const usage = new UsageTracker();
  usage.accumulateStep({
    inputTokens: 500_000,
    outputTokens: 0,
    raw: { cost: 0.2 },
  });
  usage.accumulateStep({ inputTokens: 500_000, outputTokens: 0 });
  usage.providerCost += 0.25;
  usage.nonModelCost += 0.25;
  const cost = record(usage).costDollars;
  expect(cost).toBeCloseTo(1.075);
  expect(
    computeActualCostPoints({
      actualInputTokens: usage.inputTokens,
      actualOutputTokens: usage.outputTokens,
      providerCostDollars: cost,
      modelName: model,
      nonModelCostDollars: usage.nonModelCost,
    }),
  ).toBe(Math.ceil(1.075 * POINTS_PER_DOLLAR * RETAIL_MARGIN));
});

it("resetting a waived model leg cannot leak its priced tokens or reasoning into fallback accounting", () => {
  const usage = new UsageTracker();
  usage.accumulateStep({
    inputTokens: 500_000,
    outputTokens: 100,
    outputTokenDetails: { reasoningTokens: 80 },
    raw: { cost: 0.2 },
  });
  usage.resetModelLeg();
  usage.accumulateStep({ inputTokens: 500_000, outputTokens: 0 });
  expect(usage.computeCostDollars(model)).toBe(0.625);
  expect(usage.reasoningTokens).toBe(0);
  expect(usage.modelProviderCost).toBe(0);
});

it.each([undefined, NaN, Infinity, -1])(
  "estimates invalid summary receipt %s rather than propagating it",
  (cost) => {
    const usage = new UsageTracker();
    new SummarizationTracker().recordSummarization(
      0,
      { inputTokens: 1_000_000, outputTokens: 0, cost },
      usage,
    );
    expect(usage.computeCostDollars(model)).toBe(1.25);
    expect(record(usage).costSource).toBe("token_estimate");
  },
);
