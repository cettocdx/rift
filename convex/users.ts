import { v } from "convex/values";
import { validateServiceKey } from "./lib/utils";
import { getAccountPricingMargin } from "../lib/billing/account-pricing";
import { query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/** The currently authenticated user's record, or null. */
export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db.get(userId);
  },
});

/** Worker billing resolves policy from its owner-bound server identity. */
export const pricingForBackend = query({
  args: { serviceKey: v.string(), userId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const id = ctx.db.normalizeId("users", args.userId);
    const user = id ? await ctx.db.get(id) : null;
    if (!user) throw new Error("Billing account not found");
    return getAccountPricingMargin(user);
  },
});
