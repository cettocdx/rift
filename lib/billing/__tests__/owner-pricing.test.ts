import {
  getAccountPricingMargin,
  normalizePricingMargin,
} from "../account-pricing";
import {
  calculateTokenCost,
  computeActualCostPoints,
  checkAccountCreditLimit,
  deductUsage,
} from "@/lib/rate-limit/token-bucket";
import { deductFromPlanCredits, refundPlanCredits } from "@/lib/extra-usage";
import { resolveRunCostCeiling } from "@/lib/chat/run-cost-ceiling";

jest.mock("@/lib/extra-usage", () => ({
  deductFromPlanCredits: jest.fn(),
  refundPlanCredits: jest.fn(),
}));
jest.mock("@/lib/billing/paid-ledger-migration", () => ({
  migratePaidPlanLedger: jest.fn(),
}));

it("only gives the exact trusted owner identity at-cost pricing", () => {
  expect(getAccountPricingMargin({ email: "AhmetCet92@Hotmail.com" })).toBe(1);
  for (const email of [
    undefined,
    "admin@example.com",
    "ahmetcet92@hotmail.com.attacker.com",
    "ahmetcet92+admin@hotmail.com",
  ])
    expect(getAccountPricingMargin({ email })).toBe(2.5);
  for (const value of [0, -1, NaN, Infinity, 0.5])
    expect(normalizePricingMargin(value)).toBe(2.5);
});

it("charges provider receipts and fallback model/tool/sandbox cost at 1x only for owner pricing", () => {
  expect(
    computeActualCostPoints({
      actualInputTokens: 0,
      actualOutputTokens: 0,
      providerCostDollars: 1,
      pricingMargin: 1,
    }),
  ).toBe(10000);
  expect(
    computeActualCostPoints({
      actualInputTokens: 0,
      actualOutputTokens: 0,
      providerCostDollars: 1,
    }),
  ).toBe(25000);
  expect(
    computeActualCostPoints({
      actualInputTokens: 1000000,
      actualOutputTokens: 1000000,
      modelName: "model-gpt-6-astra",
      nonModelCostDollars: 2,
      pricingMargin: 1,
    }),
  ).toBe(620000);
  expect(calculateTokenCost(1000000, "input", "model-gpt-6-astra", 1)).toBe(
    100000,
  );
});

it("reserves and settles the owner's account ledger at the same margin", async () => {
  jest.mocked(deductFromPlanCredits).mockResolvedValue({
    success: true,
    includedPointsDeducted: 100,
    purchasedPointsDeducted: 0,
    includedRemainingPoints: 99900,
    includedTotalPoints: 100000,
  } as any);
  const reserved = await checkAccountCreditLimit(
    "owner",
    "ultra",
    1000,
    undefined,
    "model-gpt-6-astra",
    undefined,
    undefined,
    1,
  );
  expect(deductFromPlanCredits).toHaveBeenLastCalledWith(
    "owner",
    "ultra",
    100,
    { allowAutoReload: false },
  );
  expect(reserved.pricingMargin).toBe(1);
  await deductUsage(
    "owner",
    "ultra",
    1000,
    1000,
    1000,
    undefined,
    0.06,
    "model-gpt-6-astra",
    0,
    undefined,
    reserved,
  );
  expect(deductFromPlanCredits).toHaveBeenLastCalledWith(
    "owner",
    "ultra",
    500,
    { allowAutoReload: false, allowDebt: true },
  );
  await deductUsage(
    "owner",
    "ultra",
    1000,
    0,
    0,
    undefined,
    0,
    "model-gpt-6-astra",
    0,
    undefined,
    reserved,
  );
  expect(refundPlanCredits).toHaveBeenLastCalledWith(
    "owner",
    expect.stringContaining(":trueup"),
    100,
    0,
  );
});

it("allows an owner balance to fund raw costs without the retail ceiling", () => {
  expect(
    resolveRunCostCeiling({
      subscription: "ultra",
      servedFrom: "balance",
      balanceDollars: 10,
      pricingMargin: 1,
      env: {},
    }).ceilingDollars,
  ).toBe(10.25);
  expect(
    resolveRunCostCeiling({
      subscription: "ultra",
      servedFrom: "balance",
      balanceDollars: 10,
      env: {},
    }).ceilingDollars,
  ).toBe(4.1);
});

it("keeps mid-run account budget enforcement at the owner's actual cost", async () => {
  const { createRequestBudgetMonitor } =
    await import("@/lib/chat/budget-monitor");
  const build = (pricingMargin: number) =>
    createRequestBudgetMonitor({
      subscription: "ultra",
      extraUsageConfig: undefined,
      writer: { write: jest.fn() } as any,
      rateLimitInfo: {
        remaining: 10000,
        limit: 10000,
        resetTime: new Date(),
        servedFrom: "account",
        pricingMargin,
        monthly: { remaining: 10000, limit: 10000, resetTime: new Date() },
      },
      env: {},
    });
  expect(build(1).checkAfterStep(0.5)).toBe("continue");
  expect(build(2.5).checkAfterStep(0.5)).toBe("abort");
});
