import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { validateServiceKey } from "./lib/utils";

export const request = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    chatId: v.string(),
    runId: v.string(),
    toolCallId: v.string(),
    toolName: v.string(),
    preview: v.string(),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    if (
      !args.userId ||
      args.preview.length > 6000 ||
      args.toolName.length > 200
    )
      throw new Error("Invalid approval request");
    const chat = await ctx.db
      .query("chats")
      .withIndex("by_chat_id", (q) => q.eq("id", args.chatId))
      .first();
    if (chat && chat.user_id !== args.userId) throw new Error("Not authorized");
    const { serviceKey: _, ...data } = args;
    const id = await ctx.db.insert("tool_approvals", {
      ...data,
      status: "pending",
      expiresAt: Date.now() + 10 * 60_000,
    });
    await ctx.scheduler.runAfter(10 * 60_000, internal.approvals.expire, {
      id,
    });
    await ctx.scheduler.runAfter(
      24 * 60 * 60_000,
      internal.approvals.removeExpired,
      { id },
    );
    return id;
  },
});
export const pending = query({
  args: { chatId: v.string() },
  handler: async (ctx, { chatId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const userId = identity.subject.split("|")[0];
    const rows = await ctx.db
      .query("tool_approvals")
      .withIndex("by_owner_chat_status", (q) =>
        q.eq("userId", userId).eq("chatId", chatId).eq("status", "pending"),
      )
      .take(30);
    return rows
      .filter((row) => row.expiresAt > Date.now())
      .map(({ _id, toolCallId, toolName, preview, expiresAt }) => ({
        _id,
        toolCallId,
        toolName,
        preview,
        expiresAt,
      }));
  },
});
export const decide = mutation({
  args: { id: v.id("tool_approvals"), approve: v.boolean() },
  handler: async (ctx, { id, approve }) => {
    const identity = await ctx.auth.getUserIdentity();
    const row = await ctx.db.get(id);
    if (!identity || !row || row.userId !== identity.subject.split("|")[0])
      throw new Error("Not authorized");
    if (row.status !== "pending" || row.expiresAt <= Date.now())
      throw new Error("This approval is no longer active");
    await ctx.db.patch(id, { status: approve ? "approved" : "denied" });
  },
});
export const consume = mutation({
  args: {
    serviceKey: v.string(),
    id: v.id("tool_approvals"),
    userId: v.string(),
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const row = await ctx.db.get(args.id);
    if (!row || row.userId !== args.userId || row.runId !== args.runId)
      throw new Error("Not authorized");
    if (row.expiresAt <= Date.now()) return "expired";
    const status = row.status;
    if (row.status === "approved")
      await ctx.db.patch(row._id, { status: "consumed" });
    return status;
  },
});
export const close = mutation({
  args: {
    serviceKey: v.string(),
    id: v.id("tool_approvals"),
    userId: v.string(),
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const row = await ctx.db.get(args.id);
    if (!row || row.userId !== args.userId || row.runId !== args.runId)
      throw new Error("Not authorized");
    if (row.status === "pending" || row.status === "approved")
      await ctx.db.patch(row._id, { status: "canceled" });
  },
});
export const removeExpired = internalMutation({
  args: { id: v.id("tool_approvals") },
  handler: async (ctx, { id }) => {
    if (await ctx.db.get(id)) await ctx.db.delete(id);
  },
});

export const expire = internalMutation({
  args: { id: v.id("tool_approvals") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (
      row &&
      row.expiresAt <= Date.now() &&
      (row.status === "pending" || row.status === "approved")
    )
      await ctx.db.patch(id, { status: "canceled" });
  },
});

/** Personal-key clients use the same owner-bound approval records as the app. */
export const pendingForBackend = query({
  args: { serviceKey: v.string(), userId: v.string(), chatId: v.string() },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const rows = await ctx.db
      .query("tool_approvals")
      .withIndex("by_owner_chat_status", (q) =>
        q
          .eq("userId", args.userId)
          .eq("chatId", args.chatId)
          .eq("status", "pending"),
      )
      .take(30);
    return rows
      .filter((r) => r.expiresAt > Date.now())
      .map((r) => ({ id: r._id, toolName: r.toolName, preview: r.preview }));
  },
});
export const decideForBackend = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    chatId: v.string(),
    id: v.id("tool_approvals"),
    approve: v.boolean(),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const row = await ctx.db.get(args.id);
    if (!row || row.userId !== args.userId || row.chatId !== args.chatId)
      throw new Error("Not authorized");
    if (row.status !== "pending" || row.expiresAt <= Date.now())
      throw new Error("Approval expired");
    await ctx.db.patch(row._id, {
      status: args.approve ? "approved" : "denied",
    });
  },
});
