import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getUserID } from "@/lib/auth/get-user-id";
import { consumeGithubHandoff } from "@/lib/github/oauth-handoff";
import { completeGithubOAuth } from "@/lib/github/complete-oauth";
export const runtime = "nodejs";
const ticketPattern = /^[a-f0-9]{64}$/;
const headers = {
  "Cache-Control": "no-store",
  // no-referrer makes browser form POSTs send Origin: null, which our
  // same-origin CSRF check correctly rejects. Keep origin on the local POST
  // while withholding the referrer from every cross-origin destination.
  "Referrer-Policy": "same-origin",
};
function page(message: string, status = 200, ticket?: string) {
  const nonce = randomBytes(16).toString("base64");
  // Callers supply fixed application copy; tickets are hex-validated before HTML.
  const title = ticket
    ? "Finish connecting GitHub"
    : "GitHub connection needs attention";
  const action = ticket
    ? `<form method="post" action="/github-complete"><input type="hidden" name="ticket" value="${ticket}"><button type="submit">Finish connecting</button></form>`
    : `<a href="/">Back to RIFT</a>`;
  const script = ticket
    ? `<script nonce="${nonce}">history.replaceState(null,"","/github-complete");document.querySelector("form").submit();</script>`
    : "";
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${title} · RIFT</title><style nonce="${nonce}">:root{color-scheme:light dark;background:#fafafa;color:#202020}*{box-sizing:border-box}body{font:15px system-ui,-apple-system,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center}main{width:min(100%,440px);padding:32px}.brand{font-size:12px;letter-spacing:.18em;font-weight:650;color:#777;margin:0 0 28px}h1{font-size:23px;line-height:1.3;letter-spacing:-.025em;margin:0 0 12px}p{line-height:1.6;color:#626262;margin:0 0 24px}a,button{display:inline-block;min-height:44px;border:1px solid #d4d4d4;background:#fff;color:inherit;padding:11px 18px;border-radius:8px;font:inherit;text-decoration:none;cursor:pointer}a:focus-visible,button:focus-visible{outline:2px solid currentColor;outline-offset:4px}@media(prefers-color-scheme:dark){:root{background:#181818;color:#eee}p{color:#aaa}a,button{background:#252525;border-color:#484848}}</style><main><p class="brand">RIFT</p><h1>${title}</h1><p>${message}</p>${action}</main>${script}</html>`,
    {
      status,
      headers: {
        ...headers,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
      },
    },
  );
}
export function GET(req: NextRequest) {
  const ticket = req.nextUrl.searchParams.get("ticket") || "";
  if (!ticketPattern.test(ticket))
    return page(
      "This connection has expired. Return to RIFT and start a new GitHub connection.",
      400,
    );
  return page(
    "Completing the connection in your signed-in RIFT account…",
    200,
    ticket,
  );
}
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== req.nextUrl.origin)
    return page("Return to RIFT to finish connecting GitHub.", 403);
  let userId: string;
  try {
    userId = await getUserID(req);
  } catch {
    return page("Sign in to RIFT, then start a new GitHub connection.", 401);
  }
  let ticket: string;
  try {
    const text = await req.text();
    if (text.length > 512) throw new Error();
    ticket = new URLSearchParams(text).get("ticket") || "";
    if (!ticketPattern.test(ticket)) throw new Error();
  } catch {
    return page(
      "This connection is invalid. Return to RIFT and start a new GitHub connection.",
      400,
    );
  }
  let pending;
  try {
    pending = await consumeGithubHandoff(userId, ticket, req.nextUrl.origin);
  } catch {
    return page(
      "GitHub connection is temporarily unavailable. Return to RIFT and try again.",
      503,
    );
  }
  if (!pending)
    return page(
      "This connection has expired or belongs to another RIFT account. Return to RIFT and start a new GitHub connection.",
      400,
    );
  const status = await completeGithubOAuth({
    origin: req.nextUrl.origin,
    userId,
    returnTo: pending.returnTo,
    code: pending.code,
  });
  const target = new URL(pending.returnTo, req.nextUrl.origin);
  target.searchParams.set("github", status);
  const response = NextResponse.redirect(target, 303);
  for (const [key, value] of Object.entries(headers))
    response.headers.set(key, value);
  return response;
}
