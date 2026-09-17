import { v, type Infer } from "convex/values";

/** Assertions from the authenticated server caller, not independently verified
 * provider invoices. Never construct this evidence from request-body usage. */
export const terminalCreditUsage = v.union(
  v.object({
    status: v.literal("known"),
    source: v.union(v.literal("provider"), v.literal("server_estimate")),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    modelCostDollars: v.number(),
    nonModelCostDollars: v.number(),
  }),
  v.object({
    status: v.literal("unknown"),
    reason: v.union(
      v.literal("interrupted"),
      v.literal("provider_unavailable"),
      v.literal("missing_usage"),
    ),
  }),
);

export const terminalCreditSettlementArgs = {
  // One immutable terminal revision. Corrections require a separate contract.
  revision: v.literal(1),
  pricingVersion: v.literal("account-credit-v1"),
  actualPoints: v.union(v.number(), v.null()),
  usage: terminalCreditUsage,
  usageDigest: v.string(),
};

export const terminalCreditSettlementResult = v.union(
  v.object({
    state: v.literal("settled"),
    receipt: v.object({
      revision: v.literal(1),
      actualPoints: v.number(),
      adjustmentPoints: v.number(),
      includedPoints: v.number(),
      purchasedPoints: v.number(),
      debtPointsAdded: v.number(),
      includedPointsRefunded: v.number(),
      purchasedPointsRefunded: v.number(),
      balancePoints: v.number(),
      includedUsedPoints: v.number(),
      monthlySpentPoints: v.number(),
      accountDebtPoints: v.number(),
    }),
  }),
  v.object({
    state: v.literal("reconciliation_required"),
    reason: v.union(v.literal("unknown_usage"), v.literal("source_changed")),
  }),
);

export const storedTerminalCreditSettlement = v.object({
  ...terminalCreditSettlementArgs,
  result: terminalCreditSettlementResult,
});

export function assertCreditInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid credit settlement arithmetic");
}

type DigestInput = {
  reservationKey: string;
  userId: string;
  amountPoints: number;
  subscription: "pro" | "ultra";
  revision: 1;
  pricingVersion: "account-credit-v1";
  actualPoints: number | null;
  usage: Infer<typeof terminalCreditUsage>;
  usageDigest: string;
};

/** Canonical binding protects retries from silently changing terminal evidence.
 * It authenticates consistency, not the truth of the service's usage assertion. */
export async function validateTerminalCreditEvidence(args: DigestInput) {
  if (
    args.revision !== 1 ||
    args.pricingVersion !== "account-credit-v1" ||
    !/^[a-f0-9]{64}$/.test(args.usageDigest)
  )
    throw new Error("Invalid terminal credit evidence");
  const usage = args.usage;
  if (usage.status === "known") {
    if (args.actualPoints === null) throw new Error("Missing terminal cost");
    assertCreditInteger(args.actualPoints);
    assertCreditInteger(usage.inputTokens);
    assertCreditInteger(usage.outputTokens);
    if (
      !usage.model.trim() ||
      usage.model.length > 256 ||
      !["provider", "server_estimate"].includes(usage.source) ||
      !Number.isFinite(usage.modelCostDollars) ||
      usage.modelCostDollars < 0 ||
      !Number.isFinite(usage.nonModelCostDollars) ||
      usage.nonModelCostDollars < 0
    )
      throw new Error("Invalid terminal credit evidence");
  } else if (
    usage.status !== "unknown" ||
    args.actualPoints !== null ||
    !["interrupted", "provider_unavailable", "missing_usage"].includes(
      usage.reason,
    )
  ) {
    throw new Error("Invalid unknown terminal usage");
  }
  const canonicalUsage =
    usage.status === "known"
      ? {
          status: usage.status,
          source: usage.source,
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          modelCostDollars: usage.modelCostDollars,
          nonModelCostDollars: usage.nonModelCostDollars,
        }
      : { status: usage.status, reason: usage.reason };
  const data = new TextEncoder().encode(
    JSON.stringify({
      reservationKey: args.reservationKey,
      userId: args.userId,
      amountPoints: args.amountPoints,
      subscription: args.subscription,
      revision: args.revision,
      pricingVersion: args.pricingVersion,
      actualPoints: args.actualPoints,
      usage: canonicalUsage,
    }),
  );
  const hash = await crypto.subtle.digest("SHA-256", data);
  const digest = Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (digest !== args.usageDigest)
    throw new Error("Terminal usage digest mismatch");
}
