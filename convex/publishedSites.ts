import { ConvexError, v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { validateServiceKey } from "./lib/utils";

/**
 * Apps published from a Build run.
 *
 * The bytes live on Vercel; these rows are the workspace's own record of what
 * was published, from which chat, and at what address — so the UI can show a
 * live link without querying Vercel on every render.
 */

function authedUserId(subject: string): string {
  return subject.split("|")[0];
}

/** The signed-in user's published apps, newest first. */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const userId = authedUserId(identity.subject);

    const sites = await ctx.db
      .query("published_sites")
      .withIndex("by_user", (q) => q.eq("user_id", userId))
      .collect();

    return sites
      .sort((left, right) => right.published_at - left.published_at)
      .map((site) => ({
        title: site.title,
        url: site.url,
        chat_id: site.chat_id,
        project_name: site.project_name,
        file_count: site.file_count,
        total_bytes: site.total_bytes,
        published_at: site.published_at,
      }));
  },
});

/** What was last published from a chat, so the panel can show its address. */
export const getByChat = query({
  args: { chat_id: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const userId = authedUserId(identity.subject);

    const site = await ctx.db
      .query("published_sites")
      .withIndex("by_chat", (q) => q.eq("chat_id", args.chat_id))
      .first();

    if (!site || site.user_id !== userId) return null;
    return {
      title: site.title,
      url: site.url,
      project_name: site.project_name,
      published_at: site.published_at,
    };
  },
});

/**
 * Record a completed deployment.
 *
 * Server-side only: the route authenticates the user, reads their sandbox, and
 * talks to Vercel, so the write is gated on the service key rather than on a
 * browser session.
 */
export const recordDeployment = mutation({
  args: {
    serviceKey: v.string(),
    user_id: v.string(),
    chat_id: v.string(),
    title: v.string(),
    project_name: v.string(),
    deployment_id: v.string(),
    url: v.string(),
    file_count: v.number(),
    total_bytes: v.number(),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);

    const existing = await ctx.db
      .query("published_sites")
      .withIndex("by_project", (q) => q.eq("project_name", args.project_name))
      .first();

    // The project name already carries the owner, so a mismatch here means the
    // name was derived from a different account — refuse rather than overwrite.
    if (existing && existing.user_id !== args.user_id) {
      throw new ConvexError("That project belongs to another account");
    }

    const record = {
      user_id: args.user_id,
      chat_id: args.chat_id,
      title: args.title,
      project_name: args.project_name,
      deployment_id: args.deployment_id,
      url: args.url,
      file_count: args.file_count,
      total_bytes: args.total_bytes,
      published_at: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, record);
      return { url: args.url, republished: true };
    }

    await ctx.db.insert("published_sites", record);
    return { url: args.url, republished: false };
  },
});
