/** @jest-environment node */
const savedEnv = {
  CONVEX_SERVICE_ROLE_KEY: process.env.CONVEX_SERVICE_ROLE_KEY,
  MCP_CREDENTIALS_ACTIVE_KEY_VERSION:
    process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION,
  MCP_CREDENTIALS_ENCRYPTION_KEYS: process.env.MCP_CREDENTIALS_ENCRYPTION_KEYS,
};
afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function fixture() {
  jest.resetModules();
  process.env.CONVEX_SERVICE_ROLE_KEY = "service-A";
  process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION = "new";
  process.env.MCP_CREDENTIALS_ENCRYPTION_KEYS = JSON.stringify({
    old: Buffer.alloc(32, 5).toString("base64url"),
    new: Buffer.alloc(32, 6).toString("base64url"),
  });
  const makeClient = () => ({
    query: jest.fn(),
    mutation: jest.fn().mockImplementation(async (_ref, args) => ({
      success: true,
      configRevision: args.expectedConfigRevision + 1,
    })),
  });
  const a = makeClient(),
    b = makeClient();
  let current = a;
  const moveToB = () => {
    current = b;
    process.env.CONVEX_SERVICE_ROLE_KEY = "service-B";
  };
  const connect = jest.fn();
  const close = jest.fn(async () => {});
  const connection = {
    serverId: "server",
    serverName: "Example",
    tools: { read_example: {} },
    planReadOnlyTools: { read_example: {} },
    toolNames: ["read_example"],
    close,
  };
  connect.mockResolvedValue(connection);
  jest.doMock("@/convex/_generated/api", () => ({
    api: {
      github: { getTokenForBackend: "github-token" },
      mcpServers: {
        listEnabledForBackend: "list",
        recordConnectionHealthForBackend: "health",
        updateOAuthCredentialsForBackend: "oauth",
        updateVerifiedCredentialsForBackend: "credentials",
      },
    },
  }));
  jest.doMock("@/lib/db/convex-client", () => ({
    ...jest.requireActual<typeof import("@/lib/db/convex-client")>(
      "@/lib/db/convex-client",
    ),
    getConvexClient: () => current,
  }));
  jest.doMock("../mcp-client", () => ({ connectMcpServer: connect }));
  const { loadUserMcpTools } =
    require("../load-user-mcp-tools") as typeof import("../load-user-mcp-tools");
  const row = {
    _id: "server",
    name: "Example",
    url: "https://example.com/mcp",
    transport: "http",
    authKind: "none",
    configRevision: 5,
    connectionStatus: "verified",
    toolCount: 1,
    toolNames: ["read_example"],
  };
  a.query.mockResolvedValue([row]);
  b.query.mockResolvedValue([]);
  return { a, b, row, connect, connection, close, loadUserMcpTools, moveToB };
}

function oauthRow(f: ReturnType<typeof fixture>, rotate = false) {
  const { encryptMcpSecretPayload } = require("../mcp-credential-vault");
  if (rotate) process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION = "old";
  const encryptedOAuthCredentials = encryptMcpSecretPayload(
    {
      version: 1,
      redirectUrl: "https://app.example.com/api/mcp/oauth/callback",
      clientInformation: { client_id: "client" },
      tokens: {
        access_token: "old-token",
        token_type: "Bearer",
        scope: "read",
      },
      tokenIssuedAt: Date.now(),
    },
    { userId: "owner-A", url: f.row.url, purpose: "oauth-credentials" },
  );
  process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION = "new";
  return { ...f.row, authKind: "oauth", encryptedOAuthCredentials };
}

test("lazy discovery invoked outside the originating run rechecks A with A's service key", async () => {
  const f = fixture();
  const loaded = await f.loadUserMcpTools("owner-A", ["server"], {
    lazy: true,
  });
  f.moveToB();
  await loaded.discover!("Example");
  expect(f.a.query).toHaveBeenCalledTimes(2);
  expect(f.a.query).toHaveBeenLastCalledWith("list", {
    serviceKey: "service-A",
    userId: "owner-A",
  });
  expect(f.b.query).not.toHaveBeenCalled();
  expect(loaded.tools).toEqual(f.connection.tools);
  await loaded.close();
  expect(f.close).toHaveBeenCalledTimes(1);
});

