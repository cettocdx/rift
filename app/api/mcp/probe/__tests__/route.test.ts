import {
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
const mockNextResponseJson = jest.fn(
  (body: unknown, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    json: async () => body,
  }),
);

let POST: typeof import("../route").POST;
let RouteChatSDKError: typeof import("@/lib/errors").ChatSDKError;

function request(body: string, contentLength?: number): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (contentLength !== undefined) {
    headers.set("content-length", String(contentLength));
  }
  return {
    headers,
    text: jest.fn(async () => body),
  } as unknown as NextRequest;
}

describe("POST /api/mcp/probe", () => {
  beforeAll(() => {
    jest.resetModules();
    jest.doMock("next/server", () => ({
      NextResponse: { json: mockNextResponseJson },
    }));
    jest.doMock("@/lib/auth/get-user-id", () => ({
      getUserID: mockGetUserID,
    }));
    jest.doMock("@/lib/ai/mcp/mcp-client", () => ({
      connectMcpServer: mockConnectMcpServer,
    }));
    ({ ChatSDKError: RouteChatSDKError } =
      require("@/lib/errors") as typeof import("@/lib/errors"));
    ({ POST } = require("../route") as typeof import("../route"));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserID.mockResolvedValue("user-1" as never);
    mockClose.mockResolvedValue(undefined as never);
    mockConnectMcpServer.mockResolvedValue({
      toolNames: ["mcp_github_get_issue", "mcp_github_list_prs"],
      close: mockClose,
    } as never);
  });

  it("authenticates before reading attacker-controlled connection data", async () => {
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
  });

  it("explains missing required credentials rather than reporting a successful tool listing", async () => {
    const { McpConfigurationError } = require("@/lib/ai/mcp/mcp-configuration");
    mockConnectMcpServer.mockRejectedValueOnce(
      new McpConfigurationError() as never,
    );
    const response = await POST(
      request(
        JSON.stringify({
          name: "Browserbase",
          url: "https://mcp.browserbase.com/mcp",
        }),
      ),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "credentials_required",
      error: expect.stringContaining("API key"),
    });
  });

  it("performs a real handshake with the shared safe MCP client", async () => {
    const req = request(
      JSON.stringify({
        name: "GitHub",
        url: "https://api.githubcopilot.com/mcp/",
        transport: "http",
        token: "secret-token",
      }),
    );

    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      toolCount: 2,
      toolNames: ["mcp_github_get_issue", "mcp_github_list_prs"],
      tools: ["mcp_github_get_issue", "mcp_github_list_prs"],
    });
    expect(mockConnectMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "GitHub",
        url: "https://api.githubcopilot.com/mcp/",
        transport: "http",
        headers: [{ key: "Authorization", value: "Bearer secret-token" }],
      }),
    );
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("does not report a plugin as connected when the handshake fails", async () => {
    mockConnectMcpServer.mockResolvedValue(null as never);

    const response = await POST(
      request(
        JSON.stringify({
          name: "Unavailable",
          url: "https://example.com/mcp",
        }),
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/handshake/i);
  });

  it("rejects malformed and oversized requests before connecting", async () => {
    const malformed = await POST(request("{"));
    expect(malformed.status).toBe(400);

    const oversizedRequest = request("{}", 20_001);
    const oversized = await POST(oversizedRequest);
    expect(oversized.status).toBe(413);
    expect(oversizedRequest.text).not.toHaveBeenCalled();
    expect(mockConnectMcpServer).not.toHaveBeenCalled();
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
  });

  it("never logs or returns raw third-party error messages", async () => {
    const log = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockConnectMcpServer.mockRejectedValueOnce(
      new Error("Authorization: Bearer secret-token") as never,
    );

    try {
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
      expect(body).toEqual({
        ok: false,
        error: "Plugin connection test failed.",
      });
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "mcp_probe_failed",
          error_name: "Error",
        }),
      );
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret-token");
    } finally {
      log.mockRestore();
    }
  });
});
