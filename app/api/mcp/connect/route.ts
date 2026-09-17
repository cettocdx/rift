import { resolveRegistryBinding } from "@/lib/ai/mcp/registry/catalog";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { api } from "@/convex/_generated/api";
import {
  McpAuthValidationError,
  normalizeMcpAuth,
} from "@/lib/ai/mcp/mcp-auth";
import { connectMcpServer } from "@/lib/ai/mcp/mcp-client";
import { McpConfigurationError } from "@/lib/ai/mcp/mcp-configuration";
import {
  McpCatalogBindingError,
  resolveMcpCatalogIdForConnection,
} from "@/lib/ai/mcp/mcp-oauth-catalog";
import {
  McpCredentialVaultUnavailableError,
  encryptMcpCredentials,
} from "@/lib/ai/mcp/mcp-credential-vault";
import {
  assertSameOriginMcpMutation,
  McpRequestPolicyError,
} from "@/lib/ai/mcp/mcp-request-policy";
import { isLocalMcpDevelopmentEnabled } from "@/lib/ai/mcp/mcp-url-policy";
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
const MAX_TOKEN_LENGTH = 16_384;
const MAX_CATALOG_ID_LENGTH = 120;

type ConnectBody = {
  catalogId?: unknown;
  name?: unknown;
  url?: unknown;
  transport?: unknown;
  auth?: unknown;
  /** @deprecated Use `auth: { kind: "bearer", secret }`. */
  token?: unknown;
};

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

/** Verify the exact endpoint/auth candidate, then persist it atomically. */
export async function POST(request: NextRequest) {
  let connection: Awaited<ReturnType<typeof connectMcpServer>> = null;

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

    let body: ConnectBody;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json({ ok: false, error: "Invalid JSON body." }, 400);
      }
      body = parsed as ConnectBody;
    } catch {
      return json({ ok: false, error: "Invalid JSON body." }, 400);
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
    const catalogId =
      typeof body.catalogId === "string" ? body.catalogId.trim() : undefined;

    if (!name || name.length > MAX_NAME_LENGTH) {
      return json({ ok: false, error: "Enter a valid server name." }, 400);
    }
    if (!rawUrl || rawUrl.length > MAX_URL_LENGTH) {
      return json({ ok: false, error: "Enter a valid MCP server URL." }, 400);
    }
    if (
      catalogId !== undefined &&
      (!catalogId ||
        catalogId.length > MAX_CATALOG_ID_LENGTH ||
        !/^[a-z0-9][a-z0-9._-]*$/i.test(catalogId))
    ) {
      return json(
        { ok: false, error: "Enter a valid catalog plugin id." },
        400,
      );
    }
    if (
      body.transport !== undefined &&
      body.transport !== "http" &&
      body.transport !== "sse"
    ) {
      return json({ ok: false, error: "Enter a valid MCP transport." }, 400);
    }
    const transport = body.transport === "sse" ? "sse" : "http";

    if (body.auth !== undefined && body.token !== undefined) {
      return json(
        { ok: false, error: "Use either auth or the legacy token field." },
        400,
      );
    }
    if (
      typeof body.token === "string" &&
      body.token.length > MAX_TOKEN_LENGTH
    ) {
      return json(
        { ok: false, error: "Authentication token is too large." },
        400,
      );
    }
    let normalizedAuth;
    try {
      normalizedAuth = normalizeMcpAuth(body.auth, body.token);
    } catch (error) {
      if (error instanceof McpAuthValidationError) {
        return json({ ok: false, error: error.message }, 400);
      }
      throw error;
    }

    let url: string;
    try {
      url = canonicalizeMcpUrl(rawUrl, {
        allowLocalDevelopment: isLocalMcpDevelopmentEnabled(),
      });
    } catch {
      return json({ ok: false, error: "Enter a valid MCP server URL." }, 400);
    }

    let verifiedCatalogId: string | undefined;
    try {
      if (catalogId?.startsWith("registry-")) {
        try {
          await resolveRegistryBinding({
            catalogId: catalogId,
            url,
            transport,
          });
        } catch {
          throw new McpCatalogBindingError();
        }
        verifiedCatalogId = catalogId;
      } else
        verifiedCatalogId = resolveMcpCatalogIdForConnection({
          catalogId,
          url,
          transport,
          authKind: normalizedAuth.kind,
        });
    } catch (error) {
      if (error instanceof McpCatalogBindingError) {
        return json({ ok: false, error: error.message }, 400);
      }
      throw error;
    }

    const headers = normalizedAuth.headers;
    let encryptedCredentials;
    if (headers) {
      try {
        encryptedCredentials = encryptMcpCredentials(headers, { userId, url });
      } catch (error) {
        if (error instanceof McpCredentialVaultUnavailableError) {
          return json(
            {
              ok: false,
              error: "Secure plugin credential storage is unavailable.",
            },
            503,
          );
        }
        return json(
          { ok: false, error: "Authentication credentials are invalid." },
          400,
        );
      }
    }

    connection = await connectMcpServer({
      id: randomUUID(),
      name,
      url,
      transport,
      headers,
    });
    if (!connection || connection.toolNames.length === 0) {
      return json(
        {
          ok: false,
          error: "RIFT could not verify any usable tools from this MCP server.",
        },
        422,
      );
    }

    const result = await getConvexClient().mutation(
      api.mcpServers.addVerifiedServerForBackend,
      {
        serviceKey,
        userId,
        catalogId: verifiedCatalogId,
        name,
        url,
        transport,
        authKind: normalizedAuth.kind,
        encryptedCredentials,
        credentialHeaderKeys: headers?.map((header) => header.key),
        toolCount: connection.toolNames.length,
        toolNames: connection.toolNames,
      },
    );
    if (!result.success) {
      return json(
        { ok: false, error: result.error ?? "Plugin could not be saved." },
        result.error?.includes("already connected") ? 409 : 422,
      );
    }

    return json({
      ok: true,
      toolCount: connection.toolNames.length,
      toolNames: connection.toolNames,
    });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      return json(
        {
          ok: false,
          error: error.message,
          code: `${error.type}:${error.surface}`,
          message: error.message,
          cause: error.cause,
        },
        error.statusCode,
      );
    }
    if (error instanceof McpRequestPolicyError) {
      return json({ ok: false, error: error.message }, error.status);
    }
    if (error instanceof McpConfigurationError) {
      return json({ ok: false, code: error.code, error: error.message }, 422);
    }
    console.error({
      timestamp: new Date().toISOString(),
      level: "error",
      event: "mcp_connection_failed",
      service: "rift",
      environment: process.env.NODE_ENV ?? "unknown",
      error_name: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ ok: false, error: "Plugin connection failed." }, 500);
  } finally {
    await connection?.close().catch(() => undefined);
  }
}
