/** @jest-environment node */
const mockRequests: Array<{ input: unknown; headers: Headers }> = [];
const mockCallTool = jest.fn();
let mockTransport: {
  options: { fetch: typeof fetch; requestInit?: RequestInit };
};
jest.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    async connect(transport: typeof mockTransport) {
      mockTransport = transport;
    }
    async listTools() {
      return { tools: [{ name: "read", inputSchema: { type: "object" } }] };
    }
    async close() {}
    callTool(...args: unknown[]) {
      return mockCallTool(...args);
    }
  },
}));
jest.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    constructor(
      _url: URL,
      public options: typeof mockTransport.options,
    ) {}
  },
}));
jest.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class {
    constructor(
      _url: URL,
      public options: typeof mockTransport.options,
    ) {}
  },
}));
jest.mock("../mcp-url-policy", () => ({
  isLocalMcpDevelopmentEnabled: () => false,
  createSafeMcpFetch:
    (options: { baseHeaders?: HeadersInit; configuredUrl?: URL }) =>
    async (input: unknown, init?: RequestInit) => {
      const headers = new Headers(options.baseHeaders);
      new Headers(init?.headers).forEach((value, key) =>
        headers.set(key, value),
      );
      mockRequests.push({ input, headers });
      return new Response("{}", { status: 200 });
    },
}));
import { connectMcpServer } from "../mcp-client";
const url = "https://api.githubcopilot.com/mcp";
beforeEach(() => {
  mockRequests.length = 0;
  jest.clearAllMocks();
});

it("does not expose unauthenticated hosted Browserbase tools just because tools/list succeeds", async () => {
  await expect(
    connectMcpServer({
      id: "browserbase",
      name: "Browserbase",
      url: "https://mcp.browserbase.com/mcp",
      transport: "http",
    }),
  ).rejects.toMatchObject({
    name: "McpConfigurationError",
    code: "credentials_required",
  });
});

it("returns an explicit uncertain outcome without replaying the MCP action or exposing remote secrets", async () => {
  mockCallTool.mockRejectedValueOnce(
    new Error("request https://remote.test/?token=private-token failed"),
  );
  const connection = await connectMcpServer({
    id: "public",
    name: "Public",
    url: "https://public.test/mcp",
    transport: "http",
  });
  const result = await connection!.tools.mcp_public_read.execute!(
    {},
    { toolCallId: "call", messages: [] },
  );
  expect(result).toMatchObject({
    isError: true,
    code: "mcp_call_unconfirmed",
    executionStatus: "unconfirmed",
    retrySafe: false,
  });
  expect(JSON.stringify(result)).not.toContain("private-token");
  expect(mockCallTool).toHaveBeenCalledTimes(1);
  await connection!.close();
});

it("reads dynamic credentials for each transport request and stops after disconnect", async () => {
  let token: string | null = "first-token";
  const resolveHeaders = jest.fn(async () => {
    if (!token) throw new Error("GitHub connection unavailable");
    return [{ key: "Authorization", value: `Bearer ${token}` }];
  });
  const connection = await connectMcpServer({
    id: "github",
    name: "GitHub",
    url,
    transport: "http",
    resolveHeaders,
  } as Parameters<typeof connectMcpServer>[0]);
  expect(connection).not.toBeNull();
  await mockTransport.options.fetch(url, { method: "POST" });
  token = "rotated-token";
  await mockTransport.options.fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer old-sdk-copy" },
  });
  expect(
    mockRequests.map((request) => request.headers.get("Authorization")),
  ).toEqual(["Bearer first-token", "Bearer rotated-token"]);
  token = null;
  await expect(mockTransport.options.fetch(url)).rejects.toThrow(
    "GitHub connection unavailable",
  );
  expect(mockRequests).toHaveLength(2);
  expect(resolveHeaders).toHaveBeenCalledTimes(3);
  await connection!.close();
});

it("retains explicitly configured static credentials", async () => {
  const connection = await connectMcpServer({
    id: "custom",
    name: "Custom",
    url,
    transport: "http",
    headers: [{ key: "Authorization", value: "Bearer manual-token" }],
  });
  await mockTransport.options.fetch(url, mockTransport.options.requestInit);
  expect(mockRequests[0].headers.get("Authorization")).toBe(
    "Bearer manual-token",
  );
  await connection!.close();
});
