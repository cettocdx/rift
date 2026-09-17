import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { canonicalizeEmail } from "./emailCanonical";

/**
 * Server-side rate limiting for verification-code (OTP) emails.
 *
 * The only client-side protection is a 60s cooldown on the "Resend code"
 * button (app/components/AuthForm.tsx). An attacker who calls the sign-up /
 * resend endpoint directly bypasses that entirely and can (a) email-bomb an
 * arbitrary inbox and (b) burn the Resend send quota / sender reputation.
 *
 * This module enforces the limits in the Convex DB, inside a single
 * transactional mutation invoked from ResendOTP.sendVerificationRequest BEFORE
 * the Resend fetch. Convex mutations are serializable, so the check-and-record
 * is atomic — concurrent sends to the same inbox cannot race past the cap.
 *
 * Three gates (most-specific first):
 *   1. Min-interval  — at least OTP_MIN_INTERVAL_MS between sends to one inbox.
 *   2. Per-email cap  — at most OTP_EMAIL_MAX_PER_WINDOW sends per inbox per
 *                       OTP_EMAIL_WINDOW_MS.
 *   3. Global backstop — at most the daily cap across ALL inboxes. Per-IP
 *                       limiting is not reachable here (the auth action has no
 *                       real client IP), so this rolling daily cap bounds the
 *                       total blast radius / Resend spend.
 */

// At least this long between two sends to the SAME inbox.
export const OTP_MIN_INTERVAL_MS = 60 * 1000; // 60s

// Per-inbox: at most OTP_EMAIL_MAX_PER_WINDOW sends per OTP_EMAIL_WINDOW_MS.
export const OTP_EMAIL_WINDOW_MS = 15 * 60 * 1000; // 15 min
export const OTP_EMAIL_MAX_PER_WINDOW = 3;

// Global backstop window (rolling daily fixed window).
export const OTP_GLOBAL_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
export const OTP_GLOBAL_DAILY_CAP_DEFAULT = 1000;

// Single fixed key for the global counter row.
const OTP_GLOBAL_BUCKET = "otp:global";

/**
 * Global daily cap, overridable via env without a redeploy. Falls back to the
 * default for missing / invalid / non-positive values.
 */
export const getOtpGlobalDailyCap = (): number => {
  const configured = parseInt(process.env.OTP_GLOBAL_DAILY_CAP || "", 10);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : OTP_GLOBAL_DAILY_CAP_DEFAULT;
};

/**
 * Atomically check the OTP send limits for `email` and, if allowed, record the
 * send. Throws a friendly Error when a limit is exceeded (surfaced to the user
 * by AuthForm); does NOT send anything itself.
 *
 * Internal: only callable from trusted server code (ResendOTP), never the
 * client, so the limits cannot be probed or reset from the outside.
 */
export const checkAndRecordSend = internalMutation({
  args: { email: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const email = canonicalizeEmail(args.email);
    if (!email || !email.includes("@")) {
      // No usable recipient — let the caller's own validation handle it rather
      // than counting a malformed address against any bucket.
      throw new Error("A valid email address is required.");
    }

    // --- Read both buckets up front; decide everything before any write so a
    // --- later limit breach never leaves a partial increment behind. ---
    const globalRow = await ctx.db
      .query("otp_global_limits")
      .withIndex("by_bucket", (q) => q.eq("bucket", OTP_GLOBAL_BUCKET))
      .unique();
    const globalWindowActive =
      globalRow !== null && now - globalRow.window_start < OTP_GLOBAL_WINDOW_MS;
    const globalCount = globalWindowActive ? globalRow!.count : 0;

    const emailRow = await ctx.db
      .query("otp_send_limits")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    // 1. Min-interval between sends to the same inbox.
    if (emailRow !== null) {
      const sinceLast = now - emailRow.last_sent_at;
      if (sinceLast < OTP_MIN_INTERVAL_MS) {
        const wait = Math.ceil((OTP_MIN_INTERVAL_MS - sinceLast) / 1000);
        throw new Error(
          `Please wait ${wait} second${wait === 1 ? "" : "s"} before requesting another verification code.`,
        );
      }
    }

    // 2. Per-inbox cap within the window.
    const emailWindowActive =
      emailRow !== null && now - emailRow.window_start < OTP_EMAIL_WINDOW_MS;
    if (emailWindowActive && emailRow!.count >= OTP_EMAIL_MAX_PER_WINDOW) {
      const minutes = Math.max(
        1,
        Math.ceil(
          (OTP_EMAIL_WINDOW_MS - (now - emailRow!.window_start)) / 60000,
        ),
      );
      throw new Error(
        `Too many verification codes requested for this email. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      );
    }

    // 3. Global backstop across all inboxes.
    if (globalCount >= getOtpGlobalDailyCap()) {
      throw new Error(
        "Too many verification emails are being sent right now. Please try again later.",
      );
    }

    // --- All gates passed: record the send in both buckets. ---
    if (emailRow === null) {
      await ctx.db.insert("otp_send_limits", {
        email,
        window_start: now,
        count: 1,
        last_sent_at: now,
      });
    } else if (emailWindowActive) {
      await ctx.db.patch(emailRow._id, {
        count: emailRow.count + 1,
        last_sent_at: now,
      });
    } else {
      // Window expired — start a fresh one.
      await ctx.db.patch(emailRow._id, {
        window_start: now,
        count: 1,
        last_sent_at: now,
      });
    }

    if (globalRow === null) {
      await ctx.db.insert("otp_global_limits", {
        bucket: OTP_GLOBAL_BUCKET,
        window_start: now,
        count: 1,
      });
    } else if (globalWindowActive) {
      await ctx.db.patch(globalRow._id, { count: globalRow.count + 1 });
    } else {
      await ctx.db.patch(globalRow._id, { window_start: now, count: 1 });
    }

    return null;
  },
});
