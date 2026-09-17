import "server-only";

import { randomBytes } from "node:crypto";
import { sealData, unsealData } from "iron-session";
import type { ConvexAuthCookieTokens } from "@/lib/auth/convex-auth-cookies";

const DESKTOP_SESSION_TTL_SECONDS = 300;
const DEVELOPMENT_SECRET_KEY = "__riftDesktopAuthSealSecret";

type DesktopAuthGlobal = typeof globalThis & {
  [DEVELOPMENT_SECRET_KEY]?: string;
};

function desktopSessionSecret(): string | null {
  const configured =
    process.env.DESKTOP_AUTH_SEAL_PASSWORD ??
    process.env.WORKOS_COOKIE_PASSWORD;
  if (configured !== undefined) {
    if (configured.length < 32) {
      console.error(
        "[Desktop Auth] Desktop session seal password must be at least 32 characters",
      );
      return null;
    }
    return configured;
  }

  if (process.env.NODE_ENV === "production") {
    console.error(
      "[Desktop Auth] DESKTOP_AUTH_SEAL_PASSWORD is not configured",
    );
    return null;
  }

  const runtime = globalThis as DesktopAuthGlobal;
  runtime[DEVELOPMENT_SECRET_KEY] ??= randomBytes(32).toString("hex");
  return runtime[DEVELOPMENT_SECRET_KEY] ?? null;
}

function isDesktopSessionPayload(
  value: unknown,
): value is ConvexAuthCookieTokens {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.token === "string" &&
    payload.token.length > 0 &&
    typeof payload.refreshToken === "string" &&
    payload.refreshToken.length > 0
  );
}

export async function sealDesktopAuthSession(
  tokens: ConvexAuthCookieTokens,
): Promise<string | null> {
  const password = desktopSessionSecret();
  if (!password || !isDesktopSessionPayload(tokens)) return null;

  try {
    return await sealData(tokens, {
      password,
      ttl: DESKTOP_SESSION_TTL_SECONDS,
    });
  } catch (error) {
    console.error(
      "[Desktop Auth] Failed to seal the desktop session:",
      error instanceof Error ? error.message : "unknown error",
    );
    return null;
  }
}

export async function unsealDesktopAuthSession(
  sealedSession: string,
): Promise<ConvexAuthCookieTokens | null> {
  const password = desktopSessionSecret();
  if (!password || !sealedSession) return null;

  try {
    const payload = await unsealData<unknown>(sealedSession, {
      password,
      ttl: DESKTOP_SESSION_TTL_SECONDS,
    });
    return isDesktopSessionPayload(payload) ? payload : null;
  } catch (error) {
    console.error(
      "[Desktop Auth] Failed to unseal the desktop session:",
      error instanceof Error ? error.message : "unknown error",
    );
    return null;
  }
}
