import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { ConvexError } from "convex/values";
import { requireOwnedProject } from "./projectOwnership";

function resolveProjectBoundPurpose(
  projectType: string,
  requestedPurpose?: string,
): string {
  if (requestedPurpose !== undefined && requestedPurpose !== projectType) {
    throw new ConvexError({
      code: "PROJECT_PURPOSE_MISMATCH",
      message: "Chat purpose must match the bound project type",
    });
  }

  return projectType;
}

/** Shared transactional chat creation; callers establish service/claim authority. */
export async function saveOwnedChat(
  ctx: MutationCtx,
  args: {
    id: string;
    userId: string;
    title: string;
    purpose?: string;
    projectId?: Id<"projects">;
  },
) {
  // Read-before-insert makes retries idempotent and participates in the
  // same Convex transaction as the insert. Concurrent creates are retried
  // against this indexed read instead of producing duplicate logical IDs.
  const matchingChats = await ctx.db
    .query("chats")
    .withIndex("by_chat_id", (q) => q.eq("id", args.id))
    .take(2);

  if (matchingChats.length > 1) {
    throw new ConvexError({
      code: "CHAT_ID_CONFLICT",
      message: "Chat ID is already ambiguous",
    });
  }

  const existing = matchingChats[0];
  if (existing) {
    const sameUser = existing.user_id === args.userId;
    const sameProject = existing.project_id === args.projectId;
    if (!sameUser || !sameProject) {
      throw new ConvexError({
        code: "CHAT_ID_CONFLICT",
        message: "Chat ID is already bound to another owner or project",
      });
    }

    // Re-check the referenced project inside this transaction. Archived
    // projects are accepted only for a retry of an already-bound chat.
    if (args.projectId) {
      const project = await requireOwnedProject(
        ctx.db,
        args.projectId,
        args.userId,
        {
          includeArchived: true,
        },
      );
      resolveProjectBoundPurpose(project.type, args.purpose);
    }
    return existing._id;
  }

  let purposeToPersist = args.purpose;
  if (args.projectId) {
    const project = await requireOwnedProject(
      ctx.db,
      args.projectId,
      args.userId,
    );
    purposeToPersist = resolveProjectBoundPurpose(project.type, args.purpose);
  }

  const chatId = await ctx.db.insert("chats", {
    id: args.id,
    title: args.title,
    user_id: args.userId,
    update_time: Date.now(),
    ...(args.projectId ? { project_id: args.projectId } : {}),
    // Only store a non-default purpose to keep existing rows untouched.
    ...(purposeToPersist && purposeToPersist !== "security"
      ? { purpose: purposeToPersist }
      : {}),
  });

  return chatId;
}
