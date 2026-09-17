import { internalMutation, mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { validateServiceKey } from "./lib/utils";
import { hasMissingKnownMcpCredentials } from "../lib/ai/mcp/mcp-configuration";
import {
  canonicalizeMcpUrl,
  McpUrlValidationError,
} from "../lib/ai/mcp/mcp-url-validation";

/**
 * MCP (Model Context Protocol) server registry.
 *
 * Each row is one remote MCP endpoint a user has connected. At request time the
 * backend reads the user's *enabled* servers (via the service-key query below),
 * connects to each, and merges their tools into the agent tool set
 * (see lib/ai/mcp/*).
 *
 * SECURITY NOTES
 * - New credentials are opaque AES-GCM envelopes. `headers` is retained only
 *   for backward-compatible migration of existing rows. User-facing queries
 *   NEVER return either ciphertext or legacy values; only safe header names
 *   and a `hasAuth` flag leave the trusted backend boundary.
 * - All user-facing mutations/queries scope strictly by the authenticated
 *   user id; ownership is re-checked on every write.
 * - URLs are canonicalized here, then DNS/IP/redirect policy is re-applied at
 *   connection time immediately before the runtime opens a pinned socket.
 */

const MAX_SERVERS_PER_USER = 20;
const MAX_HEADERS = 16;
const MAX_NAME_LENGTH = 80;
const MAX_USER_ID_LENGTH = 200;
const MAX_HEADER_KEY_LENGTH = 128;
const MAX_CIPHERTEXT_LENGTH = 400_000;
const MAX_ENVELOPE_PART_LENGTH = 128;
const MAX_CATALOG_ID_LENGTH = 120;
const MAX_TOOL_COUNT = 256;
const MAX_TOOL_NAME_LENGTH = 128;
const MAX_OAUTH_SCOPES = 64;
const MAX_OAUTH_SCOPE_LENGTH = 200;
const MAX_OAUTH_SESSIONS_PER_USER = 10;
const MAX_OAUTH_SESSION_TTL_MS = 15 * 60_000;
const INITIAL_CONFIG_REVISION = 1;

const authKindValidator = v.union(
  v.literal("none"),
  v.literal("bearer"),
  v.literal("api_key_header"),
  v.literal("oauth"),
);

type PersistedAuthKind = "none" | "bearer" | "api_key_header" | "oauth";

const encryptedCredentialsValidator = v.object({
  version: v.literal(1),
  algorithm: v.literal("aes-256-gcm"),
  keyVersion: v.string(),
  iv: v.string(),
  ciphertext: v.string(),
  authTag: v.string(),
});

type EncryptedCredentials = {
  version: 1;
  algorithm: "aes-256-gcm";
  keyVersion: string;
  iv: string;
  ciphertext: string;
  authTag: string;
};

function validHeaderKeys(keys: string[]): boolean {
  return (
    keys.length <= MAX_HEADERS &&
    keys.every(
      (key) =>
        key.length > 0 &&
        key.length <= MAX_HEADER_KEY_LENGTH &&
        /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(key),
    )
  );
}

function validEncryptedCredentials(value: EncryptedCredentials): boolean {
  return (
    /^[A-Za-z0-9._-]{1,64}$/.test(value.keyVersion) &&
    value.iv.length > 0 &&
    value.iv.length <= MAX_ENVELOPE_PART_LENGTH &&
    value.authTag.length > 0 &&
    value.authTag.length <= MAX_ENVELOPE_PART_LENGTH &&
    value.ciphertext.length > 0 &&
    value.ciphertext.length <= MAX_CIPHERTEXT_LENGTH
  );
}

function validCatalogId(value: string | undefined): boolean {
  return (
    value === undefined ||
    (value.length > 0 &&
      value.length <= MAX_CATALOG_ID_LENGTH &&
      /^[a-z0-9][a-z0-9._-]*$/i.test(value))
  );
}

function normalizeToolNames(values: string[] | undefined): string[] {
  if (!values) return [];
  const unique = new Set<string>();
  for (const raw of values) {
    const name = raw.trim();
    if (
      !name ||
      name.length > MAX_TOOL_NAME_LENGTH ||
      !/^[A-Za-z0-9_-]+$/.test(name)
    ) {
      throw new Error("Invalid tool metadata");
    }
    unique.add(name);
    if (unique.size > MAX_TOOL_COUNT) throw new Error("Invalid tool metadata");
  }
  return [...unique];
}

function normalizeOAuthScopes(values: string[] | undefined): string[] {
  if (!values) return [];
  const unique = new Set<string>();
  for (const raw of values) {
    const scope = raw.trim();
    if (
      !scope ||
      scope.length > MAX_OAUTH_SCOPE_LENGTH ||
      /[\u0000\r\n\s]/.test(scope)
    ) {
      throw new Error("Invalid OAuth metadata");
    }
    unique.add(scope);
    if (unique.size > MAX_OAUTH_SCOPES) {
      throw new Error("Invalid OAuth metadata");
    }
  }
  return [...unique];
}

function validOAuthExpiry(value: number | undefined): boolean {
  return value === undefined || (Number.isSafeInteger(value) && value > 0);
}

function validAuthenticationMaterial(args: {
  authKind: PersistedAuthKind;
  encryptedCredentials?: EncryptedCredentials;
  credentialHeaderKeys: string[];
  encryptedOAuthCredentials?: EncryptedCredentials;
}): boolean {
  if (!validHeaderKeys(args.credentialHeaderKeys)) return false;
  if (
    args.encryptedCredentials &&
    !validEncryptedCredentials(args.encryptedCredentials)
  ) {
    return false;
  }
  if (
    args.encryptedOAuthCredentials &&
    !validEncryptedCredentials(args.encryptedOAuthCredentials)
  ) {
    return false;
  }

  if (args.authKind === "none") {
    return (
      !args.encryptedCredentials &&
      !args.encryptedOAuthCredentials &&
      args.credentialHeaderKeys.length === 0
    );
  }
  if (args.authKind === "oauth") {
    return (
      Boolean(args.encryptedOAuthCredentials) &&
      !args.encryptedCredentials &&
      args.credentialHeaderKeys.length === 0
    );
  }
  return (
    Boolean(args.encryptedCredentials) &&
    !args.encryptedOAuthCredentials &&
    args.credentialHeaderKeys.length > 0
  );
}

function inferAuthKind(row: {
  auth_kind?: PersistedAuthKind;
  encrypted_credentials?: unknown;
  oauth_credentials?: unknown;
  credential_header_keys?: string[];
  headers?: Array<{ key: string }>;
}): PersistedAuthKind {
  if (row.auth_kind) return row.auth_kind;
  if (row.oauth_credentials) return "oauth";
  const keys = [
    ...(row.credential_header_keys ?? []),
    ...(row.headers ?? []).map((header) => header.key),
  ].map((key) => key.toLowerCase());
  if (keys.includes("authorization")) return "bearer";
  if (row.encrypted_credentials || keys.length > 0) return "api_key_header";
  return "none";
}

function configRevision(row: { config_revision?: number }): number {
  return Number.isSafeInteger(row.config_revision) &&
    (row.config_revision ?? 0) >= INITIAL_CONFIG_REVISION
    ? (row.config_revision as number)
    : INITIAL_CONFIG_REVISION;
}

function validExpectedConfigRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= INITIAL_CONFIG_REVISION;
}

