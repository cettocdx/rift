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
const mockConnectMcpServer = jest.fn<any>();
const mockClose = jest.fn<any>();
const mockDecrypt = jest.fn<any>();
const mockEncrypt = jest.fn<any>();
const mockRedirect = jest.fn((url: URL, init?: { status?: number }) => ({
  status: init?.status ?? 307,
  url: url.toString(),
}));
const mockJson = jest.fn((body: unknown, init?: { status?: number }) => ({
  status: init?.status ?? 200,
  json: async () => body,
}));

let GET: typeof import("../route").GET;
const STATE = "s".repeat(43);
const envelope = {
  version: 1 as const,
  algorithm: "aes-256-gcm" as const,
  keyVersion: "test-v1",
  iv: "aXY",
  ciphertext: "Y2lwaGVydGV4dA",
  authTag: "dGFn",
};
const originalEnvironment = {
  serviceKey: process.env.CONVEX_SERVICE_ROLE_KEY,
  appUrl: process.env.NEXT_PUBLIC_APP_URL,
};

function request(query: string, origin = "https://trusted.rift.test") {
  return {
    url: `${origin}/api/mcp/oauth/callback?${query}`,
    headers: new Headers(),
  } as unknown as NextRequest;
}

describe("GET /api/mcp/oauth/callback", () => {
  beforeAll(() => {
    jest.resetModules();
    jest.doMock("server-only", () => ({}), { virtual: true });
    jest.doMock("next/server", () => ({
      NextResponse: { redirect: mockRedirect, json: mockJson },
    }));
    jest.doMock("@modelcontextprotocol/sdk/client/auth.js", () => ({
      auth: mockAuthorize,
    }));
    jest.doMock("@/lib/auth/get-user-id", () => ({
      getUserID: mockGetUserID,
    }));
    jest.doMock("@/lib/db/convex-client", () => ({
      getConvexClient: () => ({ mutation: mockMutation }),
    }));
    jest.doMock("@/lib/ai/mcp/mcp-client", () => ({
      connectMcpServer: mockConnectMcpServer,
    }));
    jest.doMock("@/lib/ai/mcp/mcp-credential-vault", () => ({
      decryptMcpSecretPayload: mockDecrypt,
      encryptMcpSecretPayload: mockEncrypt,
    }));
    jest.doMock("@/convex/_generated/api", () => ({
      api: {
        mcpServers: {
          consumeOAuthSessionForBackend: "mcp.consumeOAuthSession",
          addVerifiedServerForBackend: "mcp.addVerifiedServer",
          updateVerifiedServerForBackend: "mcp.updateVerifiedServer",
        },
      },
    }));
    ({ GET } = require("../route") as typeof import("../route"));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CONVEX_SERVICE_ROLE_KEY = "service-key";
    process.env.NEXT_PUBLIC_APP_URL = "https://trusted.rift.test";
    mockGetUserID.mockResolvedValue("user-1");
    mockMutation.mockImplementation(async (reference: string) => {
      if (reference === "mcp.consumeOAuthSession") {
        return { encryptedState: envelope };
      }
      return { success: true, id: "server-1" };
    });
    mockDecrypt.mockReturnValue({
      version: 1,
      catalogId: "notion",
      name: "Notion",
      url: "https://mcp.notion.com/mcp",
      transport: "http",
      state: STATE,
      redirectUrl: "https://trusted.rift.test/api/mcp/oauth/callback",
      codeVerifier: "v".repeat(43),
      clientInformation: { client_id: "registered-client" },
      createdAt: Date.now(),
    });
    mockEncrypt.mockReturnValue(envelope);
    mockAuthorize.mockImplementation(async (provider: any) => {
      await provider.saveTokens({
        access_token: "access-token",
        refresh_token: "refresh-token",
        token_type: "Bearer",
        expires_in: 3_600,
        scope: "read write",
      });
      return "AUTHORIZED";
    });
    mockClose.mockResolvedValue(undefined);
    mockConnectMcpServer.mockResolvedValue({
      toolNames: ["mcp_notion_search"],
      close: mockClose,
    });
  });

  afterAll(() => {
    if (originalEnvironment.serviceKey === undefined) {
      delete process.env.CONVEX_SERVICE_ROLE_KEY;
    } else {
      process.env.CONVEX_SERVICE_ROLE_KEY = originalEnvironment.serviceKey;
    }
    if (originalEnvironment.appUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalEnvironment.appUrl;
    }
  });

  it("consumes state, exchanges PKCE, probes tools, and only then persists", async () => {
    const response = await GET(
      request(`state=${STATE}&code=authorization-code`),
    );

    expect(response).toEqual({
      status: 303,
      url: "https://trusted.rift.test/plugins?oauth=connected",
    });
    expect(mockMutation).toHaveBeenNthCalledWith(
      1,
      "mcp.consumeOAuthSession",
      expect.objectContaining({
        serviceKey: "service-key",
        userId: "user-1",
        stateHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        serverUrl: "https://mcp.notion.com/mcp",
        authorizationCode: "authorization-code",
      }),
    );
    expect(mockConnectMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Notion",
        authProvider: expect.any(Object),
      }),
    );
    expect(mockMutation).toHaveBeenNthCalledWith(
      2,
      "mcp.addVerifiedServer",
      expect.objectContaining({
        authKind: "oauth",
        encryptedOAuthCredentials: envelope,
        credentialHeaderKeys: [],
        oauthScopes: ["read", "write"],
        toolNames: ["mcp_notion_search"],
      }),
    );
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockMutation.mock.invocationCallOrder[0]).toBeLessThan(
      mockAuthorize.mock.invocationCallOrder[0],
    );
    expect(mockConnectMcpServer.mock.invocationCallOrder[0]).toBeLessThan(
      mockMutation.mock.invocationCallOrder[1],
    );
  });

  it("uses the OAuth-start revision as a CAS when replacing a connection", async () => {
    mockDecrypt.mockReturnValueOnce({
      version: 1,
      catalogId: "notion",
      connectionId: "server-notion",
      expectedConfigRevision: 12,
      name: "Notion",
      url: "https://mcp.notion.com/mcp",
      transport: "http",
      state: STATE,
      redirectUrl: "https://trusted.rift.test/api/mcp/oauth/callback",
      codeVerifier: "v".repeat(43),
      clientInformation: { client_id: "registered-client" },
      createdAt: Date.now(),
    });

    const response = await GET(
      request(`state=${STATE}&code=authorization-code`),
    );

    expect(response).toEqual({
      status: 303,
      url: "https://trusted.rift.test/plugins?oauth=connected",
    });
    expect(mockMutation).toHaveBeenNthCalledWith(
      2,
      "mcp.updateVerifiedServer",
      expect.objectContaining({
        id: "server-notion",
        expectedConfigRevision: 12,
        authKind: "oauth",
      }),
    );
  });

  it("consumes provider-denied callbacks without exchanging or persisting", async () => {
    const response = await GET(request(`state=${STATE}&error=access_denied`));

    expect(response).toEqual({
      status: 303,
      url: "https://trusted.rift.test/plugins?oauth=error&reason=denied",
    });
    expect(mockMutation).toHaveBeenCalledTimes(1);
    expect(mockAuthorize).not.toHaveBeenCalled();
    expect(mockConnectMcpServer).not.toHaveBeenCalled();
  });

  it("rejects replayed/expired state before token exchange", async () => {
    mockMutation.mockResolvedValueOnce(null);
    const response = await GET(request(`state=${STATE}&code=replayed-code`));

    expect(response).toEqual({
      status: 303,
      url: "https://trusted.rift.test/plugins?oauth=error&reason=expired",
    });
    expect(mockAuthorize).not.toHaveBeenCalled();
  });

  it("does not persist an OAuth connection without usable tools", async () => {
    mockConnectMcpServer.mockResolvedValueOnce({
      toolNames: [],
      close: mockClose,
    });
    const response = await GET(request(`state=${STATE}&code=tool-less-code`));

    expect(response).toEqual({
      status: 303,
      url: "https://trusted.rift.test/plugins?oauth=error&reason=unavailable",
    });
    expect(mockMutation).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("reports a verified persistence failure without exposing OAuth secrets", async () => {
    mockMutation
      .mockResolvedValueOnce({ encryptedState: envelope })
      .mockResolvedValueOnce({ success: false, error: "duplicate" });
    const response = await GET(request(`state=${STATE}&code=persist-code`));

    expect(response).toEqual({
      status: 303,
      url: "https://trusted.rift.test/plugins?oauth=error&reason=unavailable",
    });
    expect(JSON.stringify(response)).not.toContain("access-token");
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("never redirects to an attacker-controlled callback Host", async () => {
    const response = await GET(request("state=invalid", "https://evil.test"));

    expect(response).toEqual({
      status: 303,
      url: "https://trusted.rift.test/plugins?oauth=error&reason=invalid",
    });
  });
});
