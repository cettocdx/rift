import Google from "@auth/core/providers/google";
// import Apple from "@auth/core/providers/apple";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ResendOTP } from "./ResendOTP";
import { canonicalizeEmail } from "./emailCanonical";
import type { MutationCtx } from "./_generated/server";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    // OAuth — verified, real identities (no fake emails possible).
    //   Google: needs AUTH_GOOGLE_ID + AUTH_GOOGLE_SECRET   ← LIVE
    Google({
      // Canonicalize the email (anti-farming) and reject ONLY when Google
      // explicitly marks the address unverified. We must NOT throw when the
      // claim is absent or a string ("true"), otherwise legitimate sign-ins
      // fail and the user is bounced to the landing page without a session.
      // Account-linking is left at the default: a Google login links to an
      // existing same-email account, which is safe because we only accept
      // Google-verified emails here.
      profile(p: {
        sub: string;
        name?: string;
        email: string;
        email_verified?: boolean | string;
        picture?: string;
      }) {
        if (p.email_verified === false || p.email_verified === "false") {
          throw new Error("Google account email is not verified");
        }
        return {
          id: p.sub,
          name: p.name,
          email: canonicalizeEmail(p.email),
          image: p.picture,
        };
      },
    }),
    // Apple: re-enable once the paid Apple Developer account is set up.
    //   Needs AUTH_APPLE_ID + AUTH_APPLE_SECRET (the secret is a generated JWT).
    // Apple,
    // Email + password, but registration requires an emailed 6-digit code, so
    // non-existent / fake addresses cannot create an account.
    //   Needs AUTH_RESEND_KEY (and optionally AUTH_EMAIL_FROM).
    // The profile canonicalizes the email (lowercase, strip +tags, strip Gmail
    // dots) so that variants of one inbox can't farm multiple free accounts.
    Password({
      verify: ResendOTP,
      profile: (params) => ({
        email: canonicalizeEmail(String(params.email ?? "")),
      }),
    }),
  ],
  callbacks: {
    /**
     * Reconnect a verified sign-in to an EXISTING user with the same email —
     * including legacy accounts (no `emailVerificationTime`) that the earlier
     * auth rebuild orphaned. Convex Auth's default linking only matches users
     * whose email is already verified (`uniqueUserWithVerifiedEmail`), so those
     * legacy paid accounts were skipped and a fresh empty user was created,
     * stranding the balance. This only links when the person proved they own
     * the email (OTP for password, Google's email_verified for OAuth), so it
     * cannot be used to take over someone else's account.
     */
    async createOrUpdateUser(ctx, args) {
      // Normal sign-in: the auth account is already linked to a user.
      if (args.existingUserId !== null) {
        return args.existingUserId;
      }

      const { provider, profile } = args;
      // Email is "verified" when the person proved ownership: Google OAuth
      // (our Google profile already rejects unverified emails) or the OTP email
      // provider. We never link on an unverified credentials attempt.
      const emailVerified =
        profile.emailVerified === true ||
        provider.type === "oauth" ||
        provider.type === "oidc";
      const shouldLink = emailVerified || provider.type === "email";
      const email =
        typeof profile.email === "string"
          ? canonicalizeEmail(profile.email)
          : undefined;

      // The callback's generic ctx doesn't expose our schema indexes; cast to
      // the app's typed MutationCtx (it is one at runtime).
      const db = (ctx as unknown as MutationCtx).db;

      if (email !== undefined && shouldLink) {
        const matches = await db
          .query("users")
          .withIndex("email", (q) => q.eq("email", email))
          .take(2);
        // Only link when the match is unambiguous (exactly one user).
        if (matches.length === 1) {
          const existing = matches[0];
          if (emailVerified && existing.emailVerificationTime === undefined) {
            await db.patch(existing._id, {
              emailVerificationTime: Date.now(),
            });
          }
          return existing._id;
        }
      }

      // No (unique) existing user → create a fresh one (default behaviour).
      const {
        emailVerified: _ev,
        phoneVerified: _pv,
        ...rest
      } = profile as Record<string, unknown>;
      void _ev;
      void _pv;
      return await db.insert("users", {
        ...rest,
        ...(email !== undefined ? { email } : {}),
        ...(emailVerified ? { emailVerificationTime: Date.now() } : {}),
      });
    },
  },
});
