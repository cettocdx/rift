import crypto from "crypto";

/**
 * Per-run bearer token for the OpenCode → RIFT LLM proxy.
 *
 * OpenCode runs inside the chat's E2B sandbox and must reach the model, but the
 * OpenRouter key can never enter the sandbox. So OpenCode is configured to call
 * RIFT's own OpenAI-compatible proxy with this token instead. The token is a
 * stateless HMAC of {runId, chatId, userId, sandboxId, expiry} — the same
 * construction as the GitHub OAuth state ([[rift-github-connect]]) — so the
 * proxy can verify it with no database round-trip and bind every model call to
 * exactly one run. Authorization to spend (the per-leg ceiling) is a separate,
 * revocable Redis lease the proxy also checks; this token only proves identity.
 */

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // one sandbox lifetime

function secret(): string {
  const s = process.env.LLM_PROXY_SECRET || process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!s) {
    throw new Error(
      "LLM_PROXY_SECRET (or CONVEX_SERVICE_ROLE_KEY) is required to sign LLM proxy tokens.",
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

export interface RunTokenClaims {
  runId: string;
  chatId: string;
  userId: string;
  sandboxId: string;
}

interface TokenPayload {
  v: 1;
  r: string; // runId
  c: string; // chatId
  u: string; // userId
  s: string; // sandboxId
  e: number; // expiry (epoch ms)
}

export function signRunToken(
  claims: RunTokenClaims,
  ttlMs: number = DEFAULT_TTL_MS,
): string {
  const payload: TokenPayload = {
    v: 1,
    r: claims.runId,
    c: claims.chatId,
    u: claims.userId,
    s: claims.sandboxId,
    e: Date.now() + ttlMs,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(
    crypto.createHmac("sha256", secret()).update(body).digest(),
  );
  return `${body}.${sig}`;
}

export function verifyRunToken(
  token: string | null | undefined,
): RunTokenClaims | null {
  if (!token) return null;
  const trimmed = token.startsWith("Bearer ") ? token.slice(7).trim() : token;
  const [body, sig] = trimmed.split(".");
  if (!body || !sig) return null;

  const expected = b64url(
    crypto.createHmac("sha256", secret()).update(body).digest(),
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(fromB64url(body).toString()) as TokenPayload;
    if (
      payload.v !== 1 ||
      !payload.r ||
      !payload.c ||
      !payload.u ||
      !payload.s ||
      typeof payload.e !== "number"
    ) {
      return null;
    }
    if (Date.now() > payload.e) return null;
    return {
      runId: payload.r,
      chatId: payload.c,
      userId: payload.u,
      sandboxId: payload.s,
    };
  } catch {
    return null;
  }
}
