import { type NextRequest, NextResponse } from "next/server";
import {
  isLocalAuthHost,
  setConvexAuthCookies,
} from "@/lib/auth/convex-auth-cookies";
import { exchangeDesktopTransferToken } from "@/lib/desktop-auth";
import {
  isDesktopAuthState,
  isDesktopTransferToken,
  sanitizeDesktopReturnPath,
} from "@/lib/desktop-auth-flow";
import { unsealDesktopAuthSession } from "@/lib/desktop-auth-session";

function authError(request: NextRequest, code: "401" | "500") {
  const response = NextResponse.redirect(
    new URL(`/auth-error?code=${code}`, request.nextUrl.origin),
    303,
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const transferToken = request.nextUrl.searchParams.get("token");
  const desktopAuthState = request.nextUrl.searchParams.get("desktop_state");
  if (
    !isDesktopTransferToken(transferToken) ||
    !isDesktopAuthState(desktopAuthState)
  ) {
    return authError(request, "401");
  }

  const transfer = await exchangeDesktopTransferToken(transferToken, {
    desktopAuthState,
  });
  if (!transfer) return authError(request, "401");

  const tokens = await unsealDesktopAuthSession(transfer.sealedSession);
  if (!tokens) return authError(request, "500");

  const destination = new URL(
    sanitizeDesktopReturnPath(transfer.returnPath),
    request.nextUrl.origin,
  );
  const response = NextResponse.redirect(destination, 303);
  setConvexAuthCookies(response, tokens, isLocalAuthHost(request.nextUrl.host));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
