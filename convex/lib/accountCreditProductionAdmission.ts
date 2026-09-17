import { v, type Infer } from "convex/values";

/** Server-created console request identity. No client authority assertions. */
export const productionCreditBinding = v.object({
  version: v.literal(1),
  kind: v.literal("console_model"),
  requestId: v.string(),
});
export const productionCreditDenial = v.union(
  v.literal("no_entitlement"),
  v.literal("tier_changed"),
  v.literal("suspended"),
  v.literal("outstanding_debt"),
  v.literal("source_changed"),
);
export function validateProductionCreditBinding(
  binding: Infer<typeof productionCreditBinding>,
): void {
  if (
    !binding ||
    binding.version !== 1 ||
    binding.kind !== "console_model" ||
    typeof binding.requestId !== "string" ||
    !binding.requestId ||
    binding.requestId.trim() !== binding.requestId ||
    binding.requestId.length > 200
  )
    throw new Error("Invalid production credit binding");
}
