import {
  githubStateCookie,
  githubStateCookieOptions,
  githubStateDigest,
} from "@/lib/github/oauth-browser-binding";
import { NextRequest, NextResponse } from "next/server";
import { getUserID } from "@/lib/auth/get-user-id";
import { signState, sanitizeReturnTo } from "@/lib/github/oauth-state";
import { githubOAuthConfig } from "@/lib/github/oauth-config";
import { OAUTH_RESULT_MESSAGES } from "@/lib/github/oauth-result-messages";

export const runtime = "nodejs";

function authorizeUrl(origin: string, clientId: string, state: string) {
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", `${origin}/api/github/callback`);
  authorize.searchParams.set("scope", "repo read:user");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("allow_signup", "false");
  return authorize.toString();
}

/** Legacy direct links retain their same-origin return destination. */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const returnTo = sanitizeReturnTo(req.nextUrl.searchParams.get("return_to"));
  const back = (status: string) => {
    const target = new URL(returnTo, origin);
    target.searchParams.set("github", status);
    return NextResponse.redirect(target);
  };
  let userId: string;
  try {
    userId = await getUserID(req);
  } catch {
    return back("auth_required");
  }
  const config = githubOAuthConfig();
  if (!config) return back("not_configured");
  const state = signState(userId, returnTo);
  const response = NextResponse.redirect(
    authorizeUrl(origin, config.clientId, state),
  );
  response.cookies.set(
    githubStateCookie(origin),
    githubStateDigest(state),
    githubStateCookieOptions(origin),
  );
  return response;
}

/** Both web and desktop check configuration while still inside RIFT. */
export async function POST(req: NextRequest) {
  const fail = (
    code: string,
    status: number,
    error = OAUTH_RESULT_MESSAGES[code]?.message,
  ) =>
    NextResponse.json(
      { code, error },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  if (req.headers.get("origin") !== req.nextUrl.origin)
    return fail("forbidden", 403, "Invalid origin");
  let userId: string;
  try {
    userId = await getUserID(req);
  } catch {
    return fail("auth_required", 401);
  }
  let body;
  try {
    const text = await req.text();
    if (text.length > 8192) throw new Error("Request too large");
    body = JSON.parse(text);
  } catch {
    return fail("invalid_request", 400, "Invalid request");
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    (body.return_to !== undefined && typeof body.return_to !== "string") ||
    (body.desktop_state !== undefined &&
      (typeof body.desktop_state !== "string" ||
        !/^[a-f0-9]{64}$/.test(body.desktop_state))) ||
    (body.desktop_scheme !== undefined &&
      (!body.desktop_state ||
        !["rift", "rift-preview"].includes(body.desktop_scheme)))
  )
    return fail("invalid_request", 400, "Invalid desktop state or return path");
  const config = githubOAuthConfig();
  if (!config) return fail("not_configured", 503);
  const state = signState(
    userId,
    sanitizeReturnTo(body.return_to),
    body.desktop_state,
    body.desktop_scheme === "rift-preview" ? "rift-preview" : "rift",
  );
  const response = NextResponse.json(
    { url: authorizeUrl(req.nextUrl.origin, config.clientId, state) },
    { headers: { "Cache-Control": "no-store" } },
  );
  if (!body.desktop_state)
    response.cookies.set(
      githubStateCookie(req.nextUrl.origin),
      githubStateDigest(state),
      githubStateCookieOptions(req.nextUrl.origin),
    );
  return response;
}
