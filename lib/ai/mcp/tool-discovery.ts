import { tool, type ToolSet } from "ai";
import { z } from "zod";

// Registry follows the final (approval-wrapped) set without serializing private
// transport state into model schemas. Each conversation owns its own selection.
const selections = new WeakMap<ToolSet, () => string[]>();
export function activeDiscoveredTools(tools: ToolSet): string[] | undefined {
  return selections.get(tools)?.();
}

export function createMcpToolDiscovery(
  mcpNames: Iterable<string> | (() => Iterable<string>),
  lazy?: {
    discover: (query: string) => Promise<{ servers: string[] }>;
    rebuild: () => ToolSet;
  },
) {
  const deferredNames = () =>
    new Set(typeof mcpNames === "function" ? mcpNames() : mcpNames);
  const selected = new Set<string>();
  return {
    augment(tools: ToolSet): ToolSet {
      const names = Object.keys(tools).filter((name) =>
        deferredNames().has(name),
      );
      if (!names.length && !lazy) return tools;
      return {
        ...tools,
        search_connected_tools: tool({
          description:
            "Find tools from your connected apps (MCP). Search by app name or action before using an integration. Matching tools become available on the next step. Use another search to find more actions.",
          inputSchema: z.object({ query: z.string().min(1).max(200) }),
          execute: async ({ query }) => {
            const discovery = await lazy?.discover(query);
            // Rebuild through the existing profile, approval and journal gates.
            const available = lazy ? lazy.rebuild() : tools;
            const names = Object.keys(available).filter((name) =>
              deferredNames().has(name),
            );
            const terms = query
              .toLowerCase()
              .split(/[^\p{L}\p{N}]+/u)
              .filter(Boolean);
            const matches = names
              .map((name) => {
                const title = name.toLowerCase();
                const description = (
                  available[name].description ?? ""
                ).toLowerCase();
                return {
                  name,
                  score: terms.reduce(
                    (sum, term) =>
                      sum +
                      (title.includes(term)
                        ? 3
                        : description.includes(term)
                          ? 1
                          : 0),
                    0,
                  ),
                };
              })
              .filter(({ score }) => score > 0)
              .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
              .slice(0, 6);
            for (const { name } of matches) selected.add(name);
            return {
              ...(discovery ? { servers: discovery.servers } : {}),
              tools: matches.map(({ name }) => ({
                name,
                description: (available[name].description ?? "").slice(0, 300),
              })),
              message: matches.length
                ? "These tools are now available. Call the appropriate tool using its schema."
                : "No matching connected tool. Try the app name or another action.",
            };
          },
        }),
      };
    },
    register(tools: ToolSet) {
      selections.set(tools, () =>
        Object.keys(tools).filter(
          (name) => !deferredNames().has(name) || selected.has(name),
        ),
      );
    },
  };
}
