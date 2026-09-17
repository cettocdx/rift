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

const mockAuthorize = jest.fn<any>();
const mockGetUserID = jest.fn<any>();
const mockMutation = jest.fn<any>();
const mockQuery = jest.fn<any>();
const mockNextResponseJson = jest.fn(
  (body: unknown, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    json: async () => body,
  }),
);

let POST: typeof import("../route").POST;
const originalEnvironment = {
  serviceKey: process.env.CONVEX_SERVICE_ROLE_KEY,
  activeKey: process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION,
  keyring: process.env.MCP_CREDENTIALS_ENCRYPTION_KEYS,
  appUrl: process.env.NEXT_PUBLIC_APP_URL,
  baseUrl: process.env.NEXT_PUBLIC_BASE_URL,
  callbackUrl: process.env.MCP_OAUTH_CALLBACK_URL,
};

function request(body: unknown, url = "https://host-header.invalid/plugins") {
  return {
    url,
    headers: new Headers({ "content-type": "application/json" }),
    text: jest.fn(async () => JSON.stringify(body)),
  } as unknown as NextRequest;
}

describe("POST /api/mcp/oauth/start", () => {
  beforeAll(() => {
    jest.resetModules();
    jest.doMock("server-only", () => ({}), { virtual: true });
    jest.doMock("next/server", () => ({
      NextResponse: { json: mockNextResponseJson },
    }));
    jest.doMock("@modelcontextprotocol/sdk/client/auth.js", () => ({
      auth: mockAuthorize,
    }));
    jest.doMock("@/lib/auth/get-user-id", () => ({
      getUserID: mockGetUserID,
    }));
    jest.doMock("@/lib/db/convex-client", () => ({
      getConvexClient: () => ({ mutation: mockMutation, query: mockQuery }),
    }));
    jest.doMock("@/convex/_generated/api", () => ({
      api: {
        mcpServers: {
          getForBackend: "mcp.getForBackend",
          createOAuthSessionForBackend: "mcp.createOAuthSession",
        },
      },
    }));
    ({ POST } = require("../route") as typeof import("../route"));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CONVEX_SERVICE_ROLE_KEY = "service-key";
    process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION = "test-v1";
    process.env.MCP_CREDENTIALS_ENCRYPTION_KEYS = JSON.stringify({
      "test-v1": Buffer.alloc(32, 9).toString("base64url"),
    });
    process.env.NEXT_PUBLIC_APP_URL = "https://trusted.rift.test";
    delete process.env.NEXT_PUBLIC_BASE_URL;
    delete process.env.MCP_OAUTH_CALLBACK_URL;
    mockGetUserID.mockResolvedValue("user-1");
    mockMutation.mockResolvedValue({ success: true });
    mockQuery.mockResolvedValue(null);
    mockAuthorize.mockImplementation(async (provider: any) => {
      const state = await provider.state();
      provider.saveDiscoveryState({
        authorizationServerUrl: "https://auth.provider.test",
      });
      provider.saveClientInformation({ client_id: "registered-client" });
      provider.saveCodeVerifier("v".repeat(43));
      provider.redirectToAuthorization(
        new URL(
          `https://auth.provider.test/authorize?state=${state}&code_challenge=challenge`,
        ),
      );
      return "REDIRECT";
    });
  });

  afterAll(() => {
    for (const [key, value] of [
      ["CONVEX_SERVICE_ROLE_KEY", originalEnvironment.serviceKey],
      ["MCP_CREDENTIALS_ACTIVE_KEY_VERSION", originalEnvironment.activeKey],
      ["MCP_CREDENTIALS_ENCRYPTION_KEYS", originalEnvironment.keyring],
      ["NEXT_PUBLIC_APP_URL", originalEnvironment.appUrl],
      ["NEXT_PUBLIC_BASE_URL", originalEnvironment.baseUrl],
      ["MCP_OAUTH_CALLBACK_URL", originalEnvironment.callbackUrl],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("uses a trusted configured callback despite an attacker-controlled request Host", async () => {
    let observedRedirectUrl = "";
    mockAuthorize.mockImplementationOnce(async (provider: any) => {
      observedRedirectUrl = String(provider.redirectUrl);
      const state = await provider.state();
      provider.saveClientInformation({ client_id: "registered-client" });
      provider.saveCodeVerifier("v".repeat(43));
      provider.redirectToAuthorization(
        new URL(
          `https://auth.provider.test/authorize?state=${state}&code_challenge=challenge`,
        ),
      );
      return "REDIRECT";
    });

    const response = await POST(
      request({
        catalogId: "notion",
        name: "Notion",
        url: "https://mcp.notion.com/mcp",
        transport: "http",
      }),
    );

    expect(response.status).toBe(200);
    expect(observedRedirectUrl).toBe(
      "https://trusted.rift.test/api/mcp/oauth/callback",
    );
    expect(mockMutation).toHaveBeenCalledWith(
      "mcp.createOAuthSession",
      expect.objectContaining({
        userId: "user-1",
        stateHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        encryptedState: expect.objectContaining({
          version: 1,
          algorithm: "aes-256-gcm",
        }),
      }),
    );
  });

  it("binds reconnect OAuth state to the queried configuration revision", async () => {
    mockQuery.mockResolvedValueOnce({ configRevision: 12 });
    const response = await POST(
      request({
        catalogId: "notion",
        connectionId: "server-notion",
        name: "Notion",
        url: "https://mcp.notion.com/mcp",
        transport: "http",
      }),
    );

    expect(response.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith("mcp.getForBackend", {
      serviceKey: "service-key",
      userId: "user-1",
      id: "server-notion",
    });
    const stored = mockMutation.mock.calls.at(-1)?.[1];
    const { decryptMcpSecretPayload } =
      await import("@/lib/ai/mcp/mcp-credential-vault");
    const { MCP_OAUTH_SESSION_BINDING } =
      await import("@/lib/ai/mcp/mcp-oauth");
    const pending = decryptMcpSecretPayload(stored.encryptedState, {
      userId: "user-1",
      url: MCP_OAUTH_SESSION_BINDING,
      purpose: "oauth-session",
    });
    expect(pending).toEqual(
      expect.objectContaining({
        connectionId: "server-notion",
        expectedConfigRevision: 12,
      }),
    );
  });

  it("rejects a fixed catalog provider URL mismatch before discovery", async () => {
    const response = await POST(
      request({
        catalogId: "notion",
        name: "Notion",
        url: "https://attacker.example/mcp",
        transport: "http",
      }),
    );

    expect(response.status).toBe(400);
    expect(mockAuthorize).not.toHaveBeenCalled();
    expect(mockMutation).not.toHaveBeenCalled();
  });

  it("preserves generic OAuth for known endpoint-required providers", async () => {
    const response = await POST(
      request({
        catalogId: "gitlab",
        name: "Company GitLab",
        url: "https://gitlab.example.com/api/mcp",
        transport: "sse",
      }),
    );

    expect(response.status).toBe(200);
    expect(mockAuthorize).toHaveBeenCalledTimes(1);
  });

  it("fails closed without a trusted production app origin", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const response = await POST(
      request({
        catalogId: "notion",
        name: "Notion",
        url: "https://mcp.notion.com/mcp",
        transport: "http",
      }),
    );

    expect(response.status).toBe(503);
    expect(mockAuthorize).not.toHaveBeenCalled();
  });
});
