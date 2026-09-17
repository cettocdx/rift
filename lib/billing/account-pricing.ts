/** Default customer markup; owner pricing is determined from trusted server identity. */
export const RETAIL_MARGIN = 2.5;

/** Never pass an email from a request body or user-editable profile metadata. */
export function getAccountPricingMargin(
  identity: { email?: string | null } | null | undefined,
): number {
  return identity?.email?.trim().toLowerCase() === "ahmetcet92@hotmail.com"
    ? 1
    : RETAIL_MARGIN;
}

/** Server-resolved pricing only. Invalid values cannot reduce a bill. */
export function normalizePricingMargin(value?: number): number {
  return value === 1 ? 1 : RETAIL_MARGIN;
}
