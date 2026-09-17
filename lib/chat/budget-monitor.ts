import "server-only";

import type { UIMessageStreamWriter } from "ai";
import type {
  ExtraUsageConfig,
  RateLimitInfo,
  SubscriptionTier,
} from "@/types";
import {
  POINTS_PER_DOLLAR,
  computeActualCostPoints,
} from "@/lib/rate-limit/token-bucket";
import {
  emitTokenBucketThresholdWarning,
  type TokenBucketEmitContext,
} from "@/lib/api/chat-stream-helpers";
import { writeRateLimitWarning } from "@/lib/utils/stream-writer-utils";
import { resolveRunCostCeiling } from "./run-cost-ceiling";

// 50% is intentionally omitted: at the halfway mark there's no actionable
// signal for the user, so an in-product banner is noise. The ladder matches
// the codebase's pre-existing 80/95 warnings, plus 100% which drives the
// abort. (Anthropic's Console alerts include 50% but deliver it via email,
// not an in-product disruption — we don't have that channel.)
export const BUDGET_THRESHOLDS = [80, 95, 100] as const;

export interface BudgetSnapshot {
  monthlyLimitPoints: number;
  monthlyRemainingAtStart: number;
  monthlyResetTime: Date;
  extraUsageBalanceAtStart: number;
  extraUsageAutoReload: boolean;
}

/**
 * Captures the per-request budget snapshot used by BudgetMonitor.
 * Returns null when budget enforcement should not run for this request
 * (balance-funded requests, free users, no monthly bucket, or skipped limits).
 */
export function captureBudgetSnapshot(args: {
  rateLimitInfo: RateLimitInfo;
  extraUsageConfig: ExtraUsageConfig | undefined;
  subscription: SubscriptionTier;
}): BudgetSnapshot | null {
  const { rateLimitInfo, extraUsageConfig, subscription } = args;
  const monthlyLimitPoints = rateLimitInfo.monthly?.limit ?? 0;
  const monthlyResetTime = rateLimitInfo.monthly?.resetTime;
  if (
    rateLimitInfo.servedFrom === "balance" ||
    subscription === "free" ||
    monthlyLimitPoints <= 0 ||
    !monthlyResetTime ||
    rateLimitInfo.rateLimitSkipped
  ) {
    return null;
  }
  return {
    monthlyLimitPoints,
    monthlyRemainingAtStart: rateLimitInfo.monthly!.remaining,
    monthlyResetTime: monthlyResetTime!,
    extraUsageBalanceAtStart: extraUsageConfig?.balanceDollars ?? 0,
    extraUsageAutoReload: extraUsageConfig?.autoReloadEnabled ?? false,
  };
}

/** Apply the account funding policy even when no monthly snapshot exists. */
export function createRequestBudgetMonitor(args: {
  rateLimitInfo: RateLimitInfo;
  extraUsageConfig: ExtraUsageConfig | undefined;
  subscription: SubscriptionTier;
  freeMonthlyBudgetSnapshot?:
    | (BudgetSnapshot & { rateLimitSkipped?: boolean })
    | null;
  writer: UIMessageStreamWriter;
  env?: Record<string, string | undefined>;
}): BudgetMonitor {
  const snapshot =
    captureBudgetSnapshot(args) ??
    (args.rateLimitInfo.servedFrom === "balance" ||
    args.freeMonthlyBudgetSnapshot?.rateLimitSkipped
      ? null
      : (args.freeMonthlyBudgetSnapshot ?? null));
  const runCeiling = resolveRunCostCeiling({
    subscription: args.subscription,
    servedFrom: args.rateLimitInfo.servedFrom,
    balanceDollars: args.extraUsageConfig?.balanceDollars,
    env: args.env,
    pricingMargin: args.rateLimitInfo.pricingMargin,
  });
  return new BudgetMonitor(snapshot, args.writer, args.subscription, {
    runCeilingDollars: runCeiling.ceilingDollars,
    pricingMargin: args.rateLimitInfo.pricingMargin,
  });
}

/**
 * Mid-stream budget enforcement. State lives on the monitor; the hook point
 * in chat-handler stays thin.
 *
 * Each call to `checkAfterStep` emits at most one warning (per crossed
 * threshold) and returns "abort" only when the bucket is exhausted with no
 * extra-usage cushion. The caller owns the AbortController.
 */
export interface BudgetMonitorOptions {
  /**
   * Hard ceiling for THIS run in raw provider/base dollars. Independent of any monthly bucket:
   * it is the guard against a single runaway run, and it is the only guard a
   * balance-funded run has mid-stream. See lib/chat/run-cost-ceiling.ts.
   */
  runCeilingDollars?: number;
  pricingMargin?: number;
}

export class BudgetMonitor {
  private highestThresholdEmitted: number;
  private readonly pricingMargin?: number;
  private highestRunThresholdEmitted = 0;
  private readonly runCeilingDollars: number | undefined;

