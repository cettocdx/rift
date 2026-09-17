/**
 * Canonical monthly included-credit allowances.
 *
 * One credit is one rate-limit point. Keep every subscription grant,
 * authorization check, and usage display wired to this module so a plan cannot
 * accidentally receive one allowance in Convex and a second allowance in
 * Redis.
 */
export const INCLUDED_CREDITS_BY_TIER = {
  free: 0,
  pro: 500_000,
  "pro-plus": 600_000,
  ultra: 1_800_000,
  team: 400_000,
} as const;

export type IncludedCreditTier = keyof typeof INCLUDED_CREDITS_BY_TIER;

export const getIncludedCreditsForTier = (tier: string): number =>
  INCLUDED_CREDITS_BY_TIER[tier as IncludedCreditTier] ?? 0;

/**
 * Consumer LemonSqueezy plans use the Convex account ledger as their single
 * authorization source. Team and legacy Pro+ plans retain their existing
 * organization/Redis accounting paths.
 */
export const usesAccountCreditLedger = (
  tier: string,
): tier is "pro" | "ultra" => tier === "pro" || tier === "ultra";

/** LemonSqueezy subscription ids minted by the admin comp path, never by the
 * provider. The prefix is the only durable marker an admin grant leaves. */
export const ADMIN_GRANT_SUBSCRIPTION_PREFIX = "admin_grant_";

export const isAdminGrantedSubscription = (
  lsSubscriptionId: string | null | undefined,
): boolean =>
  typeof lsSubscriptionId === "string" &&
  lsSubscriptionId.startsWith(ADMIN_GRANT_SUBSCRIPTION_PREFIX);

/** UTC YYYY-MM for a timestamp; the cycle key of a calendar-renewed grant. */
export const utcMonthKey = (at: number | Date): string => {
  const d = at instanceof Date ? at : new Date(at);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** First instant of the UTC month after `at` — when a calendar cycle renews. */
export const nextUtcMonthStartIso = (at: number | Date): string => {
  const d = at instanceof Date ? at : new Date(at);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1),
  ).toISOString();
};

/**
 * The consumed slice of the monthly allowance, as authorization and display
 * must both read it.
 *
 * Paid plans reset on the provider's renewal webhook and ONLY there -- a
 * calendar boundary is not a paid renewal, and that policy stands. But an
 * admin-granted plan has no provider and no webhook, so under that policy its
 * counter filled up once and then never reset: the account showed (and was
 * ENFORCED at) zero included credits forever, silently burning its prepaid
 * balance instead. For those accounts the calendar month IS the cycle,
 * because nothing else ever arrives to be one.
 *
 * Reads report the rolled value without writing; the authoritative debit
 * stamps `monthly_granted_reset_date` with the month it rolled to. Both paths
 * call this, so what the user is shown is also what the ledger charges.
 */
export function effectiveGrantedUsedPoints({
  storedUsedPoints,
  storedCycleMonth,
  adminGranted,
  now,
}: {
  storedUsedPoints: number;
  /** The row's monthly_granted_reset_date (YYYY-MM), if any. */
  storedCycleMonth: string | null | undefined;
  adminGranted: boolean;
  now: number | Date;
}): { usedPoints: number; cycleRolled: boolean; cycleMonth: string } {
  const cycleMonth = utcMonthKey(now);
  const sanitizedUsed = Math.max(0, Math.floor(storedUsedPoints));
  if (!adminGranted) {
    return { usedPoints: sanitizedUsed, cycleRolled: false, cycleMonth };
  }
  const cycleRolled = storedCycleMonth !== cycleMonth;
  return {
    usedPoints: cycleRolled ? 0 : sanitizedUsed,
    cycleRolled,
    cycleMonth,
  };
}
