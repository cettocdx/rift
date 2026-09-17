import { NextRequest } from "next/server";
import {
  isDesktopAuthState,
  sanitizeDesktopReturnPath,
} from "@/lib/desktop-auth-flow";
import { randomBytes } from "node:crypto";

export const runtime = "nodejs";

/** No credentials cross into the app: this only completes a pending local nonce. */
export function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get("desktop_state");
  if (!isDesktopAuthState(state))
    return new Response("Connection expired. Return to RIFT and try again.", {
      status: 400,
    });
  const callback = new URL(
    req.nextUrl.searchParams.get("desktop_scheme") === "rift-preview"
      ? "rift-preview://github"
      : "rift://github",
  );
  callback.searchParams.set("desktop_state", state);
  callback.searchParams.set(
    "return_to",
    sanitizeDesktopReturnPath(req.nextUrl.searchParams.get("return_to")),
  );
  const status = req.nextUrl.searchParams.get("github");
  callback.searchParams.set(
    "github",
    status === "connected"
      ? "connected"
      : status === "pending"
        ? "pending"
        : "error",
  );
  const href = callback
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
  const target = JSON.stringify(callback.toString()).replace(/</g, "\\u003c");
  const nonce = randomBytes(16).toString("base64");
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Return to RIFT</title><style nonce="${nonce}">body{font:15px system-ui;margin:0;min-height:100vh;display:grid;place-items:center;background:#181818;color:#eee}main{max-width:420px;padding:32px}h1{font-size:24px}p{color:#aaa;line-height:1.6}a{display:inline-block;background:#eee;color:#181818;padding:12px 20px;border-radius:10px;text-decoration:none}</style><main><h1>${status === "connected" ? "GitHub connected" : status === "pending" ? "Finish connecting GitHub" : "GitHub connection needs attention"}</h1><p>Return to RIFT to continue. If your browser asks, allow it to open the app.</p><a href="${href}">Open RIFT</a></main><script nonce="${nonce}">window.location.href=${target};</script></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
      },
    },
  );
}
