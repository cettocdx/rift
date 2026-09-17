import type { ToolSet } from "ai";
import { createLazyMcpTools, type McpDiscoveryResult } from "./lazy-tools";
import { api } from "@/convex/_generated/api";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";
import { createGithubTokenLoader } from "@/lib/github/load-user-github-token";
import { createGithubMcpHeaderResolver } from "./github-mcp-credentials";
import { isMcpServerUsable } from "@/lib/ai/mcp/mcp-usability";
import type { McpConnection } from "./mcp-client";
import { McpConfigurationError } from "./mcp-configuration";
import { isLocalMcpDevelopmentEnabled } from "./mcp-url-policy";
import {
  decryptMcpCredentials,
  decryptMcpSecretPayload,
  encryptMcpCredentials,
  encryptMcpSecretPayload,
  shouldRotateMcpCredentials,
} from "./mcp-credential-vault";
import type { EncryptedMcpCredentials } from "./mcp-credential-types";
import {
  assertMcpOAuthCredentialSnapshot,
  mcpOAuthExpiresAt,
  mcpOAuthScopes,
  PersistedMcpOAuthProvider,
} from "./mcp-oauth";

/**
 * Reads the enabled MCP registry. With lazy:true (production agent paths),
 * returns run-scoped discovery without opening transports. The default eager
 * path performs credential validation and connects selected servers; discovery
 * uses it to recheck current authority before exposing any tool.
 *
 * Design constraints:
 * - Additive & non-fatal: any failure (Convex read, a dead server, a bad tool
 *   list) degrades to "fewer / no MCP tools", never an agent crash.
 * - Servers already marked as needing attention are not retried on every chat
 *   turn. The Plugins screen owns the explicit reconnect flow so a broken
 *   third-party endpoint cannot add repeated latency to unrelated prompts.
 * - The returned connections stay OPEN for the lifetime of the stream because
 *   tool `execute` calls happen during streaming. The caller MUST invoke
 *   `close()` once the run finishes (success or error).
 */

export interface LoadedMcpServerStatus {
  name: string;
  ok: boolean;
  toolCount: number;
  error?: string;
}

export interface LoadedMcpTools {
  /** Optional run-scoped discovery; connects only matching enabled servers. */
  discover?: (query: string) => Promise<McpDiscoveryResult>;
  tools: ToolSet;
  /** Tools explicitly annotated read-only and non-destructive by their server. */
  planReadOnlyTools: ToolSet;
  /** Owner-checked tools grouped by the exact persisted Convex server id. */
  toolsByServerId: Record<string, ToolSet>;
  /** Read-only subset grouped by exact persisted Convex server id. */
  planReadOnlyToolsByServerId: Record<string, ToolSet>;
  /** Closes all underlying MCP transports. Safe to call once, in a finally. */
  close: () => Promise<void>;
  /** Per-server outcome, for logging / future UI surfacing. */
  servers: LoadedMcpServerStatus[];
}

/**
 * How long a server that failed its last check is left alone before the loader
 * dials it again. Short enough that a transient failure heals within a couple
 * of messages; long enough that an endpoint which is genuinely down is not
 * retried on every turn.
 */
// UNHEALTHY_RETRY_COOLDOWN_MS + the runnable rule now live in mcp-usability,
// shared with the composer so both agree on what is usable.

const EMPTY: LoadedMcpTools = {
  tools: {},
  planReadOnlyTools: {},
  toolsByServerId: {},
  planReadOnlyToolsByServerId: {},
  close: async () => {},
  servers: [],
};

export async function loadUserMcpTools(
  userId: string,
  allowedServerIds?: readonly string[],
  options?: { lazy?: boolean },
): Promise<LoadedMcpTools> {
  return loadUserMcpToolsForOrigin(userId, allowedServerIds, options);
}

type McpDatabaseOrigin = {
  localDevelopmentAtAdmission: boolean;
  client: ReturnType<typeof getConvexClient>;
  serviceKey: string;
  loadGithubToken: ReturnType<typeof createGithubTokenLoader>;
  vaultEnvironment: Readonly<{
    MCP_CREDENTIALS_ACTIVE_KEY_VERSION: string | undefined;
    MCP_CREDENTIALS_ENCRYPTION_KEYS: string | undefined;
    CONVEX_SERVICE_ROLE_KEY: string;
    NODE_ENV: string | undefined;
  }>;
};

