import { githubRepositoryValidator } from "./lib/githubRepository";
import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getOwnedProject } from "./lib/projectOwnership";
import { validateServiceKey } from "./lib/utils";

/**
 * User projects — new workspaces are Build or Image. The Security literal is
 * retained in the read validator only so legacy rows can route to /hack.
 */

const MAX_ACTIVE_PROJECTS_PER_USER = 100;
const MAX_TOTAL_PROJECTS_PER_USER = 250;

const typeValidator = v.union(
  v.literal("security"),
  v.literal("app"),
  v.literal("image"),
);

const creatableTypeValidator = v.union(v.literal("app"), v.literal("image"));
const PROJECT_AGENT_MENTION = /^@(agent|team):[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizedAgentMention(value: string | undefined) {
  const mention = value?.trim();
  if (!mention) return undefined;
  return mention.length <= 64 && PROJECT_AGENT_MENTION.test(mention)
    ? mention
    : null;
}

function authedUserId(subject: string): string {
  return subject.split("|")[0];
}

export const listForUser = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("projects"),
      name: v.string(),
      type: typeValidator,
      github_repository: v.optional(githubRepositoryValidator),
      agent_mention: v.optional(v.string()),
      created_at: v.number(),
      updated_at: v.number(),
      archived_at: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Unauthorized: User not authenticated",
      });
    }
    const userId = authedUserId(identity.subject);
    const rows = await ctx.db
      .query("projects")
      .withIndex("by_user_and_archived", (q) =>
        q.eq("user_id", userId).eq("archived_at", undefined),
      )
      .order("desc")
      .collect();
    return rows.map((r) => ({
      _id: r._id,
      name: r.name,
      type: r.type,
      ...(r.github_repository
        ? { github_repository: r.github_repository }
        : {}),
      ...(r.agent_mention ? { agent_mention: r.agent_mention } : {}),
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
  },
});

/**
 * Fetch one active project without revealing whether a foreign project ID
 * exists.
 */
export const getForUser = query({
  args: { id: v.id("projects") },
  returns: v.union(
    v.object({
      _id: v.id("projects"),
      name: v.string(),
      type: typeValidator,
      agent_mention: v.optional(v.string()),
      created_at: v.number(),
      updated_at: v.number(),
      archived_at: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Unauthorized: User not authenticated",
      });
    }

    const project = await getOwnedProject(
      ctx.db,
      args.id,
      authedUserId(identity.subject),
    );
    if (!project) return null;

    return {
      _id: project._id,
      name: project.name,
      type: project.type,
      ...(project.agent_mention
        ? { agent_mention: project.agent_mention }
        : {}),
      created_at: project.created_at,
      updated_at: project.updated_at,
    };
  },
});

/**
 * Trusted-backend lookup used to authorize a project before any sandbox or
 * tool can be initialized. Missing, archived, and foreign IDs intentionally
 * collapse to null so callers cannot use this endpoint as an ownership oracle.
 */
export const getActiveForBackend = query({
  args: {
    serviceKey: v.string(),
    id: v.id("projects"),
    userId: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id("projects"),
      type: typeValidator,
      github_repository: v.optional(githubRepositoryValidator),
      agent_mention: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const project = await getOwnedProject(ctx.db, args.id, args.userId);
    return project
      ? {
          _id: project._id,
          type: project.type,
          ...(project.github_repository
            ? { github_repository: project.github_repository }
            : {}),
          ...(project.agent_mention
            ? { agent_mention: project.agent_mention }
            : {}),
        }
      : null;
  },
});

