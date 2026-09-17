import { POINTS_PER_DOLLAR } from "@/lib/billing/credit-units";

/**
 * RIFT token packages — pay-as-you-go top-ups.
 *
 * Pricing model (locked):
 *   - 1 displayed token = 1 point = $0.0001 retail value (POINTS_PER_DOLLAR = 10,000).
 *   - Base tokens = priceUsd × POINTS_PER_DOLLAR.
 *   - Bigger packages get a tiered volume BONUS (extra tokens at no extra cost),
 *     which raises average order value. The margin itself is earned on burn
 *     (RETAIL_MARGIN), so the bonus is a pure acquisition lever.
 *   - Margin (RETAIL_MARGIN = 2.5×) is applied at consumption, not purchase —
 *     so $X always grants the token amounts below; the bonus is added on top.
 *
 * The Stripe `createPurchaseSession` flow takes a dollar amount; these presets
 * map a package to its `priceUsd`. The webhook credits `tokens` (base + bonus)
 * into `extra_usage.balance_points`.
 */
export interface TokenPackage {
  /** Stable id used in UI + analytics. */
  id: "starter" | "plus" | "pro" | "scale";
  /** Display name. */
  name: string;
  /** Price charged via Stripe, in USD. */
  priceUsd: number;
  /** Base tokens = priceUsd × POINTS_PER_DOLLAR. */
  baseTokens: number;
  /** Volume bonus percentage (0–100). */
  bonusPct: number;
  /** Bonus tokens granted on top of base. */
  bonusTokens: number;
  /** Total tokens credited to balance_points (base + bonus). */
  totalTokens: number;
}

/** Build a package from price + bonus %, deriving base/bonus/total tokens. */
function pkg(
  id: TokenPackage["id"],
  name: string,
  priceUsd: number,
  bonusPct: number,
): TokenPackage {
  const baseTokens = priceUsd * POINTS_PER_DOLLAR;
  const bonusTokens = Math.round((baseTokens * bonusPct) / 100);
  return {
    id,
    name,
    priceUsd,
    baseTokens,
    bonusPct,
    bonusTokens,
    totalTokens: baseTokens + bonusTokens,
  };
}

/**
 * Locked package ladder: $20 / $50 / $100 / $300 with tiered bonuses.
 *
 *   Starter  $20  → 200,000      (+0%)
 *   Plus     $50  → 525,000      (+5%)
 *   Pro      $100 → 1,100,000    (+10%)
 *   Scale    $300 → 3,600,000    (+20%)
 */
export const TOKEN_PACKAGES: readonly TokenPackage[] = [
  pkg("starter", "Starter", 20, 0),
  pkg("plus", "Plus", 50, 5),
  pkg("pro", "Pro", 100, 10),
  pkg("scale", "Scale", 300, 20),
] as const;

/** Minimum custom top-up amount, in USD (matches the checkout floor). */
export const MIN_CUSTOM_TOPUP_USD = 10;

/**
 * Volume-bonus tokens (points) for a dollar amount, tiered by spend.
 *
 * Canonical rule shared by the checkout UI and the payment-provider crediting
 * path (NowPayments IPN). Thresholds match the package ladder above:
 *   < $50  → +0%   ·  ≥ $50 → +5%  ·  ≥ $100 → +10%  ·  ≥ $300 → +20%
 * Custom amounts land in whichever tier their dollar value reaches.
 *
 * NOTE: convex/extraUsageActions.ts keeps a byte-identical copy (Convex can't
 * import app `lib/`); the token-packages drift test guards they agree.
 */
export function bonusPointsForDollars(dollars: number): number {
  const basePoints = dollars * POINTS_PER_DOLLAR;
  let pct = 0;
  if (dollars >= 300) pct = 20;
  else if (dollars >= 100) pct = 10;
  else if (dollars >= 50) pct = 5;
  return Math.round((basePoints * pct) / 100);
}

/** Look up a package by id. */
export function getTokenPackage(
  id: TokenPackage["id"],
): TokenPackage | undefined {
  return TOKEN_PACKAGES.find((p) => p.id === id);
}
