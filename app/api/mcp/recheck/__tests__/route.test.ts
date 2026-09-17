import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { NextRequest } from "next/server";

jest.mock("server-only", () => ({}), { virtual: true });

const mockGetUserID = jest.fn();
const mockConnectMcpServer = jest.fn();
const mockClose = jest.fn();
const mockQuery = jest.fn();
const mockMutation = jest.fn();
const mockGithubToken = jest.fn();
const mockGithubTokenFactory = jest.fn(() => mockGithubToken);
const mockNextResponseJson = jest.fn(
  (body: unknown, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    json: async () => body,
  }),
);

let POST: typeof import("../route").POST;
let RouteChatSDKError: typeof import("@/lib/errors").ChatSDKError;
const originalServiceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
const originalActiveKeyVersion = process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION;
const originalEncryptionKeys = process.env.MCP_CREDENTIALS_ENCRYPTION_KEYS;
const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64url");

function request(body: string): NextRequest {
  return {
    headers: new Headers({ "content-type": "application/json" }),
    text: jest.fn(async () => body),
  } as unknown as NextRequest;
}

describe("POST /api/mcp/recheck", () => {
  beforeAll(() => {
    jest.resetModules();
    jest.doMock("next/server", () => ({
      NextResponse: { json: mockNextResponseJson },
    }));
    jest.doMock("@/lib/auth/get-user-id", () => ({
      getUserID: mockGetUserID,
    }));
    jest.doMock("@/lib/github/load-user-github-token", () => ({
      createGithubTokenLoader: mockGithubTokenFactory,
    }));
    jest.doMock("@/lib/ai/mcp/mcp-client", () => ({
      connectMcpServer: mockConnectMcpServer,
    }));
    jest.doMock("@/lib/db/convex-client", () => ({
      getConvexClient: () => ({ query: mockQuery, mutation: mockMutation }),
    }));
    jest.doMock("@/convex/_generated/api", () => ({
      api: {
        mcpServers: {
          getForBackend: "mcp.getForBackend",
          recordConnectionHealthForBackend: "mcp.recordHealth",
          updateVerifiedCredentialsForBackend: "mcp.updateCredentials",
          updateVerifiedServerForBackend: "mcp.updateServer",
        },
      },
    }));
    ({ ChatSDKError: RouteChatSDKError } =
      require("@/lib/errors") as typeof import("@/lib/errors"));
    ({ POST } = require("../route") as typeof import("../route"));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CONVEX_SERVICE_ROLE_KEY = "service-key";
    process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION = "test-v1";
    process.env.MCP_CREDENTIALS_ENCRYPTION_KEYS = JSON.stringify({
      "test-v1": TEST_ENCRYPTION_KEY,
    });
    mockGetUserID.mockResolvedValue("user-1" as never);
    mockClose.mockResolvedValue(undefined as never);
    mockQuery.mockResolvedValue({
      _id: "server-1",
      name: "GitHub",
      url: "https://api.githubcopilot.com/mcp/",
      transport: "http",
      catalogId: "github",
      authKind: "bearer",
      configRevision: 4,
      headers: [{ key: "Authorization", value: "Bearer secret-token" }],
    } as never);
    mockConnectMcpServer.mockResolvedValue({
      toolNames: ["mcp_github_get_issue"],
      close: mockClose,
    } as never);
    mockMutation.mockResolvedValue({ success: true } as never);
  });

  afterAll(() => {
    if (originalServiceKey === undefined) {
      delete process.env.CONVEX_SERVICE_ROLE_KEY;
    } else {
      process.env.CONVEX_SERVICE_ROLE_KEY = originalServiceKey;
    }
    if (originalActiveKeyVersion === undefined) {
      delete process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION;
    } else {
      process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION = originalActiveKeyVersion;
    }
    if (originalEncryptionKeys === undefined) {
      delete process.env.MCP_CREDENTIALS_ENCRYPTION_KEYS;
    } else {
      process.env.MCP_CREDENTIALS_ENCRYPTION_KEYS = originalEncryptionKeys;
    }
  });

  it("rechecks a managed GitHub reference with current credentials while keeping the stored reference", async () => {
    const { encryptMcpCredentials, decryptMcpCredentials } =
      await import("@/lib/ai/mcp/mcp-credential-vault");
    const url = "https://api.githubcopilot.com/mcp";
    const headers = [
      { key: "Authorization", value: "rift:github-connection:v1" },
    ];
    mockQuery.mockResolvedValue({
      _id: "server-1",
      name: "GitHub",
      url,
      transport: "http",
      catalogId: "github",
      authKind: "bearer",
      configRevision: 4,
      encryptedCredentials: encryptMcpCredentials(headers, {
        userId: "user-1",
        url,
      }),
    } as never);
    mockGithubToken.mockResolvedValue({ token: "fresh-token" } as never);
    const result = await POST(request(JSON.stringify({ id: "server-1" })));
    expect(result.status).toBe(200);
    const config = mockConnectMcpServer.mock.calls[0][0] as {
      headers?: unknown;
      resolveHeaders?: () => Promise<unknown>;
    };
    expect(config.headers).toBeUndefined();
    expect(await config.resolveHeaders!()).toEqual([
      { key: "Authorization", value: "Bearer fresh-token" },
    ]);
    const write = mockMutation.mock.calls.find(
      ([ref]) => ref === "mcp.updateServer",
    )![1] as { encryptedCredentials: unknown };
    expect(
      decryptMcpCredentials(write.encryptedCredentials, {
        userId: "user-1",
        url,
      }),
    ).toEqual(headers);
    expect(JSON.stringify(mockMutation.mock.calls)).not.toContain(
      "fresh-token",
    );
  });

  it("authenticates before reading the id or persisted credentials", async () => {
    const req = request(JSON.stringify({ id: "server-1" }));
    mockGetUserID.mockRejectedValue(
      new RouteChatSDKError("unauthorized:auth") as never,
    );

    const response = await POST(req);

    expect(response.status).toBe(401);
    expect(req.text).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockConnectMcpServer).not.toHaveBeenCalled();
    expect(mockMutation).not.toHaveBeenCalled();
  });

  it("rechecks with server-only credentials and returns no secret material", async () => {
    const response = await POST(request(JSON.stringify({ id: "server-1" })));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      toolCount: 1,
      toolNames: ["mcp_github_get_issue"],
    });
    expect(JSON.stringify(body)).not.toContain("secret-token");
    expect(mockConnectMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "server-1",
        headers: [{ key: "Authorization", value: "Bearer secret-token" }],
      }),
    );
    expect(mockMutation).toHaveBeenCalledWith(
      "mcp.updateServer",
      expect.objectContaining({
        serviceKey: "service-key",
        userId: "user-1",
        id: "server-1",
        expectedConfigRevision: 4,
        catalogId: "github",
        authKind: "bearer",
        toolCount: 1,
        toolNames: ["mcp_github_get_issue"],
        credentialHeaderKeys: ["Authorization"],
        encryptedCredentials: expect.objectContaining({
          algorithm: "aes-256-gcm",
          keyVersion: "test-v1",
        }),
      }),
    );
    expect(JSON.stringify(mockMutation.mock.calls)).not.toContain(
      "secret-token",
    );
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("probes fresh credentials before replacing the persisted token", async () => {
    mockQuery.mockResolvedValueOnce({
      _id: "server-1",
      name: "GitHub",
      url: "https://api.githubcopilot.com/mcp/",
      transport: "http",
      catalogId: "github",
      authKind: "bearer",
      configRevision: 4,
      headers: [
        { key: "X-Workspace", value: "workspace-1" },
        { key: "Authorization", value: "Bearer expired-token" },
      ],
    } as never);

    const response = await POST(
      request(JSON.stringify({ id: "server-1", token: " fresh-token " })),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      toolCount: 1,
      toolNames: ["mcp_github_get_issue"],
    });
    expect(JSON.stringify(body)).not.toContain("fresh-token");
    expect(mockConnectMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: [
          { key: "X-Workspace", value: "workspace-1" },
          { key: "Authorization", value: "Bearer fresh-token" },
        ],
      }),
    );
    expect(mockMutation).toHaveBeenCalledWith(
      "mcp.updateServer",
      expect.objectContaining({
        serviceKey: "service-key",
        userId: "user-1",
        id: "server-1",
        credentialHeaderKeys: ["X-Workspace", "Authorization"],
        encryptedCredentials: expect.objectContaining({
          algorithm: "aes-256-gcm",
          keyVersion: "test-v1",
        }),
      }),
    );
    expect(JSON.stringify(mockMutation.mock.calls)).not.toContain(
      "fresh-token",
    );
    expect(mockConnectMcpServer.mock.invocationCallOrder[0]).toBeLessThan(
      mockMutation.mock.invocationCallOrder[0],
    );
  });

  it("decrypts an encrypted row only inside the server route", async () => {
    const { encryptMcpCredentials } =
      await import("@/lib/ai/mcp/mcp-credential-vault");
    const encryptedCredentials = encryptMcpCredentials(
      [{ key: "Authorization", value: "Bearer encrypted-secret" }],
      {
        userId: "user-1",
        url: "https://api.githubcopilot.com/mcp/",
      },
    );
    mockQuery.mockResolvedValueOnce({
      _id: "server-1",
      name: "GitHub",
      url: "https://api.githubcopilot.com/mcp/",
      transport: "http",
      catalogId: "github",
      authKind: "bearer",
      configRevision: 4,
      encryptedCredentials,
      credentialHeaderKeys: ["Authorization"],
    } as never);

    const response = await POST(request(JSON.stringify({ id: "server-1" })));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockConnectMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: [{ key: "Authorization", value: "Bearer encrypted-secret" }],
      }),
    );
    expect(JSON.stringify(body)).not.toContain("encrypted-secret");
    expect(JSON.stringify(mockMutation.mock.calls)).not.toContain(
      "encrypted-secret",
    );
  });

  it("never falls back to legacy plaintext when an encrypted envelope is invalid", async () => {
    mockQuery.mockResolvedValueOnce({
      _id: "server-1",
      name: "GitHub",
      url: "https://api.githubcopilot.com/mcp/",
      transport: "http",
      catalogId: "github",
      authKind: "bearer",
      configRevision: 4,
      headers: [{ key: "Authorization", value: "Bearer legacy-secret" }],
      encryptedCredentials: {
        version: 1,
        algorithm: "aes-256-gcm",
        keyVersion: "test-v1",
        iv: "invalid",
        ciphertext: "invalid",
        authTag: "invalid",
      },
    } as never);

    const response = await POST(request(JSON.stringify({ id: "server-1" })));

    expect(response.status).toBe(500);
    expect(mockConnectMcpServer).not.toHaveBeenCalled();
    expect(mockMutation).toHaveBeenCalledWith("mcp.recordHealth", {
      serviceKey: "service-key",
      userId: "user-1",
      id: "server-1",
      expectedConfigRevision: 4,
      expectedUrl: "https://api.githubcopilot.com/mcp/",
      expectedAuthKind: "bearer",
      status: "needs_attention",
    });
  });

  it("never stores a fresh token when the encryption keyring is unavailable", async () => {
    delete process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION;
    delete process.env.MCP_CREDENTIALS_ENCRYPTION_KEYS;

    const response = await POST(
      request(JSON.stringify({ id: "server-1", token: "fresh-token" })),
    );

    expect(response.status).toBe(503);
    expect(mockConnectMcpServer).not.toHaveBeenCalled();
    expect(mockMutation).not.toHaveBeenCalled();
  });

  it("never saves a fresh token when its handshake fails", async () => {
    mockConnectMcpServer.mockResolvedValueOnce(null as never);

    const response = await POST(
      request(JSON.stringify({ id: "server-1", token: "rejected-token" })),
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(mockMutation).toHaveBeenCalledTimes(1);
    expect(mockMutation).toHaveBeenCalledWith("mcp.recordHealth", {
      serviceKey: "service-key",
      userId: "user-1",
      id: "server-1",
      expectedConfigRevision: 4,
      expectedUrl: "https://api.githubcopilot.com/mcp/",
      expectedAuthKind: "bearer",
      status: "needs_attention",
    });
    expect(JSON.stringify(mockMutation.mock.calls)).not.toContain(
      "rejected-token",
    );
    expect(JSON.stringify(body)).not.toContain("rejected-token");
  });

  it("rejects malformed fresh tokens before reading stored credentials", async () => {
    const wrongType = await POST(
      request(JSON.stringify({ id: "server-1", token: 123 })),
    );
    expect(wrongType.status).toBe(400);

    const controlCharacter = await POST(
      request(JSON.stringify({ id: "server-1", token: "token\nInjected" })),
    );
    expect(controlCharacter.status).toBe(400);

    const tooLarge = await POST(
      request(JSON.stringify({ id: "server-1", token: "x".repeat(16_385) })),
    );
    expect(tooLarge.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockConnectMcpServer).not.toHaveBeenCalled();
    expect(mockMutation).not.toHaveBeenCalled();
  });

  it("marks failed authentication as needs attention without persisting an error", async () => {
    mockConnectMcpServer.mockResolvedValueOnce(null as never);

    const response = await POST(request(JSON.stringify({ id: "server-1" })));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toEqual({
      ok: false,
      error:
        "This plugin could not authenticate. Update its credentials and try again.",
    });
    expect(mockMutation).toHaveBeenCalledWith("mcp.recordHealth", {
      serviceKey: "service-key",
      userId: "user-1",
      id: "server-1",
      expectedConfigRevision: 4,
      expectedUrl: "https://api.githubcopilot.com/mcp/",
      expectedAuthKind: "bearer",
      status: "needs_attention",
    });
    expect(JSON.stringify(mockMutation.mock.calls)).not.toContain("error");
    expect(JSON.stringify(mockMutation.mock.calls)).not.toContain(
      "secret-token",
    );
  });

  it("best-effort marks a thrown handshake as needs attention without leaking its error", async () => {
    mockConnectMcpServer.mockRejectedValueOnce(
      new Error("Network failure for Bearer secret-token") as never,
    );
    mockMutation.mockRejectedValueOnce(
      new Error("Health storage unavailable") as never,
    );
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const response = await POST(request(JSON.stringify({ id: "server-1" })));
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({
        ok: false,
        error: "Plugin verification failed.",
      });
      expect(mockMutation).toHaveBeenCalledWith("mcp.recordHealth", {
        serviceKey: "service-key",
        userId: "user-1",
        id: "server-1",
        expectedConfigRevision: 4,
        expectedUrl: "https://api.githubcopilot.com/mcp/",
        expectedAuthKind: "bearer",
        status: "needs_attention",
      });
      expect(consoleError).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "mcp_recheck_failed",
          failure_stage: "handshake",
        }),
      );
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(JSON.stringify(mockMutation.mock.calls)).not.toContain(
        "secret-token",
      );
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
        "secret-token",
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
