import { v } from "convex/values";

/** Stored receipt for a no-auto-reload, no-debt consumer account preflight. */
export const accountCreditReceipt = v.object({
  success: v.boolean(),
  newBalanceDollars: v.number(),
  insufficientFunds: v.boolean(),
  monthlyCapExceeded: v.boolean(),
  includedPointsDeducted: v.number(),
  purchasedPointsDeducted: v.number(),
  includedTotalPoints: v.number(),
  includedRemainingPoints: v.number(),
  includedResetAt: v.optional(v.string()),
  debtPoints: v.number(),
  autoReloadTriggered: v.boolean(),
});

export const accountCreditReservationArgs = {
  serviceKey: v.string(),
  // Caller creates this identity on the server before dispatching the debit.
  // It is not a user/amount hash: equal charges for distinct requests are valid.
  reservationKey: v.string(),
  userId: v.string(),
  amountPoints: v.number(),
  subscription: v.union(v.literal("pro"), v.literal("ultra")),
};

export const accountCreditReservationState = v.union(
  v.literal("reserved"),
  v.literal("denied"),
  v.literal("in_use"),
  v.literal("settled"),
  v.literal("closed"),
  v.literal("reconciliation_required"),
);

/** Advance only when historical source accounting is replaced/erased, not for
 * ordinary additive debits or new purchased credits. Legacy rows begin at zero.
 */
export function nextCreditAccountingGeneration(
  current: number | undefined,
): number {
  const generation = current ?? 0;
  if (
    !Number.isSafeInteger(generation) ||
    generation < 0 ||
    generation >= Number.MAX_SAFE_INTEGER
  ) {
    throw new Error("Invalid credit accounting generation");
  }
  return generation + 1;
}
