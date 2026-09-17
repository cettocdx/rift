import { ConvexError } from "convex/values";
import type { GenericDatabaseReader } from "convex/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { requireOwnedProject } from "./projectOwnership";
import { parseProjectBotProfile } from "../../lib/ai/agents/project-bot-templates";
import {
  canLeadProjectMeeting,
  MEETING_LEADER_ERROR,
} from "../../lib/ai/agents/meeting-leader";

export async function requireMeetingParticipants(
  db: GenericDatabaseReader<DataModel>,
  userId: string,
  projectId: Id<"projects">,
  ids: Id<"project_bots">[],
): Promise<Doc<"project_bots">[]> {
  const project = await requireOwnedProject(db, projectId, userId);
  if (
    project.type !== "app" ||
    ids.length < 2 ||
    ids.length > 6 ||
    new Set(ids).size !== ids.length
  )
    throw new ConvexError("Choose between two and six different project bots.");
  const bots = await Promise.all(ids.map((id) => db.get(id)));
  if (
    bots.some(
      (bot) =>
        !bot ||
        bot.user_id !== userId ||
        bot.project_id !== projectId ||
        bot.archived_at !== undefined ||
        !parseProjectBotProfile(bot.profile_json)?.enabled,
    )
  )
    throw new ConvexError(
      "A meeting participant is no longer available in this project.",
    );
  if (!canLeadProjectMeeting(parseProjectBotProfile(bots[0]!.profile_json)))
    throw new ConvexError(MEETING_LEADER_ERROR);
  return bots as Doc<"project_bots">[];
}

export type BotTaskBinding = Pick<
  Doc<"tasks">,
  "project_id" | "assignee_bot_id" | "bot_meeting_id"
>;

/** Revalidate at creation, dispatch and execution; a saved ID is not a capability. */
export async function requireBotTaskBinding(
  db: GenericDatabaseReader<DataModel>,
  userId: string,
  binding: BotTaskBinding,
) {
  if (
    !binding.project_id &&
    !binding.assignee_bot_id &&
    !binding.bot_meeting_id
  )
    return null;
  if (
    !binding.project_id ||
    (binding.assignee_bot_id && binding.bot_meeting_id)
  )
    throw new ConvexError(
      "Assign a task to one bot or meeting in its project.",
    );
  const project = await requireOwnedProject(db, binding.project_id, userId);
  if (project.type !== "app")
    throw new ConvexError("Bot tasks require a Build project.");
  let chatId: string | undefined;
  if (binding.assignee_bot_id) {
    const bot = await db.get(binding.assignee_bot_id);
    if (
      !bot ||
      bot.user_id !== userId ||
      bot.project_id !== binding.project_id ||
      bot.archived_at !== undefined ||
      !parseProjectBotProfile(bot.profile_json)?.enabled
    )
      throw new ConvexError("The assigned project bot is not available.");
    chatId = bot.chat_id;
  }
  if (binding.bot_meeting_id) {
    const meeting = await db.get(binding.bot_meeting_id);
    if (
      !meeting ||
      meeting.user_id !== userId ||
      meeting.project_id !== binding.project_id
    )
      throw new ConvexError("The assigned meeting is not available.");
    await requireMeetingParticipants(
      db,
      userId,
      binding.project_id,
      meeting.participant_bot_ids,
    );
    chatId = meeting.chat_id;
  }
  if (!chatId) return null;
  const chat = await db
    .query("chats")
    .withIndex("by_chat_id", (q) => q.eq("id", chatId))
    .unique();
  if (
    !chat ||
    chat.user_id !== userId ||
    chat.project_id !== binding.project_id ||
    chat.project_bot_id !== binding.assignee_bot_id ||
    chat.bot_meeting_id !== binding.bot_meeting_id
  )
    throw new ConvexError("The assigned conversation is not available.");
  return chat;
}
