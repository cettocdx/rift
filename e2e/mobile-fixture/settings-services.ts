import { useSyncExternalStore } from "react";
import { getFunctionName } from "convex/server";
const counts = { create: 0, clipboard: 0, revoke: 0, forbidden: 0 };
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((callback) => callback());
const subscribe = (callback: () => void) => {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
};
export function useFixtureCounts() {
  return useSyncExternalStore(subscribe, () => JSON.stringify(counts));
}
export function installClipboardBoundary() {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async () => {
        counts.clipboard++;
        notify();
      },
    },
  });
}
export function useQuery(reference: Parameters<typeof getFunctionName>[0]) {
  const name = getFunctionName(reference);
  if (name === "apiKeys:list")
    return [
      {
        id: "fixture-key",
        name: "Fixture key",
        keyPrefix: "fixture_only",
        createdAt: 1,
        revoked: false,
      },
    ];
  if (name === "userCustomization:getUserCustomization")
    return { extra_usage_enabled: false };
  if (name === "extraUsage:getExtraUsageSettings")
    return {
      balancePoints: 1000,
      autoReloadEnabled: false,
      monthlySpentDollars: 0,
      includedCredits: { remaining: 1000, total: 1000 },
    };
  if (name === "subscriptions:getActiveSubscription") return { tier: "pro" };
  throw Error(`Unexpected settings fixture query: ${name}`);
}
export function useMutation(reference: Parameters<typeof getFunctionName>[0]) {
  const name = getFunctionName(reference);
  return async () => {
    if (name === "apiKeys:create") {
      counts.create++;
      notify();
      return { key: "fixture-value-not-a-credential" };
    }
    if (name === "apiKeys:revoke") {
      counts.revoke++;
      notify();
      return;
    }
    counts.forbidden++;
    notify();
    throw Error("Mutation disabled in Settings fixture");
  };
}
export const useAction = () => async () => {
  counts.forbidden++;
  notify();
  throw Error("Billing actions disabled in Settings fixture");
};
