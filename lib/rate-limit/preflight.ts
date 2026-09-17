import type { RateLimitInfo } from "@/types";
import type { UsageRefundTracker } from "./refund";

/** Settle a charge before propagating parallel setup failures to refund handlers. */
export async function runTrackedPreflight<S, M>({
  reserve,
  snapshot,
  moderation,
  tracker,
  agentMode,
}: {
  reserve: () => Promise<RateLimitInfo>;
  snapshot: () => Promise<S>;
  moderation: Promise<M>;
  tracker: Pick<UsageRefundTracker, "recordDeductions" | "recordFreeAgentClaim">;
  agentMode: boolean;
}): Promise<[RateLimitInfo, S, M]> {
  const results = await Promise.allSettled([
    Promise.resolve().then(reserve).then((usage) => {
      // No await between receiving the charge and making it refundable.
      tracker.recordDeductions(usage);
      if (agentMode && usage.servedFrom === "free") tracker.recordFreeAgentClaim();
      return usage;
    }),
    Promise.resolve().then(snapshot),
    moderation,
  ]);
  const [usage, monthly, checked] = results;
  if (usage.status === "rejected") throw usage.reason;
  if (monthly.status === "rejected") throw monthly.reason;
  if (checked.status === "rejected") throw checked.reason;
  return [usage.value, monthly.value, checked.value];
}
