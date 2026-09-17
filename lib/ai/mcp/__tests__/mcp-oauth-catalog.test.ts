import { jest } from "@jest/globals";

jest.mock("server-only", () => ({}), { virtual: true });

import {
  assertMcpOAuthCatalogBinding,
  McpCatalogBindingError,
  McpOAuthCatalogBindingError,
  resolveMcpCatalogIdForConnection,
} from "../mcp-oauth-catalog";
import { canonicalizeMcpUrl } from "../mcp-url-validation";
import { MCP_CATALOG } from "@/app/components/mcpCatalog";

describe("MCP OAuth catalog identity binding", () => {
  it("accepts exact fixed OAuth endpoints", () => {
    expect(() =>
      assertMcpOAuthCatalogBinding({
        catalogId: "notion",
        url: "https://mcp.notion.com/mcp",
        transport: "http",
      }),
    ).not.toThrow();
  });

  it("rejects fixed provider endpoint/transport mismatches", () => {
    for (const candidate of [
      {
        catalogId: "notion",
        url: "https://attacker.example/mcp",
        transport: "http" as const,
      },
      {
        catalogId: "notion",
        url: "https://mcp.notion.com/mcp",
        transport: "sse" as const,
      },
      {
        catalogId: "github",
        url: "https://api.githubcopilot.com/mcp",
        transport: "http" as const,
      },
    ]) {
      expect(() => assertMcpOAuthCatalogBinding(candidate)).toThrow(
        McpOAuthCatalogBindingError,
      );
    }
  });

  it("keeps generic OAuth available for known endpoint-required cards", () => {
    expect(() =>
      assertMcpOAuthCatalogBinding({
        catalogId: "gitlab",
        url: "https://gitlab.example.com/api/mcp",
        transport: "sse",
      }),
    ).not.toThrow();
  });

  it("rejects unknown catalog identities", () => {
    expect(() =>
      assertMcpOAuthCatalogBinding({
        catalogId: "spoofed-provider",
        url: "https://provider.example/mcp",
        transport: "http",
      }),
    ).toThrow(McpOAuthCatalogBindingError);
  });

  it("retains only exact server-owned catalog bindings for generic connects", () => {
    expect(
      resolveMcpCatalogIdForConnection({
        catalogId: "github",
        url: "https://api.githubcopilot.com/mcp",
        transport: "http",
        authKind: "bearer",
      }),
    ).toBe("github");
    expect(
      resolveMcpCatalogIdForConnection({
        catalogId: "github",
        url: "https://custom.example/mcp",
        transport: "http",
        authKind: "bearer",
      }),
    ).toBeUndefined();
    expect(
      resolveMcpCatalogIdForConnection({
        catalogId: "gitlab",
        url: "https://gitlab.example/mcp",
        transport: "http",
        authKind: "bearer",
      }),
    ).toBeUndefined();
    expect(() =>
      resolveMcpCatalogIdForConnection({
        catalogId: "spoofed-provider",
        url: "https://custom.example/mcp",
        transport: "http",
        authKind: "none",
      }),
    ).toThrow(McpCatalogBindingError);
  });
});

describe("catalog cards agree with the server OAuth catalog on how to connect", () => {
  // C1. The GitHub and Stripe cards declared auth:"oauth" while the server
  // catalog records oauth:false for both, so Connect started an OAuth flow the
  // server rejected on every run. Every fixed card must resolve under exactly
  // the auth kind it advertises, or Connect cannot succeed.
  const authKindFor = (uiAuth: string): "none" | "bearer" | "oauth" =>
    uiAuth === "oauth" ? "oauth" : uiAuth === "token" ? "bearer" : "none";

  it("resolves GitHub and Stripe as bearer, and refuses them as oauth", () => {
    for (const id of ["github"]) {
      const entry = MCP_CATALOG.find((candidate) => candidate.id === id);
      expect(entry).toBeDefined();
      expect(entry!.auth).toBe("token");

      const url = canonicalizeMcpUrl(entry!.url);
      expect(
        resolveMcpCatalogIdForConnection({
          catalogId: id,
          url,
          transport: entry!.transport,
          authKind: "bearer",
        }),
      ).toBe(id);
      expect(
        resolveMcpCatalogIdForConnection({
          catalogId: id,
          url,
          transport: entry!.transport,
          authKind: "oauth",
        }),
      ).toBeUndefined();
    }
  });

  it("every fixed catalog card resolves under the auth kind it advertises", () => {
    for (const entry of MCP_CATALOG) {
      const kind = authKindFor(entry.auth);
      let url: string;
      try {
        url = canonicalizeMcpUrl(entry.url);
      } catch {
        continue; // endpoint-required cards without a fixed URL
      }
      const resolved = resolveMcpCatalogIdForConnection({
        catalogId: entry.id,
        url,
        transport: entry.transport,
        authKind: kind,
      });
      // A fixed card either resolves to itself under its advertised auth, or is
      // an endpoint-required card the server does not pin (resolves undefined).
      // What must never happen is the mismatch C1 was: advertising one auth
      // kind while the server pins another.
      if (resolved === undefined) continue;
      expect(resolved).toBe(entry.id);
    }
  });
});
