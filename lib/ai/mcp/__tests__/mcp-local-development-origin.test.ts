/** @jest-environment node */
import { loadUserMcpTools } from "../load-user-mcp-tools";
import { connectMcpServer } from "../mcp-client";

const mockConnect = jest.fn(async () => {});
const mockClose = jest.fn(async () => {});
const row = {
  _id: "local-server",
  name: "Local example",
  url: "http://localhost:8080/mcp",
  transport: "http",
  authKind: "none",
  configRevision: 1,
  connectionStatus: "verified",
  toolNames: ["mcp_local_example_read"],
  toolCount: 1,
};
const mockQuery = jest.fn(async () => [row]);
jest.mock("@/lib/db/convex-client", () => ({
  getConvexServiceKey: () => "offline-key",
  getConvexClient: () => ({
    query: mockQuery,
    mutation: jest.fn(async () => ({ success: true, configRevision: 2 })),
  }),
}));
jest.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = mockConnect;
    close = mockClose;
    listTools = async () => ({
      tools: [{ name: "read", inputSchema: { type: "object" } }],
    });
  },
}));
jest.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {},
}));
jest.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class {},
}));

// Tests temporarily mutate Node's environment; Next types NODE_ENV as readonly.
const testEnv = process.env as Record<string, string | undefined>;
const envKeys = [
  "NODE_ENV",
  "MCP_ALLOW_INSECURE_LOCALHOST",
  "MCP_DISABLED",
] as const;
const original = Object.fromEntries(envKeys.map((key) => [key, testEnv[key]]));
function localPermission(enabled: boolean) {
  testEnv.NODE_ENV = "development";
  testEnv.MCP_ALLOW_INSECURE_LOCALHOST = String(enabled);
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  delete testEnv.MCP_DISABLED;
  mockQuery.mockImplementation(async () => [row]);
});
afterEach(() => {
  jest.restoreAllMocks();
  for (const key of envKeys) {
    if (original[key] === undefined) delete testEnv[key];
    else testEnv[key] = original[key];
  }
});

it("does not borrow B's local permission during A's lazy discovery", async () => {
  localPermission(false);
  const a = await loadUserMcpTools("owner-a", undefined, { lazy: true });
  localPermission(true);
  const b = await loadUserMcpTools("owner-b", undefined, { lazy: true });
  await a.discover!("Local example");
  expect(a.tools).toEqual({});
  expect(mockConnect).not.toHaveBeenCalled();
  await b.discover!("Local example");
  expect(Object.keys(b.tools)).toEqual(["mcp_local_example_read"]);
  expect(mockConnect).toHaveBeenCalledTimes(1);
  await a.close();
  await b.close();
});

it("captures local permission before the initial registry await", async () => {
  localPermission(false);
  mockQuery.mockImplementationOnce(async () => {
    localPermission(true);
    return [row];
  });
  const loaded = await loadUserMcpTools("owner-a");
  expect(loaded.tools).toEqual({});
  expect(mockConnect).not.toHaveBeenCalled();
  await loaded.close();
});

it("respects tightened connection-time policy even when lazy admission allowed local", async () => {
  localPermission(true);
  const loaded = await loadUserMcpTools("owner-a", undefined, { lazy: true });
  localPermission(false);
  await loaded.discover!("Local example");
  expect(loaded.tools).toEqual({});
  expect(mockConnect).not.toHaveBeenCalled();
  await loaded.close();
});

it("keeps the global MCP kill switch live at lazy discovery", async () => {
  localPermission(true);
  const loaded = await loadUserMcpTools("owner-a", undefined, { lazy: true });
  testEnv.MCP_DISABLED = "true";
  await loaded.discover!("Local example");
  expect(mockQuery).toHaveBeenCalledTimes(1);
  expect(mockConnect).not.toHaveBeenCalled();
  expect(loaded.tools).toEqual({});
  await loaded.close();
});

it.each([false, true])(
  "direct callers without admission context retain current policy (%p)",
  async (allowed) => {
    localPermission(allowed);
    const connection = await connectMcpServer({
      ...row,
      id: row._id,
      transport: "http",
    });
    expect(Boolean(connection)).toBe(allowed);
    expect(mockConnect).toHaveBeenCalledTimes(allowed ? 1 : 0);
    await connection?.close();
  },
);

it("cannot override production's localhost prohibition with captured permission", async () => {
  testEnv.NODE_ENV = "production";
  testEnv.MCP_ALLOW_INSECURE_LOCALHOST = "true";
  const connection = await connectMcpServer({
    ...row,
    id: row._id,
    transport: "http",
    localDevelopmentAtAdmission: true,
  } as Parameters<typeof connectMcpServer>[0]);
  expect(connection).toBeNull();
  expect(mockConnect).not.toHaveBeenCalled();
});