function matchesRuntimeSnapshot(
  row: {
    config_revision?: number;
    url: string;
    auth_kind?: PersistedAuthKind;
    encrypted_credentials?: unknown;
    oauth_credentials?: unknown;
    credential_header_keys?: string[];
    headers?: Array<{ key: string }>;
  },
  expected: {
    expectedConfigRevision: number;
    expectedUrl: string;
    expectedAuthKind: PersistedAuthKind;
  },
): boolean {
  return (
    validExpectedConfigRevision(expected.expectedConfigRevision) &&
    configRevision(row) === expected.expectedConfigRevision &&
    row.url === expected.expectedUrl &&
    inferAuthKind(row) === expected.expectedAuthKind
  );
}

const staleConnectionResult = () => ({
  success: false as const,
  stale: true as const,
  error: "Plugin connection changed. Retry with the latest configuration.",
});

type PublicConnectionStatus = "verified" | "needs_attention" | "unknown";

function publicConnectionStatus(
  status: "verified" | "needs_attention" | undefined,
): PublicConnectionStatus {
  return status ?? "unknown";
}

function authedUserId(subject: string): string {
  // Mirror the convention used across the Convex layer (see notes.ts): the
  // identity subject is "<userId>|<sessionId>".
  return subject.split("|")[0];
}

