import { describe, expect, it } from "@jest/globals";
import type { NextRequest } from "next/server";

import {
  assertSameOriginMcpMutation,
  McpRequestPolicyError,
} from "../mcp-request-policy";

function request(headers: HeadersInit = {}): NextRequest {
  return {
    url: "https://rift.example/api/mcp/connect",
    headers: new Headers(headers),
  } as NextRequest;
}

describe("MCP mutation origin policy", () => {
  it("allows same-origin browsers and provenance-less API clients", () => {
    expect(() => assertSameOriginMcpMutation(request())).not.toThrow();
    expect(() =>
      assertSameOriginMcpMutation(
        request({
          origin: "https://rift.example",
          "sec-fetch-site": "same-origin",
        }),
      ),
    ).not.toThrow();
  });

  it("rejects cross-origin and malformed browser provenance", () => {
    expect(() =>
      assertSameOriginMcpMutation(
        request({
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        }),
      ),
    ).toThrow(McpRequestPolicyError);
    expect(() =>
      assertSameOriginMcpMutation(request({ origin: "not a url" })),
    ).toThrow(McpRequestPolicyError);
  });
});
