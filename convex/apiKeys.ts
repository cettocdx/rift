import { getAccountPricingMargin } from "../lib/billing/account-pricing";
import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { validateServiceKey } from "./lib/utils";
import { activeSubscriptionForUser } from "./subscriptions";

/**
 * Premium-only personal API keys. A paying user can generate a key here and
 * use it as `Authorization: Bearer <key>` against /api/chat to drive Build and
 * Studio from terminal scripts. Hack Workbench revalidates the live tier at
 * /api/hack-chat and accepts only Max (`ultra`) keys.
 *
 * Only a SHA-256 hash is ever stored. The plaintext key is returned once, at
 * creation, and is unrecoverable after that (the user must generate a new one
 * if they lose it) — the same model OpenAI/Anthropic/Stripe use for API keys.
 */

const MAX_KEYS_PER_USER = 10;
const KEY_PREFIX = "rift_live_";

function authedUserId(subject: string): string {
  return subject.split("|")[0];
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generatePlaintextKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${KEY_PREFIX}${hex}`;
}

/** List the signed-in user's own keys (never includes the hash or plaintext). */
export const list = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("api_keys"),
      name: v.string(),
      keyPrefix: v.string(),
      createdAt: v.number(),
      lastUsedAt: v.optional(v.number()),
      revoked: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const userId = authedUserId(identity.subject);
    const rows = await ctx.db
      .query("api_keys")
      .withIndex("by_user", (q) => q.eq("user_id", userId))
      .collect();
    return rows
      .sort((a, b) => b.created_at - a.created_at)
      .map((r) => ({
        id: r._id,
        name: r.name,
        keyPrefix: r.key_prefix,
        createdAt: r.created_at,
        lastUsedAt: r.last_used_at,
        revoked: !!r.revoked_at,
      }));
  },
});

/**
 * Create a new key. Paid-plan gated: requires an active Pro/Max subscription
 * (the same check that drives entitlements elsewhere; see
 * convex/subscriptions.ts). Returns the plaintext key ONCE.
 */
export const create = mutation({
  args: { name: v.string() },
  returns: v.object({
    id: v.string(),
    key: v.string(),
    keyPrefix: v.string(),
    name: v.string(),
    createdAt: v.number(),
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

    const activeSub = await activeSubscriptionForUser(ctx, userId);
    if (!activeSub) {
      throw new ConvexError({
        code: "PREMIUM_REQUIRED",
        message: "API keys require an active RIFT Pro or Max subscription.",
      });
    }

    const existing = await ctx.db
      .query("api_keys")
      .withIndex("by_user", (q) => q.eq("user_id", userId))
      .collect();
    const activeCount = existing.filter((r) => !r.revoked_at).length;
    if (activeCount >= MAX_KEYS_PER_USER) {
      throw new ConvexError({
        code: "LIMIT_REACHED",
        message: `You can have at most ${MAX_KEYS_PER_USER} active API keys. Revoke one first.`,
      });
    }

    const name = args.name.trim().slice(0, 60) || "Untitled key";
    const plaintextKey = generatePlaintextKey();
    const keyHash = await sha256Hex(plaintextKey);
    const keyPrefix = plaintextKey.slice(0, KEY_PREFIX.length + 4);
    const now = Date.now();

    const id = await ctx.db.insert("api_keys", {
      user_id: userId,
      name,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      created_at: now,
    });

    return { id, key: plaintextKey, keyPrefix, name, createdAt: now };
  },
});

/** Revoke a key. Ownership-checked; revoking is permanent (no "undo"). */
export const revoke = mutation({
  args: { id: v.id("api_keys") },
  returns: v.object({ success: v.boolean() }),
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
    if (!row || row.user_id !== userId) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "API key not found",
      });
    }
    if (!row.revoked_at) {
      await ctx.db.patch(args.id, { revoked_at: Date.now() });
    }
    return { success: true };
  },
});

/**
 * Backend-only: resolve a plaintext API key (as presented in an
 * `Authorization: Bearer` header) to a userId + current subscription tier.
 * Service-key guarded — called from lib/auth/api-key.ts on every API-key
 * authenticated request. Bumps last_used_at on success (best-effort visibility
 * for the user, not used for any security decision).
 */
export const resolveForBackend = mutation({
  args: { serviceKey: v.string(), key: v.string() },
  returns: v.union(
    v.object({
      userId: v.string(),
      pricingMargin: v.number(),
      tier: v.union(v.literal("pro"), v.literal("ultra")),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    if (!args.key.startsWith(KEY_PREFIX)) return null;

    const keyHash = await sha256Hex(args.key);
    const row = await ctx.db
      .query("api_keys")
      .withIndex("by_key_hash", (q) => q.eq("key_hash", keyHash))
      .first();
    if (!row || row.revoked_at) return null;

    // Re-verify paid status live. A key survives a lapsed subscription in
    // storage, but stops authenticating once the user is no longer paying.
    const activeSub = await activeSubscriptionForUser(ctx, row.user_id);
    const tier = activeSub?.tier;
    if (tier !== "pro" && tier !== "ultra") {
      return null;
    }
    // Safe: the check above confirmed tier is exactly one of these two
    // literals — TS can't narrow a plain `string` field this way on its own.
    const premiumTier = tier as "pro" | "ultra";

    await ctx.db.patch(row._id, { last_used_at: Date.now() });
    const ownerId = ctx.db.normalizeId("users", row.user_id);
    const owner = ownerId ? await ctx.db.get(ownerId) : null;
    return {
      userId: row.user_id,
      tier: premiumTier,
      pricingMargin: getAccountPricingMargin(owner),
    };
  },
});
