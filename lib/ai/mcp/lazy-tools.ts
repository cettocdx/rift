import type { LoadedMcpTools } from "./load-user-mcp-tools";

export type McpDiscoveryResult = { servers: string[] };
type Server = { id: string; name: string; toolNames?: string[] };

/** Run-scoped, bounded connection discovery. No credentials or transports cached across users. */
export function createLazyMcpTools(
  catalog: Server[],
  connect: (serverId: string) => Promise<LoadedMcpTools>,
): LoadedMcpTools {
  let closed = false;
  const pending = new Map<string, Promise<void>>();
  const connected = new Set<LoadedMcpTools>();
  let closing: Promise<void> | undefined;
  const result: LoadedMcpTools = {
    tools: {},
    planReadOnlyTools: {},
    toolsByServerId: {},
    planReadOnlyToolsByServerId: {},
    servers: [],
    discover: async (query) => {
      if (closed) return { servers: [] };
      const terms = query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean);
      const matches = catalog
        .map((server) => ({
          server,
          score: terms.reduce(
            (score, term) =>
              score +
              (server.name.toLowerCase().includes(term)
                ? 3
                : server.toolNames?.some((name) =>
                      name.toLowerCase().includes(term),
                    )
                  ? 1
                  : 0),
            0,
          ),
        }))
        .filter((item) => item.score > 0)
        .sort(
          (a, b) => b.score - a.score || a.server.id.localeCompare(b.server.id),
        )
        .slice(0, 3);
      await Promise.all(
        matches.map(({ server }) => {
          const existing = pending.get(server.id);
          if (existing) return existing;
          const loading = (async () => {
            try {
              // The real loader re-reads ownership, enabled state and credentials.
              const loaded = await connect(server.id);
              if (closed) {
                await loaded.close();
                return;
              }
              connected.add(loaded);
              Object.assign(result.tools, loaded.tools);
              Object.assign(result.planReadOnlyTools, loaded.planReadOnlyTools);
              Object.assign(result.toolsByServerId, loaded.toolsByServerId);
              Object.assign(
                result.planReadOnlyToolsByServerId,
                loaded.planReadOnlyToolsByServerId,
              );
              result.servers.push(...loaded.servers);
            } catch {
              result.servers.push({
                name: server.name,
                ok: false,
                toolCount: 0,
                error: "Connection unavailable",
              });
            }
          })();
          pending.set(server.id, loading);
          return loading;
        }),
      );
      return {
        servers: (matches.length
          ? matches.map((item) => item.server)
          : catalog.slice(0, 20)
        ).map((server) => server.name),
      };
    },
    close: () => {
      closed = true;
      closing ??= (async () => {
        await Promise.allSettled(pending.values());
        await Promise.allSettled(
          [...connected].map((connection) => connection.close()),
        );
      })();
      return closing;
    },
  };
  return result;
}
