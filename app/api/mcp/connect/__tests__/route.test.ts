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
import type { NextRequest } from "next/server";

const mockGetUserID = jest.fn();
const mockConnectMcpServer = jest.fn();
const mockClose = jest.fn();
const mockRegistryBinding = jest.fn();
const mockMutation = jest.fn();
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
const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64url");

function request(
  body: string,
  options: { contentLength?: number; contentType?: string } = {},
): NextRequest {
  const headers = new Headers({
    "content-type": options.contentType ?? "application/json",
  });
  if (options.contentLength !== undefined) {
    headers.set("content-length", String(options.contentLength));
  }
  return {
    headers,
    text: jest.fn(async () => body),
  } as unknown as NextRequest;
}

describe("POST /api/mcp/connect", () => {
  beforeAll(() => {
    jest.resetModules();
    jest.doMock("next/server", () => ({
      NextResponse: { json: mockNextResponseJson },
    }));
    jest.doMock("@/lib/auth/get-user-id", () => ({
      getUserID: mockGetUserID,
    }));
    jest.doMock("@/lib/ai/mcp/registry/catalog", () => ({ resolveRegistryBinding: mockRegistryBinding }));
    jest.doMock("@/lib/ai/mcp/mcp-client", () => ({
      connectMcpServer: mockConnectMcpServer,
    }));
    jest.doMock("@/lib/db/convex-client", () => ({
      getConvexClient: () => ({ mutation: mockMutation }),
    }));
    jest.doMock("@/convex/_generated/api", () => ({
      api: {
        mcpServers: {
          addVerifiedServerForBackend: "mcp.addVerifiedServerForBackend",
        },
      },
    }));
    ({ ChatSDKError: RouteChatSDKError } =
      require("@/lib/errors") as typeof import("@/lib/errors"));
    ({ POST } = require("../route") as typeof import("../route"));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRegistryBinding.mockResolvedValue(true as never);
    process.env.CONVEX_SERVICE_ROLE_KEY = "service-key";
    process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION = "test-v1";
    process.env.MCP_CREDENTIALS_ENCRYPTION_KEYS = JSON.stringify({
      "test-v1": TEST_ENCRYPTION_KEY,
    });
    mockGetUserID.mockResolvedValue("user-1" as never);
    mockClose.mockResolvedValue(undefined as never);
    mockConnectMcpServer.mockResolvedValue({
      toolNames: ["mcp_github_get_issue", "mcp_github_list_prs"],
      close: mockClose,
    } as never);
    mockMutation.mockResolvedValue({ success: true, id: "server-1" } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

  it("authenticates before reading or connecting attacker-controlled data", async () => {
    const req = request(
      JSON.stringify({ name: "Test", url: "https://example.com/mcp" }),
    );
    mockGetUserID.mockRejectedValue(
      new RouteChatSDKError("unauthorized:auth") as never,
    );

    const response = await POST(req);

    expect(response.status).toBe(401);
    expect(req.text).not.toHaveBeenCalled();
    expect(mockConnectMcpServer).not.toHaveBeenCalled();
    expect(mockMutation).not.toHaveBeenCalled();
  });

  it("persists only after a successful real handshake", async () => {
    const response = await POST(
      request(
        JSON.stringify({
          name: "GitHub",
          url: "https://api.githubcopilot.com/mcp/",
          transport: "http",
          token: "secret-token",
        }),
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      toolCount: 2,
      toolNames: ["mcp_github_get_issue", "mcp_github_list_prs"],
    });
    expect(mockConnectMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "GitHub",
        url: "https://api.githubcopilot.com/mcp",
        headers: [{ key: "Authorization", value: "Bearer secret-token" }],
      }),
    );
    expect(mockMutation).toHaveBeenCalledWith(
      "mcp.addVerifiedServerForBackend",
      expect.objectContaining({
        serviceKey: "service-key",
        userId: "user-1",
        name: "GitHub",
        authKind: "bearer",
        toolCount: 2,
        toolNames: ["mcp_github_get_issue", "mcp_github_list_prs"],
        credentialHeaderKeys: ["Authorization"],
        encryptedCredentials: expect.objectContaining({
          version: 1,
          algorithm: "aes-256-gcm",
          keyVersion: "test-v1",
        }),
      }),
    );
    const persisted = mockMutation.mock.calls[0]?.[1];
    expect(persisted).not.toHaveProperty("headers");
    expect(JSON.stringify(persisted)).not.toContain("secret-token");
    expect(mockConnectMcpServer.mock.invocationCallOrder[0]).toBeLessThan(
      mockMutation.mock.invocationCallOrder[0],
    );
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("keeps exact catalog bindings and clears custom endpoint identities", async () => {
    const exact = await POST(
      request(
        JSON.stringify({
          catalogId: "github",
          name: "GitHub",
          url: "https://api.githubcopilot.com/mcp",
          token: "secret-token",
        }),
      ),
    );
    expect(exact.status).toBe(200);
    expect(mockMutation).toHaveBeenLastCalledWith(
      "mcp.addVerifiedServerForBackend",
      expect.objectContaining({ catalogId: "github" }),
    );

    const custom = await POST(
      request(
        JSON.stringify({
          catalogId: "github",
          name: "Custom endpoint",
          url: "https://custom.example/mcp",
          token: "secret-token",
        }),
      ),
    );
    expect(custom.status).toBe(200);
    expect(mockMutation).toHaveBeenLastCalledWith(
      "mcp.addVerifiedServerForBackend",
      expect.objectContaining({ catalogId: undefined }),
    );
  });

  it("rejects catalog identities outside the server-owned catalog", async () => {
    const response = await POST(
      request(
        JSON.stringify({
          catalogId: "spoofed-provider",
          name: "Spoofed",
          url: "https://custom.example/mcp",
        }),
      ),
    );

    expect(response.status).toBe(400);
    expect(mockConnectMcpServer).not.toHaveBeenCalled();
    expect(mockMutation).not.toHaveBeenCalled();
  });

  it("fails closed before connecting when authenticated credential storage is unavailable", async () => {
    delete process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION;
    delete process.env.MCP_CREDENTIALS_ENCRYPTION_KEYS;

    const response = await POST(
      request(
        JSON.stringify({
          name: "GitHub",
          url: "https://api.githubcopilot.com/mcp/",
          token: "secret-token",
        }),
      ),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Secure plugin credential storage is unavailable.",
    });
    expect(mockConnectMcpServer).not.toHaveBeenCalled();
    expect(mockMutation).not.toHaveBeenCalled();
  });

  it("never persists a failed or tool-less handshake", async () => {
    mockConnectMcpServer.mockResolvedValueOnce(null as never);
    const failed = await POST(
      request(
        JSON.stringify({ name: "Offline", url: "https://example.com/mcp" }),
      ),
    );
    expect(failed.status).toBe(422);
    expect(mockMutation).not.toHaveBeenCalled();

    mockConnectMcpServer.mockResolvedValueOnce({
      toolNames: [],
      close: mockClose,
    } as never);
    const empty = await POST(
      request(
        JSON.stringify({ name: "Empty", url: "https://example.com/mcp" }),
      ),
    );
    expect(empty.status).toBe(422);
    expect(mockMutation).not.toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("rejects non-JSON and oversized requests before connecting", async () => {
    const wrongType = request("{}", { contentType: "text/plain" });
    expect((await POST(wrongType)).status).toBe(415);
    expect(wrongType.text).not.toHaveBeenCalled();

    const oversized = request("{}", { contentLength: 20_001 });
    expect((await POST(oversized)).status).toBe(413);
    expect(oversized.text).not.toHaveBeenCalled();
    expect(mockConnectMcpServer).not.toHaveBeenCalled();
    expect(mockMutation).not.toHaveBeenCalled();
  });

  it("rejects valid JSON values that are not request objects", async () => {
    for (const body of ["null", "[]", '"server"', "true"]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: "Invalid JSON body.",
      });
    }

    expect(mockConnectMcpServer).not.toHaveBeenCalled();
    expect(mockMutation).not.toHaveBeenCalled();
  });

  it("reports duplicate persistence as a conflict and closes the verified probe", async () => {
    mockMutation.mockResolvedValueOnce({
      success: false,
      error: "This MCP server is already connected.",
    } as never);

    const response = await POST(
      request(
        JSON.stringify({ name: "Duplicate", url: "https://example.com/mcp" }),
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "This MCP server is already connected.",
    });
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("never logs or returns raw third-party error messages", async () => {
    const log = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockConnectMcpServer.mockRejectedValueOnce(
      new Error("Authorization: Bearer secret-token") as never,
    );

    const response = await POST(
      request(
        JSON.stringify({
          name: "Broken",
          url: "https://example.com/mcp",
          token: "secret-token",
        }),
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ ok: false, error: "Plugin connection failed." });
    expect(JSON.stringify(body)).not.toContain("secret-token");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-token");
    log.mockRestore();
  });
  it("persists a Registry identity only after trusted endpoint resolution and tool verification", async () => {
    const catalogId = "registry-1234567890abcdef";
    const response = await POST(request(JSON.stringify({ catalogId, name: "Registry tools", url: "https://example.com/mcp", transport: "http", auth: { kind: "none" } })));
    expect(response.status).toBe(200);
    expect(mockRegistryBinding).toHaveBeenCalledWith({ catalogId, url: "https://example.com/mcp", transport: "http" });
    expect(mockMutation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ catalogId, toolCount: 2 }));
  });
  it("rejects a forged Registry binding before contacting or storing a server", async () => {
    mockRegistryBinding.mockRejectedValue(new Error("mismatch") as never);
    const response = await POST(request(JSON.stringify({ catalogId: "registry-forged", name: "Forged", url: "https://example.com/mcp", auth: { kind: "none" } })));
    expect(response.status).toBe(400);
    expect(mockConnectMcpServer).not.toHaveBeenCalled();
    expect(mockMutation).not.toHaveBeenCalled();
  });

});
