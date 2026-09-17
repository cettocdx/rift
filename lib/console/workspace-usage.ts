import { POINTS_PER_DOLLAR } from "@/lib/billing/credit-units";
import { computeActualCostPoints } from "@/lib/rate-limit/token-bucket";

export type WorkspaceUsageOperation = {
  operationId: string;
  status: "settled" | "pending" | "unknown";
  credits: number | null;
};
export function validWorkspaceIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(value)
  );
}
export function workspaceIdentity(headers: Headers) {
  const sessionId = headers.get("x-rift-session-id");
  const operationId = headers.get("x-rift-operation-id");
  if (sessionId === null && operationId === null) return null;
  if (
    !validWorkspaceIdentity(sessionId) ||
    !validWorkspaceIdentity(operationId)
  )
    throw new Error("Invalid RIFT usage identity");
  return { sessionId, operationId };
}
export function summarizeWorkspaceUsage(
  sessionId: string,
  input: WorkspaceUsageOperation[],
) {
  const unique = new Map<string, WorkspaceUsageOperation>();
  for (const item of input) {
    if (
      item.status === "settled" &&
      (!Number.isSafeInteger(item.credits) || item.credits! < 0)
    )
      throw new Error("Invalid charged credits");
    const prior = unique.get(item.operationId);
    if (
      prior &&
      (prior.status !== item.status || prior.credits !== item.credits)
    )
      throw new Error("Conflicting usage receipts");
    unique.set(item.operationId, item);
  }
  const operations = [...unique.values()];
  const settledCredits = operations.reduce(
    (sum, item) => sum + (item.status === "settled" ? item.credits! : 0),
    0,
  );
  if (!Number.isSafeInteger(settledCredits))
    throw new Error("Usage total exceeds range");
  const status =
    !operations.length || operations.some((item) => item.status === "unknown")
      ? "unknown"
      : operations.some((item) => item.status === "pending")
        ? "pending"
        : "settled";
  return {
    version: 1,
    sessionId,
    status,
    credits: status === "settled" ? settledCredits : null,
    usd: status === "settled" ? settledCredits / POINTS_PER_DOLLAR : null,
    settledCredits,
    settledUsd: settledCredits / POINTS_PER_DOLLAR,
    operations: operations.map((item) => ({
      ...item,
      usd: item.status === "settled" ? item.credits! / POINTS_PER_DOLLAR : null,
    })),
  };
}

/** Project the same trusted settlement input used by the debit. This is only
 * published after the durable journal acknowledges that debit. Never analytics. */
export function journalChargePoints(
  evidence: Record<string, unknown>,
): number | null {
  if (evidence.subscription === "free" && evidence.servedFrom !== "balance")
    return 0;
  if (!["account", "balance"].includes(String(evidence.servedFrom)))
    return null;
  const usage = evidence.usage as { costDollars?: unknown } | undefined;
  if (
    !usage ||
    typeof usage.costDollars !== "number" ||
    !Number.isFinite(usage.costDollars) ||
    usage.costDollars < 0
  )
    return null;
  const pricingMargin = evidence.pricingMargin;
  if (
    typeof pricingMargin !== "number" ||
    !Number.isFinite(pricingMargin) ||
    pricingMargin <= 0
  )
    return null;
  const points = computeActualCostPoints({
    actualInputTokens: 0,
    actualOutputTokens: 0,
    providerCostDollars: usage.costDollars,
    pricingMargin,
  });
  return Number.isSafeInteger(points) && points >= 0 ? points : null;
}