test("managed GitHub requests stay on the originating owner and database after lazy discovery", async () => {
  const f = fixture();
  const { encryptMcpCredentials } = require("../mcp-credential-vault");
  const url = "https://api.githubcopilot.com/mcp";
  const row = {
    ...f.row,
    url,
    authKind: "bearer",
    encryptedCredentials: encryptMcpCredentials(
      [{ key: "Authorization", value: "rift:github-connection:v1" }],
      { userId: "owner-A", url },
    ),
  };
  f.a.query.mockImplementation(async (ref) =>
    ref === "github-token" ? { token: "token-A" } : [row],
  );
  const loaded = await f.loadUserMcpTools("owner-A", ["server"], {
    lazy: true,
  });
  f.moveToB();
  await loaded.discover!("Example");
  const resolveHeaders = f.connect.mock.calls[0][0].resolveHeaders;
  expect(await resolveHeaders()).toEqual([
    { key: "Authorization", value: "Bearer token-A" },
  ]);
  expect(f.a.query).toHaveBeenLastCalledWith("github-token", {
    serviceKey: "service-A",
    userId: "owner-A",
  });
  expect(f.b.query).not.toHaveBeenCalled();
  await loaded.close();
});

test("discovery still fails closed when ownership is revoked on the originating database", async () => {
  const f = fixture();
  const loaded = await f.loadUserMcpTools("owner-A", ["server"], {
    lazy: true,
  });
  f.a.query.mockResolvedValue([]);
  f.b.query.mockResolvedValue([f.row]);
  f.moveToB();
  await loaded.discover!("Example");
  expect(f.a.query).toHaveBeenCalledTimes(2);
  expect(f.b.query).not.toHaveBeenCalled();
  expect(f.connect).not.toHaveBeenCalled();
  expect(loaded.tools).toEqual({});
  await loaded.close();
});

test("SDK token callback invoked after scope changes persists only on A and retains CAS", async () => {
  const f = fixture();
  f.a.query.mockResolvedValue([oauthRow(f)]);
  const loaded = await f.loadUserMcpTools("owner-A");
  const provider = f.connect.mock.calls[0][0].authProvider;
  f.moveToB();
  await provider.saveTokens({
    access_token: "fresh-token",
    token_type: "Bearer",
    scope: "read write",
  });
  expect(f.a.mutation).toHaveBeenCalledWith(
    "oauth",
    expect.objectContaining({
      serviceKey: "service-A",
      userId: "owner-A",
      id: "server",
      expectedConfigRevision: 5,
      expectedUrl: f.row.url,
      expectedAuthKind: "oauth",
    }),
  );
  expect(f.b.mutation).not.toHaveBeenCalled();
  expect(JSON.stringify(f.a.mutation.mock.calls)).not.toContain("fresh-token");
  f.a.mutation.mockResolvedValueOnce({ success: false });
  await expect(
    provider.saveTokens({
      access_token: "rejected-token",
      token_type: "Bearer",
    }),
  ).rejects.toThrow("could not be persisted");
  expect(f.a.mutation).toHaveBeenLastCalledWith(
    "oauth",
    expect.objectContaining({ expectedConfigRevision: 6 }),
  );
  await loaded.close();
});

test("rotation and health writes retain A when transport completion occurs under B", async () => {
  const f = fixture();
  f.a.query.mockResolvedValue([
    { ...oauthRow(f, true), connectionStatus: "unknown" },
  ]);
  f.connect.mockImplementation(async () => {
    f.moveToB();
    return f.connection;
  });
  const loaded = await f.loadUserMcpTools("owner-A");
  expect(f.a.mutation).toHaveBeenCalledWith(
    "oauth",
    expect.objectContaining({
      serviceKey: "service-A",
      expectedConfigRevision: 5,
    }),
  );
  expect(f.a.mutation).toHaveBeenCalledWith(
    "health",
    expect.objectContaining({
      serviceKey: "service-A",
      userId: "owner-A",
      status: "verified",
      expectedConfigRevision: 6,
    }),
  );
  expect(f.b.mutation).not.toHaveBeenCalled();
  expect(loaded.tools).toEqual(f.connection.tools);
  await loaded.close();
});

function vaultEnvironment() {
  return {
    MCP_CREDENTIALS_ACTIVE_KEY_VERSION:
      process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION,
    MCP_CREDENTIALS_ENCRYPTION_KEYS:
      process.env.MCP_CREDENTIALS_ENCRYPTION_KEYS,
    CONVEX_SERVICE_ROLE_KEY: process.env.CONVEX_SERVICE_ROLE_KEY,
    NODE_ENV: process.env.NODE_ENV,
  };
}
function changeVaultToB(f: ReturnType<typeof fixture>) {
  f.moveToB();
  process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION = "tenant-b";
  process.env.MCP_CREDENTIALS_ENCRYPTION_KEYS = JSON.stringify({
    "tenant-b": Buffer.alloc(32, 9).toString("base64url"),
  });
  return vaultEnvironment();
}

