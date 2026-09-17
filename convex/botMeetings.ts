import { resolveProjectBotSkills } from "./lib/projectBotSkills";
import { parseProjectBotProfile } from "../lib/ai/agents/project-bot-templates";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireOwnedProject } from "./lib/projectOwnership";
import { requireMeetingParticipants } from "./lib/botTaskBindings";
import { validateServiceKey } from "./lib/utils";
import { normalizeSchedule, resolveSubscriptionForBackend } from "./tasks";

async function owner(ctx: MutationCtx | QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Sign in to manage meetings.");
  return identity.subject.split("|")[0];
}
function clean(text: string, max: number) {
  const value = text.trim();
  if (!value || value.length > max)
    throw new ConvexError(`Use between 1 and ${max} characters.`);
  return value;
}
async function ownedMeeting(
  ctx: MutationCtx | QueryCtx,
  id: Id<"bot_meetings">,
  userId: string,
) {
  const meeting = await ctx.db.get(id);
  if (!meeting || meeting.user_id !== userId)
    throw new ConvexError("This meeting is not available.");
  await requireOwnedProject(ctx.db, meeting.project_id, userId);
  return meeting;
}

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const userId = await owner(ctx);
    await requireOwnedProject(ctx.db, args.projectId, userId);
    return ctx.db
      .query("bot_meetings")
      .withIndex("by_user_project", (q) =>
        q.eq("user_id", userId).eq("project_id", args.projectId),
      )
      .order("desc")
      .take(100);
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    agenda: v.string(),
    participantBotIds: v.array(v.id("project_bots")),
    requestId: v.string(),
    scheduledFor: v.optional(v.number()),
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await owner(ctx);
    await requireMeetingParticipants(
      ctx.db,
      userId,
      args.projectId,
      args.participantBotIds,
    );
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(args.requestId))
      throw new ConvexError("Invalid meeting request.");
    const existing = await ctx.db
      .query("bot_meetings")
      .withIndex("by_user_request", (q) =>
        q.eq("user_id", userId).eq("request_id", args.requestId),
      )
      .unique();
    if (existing) {
      if (existing.project_id !== args.projectId)
        throw new ConvexError("This meeting request was already used.");
      return { meetingId: existing._id, chatId: existing.chat_id };
    }
    const count = await ctx.db
      .query("bot_meetings")
      .withIndex("by_user_project", (q) =>
        q.eq("user_id", userId).eq("project_id", args.projectId),
      )
      .take(100);
    if (count.length >= 100)
      throw new ConvexError("This project has reached its meeting limit.");
    const title = clean(args.title, 120),
      agenda = clean(args.agenda, 8000),
      now = Date.now();
    let schedule;
    if (args.scheduledFor !== undefined) {
      if ((await resolveSubscriptionForBackend(ctx, userId)) === "free")
        throw new ConvexError("Automatic schedules require RIFT Pro or Max");
      const tasks = await ctx.db
        .query("tasks")
        .withIndex("by_user_and_updated", (q) => q.eq("user_id", userId))
        .take(250);
      if (tasks.length >= 250) throw new ConvexError("Task limit reached.");
      schedule = normalizeSchedule(
        {
          scheduleType: "once",
          scheduledFor: args.scheduledFor,
          timezone: args.timezone,
        },
        now,
      );
    }
    const chatId = crypto.randomUUID();
    const meetingId = await ctx.db.insert("bot_meetings", {
      user_id: userId,
      project_id: args.projectId,
      chat_id: chatId,
      participant_bot_ids: args.participantBotIds,
      title,
      agenda,
      request_id: args.requestId,
      created_at: now,
      updated_at: now,
    });
    await ctx.db.insert("chats", {
      id: chatId,
      user_id: userId,
      project_id: args.projectId,
      bot_meeting_id: meetingId,
      title,
      purpose: "app",
      default_model_slug: "agent-long",
      update_time: now,
    });
    if (schedule) {
      const taskId = await ctx.db.insert("tasks", {
        user_id: userId,
        project_id: args.projectId,
        bot_meeting_id: meetingId,
        title,
        prompt: agenda,
        purpose: "app",
        status: "open",
        enabled: true,
        ...schedule,
        schedule_version: 1,
        created_at: now,
        updated_at: now,
      });
      await ctx.db.patch(meetingId, { task_id: taskId });
    }
    return { meetingId, chatId };
  },
});

export const openChat = mutation({
  args: { id: v.id("bot_meetings") },
  handler: async (ctx, args) => {
    const userId = await owner(ctx),
      meeting = await ownedMeeting(ctx, args.id, userId);
    const chat = await ctx.db
      .query("chats")
      .withIndex("by_chat_id", (q) => q.eq("id", meeting.chat_id))
      .unique();
    if (!chat)
      await ctx.db.insert("chats", {
        id: meeting.chat_id,
        user_id: userId,
        project_id: meeting.project_id,
        bot_meeting_id: meeting._id,
        title: meeting.title,
        purpose: "app",
        default_model_slug: "agent-long",
        update_time: Date.now(),
      });
    else if (
      chat.user_id !== userId ||
      chat.project_id !== meeting.project_id ||
      chat.bot_meeting_id !== meeting._id
    )
      throw new ConvexError("The meeting conversation is not available.");
    return meeting.chat_id;
  },
});

export const getForRuntime = query({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    id: v.id("bot_meetings"),
    chatId: v.string(),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const meeting = await ownedMeeting(ctx, args.id, args.userId);
    if (
      meeting.chat_id !== args.chatId ||
      meeting.project_id !== args.projectId
    )
      throw new ConvexError("The meeting conversation is not available.");
    const bots = await requireMeetingParticipants(
      ctx.db,
      args.userId,
      meeting.project_id,
      meeting.participant_bot_ids,
    );
    const skillsByProfile = Object.fromEntries(await Promise.all(bots.map(async (bot) => {
      const profile = parseProjectBotProfile(bot.profile_json);
      if (!profile) throw new ConvexError("A participant profile is invalid.");
      return [profile.id, await resolveProjectBotSkills(ctx.db, args.userId, profile.skillIds)] as const;
    })));
    return {
      skillsByProfile,
      profilesJson: bots.map((bot) => bot.profile_json),
      agenda: meeting.agenda,
    };
  },
});
