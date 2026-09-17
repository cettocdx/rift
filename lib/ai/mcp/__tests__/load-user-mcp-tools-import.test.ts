import { jest, describe, it, expect, afterEach } from "@jest/globals";

const savedServiceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
  if (savedServiceKey === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
  else process.env.CONVEX_SERVICE_ROLE_KEY = savedServiceKey;
});

function fixture(importFails = false) {
  jest.resetModules();
  process.env.CONVEX_SERVICE_ROLE_KEY = "offline-service";
  const query = jest.fn().mockResolvedValue([
    {
      _id: "server-1",
      name: "Example",
      connectionStatus: "verified",
      authKind: "none",
      configRevision: 1,
      transport: "http",
      url: "https://example.com/mcp",
      toolNames: ["read_example"],
    },
  ] as never);
  const mutation = jest
    .fn()
    .mockResolvedValue({ success: true, configRevision: 1 } as never);
  const close = jest.fn().mockResolvedValue(undefined as never);
  const tools = { mcp_example_read: { execute: jest.fn() } };
  const connect = jest.fn().mockResolvedValue({
    serverId: "server-1",
    serverName: "Example",
    tools,
    planReadOnlyTools: tools,
    toolNames: ["read_example"],
    close,
  } as never);
  const imported = jest.fn(() => {
    if (importFails) throw new Error("private-transport-module-error");
    return { connectMcpServer: connect };
  });
  jest.doMock("@/convex/_generated/api", () => ({
    api: {
      mcpServers: {
        listEnabledForBackend: "list",
        recordConnectionHealthForBackend: "health",
      },
    },
  }));
  jest.doMock("@/lib/db/convex-client", () => ({
    ...jest.requireActual<typeof import("@/lib/db/convex-client")>(
      "@/lib/db/convex-client",
    ),
    getConvexClient: () => ({ query, mutation }),
  }));
  jest.doMock("../mcp-client", imported);
  const { loadUserMcpTools } =
    require("../load-user-mcp-tools") as typeof import("../load-user-mcp-tools");
  return { loadUserMcpTools, imported, query, mutation, connect, close, tools };
}

describe("MCP connection module loading", () => {
  it("keeps transport module unevaluated through lazy registry loading and close", async () => {
    const f = fixture();
    expect(f.imported).not.toHaveBeenCalled();
    const loaded = await f.loadUserMcpTools("owner", undefined, { lazy: true });
    expect(f.query).toHaveBeenCalledWith("list", {
      serviceKey: "offline-service",
      userId: "owner",
    });
    expect(f.imported).not.toHaveBeenCalled();
    expect(f.connect).not.toHaveBeenCalled();
    await loaded.close();
    expect(f.imported).not.toHaveBeenCalled();
  });

  it("loads transport on explicit discovery after rechecking current owner registry", async () => {
    const f = fixture();
    const loaded = await f.loadUserMcpTools("owner", ["server-1"], {
      lazy: true,
    });
    expect(f.imported).not.toHaveBeenCalled();
    await loaded.discover!("Example");
    expect(f.query).toHaveBeenCalledTimes(2);
    expect(f.imported).toHaveBeenCalledTimes(1);
    expect(f.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "server-1",
        url: "https://example.com/mcp",
      }),
    );
    expect(loaded.tools).toEqual(f.tools);
    await loaded.close();
    expect(f.close).toHaveBeenCalledTimes(1);
  });

  it("preserves eager tools and close behavior", async () => {
    const f = fixture();
    const loaded = await f.loadUserMcpTools("owner");
    expect(f.imported).toHaveBeenCalledTimes(1);
    expect(loaded.tools).toEqual(f.tools);
    expect(loaded.planReadOnlyTools).toEqual(f.tools);
    await loaded.close();
    expect(f.close).toHaveBeenCalledTimes(1);
  });

  it("handles module loading failure through existing sanitized connection failure path", async () => {
    const f = fixture(true);
    const loaded = await f.loadUserMcpTools("owner");
    expect(loaded.tools).toEqual({});
    expect(loaded.servers).toEqual([
      { name: "Example", ok: false, toolCount: 0, error: "Connection failed" },
    ]);
    expect(JSON.stringify(loaded.servers)).not.toContain(
      "private-transport-module-error",
    );
    expect(f.mutation).toHaveBeenCalledWith(
      "health",
      expect.objectContaining({
        userId: "owner",
        id: "server-1",
        status: "needs_attention",
      }),
    );
    await loaded.close();
  });
});
