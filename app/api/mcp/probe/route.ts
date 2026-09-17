import { NextResponse, type NextRequest } from "next/server";

import {
  McpAuthValidationError,
  normalizeMcpAuth,
} from "@/lib/ai/mcp/mcp-auth";
import { connectMcpServer } from "@/lib/ai/mcp/mcp-client";
import { McpConfigurationError } from "@/lib/ai/mcp/mcp-configuration";
import {
  assertSameOriginMcpMutation,
  McpRequestPolicyError,
} from "@/lib/ai/mcp/mcp-request-policy";
import { getUserID } from "@/lib/auth/get-user-id";
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

type ProbeBody = {
  name?: unknown;
  url?: unknown;
  transport?: unknown;
  auth?: unknown;
  token?: unknown;
};

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

/** Authenticated, read-only MCP handshake. Nothing is persisted. */
export async function POST(request: NextRequest) {
  let connection: Awaited<ReturnType<typeof connectMcpServer>> = null;
  try {
    assertSameOriginMcpMutation(request);
    await getUserID(request);
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

    let body: ProbeBody;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json({ ok: false, error: "Invalid JSON body." }, 400);
      }
      body = parsed as ProbeBody;
    } catch {
      return json({ ok: false, error: "Invalid JSON body." }, 400);
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!name || name.length > MAX_NAME_LENGTH) {
      return json({ ok: false, error: "Enter a valid server name." }, 400);
    }
    if (!url || url.length > MAX_URL_LENGTH) {
      return json({ ok: false, error: "Enter a valid MCP server URL." }, 400);
    }
    if (
      body.transport !== undefined &&
      body.transport !== "http" &&
      body.transport !== "sse"
    ) {
      return json({ ok: false, error: "Enter a valid MCP transport." }, 400);
    }
    if (body.auth !== undefined && body.token !== undefined) {
      return json(
        { ok: false, error: "Use either auth or the legacy token field." },
        400,
      );
    }
    let auth;
    try {
      auth = normalizeMcpAuth(body.auth, body.token);
    } catch (error) {
      if (error instanceof McpAuthValidationError) {
        return json({ ok: false, error: error.message }, 400);
      }
      throw error;
    }

    connection = await connectMcpServer({
      id: crypto.randomUUID(),
      name,
      url,
      transport: body.transport === "sse" ? "sse" : "http",
      headers: auth.headers,
    });
    if (!connection || connection.toolNames.length === 0) {
      return json(
        {
          ok: false,
          error:
            "RIFT could not complete the MCP handshake. Check the endpoint and credentials.",
        },
        422,
      );
    }

    return json({
      ok: true,
      toolCount: connection.toolNames.length,
      toolNames: connection.toolNames,
      tools: connection.toolNames.slice(0, 12),
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
      event: "mcp_probe_failed",
      service: "rift",
      environment: process.env.NODE_ENV ?? "unknown",
      error_name: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ ok: false, error: "Plugin connection test failed." }, 500);
  } finally {
    await connection?.close().catch(() => undefined);
  }
}
