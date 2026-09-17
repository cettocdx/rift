import { afterEach, jest } from "@jest/globals";

jest.mock("server-only", () => ({}), { virtual: true });

import {
  assertMcpOAuthCredentialSnapshot,
  mcpOAuthExpiresAt,
  mcpOAuthScopes,
  PersistedMcpOAuthProvider,
  resolveMcpOAuthCallbackUrl,
  resolveMcpPluginsUrl,
  validateMcpOAuthAuthorizationUrl,
} from "../mcp-oauth";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MCP OAuth provider", () => {
  it("captures DCR, PKCE, authorization URL, and token snapshots", async () => {
    const onTokensChanged = jest.fn(async () => undefined);
    const provider = new PersistedMcpOAuthProvider({
      redirectUrl: "https://app.rift.test/api/mcp/oauth/callback",
      state: "s".repeat(43),
      onTokensChanged,
    });
    provider.saveClientInformation({
      client_id: "client-1",
      client_secret: "client-secret",
    });
    provider.saveCodeVerifier("v".repeat(43));
    provider.redirectToAuthorization(
      new URL(
        `https://auth.example/authorize?state=${"s".repeat(43)}&code_challenge=challenge`,
      ),
    );

    expect(
      validateMcpOAuthAuthorizationUrl(
        provider.authorizationUrl(),
        "s".repeat(43),
      ),
    ).toContain("code_challenge=challenge");
    expect(
      provider.pendingSession({
        catalogId: "notion",
        name: "Notion",
        url: "https://mcp.notion.com/mcp",
        transport: "http",
      }),
    ).toEqual(
      expect.objectContaining({
        state: "s".repeat(43),
        codeVerifier: "v".repeat(43),
        clientInformation: expect.objectContaining({ client_id: "client-1" }),
      }),
    );

    jest.spyOn(Date, "now").mockReturnValue(10_000);
    await provider.saveTokens({
      access_token: "access-token",
      refresh_token: "refresh-token",
      token_type: "Bearer",
      expires_in: 3_600,
      scope: "read write read",
    });
    const snapshot = provider.credentialSnapshot();
    expect(mcpOAuthExpiresAt(snapshot)).toBe(3_610_000);
    expect(mcpOAuthScopes(snapshot)).toEqual(["read", "write"]);
    expect(onTokensChanged).toHaveBeenCalledWith(snapshot);
  });

  it("rejects malformed persisted credential snapshots", () => {
    expect(() =>
      assertMcpOAuthCredentialSnapshot({
        version: 1,
        redirectUrl: "https://app.rift.test/api/mcp/oauth/callback",
        clientInformation: { client_id: "client" },
        tokens: {
          access_token: "",
          token_type: "Bearer",
        },
        tokenIssuedAt: Date.now(),
      }),
    ).toThrow(/credentials/i);
  });
});

describe("MCP OAuth trusted app URLs", () => {
  const production = {
    NODE_ENV: "production",
    NEXT_PUBLIC_APP_URL: "https://trusted.rift.test/app/path",
  };

  it("ignores an attacker-controlled request Host when a trusted base exists", () => {
    expect(
      resolveMcpOAuthCallbackUrl(
        "https://attacker.example/api/mcp/oauth/start",
        production,
      ),
    ).toBe("https://trusted.rift.test/api/mcp/oauth/callback");
    expect(
      resolveMcpPluginsUrl(
        "https://attacker.example/api/mcp/oauth/callback",
        production,
      ).toString(),
    ).toBe("https://trusted.rift.test/plugins");
  });

  it("requires configured public origin outside localhost development", () => {
    expect(() =>
      resolveMcpOAuthCallbackUrl(
        "https://attacker.example/api/mcp/oauth/start",
        { NODE_ENV: "production" },
      ),
    ).toThrow(/not configured/i);
  });

  it("allows request-origin fallback only for explicit localhost development", () => {
    expect(
      resolveMcpOAuthCallbackUrl("http://localhost:3010/api/mcp/oauth/start", {
        NODE_ENV: "development",
      }),
    ).toBe("http://localhost:3010/api/mcp/oauth/callback");
    expect(() =>
      resolveMcpOAuthCallbackUrl("https://rift.test/api/mcp/oauth/start", {
        NODE_ENV: "development",
      }),
    ).toThrow(/not configured/i);
  });
});