function normalizeUrl(raw: string): string {
  const allowLocalDevelopment =
    process.env.NODE_ENV === "development" &&
    process.env.MCP_ALLOW_INSECURE_LOCALHOST === "true";

  try {
    const canonical = new URL(
      canonicalizeMcpUrl(raw, { allowLocalDevelopment }),
    );
    if (canonical.pathname.length > 1) {
      canonical.pathname = canonical.pathname.replace(/\/+$/, "");
    }
    return canonical.toString();
  } catch (error) {
    throw new ConvexError({
      code: "INVALID_URL",
      message:
        error instanceof McpUrlValidationError
          ? error.message
          : "MCP server URL is invalid.",
    });
  }
}

/**
 * List the calling user's MCP servers for the settings UI. Header *values* are
 * intentionally omitted; only the configured keys + a hasAuth flag are exposed.
 */
export const listForUser = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("mcp_servers"),
      catalogId: v.optional(v.string()),
      name: v.string(),
      url: v.string(),
      transport: v.union(v.literal("http"), v.literal("sse")),
      enabled: v.boolean(),
      hasAuth: v.boolean(),
      authKind: authKindValidator,
      headerKeys: v.array(v.string()),
      connectionStatus: v.union(
        v.literal("verified"),
        v.literal("needs_attention"),
        v.literal("unknown"),
      ),
      lastCheckedAt: v.optional(v.number()),
      toolCount: v.number(),
      toolNames: v.array(v.string()),
      oauthExpiresAt: v.optional(v.number()),
      oauthScopes: v.array(v.string()),
      configRevision: v.number(),
      created_at: v.number(),
      updated_at: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Unauthorized: User not authenticated",
      });
    }
    const userId = authedUserId(identity.subject);

    const rows = await ctx.db
      .query("mcp_servers")
      .withIndex("by_user", (q) => q.eq("user_id", userId))
      .order("desc")
      .collect();

    return rows.map((row) => ({
      _id: row._id,
      catalogId: row.catalog_id,
      name: row.name,
      url: row.url,
      transport: row.transport,
      enabled: row.enabled,
      hasAuth:
        Boolean(row.encrypted_credentials) ||
        Boolean(row.oauth_credentials) ||
        (row.headers?.length ?? 0) > 0,
      authKind: inferAuthKind(row),
      headerKeys:
        row.credential_header_keys ?? (row.headers ?? []).map((h) => h.key),
      connectionStatus: publicConnectionStatus(row.connection_status),
      lastCheckedAt: row.last_checked_at,
      toolCount: row.tool_count ?? row.tool_names?.length ?? 0,
      toolNames: row.tool_names ?? [],
      oauthExpiresAt: row.oauth_expires_at,
      oauthScopes: row.oauth_scopes ?? [],
      configRevision: configRevision(row),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  },
});

/**
 * Persist a server only after the authenticated Next.js connection endpoint
 * completed the real MCP handshake. This is intentionally service-key guarded:
 * clients cannot skip the probe by invoking a public Convex mutation directly.
 */
