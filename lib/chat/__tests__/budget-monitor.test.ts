jest.mock("server-only", () => ({}));

import { resolveRunCostCeiling } from "@/lib/chat/run-cost-ceiling";

import {
  BudgetMonitor,
  captureBudgetSnapshot,
  createRequestBudgetMonitor,
  type BudgetSnapshot,
} from "@/lib/chat/budget-monitor";
import type { RateLimitInfo } from "@/types";

/*
 * The per-run ceiling is the guard against one runaway run.
 *
 * Before it, a run's only bounds were 100 steps and 58 minutes, and a
 * balance-funded run had no mid-stream enforcement at all: the monthly monitor
 * was deliberately disabled for it and the post-run true-up allowed debt.
 */
const makeWriter = () => {
  const writes: Array<{ type: string; data: Record<string, unknown> }> = [];
  return {
    writer: { write: (part: any) => writes.push(part), merge: () => {} } as any,
    writes,
  };
};

const snapshot = (over: Partial<BudgetSnapshot> = {}): BudgetSnapshot => ({
  monthlyLimitPoints: 1_000_000,
  monthlyRemainingAtStart: 1_000_000,
  monthlyResetTime: new Date("2030-01-01T00:00:00Z"),
  extraUsageBalanceAtStart: 0,
  extraUsageAutoReload: false,
  ...over,
});

const rateLimit = (over: Partial<RateLimitInfo> = {}): RateLimitInfo => ({
  remaining: 0,
  limit: 10_000,
  resetTime: new Date("2030-01-01T00:00:00Z"),
  ...over,
});

describe("request budget funding", () => {
  const extraUsageConfig = {
    enabled: true,
    hasBalance: true,
    balanceDollars: 1,
    autoReloadEnabled: false,
  };

  it("excludes an exhausted paid monthly bucket when this request uses balance", () => {
    expect(
      captureBudgetSnapshot({
        subscription: "pro",
        extraUsageConfig,
        rateLimitInfo: rateLimit({
          servedFrom: "balance",
          monthly: { remaining: 0, limit: 10_000, resetTime: new Date() },
        }),
      }),
    ).toBeNull();
  });

  it.each(["free", "pro"] as const)(
    "%s balance funding ignores exhausted allowances and enforces the retail-funded ceiling",
    (subscription) => {
      const { writer, writes } = makeWriter();
      const monitor = createRequestBudgetMonitor({
        subscription,
        writer,
        extraUsageConfig,
        rateLimitInfo: rateLimit({
          servedFrom: "balance",
          monthly: { remaining: 0, limit: 10_000, resetTime: new Date() },
        }),
        freeMonthlyBudgetSnapshot: snapshot({ monthlyRemainingAtStart: 0 }),
        env: {},
      });
      expect(monitor.checkAfterStep(0.01)).toBe("continue");
      expect(writes).toHaveLength(0);
      expect(monitor.checkAfterStep(0.49)).toBe("continue");
      expect(monitor.checkAfterStep(0.5)).toBe("abort");
      expect(writes.at(-1)?.data).toMatchObject({
        warningType: "run-budget",
        ceilingDollars: 0.5,
        cutOff: true,
      });
    },
  );

  it("retains the free allowance cap and skips explicitly unavailable snapshots", () => {
    const { writer } = makeWriter();
    const args = {
      subscription: "free" as const,
      writer,
      extraUsageConfig: undefined,
      rateLimitInfo: rateLimit({ servedFrom: "free" }),
      env: {},
    };
    const exhausted = snapshot({ monthlyRemainingAtStart: 0 });
    expect(
      createRequestBudgetMonitor({
        ...args,
        freeMonthlyBudgetSnapshot: exhausted,
      }).checkAfterStep(0.01),
    ).toBe("abort");
    expect(
      createRequestBudgetMonitor({
        ...args,
        freeMonthlyBudgetSnapshot: { ...exhausted, rateLimitSkipped: true },
      }).checkAfterStep(6),
    ).toBe("continue");
  });

  it("applies operator ceilings without introducing a fixed default ceiling", () => {
    const { writer } = makeWriter();
    const args = {
      subscription: "pro" as const,
      writer,
      extraUsageConfig: undefined,
      rateLimitInfo: rateLimit({ servedFrom: "account" }),
    };
    expect(
      createRequestBudgetMonitor({ ...args, env: {} }).checkAfterStep(6),
    ).toBe("continue");
    expect(
      createRequestBudgetMonitor({
        ...args,
        env: { AGENT_RUN_COST_CEILING_USD_PAID: "0.2" },
      }).checkAfterStep(0.2),
    ).toBe("abort");
  });
});

