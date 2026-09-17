import { createLazyMcpTools } from "../lazy-tools";
import type { LoadedMcpTools } from "../load-user-mcp-tools";

const catalog = [
  { id: "github", name: "GitHub", toolNames: ["search_repositories"] },
  { id: "slack", name: "Slack", toolNames: ["search_messages"] },
];
function bundle(id: string): LoadedMcpTools {
  const tools = { [`mcp_${id}_read`]: { description: `Read ${id}` } };
  return {
    tools,
    planReadOnlyTools: tools,
    toolsByServerId: { [id]: tools },
    planReadOnlyToolsByServerId: { [id]: tools },
    servers: [],
    close: jest.fn(),
  };
}
it("does not connect at startup; concurrent searches connect only their matching server once", async () => {
  const connect = jest.fn(async (id: string) => bundle(id));
  const lazy = createLazyMcpTools(catalog, connect);
  expect(connect).not.toHaveBeenCalled();
  expect(lazy.tools).toEqual({});
  await Promise.all([lazy.discover!("github"), lazy.discover!("repositories")]);
  expect(connect.mock.calls).toEqual([["github"]]);
  expect(Object.keys(lazy.tools)).toEqual(["mcp_github_read"]);
  await lazy.close();
});
it("closes a connection that finishes after run teardown without publishing its tools", async () => {
  let resolve!: (value: LoadedMcpTools) => void;
  const loaded = bundle("github");
  const lazy = createLazyMcpTools(
    catalog,
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const search = lazy.discover!("github");
  const closing = lazy.close();
  resolve(loaded);
  await Promise.all([search, closing, lazy.close()]);
  expect(loaded.close).toHaveBeenCalledTimes(1);
  expect(lazy.tools).toEqual({});
  await lazy.discover!("slack");
  expect(lazy.tools).toEqual({});
});
it("bounds connections, isolates failures, and offers registry names for unmatched searches", async () => {
  const connect = jest.fn(async (id: string) => {
    if (id === "github") throw new Error("private credential detail");
    return bundle(id);
  });
  const lazy = createLazyMcpTools(catalog, connect);
  const unknown = await lazy.discover!("calendar");
  expect(unknown).toEqual({ servers: ["GitHub", "Slack"] });
  expect(connect).not.toHaveBeenCalled();
  await lazy.discover!("search");
  expect(lazy.tools).toHaveProperty("mcp_slack_read");
  expect(JSON.stringify(lazy.servers)).not.toContain("private");
  const many = createLazyMcpTools(
    Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      name: "Docs",
      toolNames: [],
    })),
    connect,
  );
  connect.mockClear();
  await many.discover!("Docs");
  expect(connect).toHaveBeenCalledTimes(3);
  await Promise.all([lazy.close(), many.close()]);
});