export const addVerifiedServerForBackend = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    name: v.string(),
    catalogId: v.optional(v.string()),
    url: v.string(),
    transport: v.optional(v.union(v.literal("http"), v.literal("sse"))),
    encryptedCredentials: v.optional(encryptedCredentialsValidator),
    encryptedOAuthCredentials: v.optional(encryptedCredentialsValidator),
    credentialHeaderKeys: v.optional(v.array(v.string())),
    authKind: v.optional(authKindValidator),
    oauthExpiresAt: v.optional(v.number()),
    oauthScopes: v.optional(v.array(v.string())),
    toolCount: v.optional(v.number()),
    toolNames: v.optional(v.array(v.string())),
  },
  returns: v.object({
    success: v.boolean(),
    id: v.optional(v.id("mcp_servers")),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const userId = args.userId.trim();
    if (!userId || userId.length > MAX_USER_ID_LENGTH) {
      return { success: false, error: "Invalid user" };
    }

    const name = args.name.trim();
    if (!name || name.length > MAX_NAME_LENGTH) {
      return { success: false, error: "Enter a valid server name" };
    }

    const catalogId = args.catalogId?.trim();
    if (!validCatalogId(catalogId)) {
      return { success: false, error: "Invalid catalog plugin" };
    }

    let url: string;
    try {
      url = normalizeUrl(args.url);
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof ConvexError
            ? String((error.data as { message?: string })?.message ?? error)
            : "Invalid URL",
      };
    }

    const credentialHeaderKeys = (args.credentialHeaderKeys ?? []).map((key) =>
      key.trim(),
    );
    const authKind =
      args.authKind ??
      (args.encryptedOAuthCredentials
        ? "oauth"
        : credentialHeaderKeys.some(
              (key) => key.toLowerCase() === "authorization",
            )
          ? "bearer"
          : credentialHeaderKeys.length > 0
            ? "api_key_header"
            : "none");
    if (
      !validAuthenticationMaterial({
        authKind,
        encryptedCredentials: args.encryptedCredentials,
        credentialHeaderKeys,
        encryptedOAuthCredentials: args.encryptedOAuthCredentials,
      }) ||
      !validOAuthExpiry(args.oauthExpiresAt)
    ) {
      return { success: false, error: "Invalid authentication metadata" };
    }
    let oauthScopes: string[];
    try {
      oauthScopes = normalizeOAuthScopes(args.oauthScopes);
    } catch {
      return { success: false, error: "Invalid OAuth metadata" };
    }
    if (
      authKind !== "oauth" &&
      (args.oauthExpiresAt !== undefined || oauthScopes.length > 0)
    ) {
      return { success: false, error: "Invalid OAuth metadata" };
    }
    let toolNames: string[];
    try {
      toolNames = normalizeToolNames(args.toolNames);
    } catch {
      return { success: false, error: "Invalid tool metadata" };
    }
    const toolCount = args.toolCount ?? toolNames.length;
    if (
      !Number.isSafeInteger(toolCount) ||
      toolCount < 1 ||
      toolCount > MAX_TOOL_COUNT ||
      toolNames.length > toolCount
    ) {
      return { success: false, error: "Invalid tool metadata" };
    }

    const existing = await ctx.db
      .query("mcp_servers")
      .withIndex("by_user", (q) => q.eq("user_id", userId))
      .collect();
    if (existing.length >= MAX_SERVERS_PER_USER) {
      return {
        success: false,
        error: `You can connect at most ${MAX_SERVERS_PER_USER} MCP servers.`,
      };
    }
    if (existing.some((server) => server.url === url)) {
      return { success: false, error: "This MCP server is already connected." };
    }

    const now = Date.now();
    const id = await ctx.db.insert("mcp_servers", {
      user_id: userId,
      catalog_id: catalogId,
      name,
      url,
      transport: args.transport ?? "http",
      auth_kind: authKind,
      encrypted_credentials: args.encryptedCredentials,
      oauth_credentials: args.encryptedOAuthCredentials,
      oauth_expires_at: args.oauthExpiresAt,
      oauth_scopes: oauthScopes.length > 0 ? oauthScopes : undefined,
      credential_header_keys:
        credentialHeaderKeys.length > 0 ? credentialHeaderKeys : undefined,
      connection_status: "verified",
      last_checked_at: now,
      tool_count: toolCount,
      tool_names: toolNames,
      config_revision: INITIAL_CONFIG_REVISION,
      enabled: true,
      created_at: now,
      updated_at: now,
    });

    return { success: true, id };
  },
});

/**
 * Backend-only health transition recorded after a real runtime handshake.
 * Error messages are intentionally excluded so credentials echoed by a remote
 * transport can never become persistent application data.
 */
export const recordConnectionHealthForBackend = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    id: v.id("mcp_servers"),
    expectedConfigRevision: v.number(),
    expectedUrl: v.string(),
    expectedAuthKind: authKindValidator,
    status: v.union(v.literal("verified"), v.literal("needs_attention")),
    toolCount: v.optional(v.number()),
    toolNames: v.optional(v.array(v.string())),
  },
  returns: v.object({
    success: v.boolean(),
    stale: v.optional(v.boolean()),
    error: v.optional(v.string()),
    configRevision: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const row = await ctx.db.get(args.id);
    if (!row || row.user_id !== args.userId) return { success: false };
    if (!matchesRuntimeSnapshot(row, args)) return staleConnectionResult();

    const now = Date.now();
    let toolPatch: { tool_count?: number; tool_names?: string[] } = {};
    if (args.toolCount !== undefined || args.toolNames !== undefined) {
      let toolNames: string[];
      try {
        toolNames = normalizeToolNames(args.toolNames);
      } catch {
        return { success: false };
      }
      const toolCount = args.toolCount ?? toolNames.length;
      if (
        args.status !== "verified" ||
        !Number.isSafeInteger(toolCount) ||
        toolCount < 1 ||
        toolCount > MAX_TOOL_COUNT ||
        toolNames.length > toolCount
      ) {
        return { success: false };
      }
      toolPatch = { tool_count: toolCount, tool_names: toolNames };
    }
    await ctx.db.patch(args.id, {
      connection_status: args.status,
      last_checked_at: now,
      updated_at: now,
      ...toolPatch,
    });
    return { success: true, configRevision: configRevision(row) };
  },
});

