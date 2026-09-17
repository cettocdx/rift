import { RETAIL_MARGIN } from "@/lib/rate-limit/token-bucket";
import {
  BALANCE_OVERSHOOT_MARGIN_USD,
  DEFAULT_RUN_COST_CEILING_USD,
  resolveRunCostCeiling,
} from "@/lib/chat/run-cost-ceiling";

describe("resolveRunCostCeiling", () => {
  it("does not impose a fixed dollar limit by default", () => {
    expect(resolveRunCostCeiling({ subscription: "pro", env: {} })).toEqual({
      ceilingDollars: DEFAULT_RUN_COST_CEILING_USD,
      source: "default",
    });
    expect(DEFAULT_RUN_COST_CEILING_USD).toBeUndefined();
  });

  it("caps a balance-funded run at the balance plus one step's margin", () => {
    const result = resolveRunCostCeiling({
      subscription: "free",
      servedFrom: "balance",
      balanceDollars: 1.2,
      env: {},
    });
    expect(result).toEqual({
      ceilingDollars: (1.2 + BALANCE_OVERSHOOT_MARGIN_USD) / RETAIL_MARGIN,
      source: "balance",
    });
  });

  it("uses the funded balance rather than an artificial five-dollar limit", () => {
    const result = resolveRunCostCeiling({
      subscription: "free",
      servedFrom: "balance",
      balanceDollars: 400,
      env: {},
    });
    expect(result).toEqual({
      ceilingDollars: 400.25 / RETAIL_MARGIN,
      source: "balance",
    });
  });

  it("lets an operator override per tier without a deploy", () => {
    expect(
      resolveRunCostCeiling({
        subscription: "pro",
        env: { AGENT_RUN_COST_CEILING_USD_PAID: "12" },
      }),
    ).toEqual({ ceilingDollars: 12, source: "env" });
    expect(
      resolveRunCostCeiling({
        subscription: "free",
        env: { AGENT_RUN_COST_CEILING_USD_FREE: "2" },
      }).ceilingDollars,
    ).toBe(2);
    expect(
      resolveRunCostCeiling({
        subscription: "pro",
        servedFrom: "balance",
        balanceDollars: 50,
        env: { AGENT_RUN_COST_CEILING_USD_BALANCE: "8" },
      }).ceilingDollars,
    ).toBe(8);
  });

  it("falls back to the generic override, and ignores garbage", () => {
    expect(
      resolveRunCostCeiling({
        subscription: "pro",
        env: { AGENT_RUN_COST_CEILING_USD: "7.5" },
      }).ceilingDollars,
    ).toBe(7.5);
    expect(
      resolveRunCostCeiling({
        subscription: "pro",
        env: {
          AGENT_RUN_COST_CEILING_USD_PAID: "lots",
          AGENT_RUN_COST_CEILING_USD: "-3",
        },
      }),
    ).toEqual({
      ceilingDollars: DEFAULT_RUN_COST_CEILING_USD,
      source: "default",
    });
  });

  it("treats a negative balance as empty rather than a negative ceiling", () => {
    expect(
      resolveRunCostCeiling({
        subscription: "free",
        servedFrom: "balance",
        balanceDollars: -2,
        env: {},
      }).ceilingDollars,
    ).toBe(BALANCE_OVERSHOOT_MARGIN_USD / RETAIL_MARGIN);
  });
});