test("OAuth callback encrypts for A after process credentials and keyring change to B", async () => {
  const f = fixture();
  f.a.query.mockResolvedValue([oauthRow(f)]);
  const envA = vaultEnvironment();
  const loaded = await f.loadUserMcpTools("owner-A");
  const provider = f.connect.mock.calls[0][0].authProvider;
  const envB = changeVaultToB(f);
  await provider.saveTokens({
    access_token: "fresh-for-A",
    token_type: "Bearer",
  });
  const payload = f.a.mutation.mock.calls.find(([ref]) => ref === "oauth")![1];
  const { decryptMcpSecretPayload } = require("../mcp-credential-vault");
  const context = {
    userId: "owner-A",
    url: f.row.url,
    purpose: "oauth-credentials",
  };
  expect(
    decryptMcpSecretPayload(payload.encryptedOAuthCredentials, context, envA)
      .tokens.access_token,
  ).toBe("fresh-for-A");
  expect(() =>
    decryptMcpSecretPayload(payload.encryptedOAuthCredentials, context, envB),
  ).toThrow();
  expect(payload.serviceKey).toBe("service-A");
  expect(f.b.mutation).not.toHaveBeenCalled();
  expect(JSON.stringify(loaded)).not.toContain(
    envA.MCP_CREDENTIALS_ENCRYPTION_KEYS,
  );
  await loaded.close();
});

test("lazy OAuth discovery decrypts and rotates with its captured vault after switching to B", async () => {
  const f = fixture();
  f.a.query.mockResolvedValue([oauthRow(f, true)]);
  const envA = vaultEnvironment();
  const loaded = await f.loadUserMcpTools("owner-A", ["server"], {
    lazy: true,
  });
  const envB = changeVaultToB(f);
  await loaded.discover!("Example");
  expect(loaded.tools).toEqual(f.connection.tools);
  const payload = f.a.mutation.mock.calls.find(([ref]) => ref === "oauth")![1];
  expect(payload.encryptedOAuthCredentials.keyVersion).toBe("new");
  const { decryptMcpSecretPayload } = require("../mcp-credential-vault");
  const context = {
    userId: "owner-A",
    url: f.row.url,
    purpose: "oauth-credentials",
  };
  expect(
    decryptMcpSecretPayload(payload.encryptedOAuthCredentials, context, envA)
      .tokens.access_token,
  ).toBe("old-token");
  expect(() =>
    decryptMcpSecretPayload(payload.encryptedOAuthCredentials, context, envB),
  ).toThrow();
  expect(f.a.query).toHaveBeenLastCalledWith("list", {
    serviceKey: "service-A",
    userId: "owner-A",
  });
  expect(f.b.query).not.toHaveBeenCalled();
  expect(f.b.mutation).not.toHaveBeenCalled();
  await loaded.close();
});

test.each([false, true])(
  "lazy header credentials use A for encryption and rotation (encrypted=%p)",
  async (encrypted) => {
    const f = fixture();
    const {
      encryptMcpCredentials,
      decryptMcpCredentials,
    } = require("../mcp-credential-vault");
    const context = { userId: "owner-A", url: f.row.url };
    const headers = [{ key: "Authorization", value: "Bearer header-A" }];
    process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION = "old";
    const encryptedCredentials = encryptMcpCredentials(headers, context);
    process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION = "new";
    f.a.query.mockResolvedValue([
      {
        ...f.row,
        authKind: "bearer",
        ...(encrypted ? { encryptedCredentials } : { headers }),
      },
    ]);
    const envA = vaultEnvironment();
    const loaded = await f.loadUserMcpTools("owner-A", ["server"], {
      lazy: true,
    });
    const envB = changeVaultToB(f);
    await loaded.discover!("Example");
    expect(loaded.tools).toEqual(f.connection.tools);
    const payload = f.a.mutation.mock.calls.find(
      ([ref]) => ref === "credentials",
    )![1];
    expect(payload.encryptedCredentials.keyVersion).toBe("new");
    expect(
      decryptMcpCredentials(payload.encryptedCredentials, context, envA),
    ).toEqual(headers);
    expect(() =>
      decryptMcpCredentials(payload.encryptedCredentials, context, envB),
    ).toThrow();
    expect(payload.serviceKey).toBe("service-A");
    expect(f.b.mutation).not.toHaveBeenCalled();
    await loaded.close();
  },
);
