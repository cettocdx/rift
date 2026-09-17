import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { dynamicTool, jsonSchema, type ToolSet } from "ai";
import { normalizeMcpRootSchema } from "./mcp-tool-schema";

import {
  createSafeMcpFetch,
  isLocalMcpDevelopmentEnabled,
} from "./mcp-url-policy";
import { withAbortableTimeout } from "./mcp-timeout";
import { canonicalizeMcpUrl } from "./mcp-url-validation";
import { isMcpToolReadOnlyForPlan } from "./mcp-plan-policy";
import { hasGithubMcpCredentialReference } from "./github-mcp-credentials";
import { assertKnownMcpConfiguration } from "./mcp-configuration";

/**
 * MCP (Model Context Protocol) client layer.
 *
 * Connects to a single remote MCP server, lists its tools, and converts each
 * into an AI-SDK `dynamicTool` so it can be merged straight into the agent's
 * tool set. The model calls the tool by a namespaced key; `execute` forwards
 * the call to the live MCP server over the open transport.
 *
 * Everything here is defensive: a server that is slow, unreachable, or returns
 * a malformed tool list must never break the core agent. Connect failures
 * resolve to `null`; missing known credentials reject with a safe configuration
 * error. Per-call transport failures return an explicit unconfirmed outcome.
 */

export interface McpServerConfig {
  /** Convex row id — used to keep tool namespaces unique across servers. */
  id: string;
  /** Human name, used to build the readable part of the tool namespace. */
  name: string;
  url: string;
  transport: "http" | "sse";
  headers?: Array<{ key: string; value: string }>;
  /** Backend-only resolver; re-read managed credentials before every HTTP request. */
  resolveHeaders?: () => Promise<Array<{ key: string; value: string }>>;
  /** OAuth provider backed by an encrypted persisted token snapshot. */
  authProvider?: OAuthClientProvider;
  /**
   * Server-captured eligibility before run registry/discovery awaits. False
   * cannot be expanded by a later process flag; true still requires current
   * development opt-in at connection. Omitted by direct API callers, which
   * use current connection-time policy. Never map this from request JSON.
   */
  localDevelopmentAtAdmission?: boolean;
}

export interface McpConnection {
  serverId: string;
  serverName: string;
  /** Tools exposed by this server, already namespaced + AI-SDK-ready. */
  tools: ToolSet;
  /**
   * Subset eligible for Build Plan mode based on server annotations. Tools
   * fail closed unless explicitly marked read-only and not destructive.
   */
  planReadOnlyTools: ToolSet;
  toolNames: string[];
  /** Close the underlying transport. Safe to call more than once. */
  close: () => Promise<void>;
}

/** Connect timeout (initialize handshake) and per-call timeout. */
const CONNECT_TIMEOUT_MS = 12_000;
const CALL_TIMEOUT_MS = 90_000;
const MAX_TOOL_PAGES = 16;
const MAX_TOOLS_PER_SERVER = 256;
const MAX_TOOL_NAME_LENGTH = 128;
const MAX_TOOL_DESCRIPTION_CHARS = 4_000;
const MAX_TOOL_SCHEMA_BYTES = 64 * 1024;
const MAX_TOOL_SCHEMA_DEPTH = 32;
const MAX_RESULT_PARTS = 32;
const MAX_TEXT_RESULT_CHARS = 256 * 1024;
const MAX_STRUCTURED_RESULT_BYTES = 128 * 1024;
const MAX_INLINE_BINARY_CHARS = 128 * 1024;
const MAX_NORMALIZED_RESULT_BYTES = 512 * 1024;

/** AI SDK's jsonSchema() input type, without pulling in @types/json-schema. */
type FlexibleJsonSchema = Parameters<typeof jsonSchema>[0];

/**
 * Turn a server name into a short, tool-name-safe slug. Tool keys sent to the
 * model must match a conservative `[a-zA-Z0-9_-]` charset, so anything else is
 * collapsed to underscores.
 */
function slugify(name: string, fallback: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return slug || fallback;
}

function headersToRecord(
  headers?: Array<{ key: string; value: string }>,
): Record<string, string> | undefined {
  if (!headers || headers.length === 0) return undefined;
  const record: Record<string, string> = {};
  for (const { key, value } of headers) {
    if (key) record[key] = value;
  }
  return Object.keys(record).length > 0 ? record : undefined;
}

function jsonSizeWithinBudget(
  value: unknown,
  maxBytes: number,
  maxDepth = 64,
): boolean {
  const seen = new WeakSet<object>();
  let nodes = 0;
  const visit = (candidate: unknown, depth: number): boolean => {
    if (depth > maxDepth || ++nodes > 20_000) return false;
    if (!candidate || typeof candidate !== "object") return true;
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      return candidate.every((entry) => visit(entry, depth + 1));
    }
    return Object.values(candidate).every((entry) => visit(entry, depth + 1));
  };
  if (!visit(value, 0)) return false;
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= maxBytes;
  } catch {
    return false;
  }
}

