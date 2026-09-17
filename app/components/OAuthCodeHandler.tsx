"use client";

import { useEffect, useRef } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { sanitizeOAuthCompletionPath } from "@/lib/routing/safe-app-redirect";

/**
 * Completes the OAuth (Google) sign-in code exchange on the client.
 *
 * Why this is needed: we use `ConvexAuthNextjsServerProvider`, which always
 * supplies a `serverState`. The library's own `AuthProvider` therefore takes
 * the server-state branch and RETURNS EARLY, never running its built-in
 * `?code=` URL handler — it assumes `convexAuthNextjsMiddleware` already
 * exchanged the code server-side. This app runs a custom `/api/auth` route
 * handler instead of that middleware (middleware broke under Next 16), so the
 * redirect that lands on `/?code=...` was never being exchanged and the user
 * was bounced to the landing page logged out.
 *
 * We replicate exactly what the library would do: read the `code` from the URL,
 * strip it, and call `signIn(undefined, { code })`. The custom `/api/auth`
 * route already handles this action (it special-cases `params.code`), and the
 * PKCE verifier is in localStorage from when sign-in started.
 */
export function OAuthCodeHandler() {
  const { signIn } = useAuthActions();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current || typeof window === "undefined") return;
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code) return;
    handled.current = true;

    // Strip the code from the URL first so a re-render can't reuse it. Keep the
    // cleaned same-origin route: desktop OAuth returns to /desktop-login with a
    // native state that must survive the client-side exchange.
    const completionPath = sanitizeOAuthCompletionPath(
      window.location.href,
      window.location.origin,
    );
    window.history.replaceState({}, "", completionPath);

    // `signIn(undefined, { code })` is exactly the call the library's internal
    // handler makes; the provider is intentionally undefined for a code exchange.
    void (
      signIn as unknown as (
        provider: undefined,
        params: { code: string },
      ) => Promise<unknown>
    )(undefined, { code }).then(
      () => {
        // Reload the cleaned route so server-rendered auth sees the new cookie.
        // For desktop-login this continues into the one-time native callback.
        window.location.replace(completionPath);
      },
      () => {
        // Reloading the same cleaned route fails closed. Desktop-login sends an
        // unauthenticated user back to sign-in with the native state preserved.
        window.location.replace(completionPath);
      },
    );
  }, [signIn]);

  return null;
}
