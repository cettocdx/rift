import { getUserID } from "@/lib/auth/get-user-id";
import { completeGithubOAuth } from "@/lib/github/complete-oauth";
import { createGithubHandoff } from "@/lib/github/oauth-handoff";
import {
  githubStateCookie,
  githubStateCookieOptions,
  githubStateDigest,
} from "@/lib/github/oauth-browser-binding";
import { NextRequest, NextResponse } from "next/server";
import { verifyState } from "@/lib/github/oauth-state";
import { githubOAuthConfig } from "@/lib/github/oauth-config";

export const runtime = "nodejs";

function back(
  origin: string,
  returnTo: string,
  status: string,
  desktopState?: string,
  desktopScheme: "rift" | "rift-preview" = "rift",
) {
  if (desktopState) {
    const result = new URL("/github-desktop-return", origin);
    result.searchParams.set("desktop_state", desktopState);
    result.searchParams.set("desktop_scheme", desktopScheme);
    const destination = new URL(returnTo, origin);
    // Older native builds append a generic status. Keep the detailed result
    // first so the existing UI's URLSearchParams.get reads the real failure.
    if (status !== "pending") destination.searchParams.set("github", status);
    result.searchParams.set(
      "return_to",
      destination.pathname + destination.search + destination.hash,
    );
    result.searchParams.set("github", status);
    return NextResponse.redirect(result, {
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
  const result = new URL(returnTo, origin);
  result.searchParams.set("github", status);
  return NextResponse.redirect(result, {
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

/** Web callbacks require the initiating browser; desktop callbacks only stage a code. */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  if (!githubOAuthConfig()) return back(origin, "/", "not_configured");
  const state = req.nextUrl.searchParams.get("state");
  const verified = verifyState(state);
  if (!verified || !state) return back(origin, "/", "bad_state");
  const finish = (status: string) =>
    back(
      origin,
      verified.returnTo,
      status,
      verified.desktopState,
      verified.desktopScheme,
    );
  if (!verified.desktopState) {
    const binding = req.cookies.get(githubStateCookie(origin))?.value;
    if (!binding || binding !== githubStateDigest(state))
      return finish("bad_state");
    try {
      if ((await getUserID(req)) !== verified.userId)
        return finish("bad_state");
    } catch {
      return finish("auth_required");
    }
  }
  const providerError = req.nextUrl.searchParams.get("error");
  if (providerError)
    return finish(
      providerError === "access_denied" ? "denied" : "configuration_error",
    );
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return finish("no_code");
  if (verified.desktopState) {
    try {
      const ticket = await createGithubHandoff(
        verified.userId,
        state,
        code,
        origin,
      );
      return back(
        origin,
        `/github-complete?ticket=${ticket}`,
        "pending",
        verified.desktopState,
        verified.desktopScheme,
      );
    } catch {
      return finish("error");
    }
  }
  const status = await completeGithubOAuth({
    origin,
    userId: verified.userId,
    returnTo: verified.returnTo,
    code,
  });
  const response = finish(status);
  response.cookies.set(githubStateCookie(origin), "", {
    ...githubStateCookieOptions(origin),
    maxAge: 0,
  });
  return response;
}