/**
 * Replace credentials only after the trusted backend has completed a real MCP
 * handshake with them. Keeping this separate from the public mutations makes
 * it impossible for a browser to store an unverified token directly.
 */
export const updateVerifiedCredentialsForBackend = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    id: v.id("mcp_servers"),
    expectedConfigRevision: v.number(),
    expectedUrl: v.string(),
    expectedAuthKind: v.union(v.literal("bearer"), v.literal("api_key_header")),
    encryptedCredentials: encryptedCredentialsValidator,
    credentialHeaderKeys: v.array(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    stale: v.optional(v.boolean()),
    error: v.optional(v.string()),
    configRevision: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const userId = args.userId.trim();
    if (!userId || userId.length > MAX_USER_ID_LENGTH) {
      return { success: false, error: "Invalid user" };
    }

    const row = await ctx.db.get(args.id);
    if (!row || row.user_id !== userId) {
      return { success: false, error: "Server not found" };
    }
    if (!matchesRuntimeSnapshot(row, args)) return staleConnectionResult();

    const credentialHeaderKeys = args.credentialHeaderKeys.map((key) =>
      key.trim(),
    );
    const migratedAuthKind = credentialHeaderKeys.some(
      (key) => key.toLowerCase() === "authorization",
    )
      ? "bearer"
      : "api_key_header";
    if (
      credentialHeaderKeys.length === 0 ||
      !validHeaderKeys(credentialHeaderKeys) ||
      !validEncryptedCredentials(args.encryptedCredentials) ||
      migratedAuthKind !== args.expectedAuthKind
    ) {
      return { success: false, error: "Invalid encrypted credentials" };
    }

    const now = Date.now();
    const nextConfigRevision = configRevision(row) + 1;
    await ctx.db.patch(args.id, {
      auth_kind: migratedAuthKind,
      encrypted_credentials: args.encryptedCredentials,
      credential_header_keys: credentialHeaderKeys,
      // Successful verification is the only migration point. Existing legacy
      // plaintext remains untouched until this exact patch succeeds.
      headers: undefined,
      connection_status: "verified",
      last_checked_at: now,
      config_revision: nextConfigRevision,
      updated_at: now,
    });
    return { success: true, configRevision: nextConfigRevision };
  },
});

/** Persist a rotated/refreshed OAuth token bundle without exposing it to UI. */
export const updateOAuthCredentialsForBackend = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    id: v.id("mcp_servers"),
    expectedConfigRevision: v.number(),
    expectedUrl: v.string(),
    expectedAuthKind: v.literal("oauth"),
    encryptedOAuthCredentials: encryptedCredentialsValidator,
    oauthExpiresAt: v.optional(v.number()),
    oauthScopes: v.optional(v.array(v.string())),
  },
  returns: v.object({
    success: v.boolean(),
    stale: v.optional(v.boolean()),
    error: v.optional(v.string()),
    configRevision: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const userId = args.userId.trim();
    if (!userId || userId.length > MAX_USER_ID_LENGTH) {
      return { success: false };
    }
    const row = await ctx.db.get(args.id);
    if (
      !row ||
      row.user_id !== userId ||
      !validEncryptedCredentials(args.encryptedOAuthCredentials) ||
      !validOAuthExpiry(args.oauthExpiresAt)
    ) {
      return { success: false };
    }
    if (!matchesRuntimeSnapshot(row, args)) return staleConnectionResult();
    let oauthScopes: string[];
    try {
      oauthScopes = normalizeOAuthScopes(args.oauthScopes);
    } catch {
      return { success: false };
    }
    const nextConfigRevision = configRevision(row) + 1;
    await ctx.db.patch(args.id, {
      auth_kind: "oauth",
      oauth_credentials: args.encryptedOAuthCredentials,
      oauth_expires_at: args.oauthExpiresAt,
      oauth_scopes: oauthScopes.length > 0 ? oauthScopes : undefined,
      config_revision: nextConfigRevision,
      updated_at: Date.now(),
    });
    return { success: true, configRevision: nextConfigRevision };
  },
});

/**
 * Atomically replace a verified connection's endpoint, authentication metadata,
 * and safe tool inventory. The route calls this only after probing the exact
 * candidate configuration, so an edit can never make an unverified endpoint
 * active between mutations.
 */
