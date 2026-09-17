import { resolveRegistryBinding } from "@/lib/ai/mcp/registry/catalog";
import { NextResponse, type NextRequest } from "next/server";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  inferMcpAuthKindFromHeaders,
  McpAuthValidationError,
  normalizeMcpAuth,
  normalizeMcpHeaderName,
  type McpAuthKind,
} from "@/lib/ai/mcp/mcp-auth";
import { connectMcpServer } from "@/lib/ai/mcp/mcp-client";
import { McpConfigurationError } from "@/lib/ai/mcp/mcp-configuration";
import { createGithubMcpHeaderResolver } from "@/lib/ai/mcp/github-mcp-credentials";
import { createGithubTokenLoader } from "@/lib/github/load-user-github-token";
import {
  McpCatalogBindingError,
  resolveMcpCatalogIdForConnection,
} from "@/lib/ai/mcp/mcp-oauth-catalog";
import {
  McpCredentialVaultUnavailableError,
  decryptMcpCredentials,
  encryptMcpCredentials,
} from "@/lib/ai/mcp/mcp-credential-vault";
import type { EncryptedMcpCredentials } from "@/lib/ai/mcp/mcp-credential-types";
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

type RecheckBody = {
  id?: unknown;
  name?: unknown;
  url?: unknown;
  transport?: unknown;
  auth?: unknown;
  /** @deprecated Use `auth`. */
  token?: unknown;
};

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

function authKind(value: unknown): McpAuthKind | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "none" || kind === "bearer" || kind === "api_key_header"
    ? kind
    : null;
}

function hasFreshSecret(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { secret?: unknown }).secret === "string" &&
    (value as { secret: string }).secret.trim(),
  );
}

