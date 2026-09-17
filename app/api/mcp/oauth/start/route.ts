import { resolveRegistryBinding } from "@/lib/ai/mcp/registry/catalog";
import { createHash, randomBytes } from "node:crypto";
import { auth as authorizeMcpOAuth } from "@modelcontextprotocol/sdk/client/auth.js";
import { NextResponse, type NextRequest } from "next/server";

import { api } from "@/convex/_generated/api";
import {
  encryptMcpSecretPayload,
  McpCredentialVaultUnavailableError,
} from "@/lib/ai/mcp/mcp-credential-vault";
import {
  MCP_OAUTH_SESSION_BINDING,
  PersistedMcpOAuthProvider,
  resolveMcpOAuthCallbackUrl,
  validateMcpOAuthAuthorizationUrl,
} from "@/lib/ai/mcp/mcp-oauth";
import {
  assertMcpOAuthCatalogBinding,
  McpOAuthCatalogBindingError,
} from "@/lib/ai/mcp/mcp-oauth-catalog";
import {
  assertSameOriginMcpMutation,
  McpRequestPolicyError,
} from "@/lib/ai/mcp/mcp-request-policy";
import { withAbortableTimeout } from "@/lib/ai/mcp/mcp-timeout";
import {
  createSafeMcpFetch,
  isLocalMcpDevelopmentEnabled,
} from "@/lib/ai/mcp/mcp-url-policy";
import { canonicalizeMcpUrl } from "@/lib/ai/mcp/mcp-url-validation";
import { getUserID } from "@/lib/auth/get-user-id";
import { getConvexClient } from "@/lib/db/convex-client";
import { ChatSDKError } from "@/lib/errors";
import {
  readLimitedTextBody,
  RequestBodyTooLargeError,
} from "@/lib/api/read-limited-body";

export const runtime = "nodejs";
export const maxDuration = 45;

const MAX_BODY_BYTES = 20_000;
const MAX_NAME_LENGTH = 80;
const MAX_URL_LENGTH = 2_048;
const MAX_CATALOG_ID_LENGTH = 120;
const MAX_CONNECTION_ID_LENGTH = 200;
const OAUTH_START_TIMEOUT_MS = 20_000;
const OAUTH_SESSION_TTL_MS = 10 * 60_000;

type OAuthStartBody = {
  catalogId?: unknown;
  connectionId?: unknown;
  name?: unknown;
  url?: unknown;
  transport?: unknown;
};

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });

/** Begin generic MCP OAuth 2.1 authorization with PKCE and DCR. */
export async function POST(request: NextRequest) {
  try {
    assertSameOriginMcpMutation(request);
    const userId = await getUserID(request);
    const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      return json({ ok: false, error: "Plugin storage is unavailable." }, 503);
    }
    if (process.env.MCP_DISABLED === "true") {
      return json(
        { ok: false, error: "Plugin connections are disabled." },
        503,
      );
    }

    const contentType = request.headers.get("content-type")?.split(";", 1)[0];
    if (contentType !== "application/json") {
      return json(
        { ok: false, error: "Content-Type must be application/json." },
        415,
      );
    }

    let raw: string;
    try {
      raw = await readLimitedTextBody(request, MAX_BODY_BYTES);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return json({ ok: false, error: "Request is too large." }, 413);
      }
      throw error;
    }

    let body: OAuthStartBody;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json({ ok: false, error: "Invalid JSON body." }, 400);
      }
      body = parsed as OAuthStartBody;
    } catch {
      return json({ ok: false, error: "Invalid JSON body." }, 400);
    }

    const catalogId =
      typeof body.catalogId === "string" ? body.catalogId.trim() : "";
    const connectionId =
      typeof body.connectionId === "string"
        ? body.connectionId.trim()
        : undefined;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
    if (
      !catalogId ||
      catalogId.length > MAX_CATALOG_ID_LENGTH ||
      !/^[a-z0-9][a-z0-9._-]*$/i.test(catalogId)
    ) {
      return json({ ok: false, error: "Select a valid catalog plugin." }, 400);
    }
    if (
      connectionId !== undefined &&
      (!connectionId || connectionId.length > MAX_CONNECTION_ID_LENGTH)
    ) {
      return json({ ok: false, error: "Invalid plugin connection." }, 400);
    }
    if (!name || name.length > MAX_NAME_LENGTH) {
      return json({ ok: false, error: "Enter a valid server name." }, 400);
    }
    if (!rawUrl || rawUrl.length > MAX_URL_LENGTH) {
      return json({ ok: false, error: "Enter a valid MCP server URL." }, 400);
    }
    if (
      body.transport !== undefined &&
      body.transport !== "http" &&
      body.transport !== "sse"
    ) {
      return json({ ok: false, error: "Enter a valid MCP transport." }, 400);
    }
    const transport = body.transport === "sse" ? "sse" : "http";

    let url: string;
    try {
      url = canonicalizeMcpUrl(rawUrl, {
        allowLocalDevelopment: isLocalMcpDevelopmentEnabled(),
      });
    } catch {
      return json({ ok: false, error: "Enter a valid MCP server URL." }, 400);
    }
    let redirectUrl: string;
    try {
      redirectUrl = resolveMcpOAuthCallbackUrl(request.url);
    } catch {
      return json(
        { ok: false, error: "OAuth callback URL is not configured." },
        503,
      );
    }
    try {
      if (catalogId.startsWith("registry-")) {
        try { await resolveRegistryBinding({ catalogId, url, transport }); }
        catch { throw new McpOAuthCatalogBindingError(); }
      } else assertMcpOAuthCatalogBinding({ catalogId, url, transport });
    } catch (error) {
      if (error instanceof McpOAuthCatalogBindingError) {
        return json({ ok: false, error: error.message }, 400);
      }
      throw error;
    }

    let expectedConfigRevision: number | undefined;
    if (connectionId) {
      const existing = await getConvexClient().query(
        api.mcpServers.getForBackend,
        { serviceKey, userId, id: connectionId as never },
      );
      if (!existing) {
        return json({ ok: false, error: "Plugin connection not found." }, 404);
      }
      expectedConfigRevision = existing.configRevision;
    }

    const state = randomBytes(32).toString("base64url");
    const provider = new PersistedMcpOAuthProvider({ redirectUrl, state });
    const safeFetch = createSafeMcpFetch({
      allowLocalDevelopment: isLocalMcpDevelopmentEnabled(),
    });
    const authResult = await withAbortableTimeout(
      (signal) =>
        authorizeMcpOAuth(provider, {
          serverUrl: url,
          fetchFn: (input, init) => safeFetch(input, { ...init, signal }),
        }),
      OAUTH_START_TIMEOUT_MS,
      `MCP OAuth start (${name})`,
    );
    if (authResult !== "REDIRECT") {
      return json(
        { ok: false, error: "OAuth provider did not request authorization." },
        422,
      );
    }

    const authorizationUrl = validateMcpOAuthAuthorizationUrl(
      provider.authorizationUrl(),
      state,
    );
    const pending = provider.pendingSession({
      catalogId,
      connectionId,
      expectedConfigRevision,
      name,
      url,
      transport,
    });
    const encryptedState = encryptMcpSecretPayload(pending, {
      userId,
      url: MCP_OAUTH_SESSION_BINDING,
      purpose: "oauth-session",
    });
    const stateHash = createHash("sha256").update(state).digest("hex");
    const stored = await getConvexClient().mutation(
      api.mcpServers.createOAuthSessionForBackend,
      {
        serviceKey,
        userId,
        stateHash,
        encryptedState,
        expiresAt: Date.now() + OAUTH_SESSION_TTL_MS,
      },
    );
    if (!stored.success) {
      return json(
        {
          ok: false,
          error: stored.error ?? "OAuth authorization could not start.",
        },
        429,
      );
    }

    return json({ ok: true, authorizationUrl });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      return json({ ok: false, error: error.message }, error.statusCode);
    }
    if (error instanceof McpRequestPolicyError) {
      return json({ ok: false, error: error.message }, error.status);
    }
    if (error instanceof McpCredentialVaultUnavailableError) {
      return json(
        {
          ok: false,
          error: "Secure plugin credential storage is unavailable.",
        },
        503,
      );
    }
    console.error({
      timestamp: new Date().toISOString(),
      level: "error",
      event: "mcp_oauth_start_failed",
      service: "rift",
      environment: process.env.NODE_ENV ?? "unknown",
      error_name: error instanceof Error ? error.name : "UnknownError",
    });
    return json(
      { ok: false, error: "OAuth authorization could not start." },
      422,
    );
  }
}
