import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { SKILL_CATALOG } from "../lib/ai/skills/catalog";
import { validateServiceKey } from "./lib/utils";

/**
 * Skills registry — loadable instruction packs. Enabled skills are injected
 * into the agent as a <system-reminder> for matching-scope chats
 * (see lib/ai/skills/inject-skills.ts).
 */

const MAX_SKILLS_PER_USER = 60;
const MAX_INSTRUCTIONS_CHARS = 8000;
// v2 crew configs include bounded custom-agent and team contracts. Keep this
// endpoint-specific ceiling aligned with pet-roster's tested 24k renderer;
// normal user-authored skills retain the tighter 8k limit above.
const MAX_AGENT_ROSTER_INSTRUCTIONS_CHARS = 24_000;
const MANAGED_AGENT_ROSTER_SKILL_ID = "rift-agent-roster";
const MANAGED_AGENT_ROSTER_SKILL_NAME = "RIFT Agent Crew";

const scopeValidator = v.union(
  v.literal("all"),
  v.literal("security"),
  v.literal("app"),
  v.literal("image"),
);

function authedUserId(subject: string): string {
  return subject.split("|")[0];
}

/** List the calling user's skills for the settings/marketplace UI. */
export const listForUser = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("skills"),
      name: v.string(),
      description: v.string(),
      instructions: v.string(),
      scope: scopeValidator,
      catalog_id: v.optional(v.string()),
      enabled: v.boolean(),
      created_at: v.number(),
      updated_at: v.number(),
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
      .query("skills")
      .withIndex("by_user", (q) => q.eq("user_id", userId))
      .order("desc")
      .collect();

    return rows.map((r) => ({
      _id: r._id,
      name: r.name,
      description: r.description,
      instructions: r.instructions,
      scope: r.scope,
      catalog_id: r.catalog_id,
      enabled: r.enabled,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
  },
});

/** Install a skill from the curated catalog (copies its instructions in). */
export const installFromCatalog = mutation({
  args: {
    catalogId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    id: v.optional(v.id("skills")),
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
    const catalogEntry = SKILL_CATALOG.find(
      (entry) => entry.id === args.catalogId,
    );
    if (!catalogEntry) {
      return { success: false, error: "Unknown built-in skill" };
    }

    // Idempotent: if this catalog skill is already installed, just return it.
    const dupe = await ctx.db
      .query("skills")
      .withIndex("by_user", (q) => q.eq("user_id", userId))
      .collect();
    const already = dupe.find((r) => r.catalog_id === args.catalogId);
    if (already) return { success: true, id: already._id };

    if (dupe.length >= MAX_SKILLS_PER_USER) {
      return { success: false, error: "Skill limit reached" };
    }

    const now = Date.now();
    const id = await ctx.db.insert("skills", {
      user_id: userId,
      name: catalogEntry.name,
      description: catalogEntry.description,
      instructions: catalogEntry.instructions.slice(0, MAX_INSTRUCTIONS_CHARS),
      scope: catalogEntry.scope,
      catalog_id: catalogEntry.id,
      enabled: true,
      created_at: now,
      updated_at: now,
    });
    return { success: true, id };
  },
});

/**
 * Backend-only Build preflight. The authoritative chat runtime installs or
 * refreshes the small set of skills selected by find_skills, then immediately
 * loads the same instruction packs from the tool result for the current run.
 */
export const installCatalogForBackend = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    catalogIds: v.array(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    installed: v.array(v.string()),
    refreshed: v.array(v.string()),
    failed: v.array(v.object({ catalogId: v.string(), reason: v.string() })),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);

    const userId = args.userId.trim();
    if (!userId) {
      return {
        success: false,
        installed: [],
        refreshed: [],
        failed: [{ catalogId: "", reason: "Missing user id" }],
      };
    }

    const requestedIds = Array.from(new Set(args.catalogIds)).slice(0, 8);
    const rows = await ctx.db
      .query("skills")
      .withIndex("by_user", (q) => q.eq("user_id", userId))
      .collect();
    const byCatalogId = new Map(
      rows.flatMap((row) =>
        row.catalog_id ? [[row.catalog_id, row] as const] : [],
      ),
    );
    const installed: string[] = [];
    const refreshed: string[] = [];
    const failed: Array<{ catalogId: string; reason: string }> = [];
    let rowCount = rows.length;

    for (const catalogId of requestedIds) {
      const entry = SKILL_CATALOG.find((skill) => skill.id === catalogId);
      if (!entry) {
        failed.push({ catalogId, reason: "Unknown catalog skill" });
        continue;
      }

      const existing = byCatalogId.get(catalogId);
      const now = Date.now();
      if (existing) {
        await ctx.db.patch(existing._id, {
          name: entry.name,
          description: entry.description,
          instructions: entry.instructions.slice(0, MAX_INSTRUCTIONS_CHARS),
          scope: entry.scope,
          enabled: true,
          updated_at: now,
        });
        refreshed.push(catalogId);
        continue;
      }

      if (rowCount >= MAX_SKILLS_PER_USER) {
        failed.push({ catalogId, reason: "Skill limit reached" });
        continue;
      }

      await ctx.db.insert("skills", {
        user_id: userId,
        name: entry.name,
        description: entry.description,
        instructions: entry.instructions.slice(0, MAX_INSTRUCTIONS_CHARS),
        scope: entry.scope,
        catalog_id: entry.id,
        enabled: true,
        created_at: now,
        updated_at: now,
      });
      rowCount += 1;
      installed.push(catalogId);
    }

    return {
      success: failed.length === 0,
      installed,
      refreshed,
      failed,
    };
  },
});

