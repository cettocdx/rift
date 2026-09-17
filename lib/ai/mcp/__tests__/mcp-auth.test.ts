import { describe, expect, it } from "@jest/globals";

import {
  McpAuthValidationError,
  inferMcpAuthKindFromHeaders,
  normalizeMcpAuth,
} from "../mcp-auth";

describe("MCP authentication contract", () => {
  it("supports public, bearer, API-key header, and the legacy token shape", () => {
    expect(normalizeMcpAuth({ kind: "none" })).toEqual({ kind: "none" });
    expect(normalizeMcpAuth({ kind: "bearer", secret: " token " })).toEqual({
      kind: "bearer",
      headers: [{ key: "Authorization", value: "Bearer token" }],
    });
    expect(
      normalizeMcpAuth({
        kind: "api_key_header",
        headerName: "X-API-Key",
        secret: " key ",
      }),
    ).toEqual({
      kind: "api_key_header",
      headers: [{ key: "X-API-Key", value: "key" }],
    });
    expect(normalizeMcpAuth(undefined, " legacy ")).toEqual({
      kind: "bearer",
      headers: [{ key: "Authorization", value: "Bearer legacy" }],
    });
  });

  it("rejects malformed secrets and routing/session headers", () => {
    for (const auth of [
      { kind: "bearer", secret: "" },
      { kind: "bearer", secret: "token\nInjected" },
      { kind: "api_key_header", headerName: "Host", secret: "x" },
      { kind: "api_key_header", headerName: "Cookie", secret: "x" },
      { kind: "api_key_header", headerName: "Bad Header", secret: "x" },
      { kind: "none", secret: "unexpected" },
      { kind: "oauth", secret: "x" },
    ]) {
      expect(() => normalizeMcpAuth(auth)).toThrow(McpAuthValidationError);
    }
  });

  it("infers safe legacy auth metadata without exposing values", () => {
    expect(inferMcpAuthKindFromHeaders()).toBe("none");
    expect(inferMcpAuthKindFromHeaders([{ key: "authorization" }])).toBe(
      "bearer",
    );
    expect(inferMcpAuthKindFromHeaders([{ key: "X-API-Key" }])).toBe(
      "api_key_header",
    );
  });
});
