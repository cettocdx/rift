/** Optional per-run operator limits and balance-funded spending bounds.
 * Monthly/free allowance enforcement is handled independently by BudgetMonitor.
 */

import type { SubscriptionTier } from "@/types";
import { normalizePricingMargin } from "@/lib/billing/account-pricing";

/** No fixed per-run dollar cap; the account funding limits still apply. */
export const DEFAULT_RUN_COST_CEILING_USD: number | undefined = undefined;

/**
 * A balance-funded run may not spend more than the balance plus a small
 * margin. The margin covers the one step that is already in flight when the
 * ceiling is crossed; it is the most the true-up can be asked to absorb.
 */
export const BALANCE_OVERSHOOT_MARGIN_USD = 0.25;

export type RunFundingSource = "balance" | "monthly" | "free" | "unknown";

export interface ResolveRunCostCeilingInput {
  subscription: SubscriptionTier | string;
  /** Where this run's cost will be charged, per the rate limiter. */
  servedFrom?: RunFundingSource | string;
  /** Prepaid balance in dollars, when the run is balance-funded. */
  balanceDollars?: number;
  pricingMargin?: number;
  /** process.env, or a stand-in for tests. */
  env?: Record<string, string | undefined>;
}

const parseEnvDollars = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

/**
 * Raw provider/base dollar ceiling for one run, and where it came from.
 * Operator caps retain raw-dollar semantics; purchased balances and their
 * overshoot margin are retail dollars, converted before comparison.
 *
 * Env overrides let an operator raise or lower a tier without a deploy:
 *   AGENT_RUN_COST_CEILING_USD_FREE     free-served runs
 *   AGENT_RUN_COST_CEILING_USD_BALANCE  balance-funded (PAYG) runs
 *   AGENT_RUN_COST_CEILING_USD_PAID     monthly-allowance runs
 *   AGENT_RUN_COST_CEILING_USD          fallback for all of the above
 */
export function resolveRunCostCeiling(input: ResolveRunCostCeilingInput): {
  ceilingDollars: number | undefined;
  source: "env" | "balance" | "default";
} {
  const env = input.env ?? process.env;
  const servedFrom = input.servedFrom ?? "unknown";
  const tierKey =
    servedFrom === "balance"
      ? "BALANCE"
      : input.subscription === "free"
        ? "FREE"
        : "PAID";

  const fromEnv =
    parseEnvDollars(env[`AGENT_RUN_COST_CEILING_USD_${tierKey}`]) ??
    parseEnvDollars(env.AGENT_RUN_COST_CEILING_USD);
  const base = fromEnv ?? DEFAULT_RUN_COST_CEILING_USD;

  if (
    servedFrom === "balance" &&
    typeof input.balanceDollars === "number" &&
    Number.isFinite(input.balanceDollars)
  ) {
    const byBalance =
      (Math.max(0, input.balanceDollars) + BALANCE_OVERSHOOT_MARGIN_USD) /
      normalizePricingMargin(input.pricingMargin);
    if (base === undefined || byBalance < base) {
      return { ceilingDollars: byBalance, source: "balance" };
    }
  }

  return {
    ceilingDollars: base,
    source: fromEnv !== undefined ? "env" : "default",
  };
}