  constructor(
    private readonly snapshot: BudgetSnapshot | null,
    private readonly writer: UIMessageStreamWriter,
    private readonly subscription: SubscriptionTier,
    options: BudgetMonitorOptions = {},
  ) {
    this.pricingMargin = options.pricingMargin;
    this.runCeilingDollars =
      typeof options.runCeilingDollars === "number" &&
      Number.isFinite(options.runCeilingDollars) &&
      options.runCeilingDollars > 0
        ? options.runCeilingDollars
        : undefined;
    if (!snapshot) {
      this.highestThresholdEmitted = 0;
      return;
    }
    const startUsedPercent =
      ((snapshot.monthlyLimitPoints - snapshot.monthlyRemainingAtStart) /
        snapshot.monthlyLimitPoints) *
      100;
    this.highestThresholdEmitted =
      BUDGET_THRESHOLDS.filter((t) => startUsedPercent >= t).pop() ?? 0;
  }

  /** Input is raw provider/base cost, including raw sandbox/tool dollars. */
  checkAfterStep(currentCostDollars: number): "continue" | "abort" {
    // The run ceiling is checked first and independently: crossing it ends
    // the run whatever the monthly picture looks like.
    if (this.checkRunCeiling(currentCostDollars) === "abort") return "abort";
    const { snapshot } = this;
    if (!snapshot) return "continue";
    // Free monthly snapshots track provider cost (recordFreeMonthlyCost),
    // while paid snapshots track purchased/included retail credits.
    const usedSinceStartPoints =
      this.subscription === "free"
        ? Math.ceil(currentCostDollars * POINTS_PER_DOLLAR)
        : computeActualCostPoints({
            actualInputTokens: 0,
            actualOutputTokens: 0,
            providerCostDollars: currentCostDollars,
            pricingMargin: this.pricingMargin,
          });
    const projectedUsedPoints =
      snapshot.monthlyLimitPoints -
      snapshot.monthlyRemainingAtStart +
      usedSinceStartPoints;
    const usedPercent =
      (projectedUsedPoints / snapshot.monthlyLimitPoints) * 100;

    let decision: "continue" | "abort" = "continue";

    for (const threshold of BUDGET_THRESHOLDS) {
      if (usedPercent < threshold) {
        continue;
      }

      if (threshold === 100) {
        const overflowDollars =
          Math.max(0, projectedUsedPoints - snapshot.monthlyLimitPoints) /
          POINTS_PER_DOLLAR;
        const hasExtraCushion =
          snapshot.extraUsageAutoReload ||
          snapshot.extraUsageBalanceAtStart - overflowDollars > 0;

        if (hasExtraCushion) {
          if (threshold <= this.highestThresholdEmitted) {
            continue;
          }
          this.highestThresholdEmitted = threshold;
          writeRateLimitWarning(this.writer, {
            warningType: "extra-usage-active",
            bucketType: "monthly",
            resetTime: snapshot.monthlyResetTime.toISOString(),
            subscription: this.subscription,
            midStream: true,
          });
        } else {
          this.emit({
            usedPercent: 100,
            projectedUsedPoints: snapshot.monthlyLimitPoints,
            cutOff: true,
          });
          decision = "abort";
        }
      } else {
        if (threshold <= this.highestThresholdEmitted) {
          continue;
        }
        this.highestThresholdEmitted = threshold;
        this.emit({ usedPercent, projectedUsedPoints });
      }
    }

    return decision;
  }

  private checkRunCeiling(currentCostDollars: number): "continue" | "abort" {
    const ceiling = this.runCeilingDollars;
    if (ceiling === undefined) return "continue";
    const usedPercent = (currentCostDollars / ceiling) * 100;
    let decision: "continue" | "abort" = "continue";
    for (const threshold of BUDGET_THRESHOLDS) {
      if (usedPercent < threshold) continue;
      if (threshold <= this.highestRunThresholdEmitted) {
        if (threshold === 100) decision = "abort";
        continue;
      }
      this.highestRunThresholdEmitted = threshold;
      writeRateLimitWarning(this.writer, {
        warningType: "run-budget",
        usedPercent: Math.min(100, Math.round(usedPercent)),
        usedDollars: Number(currentCostDollars.toFixed(4)),
        ceilingDollars: ceiling,
        subscription: this.subscription,
        midStream: true,
        ...(threshold === 100 ? { cutOff: true } : {}),
      });
      if (threshold === 100) decision = "abort";
    }
    return decision;
  }

  private emit(args: {
    usedPercent: number;
    projectedUsedPoints: number;
    cutOff?: boolean;
  }): void {
    if (!this.snapshot) return;
    const ctx: TokenBucketEmitContext = {
      usedPercent: args.usedPercent,
      projectedUsedPoints: args.projectedUsedPoints,
      monthlyLimitPoints: this.snapshot.monthlyLimitPoints,
      resetTime: this.snapshot.monthlyResetTime,
      subscription: this.subscription,
      midStream: true,
      cutOff: args.cutOff,
    };
    emitTokenBucketThresholdWarning(this.writer, ctx);
  }
}
