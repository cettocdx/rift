import crypto from "crypto";
import {
  isDesktopAuthState,
  sanitizeDesktopReturnPath,
} from "@/lib/desktop-auth-flow";

/**
 * Signed context for the GitHub connect flow: initiating RIFT user, sanitized
 * return path, expiry, and optional native nonce. A signature prevents edits;
 * it does not prevent someone forwarding a valid authorization URL.
 *
 * Web callbacks additionally require the initiating browser's HttpOnly state
 * cookie and authenticated RIFT identity. Desktop callbacks stage an encrypted
 * code in a one-use handoff; only authenticated completion after the native
 * nonce gate exchanges that code and persists the GitHub connection.
 */

const TEN_MINUTES_MS = 10 * 60 * 1000;

function secret(): string {
  const s =
    process.env.GITHUB_OAUTH_STATE_SECRET ||
    process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!s) {
    throw new Error(
      "GITHUB_OAUTH_STATE_SECRET (or CONVEX_SERVICE_ROLE_KEY) is required to sign GitHub OAuth state.",
    );
  }
  return s;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

interface StatePayload {
  u: string; // userId
  r: string; // returnTo (same-origin path)
  e: number; // expiry (epoch ms)
  s?: "rift" | "rift-preview";
  d?: string; // nonce prepared by the initiating desktop
}

export function signState(
  userId: string,
  returnTo: string,
  desktopState?: string,
  desktopScheme: "rift" | "rift-preview" = "rift",
): string {
  const payload: StatePayload = {
    u: userId,
    r: sanitizeReturnTo(returnTo),
    ...(isDesktopAuthState(desktopState)
      ? { d: desktopState, s: desktopScheme }
      : {}),
    e: Date.now() + TEN_MINUTES_MS,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(
    crypto.createHmac("sha256", secret()).update(body).digest(),
  );
  return `${body}.${sig}`;
}

export function verifyState(state: string | null | undefined): {
  userId: string;
  returnTo: string;
  desktopState?: string;
  desktopScheme?: "rift" | "rift-preview";
} | null {
  if (!state) return null;
  const [body, sig, extra] = state.split(".");
  if (extra !== undefined) return null;
  if (!body || !sig) return null;

  const expected = b64url(
    crypto.createHmac("sha256", secret()).update(body).digest(),
  );
  // Constant-time compare.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(fromB64url(body).toString()) as StatePayload;
    if (!payload.u || typeof payload.e !== "number") return null;
    if (Date.now() > payload.e) return null;
    if (payload.d !== undefined && !isDesktopAuthState(payload.d)) return null;
    return {
      userId: payload.u,
      returnTo: sanitizeReturnTo(payload.r),
      ...(payload.d
        ? {
            desktopState: payload.d,
            desktopScheme:
              payload.s === "rift-preview"
                ? ("rift-preview" as const)
                : ("rift" as const),
          }
        : {}),
    };
  } catch {
    return null;
  }
}

/** Only allow same-origin relative paths as the post-auth redirect target. */
export function sanitizeReturnTo(returnTo: string | null | undefined): string {
  return sanitizeDesktopReturnPath(returnTo);
}