/** Create a user-authored custom skill. */
export const createCustom = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    instructions: v.string(),
    scope: scopeValidator,
  },
  returns: v.object({
    success: v.boolean(),
    id: v.optional(v.id("skills")),
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
    const instructions = args.instructions.trim();
    if (!name) return { success: false, error: "Name cannot be empty" };
    if (!instructions)
      return { success: false, error: "Instructions cannot be empty" };

    const existing = await ctx.db
      .query("skills")
      .withIndex("by_user", (q) => q.eq("user_id", userId))
      .collect();
    if (existing.length >= MAX_SKILLS_PER_USER) {
      return { success: false, error: "Skill limit reached" };
    }

    const now = Date.now();
    const id = await ctx.db.insert("skills", {
      user_id: userId,
      name,
      description: args.description.trim() || name,
      instructions: instructions.slice(0, MAX_INSTRUCTIONS_CHARS),
      scope: args.scope,
      catalog_id: undefined,
      enabled: true,
      created_at: now,
      updated_at: now,
    });
    return { success: true, id };
  },
});

export const setSkillEnabled = mutation({
  args: { id: v.id("skills"), enabled: v.boolean() },
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
    if (!row) return { success: false, error: "Skill not found" };
    if (row.user_id !== userId) {
      throw new ConvexError({
        code: "ACCESS_DENIED",
        message: "Access denied: You don't own this skill",
      });
    }
    await ctx.db.patch(args.id, {
      enabled: args.enabled,
      updated_at: Date.now(),
    });
    return { success: true };
  },
});

/**
 * Create or update the managed agent-roster instruction pack. The client owns
 * the typed roster editor, while the normal enabled-skills pipeline makes the
 * saved crew available to every runtime without a second storage system.
 */
export const syncAgentRoster = mutation({
  args: {
    description: v.string(),
    instructions: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    id: v.optional(v.id("skills")),
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

    const instructions = args.instructions.trim();
    if (
      !instructions.includes("<rift_agent_roster_config>") ||
      !instructions.includes("<rift_agent_crew>")
    ) {
      return { success: false, error: "Invalid agent roster payload" };
    }
    if (instructions.length > MAX_AGENT_ROSTER_INSTRUCTIONS_CHARS) {
      return { success: false, error: "Agent roster is too large" };
    }

    const userId = authedUserId(identity.subject);
    const existing = await ctx.db
      .query("skills")
      .withIndex("by_user", (q) => q.eq("user_id", userId))
      .collect();
    const managed = existing.find(
      (skill) => skill.catalog_id === MANAGED_AGENT_ROSTER_SKILL_ID,
    );
    const now = Date.now();

    if (managed) {
      await ctx.db.patch(managed._id, {
        name: MANAGED_AGENT_ROSTER_SKILL_NAME,
        description: args.description.trim(),
        instructions,
        scope: "app",
        enabled: true,
        updated_at: now,
      });
      return { success: true, id: managed._id };
    }

    if (existing.length >= MAX_SKILLS_PER_USER) {
      return { success: false, error: "Skill limit reached" };
    }

    const id = await ctx.db.insert("skills", {
      user_id: userId,
      name: MANAGED_AGENT_ROSTER_SKILL_NAME,
      description: args.description.trim(),
      instructions,
      scope: "app",
      catalog_id: MANAGED_AGENT_ROSTER_SKILL_ID,
      enabled: true,
      created_at: now,
      updated_at: now,
    });
    return { success: true, id };
  },
});

export const removeSkill = mutation({
  args: { id: v.id("skills") },
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
        message: "Access denied: You don't own this skill",
      });
    }
    await ctx.db.delete(args.id);
    return { success: true };
  },
});

/**
 * Backend-only: the user's enabled skills, for the agent runtime to inject.
 * Guarded by the service role key.
 */
export const listEnabledForBackend = query({
  args: { serviceKey: v.string(), userId: v.string() },
  returns: v.array(
    v.object({
      name: v.string(),
      instructions: v.string(),
      scope: scopeValidator,
      catalog_id: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const rows = await ctx.db
      .query("skills")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .collect();
    return rows
      .filter((r) => r.enabled)
      .map((r) => ({
        name: r.name,
        instructions: r.instructions,
        scope: r.scope,
        catalog_id: r.catalog_id,
      }));
  },
});
