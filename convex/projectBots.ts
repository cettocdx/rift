import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireOwnedProject } from "./lib/projectOwnership";
import { validateServiceKey } from "./lib/utils";
import {
  createProjectBotProfile,
  parseProjectBotProfile,
} from "../lib/ai/agents/project-bot-templates";
import { resolveProjectBotSkills } from "./lib/projectBotSkills";

async function owner(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Sign in to manage project bots.");
  return identity.subject.split("|")[0];
}
async function ownedBot(
  ctx: QueryCtx | MutationCtx,
  id: Id<"project_bots">,
  userId: string,
) {
  const bot = await ctx.db.get(id);
  if (!bot || bot.user_id !== userId || bot.archived_at !== undefined)
    throw new ConvexError("This bot is not available.");
  await requireOwnedProject(ctx.db, bot.project_id, userId);
  return bot;
}
function clean(value: string, max: number) {
  const text = value.trim();
  if (!text || text.length > max)
    throw new ConvexError(`Use between 1 and ${max} characters.`);
  return text;
}
export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await owner(ctx);
    await requireOwnedProject(ctx.db, projectId, userId);
    return (
      await ctx.db
        .query("project_bots")
        .withIndex("by_user_project", (q) =>
          q.eq("user_id", userId).eq("project_id", projectId),
        )
        .collect()
    ).filter((b) => b.archived_at === undefined);
  },
});
export const create = mutation({
  args: {
    projectId: v.id("projects"),
    templateId: v.string(),
    name: v.optional(v.string()),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await owner(ctx);
    const project = await requireOwnedProject(ctx.db, args.projectId, userId);
    if (project.type !== "app")
      throw new ConvexError("Project bots require a Build project.");
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(args.requestId))
      throw new ConvexError("Invalid creation request.");
    const existing = await ctx.db
      .query("project_bots")
      .withIndex("by_user_request", (q) =>
        q.eq("user_id", userId).eq("request_id", args.requestId),
      )
      .unique();
    if (existing) {
      if (
        existing.project_id !== args.projectId ||
        existing.archived_at !== undefined
      )
        throw new ConvexError("This creation request has already been used.");
      return { botId: existing._id, chatId: existing.chat_id };
    }
    const bots = await ctx.db
      .query("project_bots")
      .withIndex("by_user_project", (q) =>
        q.eq("user_id", userId).eq("project_id", args.projectId),
      )
      .collect();
    if (
      bots.filter((b) => b.archived_at === undefined).length >= 24 ||
      bots.length >= 100
    )
      throw new ConvexError("This project has reached its bot limit.");
    const name = args.name === undefined ? undefined : clean(args.name, 40);
    const profile = createProjectBotProfile(
      args.templateId,
      crypto.randomUUID(),
      name,
    );
    const now = Date.now();
    const chatId = crypto.randomUUID();
    const botId = await ctx.db.insert("project_bots", {
      user_id: userId,
      project_id: args.projectId,
      chat_id: chatId,
      template_id: args.templateId,
      template_version: 1,
      name: profile.name,
      mission: profile.mission,
      profile_json: JSON.stringify(profile),
      request_id: args.requestId,
      created_at: now,
      updated_at: now,
    });
    await ctx.db.insert("chats", {
      id: chatId,
      user_id: userId,
      project_id: args.projectId,
      project_bot_id: botId,
      title: profile.name,
      purpose: "app",
      default_model_slug: "agent-long",
      update_time: now,
    });
    return { botId, chatId };
  },
});
export const update = mutation({
  args: {
    id: v.id("project_bots"),
    name: v.string(),
    mission: v.string(),
    profileJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await owner(ctx);
    const bot = await ownedBot(ctx, args.id, userId);
    const before = parseProjectBotProfile(bot.profile_json);
    const profile = parseProjectBotProfile(
      args.profileJson ?? bot.profile_json,
    );
    if (!before || !profile)
      throw new ConvexError("The bot profile is invalid.");
    profile.id = before.id;
    profile.mention = before.mention;
    profile.enabled = true;
    profile.name = clean(args.name, 40);
    profile.mission = clean(args.mission, 140);
    // Referenced credentials/skills must belong to the caller. Built-in skill
    // packs are public instructions; arbitrary foreign custom IDs are rejected.
    for (const id of profile.mcpServerIds) {
      const normalized = ctx.db.normalizeId("mcp_servers", id);
      const server = normalized ? await ctx.db.get(normalized) : null;
      if (!server || server.user_id !== userId)
        throw new ConvexError("A selected connection is not available.");
    }
    await resolveProjectBotSkills(ctx.db, userId, profile.skillIds);
    await ctx.db.patch(bot._id, {
      name: profile.name,
      mission: profile.mission,
      profile_json: JSON.stringify(profile),
      updated_at: Date.now(),
    });
  },
});
export const openChat = mutation({
  args: { id: v.id("project_bots") },
  handler: async (ctx, { id }) => {
    const userId = await owner(ctx);
    const bot = await ownedBot(ctx, id, userId);
    const chat = await ctx.db
      .query("chats")
      .withIndex("by_chat_id", (q) => q.eq("id", bot.chat_id))
      .unique();
    if (!chat) {
      // Deleting chat history does not delete the bot; recreate its same owned
      // conversation identity so subsequent opens cannot fork silently.
      await ctx.db.insert("chats", {
        id: bot.chat_id,
        title: bot.name,
        user_id: userId,
        project_id: bot.project_id,
        project_bot_id: bot._id,
        purpose: "app",
        default_model_slug: "agent-long",
        update_time: Date.now(),
      });
    } else if (
      chat.user_id !== userId ||
      chat.project_bot_id !== bot._id ||
      chat.project_id !== bot.project_id
    )
      throw new ConvexError("The bot conversation is not available.");
    return bot.chat_id;
  },
});
export const archive = mutation({
  args: { id: v.id("project_bots") },
  handler: async (ctx, { id }) => {
    const bot = await ownedBot(ctx, id, await owner(ctx));
    const chat = await ctx.db
      .query("chats")
      .withIndex("by_chat_id", (q) => q.eq("id", bot.chat_id))
      .unique();
    if (chat?.active_trigger_run_id || chat?.active_stream_id)
      throw new ConvexError(
        "Stop the active conversation before archiving this bot.",
      );
    const meetings = await ctx.db
      .query("bot_meetings")
      .withIndex("by_user_project", (q) =>
        q.eq("user_id", bot.user_id).eq("project_id", bot.project_id),
      )
      .collect();
    const meetingIds = new Set(
      meetings
        .filter((m) => m.participant_bot_ids.includes(bot._id))
        .map((m) => m._id),
    );
    for (const meeting of meetings.filter((m) => meetingIds.has(m._id))) {
      const running = await ctx.db
        .query("chats")
        .withIndex("by_chat_id", (q) => q.eq("id", meeting.chat_id))
        .unique();
      if (running?.active_trigger_run_id || running?.active_stream_id)
        throw new ConvexError(
          "Stop the active meeting before archiving this bot.",
        );
    }
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_user_and_updated", (q) => q.eq("user_id", bot.user_id))
      .collect();
    for (const task of tasks) {
      if (
        task.assignee_bot_id === bot._id ||
        (task.bot_meeting_id && meetingIds.has(task.bot_meeting_id))
      ) {
        await ctx.db.patch(task._id, {
          enabled: false,
          next_run_at: undefined,
          scheduler_state: "inactive",
          schedule_version: (task.schedule_version ?? 0) + 1,
          updated_at: Date.now(),
        });
      }
    }
    await ctx.db.patch(bot._id, {
      archived_at: Date.now(),
      updated_at: Date.now(),
    });
  },
});
export const getForRuntime = query({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    id: v.id("project_bots"),
    chatId: v.string(),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const bot = await ownedBot(ctx, args.id, args.userId);
    if (bot.project_id !== args.projectId || bot.chat_id !== args.chatId)
      throw new ConvexError("The bot conversation is not available.");
    const profile = parseProjectBotProfile(bot.profile_json);
    if (!profile) throw new ConvexError("The bot profile is invalid.");
    return {
      profileJson: bot.profile_json,
      skills: await resolveProjectBotSkills(
        ctx.db,
        args.userId,
        profile.skillIds,
      ),
    };
  },
});
