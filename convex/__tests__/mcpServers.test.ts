import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

jest.mock("../_generated/server", () => ({
  internalMutation: jest.fn((config: any) => config),
  mutation: jest.fn((config: any) => config),
  query: jest.fn((config: any) => config),
}));

jest.mock("convex/values", () => ({
  v: {
    id: jest.fn(() => "id"),
    string: jest.fn(() => "string"),
    number: jest.fn(() => "number"),
    optional: jest.fn(() => "optional"),
    object: jest.fn(() => "object"),
    union: jest.fn(() => "union"),
    array: jest.fn(() => "array"),
    boolean: jest.fn(() => "boolean"),
    null: jest.fn(() => "null"),
    literal: jest.fn(() => "literal"),
  },
  ConvexError: class ConvexError extends Error {
    data: any;

    constructor(data: any) {
      super(typeof data === "string" ? data : data.message);
      this.data = data;
      this.name = "ConvexError";
    }
  },
}));

jest.mock("../lib/utils", () => ({
  validateServiceKey: jest.fn(),
}));

jest.mock("../../lib/ai/mcp/mcp-url-validation", () => ({
  canonicalizeMcpUrl: jest.fn((url: string) => url.trim()),
  McpUrlValidationError: class McpUrlValidationError extends Error {},
}));

const encryptedCredentials = {
  version: 1 as const,
  algorithm: "aes-256-gcm" as const,
  keyVersion: "test-v1",
  iv: "aXY",
  ciphertext: "Y2lwaGVydGV4dA",
  authTag: "dGFn",
};

