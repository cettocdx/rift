import { getRetailModelPricing } from "@/lib/rate-limit/token-bucket";

/**
 * Per-million-token price the user is actually charged — retail, with the
 * margin already applied. This belongs beside the work, not beside the model
 * picker: choosing a model is not the moment you care what you are spending;
 * watching the agent burn tokens is.
 *
 * Whole dollars stay whole so the figure reads as a price rather than a
 * measurement: "$5/$15", "$3.13/$6.25".
 */

const formatDollars = (value: number): string =>
  Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;

export function formatModelPrice(
  providerKey?: string,
  pricingMargin?: number,
): {
  input: string;
  output: string;
} {
  const pricing = getRetailModelPricing(providerKey, pricingMargin);
  return {
    input: formatDollars(pricing.input),
    output: formatDollars(pricing.output),
  };
}
