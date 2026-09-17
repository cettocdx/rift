import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

const mockQuery = jest.fn();
const mockMutation = jest.fn();
const mockConnectMcpServer = jest.fn();
const mockGithubToken = jest.fn();
const mockGithubTokenFactory = jest.fn(() => mockGithubToken);

let loadUserMcpTools: typeof import("../load-user-mcp-tools").loadUserMcpTools;

const originalServiceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
const originalActiveKey = process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION;
const originalKeyring = process.env.MCP_CREDENTIALS_ENCRYPTION_KEYS;

describe("loadUserMcpTools connection health", () => {
  beforeAll(() => {
    jest.resetModules();
    jest.doMock("@/convex/_generated/api", () => ({
      api: {
        mcpServers: {
          listEnabledForBackend: "mcp.listEnabled",
          recordConnectionHealthForBackend: "mcp.recordHealth",
          updateVerifiedCredentialsForBackend: "mcp.updateCredentials",
          updateOAuthCredentialsForBackend: "mcp.updateOAuthCredentials",
        },
      },
    }));
    jest.doMock("@/lib/db/convex-client", () => ({
      ...jest.requireActual<typeof import("@/lib/db/convex-client")>(
        "@/lib/db/convex-client",
      ),
      getConvexClient: () => ({ query: mockQuery, mutation: mockMutation }),
    }));
    jest.doMock("@/lib/github/load-user-github-token", () => ({
      createGithubTokenLoader: mockGithubTokenFactory,
    }));
    jest.doMock("../mcp-client", () => ({
      connectMcpServer: mockConnectMcpServer,
    }));
    ({ loadUserMcpTools } =
      require("../load-user-mcp-tools") as typeof import("../load-user-mcp-tools"));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CONVEX_SERVICE_ROLE_KEY = "service-key";
    mockMutation.mockImplementation((reference: unknown, args: any) =>
      Promise.resolve(
        reference === "mcp.updateCredentials" ||
          reference === "mcp.updateOAuthCredentials"
          ? {
              success: true,
              configRevision: args.expectedConfigRevision + 1,
            }
          : {
              success: true,
              configRevision: args.expectedConfigRevision,
            },
      ),
    );
  });

  it("resolves managed GitHub references from the current owner token without replacing the encrypted reference", async () => {
    const { encryptMcpCredentials, decryptMcpCredentials } =
      await import("../mcp-credential-vault");
    process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION = "test";
    process.env.MCP_CREDENTIALS_ENCRYPTION_KEYS = JSON.stringify({
      test: Buffer.alloc(32, 7).toString("base64url"),
    });
    const url = "https://api.githubcopilot.com/mcp";
    const storedHeaders = [
      { key: "Authorization", value: "rift:github-connection:v1" },
    ];
    const encryptedCredentials = encryptMcpCredentials(storedHeaders, {
      userId: "user-1",
      url,
    });
    mockQuery.mockResolvedValue([
      {
        _id: "github",
        name: "GitHub",
        url,
        transport: "http",
        authKind: "bearer",
        configRevision: 1,
        connectionStatus: "verified",
        encryptedCredentials,
        toolNames: ["read"],
        toolCount: 1,
      },
    ] as never);
    mockGithubToken
      .mockResolvedValueOnce({ token: "fresh-token" } as never)
      .mockResolvedValueOnce(null as never);
    mockConnectMcpServer.mockResolvedValue({
      serverId: "github",
      serverName: "GitHub",
      tools: {},
      planReadOnlyTools: {},
      toolNames: ["read"],
      close: async () => {},
    } as never);
    const loaded = await loadUserMcpTools("user-1");
    const config = mockConnectMcpServer.mock.calls[0][0] as {
      headers?: unknown;
      resolveHeaders?: () => Promise<unknown>;
    };
    expect(config.headers).toBeUndefined();
    expect(config.resolveHeaders).toEqual(expect.any(Function));
    expect(await config.resolveHeaders!()).toEqual([
      { key: "Authorization", value: "Bearer fresh-token" },
    ]);
    await expect(config.resolveHeaders!()).rejects.toThrow(
      "GitHub connection unavailable",
    );
    expect(mockGithubToken).toHaveBeenCalledWith("user-1");
    expect(mockGithubTokenFactory).toHaveBeenCalledWith({
      client: expect.objectContaining({ query: mockQuery }),
      serviceKey: "service-key",
    });
    expect(
      decryptMcpCredentials(encryptedCredentials, { userId: "user-1", url }),
    ).toEqual(storedHeaders);
    expect(JSON.stringify(mockMutation.mock.calls)).not.toContain(
      "fresh-token",
    );
    await loaded.close();
  });

  it("does not connect any server for a profile with no integrations", async () => {
    const result = await loadUserMcpTools("user-1", []);
    expect(result.tools).toEqual({});
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockConnectMcpServer).not.toHaveBeenCalled();
  });

  it("rechecks enabled ownership at discovery time instead of dialing stale registry entries", async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          _id: "github",
          name: "GitHub",
          connectionStatus: "verified",
          authKind: "none",
          configRevision: 1,
          transport: "http",
          url: "https://example.com/mcp",
        },
      ] as never)
      .mockResolvedValueOnce([] as never);
    const loaded = await loadUserMcpTools("user-1", ["github"], { lazy: true });
    expect(mockConnectMcpServer).not.toHaveBeenCalled();
    await loaded.discover!("github");
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockConnectMcpServer).not.toHaveBeenCalled();
    expect(loaded.tools).toEqual({});
    await loaded.close();
  });

  it("filters the owner registry before connecting profile-selected servers", async () => {
    mockQuery.mockResolvedValue([
      {
        _id: "other",
        name: "Other",
        connectionStatus: "verified",
        authKind: "none",
        configRevision: 1,
        transport: "http",
        url: "https://example.com/mcp",
      },
    ] as never);
    const result = await loadUserMcpTools("user-1", ["selected"]);
    expect(result.tools).toEqual({});
    expect(mockConnectMcpServer).not.toHaveBeenCalled();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalActiveKey === undefined) {
      delete process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION;
    } else {
      process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION = originalActiveKey;
    }
    if (originalKeyring === undefined) {
      delete process.env.MCP_CREDENTIALS_ENCRYPTION_KEYS;
    } else {
      process.env.MCP_CREDENTIALS_ENCRYPTION_KEYS = originalKeyring;
    }
  });

  afterAll(() => {
    if (originalServiceKey === undefined) {
      delete process.env.CONVEX_SERVICE_ROLE_KEY;
    } else {
      process.env.CONVEX_SERVICE_ROLE_KEY = originalServiceKey;
    }
    if (originalActiveKey === undefined) {
      delete process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION;
    } else {
      process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION = originalActiveKey;
    }
    if (originalKeyring === undefined) {
      delete process.env.MCP_CREDENTIALS_ENCRYPTION_KEYS;
    } else {
      process.env.MCP_CREDENTIALS_ENCRYPTION_KEYS = originalKeyring;
    }
  });

  it("persists only coarse status transitions after runtime handshakes", async () => {
    const close = jest.fn(async () => undefined);
    mockQuery.mockResolvedValue([
      {
        _id: "server-failed",
        name: "Expired token",
        url: "https://example.com/failed",
        transport: "http",
        authKind: "none",
        configRevision: 2,
        connectionStatus: "verified",
      },
      {
        _id: "server-recovered",
        name: "Recovered",
        url: "https://example.com/recovered",
        transport: "http",
        authKind: "none",
        configRevision: 3,
        connectionStatus: "unknown",
      },
    ] as never);
    mockConnectMcpServer
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({
        serverId: "server-recovered",
        serverName: "Recovered",
        tools: { mcp_recovered_ping: {}, mcp_recovered_write: {} },
        planReadOnlyTools: { mcp_recovered_ping: {} },
        toolNames: ["mcp_recovered_ping", "mcp_recovered_write"],
        close,
      } as never);
    jest.spyOn(console, "log").mockImplementation(() => undefined);

    const loaded = await loadUserMcpTools("user-1");

    expect(mockMutation).toHaveBeenCalledTimes(2);
    expect(mockMutation).toHaveBeenCalledWith("mcp.recordHealth", {
      serviceKey: "service-key",
      userId: "user-1",
      id: "server-failed",
      expectedConfigRevision: 2,
      expectedUrl: "https://example.com/failed",
      expectedAuthKind: "none",
      status: "needs_attention",
    });
    expect(mockMutation).toHaveBeenCalledWith("mcp.recordHealth", {
      serviceKey: "service-key",
      userId: "user-1",
      id: "server-recovered",
      expectedConfigRevision: 3,
      expectedUrl: "https://example.com/recovered",
      expectedAuthKind: "none",
      status: "verified",
      toolCount: 2,
      toolNames: ["mcp_recovered_ping", "mcp_recovered_write"],
    });
    expect(JSON.stringify(mockMutation.mock.calls)).not.toContain("error");
    expect(Object.keys(loaded.tools)).toEqual([
      "mcp_recovered_ping",
      "mcp_recovered_write",
    ]);
    expect(Object.keys(loaded.planReadOnlyTools)).toEqual([
      "mcp_recovered_ping",
    ]);
    expect(Object.keys(loaded.toolsByServerId["server-recovered"])).toEqual([
      "mcp_recovered_ping",
      "mcp_recovered_write",
    ]);
    expect(
      Object.keys(loaded.planReadOnlyToolsByServerId["server-recovered"]),
    ).toEqual(["mcp_recovered_ping"]);
    await loaded.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("leaves a recently failed server alone until its cooldown passes", async () => {
    mockQuery.mockResolvedValue([
      {
        _id: "server-needs-attention",
        name: "Expired token",
        url: "https://example.com/expired",
        transport: "http",
        authKind: "none",
        configRevision: 1,
        connectionStatus: "needs_attention",
        lastCheckedAt: Date.now() - 30_000,
      },
    ] as never);

    const loaded = await loadUserMcpTools("user-1");

    expect(mockConnectMcpServer).not.toHaveBeenCalled();
    expect(mockMutation).not.toHaveBeenCalled();
    expect(loaded.tools).toEqual({});
    expect(loaded.servers).toEqual([]);
  });

  it("retries a failed server once its cooldown has passed", async () => {
    // Without this, a single bad check removed the plugin from the agent for
    // good: the loader skipped it, and health is only re-recorded as a side
    // effect of connecting, so nothing could ever mark it healthy again.
    const close = jest.fn().mockResolvedValue(undefined);
    mockQuery.mockResolvedValue([
      {
        _id: "server-stale-failure",
        name: "Recovered after a blip",
        url: "https://example.com/blip",
        transport: "http",
        authKind: "none",
        configRevision: 4,
        connectionStatus: "needs_attention",
        lastCheckedAt: Date.now() - 10 * 60 * 1000,
      },
    ] as never);
    mockConnectMcpServer.mockResolvedValueOnce({
      serverId: "server-stale-failure",
      serverName: "Recovered after a blip",
      tools: { mcp_blip_ping: {} },
      planReadOnlyTools: { mcp_blip_ping: {} },
      toolNames: ["mcp_blip_ping"],
      close,
    } as never);
    jest.spyOn(console, "log").mockImplementation(() => undefined);

    const loaded = await loadUserMcpTools("user-1");

    expect(mockConnectMcpServer).toHaveBeenCalledTimes(1);
    expect(mockMutation).toHaveBeenCalledWith("mcp.recordHealth", {
      serviceKey: "service-key",
      userId: "user-1",
      id: "server-stale-failure",
      expectedConfigRevision: 4,
      expectedUrl: "https://example.com/blip",
      expectedAuthKind: "none",
      status: "verified",
      toolCount: 1,
      toolNames: ["mcp_blip_ping"],
    });
    expect(Object.keys(loaded.tools)).toEqual(["mcp_blip_ping"]);
    await loaded.close();
  });

  it("does not write when persisted health already matches reality", async () => {
    mockQuery.mockResolvedValue([
      {
        _id: "server-healthy",
        name: "Healthy",
        url: "https://example.com/mcp",
        transport: "http",
        authKind: "none",
        configRevision: 1,
        connectionStatus: "verified",
        toolCount: 1,
        toolNames: ["ping"],
      },
    ] as never);
    mockConnectMcpServer.mockResolvedValue({
      serverId: "server-healthy",
      serverName: "Healthy",
      tools: {},
      toolNames: ["ping"],
      close: jest.fn(async () => undefined),
    } as never);

    await loadUserMcpTools("user-1");

    expect(mockMutation).not.toHaveBeenCalled();
  });

  it("treats a tool-less connection as unhealthy and still closes it", async () => {
    const close = jest.fn(async () => undefined);
    mockQuery.mockResolvedValue([
      {
        _id: "server-empty",
        name: "Empty",
        url: "https://example.com/empty",
        transport: "http",
        authKind: "none",
        configRevision: 1,
        connectionStatus: "verified",
      },
    ] as never);
    mockConnectMcpServer.mockResolvedValue({
      serverId: "server-empty",
      serverName: "Empty",
      tools: {},
      toolNames: [],
      close,
    } as never);

    const loaded = await loadUserMcpTools("user-1");

    expect(mockMutation).toHaveBeenCalledWith("mcp.recordHealth", {
      serviceKey: "service-key",
      userId: "user-1",
      id: "server-empty",
      expectedConfigRevision: 1,
      expectedUrl: "https://example.com/empty",
      expectedAuthKind: "none",
      status: "needs_attention",
    });
    await loaded.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a concurrent edit makes the health CAS stale", async () => {
    const close = jest.fn(async () => undefined);
    mockQuery.mockResolvedValue([
      {
        _id: "server-race",
        name: "Racing server",
        url: "https://race.example/mcp",
        transport: "http",
        authKind: "none",
        configRevision: 7,
        connectionStatus: "unknown",
      },
    ] as never);
    mockConnectMcpServer.mockResolvedValue({
      serverId: "server-race",
      serverName: "Racing server",
      tools: { mcp_race_ping: {} },
      planReadOnlyTools: {},
      toolNames: ["mcp_race_ping"],
      close,
    } as never);
    mockMutation.mockResolvedValueOnce({
      success: false,
      stale: true,
      error: "Plugin connection changed.",
    } as never);
    jest.spyOn(console, "log").mockImplementation(() => undefined);

    const loaded = await loadUserMcpTools("user-1");

    expect(mockMutation).toHaveBeenCalledWith("mcp.recordHealth", {
      serviceKey: "service-key",
      userId: "user-1",
      id: "server-race",
      expectedConfigRevision: 7,
      expectedUrl: "https://race.example/mcp",
      expectedAuthKind: "none",
      status: "verified",
      toolCount: 1,
      toolNames: ["mcp_race_ping"],
    });
    expect(loaded.tools).toEqual({});
    expect(loaded.servers).toEqual([
      expect.objectContaining({ name: "Racing server", ok: false }),
    ]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("loads OAuth providers and persists refreshed tokens as ciphertext", async () => {
    process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION = "test-v1";
    process.env.MCP_CREDENTIALS_ENCRYPTION_KEYS = JSON.stringify({
      "test-v1": Buffer.alloc(32, 4).toString("base64url"),
    });
    const { encryptMcpSecretPayload } = await import("../mcp-credential-vault");
    const encryptedOAuthCredentials = encryptMcpSecretPayload(
      {
        version: 1,
        redirectUrl: "https://app.rift.test/api/mcp/oauth/callback",
        clientInformation: { client_id: "client-1" },
        tokens: {
          access_token: "old-access-token",
          refresh_token: "refresh-token",
          token_type: "Bearer",
          expires_in: 3_600,
          scope: "read",
        },
        tokenIssuedAt: Date.now(),
      },
      {
        userId: "user-1",
        url: "https://oauth.example/mcp",
        purpose: "oauth-credentials",
      },
    );
    mockQuery.mockResolvedValue([
      {
        _id: "server-oauth",
        name: "OAuth server",
        url: "https://oauth.example/mcp",
        transport: "http",
        authKind: "oauth",
        configRevision: 5,
        encryptedOAuthCredentials,
        connectionStatus: "verified",
        toolCount: 1,
        toolNames: ["mcp_oauth_ping"],
      },
    ] as never);
    mockConnectMcpServer.mockImplementationOnce(async (config: any) => {
      expect(config.headers).toBeUndefined();
      expect(config.authProvider.tokens().access_token).toBe(
        "old-access-token",
      );
      await config.authProvider.saveTokens({
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        token_type: "Bearer",
        expires_in: 7_200,
        scope: "read write",
      });
      return {
        serverId: "server-oauth",
        serverName: "OAuth server",
        tools: {},
        planReadOnlyTools: {},
        toolNames: ["mcp_oauth_ping"],
        close: jest.fn(async () => undefined),
      };
    });

    await loadUserMcpTools("user-1");

    expect(mockMutation).toHaveBeenCalledWith(
      "mcp.updateOAuthCredentials",
      expect.objectContaining({
        serviceKey: "service-key",
        userId: "user-1",
        id: "server-oauth",
        expectedConfigRevision: 5,
        expectedUrl: "https://oauth.example/mcp",
        expectedAuthKind: "oauth",
        encryptedOAuthCredentials: expect.objectContaining({
          version: 1,
          algorithm: "aes-256-gcm",
        }),
        oauthScopes: ["read", "write"],
      }),
    );
    expect(JSON.stringify(mockMutation.mock.calls)).not.toContain(
      "new-access-token",
    );
    expect(JSON.stringify(mockMutation.mock.calls)).not.toContain(
      "new-refresh-token",
    );
  });

  it("rotates a healthy OAuth envelope to the active key without a token refresh", async () => {
    const oldKey = Buffer.alloc(32, 6).toString("base64url");
    const newKey = Buffer.alloc(32, 7).toString("base64url");
    process.env.MCP_CREDENTIALS_ENCRYPTION_KEYS = JSON.stringify({
      "old-v1": oldKey,
      "new-v2": newKey,
    });
    process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION = "old-v1";
    const { encryptMcpSecretPayload } = await import("../mcp-credential-vault");
    const encryptedOAuthCredentials = encryptMcpSecretPayload(
      {
        version: 1,
        redirectUrl: "https://app.rift.test/api/mcp/oauth/callback",
        clientInformation: { client_id: "client-rotation" },
        tokens: {
          access_token: "rotation-access-token",
          refresh_token: "rotation-refresh-token",
          token_type: "Bearer",
          expires_in: 3_600,
          scope: "read",
        },
        tokenIssuedAt: Date.now(),
      },
      {
        userId: "user-1",
        url: "https://rotation.example/mcp",
        purpose: "oauth-credentials",
      },
    );
    process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION = "new-v2";
    mockQuery.mockResolvedValue([
      {
        _id: "server-rotation",
        name: "OAuth rotation",
        url: "https://rotation.example/mcp",
        transport: "http",
        authKind: "oauth",
        configRevision: 9,
        encryptedOAuthCredentials,
        connectionStatus: "verified",
        toolCount: 1,
        toolNames: ["mcp_rotation_ping"],
      },
    ] as never);
    mockConnectMcpServer.mockResolvedValue({
      serverId: "server-rotation",
      serverName: "OAuth rotation",
      tools: { mcp_rotation_ping: {} },
      planReadOnlyTools: {},
      toolNames: ["mcp_rotation_ping"],
      close: jest.fn(async () => undefined),
    } as never);

    const loaded = await loadUserMcpTools("user-1");

    expect(mockMutation).toHaveBeenCalledTimes(1);
    expect(mockMutation).toHaveBeenCalledWith(
      "mcp.updateOAuthCredentials",
      expect.objectContaining({
        id: "server-rotation",
        expectedConfigRevision: 9,
        expectedUrl: "https://rotation.example/mcp",
        expectedAuthKind: "oauth",
        encryptedOAuthCredentials: expect.objectContaining({
          keyVersion: "new-v2",
        }),
      }),
    );
    expect(Object.keys(loaded.tools)).toEqual(["mcp_rotation_ping"]);
    expect(JSON.stringify(mockMutation.mock.calls)).not.toContain(
      "rotation-access-token",
    );
  });
});
