import { createHash, timingSafeEqual } from "node:crypto";
import { auth as authorizeMcpOAuth } from "@modelcontextprotocol/sdk/client/auth.js";
import { NextResponse, type NextRequest } from "next/server";

import { api } from "@/convex/_generated/api";
import { connectMcpServer } from "@/lib/ai/mcp/mcp-client";
import {
  decryptMcpSecretPayload,
  encryptMcpSecretPayload,
} from "@/lib/ai/mcp/mcp-credential-vault";
import {
  assertMcpOAuthPendingSession,
  MCP_OAUTH_SESSION_BINDING,
  mcpOAuthExpiresAt,
  mcpOAuthScopes,
  PersistedMcpOAuthProvider,
  resolveMcpPluginsUrl,
} from "@/lib/ai/mcp/mcp-oauth";
import { withAbortableTimeout } from "@/lib/ai/mcp/mcp-timeout";
import {
  createSafeMcpFetch,
  isLocalMcpDevelopmentEnabled,
} from "@/lib/ai/mcp/mcp-url-policy";
import { getUserID } from "@/lib/auth/get-user-id";
import { getConvexClient } from "@/lib/db/convex-client";

export const runtime = "nodejs";
export const maxDuration = 45;

const OAUTH_EXCHANGE_TIMEOUT_MS = 20_000;
const MAX_STATE_LENGTH = 128;
const MAX_CODE_LENGTH = 16_384;
const MAX_SESSION_AGE_MS = 15 * 60_000;

type RedirectReason =
  | "connected"
  | "denied"
  | "expired"
  | "invalid"
  | "unavailable";

function pluginsRedirect(request: NextRequest, reason: RedirectReason) {
  let url: URL;
  try {
    url = resolveMcpPluginsUrl(request.url);
  } catch {
    return NextResponse.json(
      { ok: false, error: "OAuth public app URL is not configured." },
      {
        status: 503,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
  url.searchParams.set("oauth", reason === "connected" ? "connected" : "error");
  if (reason !== "connected") url.searchParams.set("reason", reason);
  return NextResponse.redirect(url, { status: 303 });
}

function exactStateMatch(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

/** Consume the one-time PKCE session, exchange the code, probe, then persist. */
export async function GET(request: NextRequest) {
  let connection: Awaited<ReturnType<typeof connectMcpServer>> = null;
  try {
    const userId = await getUserID(request);
    const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
    if (!serviceKey || process.env.MCP_DISABLED === "true") {
      return pluginsRedirect(request, "unavailable");
    }

    const requestUrl = new URL(request.url);
    const state = requestUrl.searchParams.get("state") ?? "";
    if (
      !/^[A-Za-z0-9_-]{32,128}$/.test(state) ||
      state.length > MAX_STATE_LENGTH
    ) {
      return pluginsRedirect(request, "invalid");
    }
    const stateHash = createHash("sha256").update(state).digest("hex");
    const consumed = await getConvexClient().mutation(
      api.mcpServers.consumeOAuthSessionForBackend,
      { serviceKey, userId, stateHash },
    );
    if (!consumed) return pluginsRedirect(request, "expired");

    if (requestUrl.searchParams.has("error")) {
      return pluginsRedirect(request, "denied");
    }
    const code = requestUrl.searchParams.get("code") ?? "";
    if (!code || code.length > MAX_CODE_LENGTH || /[\u0000\r\n]/.test(code)) {
      return pluginsRedirect(request, "invalid");
    }

    const pending = decryptMcpSecretPayload(consumed.encryptedState, {
      userId,
      url: MCP_OAUTH_SESSION_BINDING,
      purpose: "oauth-session",
    });
    assertMcpOAuthPendingSession(pending);
    const now = Date.now();
    if (
      !exactStateMatch(pending.state, state) ||
      pending.createdAt > now + 60_000 ||
      now - pending.createdAt > MAX_SESSION_AGE_MS
    ) {
      return pluginsRedirect(request, "expired");
    }
    const registeredCallback = new URL(pending.redirectUrl);
    if (
      registeredCallback.origin !== requestUrl.origin ||
      registeredCallback.pathname !== requestUrl.pathname
    ) {
      return pluginsRedirect(request, "invalid");
    }

    const safeFetch = createSafeMcpFetch({
      allowLocalDevelopment: isLocalMcpDevelopmentEnabled(),
    });
    const provider = new PersistedMcpOAuthProvider({
      redirectUrl: pending.redirectUrl,
      state: pending.state,
      codeVerifier: pending.codeVerifier,
      clientInformation: pending.clientInformation,
      discoveryState: pending.discoveryState,
    });
    const authResult = await withAbortableTimeout(
      (signal) =>
        authorizeMcpOAuth(provider, {
          serverUrl: pending.url,
          authorizationCode: code,
          fetchFn: (input, init) => safeFetch(input, { ...init, signal }),
        }),
      OAUTH_EXCHANGE_TIMEOUT_MS,
      `MCP OAuth exchange (${pending.name})`,
    );
    if (authResult !== "AUTHORIZED") {
      return pluginsRedirect(request, "unavailable");
    }

    connection = await connectMcpServer({
      id: pending.connectionId ?? stateHash.slice(0, 32),
      name: pending.name,
      url: pending.url,
      transport: pending.transport,
      authProvider: provider,
    });
    if (!connection || connection.toolNames.length === 0) {
      return pluginsRedirect(request, "unavailable");
    }

    const credentialSnapshot = provider.credentialSnapshot();
    const encryptedOAuthCredentials = encryptMcpSecretPayload(
      credentialSnapshot,
      {
        userId,
        url: pending.url,
        purpose: "oauth-credentials",
      },
    );
    const oauthExpiresAt = mcpOAuthExpiresAt(credentialSnapshot);
    const oauthScopes = mcpOAuthScopes(credentialSnapshot);
    const mutationArgs = {
      serviceKey,
      userId,
      catalogId: pending.catalogId,
      name: pending.name,
      url: pending.url,
      transport: pending.transport,
      authKind: "oauth" as const,
      encryptedOAuthCredentials,
      credentialHeaderKeys: [],
      oauthExpiresAt,
      oauthScopes,
      toolCount: connection.toolNames.length,
      toolNames: connection.toolNames,
    };
    const persisted = pending.connectionId
      ? await getConvexClient().mutation(
          api.mcpServers.updateVerifiedServerForBackend,
          {
            ...mutationArgs,
            id: pending.connectionId as never,
            expectedConfigRevision: pending.expectedConfigRevision as number,
          },
        )
      : await getConvexClient().mutation(
          api.mcpServers.addVerifiedServerForBackend,
          mutationArgs,
        );
    if (!persisted.success) {
      return pluginsRedirect(request, "unavailable");
    }

    return pluginsRedirect(request, "connected");
  } catch (error) {
    console.error({
      timestamp: new Date().toISOString(),
      level: "error",
      event: "mcp_oauth_callback_failed",
      service: "rift",
      environment: process.env.NODE_ENV ?? "unknown",
      error_name: error instanceof Error ? error.name : "UnknownError",
    });
    return pluginsRedirect(request, "unavailable");
  } finally {
    await connection?.close().catch(() => undefined);
  }
}
