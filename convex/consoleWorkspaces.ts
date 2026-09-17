import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { validateServiceKey } from "./lib/utils";

const workspace = v.union(v.literal("studio"), v.literal("hack"));
const authority = { serviceKey: v.string(), userId: v.string() };
export const ensure = mutation({
  args: { ...authority, chatId: v.string(), workspace, title: v.string() },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const purpose = args.workspace === "studio" ? "image" : "security";
    const chat = await ctx.db
      .query("chats")
      .withIndex("by_chat_id", (q) => q.eq("id", args.chatId))
      .first();
    if (chat) {
      if (chat.user_id !== args.userId || chat.purpose !== purpose)
        throw new ConvexError("Forbidden workspace");
      return;
    }
    await ctx.db.insert("chats", {
      id: args.chatId,
      user_id: args.userId,
      purpose,
      title: args.title.slice(0, 120),
      console_session: true,
      update_time: Date.now(),
    });
  },
});
export const list = query({
  args: { ...authority, workspace },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const purpose = args.workspace === "studio" ? "image" : "security";
    return (
      await ctx.db
        .query("chats")
        .withIndex("by_user_and_updated", (q) => q.eq("user_id", args.userId))
        .order("desc")
        .take(500)
    )
      .filter((chat) => chat.purpose === purpose)
      .slice(0, 100)
      .map((chat) => ({
        chatId: chat.id,
        title: chat.title,
        updatedAt: chat.update_time,
        purpose: chat.purpose,
      }));
  },
});
export const artifacts = query({
  args: { ...authority, fileIds: v.array(v.id("files")) },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    if (args.fileIds.length > 50) throw new ConvexError("Too many files");
    return Promise.all(
      args.fileIds.map(async (fileId) => {
        const file = await ctx.db.get(fileId);
        if (!file || file.user_id !== args.userId) return null;
        return {
          fileId,
          name: file.name,
          mediaType: file.media_type,
          size: file.size,
          generation: file.generation,
        };
      }),
    );
  },
});
export const admit = mutation({
  args: {
    ...authority,
    chatId: v.string(),
    operationId: v.string(),
    workspace,
    requestHash: v.string(),
    permission: v.union(v.literal("ask"), v.literal("auto")),
    target: v.optional(v.string()),
    taskId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const chat = await ctx.db
      .query("chats")
      .withIndex("by_chat_id", (q) => q.eq("id", args.chatId))
      .first();
    if (
      !chat ||
      chat.user_id !== args.userId ||
      chat.purpose !== (args.workspace === "studio" ? "image" : "security")
    )
      throw new ConvexError("Forbidden workspace");
    const existing = await ctx.db
      .query("console_workspace_operations")
      .withIndex("by_operation", (q) => q.eq("operation_id", args.operationId))
      .first();
    if (existing) {
      if (
        existing.user_id !== args.userId ||
        existing.chat_id !== args.chatId ||
        existing.request_hash !== args.requestHash
      )
        throw new ConvexError("Operation identity conflict");
      return { admitted: false, status: existing.status };
    }
    const active = await ctx.db
      .query("console_workspace_operations")
      .withIndex("by_chat", (q) => q.eq("chat_id", args.chatId))
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "running"),
          q.eq(q.field("status"), "uncertain"),
          q.eq(q.field("status"), "cancel_requested"),
        ),
      )
      .first();
    if (active) return { admitted: false, status: "busy" };
    const now = Date.now();
    await ctx.db.insert("console_workspace_operations", {
      operation_id: args.operationId,
      chat_id: args.chatId,
      user_id: args.userId,
      workspace: args.workspace,
      request_hash: args.requestHash,
      status: "running",
      permission: args.permission,
      target: args.target,
      task_id: args.taskId,
      created_at: now,
      updated_at: now,
    });
    return { admitted: true, status: "running" };
  },
});
export const finish = mutation({
  args: {
    ...authority,
    chatId: v.string(),
    operationId: v.string(),
    status: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("uncertain"),
      v.literal("cancel_requested"),
      v.literal("ended"),
    ),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const row = await ctx.db
      .query("console_workspace_operations")
      .withIndex("by_operation", (q) => q.eq("operation_id", args.operationId))
      .first();
    if (!row || row.user_id !== args.userId || row.chat_id !== args.chatId)
      throw new ConvexError("Forbidden operation");
    if (
      row.status === "completed" ||
      row.status === "failed" ||
      row.status === "ended"
    )
      return;
    await ctx.db.patch(row._id, {
      status: args.status,
      updated_at: Date.now(),
    });
  },
});
export const operations = query({
  args: { ...authority, chatId: v.string() },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    return (
      await ctx.db
        .query("console_workspace_operations")
        .withIndex("by_chat", (q) => q.eq("chat_id", args.chatId))
        .order("desc")
        .take(1000)
    )
      .filter((row) => row.user_id === args.userId)
      .map(({ operation_id, status, permission, target, task_id }) => ({
        operationId: operation_id,
        status,
        permission,
        target,
        taskId: task_id,
      }));
  },
});
export const cancelStudio = mutation({
  args: { ...authority, chatId: v.string(), operationId: v.string() },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const chat = await ctx.db
      .query("chats")
      .withIndex("by_chat_id", (q) => q.eq("id", args.chatId))
      .first();
    if (!chat || chat.user_id !== args.userId || chat.purpose !== "image")
      throw new ConvexError("Forbidden workspace");
    const op = await ctx.db
      .query("console_workspace_operations")
      .withIndex("by_operation", (q) => q.eq("operation_id", args.operationId))
      .first();
    if (!op || op.user_id !== args.userId || op.chat_id !== args.chatId)
      throw new ConvexError("Forbidden operation");
    if (
      op.status === "completed" ||
      op.status === "failed" ||
      op.status === "ended"
    )
      return { canceled: true };
    const latest = await ctx.db
      .query("console_workspace_operations")
      .withIndex("by_chat", (q) => q.eq("chat_id", args.chatId))
      .order("desc")
      .first();
    if (latest?._id !== op._id)
      throw new ConvexError("A newer operation is active");
    await ctx.db.patch(chat._id, {
      canceled_at: Date.now(),
      cancel_skip_save: undefined,
    });
    await ctx.db.patch(op._id, {
      status: "cancel_requested",
      updated_at: Date.now(),
    });
    // The producer's existing cancellation poller performs the same actual abort
    // used by website Stop, then reconciles the charge and persists partial output.
    return { canceled: false, cancelRequested: true };
  },
});
