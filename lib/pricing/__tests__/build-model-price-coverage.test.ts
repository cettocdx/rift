import { BUILD_MODELS } from "@/types/chat";
import {
  getRetailModelPricing,
  isModelPriced,
} from "@/lib/rate-limit/token-bucket";

// C3. Four Build models (Opus 5, Sol Pro, Grok 4.6, Qwen 3.8-max) had no entry
// in the price table and silently billed at the 0.5/3.0 default -- Opus 5 was
// undercharged roughly tenfold on output. Every selectable Build model must be
// explicitly priced, and a new one must not be able to ship un-billed.
describe("every Build model is explicitly priced", () => {
  it.each(BUILD_MODELS.map((m) => [m.id, m.providerKey] as const))(
    "%s (%s) has an explicit price, not the generic default",
    (_id, providerKey) => {
      expect(isModelPriced(providerKey)).toBe(true);
    },
  );

  it("prices the premium Build models above the generic default", () => {
    const def = getRetailModelPricing("default");
    for (const key of [
      "model-opus-5",
      "model-gpt-5.6-sol-pro",
      "model-grok-4.6",
      "model-qwen3.8-max",
    ]) {
      const price = getRetailModelPricing(key);
      expect(price.output).toBeGreaterThan(def.output);
    }
  });
});
