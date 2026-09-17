import { BUILD_MODELS } from "@/types/chat";

/**
 * The model allowlist for the LLM proxy.
 *
 * OpenCode addresses models by RIFT's own `providerKey` (e.g. `model-gpt-5.6-sol`);
 * the proxy maps that to the real OpenRouter slug (`openai/gpt-5.6-sol`) and
 * refuses anything not in BUILD_MODELS. Keying on `providerKey` — not the slug —
 * means the proxy, `MODEL_PRICING_MAP` and `UsageTracker.computeCostDollars`
 * all share one identifier, so billing lines up with no extra translation.
 */

const KEY_TO_SLUG: ReadonlyMap<string, string> = new Map(
  BUILD_MODELS.map((m) => [m.providerKey, m.providerModel]),
);

export function isAllowedModelKey(providerKey: unknown): providerKey is string {
  return typeof providerKey === "string" && KEY_TO_SLUG.has(providerKey);
}

/** providerKey → OpenRouter slug, or null when the key is not on the allowlist. */
export function resolveOpenRouterSlug(providerKey: unknown): string | null {
  if (typeof providerKey !== "string") return null;
  return KEY_TO_SLUG.get(providerKey) ?? null;
}

/** Every allowed provider key, for building the gateway provider config. */
export function allowedModelKeys(): string[] {
  return [...KEY_TO_SLUG.keys()];
}