function boundedStructuredContent(value: unknown): unknown {
  if (jsonSizeWithinBudget(value, MAX_STRUCTURED_RESULT_BYTES)) return value;
  let preview = "";
  try {
    preview = JSON.stringify(value).slice(0, 16_384);
  } catch {
    preview = "[unserializable structured content]";
  }
  return { truncated: true, preview };
}

function boundedText(value: string, remaining: number): string {
  return value.length <= remaining
    ? value
    : `${value.slice(0, Math.max(0, remaining))}\n[truncated]`;
}

/** Preserve structured and rich MCP results while applying model-context budgets. */
export function normalizeMcpToolResultForModel(result: {
  isError?: boolean;
  content?: Array<Record<string, unknown>>;
  structuredContent?: unknown;
}): unknown {
  const sourceParts = Array.isArray(result.content) ? result.content : [];
  const normalizedParts: Array<Record<string, unknown>> = [];
  let textBudget = MAX_TEXT_RESULT_CHARS;
  let hasRichContent = false;

  for (const part of sourceParts.slice(0, MAX_RESULT_PARTS)) {
    const type = part?.type;
    if (type === "text" && typeof part.text === "string") {
      const text = boundedText(part.text, textBudget);
      textBudget = Math.max(0, textBudget - text.length);
      normalizedParts.push({ type: "text", text });
    } else if (type === "image" || type === "audio") {
      hasRichContent = true;
      const data = typeof part.data === "string" ? part.data : undefined;
      const mimeType =
        typeof part.mimeType === "string"
          ? part.mimeType.slice(0, 200)
          : undefined;
      normalizedParts.push({
        type,
        ...(mimeType ? { mimeType } : {}),
        ...(data && data.length <= MAX_INLINE_BINARY_CHARS
          ? { data }
          : data
            ? { omitted: true, encodedLength: data.length }
            : { omitted: true }),
      });
    } else if (type === "resource" || type === "resource_link") {
      hasRichContent = true;
      const resource =
        part.resource && typeof part.resource === "object"
          ? (part.resource as Record<string, unknown>)
          : undefined;
      const uri = resource?.uri ?? part.uri;
      const text = resource?.text;
      const blob = resource?.blob;
      const resourceText =
        typeof text === "string" ? boundedText(text, textBudget) : undefined;
      if (resourceText !== undefined) {
        textBudget = Math.max(0, textBudget - resourceText.length);
      }
      normalizedParts.push({
        type,
        ...(typeof uri === "string" ? { uri: uri.slice(0, 4_096) } : {}),
        ...(typeof resource?.mimeType === "string"
          ? { mimeType: resource.mimeType.slice(0, 200) }
          : {}),
        ...(resourceText !== undefined ? { text: resourceText } : {}),
        ...(typeof blob === "string" && blob.length <= MAX_INLINE_BINARY_CHARS
          ? { blob }
          : typeof blob === "string"
            ? { blobOmitted: true, encodedLength: blob.length }
            : {}),
      });
    } else if (typeof part?.text === "string") {
      const text = boundedText(part.text, textBudget);
      textBudget = Math.max(0, textBudget - text.length);
      normalizedParts.push({ type: String(type ?? "text"), text });
    } else {
      hasRichContent = true;
      normalizedParts.push(
        jsonSizeWithinBudget(part, 16 * 1024, 12)
          ? part
          : { type: String(type ?? "unknown"), omitted: true },
      );
    }
  }
  if (sourceParts.length > MAX_RESULT_PARTS) {
    normalizedParts.push({
      type: "notice",
      text: `${sourceParts.length - MAX_RESULT_PARTS} additional result parts omitted`,
    });
  }

  const hasStructured = result.structuredContent !== undefined;
  if (!hasRichContent && !hasStructured && !result.isError) {
    const text = normalizedParts
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
    const output = text || "(tool returned no content)";
    return result.isError ? `Tool error: ${output}` : output;
  }

  const normalized: Record<string, unknown> = {
    isError: result.isError === true,
    content: normalizedParts,
    ...(hasStructured
      ? {
          structuredContent: boundedStructuredContent(result.structuredContent),
        }
      : {}),
  };
  if (!jsonSizeWithinBudget(normalized, MAX_NORMALIZED_RESULT_BYTES)) {
    return {
      isError: result.isError === true,
      content: normalizedParts.map((part) =>
        "data" in part || "blob" in part
          ? { ...part, data: undefined, blob: undefined, omitted: true }
          : part,
      ),
      structuredContent: hasStructured
        ? boundedStructuredContent(result.structuredContent)
        : undefined,
      truncated: true,
    };
  }
  return normalized;
}

type ListedMcpTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];

/** Read every bounded tools/list page under one connection-level deadline. */
export async function listMcpToolsPaginated(
  client: Pick<Client, "listTools">,
  signal: AbortSignal,
): Promise<ListedMcpTool[]> {
  const tools: ListedMcpTool[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
    const listed = await client.listTools(cursor ? { cursor } : undefined, {
      signal,
      timeout: CONNECT_TIMEOUT_MS + 1_000,
    });
    const pageTools = listed.tools ?? [];
    if (tools.length + pageTools.length > MAX_TOOLS_PER_SERVER) {
      throw new Error("MCP server exposed too many tools.");
    }
    tools.push(...pageTools);

    const nextCursor = listed.nextCursor;
    if (!nextCursor) return tools;
    if (nextCursor.length > 1_024 || seenCursors.has(nextCursor)) {
      throw new Error("MCP server returned an invalid tools cursor.");
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  throw new Error("MCP server exceeded the tools pagination limit.");
}

/**
 * Establish a transport + connect the client. Tries the configured transport
 * first, then falls back to the other one (modern Streamable HTTP ↔ legacy
 * SSE) since many servers only speak one.
 */
async function connectWithFallback(
  client: Client,
  config: McpServerConfig,
): Promise<void> {
  const allowLocalDevelopment =
    config.localDevelopmentAtAdmission !== false &&
    isLocalMcpDevelopmentEnabled();
  const url = new URL(
    canonicalizeMcpUrl(config.url, { allowLocalDevelopment }),
  );
  if (hasGithubMcpCredentialReference(config.headers))
    throw new Error("Unresolved GitHub credential reference.");
  const headers = config.resolveHeaders
    ? undefined
    : headersToRecord(config.headers);
  const requestInit = headers ? { headers } : undefined;
  const staticFetch = createSafeMcpFetch({
    allowLocalDevelopment,
    baseHeaders: headers,
    // Static user headers are origin-bound. With OAuth, the SDK also uses this
    // fetch for a separately discovered token endpoint; its generated client
    // authentication must be allowed on that initial, independently vetted
    // HTTPS target (redirects still strip sensitive headers).
    configuredUrl: headers ? url : undefined,
  });
  const safeFetch: typeof staticFetch = config.resolveHeaders
    ? async (input, init = {}) => {
        const currentHeaders = headersToRecord(await config.resolveHeaders!());
        const combined = new Headers(
          typeof Request !== "undefined" && input instanceof Request
            ? input.headers
            : undefined,
        );
        new Headers(init.headers).forEach((value, key) =>
          combined.set(key, value),
        );
        // A transport may reuse request defaults. Current managed credentials
        // always replace any earlier Authorization value before safe dispatch.
        new Headers(currentHeaders).forEach((value, key) =>
          combined.set(key, value),
        );
        return createSafeMcpFetch({
          allowLocalDevelopment,
          baseHeaders: currentHeaders,
          configuredUrl: url,
        })(input, { ...init, headers: combined });
      }
    : staticFetch;

  const makeHttp = () =>
    new StreamableHTTPClientTransport(url, {
      authProvider: config.authProvider,
      requestInit,
      fetch: safeFetch,
    });
  const makeSse = () =>
    new SSEClientTransport(url, {
      authProvider: config.authProvider,
      requestInit,
      fetch: safeFetch,
    });

  const order =
    config.transport === "sse" ? [makeSse, makeHttp] : [makeHttp, makeSse];

  let lastError: unknown;
  for (const make of order) {
    try {
      await withAbortableTimeout(
        (signal) =>
          client.connect(make(), {
            signal,
            // The outer deadline is registered first and performs transport
            // cleanup. Keep the SDK timer as a secondary safety net.
            timeout: CONNECT_TIMEOUT_MS + 1_000,
          }),
        CONNECT_TIMEOUT_MS,
        `MCP connect (${config.name})`,
        () => client.close(),
      );
      return;
    } catch (error) {
      lastError = error;
      try {
        await client.close();
      } catch {
        // A failed transport may already be closed; continue to the fallback.
      }
    }
  }
  throw lastError ?? new Error("Unable to connect to MCP server");
}

/**
 * Connect to one MCP server and return its tools (AI-SDK ready) + a close
 * handle. Returns `null` on any connection/listing failure so callers can skip
 * the server without aborting the agent.
 */
export async function connectMcpServer(
  config: McpServerConfig,
): Promise<McpConnection | null> {
  assertKnownMcpConfiguration(config);
  const client = new Client({ name: "rift", version: "1.0.0" });

  try {
    await connectWithFallback(client, config);

    const listedTools = await withAbortableTimeout(
      (signal) => listMcpToolsPaginated(client, signal),
      CONNECT_TIMEOUT_MS,
      `MCP listTools (${config.name})`,
      () => client.close(),
    );

    const serverSlug = slugify(config.name, `s${config.id.slice(-4)}`);
    const tools: ToolSet = {};
    const planReadOnlyTools: ToolSet = {};
    const toolNames: string[] = [];
    const usedKeys = new Set<string>();

    let skippedTools = 0;
    for (const mcpTool of listedTools) {
      const originalName = mcpTool.name;
      // Providers (xAI most strictly) reject a tool whose root schema is not a
      // plain object. Flatten union roots here so one connector's schema can
      // never fail the whole run — see mcp-tool-schema.ts.
      const inputSchema = normalizeMcpRootSchema(
        mcpTool.inputSchema,
      ) as FlexibleJsonSchema;
      if (
        !originalName ||
        originalName.length > MAX_TOOL_NAME_LENGTH ||
        !inputSchema ||
        typeof inputSchema !== "object" ||
        Array.isArray(inputSchema) ||
        !jsonSizeWithinBudget(
          inputSchema,
          MAX_TOOL_SCHEMA_BYTES,
          MAX_TOOL_SCHEMA_DEPTH,
        )
      ) {
        skippedTools += 1;
        continue;
      }

      // Namespaced key the model sees, e.g. "mcp_deepwiki_ask_question".
      const safeName = originalName.replace(/[^a-zA-Z0-9_-]+/g, "_");
      let key = `mcp_${serverSlug}_${safeName}`.slice(0, 60);
      // Guard against (rare) collisions within a server.
      let suffix = 1;
      while (usedKeys.has(key)) {
        key = `${`mcp_${serverSlug}_${safeName}`.slice(0, 56)}_${suffix++}`;
      }
      usedKeys.add(key);
      toolNames.push(key);

      const convertedTool = dynamicTool({
        description:
          mcpTool.description?.slice(0, MAX_TOOL_DESCRIPTION_CHARS) ??
          `${originalName} (via MCP server "${config.name}")`,
        inputSchema: jsonSchema(inputSchema),
        execute: async (args) => {
          try {
            const result = await withAbortableTimeout(
              (signal) =>
                client.callTool(
                  {
                    name: originalName,
                    arguments: (args ?? {}) as Record<string, unknown>,
                  },
                  undefined,
                  {
                    signal,
                    timeout: CALL_TIMEOUT_MS + 1_000,
                    maxTotalTimeout: CALL_TIMEOUT_MS + 1_000,
                  },
                ),
              CALL_TIMEOUT_MS,
              `MCP call ${originalName}`,
              () => client.close(),
            );
            return normalizeMcpToolResultForModel(
              result as Parameters<typeof normalizeMcpToolResultForModel>[0],
            );
          } catch (error) {
            // Remote errors can echo request metadata/credentials. Only expose a
            // non-sensitive classification to the model and logs.
            return {
              isError: true,
              code: "mcp_call_unconfirmed",
              executionStatus: "unconfirmed",
              retrySafe: false,
              error:
                error instanceof Error && error.name === "McpTimeoutError"
                  ? "The connector timed out without a confirmed result. Check the remote state before repeating this action."
                  : "The connector did not return a confirmed result. Check the remote state before repeating this action. Use another available tool when appropriate.",
            };
          }
        },
      });
      tools[key] = convertedTool;
      if (isMcpToolReadOnlyForPlan(mcpTool.annotations)) {
        planReadOnlyTools[key] = convertedTool;
      }
    }

    if (skippedTools > 0) {
      console.warn({
        timestamp: new Date().toISOString(),
        level: "warn",
        event: "mcp_tools_skipped",
        service: "rift",
        environment: process.env.NODE_ENV ?? "unknown",
        server_name: config.name,
        skipped_tool_count: skippedTools,
      });
    }

    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      try {
        await client.close();
      } catch {
        // Best-effort — the transport may already be gone.
      }
    };

    return {
      serverId: config.id,
      serverName: config.name,
      tools,
      planReadOnlyTools,
      toolNames,
      close,
    };
  } catch (error) {
    try {
      await client.close();
    } catch {
      // ignore
    }
    // Transport errors can contain serialized request metadata. Never emit the
    // raw message because configured headers may include bearer credentials.
    console.warn({
      timestamp: new Date().toISOString(),
      level: "warn",
      event: "mcp_connection_failed",
      service: "rift",
      environment: process.env.NODE_ENV ?? "unknown",
      server_name: config.name,
      error_name: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  }
}
