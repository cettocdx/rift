import "server-only";

import type { NextResponse } from "next/server";

export const CONVEX_AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export type ConvexAuthCookieKind = "token" | "refreshToken" | "verifier";

export type ConvexAuthCookieTokens = {
  token: string;
  refreshToken: string;
};

type ReadonlyCookieStore = {
  get(name: string): { value: string } | undefined;
};

export function isLocalAuthHost(host: string | null): boolean {
  return /^(localhost|127\.0\.0\.1)(?::\d+)?$/i.test(host ?? "");
}

export function convexAuthCookieName(
  kind: ConvexAuthCookieKind,
  isLocalhost: boolean,
): string {
  const prefix = isLocalhost ? "" : "__Host-";
  switch (kind) {
    case "token":
      return prefix + "__convexAuthJWT";
    case "refreshToken":
      return prefix + "__convexAuthRefreshToken";
    case "verifier":
      return prefix + "__convexAuthOAuthVerifier";
  }
}

export function convexAuthCookieOptions(isLocalhost: boolean) {
  return {
    secure: !isLocalhost,
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
  };
}

export function readConvexAuthCookies(
  cookieStore: ReadonlyCookieStore,
  isLocalhost: boolean,
): ConvexAuthCookieTokens | null {
  const token = cookieStore.get(
    convexAuthCookieName("token", isLocalhost),
  )?.value;
  const refreshToken = cookieStore.get(
    convexAuthCookieName("refreshToken", isLocalhost),
  )?.value;

  if (!token || !refreshToken) return null;
  return { token, refreshToken };
}

export function setConvexAuthCookies(
  response: NextResponse,
  tokens: ConvexAuthCookieTokens | null,
  isLocalhost: boolean,
) {
  const options = convexAuthCookieOptions(isLocalhost);
  if (tokens === null) {
    response.cookies.set(convexAuthCookieName("token", isLocalhost), "", {
      ...options,
      maxAge: 0,
    });
    response.cookies.set(
      convexAuthCookieName("refreshToken", isLocalhost),
      "",
      { ...options, maxAge: 0 },
    );
  } else {
    response.cookies.set(
      convexAuthCookieName("token", isLocalhost),
      tokens.token,
      { ...options, maxAge: CONVEX_AUTH_COOKIE_MAX_AGE },
    );
    response.cookies.set(
      convexAuthCookieName("refreshToken", isLocalhost),
      tokens.refreshToken,
      { ...options, maxAge: CONVEX_AUTH_COOKIE_MAX_AGE },
    );
  }

  response.cookies.set(convexAuthCookieName("verifier", isLocalhost), "", {
    ...options,
    maxAge: 0,
  });
}