describe("MCP server persistence", () => {
  it("keeps an unconfigured hosted Browserbase out of the runtime registry, including older workers", async () => {
    const rows = [
      {
        _id: "missing",
        name: "Browserbase",
        url: "https://mcp.browserbase.com/mcp",
        enabled: true,
        transport: "http",
      },
      {
        _id: "public",
        name: "Public",
        url: "https://public.test/mcp",
        enabled: true,
        transport: "http",
      },
      {
        _id: "configured",
        name: "Browserbase configured",
        url: "https://mcp.browserbase.com/mcp",
        enabled: true,
        transport: "http",
        encrypted_credentials: encryptedCredentials,
      },
    ];
    const eq = jest.fn().mockReturnThis();
    const ctx: any = {
      db: {
        query: jest.fn(() => ({
          withIndex: jest.fn((_name: string, predicate: any) => {
            predicate({ eq });
            return { collect: async () => rows };
          }),
        })),
      },
    };
    const { listEnabledForBackend } = await import("../mcpServers");
    const result = await (listEnabledForBackend as any).handler(ctx, {
      serviceKey: "test",
      userId: "owner",
    });
    expect(result.map((row: any) => row._id)).toEqual(["public", "configured"]);
    expect(eq).toHaveBeenCalledWith("user_id", "owner");
    expect(rows[0].enabled).toBe(true);
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("persists only through the service-key guarded verified mutation", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_234);
    const collect = jest.fn<any>().mockResolvedValue([]);
    const withIndex = jest.fn((_name: string, predicate: any) => {
      const range: any = {};
      range.eq = jest.fn(() => range);
      predicate(range);
      return { collect };
    });
    const insert = jest.fn<any>().mockResolvedValue("server-1");
    const ctx: any = {
      db: {
        query: jest.fn(() => ({ withIndex })),
        insert,
      },
    };
    const registryModule = await import("../mcpServers");
    const { validateServiceKey } = await import("../lib/utils");

    expect(
      (registryModule as Record<string, unknown>).addServer,
    ).toBeUndefined();
    await expect(
      (registryModule.addVerifiedServerForBackend as any).handler(ctx, {
        serviceKey: "service-key",
        userId: "user-1",
        name: " GitHub ",
        url: "https://api.githubcopilot.com/mcp/",
        transport: "http",
        encryptedCredentials,
        credentialHeaderKeys: [" Authorization "],
        authKind: "bearer",
        toolCount: 2,
        toolNames: ["mcp_github_get_issue", "mcp_github_list_prs"],
      }),
    ).resolves.toEqual({ success: true, id: "server-1" });

    expect(validateServiceKey).toHaveBeenCalledWith("service-key");
    expect(insert).toHaveBeenCalledWith("mcp_servers", {
      user_id: "user-1",
      catalog_id: undefined,
      name: "GitHub",
      url: "https://api.githubcopilot.com/mcp",
      transport: "http",
      auth_kind: "bearer",
      encrypted_credentials: encryptedCredentials,
      oauth_credentials: undefined,
      oauth_expires_at: undefined,
      oauth_scopes: undefined,
      credential_header_keys: ["Authorization"],
      connection_status: "verified",
      last_checked_at: 1_234,
      tool_count: 2,
      tool_names: ["mcp_github_get_issue", "mcp_github_list_prs"],
      config_revision: 1,
      enabled: true,
      created_at: 1_234,
      updated_at: 1_234,
    });
  });

  it("rejects malformed encrypted credential metadata and duplicate URLs", async () => {
    const existing = {
      _id: "server-existing",
      user_id: "user-1",
      url: "https://example.com/mcp",
    };
    const collect = jest.fn<any>().mockResolvedValue([existing]);
    const withIndex = jest.fn(() => ({ collect }));
    const insert = jest.fn<any>();
    const ctx: any = {
      db: {
        query: jest.fn(() => ({ withIndex })),
        insert,
      },
    };
    const { addVerifiedServerForBackend } = await import("../mcpServers");

    await expect(
      (addVerifiedServerForBackend as any).handler(ctx, {
        serviceKey: "service-key",
        userId: "user-1",
        name: "Unsafe",
        url: "https://other.example/mcp",
        encryptedCredentials,
        credentialHeaderKeys: ["Authorization\r\nHost"],
      }),
    ).resolves.toEqual({
      success: false,
      error: "Invalid authentication metadata",
    });

    await expect(
      (addVerifiedServerForBackend as any).handler(ctx, {
        serviceKey: "service-key",
        userId: "user-1",
        name: "Duplicate",
        url: "https://example.com/mcp",
        toolCount: 1,
        toolNames: ["mcp_duplicate_ping"],
      }),
    ).resolves.toEqual({
      success: false,
      error: "This MCP server is already connected.",
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("never returns stored authentication values to the client query", async () => {
    const collect = jest.fn<any>().mockResolvedValue([
      {
        _id: "server-1",
        name: "GitHub",
        url: "https://example.com/mcp",
        transport: "http",
        enabled: true,
        headers: [{ key: "Authorization", value: "Bearer secret" }],
        created_at: 10,
        updated_at: 20,
      },
      {
        _id: "server-2",
        name: "Encrypted",
        url: "https://encrypted.example/mcp",
        transport: "http",
        enabled: true,
        encrypted_credentials: encryptedCredentials,
        credential_header_keys: ["Authorization"],
        created_at: 30,
        updated_at: 40,
      },
    ]);
    const order = jest.fn(() => ({ collect }));
    const withIndex = jest.fn(() => ({ order }));
    const ctx: any = {
      auth: {
        getUserIdentity: jest
          .fn<any>()
          .mockResolvedValue({ subject: "user-1|session" }),
      },
      db: { query: jest.fn(() => ({ withIndex })) },
    };
    const { listForUser } = await import("../mcpServers");

    const result = await (listForUser as any).handler(ctx, {});

    expect(result).toEqual([
      expect.objectContaining({
        hasAuth: true,
        authKind: "bearer",
        headerKeys: ["Authorization"],
        connectionStatus: "unknown",
        configRevision: 1,
      }),
      expect.objectContaining({
        hasAuth: true,
        authKind: "bearer",
        headerKeys: ["Authorization"],
        connectionStatus: "unknown",
        configRevision: 1,
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("Bearer secret");
    expect(JSON.stringify(result)).not.toContain(
      encryptedCredentials.ciphertext,
    );
  });

  it("records only coarse owned health state and no remote error payload", async () => {
    jest.spyOn(Date, "now").mockReturnValue(4_321);
    const patch = jest.fn<any>();
    const ctx: any = {
      db: {
        get: jest.fn<any>().mockResolvedValue({
          _id: "server-1",
          user_id: "user-1",
          url: "https://example.com/mcp",
          auth_kind: "none",
          config_revision: 3,
        }),
        patch,
      },
    };
    const { recordConnectionHealthForBackend } = await import("../mcpServers");

    await expect(
      (recordConnectionHealthForBackend as any).handler(ctx, {
        serviceKey: "service-key",
        userId: "user-1",
        id: "server-1",
        expectedConfigRevision: 3,
        expectedUrl: "https://example.com/mcp",
        expectedAuthKind: "none",
        status: "needs_attention",
      }),
    ).resolves.toEqual({ success: true, configRevision: 3 });

    expect(patch).toHaveBeenCalledWith("server-1", {
      connection_status: "needs_attention",
      last_checked_at: 4_321,
      updated_at: 4_321,
    });
    expect(JSON.stringify(patch.mock.calls)).not.toContain("Bearer");
    expect(JSON.stringify(patch.mock.calls)).not.toContain("error");
  });

  it("rejects stale runtime health writes before changing the row", async () => {
    const patch = jest.fn<any>();
    const ctx: any = {
      db: {
        get: jest.fn<any>().mockResolvedValue({
          _id: "server-1",
          user_id: "user-1",
          url: "https://new.example/mcp",
          auth_kind: "bearer",
          config_revision: 8,
        }),
        patch,
      },
    };
    const { recordConnectionHealthForBackend } = await import("../mcpServers");

    await expect(
      (recordConnectionHealthForBackend as any).handler(ctx, {
        serviceKey: "service-key",
        userId: "user-1",
        id: "server-1",
        expectedConfigRevision: 7,
        expectedUrl: "https://old.example/mcp",
        expectedAuthKind: "bearer",
        status: "verified",
      }),
    ).resolves.toEqual({
      success: false,
      stale: true,
      error: "Plugin connection changed. Retry with the latest configuration.",
    });
    expect(patch).not.toHaveBeenCalled();
  });

  it("rejects a verified edit whose queried revision lost the race", async () => {
    const patch = jest.fn<any>();
    const query = jest.fn<any>();
    const ctx: any = {
      db: {
        get: jest.fn<any>().mockResolvedValue({
          _id: "server-1",
          user_id: "user-1",
          url: "https://current.example/mcp",
          auth_kind: "none",
          config_revision: 6,
        }),
        query,
        patch,
      },
    };
    const { updateVerifiedServerForBackend } = await import("../mcpServers");

    await expect(
      (updateVerifiedServerForBackend as any).handler(ctx, {
        serviceKey: "service-key",
        userId: "user-1",
        id: "server-1",
        expectedConfigRevision: 5,
        name: "Edited",
        url: "https://edited.example/mcp",
        transport: "http",
        authKind: "none",
        credentialHeaderKeys: [],
        toolCount: 1,
        toolNames: ["mcp_edited_ping"],
      }),
    ).resolves.toEqual({
      success: false,
      stale: true,
      error: "Plugin connection changed. Retry with the latest configuration.",
    });
    expect(query).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("replaces credentials only through the verified encrypted backend mutation", async () => {
    jest.spyOn(Date, "now").mockReturnValue(5_678);
    const patch = jest.fn<any>();
    const ctx: any = {
      db: {
        get: jest.fn<any>().mockResolvedValue({
          _id: "server-1",
          user_id: "user-1",
          url: "https://example.com/mcp",
          credential_header_keys: ["Authorization"],
          config_revision: 4,
        }),
        patch,
      },
    };
    const { updateVerifiedCredentialsForBackend } =
      await import("../mcpServers");
    const { validateServiceKey } = await import("../lib/utils");

    await expect(
      (updateVerifiedCredentialsForBackend as any).handler(ctx, {
        serviceKey: "service-key",
        userId: "user-1",
        id: "server-1",
        expectedConfigRevision: 4,
        expectedUrl: "https://example.com/mcp",
        expectedAuthKind: "bearer",
        encryptedCredentials,
        credentialHeaderKeys: [" X-Workspace ", "Authorization"],
      }),
    ).resolves.toEqual({ success: true, configRevision: 5 });

    expect(validateServiceKey).toHaveBeenCalledWith("service-key");
    expect(patch).toHaveBeenCalledWith("server-1", {
      auth_kind: "bearer",
      encrypted_credentials: encryptedCredentials,
      credential_header_keys: ["X-Workspace", "Authorization"],
      headers: undefined,
      connection_status: "verified",
      last_checked_at: 5_678,
      config_revision: 5,
      updated_at: 5_678,
    });
  });

  it("does not update foreign or unsafe credential records", async () => {
    const patch = jest.fn<any>();
    const ctx: any = {
      db: {
        get: jest.fn<any>().mockResolvedValue({
          _id: "server-1",
          user_id: "another-user",
        }),
        patch,
      },
    };
    const { updateVerifiedCredentialsForBackend } =
      await import("../mcpServers");

    await expect(
      (updateVerifiedCredentialsForBackend as any).handler(ctx, {
        serviceKey: "service-key",
        userId: "user-1",
        id: "server-1",
        expectedConfigRevision: 1,
        expectedUrl: "https://example.com/mcp",
        expectedAuthKind: "bearer",
        encryptedCredentials,
        credentialHeaderKeys: ["Authorization"],
      }),
    ).resolves.toEqual({ success: false, error: "Server not found" });

    ctx.db.get.mockResolvedValueOnce({
      _id: "server-1",
      user_id: "user-1",
      url: "https://example.com/mcp",
      credential_header_keys: ["Authorization"],
      config_revision: 1,
    });
    await expect(
      (updateVerifiedCredentialsForBackend as any).handler(ctx, {
        serviceKey: "service-key",
        userId: "user-1",
        id: "server-1",
        expectedConfigRevision: 1,
        expectedUrl: "https://example.com/mcp",
        expectedAuthKind: "bearer",
        encryptedCredentials,
        credentialHeaderKeys: ["Authorization\r\nX-Injected"],
      }),
    ).resolves.toEqual({
      success: false,
      error: "Invalid encrypted credentials",
    });
    expect(patch).not.toHaveBeenCalled();
  });

  it("persists OAuth only in its purpose-separated encrypted bundle", async () => {
    jest.spyOn(Date, "now").mockReturnValue(7_000);
    const collect = jest.fn<any>().mockResolvedValue([]);
    const withIndex = jest.fn(() => ({ collect }));
    const insert = jest.fn<any>().mockResolvedValue("oauth-server-1");
    const ctx: any = {
      db: {
        query: jest.fn(() => ({ withIndex })),
        insert,
      },
    };
    const { addVerifiedServerForBackend } = await import("../mcpServers");

    await expect(
      (addVerifiedServerForBackend as any).handler(ctx, {
        serviceKey: "service-key",
        userId: "user-1",
        catalogId: "notion",
        name: "Notion",
        url: "https://mcp.notion.com/mcp",
        transport: "http",
        authKind: "oauth",
        encryptedOAuthCredentials: encryptedCredentials,
        credentialHeaderKeys: [],
        oauthExpiresAt: 3_607_000,
        oauthScopes: ["read", "write"],
        toolCount: 1,
        toolNames: ["mcp_notion_search"],
      }),
    ).resolves.toEqual({ success: true, id: "oauth-server-1" });

    expect(insert).toHaveBeenCalledWith(
      "mcp_servers",
      expect.objectContaining({
        auth_kind: "oauth",
        encrypted_credentials: undefined,
        oauth_credentials: encryptedCredentials,
        oauth_expires_at: 3_607_000,
        oauth_scopes: ["read", "write"],
        credential_header_keys: undefined,
      }),
    );
  });

  it("creates and atomically consumes user-bound one-time OAuth state", async () => {
    jest.spyOn(Date, "now").mockReturnValue(10_000);
    const stateHash = "a".repeat(64);
    const insert = jest.fn<any>().mockResolvedValue("session-1");
    const deleteRow = jest.fn<any>();
    const createWithIndex = jest.fn(() => ({
      first: jest.fn<any>().mockResolvedValue(null),
      collect: jest.fn<any>().mockResolvedValue([]),
    }));
    const createCtx: any = {
      db: {
        query: jest.fn(() => ({ withIndex: createWithIndex })),
        insert,
        delete: deleteRow,
      },
    };
    const { createOAuthSessionForBackend, consumeOAuthSessionForBackend } =
      await import("../mcpServers");

    await expect(
      (createOAuthSessionForBackend as any).handler(createCtx, {
        serviceKey: "service-key",
        userId: "user-1",
        stateHash,
        encryptedState: encryptedCredentials,
        expiresAt: 20_000,
      }),
    ).resolves.toEqual({ success: true });
    expect(insert).toHaveBeenCalledWith("mcp_oauth_sessions", {
      user_id: "user-1",
      state_hash: stateHash,
      encrypted_state: encryptedCredentials,
      expires_at: 20_000,
      created_at: 10_000,
    });

    const session = {
      _id: "session-1",
      user_id: "user-1",
      state_hash: stateHash,
      encrypted_state: encryptedCredentials,
      expires_at: 20_000,
      created_at: 10_000,
    };
    const first = jest.fn<any>().mockResolvedValue(session);
    const consumeCtx: any = {
      db: {
        query: jest.fn(() => ({
          withIndex: jest.fn(() => ({ first })),
        })),
        delete: deleteRow,
      },
    };
    await expect(
      (consumeOAuthSessionForBackend as any).handler(consumeCtx, {
        serviceKey: "service-key",
        userId: "user-1",
        stateHash,
      }),
    ).resolves.toEqual({ encryptedState: encryptedCredentials });
    expect(deleteRow).toHaveBeenCalledWith("session-1");

    first.mockResolvedValueOnce({ ...session, user_id: "another-user" });
    deleteRow.mockClear();
    await expect(
      (consumeOAuthSessionForBackend as any).handler(consumeCtx, {
        serviceKey: "service-key",
        userId: "user-1",
        stateHash,
      }),
    ).resolves.toBeNull();
    expect(deleteRow).not.toHaveBeenCalled();
  });

  it("purges expired OAuth state through a bounded expiry index", async () => {
    const expired = Array.from({ length: 3 }, (_, index) => ({
      _id: `session-${index + 1}`,
    }));
    const take = jest.fn<any>().mockResolvedValue(expired);
    const lte = jest.fn<any>();
    lte.mockReturnValue({ lte });
    const withIndex = jest.fn((_name: string, predicate: any) => {
      predicate({ lte });
      return { take };
    });
    const deleteRow = jest.fn<any>();
    const ctx: any = {
      db: {
        query: jest.fn(() => ({ withIndex })),
        delete: deleteRow,
      },
    };
    const { purgeExpiredOAuthSessions } = await import("../mcpServers");

    await expect(
      (purgeExpiredOAuthSessions as any).handler(ctx, {
        now: 20_000,
        limit: 500,
      }),
    ).resolves.toEqual({ deletedCount: 3 });
    expect(withIndex).toHaveBeenCalledWith("by_expiry", expect.any(Function));
    expect(lte).toHaveBeenCalledWith("expires_at", 20_000);
    expect(take).toHaveBeenCalledWith(100);
    expect(deleteRow).toHaveBeenCalledTimes(3);
  });
});
