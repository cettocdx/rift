import type { NextRequest } from "next/server";

export class McpRequestPolicyError extends Error {
  readonly status = 403;

  constructor(message = "Cross-origin plugin requests are not allowed.") {
    super(message);
    this.name = "McpRequestPolicyError";
  }
}

/**
 * Browser mutations must be same-origin. Requests without browser provenance
 * headers remain available to authenticated RIFT API clients.
 */
export function assertSameOriginMcpMutation(request: NextRequest): void {
  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new McpRequestPolicyError();
  }

  const origin = request.headers.get("origin");
  if (!origin) return;

  let originUrl: URL;
  let requestUrl: URL;
  try {
    originUrl = new URL(origin);
    requestUrl = new URL(request.url);
  } catch {
    throw new McpRequestPolicyError("Invalid plugin request origin.");
  }
  if (originUrl.origin !== origin || originUrl.origin !== requestUrl.origin) {
    throw new McpRequestPolicyError();
  }
}