export const updateVerifiedServerForBackend = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    id: v.id("mcp_servers"),
    expectedConfigRevision: v.number(),
    catalogId: v.optional(v.string()),
    name: v.string(),
    url: v.string(),
    transport: v.union(v.literal("http"), v.literal("sse")),
    authKind: authKindValidator,
    encryptedCredentials: v.optional(encryptedCredentialsValidator),
    encryptedOAuthCredentials: v.optional(encryptedCredentialsValidator),
    credentialHeaderKeys: v.array(v.string()),
    oauthExpiresAt: v.optional(v.number()),
    oauthScopes: v.optional(v.array(v.string())),
    toolCount: v.number(),
    toolNames: v.array(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    stale: v.optional(v.boolean()),
    error: v.optional(v.string()),
    configRevision: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const userId = args.userId.trim();
    const name = args.name.trim();
    const catalogId = args.catalogId?.trim();
    if (!userId || userId.length > MAX_USER_ID_LENGTH) {
      return { success: false, error: "Invalid user" };
    }
    if (!name || name.length > MAX_NAME_LENGTH) {
      return { success: false, error: "Enter a valid server name" };
    }
    if (!validCatalogId(catalogId)) {
      return { success: false, error: "Invalid catalog plugin" };
    }
    const row = await ctx.db.get(args.id);
    if (!row || row.user_id !== userId) {
      return { success: false, error: "Server not found" };
    }
    if (
      !validExpectedConfigRevision(args.expectedConfigRevision) ||
      configRevision(row) !== args.expectedConfigRevision
    ) {
      return staleConnectionResult();
    }

    let url: string;
    try {
      url = normalizeUrl(args.url);
    } catch {
      return { success: false, error: "Invalid URL" };
    }
    const rows = await ctx.db
      .query("mcp_servers")
      .withIndex("by_user", (q) => q.eq("user_id", userId))
      .collect();
    if (rows.some((server) => server._id !== args.id && server.url === url)) {
      return { success: false, error: "This MCP server is already connected." };
    }

    const credentialHeaderKeys = args.credentialHeaderKeys.map((key) =>
      key.trim(),
    );
    if (
      !validAuthenticationMaterial({
        authKind: args.authKind,
        encryptedCredentials: args.encryptedCredentials,
        credentialHeaderKeys,
        encryptedOAuthCredentials: args.encryptedOAuthCredentials,
      }) ||
      !validOAuthExpiry(args.oauthExpiresAt)
    ) {
      return { success: false, error: "Invalid authentication metadata" };
    }
    let oauthScopes: string[];
    try {
      oauthScopes = normalizeOAuthScopes(args.oauthScopes);
    } catch {
      return { success: false, error: "Invalid OAuth metadata" };
    }
    if (
      args.authKind !== "oauth" &&
      (args.oauthExpiresAt !== undefined || oauthScopes.length > 0)
    ) {
      return { success: false, error: "Invalid OAuth metadata" };
    }

    let toolNames: string[];
    try {
      toolNames = normalizeToolNames(args.toolNames);
    } catch {
      return { success: false, error: "Invalid tool metadata" };
    }
    if (
      !Number.isSafeInteger(args.toolCount) ||
      args.toolCount < 1 ||
      args.toolCount > MAX_TOOL_COUNT ||
      toolNames.length > args.toolCount
    ) {
      return { success: false, error: "Invalid tool metadata" };
    }

    const now = Date.now();
    const nextConfigRevision = configRevision(row) + 1;
    await ctx.db.patch(args.id, {
      catalog_id: catalogId,
      name,
      url,
      transport: args.transport,
      auth_kind: args.authKind,
      encrypted_credentials: args.encryptedCredentials,
      oauth_credentials: args.encryptedOAuthCredentials,
      oauth_expires_at: args.oauthExpiresAt,
      oauth_scopes: oauthScopes.length > 0 ? oauthScopes : undefined,
      credential_header_keys:
        credentialHeaderKeys.length > 0 ? credentialHeaderKeys : undefined,
      headers: undefined,
      connection_status: "verified",
      last_checked_at: now,
      tool_count: args.toolCount,
      tool_names: toolNames,
      config_revision: nextConfigRevision,
      updated_at: now,
    });
    return { success: true, configRevision: nextConfigRevision };
  },
});

