import Resend from "@auth/core/providers/resend";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";

// Common throwaway / temp-mail domains. Blocking these at the verification gate
// stops "verify a disposable inbox -> spin up another free account" abuse.
// Extend freely; this is a pragmatic starter list, not exhaustive.
const DISPOSABLE = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.com",
  "temp-mail.org",
  "throwawaymail.com",
  "yopmail.com",
  "getnada.com",
  "dispostable.com",
  "trashmail.com",
  "sharklasers.com",
  "maildrop.cc",
  "mohmal.com",
  "fakeinbox.com",
  "tempmailo.com",
  "moakt.com",
  "emailondeck.com",
  "tempr.email",
  "spam4.me",
  "mailnesia.com",
]);

/**
 * Email verification provider for the Password flow. On sign-up it emails a
 * 6-digit code via Resend; the account is not usable until the code is entered,
 * so non-existent / fake email addresses cannot complete registration.
 */
export const ResendOTP = Resend({
  id: "resend-otp",
  apiKey: process.env.AUTH_RESEND_KEY,
  // Code is valid for 15 minutes.
  maxAge: 60 * 15,
  async generateVerificationToken() {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => (b % 10).toString()).join("");
  },
  async sendVerificationRequest(
    {
      identifier: email,
      provider,
      token,
    }: {
      identifier: string;
      provider: { apiKey?: string };
      token: string;
    },
    // Convex Auth passes the action ctx as a second arg (see
    // @convex-dev/auth signIn implementation). Optional in the type only so the
    // signature stays assignable to Auth.js's; it is always present at runtime.
    ctx?: ActionCtx,
  ) {
    const domain = email.split("@")[1]?.toLowerCase() ?? "";
    if (DISPOSABLE.has(domain)) {
      throw new Error("Disposable email addresses are not allowed.");
    }
    // Server-side rate limiting BEFORE the Resend fetch. The 60s cooldown in
    // AuthForm is client-only; an attacker calling this endpoint directly would
    // otherwise email-bomb inboxes and burn the Resend quota. Fail closed if the
    // ctx is somehow unavailable rather than sending unthrottled.
    if (!ctx) {
      throw new Error("Could not send verification email.");
    }
    await ctx.runMutation(internal.otpRateLimit.checkAndRecordSend, { email });
    const from = process.env.AUTH_EMAIL_FROM ?? "RIFT <onboarding@resend.dev>";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "Your RIFT verification code",
        text:
          `Your RIFT verification code is ${token}\n\n` +
          `This code expires in 15 minutes. If you didn't request it, you can ignore this email.`,
      }),
    });
    if (!res.ok) {
      throw new Error("Could not send verification email.");
    }
  },
});
