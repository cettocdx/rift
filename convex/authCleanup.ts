import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

// The Password provider's id (convex/auth.ts configures it without an explicit
// `id`, so @convex-dev/auth defaults it to "password"). Only password accounts
// have a pre-verification window where an inert row can linger; OAuth (Google)
// accounts are created already-verified.
const PASSWORD_PROVIDER = "password";

/**
 * Delete inert pre-verification password accounts older than the cutoff.
 *
 * Every email+password sign-up attempt creates a `users` row and an
 * `authAccounts` row (with the hashed password) BEFORE the emailed code is
 * entered. If the code is never entered those rows are never garbage-collected:
 *   • DB pollution that grows with every abandoned / abusive sign-up, and
 *   • password-path account squatting — an attacker pre-registers a victim's
 *     email so the victim's later sign-up collides with an "already exists".
 *
 * An account is "verified" once `emailVerified` is set on the authAccounts row
 * (and `emailVerificationTime` on the user). We delete only password accounts
 * with `emailVerified` still unset and `_creationTime` older than the cutoff,
 * along with their dangling verification codes. The linked user is cascade-
 * deleted only when it is fully inert — unverified, no remaining accounts, no
 * sessions — so we never touch a real user who merely has a stale password row
 * linked alongside a verified login.
 *
 * Returns the number of accounts deleted so the cron can drain in batches.
 */
export const purgeUnverifiedPasswordAccounts = internalMutation({
  args: {
    cutoffTimeMs: v.number(),
    limit: v.optional(v.number()),
  },
  returns: v.object({ deletedCount: v.number() }),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;

    const candidates = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", PASSWORD_PROVIDER),
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("emailVerified"), undefined),
          q.lt(q.field("_creationTime"), args.cutoffTimeMs),
        ),
      )
      .take(limit);

    let deletedCount = 0;
    for (const account of candidates) {
      // Drop any verification codes still pointing at this account.
      const codes = await ctx.db
        .query("authVerificationCodes")
        .withIndex("accountId", (q) => q.eq("accountId", account._id))
        .collect();
      for (const code of codes) {
        await ctx.db.delete(code._id);
      }

      const userId = account.userId;
      await ctx.db.delete(account._id);
      deletedCount++;

      // Cascade-delete the user only when it is a fully inert pre-verification
      // user: never verified (email or phone), no other linked accounts, and no
      // sessions. This protects a verified user who happens to have an
      // abandoned password account linked to the same identity.
      const user = await ctx.db.get(userId);
      if (
        user !== null &&
        user.emailVerificationTime === undefined &&
        user.phoneVerificationTime === undefined
      ) {
        const otherAccounts = await ctx.db
          .query("authAccounts")
          .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
          .take(1);
        if (otherAccounts.length === 0) {
          const sessions = await ctx.db
            .query("authSessions")
            .withIndex("userId", (q) => q.eq("userId", userId))
            .take(1);
          if (sessions.length === 0) {
            await ctx.db.delete(userId);
          }
        }
      }
    }

    return { deletedCount };
  },
});

/**
 * Delete OTP rate-limit rows whose last send is older than the cutoff. The
 * per-email rows accumulate one per distinct inbox ever emailed; once a row is
 * well past its window it carries no live limit and is pure dead weight.
 *
 * Returns the number of rows deleted so the cron can drain in batches.
 */
export const purgeStaleOtpLimits = internalMutation({
  args: {
    cutoffTimeMs: v.number(),
    limit: v.optional(v.number()),
  },
  returns: v.object({ deletedCount: v.number() }),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;

    const stale = await ctx.db
      .query("otp_send_limits")
      .withIndex("by_last_sent", (q) => q.lt("last_sent_at", args.cutoffTimeMs))
      .take(limit);

    let deletedCount = 0;
    for (const row of stale) {
      await ctx.db.delete(row._id);
      deletedCount++;
    }

    return { deletedCount };
  },
});