/** Fetch one persisted connection, including secrets, for a trusted recheck. */
/** Find a user's existing endpoint without returning any credentials. */
export const findEndpointForBackend = query({
  args: { serviceKey: v.string(), userId: v.string(), url: v.string() },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const url = normalizeUrl(args.url);
    const rows = await ctx.db
      .query("mcp_servers")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .collect();
    const row = rows.find((candidate) => candidate.url === url);
    return row ? { id: row._id, configRevision: configRevision(row) } : null;
  },
});

export const getForBackend = query({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    id: v.id("mcp_servers"),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("mcp_servers"),
      catalogId: v.optional(v.string()),
      name: v.string(),
      url: v.string(),
      transport: v.union(v.literal("http"), v.literal("sse")),
      headers: v.optional(
        v.array(v.object({ key: v.string(), value: v.string() })),
      ),
      encryptedCredentials: v.optional(encryptedCredentialsValidator),
      encryptedOAuthCredentials: v.optional(encryptedCredentialsValidator),
      credentialHeaderKeys: v.optional(v.array(v.string())),
      authKind: authKindValidator,
      oauthExpiresAt: v.optional(v.number()),
      oauthScopes: v.array(v.string()),
      toolCount: v.number(),
      toolNames: v.array(v.string()),
      configRevision: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const row = await ctx.db.get(args.id);
    if (!row || row.user_id !== args.userId) return null;
    return {
      _id: row._id,
      catalogId: row.catalog_id,
      name: row.name,
      url: row.url,
      transport: row.transport,
      headers: row.headers,
      encryptedCredentials: row.encrypted_credentials,
      encryptedOAuthCredentials: row.oauth_credentials,
      credentialHeaderKeys: row.credential_header_keys,
      authKind: inferAuthKind(row),
      oauthExpiresAt: row.oauth_expires_at,
      oauthScopes: row.oauth_scopes ?? [],
      toolCount: row.tool_count ?? row.tool_names?.length ?? 0,
      toolNames: row.tool_names ?? [],
      configRevision: configRevision(row),
    };
  },
});

/**
 * Enable / disable a server without deleting it.
 */
export const setServerEnabled = mutation({
  args: {
    id: v.id("mcp_servers"),
    enabled: v.boolean(),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Unauthorized: User not authenticated",
      });
    }
    const userId = authedUserId(identity.subject);

    const row = await ctx.db.get(args.id);
    if (!row) {
      return { success: false, error: "Server not found" };
    }
    if (row.user_id !== userId) {
      throw new ConvexError({
        code: "ACCESS_DENIED",
        message: "Access denied: You don't own this server",
      });
    }

    if (row.enabled !== args.enabled) {
      await ctx.db.patch(args.id, {
        enabled: args.enabled,
        config_revision: configRevision(row) + 1,
        updated_at: Date.now(),
      });
    }
    return { success: true };
  },
});

/**
 * Remove a server.
 */
export const removeServer = mutation({
  args: {
    id: v.id("mcp_servers"),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Unauthorized: User not authenticated",
      });
    }
    const userId = authedUserId(identity.subject);

    const row = await ctx.db.get(args.id);
    if (!row) {
      return { success: true }; // Idempotent.
    }
    if (row.user_id !== userId) {
      throw new ConvexError({
        code: "ACCESS_DENIED",
        message: "Access denied: You don't own this server",
      });
    }

    await ctx.db.delete(args.id);
    return { success: true };
  },
});

/** Store an encrypted, user-bound PKCE transaction for at most fifteen minutes. */
export const createOAuthSessionForBackend = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    stateHash: v.string(),
    encryptedState: encryptedCredentialsValidator,
    expiresAt: v.number(),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const userId = args.userId.trim();
    const stateHash = args.stateHash.trim().toLowerCase();
    const now = Date.now();
    if (
      !userId ||
      userId.length > MAX_USER_ID_LENGTH ||
      !/^[a-f0-9]{64}$/.test(stateHash) ||
      !validEncryptedCredentials(args.encryptedState) ||
      !Number.isSafeInteger(args.expiresAt) ||
      args.expiresAt <= now ||
      args.expiresAt > now + MAX_OAUTH_SESSION_TTL_MS
    ) {
      return { success: false, error: "Invalid OAuth session" };
    }

    const duplicate = await ctx.db
      .query("mcp_oauth_sessions")
      .withIndex("by_state_hash", (q) => q.eq("state_hash", stateHash))
      .first();
    if (duplicate) return { success: false, error: "Invalid OAuth session" };

    const sessions = await ctx.db
      .query("mcp_oauth_sessions")
      .withIndex("by_user", (q) => q.eq("user_id", userId))
      .collect();
    const active = [];
    for (const session of sessions) {
      if (session.expires_at <= now) {
        await ctx.db.delete(session._id);
      } else {
        active.push(session);
      }
    }
    if (active.length >= MAX_OAUTH_SESSIONS_PER_USER) {
      return {
        success: false,
        error: "Too many OAuth connections are already in progress",
      };
    }

    await ctx.db.insert("mcp_oauth_sessions", {
      user_id: userId,
      state_hash: stateHash,
      encrypted_state: args.encryptedState,
      expires_at: args.expiresAt,
      created_at: now,
    });
    return { success: true };
  },
});

