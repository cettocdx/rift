import { v } from "convex/values";
export const providerReceiptUsage = v.object({
  input_tokens: v.optional(v.number()),
  output_tokens: v.optional(v.number()),
  total_tokens: v.optional(v.number()),
  cache_read_tokens: v.optional(v.number()),
  cache_write_tokens: v.optional(v.number()),
  reasoning_tokens: v.optional(v.number()),
  cost_dollars: v.optional(v.number()),
});
