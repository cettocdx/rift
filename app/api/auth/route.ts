import "server-only";
import { fetchAction } from "convex/nextjs";
import { cookies, headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  CONVEX_AUTH_COOKIE_MAX_AGE,
  convexAuthCookieName,
  convexAuthCookieOptions,
  isLocalAuthHost,
  setConvexAuthCookies,
} from "@/lib/auth/convex-auth-cookies";

/**
 * Auth proxy for @convex-dev/auth. This faithfully re-implements the library's
 * `proxyAuthActionToConvex` (which is NOT exported from the package index, and
 * whose deep path is blocked by the package `exports` map) so it runs as a
 * plain Next.js Route Handler instead of middleware (which broke under Next 16).
 *
 * The two things a naive proxy gets wrong — and that caused the
 * "Could not verify OIDC token claim" login failures — are:
 *   1. Cookie NAMES: in production cookies are `__Host-`-prefixed. Reading/
 *      writing the unprefixed name silently desyncs from the client provider
 *      and leaves stale tokens that get rejected.
 *   2. Clear cookies only when the auth service definitively rejects the
 *      session. A transport/server failure must leave refresh credentials intact.
 */

function isCorsRequest(request: NextRequest): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  const originURL = new URL(origin);
  return (
    originURL.host !== request.headers.get("Host") ||
    originURL.protocol !== new URL(request.url).protocol
  );
}

// fetchAction is typed for FunctionReference; the auth actions are addressed by
// their string path at runtime (exactly as the library's own proxy does).
const runAction = fetchAction as unknown as (
  action: string,
  args: Record<string, unknown>,
  options: { url?: string; token?: string },
) => Promise<{
  tokens?: { token: string; refreshToken: string } | null;
  redirect?: string;
  verifier?: string;
} | null>;

function knownSignInRejection(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  // Convex wraps action errors with request/stack details. Match only known
  // rejection lines, and return fixed messages rather than forwarding those details.
  const reason = error.message.match(
    /(?:^|\n)(?:Uncaught Error: )?(InvalidAccountId|InvalidSecret|Invalid credentials|Invalid code|Could not verify code|Invalid verifier|Invalid state|TooManyFailedAttempts|Disposable email addresses are not allowed\.)(?:\n|$)/,
  )?.[1];
  if (reason === "TooManyFailedAttempts")
    return "Too many sign-in attempts. Please try again later.";
  if (reason === "Disposable email addresses are not allowed.") return reason;
  if (reason === "InvalidAccountId" || reason === "InvalidSecret")
    return "Invalid credentials";
  return reason;
}

export async function POST(request: NextRequest) {
  if (request.method !== "POST") {
    return new Response("Invalid method", { status: 405 });
  }
  if (isCorsRequest(request)) {
    return new Response("Invalid origin", { status: 403 });
  }

  const { action, args } = (await request.json()) as {
    action: string;
    args: Record<string, unknown>;
  };

  if (action !== "auth:signIn" && action !== "auth:signOut") {
    return new Response("Invalid action", { status: 400 });
  }

  const host = (await headers()).get("Host");
  const isLocalhost = isLocalAuthHost(host);
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;

  let token: string | undefined;
  if (action === "auth:signIn" && args.refreshToken !== undefined) {
    // The client sends a dummy refreshToken; the real one lives only in cookies.
    const refreshToken = cookieStore.get(
      convexAuthCookieName("refreshToken", isLocalhost),
    )?.value;
    if (!refreshToken) {
      return new Response(JSON.stringify({ tokens: null }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    args.refreshToken = refreshToken;
  } else {
    // Authenticate the proxy call as the current user (needed for signOut and
    // session-aware signIn logic).
    token = cookieStore.get(convexAuthCookieName("token", isLocalhost))?.value;
  }

  // OAuth code exchange: the PKCE/OAuth verifier was stored as an httpOnly
  // cookie when sign-in STARTED (it is never handed to the client), so it must
  // be injected here for the code-redemption call. Without this, Convex's
  // verifyCodeAndSignIn fails with "Invalid verifier" and the Google login
  // silently drops the user back on the landing page, logged out.
  if (
    action === "auth:signIn" &&
    (args.params as { code?: unknown } | undefined)?.code !== undefined
  ) {
    const verifier = cookieStore.get(
      convexAuthCookieName("verifier", isLocalhost),
    )?.value;
    if (verifier !== undefined) {
      args.verifier = verifier;
    }
  }

  if (action === "auth:signIn") {
    // Don't require auth when refreshing tokens or validating a code — those are
    // steps in the auth flow, not authenticated requests.
    const authOpts =
      args.refreshToken !== undefined ||
      (args.params as { code?: unknown } | undefined)?.code !== undefined
        ? {}
        : { token };

    let result;
    const isRefresh = args.refreshToken !== undefined;
    // The Next.js auth client turns HTTP errors into plain Error instances, so
    // its TypeError-only network retry does not cover proxy failures. Refresh
    // permits one bounded server retry: Convex Auth accepts the parent of the
    // active token and has a 10s reuse window for a lost rotation response.
    // OAuth codes and other sign-in actions are never replayed here.
    const attempts = isRefresh ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        result = await runAction(action, args, { url, ...authOpts });
        break;
      } catch (error) {
        if (
          isRefresh &&
          error instanceof Error &&
          /(?:^|\n)(?:Uncaught Error: )?Can't parse refresh token:/.test(
            error.message,
          )
        ) {
          // An explicitly malformed cookie is invalid, unlike an unknown
          // server error. Use the same signed-out contract as revoked tokens.
          result = { tokens: null };
          break;
        }
        if (!isRefresh) {
          const rejection = knownSignInRejection(error);
          if (rejection) {
            return NextResponse.json({ error: rejection }, { status: 400 });
          }
        }
        if (attempt + 1 < attempts) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          continue;
        }
        return NextResponse.json(
          {
            error: "Sign-in is temporarily unavailable. Please try again.",
            retryable: true,
          },
          { status: 503, headers: { "Retry-After": "1" } },
        );
      }
    }

    if (result?.redirect !== undefined) {
      const response = NextResponse.json({ redirect: result.redirect });
      if (result.verifier) {
        response.cookies.set(
          convexAuthCookieName("verifier", isLocalhost),
          result.verifier,
          {
            ...convexAuthCookieOptions(isLocalhost),
            maxAge: CONVEX_AUTH_COOKIE_MAX_AGE,
          },
        );
      }
      return response;
    }

    if (result && "tokens" in result) {
      const tokens = result.tokens ?? null;
      // The refresh token is never shared with the client — it stays in cookies.
      const response = NextResponse.json({
        tokens: tokens ? { token: tokens.token, refreshToken: "dummy" } : null,
      });
      setConvexAuthCookies(response, tokens, isLocalhost);
      return response;
    }

    return NextResponse.json(result);
  }

  // auth:signOut — best-effort, then always clear cookies.
  try {
    await runAction(action, args, { url, token });
  } catch (error) {
    console.error("Hit error while running `auth:signOut`:", error);
  }
  const response = NextResponse.json(null);
  setConvexAuthCookies(response, null, isLocalhost);
  return response;
}
