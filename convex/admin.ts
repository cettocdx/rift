import { mutation, query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { validateServiceKey } from "./lib/utils";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { getIncludedCreditsForTier } from "../lib/billing/included-credits";

// Admin grants use the same canonical allowance as paid provider grants.
/**
 * Emails allowed to view the admin dashboard. Add owners/operators here.
 */
const ADMIN_EMAILS = new Set<string>(["ahmetcet92@hotmail.com"]);
const ADMIN_STATS_WINDOW = 2_000;
const ADMIN_ACTIVITY_WINDOW = 300;
const ADMIN_TRANSCRIPT_WINDOW = 500;

export async function isAdminUser(ctx: QueryCtx): Promise<boolean> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return false;
  const me = await ctx.db.get(userId);
  const email = (me as { email?: string } | null)?.email;
  return !!email && ADMIN_EMAILS.has(email.toLowerCase());
}

/** Cheap gate for the admin shell — true only for admin emails. */
export const isAdmin = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => isAdminUser(ctx),
});

/**
 * Admin dashboard stats. Returns null for non-admins (the UI treats null as
 * "not authorized"). Every table read is bounded so the dashboard degrades to
 * an explicit lower-bound window instead of crossing Convex read/result caps.
 */
export const getAdminStats = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      totalUsers: v.number(),
      totalRevenueDollars: v.number(),
      activeLast7Days: v.number(),
      totalChats: v.number(),
      limited: v.object({
        users: v.boolean(),
        revenue: v.boolean(),
        balances: v.boolean(),
        chats: v.boolean(),
        subscriptions: v.boolean(),
      }),
      users: v.array(
        v.object({
          id: v.string(),
          email: v.string(),
          name: v.union(v.string(), v.null()),
          joinedAt: v.number(),
          balancePoints: v.number(),
          revenueDollars: v.number(),
          lastActiveAt: v.union(v.number(), v.null()),
          tier: v.union(v.string(), v.null()),
          subStatus: v.union(v.string(), v.null()),
          chatCount: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx) => {
    if (!(await isAdminUser(ctx))) {
      return null;
    }

    const [userWindow, revenueWindow, balanceWindow, chatWindow, subWindow] =
      await Promise.all([
        ctx.db
          .query("users")
          .order("desc")
          .take(ADMIN_STATS_WINDOW + 1),
        ctx.db
          .query("revenue_events")
          .order("desc")
          .take(ADMIN_STATS_WINDOW + 1),
        ctx.db
          .query("extra_usage")
          .order("desc")
          .take(ADMIN_STATS_WINDOW + 1),
        ctx.db
          .query("chats")
          .order("desc")
          .take(ADMIN_STATS_WINDOW + 1),
        ctx.db
          .query("subscriptions")
          .order("desc")
          .take(ADMIN_STATS_WINDOW + 1),
      ]);
    const limited = {
      users: userWindow.length > ADMIN_STATS_WINDOW,
      revenue: revenueWindow.length > ADMIN_STATS_WINDOW,
      balances: balanceWindow.length > ADMIN_STATS_WINDOW,
      chats: chatWindow.length > ADMIN_STATS_WINDOW,
      subscriptions: subWindow.length > ADMIN_STATS_WINDOW,
    };
    const users = userWindow.slice(0, ADMIN_STATS_WINDOW);
    const revenueEvents = revenueWindow.slice(0, ADMIN_STATS_WINDOW);
    const balances = balanceWindow.slice(0, ADMIN_STATS_WINDOW);
    const chats = chatWindow.slice(0, ADMIN_STATS_WINDOW);
    const subs = subWindow.slice(0, ADMIN_STATS_WINDOW);

    // Most recent subscription row per user drives tier/status.
    const subByUser = new Map<string, { tier: string; status: string }>();
    for (const s of subs) {
      if (!subByUser.has(s.user_id)) {
        subByUser.set(s.user_id, { tier: s.tier, status: s.status });
      }
    }
    const chatCountByUser = new Map<string, number>();
    for (const c of chats) {
      chatCountByUser.set(c.user_id, (chatCountByUser.get(c.user_id) ?? 0) + 1);
    }

    const revenueByUser = new Map<string, number>();
    let totalRevenueDollars = 0;
    for (const e of revenueEvents) {
      totalRevenueDollars += e.gross_revenue_dollars;
      if (e.user_id) {
        revenueByUser.set(
          e.user_id,
          (revenueByUser.get(e.user_id) ?? 0) + e.gross_revenue_dollars,
        );
      }
    }

    const balanceByUser = new Map<string, number>();
    for (const b of balances) {
      balanceByUser.set(b.user_id, b.balance_points);
    }

    const lastActiveByUser = new Map<string, number>();
    for (const c of chats) {
      const prev = lastActiveByUser.get(c.user_id);
      if (prev === undefined || c._creationTime > prev) {
        lastActiveByUser.set(c.user_id, c._creationTime);
      }
    }

    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    let activeLast7Days = 0;
    for (const t of lastActiveByUser.values()) {
      if (now - t < sevenDays) activeLast7Days++;
    }

    const userRows = users
      .map((u) => {
        const id = u._id as string;
        const sub = subByUser.get(id);
        return {
          id,
          email: (u as { email?: string }).email ?? "—",
          name: (u as { name?: string }).name ?? null,
          joinedAt: u._creationTime,
          balancePoints: balanceByUser.get(id) ?? 0,
          revenueDollars: revenueByUser.get(id) ?? 0,
          lastActiveAt: lastActiveByUser.get(id) ?? null,
          tier: sub?.tier ?? null,
          subStatus: sub?.status ?? null,
          chatCount: chatCountByUser.get(id) ?? 0,
        };
      })
      .sort((a, b) => b.joinedAt - a.joinedAt);

    return {
      totalUsers: users.length,
      totalRevenueDollars,
      activeLast7Days,
      totalChats: chats.length,
      limited,
      users: userRows,
    };
  },
});

