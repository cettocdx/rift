import { query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Emails allowed to view the admin dashboard. Add owners/operators here.
 */
const ADMIN_EMAILS = new Set<string>(["ahmetcet92@hotmail.com"]);

export async function isAdminUser(ctx: QueryCtx): Promise<boolean> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return false;
  const me = await ctx.db.get(userId);
  const email = (me as { email?: string } | null)?.email;
  return !!email && ADMIN_EMAILS.has(email.toLowerCase());
}

/**
 * Upper bound on how many documents we pull from any single table. A Convex
 * query that reads too many documents (or too many bytes) throws and the whole
 * dashboard fails to load. Capping each read keeps the page resilient as the
 * tables grow; the headline numbers stay exact until a table exceeds the cap,
 * at which point they read as "at least this many" rather than crashing.
 */
const MAX_ROWS_PER_TABLE = 4000;
const MAX_CHAT_ROWS = 3000;

/**
 * Admin dashboard stats. Returns null for non-admins (the UI treats null as
 * "not authorized"). Reads are capped (see MAX_ROWS_PER_TABLE) so the query
 * can't exceed Convex's per-query limits; revisit with aggregates if the user
 * base grows beyond those caps.
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
      users: v.array(
        v.object({
          id: v.string(),
          email: v.string(),
          name: v.union(v.string(), v.null()),
          joinedAt: v.number(),
          balancePoints: v.number(),
          revenueDollars: v.number(),
          lastActiveAt: v.union(v.number(), v.null()),
        }),
      ),
    }),
  ),
  handler: async (ctx) => {
    if (!(await isAdminUser(ctx))) {
      return null;
    }

    const [users, revenueEvents, balances, chats] = await Promise.all([
      // Most recent users first — matches the table's sort and keeps the cap
      // meaningful (we show newest signups when truncated).
      ctx.db.query("users").order("desc").take(MAX_ROWS_PER_TABLE),
      ctx.db.query("revenue_events").take(MAX_ROWS_PER_TABLE),
      ctx.db.query("extra_usage").take(MAX_ROWS_PER_TABLE),
      // Newest chats first so "last active" stays accurate for active users.
      ctx.db.query("chats").order("desc").take(MAX_CHAT_ROWS),
    ]);

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
        return {
          id,
          email: (u as { email?: string }).email ?? "—",
          name: (u as { name?: string }).name ?? null,
          joinedAt: u._creationTime,
          balancePoints: balanceByUser.get(id) ?? 0,
          revenueDollars: revenueByUser.get(id) ?? 0,
          lastActiveAt: lastActiveByUser.get(id) ?? null,
        };
      })
      .sort((a, b) => b.joinedAt - a.joinedAt);

    return {
      totalUsers: users.length,
      totalRevenueDollars,
      activeLast7Days,
      totalChats: chats.length,
      users: userRows,
    };
  },
});