// SDK callbacks and discovery may be invoked outside the caller's async scope.
// Capture database authority once, while still re-reading ownership on discovery.
async function loadUserMcpToolsForOrigin(
  userId: string,
  allowedServerIds?: readonly string[],
  options?: { lazy?: boolean },
  origin?: McpDatabaseOrigin,
): Promise<LoadedMcpTools> {
  // Global kill switch in case a deploy needs to disable MCP fast.
  if (process.env.MCP_DISABLED === "true" || allowedServerIds?.length === 0)
    return EMPTY;

  // Lazy discovery can occur after another run changes the process policy.
  // Capture before the registry await; a captured denial must remain a denial.
  const localDevelopmentAtAdmission =
    origin?.localDevelopmentAtAdmission ?? isLocalMcpDevelopmentEnabled();

  const serviceKey = origin?.serviceKey ?? getConvexServiceKey();
  if (!serviceKey) return EMPTY;
  // Keep callback encryption on the originating deployment's keys. Never
  // retain the mutable process.env object or copy unrelated environment data.
  const vaultEnvironment =
    origin?.vaultEnvironment ??
    Object.freeze({
      MCP_CREDENTIALS_ACTIVE_KEY_VERSION:
        process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION,
      MCP_CREDENTIALS_ENCRYPTION_KEYS:
        process.env.MCP_CREDENTIALS_ENCRYPTION_KEYS,
      CONVEX_SERVICE_ROLE_KEY: serviceKey,
      NODE_ENV: process.env.NODE_ENV,
    });

  let configs: Array<{
    _id: string;
    name: string;
    url: string;
    transport: "http" | "sse";
    headers?: Array<{ key: string; value: string }>;
    encryptedCredentials?: EncryptedMcpCredentials;
    encryptedOAuthCredentials?: EncryptedMcpCredentials;
    credentialHeaderKeys?: string[];
    authKind: "none" | "bearer" | "api_key_header" | "oauth";
    oauthExpiresAt?: number;
    oauthScopes?: string[];
    toolCount?: number;
    toolNames?: string[];
    configRevision: number;
    connectionStatus: "verified" | "needs_attention" | "unknown";
    lastCheckedAt?: number;
  }> = [];

  let client: ReturnType<typeof getConvexClient>;
  let loadGithubToken: ReturnType<typeof createGithubTokenLoader>;
  try {
    client = origin?.client ?? getConvexClient();
    loadGithubToken =
      origin?.loadGithubToken ??
      createGithubTokenLoader({ client, serviceKey });
    configs = await client.query(api.mcpServers.listEnabledForBackend, {
      serviceKey,
      userId,
    });
  } catch (error) {
    console.warn({
      timestamp: new Date().toISOString(),
      level: "warn",
      event: "mcp_registry_read_failed",
      service: "rift",
      environment: process.env.NODE_ENV ?? "unknown",
      user_id: userId,
      error_name: error instanceof Error ? error.name : "UnknownError",
    });
    return EMPTY;
  }

  if (allowedServerIds) {
    const allowed = new Set(allowedServerIds);
    configs = configs.filter((config) => allowed.has(config._id));
  }
  if (configs.length === 0) return EMPTY;

  // A server that failed once used to be excluded from every later attempt.
  // Because a server is only ever re-verified as a side effect of connecting to
  // it, that exclusion was permanent: one timeout on one message removed a
  // working plugin from the agent for good, and only a manual Reconnect in the
  // marketplace could bring it back. Its credentials were fine the whole time,
  // so nothing in the UI explained the silence.
  //
  // Failed servers are retried instead, once the cooldown has passed. The
  // cooldown is what keeps a genuinely dead endpoint from being dialled on
  // every single message while still letting a blip heal by itself.
  const now = Date.now();
  // configs are already the user's enabled servers; isMcpServerUsable still
  // guards enabled so the composer and the runtime share one exact predicate.
  const runnableConfigs = configs.filter((config) =>
    isMcpServerUsable(
      {
        enabled: true,
        connectionStatus: config.connectionStatus,
        lastCheckedAt: config.lastCheckedAt,
      },
      now,
    ),
  );
  if (runnableConfigs.length === 0) return EMPTY;

  if (options?.lazy) {
    return createLazyMcpTools(
      runnableConfigs.map((config) => ({
        id: config._id,
        name: config.name,
        toolNames: config.toolNames,
      })),
      (serverId) =>
        loadUserMcpToolsForOrigin(userId, [serverId], undefined, {
          client,
          serviceKey,
          loadGithubToken,
          vaultEnvironment,
          localDevelopmentAtAdmission,
        }),
    );
  }

  const preparedConfigs: Array<{
    config: (typeof runnableConfigs)[number];
    currentRevision: number;
    headers?: Array<{ key: string; value: string }>;
    resolveHeaders?: () => Promise<Array<{ key: string; value: string }>>;
    authProvider?: PersistedMcpOAuthProvider;
    migration?: EncryptedMcpCredentials;
    migrationAuthKind?: "bearer" | "api_key_header";
    oauthMigration?: {
      encryptedOAuthCredentials: EncryptedMcpCredentials;
      oauthExpiresAt?: number;
      oauthScopes: string[];
    };
  }> = [];
  const credentialFailures: LoadedMcpServerStatus[] = [];
  const credentialFailureConfigs: typeof runnableConfigs = [];

  for (const config of runnableConfigs) {
    try {
      if (config.authKind === "oauth") {
        if (!config.encryptedOAuthCredentials) {
          throw new Error("Stored OAuth credentials are unavailable");
        }
        const snapshot = decryptMcpSecretPayload(
          config.encryptedOAuthCredentials,
          {
            userId,
            url: config.url,
            purpose: "oauth-credentials",
          },
          vaultEnvironment,
        );
        assertMcpOAuthCredentialSnapshot(snapshot);
        const prepared: (typeof preparedConfigs)[number] = {
          config,
          currentRevision: config.configRevision,
        };
        if (
          shouldRotateMcpCredentials(
            config.encryptedOAuthCredentials,
            vaultEnvironment,
          )
        ) {
          try {
            prepared.oauthMigration = {
              encryptedOAuthCredentials: encryptMcpSecretPayload(
                snapshot,
                {
                  userId,
                  url: config.url,
                  purpose: "oauth-credentials",
                },
                vaultEnvironment,
              ),
              oauthExpiresAt: mcpOAuthExpiresAt(snapshot),
              oauthScopes: mcpOAuthScopes(snapshot),
            };
          } catch {
            // Keep the successfully decrypted bundle usable when the active
            // write key is temporarily unavailable. No old envelope is ever
            // overwritten until a healthy connection and CAS both succeed.
          }
        }
        const authProvider = new PersistedMcpOAuthProvider({
          ...snapshot,
          onTokensChanged: async (updatedSnapshot) => {
            const encryptedOAuthCredentials = encryptMcpSecretPayload(
              updatedSnapshot,
              {
                userId,
                url: config.url,
                purpose: "oauth-credentials",
              },
              vaultEnvironment,
            );
            const result = await client.mutation(
              api.mcpServers.updateOAuthCredentialsForBackend,
              {
                serviceKey,
                userId,
                id: config._id as never,
                expectedConfigRevision: prepared.currentRevision,
                expectedUrl: config.url,
                expectedAuthKind: "oauth",
                encryptedOAuthCredentials,
                oauthExpiresAt: mcpOAuthExpiresAt(updatedSnapshot),
                oauthScopes: mcpOAuthScopes(updatedSnapshot),
              },
            );
            if (!result.success) {
              throw new Error("OAuth credentials could not be persisted");
            }
            if (
              !result.configRevision ||
              !Number.isSafeInteger(result.configRevision)
            ) {
              throw new Error("OAuth credential revision was not returned");
            }
            prepared.currentRevision = result.configRevision;
            prepared.oauthMigration = undefined;
          },
        });
        prepared.authProvider = authProvider;
        preparedConfigs.push(prepared);
        continue;
      }
      const headers = config.encryptedCredentials
        ? decryptMcpCredentials(
            config.encryptedCredentials,
            {
              userId,
              url: config.url,
            },
            vaultEnvironment,
          )
        : config.headers;
      const resolveHeaders = createGithubMcpHeaderResolver(
        { url: config.url, authKind: config.authKind, headers },
        () => loadGithubToken(userId),
      );
      let migration: EncryptedMcpCredentials | undefined;
      let migrationAuthKind: "bearer" | "api_key_header" | undefined;
      if (
        headers?.length &&
        (!config.encryptedCredentials ||
          shouldRotateMcpCredentials(
            config.encryptedCredentials,
            vaultEnvironment,
          ))
      ) {
        if (
          config.authKind !== "bearer" &&
          config.authKind !== "api_key_header"
        ) {
          throw new Error("Stored credential metadata is inconsistent");
        }
        migrationAuthKind = config.authKind;
        try {
          migration = encryptMcpCredentials(
            headers,
            {
              userId,
              url: config.url,
            },
            vaultEnvironment,
          );
        } catch {
          // Legacy rows stay readable when the vault is not configured yet.
          // Never overwrite or delete them until a verified encrypted patch
          // succeeds.
        }
      }
      preparedConfigs.push({
        config,
        currentRevision: config.configRevision,
        headers,
        resolveHeaders,
        migration,
        migrationAuthKind: migration ? migrationAuthKind : undefined,
      });
    } catch (error) {
      credentialFailureConfigs.push(config);
      credentialFailures.push({
        name: config.name,
        ok: false,
        toolCount: 0,
        error: "Stored credentials unavailable",
      });
      console.warn({
        timestamp: new Date().toISOString(),
        level: "warn",
        event: "mcp_credential_decryption_failed",
        service: "rift",
        environment: process.env.NODE_ENV ?? "unknown",
        user_id: userId,
        server_id: config._id,
        error_name: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  if (credentialFailureConfigs.length > 0) {
    await Promise.allSettled(
      credentialFailureConfigs.map((config) =>
        client.mutation(api.mcpServers.recordConnectionHealthForBackend, {
          serviceKey,
          userId,
          id: config._id as never,
          expectedConfigRevision: config.configRevision,
          expectedUrl: config.url,
          expectedAuthKind: config.authKind,
          status: "needs_attention",
        }),
      ),
    );
  }

  if (preparedConfigs.length === 0) {
    return { ...EMPTY, servers: credentialFailures };
  }

  const settled = await Promise.allSettled(
    preparedConfigs.map(
      async ({ config, headers, resolveHeaders, authProvider }) => {
        // Lazy registry discovery needs no transport code. Import inside the
        // settled connection attempt so module failures use the same safe path.
        const { connectMcpServer } = await import("./mcp-client");
        return connectMcpServer({
          id: config._id,
          name: config.name,
          url: config.url,
          transport: config.transport,
          headers: resolveHeaders ? undefined : headers,
          resolveHeaders,
          authProvider,
          localDevelopmentAtAdmission,
        });
      },
    ),
  );

  const processed = await Promise.all(
    settled.map(async (outcome, i) => {
      const prepared = preparedConfigs[i];
      const { config: cfg, headers, migration, migrationAuthKind } = prepared;
      const connection = outcome.status === "fulfilled" ? outcome.value : null;
      const healthy = Boolean(connection && connection.toolNames.length > 0);
      const nextStatus = healthy ? "verified" : "needs_attention";

      const failClosed = async (): Promise<{
        connection: null;
        status: LoadedMcpServerStatus;
      }> => {
        await connection?.close().catch(() => undefined);
        return {
          connection: null,
          status: {
            name: cfg.name,
            ok: false,
            toolCount: 0,
            error: "Connection changed",
          },
        };
      };

      if (healthy && connection && migration && headers && migrationAuthKind) {
        try {
          const result = await client.mutation(
            api.mcpServers.updateVerifiedCredentialsForBackend,
            {
              serviceKey,
              userId,
              id: cfg._id as never,
              expectedConfigRevision: prepared.currentRevision,
              expectedUrl: cfg.url,
              expectedAuthKind: migrationAuthKind,
              encryptedCredentials: migration,
              credentialHeaderKeys: headers.map((header) => header.key),
            },
          );
          if (
            !result.success ||
            !result.configRevision ||
            !Number.isSafeInteger(result.configRevision)
          ) {
            return failClosed();
          }
          prepared.currentRevision = result.configRevision;
        } catch {
          return failClosed();
        }
      }

      if (healthy && connection && prepared.oauthMigration) {
        try {
          const rotation = prepared.oauthMigration;
          const result = await client.mutation(
            api.mcpServers.updateOAuthCredentialsForBackend,
            {
              serviceKey,
              userId,
              id: cfg._id as never,
              expectedConfigRevision: prepared.currentRevision,
              expectedUrl: cfg.url,
              expectedAuthKind: "oauth",
              encryptedOAuthCredentials: rotation.encryptedOAuthCredentials,
              oauthExpiresAt: rotation.oauthExpiresAt,
              oauthScopes: rotation.oauthScopes,
            },
          );
          if (
            !result.success ||
            !result.configRevision ||
            !Number.isSafeInteger(result.configRevision)
          ) {
            return failClosed();
          }
          prepared.currentRevision = result.configRevision;
          prepared.oauthMigration = undefined;
        } catch {
          return failClosed();
        }
      }

      const healthChanged =
        cfg.connectionStatus !== nextStatus ||
        (healthy &&
          connection &&
          (cfg.toolCount !== connection.toolNames.length ||
            JSON.stringify(cfg.toolNames ?? []) !==
              JSON.stringify(connection.toolNames)));
      if (healthChanged) {
        try {
          const result = await client.mutation(
            api.mcpServers.recordConnectionHealthForBackend,
            {
              serviceKey,
              userId,
              id: cfg._id as never,
              expectedConfigRevision: prepared.currentRevision,
              expectedUrl: cfg.url,
              expectedAuthKind: cfg.authKind,
              status: nextStatus,
              ...(healthy && connection
                ? {
                    toolCount: connection.toolNames.length,
                    toolNames: connection.toolNames,
                  }
                : {}),
            },
          );
          // A healthy connection based on a stale snapshot must never expose
          // tools, even when the stale write itself was safely rejected.
          if (healthy && !result.success) return failClosed();
        } catch {
          if (healthy) return failClosed();
        }
      }

      return healthy && connection
        ? {
            connection,
            status: {
              name: cfg.name,
              ok: true,
              toolCount: connection.toolNames.length,
            },
          }
        : {
            connection,
            status: {
              name: cfg.name,
              ok: false,
              toolCount: 0,
              // Third-party transport errors may echo Authorization headers.
              error:
                outcome.status === "rejected" &&
                outcome.reason instanceof McpConfigurationError
                  ? outcome.reason.message
                  : "Connection failed",
            },
          };
    }),
  );

  const connections: McpConnection[] = processed.flatMap((result) =>
    result.connection ? [result.connection] : [],
  );
  const servers: LoadedMcpServerStatus[] = [
    ...credentialFailures,
    ...processed.map((result) => result.status),
  ];

  // Merge all tools into one set. connectMcpServer already namespaces by server,
  // but two servers sharing a name could still collide — disambiguate here.
  const tools: ToolSet = {};
  const planReadOnlyTools: ToolSet = {};
  const toolsByServerId: Record<string, ToolSet> = {};
  const planReadOnlyToolsByServerId: Record<string, ToolSet> = {};
  for (const conn of connections) {
    const serverTools: ToolSet = {};
    const serverPlanReadOnlyTools: ToolSet = {};
    for (const [key, tool] of Object.entries(conn.tools)) {
      let finalKey = key;
      let suffix = 1;
      while (finalKey in tools) {
        finalKey = `${key}_${suffix++}`.slice(0, 64);
      }
      tools[finalKey] = tool;
      serverTools[finalKey] = tool;
      if (key in (conn.planReadOnlyTools ?? {})) {
        planReadOnlyTools[finalKey] = tool;
        serverPlanReadOnlyTools[finalKey] = tool;
      }
    }
    toolsByServerId[conn.serverId] = serverTools;
    planReadOnlyToolsByServerId[conn.serverId] = serverPlanReadOnlyTools;
  }

  const close = async () => {
    await Promise.allSettled(connections.map((c) => c.close()));
  };

  const totalTools = Object.keys(tools).length;
  if (totalTools > 0 || servers.some((s) => !s.ok)) {
    console.log({
      timestamp: new Date().toISOString(),
      level: "info",
      event: "mcp_tools_loaded",
      service: "rift",
      environment: process.env.NODE_ENV ?? "unknown",
      user_id: userId,
      tool_count: totalTools,
      healthy_server_count: servers.filter((server) => server.ok).length,
      server_count: servers.length,
    });
  }

  return {
    tools,
    planReadOnlyTools,
    toolsByServerId,
    planReadOnlyToolsByServerId,
    close,
    servers,
  };
}