/** Extract the human-readable text from a stored message (content or parts). */
function extractText(m: { content?: string; parts?: unknown[] }): string {
  if (typeof m.content === "string" && m.content.trim().length > 0) {
    return m.content;
  }
  if (Array.isArray(m.parts)) {
    for (const p of m.parts) {
      if (
        p &&
        typeof p === "object" &&
        (p as { type?: unknown }).type === "text" &&
        typeof (p as { text?: unknown }).text === "string"
      ) {
        return (p as { text: string }).text;
      }
    }
  }
  return "";
}

/**
 * Admin activity feed: the latest bounded chat window with owner metadata.
 * Drill into a single conversation with getAdminChatMessages.
 */
export const getAdminActivity = query({
  args: {},
  returns: v.union(
    v.null(),
    v.array(
      v.object({
        chatId: v.string(),
        title: v.string(),
        userId: v.string(),
        email: v.string(),
        name: v.union(v.string(), v.null()),
        mode: v.union(v.string(), v.null()),
        createdAt: v.number(),
        updatedAt: v.number(),
      }),
    ),
  ),
  handler: async (ctx) => {
    if (!(await isAdminUser(ctx))) {
      return null;
    }
    const chats = await ctx.db
      .query("chats")
      .order("desc")
      .take(ADMIN_ACTIVITY_WINDOW);
    const users = await Promise.all(
      Array.from(new Set(chats.map((chat) => chat.user_id))).map(
        async (userId) =>
          [userId, await ctx.db.get(userId as Id<"users">)] as const,
      ),
    );
    const userById = new Map<string, { email: string; name: string | null }>();
    for (const [userId, u] of users) {
      if (!u) continue;
      userById.set(userId, {
        email: (u as { email?: string }).email ?? "—",
        name: (u as { name?: string }).name ?? null,
      });
    }
    return chats
      .map((c) => {
        const u = userById.get(c.user_id);
        return {
          chatId: c.id,
          title: c.title && c.title.length > 0 ? c.title : "(untitled)",
          userId: c.user_id,
          email: u?.email ?? "—",
          name: u?.name ?? null,
          mode: c.default_model_slug ?? c.selected_model ?? null,
          createdAt: c._creationTime,
          updatedAt: c.update_time,
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

/**
 * Latest bounded transcript window for one chat (admin only), returned in
 * chronological order through the by_chat_id index.
 */
export const getAdminChatMessages = query({
  args: { chatId: v.string() },
  returns: v.union(
    v.null(),
    v.array(
      v.object({
        id: v.string(),
        role: v.string(),
        text: v.string(),
        mode: v.union(v.string(), v.null()),
        createdAt: v.number(),
      }),
    ),
  ),
  handler: async (ctx, { chatId }) => {
    if (!(await isAdminUser(ctx))) {
      return null;
    }
    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_chat_id", (q) => q.eq("chat_id", chatId))
      .order("desc")
      .take(ADMIN_TRANSCRIPT_WINDOW);
    return msgs
      .sort((a, b) => a._creationTime - b._creationTime)
      .map((m) => ({
        id: m.id,
        role: m.role,
        text: extractText(m).slice(0, 6000),
        mode: m.mode ?? null,
        createdAt: m._creationTime,
      }));
  },
});

/**
 * Admin: grant token credits (points) directly to a user's prepaid balance,
 * looked up by email. Service-key authed (run from a trusted backend or
 * `npx convex run`). This is a manual comp — it does NOT record a revenue event.
 */
export const grantTokensByEmail = mutation({
  args: {
    serviceKey: v.string(),
    email: v.string(),
    points: v.number(),
  },
  returns: v.object({
    ok: v.boolean(),
    userId: v.optional(v.string()),
    email: v.optional(v.string()),
    newBalancePoints: v.optional(v.number()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const target = args.email.trim().toLowerCase();
    const points = Math.max(0, Math.floor(args.points));
    if (points <= 0) return { ok: false, error: "points must be > 0" };

    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", target))
      .unique();
    if (!user) return { ok: false, error: "No user with that email" };
    const userId = user._id as string;

    const settings = await ctx.db
      .query("extra_usage")
      .withIndex("by_user_id", (q) => q.eq("user_id", userId))
      .first();

    const now = Date.now();
    let newBalancePoints: number;
    if (settings) {
      const available = (settings.balance_points ?? 0) + points;
      const debt = Math.max(0, settings.credit_debt_points ?? 0);
      const settled = Math.min(available, debt);
      newBalancePoints = available - settled;
      await ctx.db.patch(settings._id, {
        balance_points: newBalancePoints,
        credit_debt_points: debt - settled,
        updated_at: now,
      });
    } else {
      newBalancePoints = points;
      await ctx.db.insert("extra_usage", {
        user_id: userId,
        balance_points: newBalancePoints,
        updated_at: now,
      });
    }

    return {
      ok: true,
      userId,
      email: (user as { email?: string }).email,
      newBalancePoints,
    };
  },
});

/**
 * Admin-grant a Pro/Max subscription to a user by email — for owner/operator
 * test accounts, not a real payment. Provisions the exact same state a real
 * LemonSqueezy webhook would (subscription row + monthly allowance points),
 * so the account exercises premium features identically to a paying user.
 * The synthetic `ls_subscription_id` (prefixed `admin_grant_`) makes these
 * rows easy to distinguish from real LemonSqueezy subscriptions later.
 */
export const grantSubscriptionByEmail = mutation({
  args: {
    serviceKey: v.string(),
    email: v.string(),
    tier: v.union(v.literal("pro"), v.literal("ultra")),
  },
  returns: v.object({
    ok: v.boolean(),
    userId: v.optional(v.string()),
    email: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const target = args.email.trim().toLowerCase();

    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", target))
      .unique();
    if (!user) return { ok: false, error: "No user with that email" };
    const userId = user._id as string;

    // Delegate to the same mutations the real LemonSqueezy webhook calls, so
    // an admin grant provisions identically to a real payment (subscription
    // row + monthly allowance) instead of duplicating that logic here.
    await ctx.runMutation(api.subscriptions.upsertSubscriptionFromWebhook, {
      serviceKey: args.serviceKey,
      userId,
      lsSubscriptionId: `admin_grant_${userId}`,
      tier: args.tier,
      status: "active",
    });
    await ctx.runMutation(api.extraUsage.grantMonthlyAllowance, {
      serviceKey: args.serviceKey,
      userId,
      allowancePoints: getIncludedCreditsForTier(args.tier),
    });

    return { ok: true, userId, email: (user as { email?: string }).email };
  },
});

/**
 * Admin UI action: grant token credits to a user by id. Admin-gated (no service
 * key needed — the caller is a verified admin session). Manual comp; no revenue
 * event. Mirrors grantTokensByEmail's balance logic.
 */
export const adminGrantTokens = mutation({
  args: { userId: v.string(), points: v.number() },
  returns: v.object({
    ok: v.boolean(),
    newBalancePoints: v.optional(v.number()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    if (!(await isAdminUser(ctx)))
      return { ok: false, error: "Not authorized" };
    const points = Math.max(0, Math.floor(args.points));
    if (points <= 0)
      return { ok: false, error: "Points must be greater than 0" };
    const settings = await ctx.db
      .query("extra_usage")
      .withIndex("by_user_id", (q) => q.eq("user_id", args.userId))
      .first();
    const now = Date.now();
    let newBalancePoints: number;
    if (settings) {
      const available = (settings.balance_points ?? 0) + points;
      const debt = Math.max(0, settings.credit_debt_points ?? 0);
      const settled = Math.min(available, debt);
      newBalancePoints = available - settled;
      await ctx.db.patch(settings._id, {
        balance_points: newBalancePoints,
        credit_debt_points: debt - settled,
        updated_at: now,
      });
    } else {
      newBalancePoints = points;
      await ctx.db.insert("extra_usage", {
        user_id: args.userId,
        balance_points: newBalancePoints,
        updated_at: now,
      });
    }
    return { ok: true, newBalancePoints };
  },
});

/**
 * Admin UI action: provision a Pro/Max subscription for a user by id. Admin-
 * gated; delegates to the same mutations the LemonSqueezy webhook uses (via the
 * deployment's own service key) so the account matches a real paid one.
 */
export const adminGrantSubscription = mutation({
  args: {
    userId: v.string(),
    tier: v.union(v.literal("pro"), v.literal("ultra")),
  },
  returns: v.object({ ok: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    if (!(await isAdminUser(ctx)))
      return { ok: false, error: "Not authorized" };
    const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
    if (!serviceKey) return { ok: false, error: "Service key not configured" };
    await ctx.runMutation(api.subscriptions.upsertSubscriptionFromWebhook, {
      serviceKey,
      userId: args.userId,
      lsSubscriptionId: `admin_grant_${args.userId}`,
      tier: args.tier,
      status: "active",
    });
    await ctx.runMutation(api.extraUsage.grantMonthlyAllowance, {
      serviceKey,
      userId: args.userId,
      allowancePoints: getIncludedCreditsForTier(args.tier),
    });
    return { ok: true };
  },
});
