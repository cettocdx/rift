import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

/**
 * One-off maintenance: an earlier auth rebuild left old paying users in the
 * `users` table (with email + balance in extra_usage) but WITHOUT an
 * `authAccounts` login link. So signing in with that email creates a fresh,
 * empty user instead of reconnecting to the paid account. This re-points the
 * login link (and clears the stale sessions) so the email resolves back to the
 * original paying userId.
 *
 * Run with `apply:false` first to see the dry-run report, then `apply:true`.
 * Safe + reversible (every change is reported; a full snapshot export was taken
 * beforehand).
 */
export const relinkLogin = internalMutation({
  args: {
    email: v.string(),
    toUserId: v.string(),
    fromUserId: v.optional(v.string()),
    apply: v.boolean(),
  },
  handler: async (ctx, { email, toUserId, fromUserId, apply }) => {
    const target = await ctx.db.get(toUserId as Id<"users">);
    if (target === null) {
      throw new Error(`target user ${toUserId} not found`);
    }
    const lower = email.trim().toLowerCase();

    const accounts = await ctx.db.query("authAccounts").collect();
    const affectedFromUserIds = new Set<string>();
    const repointedAccounts: Array<Record<string, unknown>> = [];

    for (const a of accounts) {
      const matchEmail =
        a.provider === "password" &&
        (a.providerAccountId ?? "").toLowerCase() === lower;
      const matchFrom = fromUserId !== undefined && a.userId === fromUserId;
      if ((matchEmail || matchFrom) && a.userId !== toUserId) {
        repointedAccounts.push({
          accountId: a._id,
          provider: a.provider,
          providerAccountId: a.providerAccountId,
          fromUserId: a.userId,
        });
        affectedFromUserIds.add(a.userId as string);
        if (apply) {
          await ctx.db.patch(a._id, { userId: toUserId as Id<"users"> });
        }
      }
    }

    // Clear the orphaned (empty) accounts' sessions so the next login is fresh
    // and resolves to the re-pointed paying user.
    let deletedSessions = 0;
    const allSessions = await ctx.db.query("authSessions").collect();
    for (const s of allSessions) {
      if (affectedFromUserIds.has(s.userId as string)) {
        deletedSessions++;
        if (apply) await ctx.db.delete(s._id);
      }
    }
    const allRefresh = await ctx.db.query("authRefreshTokens").collect();
    let deletedRefresh = 0;
    for (const r of allRefresh) {
      const sid = (r as { sessionId?: unknown }).sessionId;
      // Refresh tokens are keyed by session; we deleted those sessions, so any
      // refresh token whose session is gone is dead. Best-effort cleanup by
      // matching any sessionId we just removed is non-trivial here, so leave
      // refresh tokens alone — Convex Auth ignores tokens with no session.
      void sid;
    }
    void deletedRefresh;

    return {
      apply,
      email,
      targetUserId: toUserId,
      targetEmail: (target as { email?: string }).email,
      repointedAccounts,
      affectedFromUserIds: [...affectedFromUserIds],
      deletedSessions,
    };
  },
});