export const createProject = mutation({
  args: {
    name: v.string(),
    type: creatableTypeValidator,
    agentMention: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    id: v.optional(v.id("projects")),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Unauthorized: User not authenticated",
      });
    }
    const userId = authedUserId(identity.subject);
    const name = args.name.trim();
    if (!name) return { success: false, error: "Name cannot be empty" };
    const agentMention = normalizedAgentMention(args.agentMention);
    if (agentMention === null) {
      return { success: false, error: "Invalid agent workflow" };
    }
    if (args.type !== "app" && agentMention) {
      return {
        success: false,
        error: "Agent workflows can only be assigned to Build projects",
      };
    }

    const activeProjects = await ctx.db
      .query("projects")
      .withIndex("by_user_and_archived", (q) =>
        q.eq("user_id", userId).eq("archived_at", undefined),
      )
      .take(MAX_ACTIVE_PROJECTS_PER_USER);
    if (activeProjects.length >= MAX_ACTIVE_PROJECTS_PER_USER) {
      return { success: false, error: "Project limit reached" };
    }

    // Soft-deleted projects may still be referenced by historical chats, so
    // they cannot be purged indiscriminately. Cap the complete ownership set
    // with a bounded indexed read instead. This preserves those bindings and
    // idempotent chat retries while preventing archive churn from growing the
    // table without limit.
    const allProjects = await ctx.db
      .query("projects")
      .withIndex("by_user", (q) => q.eq("user_id", userId))
      .take(MAX_TOTAL_PROJECTS_PER_USER);
    if (allProjects.length >= MAX_TOTAL_PROJECTS_PER_USER) {
      return { success: false, error: "Project history limit reached" };
    }

    const now = Date.now();
    const id = await ctx.db.insert("projects", {
      user_id: userId,
      name,
      type: args.type,
      ...(agentMention ? { agent_mention: agentMention } : {}),
      created_at: now,
      updated_at: now,
    });
    return { success: true, id };
  },
});

export const renameProject = mutation({
  args: { id: v.id("projects"), name: v.string() },
  returns: v.object({ success: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Unauthorized: User not authenticated",
      });
    }
    const userId = authedUserId(identity.subject);
    const row = await ctx.db.get(args.id);
    if (!row) return { success: false, error: "Project not found" };
    if (row.user_id !== userId) {
      throw new ConvexError({
        code: "ACCESS_DENIED",
        message: "Access denied: You don't own this project",
      });
    }
    if (row.archived_at !== undefined) {
      return { success: false, error: "Project not found" };
    }
    const name = args.name.trim();
    if (!name) return { success: false, error: "Name cannot be empty" };
    await ctx.db.patch(args.id, { name, updated_at: Date.now() });
    return { success: true };
  },
});

export const removeProject = mutation({
  args: { id: v.id("projects") },
  returns: v.object({ success: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Unauthorized: User not authenticated",
      });
    }
    const userId = authedUserId(identity.subject);
    const row = await ctx.db.get(args.id);
    if (!row) return { success: true };
    if (row.user_id !== userId) {
      throw new ConvexError({
        code: "ACCESS_DENIED",
        message: "Access denied: You don't own this project",
      });
    }
    if (row.archived_at !== undefined) return { success: true };

    const boundChat = await ctx.db
      .query("chats")
      .withIndex("by_user_and_project_and_updated", (q) =>
        q.eq("user_id", userId).eq("project_id", args.id),
      )
      .first();

    if (!boundChat) {
      // No historical resource points at this project, so hard deletion is
      // safe and avoids accumulating needless archive rows. The indexed read
      // and delete share the mutation transaction with concurrent chat saves.
      await ctx.db.delete(args.id);
      return { success: true };
    }

    const now = Date.now();
    await ctx.db.patch(args.id, {
      archived_at: now,
      updated_at: now,
    });
    return { success: true };
  },
});

/** The route verifies access with the owner's GitHub token before this call.
 * A single Convex transaction makes repeated/concurrent opens idempotent.
 */
export const openGithubRepositoryForBackend = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    repository: githubRepositoryValidator,
  },
  returns: v.union(
    v.object({
      id: v.id("projects"),
      name: v.string(),
      type: v.literal("app"),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const active = await ctx.db
      .query("projects")
      .withIndex("by_user_and_archived", (q) =>
        q.eq("user_id", args.userId).eq("archived_at", undefined),
      )
      .take(MAX_ACTIVE_PROJECTS_PER_USER);
    const existing = active.find(
      (project) =>
        project.type === "app" &&
        project.github_repository?.id === args.repository.id,
    );
    if (existing) {
      await ctx.db.patch(existing._id, {
        github_repository: args.repository,
        updated_at: Date.now(),
      });
      return { id: existing._id, name: existing.name, type: "app" as const };
    }
    if (active.length >= MAX_ACTIVE_PROJECTS_PER_USER) return null;
    const all = await ctx.db
      .query("projects")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .take(MAX_TOTAL_PROJECTS_PER_USER);
    if (all.length >= MAX_TOTAL_PROJECTS_PER_USER) return null;
    const now = Date.now();
    const id = await ctx.db.insert("projects", {
      user_id: args.userId,
      name: args.repository.fullName,
      type: "app",
      github_repository: args.repository,
      created_at: now,
      updated_at: now,
    });
    return { id, name: args.repository.fullName, type: "app" as const };
  },
});
