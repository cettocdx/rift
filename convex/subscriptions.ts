import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { validateServiceKey } from "./lib/utils";
import type { QueryCtx } from "./_generated/server";

// LemonSqueezy subscription statuses that grant entitlements. `cancelled` keeps
// access until the paid period ends (LemonSqueezy flips it to `expired` at the
// period end, which is when we actually revoke). `paused`/`unpaid`/`expired`
// do not grant access.
const ENTITLED_STATUSES = new Set([
  "active",
  "on_trial",
  "past_due",
  "cancelled",
]);

// RIFT tier → entitlement slug consumed by resolveSubscriptionTier
// (lib/auth/entitlements.ts). "ultra" is the RIFT Max plan.
const TIER_ENTITLEMENT_SLUG: Record<string, string> = {
  pro: "pro-monthly-plan",
  ultra: "ultra-monthly-plan",
};

// Prefer the strongest concurrently-entitled plan before recency. This closes
// the upgrade overlap where a newly-updated Pro row could otherwise mask an
// active Max row and temporarily revoke Max-only capabilities.
const ENTITLED_TIER_RANK: Readonly<Record<string, number>> = {
  ultra: 4,
  team: 3,
  "pro-plus": 2,
  pro: 1,
};

/**
 * The user's current entitlement-granting subscription row, if any. Exported
 * so other modules (e.g. convex/apiKeys.ts) can gate premium-only features on
 * the same definitive "is this a paying user" check.
 */
export async function activeSubscriptionForUser(ctx: QueryCtx, userId: string) {
  const subs = await ctx.db
    .query("subscriptions")
    .withIndex("by_user_id", (q) => q.eq("user_id", userId))
    .collect();
  const entitled = subs
    .filter((s) => ENTITLED_STATUSES.has(s.status))
    .sort(
      (a, b) =>
        (ENTITLED_TIER_RANK[b.tier] ?? 0) - (ENTITLED_TIER_RANK[a.tier] ?? 0) ||
        b.updated_at - a.updated_at,
    );
  return entitled[0] ?? null;
}

/**
 * Entitlement slugs for the signed-in user — consumed by useAuth →
 * resolveSubscriptionTier. Empty array = free tier.
 */
export const getMyEntitlements = query({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const userId = identity.subject.split("|")[0];
    const sub = await activeSubscriptionForUser(ctx, userId);
    if (!sub) return [];
    const slug = TIER_ENTITLEMENT_SLUG[sub.tier];
    return slug ? [slug] : [];
  },
});

/** Background execution rechecks live access without trusting its payload tier. */
export const getEntitlementsForBackend = query({
  args: { serviceKey: v.string(), userId: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const sub = await activeSubscriptionForUser(ctx, args.userId);
    const slug = sub ? TIER_ENTITLEMENT_SLUG[sub.tier] : undefined;
    return slug ? [slug] : [];
  },
});

/** Current subscription details for the signed-in user (for billing UI). */
export const getActiveSubscription = query({
  args: {},
  returns: v.union(
    v.object({
      tier: v.string(),
      status: v.string(),
      renewsAt: v.union(v.string(), v.null()),
      endsAt: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const userId = identity.subject.split("|")[0];
    const sub = await activeSubscriptionForUser(ctx, userId);
    if (!sub) return null;
    return {
      tier: sub.tier,
      status: sub.status,
      renewsAt: sub.renews_at ?? null,
      endsAt: sub.ends_at ?? null,
    };
  },
});

/**
 * Look up the user + tier for a LemonSqueezy subscription id. The webhook uses
 * this as a fallback when a later event (renewal, status change) does not carry
 * the original checkout custom_data. Service-key authed.
 */
export const lookupByLsId = query({
  args: { serviceKey: v.string(), lsSubscriptionId: v.string() },
  returns: v.union(
    v.object({ userId: v.string(), tier: v.string() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_ls_subscription_id", (q) =>
        q.eq("ls_subscription_id", args.lsSubscriptionId),
      )
      .first();
    return sub ? { userId: sub.user_id, tier: sub.tier } : null;
  },
});

/**
 * Resolve a RIFT user id from an email address (case-insensitive). The
 * LemonSqueezy webhook uses this as a last-resort fallback when a subscription
 * event carries neither checkout custom_data.user_id nor a matching stored row
 * — the subscription payload's `user_email` still lets us credit the right
 * account instead of silently dropping a paid signup. Service-key authed. Full
 * scan, matching the admin module at current scale.
 */
export const findUserIdByEmail = query({
  args: { serviceKey: v.string(), email: v.string() },
  returns: v.union(v.object({ userId: v.string() }), v.null()),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const target = args.email.trim().toLowerCase();
    if (!target) return null;
    const users = await ctx.db.query("users").collect();
    const user = users.find(
      (u) => ((u as { email?: string }).email ?? "").toLowerCase() === target,
    );
    return user ? { userId: user._id as string } : null;
  },
});

/**
 * Upsert a subscription from the LemonSqueezy webhook (keyed by LemonSqueezy
 * subscription id). Service-key authed. The webhook also grants/zeroes the
 * monthly points allowance separately (see extraUsage.grantMonthlyAllowance).
 */
export const upsertSubscriptionFromWebhook = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    lsSubscriptionId: v.string(),
    lsCustomerId: v.optional(v.string()),
    lsVariantId: v.optional(v.string()),
    lsOrderId: v.optional(v.string()),
    tier: v.string(),
    status: v.string(),
    renewsAt: v.optional(v.string()),
    endsAt: v.optional(v.string()),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const now = Date.now();
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_ls_subscription_id", (q) =>
        q.eq("ls_subscription_id", args.lsSubscriptionId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        user_id: args.userId,
        ls_customer_id: args.lsCustomerId ?? existing.ls_customer_id,
        ls_variant_id: args.lsVariantId ?? existing.ls_variant_id,
        ls_order_id: args.lsOrderId ?? existing.ls_order_id,
        tier: args.tier,
        status: args.status,
        renews_at: args.renewsAt,
        ends_at: args.endsAt,
        updated_at: now,
      });
    } else {
      await ctx.db.insert("subscriptions", {
        user_id: args.userId,
        provider: "lemonsqueezy",
        ls_subscription_id: args.lsSubscriptionId,
        ls_customer_id: args.lsCustomerId,
        ls_variant_id: args.lsVariantId,
        ls_order_id: args.lsOrderId,
        tier: args.tier,
        status: args.status,
        renews_at: args.renewsAt,
        ends_at: args.endsAt,
        created_at: now,
        updated_at: now,
      });
    }
    return { ok: true };
  },
});
