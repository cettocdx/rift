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

const primary = "model-gpt-5.6-sol";
const fallback = "fallback-gemini-3.5-flash";

it("prices an unpriced fallback at its executed model rate after the primary leg is waived", () => {
  const usage = new UsageTracker();
  usage.accumulateStep(
    { inputTokens: 1_000_000, outputTokens: 1_000 },
    primary,
  );
  usage.resetModelLeg();
  usage.accumulateStep(
    { inputTokens: 1_000_000, outputTokens: 1_000 },
    fallback,
  );
  // Gemini fallback: $1.50/M input and $9/M output; Sol is $5/$30.
  expect(usage.computeModelCostDollars(primary)).toBeCloseTo(1.509, 8);
  expect(usage.computeModelCostDollars(fallback)).toBeCloseTo(1.509, 8);
});

it.each([0, 0.125])(
  "keeps receipt %s authoritative alongside independently attributed estimates",
  (cost) => {
    const usage = new UsageTracker();
    usage.accumulateStep(
      { inputTokens: 1_000_000, outputTokens: 1_000, raw: { cost } },
      primary,
    );
    usage.accumulateStep(
      { inputTokens: 100_000, outputTokens: 1_000 },
      fallback,
    );
    usage.accumulateStep(
      { inputTokens: 100_000, outputTokens: 1_000 },
      primary,
    );
    // Unpriced fallback .159 + unpriced Sol .53; priced prefix is not repriced.
    expect(usage.computeModelCostDollars("agent-model")).toBeCloseTo(
      cost + 0.689,
      8,
    );
  },
);

it("preserves each accepted summary model's output attribution through repeated model-leg resets", () => {
  const usage = new UsageTracker();
  const summaries = new SummarizationTracker();
  summaries.recordSummarization(
    1,
    { inputTokens: 1_000_000, outputTokens: 1_000 },
    usage,
    primary,
  );
  usage.accumulateStep(
    { inputTokens: 1_000_000, outputTokens: 1_000 },
    primary,
  );
  usage.resetModelLeg();
  // Existing waiver drops summary input but keeps its output, priced using Sol.
  expect(usage.computeModelCostDollars(fallback)).toBeCloseTo(0.03, 8);
  summaries.recordSummarization(
    2,
    { inputTokens: 100_000, outputTokens: 1_000 },
    usage,
    fallback,
  );
  usage.accumulateStep({ inputTokens: 100_000, outputTokens: 1_000 }, fallback);
  expect(usage.computeModelCostDollars(primary)).toBeCloseTo(0.348, 8);
  usage.resetModelLeg();
  expect(usage.computeModelCostDollars(primary)).toBeCloseTo(0.039, 8);
  expect(usage.inputTokens).toBe(0);
  expect(usage.outputTokens).toBe(2_000);
  expect(usage.streamOutputTokens).toBe(0);
});

it("keeps priced summaries and non-model dollars once across a fallback and settlement", () => {
  const usage = new UsageTracker();
  usage.accumulateSummary(
    { inputTokens: 1_000_000, outputTokens: 1_000, raw: { cost: 0.02 } },
    primary,
  );
  usage.accumulateSummary(
    { inputTokens: 1_000_000, outputTokens: 1_000, raw: { cost: 0 } },
    fallback,
  );
  usage.accumulateStep(
    { inputTokens: 1_000_000, outputTokens: 1_000, raw: { cost: 0.2 } },
    primary,
  );
  usage.nonModelCost = 0.25;
  usage.providerCost += 0.25;
  usage.resetModelLeg();
  usage.accumulateStep({ inputTokens: 100_000, outputTokens: 1_000 }, fallback);
  const record = usage.createUsageCostRecord({
    selectedModel: primary,
    configuredModelId: primary,
    rateLimitInfo: {
      remaining: 1,
      limit: 1,
      pointsDeducted: 0,
      resetTime: new Date(),
    },
  });
  expect(record.costDollars).toBeCloseTo(0.429, 8);
  expect(record.costSource).toBe("token_estimate");
  expect(
    computeActualCostPoints({
      actualInputTokens: usage.inputTokens,
      actualOutputTokens: usage.outputTokens,
      providerCostDollars: record.costDollars,
      modelName: primary,
      nonModelCostDollars: usage.nonModelCost,
    }),
  ).toBe(Math.ceil(record.costDollars * POINTS_PER_DOLLAR * RETAIL_MARGIN));
});

it("uses the caller fallback rate only for legacy operations without model attribution", () => {
  const usage = new UsageTracker();
  usage.accumulateStep({ inputTokens: 100_000, outputTokens: 1_000 }, fallback);
  usage.accumulateStep({ inputTokens: 100_000, outputTokens: 1_000 });
  usage.accumulateSummary({ inputTokens: 100_000, outputTokens: 1_000 });
  expect(usage.computeModelCostDollars(primary)).toBeCloseTo(
    0.159 + 0.53 + 0.53,
    8,
  );
});
