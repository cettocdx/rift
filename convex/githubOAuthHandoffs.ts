import { mutation, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { validateServiceKey } from "./lib/utils";

export const createForBackend = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    ticketHash: v.string(),
    ciphertext: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const id = await ctx.db.insert("github_oauth_handoffs", {
      user_id: args.userId,
      ticket_hash: args.ticketHash,
      ciphertext: args.ciphertext,
      expires_at: Date.now() + 600_000,
    });
    await ctx.scheduler.runAfter(600_000, internal.githubOAuthHandoffs.expire, {
      id,
    });
    return null;
  },
});
export const consumeForBackend = mutation({
  args: { serviceKey: v.string(), userId: v.string(), ticketHash: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const row = await ctx.db
      .query("github_oauth_handoffs")
      .withIndex("by_ticket", (q) => q.eq("ticket_hash", args.ticketHash))
      .first();
    if (!row || row.user_id !== args.userId || row.expires_at <= Date.now())
      return null;
    await ctx.db.delete(row._id);
    return row.ciphertext;
  },
});
export const expire = internalMutation({
  args: { id: v.id("github_oauth_handoffs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (row && row.expires_at <= Date.now()) await ctx.db.delete(row._id);
    return null;
  },
});
