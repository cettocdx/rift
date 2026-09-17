import { UsageTracker } from "../usage-tracker";
import {
  computeActualCostPoints,
  deductUsage,
  POINTS_PER_DOLLAR,
  RETAIL_MARGIN,
} from "../rate-limit/token-bucket";
import { deductFromPlanCredits, refundPlanCredits } from "../extra-usage";

jest.mock("../extra-usage", () => ({
  deductFromPlanCredits: jest.fn(async () => ({ success: true })),
  refundPlanCredits: jest.fn(async () => ({ success: true })),
}));
jest.mock("../db/actions", () => ({ logUsageRecord: jest.fn() }));

const model = "model-grok-4.3";
const inputTokens = 1_000_000;
const rawPrice = 1.25;
const retailPoints = Math.ceil(rawPrice * POINTS_PER_DOLLAR * RETAIL_MARGIN);

describe("isolated usage-source audit; no external calls", () => {
  beforeEach(() => jest.clearAllMocks());

  it("positive provider cost, cached/reasoning details and upfront true-up charge exactly once", async () => {
    const tracker = new UsageTracker();
    tracker.accumulateStep({
      inputTokens,
      outputTokens: 100,
      totalTokens: inputTokens + 100,
      inputTokenDetails: { cacheReadTokens: 900_000 },
      outputTokenDetails: { reasoningTokens: 80 },
      raw: { cost: rawPrice },
    });
    expect(tracker.inputTokens).toBe(inputTokens);
    expect(tracker.outputTokens).toBe(100);
    expect(tracker.providerCost).toBe(rawPrice);
    expect(
      computeActualCostPoints({
        actualInputTokens: inputTokens,
        actualOutputTokens: 100,
        providerCostDollars: tracker.providerCost,
        modelName: model,
      }),
    ).toBe(retailPoints);
    await deductUsage(
      "synthetic",
      "pro",
      0,
      inputTokens,
      100,
      undefined,
      tracker.providerCost,
      model,
      0,
      undefined,
      {
        servedFrom: "account",
        pointsDeducted: 0,
        remaining: 0,
        limit: 0,
        resetTime: new Date(),
      },
    );
    expect(deductFromPlanCredits).toHaveBeenCalledTimes(1);
    expect(deductFromPlanCredits).toHaveBeenCalledWith(
      "synthetic",
      "pro",
      retailPoints,
      { allowAutoReload: false, allowDebt: true },
    );
  });

  it("explicit provider zero cost must restore the prepaid estimate rather than charge full input list price", async () => {
    const tracker = new UsageTracker();
    tracker.accumulateStep({
      inputTokens,
      outputTokens: 0,
      totalTokens: inputTokens,
      inputTokenDetails: { cacheReadTokens: inputTokens },
      raw: { cost: 0 },
    });
    // Reproduce the exact current chat/worker cost-source gate.
    const providerCost = tracker.hasModelProviderCost
      ? tracker.providerCost
      : undefined;
    await deductUsage(
      "synthetic",
      "pro",
      inputTokens,
      inputTokens,
      0,
      undefined,
      providerCost,
      model,
      0,
      undefined,
      {
        servedFrom: "account",
        pointsDeducted: retailPoints,
        remaining: 0,
        limit: retailPoints,
        resetTime: new Date(),
        creditRefundKey: "synthetic-refund",
      },
    );
    expect(refundPlanCredits).toHaveBeenCalledWith(
      "synthetic",
      "synthetic-refund:trueup",
      retailPoints,
      0,
    );
  });

  it("standalone actual-cost function honors an explicit zero provider bill", () => {
    expect(
      computeActualCostPoints({
        actualInputTokens: inputTokens,
        actualOutputTokens: 0,
        providerCostDollars: 0,
        modelName: model,
      }),
    ).toBe(0);
  });

  it("costDollars uses the same monetary basis for identical provider and estimated model usage", () => {
    const reported = new UsageTracker();
    const estimated = new UsageTracker();
    reported.accumulateStep({
      inputTokens,
      outputTokens: 0,
      totalTokens: inputTokens,
      raw: { cost: rawPrice },
    });
    estimated.accumulateStep({
      inputTokens,
      outputTokens: 0,
      totalTokens: inputTokens,
    });
    // Equality asserts only consistent units, not a pricing-policy change.
    expect(estimated.computeCostDollars(model)).toBe(
      reported.computeCostDollars(model),
    );
  });
});

it.each([undefined, NaN, Infinity, -1])(
  "does not treat absent/invalid cost %s as an authoritative zero",
  (cost) => {
    const tracker = new UsageTracker();
    tracker.accumulateStep({ inputTokens, outputTokens: 0, raw: { cost } });
    expect(tracker.hasModelProviderCost).toBe(false);
    expect(tracker.computeCostDollars(model)).toBe(rawPrice);
  },
);
it("resetting a fallback leg clears a prior explicit zero cost observation", () => {
  const tracker = new UsageTracker();
  tracker.accumulateStep({ inputTokens, outputTokens: 0, raw: { cost: 0 } });
  expect(tracker.hasModelProviderCost).toBe(true);
  tracker.resetModelLeg();
  tracker.accumulateStep({ inputTokens, outputTokens: 0 });
  expect(tracker.hasModelProviderCost).toBe(false);
  expect(tracker.computeCostDollars(model)).toBe(rawPrice);
});
it("zero model cost preserves actual sandbox/tool cost with margin exactly once", () => {
  const tracker = new UsageTracker();
  tracker.accumulateStep({ inputTokens, outputTokens: 0, raw: { cost: 0 } });
  tracker.nonModelCost = 0.25;
  tracker.providerCost += 0.25;
  expect(tracker.computeCostDollars(model)).toBe(0.25);
  expect(
    computeActualCostPoints({
      actualInputTokens: inputTokens,
      actualOutputTokens: 0,
      providerCostDollars: tracker.providerCost,
      modelName: model,
      nonModelCostDollars: tracker.nonModelCost,
    }),
  ).toBe(6250);
});
it("an explicit zero-cost zero-token report is observed usage and still reaches final reconciliation", () => {
  const tracker = new UsageTracker();
  tracker.accumulateStep({ inputTokens: 0, outputTokens: 0, raw: { cost: 0 } });
  expect(tracker.hasUsage).toBe(true);
  expect(tracker.computeCostDollars(model)).toBe(0);
});
it("preserves discounted receipts and estimates only missing step prices", () => {
  const tracker = new UsageTracker();
  tracker.accumulateStep({
    inputTokens: 500_000,
    outputTokens: 0,
    raw: { cost: 0.2 },
  });
  tracker.accumulateStep({ inputTokens: 500_000, outputTokens: 0 });
  expect(tracker.computeCostDollars(model)).toBe(0.2 + rawPrice / 2);
  expect(tracker.hasModelProviderCost).toBe(false);
});
it("a zero-cost step cannot turn another unpriced step into a free run", () => {
  const tracker = new UsageTracker();
  tracker.accumulateStep({
    inputTokens: 500_000,
    outputTokens: 0,
    raw: { cost: 0 },
  });
  tracker.accumulateStep({ inputTokens: 500_000, outputTokens: 0 });
  expect(tracker.hasModelProviderCost).toBe(false);
  expect(tracker.computeCostDollars(model)).toBe(rawPrice / 2);
});