/** Atomically consume a PKCE transaction before any code exchange occurs. */
export const consumeOAuthSessionForBackend = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    stateHash: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({ encryptedState: encryptedCredentialsValidator }),
  ),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const stateHash = args.stateHash.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(stateHash)) return null;

    const session = await ctx.db
      .query("mcp_oauth_sessions")
      .withIndex("by_state_hash", (q) => q.eq("state_hash", stateHash))
      .first();
    if (!session || session.user_id !== args.userId) return null;

    // Delete first within this mutation's transaction: replayed callbacks can
    // never race a second token exchange with the same state/code verifier.
    await ctx.db.delete(session._id);
    if (session.expires_at <= Date.now()) return null;
    return { encryptedState: session.encrypted_state };
  },
});

/** Delete one bounded page of abandoned OAuth/PKCE transactions. */
export const purgeExpiredOAuthSessions = internalMutation({
  args: {
    now: v.number(),
    limit: v.number(),
  },
  returns: v.object({ deletedCount: v.number() }),
  handler: async (ctx, args) => {
    if (!Number.isSafeInteger(args.now) || args.now < 0) {
      return { deletedCount: 0 };
    }
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit)));
    const sessions = await ctx.db
      .query("mcp_oauth_sessions")
      .withIndex("by_expiry", (q) => q.lte("expires_at", args.now))
      .take(limit);
    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }
    return { deletedCount: sessions.length };
  },
});

/**
 * Backend-only: return the user's *enabled* servers, including full auth
 * headers, so the agent runtime can connect to them. Guarded by the service
 * role key — never call this from the client.
 */
export const listEnabledForBackend = query({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
  },
  returns: v.array(
    v.object({
      _id: v.id("mcp_servers"),
      catalogId: v.optional(v.string()),
      name: v.string(),
      url: v.string(),
      transport: v.union(v.literal("http"), v.literal("sse")),
      headers: v.optional(
        v.array(v.object({ key: v.string(), value: v.string() })),
      ),
      encryptedCredentials: v.optional(encryptedCredentialsValidator),
      encryptedOAuthCredentials: v.optional(encryptedCredentialsValidator),
      credentialHeaderKeys: v.optional(v.array(v.string())),
      authKind: authKindValidator,
      oauthExpiresAt: v.optional(v.number()),
      oauthScopes: v.array(v.string()),
      toolCount: v.number(),
      toolNames: v.array(v.string()),
      configRevision: v.number(),
      connectionStatus: v.union(
        v.literal("verified"),
        v.literal("needs_attention"),
        v.literal("unknown"),
      ),
      // When this server was last probed. The loader needs it to decide
      // whether a server that previously failed has waited long enough to be
      // worth retrying, rather than treating one bad check as permanent.
      lastCheckedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);

    const rows = await ctx.db
      .query("mcp_servers")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .collect();

    return rows
      .filter(
        (row) =>
          row.enabled &&
          !hasMissingKnownMcpCredentials({
            url: row.url,
            headers: row.headers,
            resolveHeaders: row.encrypted_credentials,
            authProvider: row.oauth_credentials,
          }),
      )
      .map((row) => ({
        _id: row._id,
        catalogId: row.catalog_id,
        name: row.name,
        url: row.url,
        transport: row.transport,
        headers: row.headers,
        encryptedCredentials: row.encrypted_credentials,
        encryptedOAuthCredentials: row.oauth_credentials,
        credentialHeaderKeys: row.credential_header_keys,
        authKind: inferAuthKind(row),
        oauthExpiresAt: row.oauth_expires_at,
        oauthScopes: row.oauth_scopes ?? [],
        toolCount: row.tool_count ?? row.tool_names?.length ?? 0,
        toolNames: row.tool_names ?? [],
        configRevision: configRevision(row),
        connectionStatus: publicConnectionStatus(row.connection_status),
        lastCheckedAt: row.last_checked_at,
      }));
  },
});