describe("BudgetMonitor — per-run ceiling", () => {
  it("enforces the ceiling with no monthly snapshot at all", () => {
    const { writer, writes } = makeWriter();
    const monitor = new BudgetMonitor(null, writer, "free", {
      runCeilingDollars: 5,
    });

    expect(monitor.checkAfterStep(1)).toBe("continue");
    expect(writes).toHaveLength(0);

    expect(monitor.checkAfterStep(4.2)).toBe("continue"); // 84%
    expect(writes).toHaveLength(1);
    expect(writes[0].data).toMatchObject({
      warningType: "run-budget",
      usedPercent: 84,
      ceilingDollars: 5,
    });

    expect(monitor.checkAfterStep(4.8)).toBe("continue"); // 96%
    expect(writes).toHaveLength(2);

    expect(monitor.checkAfterStep(5.1)).toBe("abort"); // 102%
    expect(writes).toHaveLength(3);
    expect(writes[2].data).toMatchObject({ cutOff: true, usedPercent: 100 });
  });

  it("warns once per threshold, not once per step", () => {
    const { writer, writes } = makeWriter();
    const monitor = new BudgetMonitor(null, writer, "pro", {
      runCeilingDollars: 10,
    });
    monitor.checkAfterStep(8.1);
    monitor.checkAfterStep(8.5);
    monitor.checkAfterStep(8.9);
    expect(writes).toHaveLength(1);
  });

  it("keeps aborting once over the ceiling", () => {
    const { writer } = makeWriter();
    const monitor = new BudgetMonitor(null, writer, "pro", {
      runCeilingDollars: 1,
    });
    expect(monitor.checkAfterStep(1.5)).toBe("abort");
    expect(monitor.checkAfterStep(1.6)).toBe("abort");
  });

  it("jumps straight to cut-off when one step crosses every threshold", () => {
    const { writer, writes } = makeWriter();
    const monitor = new BudgetMonitor(null, writer, "pro", {
      runCeilingDollars: 2,
    });
    expect(monitor.checkAfterStep(9)).toBe("abort");
    // 80, 95 and 100 all fire in the same check: three rows, the last cut off.
    expect(writes.map((w) => w.data.usedPercent)).toEqual([100, 100, 100]);
    expect(writes.at(-1)?.data).toMatchObject({ cutOff: true });
  });

  it("ignores a missing or non-positive ceiling", () => {
    const { writer, writes } = makeWriter();
    expect(new BudgetMonitor(null, writer, "pro").checkAfterStep(1e6)).toBe(
      "continue",
    );
    expect(
      new BudgetMonitor(null, writer, "pro", {
        runCeilingDollars: 0,
      }).checkAfterStep(1e6),
    ).toBe("continue");
    expect(writes).toHaveLength(0);
  });
});

describe("BudgetMonitor — monthly bucket unchanged beside the ceiling", () => {
  it("still aborts at 100% of the monthly bucket with no cushion", () => {
    const { writer } = makeWriter();
    // 1,000 points left of 1,000,000; POINTS_PER_DOLLAR makes any real spend
    // exhaust it.
    const monitor = new BudgetMonitor(
      snapshot({ monthlyRemainingAtStart: 1 }),
      writer,
      "pro",
      { runCeilingDollars: 1000 },
    );
    expect(monitor.checkAfterStep(1)).toBe("abort");
  });

  it("the run ceiling can stop a run the monthly bucket would allow", () => {
    const { writer, writes } = makeWriter();
    const monitor = new BudgetMonitor(snapshot(), writer, "pro", {
      runCeilingDollars: 0.5,
    });
    expect(monitor.checkAfterStep(0.6)).toBe("abort");
    expect(writes.some((w) => w.data.warningType === "run-budget")).toBe(true);
  });
});

it("continues past five dollars using the default policy but enforces the actual funded balance", () => {
  const { writer, writes } = makeWriter();
  const monthly = resolveRunCostCeiling({
    subscription: "pro",
    servedFrom: "monthly",
    env: {},
  });
  const monitor = new BudgetMonitor(null, writer, "pro", {
    runCeilingDollars: monthly.ceilingDollars,
  });
  expect(monitor.checkAfterStep(6)).toBe("continue");
  expect(writes).toHaveLength(0);
  const balance = resolveRunCostCeiling({
    subscription: "pro",
    servedFrom: "balance",
    balanceDollars: 20,
    env: {},
  });
  const funded = new BudgetMonitor(null, writer, "pro", {
    runCeilingDollars: balance.ceilingDollars,
  });
  expect(funded.checkAfterStep(6)).toBe("continue");
  expect(funded.checkAfterStep(20.3)).toBe("abort");
});

it("enforces retail monthly credits using the same marked-up points as final provider-cost settlement", () => {
  const { writer } = makeWriter();
  const monitor = new BudgetMonitor(
    snapshot({ monthlyLimitPoints: 10_000, monthlyRemainingAtStart: 10_000 }),
    writer,
    "pro",
  );
  expect(monitor.checkAfterStep(0.39)).toBe("continue");
  // $0.40 provider spend costs $1.00 / 10,000 credits at the unchanged 2.5 margin.
  expect(monitor.checkAfterStep(0.4)).toBe("abort");
});

it("converts the retail PAYG funding limit to the raw-dollar ceiling used by the monitor", () => {
  const { writer } = makeWriter();
  const limit = resolveRunCostCeiling({
    subscription: "free",
    servedFrom: "balance",
    balanceDollars: 1,
    env: {},
  });
  const monitor = new BudgetMonitor(null, writer, "free", {
    runCeilingDollars: limit.ceilingDollars,
  });
  expect(monitor.checkAfterStep(0.49)).toBe("continue");
  // $0.50 raw costs the $1 balance plus the existing $0.25 retail grace.
  expect(monitor.checkAfterStep(0.5)).toBe("abort");
});

it("preserves the free monthly provider-cost cap without retail markup", () => {
  const { writer } = makeWriter();
  const monitor = new BudgetMonitor(
    snapshot({ monthlyLimitPoints: 10_000, monthlyRemainingAtStart: 10_000 }),
    writer,
    "free",
  );
  expect(monitor.checkAfterStep(0.4)).toBe("continue");
  expect(monitor.checkAfterStep(1)).toBe("abort");
});