/** Recheck or safely edit one owned MCP connection after a real handshake. */
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

    let body: RecheckBody;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json({ ok: false, error: "Invalid JSON body." }, 400);
      }
      body = parsed as RecheckBody;
    } catch {
      return json({ ok: false, error: "Invalid JSON body." }, 400);
    }

    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id || id.length > 200) {
      return json({ ok: false, error: "Enter a valid connection id." }, 400);
    }
    if (body.auth !== undefined && body.token !== undefined) {
      return json(
        { ok: false, error: "Use either auth or the legacy token field." },
        400,
      );
    }
    if (body.token !== undefined && typeof body.token !== "string") {
      return json({ ok: false, error: "Enter a valid plugin secret." }, 400);
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
    let legacyFreshAuth: ReturnType<typeof normalizeMcpAuth> | undefined;
    if (body.token !== undefined) {
      try {
        legacyFreshAuth = normalizeMcpAuth(undefined, body.token);
      } catch (error) {
        if (error instanceof McpAuthValidationError) {
          return json({ ok: false, error: error.message }, 400);
        }
        throw error;
      }
    }
    if (
      body.transport !== undefined &&
      body.transport !== "http" &&
      body.transport !== "sse"
    ) {
      return json({ ok: false, error: "Enter a valid MCP transport." }, 400);
    }
    if (body.name !== undefined && typeof body.name !== "string") {
      return json({ ok: false, error: "Enter a valid server name." }, 400);
    }
    if (body.url !== undefined && typeof body.url !== "string") {
      return json({ ok: false, error: "Enter a valid MCP server URL." }, 400);
    }

    const convex = getConvexClient();
    const loadGithubToken = createGithubTokenLoader({
      client: convex,
      serviceKey,
    });
    const server = await convex.query(api.mcpServers.getForBackend, {
      serviceKey,
      userId,
      id: id as Id<"mcp_servers">,
    });
    if (!server) {
      return json({ ok: false, error: "Plugin connection not found." }, 404);
    }
    const expectedSnapshot = {
      expectedConfigRevision: server.configRevision,
      expectedUrl: server.url,
      expectedAuthKind: server.authKind,
    };

    const name =
      typeof body.name === "string" ? body.name.trim() : server.name.trim();
    if (!name || name.length > MAX_NAME_LENGTH) {
      return json({ ok: false, error: "Enter a valid server name." }, 400);
    }
    const rawUrl =
      typeof body.url === "string" ? body.url.trim() : server.url.trim();
    if (!rawUrl || rawUrl.length > MAX_URL_LENGTH) {
      return json({ ok: false, error: "Enter a valid MCP server URL." }, 400);
    }
    let url: string;
    try {
      url = canonicalizeMcpUrl(rawUrl, {
        allowLocalDevelopment: isLocalMcpDevelopmentEnabled(),
      });
    } catch {
      return json({ ok: false, error: "Enter a valid MCP server URL." }, 400);
    }
    const transport =
      body.transport === "http" || body.transport === "sse"
        ? body.transport
        : server.transport;

    let storedHeaders = server.headers;
    if (server.encryptedCredentials) {
      try {
        storedHeaders = decryptMcpCredentials(server.encryptedCredentials, {
          userId,
          url: server.url,
        });
      } catch (error) {
        await convex
          .mutation(api.mcpServers.recordConnectionHealthForBackend, {
            serviceKey,
            userId,
            id: server._id,
            ...expectedSnapshot,
            status: "needs_attention",
          })
          .catch(() => undefined);
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
          { ok: false, error: "Stored plugin credentials are unavailable." },
          500,
        );
      }
    }
    const storedAuthKind =
      (server.authKind as McpAuthKind | undefined) ??
      inferMcpAuthKindFromHeaders(storedHeaders);

    let candidateAuthKind = storedAuthKind;
    let candidateHeaders = storedHeaders;
    try {
      if (body.token !== undefined) {
        const fresh = legacyFreshAuth as ReturnType<typeof normalizeMcpAuth>;
        candidateAuthKind = fresh.kind;
        candidateHeaders = [
          ...(storedHeaders ?? []).filter(
            (header) => header.key.toLowerCase() !== "authorization",
          ),
          ...(fresh.headers ?? []),
        ];
      } else if (body.auth !== undefined) {
        const requestedKind = authKind(body.auth);
        if (!requestedKind) {
          throw new McpAuthValidationError(
            "Enter a valid plugin authentication method.",
          );
        }
        if (requestedKind === "none") {
          const normalized = normalizeMcpAuth(body.auth);
          candidateAuthKind = normalized.kind;
          candidateHeaders = undefined;
        } else if (hasFreshSecret(body.auth)) {
          const normalized = normalizeMcpAuth(body.auth);
          candidateAuthKind = normalized.kind;
          candidateHeaders = normalized.headers;
        } else {
          if (requestedKind !== storedAuthKind || !storedHeaders?.length) {
            throw new McpAuthValidationError("Enter a valid plugin secret.");
          }
          if (requestedKind === "api_key_header") {
            const supplied = (body.auth as { headerName?: unknown }).headerName;
            if (supplied !== undefined) {
              const expected = normalizeMcpHeaderName(supplied).toLowerCase();
              if (
                storedHeaders.length !== 1 ||
                storedHeaders[0].key.toLowerCase() !== expected
              ) {
                throw new McpAuthValidationError(
                  "Enter the secret for the new API key header.",
                );
              }
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof McpAuthValidationError) {
        return json({ ok: false, error: error.message }, 400);
      }
      throw error;
    }

    let encryptedCandidate: EncryptedMcpCredentials | undefined;
    if (candidateHeaders?.length) {
      try {
        encryptedCandidate = encryptMcpCredentials(candidateHeaders, {
          userId,
          url,
        });
      } catch (error) {
        return json(
          {
            ok: false,
            error:
              error instanceof McpCredentialVaultUnavailableError
                ? "Secure plugin credential storage is unavailable."
                : "Plugin credentials could not be secured.",
          },
          error instanceof McpCredentialVaultUnavailableError ? 503 : 500,
        );
      }
    }

    try {
      const resolveHeaders = createGithubMcpHeaderResolver(
        { url, authKind: candidateAuthKind, headers: candidateHeaders },
        () => loadGithubToken(userId),
      );
      connection = await connectMcpServer({
        id: String(server._id),
        name,
        url,
        transport,
        headers: resolveHeaders ? undefined : candidateHeaders,
        resolveHeaders,
      });
    } catch {
      await convex
        .mutation(api.mcpServers.recordConnectionHealthForBackend, {
          serviceKey,
          userId,
          id: server._id,
          ...expectedSnapshot,
          status: "needs_attention",
        })
        .catch(() => undefined);
      console.error({
        timestamp: new Date().toISOString(),
        level: "error",
        event: "mcp_recheck_failed",
        service: "rift",
        environment: process.env.NODE_ENV ?? "unknown",
        failure_stage: "handshake",
      });
      return json({ ok: false, error: "Plugin verification failed." }, 500);
    }

    if (!connection || connection.toolNames.length === 0) {
      await convex.mutation(api.mcpServers.recordConnectionHealthForBackend, {
        serviceKey,
        userId,
        id: server._id,
        ...expectedSnapshot,
        status: "needs_attention",
      });
      return json(
        {
          ok: false,
          error:
            "This plugin could not authenticate. Update its credentials and try again.",
        },
        422,
      );
    }

    let verifiedCatalogId: string | undefined;
    try {
      if (server.catalogId?.startsWith("registry-")) {
        try {
          await resolveRegistryBinding({
            catalogId: server.catalogId,
            url,
            transport,
          });
        } catch {
          throw new McpCatalogBindingError();
        }
        verifiedCatalogId = server.catalogId;
      } else
        verifiedCatalogId = resolveMcpCatalogIdForConnection({
          catalogId: server.catalogId,
          url,
          transport,
          authKind: candidateAuthKind,
        });
    } catch (error) {
      // Unknown identities from legacy rows are safely converted to custom
      // endpoints on the next verified edit.
      if (!(error instanceof McpCatalogBindingError)) throw error;
      verifiedCatalogId = undefined;
    }

    const updated = await convex.mutation(
      api.mcpServers.updateVerifiedServerForBackend,
      {
        serviceKey,
        userId,
        id: server._id,
        expectedConfigRevision: server.configRevision,
        catalogId: verifiedCatalogId,
        name,
        url,
        transport,
        authKind: candidateAuthKind,
        encryptedCredentials: encryptedCandidate,
        credentialHeaderKeys:
          candidateHeaders?.map((header) => header.key) ?? [],
        toolCount: connection.toolNames.length,
        toolNames: connection.toolNames,
      },
    );
    if (!updated.success) {
      return json(
        { ok: false, error: updated.error ?? "Plugin could not be updated." },
        ("stale" in updated && updated.stale) ||
          updated.error?.includes("already connected")
          ? 409
          : 422,
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
      event: "mcp_recheck_failed",
      service: "rift",
      environment: process.env.NODE_ENV ?? "unknown",
      error_name: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ ok: false, error: "Plugin verification failed." }, 500);
  } finally {
    await connection?.close().catch(() => undefined);
  }
}
