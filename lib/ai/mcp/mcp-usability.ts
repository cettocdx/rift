/**
 * One definition of "can the agent use this plugin right now", shared by the
 * runtime that loads MCP tools and the composer that offers them. They used to
 * disagree: the composer showed only `verified` servers while the runtime also
 * runs `unknown` ones and retries `needs_attention` ones after a cooldown. A
 * freshly added, perfectly working plugin was therefore invisible in the
 * composer while the agent happily used it -- two answers to one question.
 *
 * Keep this module free of server-only imports: the client composer imports it.
 */

/** How long a failed server waits before the runtime dials it again. */
export const UNHEALTHY_RETRY_COOLDOWN_MS = 5 * 60 * 1000;

export type McpUsabilityState = {
  enabled: boolean;
  connectionStatus: "verified" | "needs_attention" | "unknown";
  lastCheckedAt?: number;
};

/**
 * True when the runtime would attempt to load this server, so the composer can
 * offer exactly what will actually run. `verified` and `unknown` are always
 * runnable; `needs_attention` is runnable again once its retry cooldown has
 * elapsed, which is how a transient failure heals itself.
 */
export function isMcpServerUsable(
  server: McpUsabilityState,
  now: number,
): boolean {
  if (!server.enabled) return false;
  if (server.connectionStatus !== "needs_attention") return true;
  return (
    server.lastCheckedAt === undefined ||
    now - server.lastCheckedAt >= UNHEALTHY_RETRY_COOLDOWN_MS
  );
}
