import { getRawModelPricing } from "@/lib/rate-limit/token-bucket";
import type { ProxyUsage } from "@/lib/opencode/sse-usage";

/**
 * Dollar cost of one proxied completion, in micro-dollars (integer, for Redis
 * HINCRBY). Prefers OpenRouter's own `usage.cost` (the authoritative provider
 * charge); when a provider omits it, falls back to the raw per-token price for
 * the RIFT model key so a run is never billed at zero. Cached-read tokens are
 * priced at 10% of input, matching the config's cache economics.
 */
export function resolveCostMicros(usage: ProxyUsage, modelKey: string): number {
  if (usage.costDollars > 0) {
    return Math.round(usage.costDollars * 1_000_000);
  }
  const price = getRawModelPricing(modelKey);
  const billableInput = Math.max(0, usage.inputTokens - usage.cachedTokens);
  const inputCost = (billableInput / 1_000_000) * price.input;
  const cacheCost = (usage.cachedTokens / 1_000_000) * price.input * 0.1;
  const outputCost = (usage.outputTokens / 1_000_000) * price.output;
  return Math.round((inputCost + cacheCost + outputCost) * 1_000_000);
}
