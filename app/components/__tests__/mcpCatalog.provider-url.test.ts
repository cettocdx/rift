import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  MCP_CATALOG,
  MCP_CATEGORY_ORDER,
  getMcpProviderUrl,
  hasConfiguredMcpEndpoint,
  normalizeMcpUrl,
  type McpCatalogEntry,
} from "../mcpCatalog";

describe("plugin provider links", () => {
  it("bundles a unique local official logo for every catalog app", () => {
    const manifestPath = path.join(
      process.cwd(),
      "public/plugin-logos/manifest.json",
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
      string,
      { name: string; path: string; source: string }
    >;

    expect(Object.keys(manifest).length).toBeGreaterThanOrEqual(
      MCP_CATALOG.length,
    );
    for (const entry of MCP_CATALOG) {
      expect(entry.logoPath).toBe(`/plugin-logos/${entry.id}.svg`);
      expect(manifest[entry.id]).toMatchObject({
        name: entry.name,
        path: entry.logoPath,
      });
      expect(
        existsSync(
          path.join(process.cwd(), "public", entry.logoPath.replace(/^\//, "")),
        ),
      ).toBe(true);
    }
  });

  it("gives every catalog entry a configured endpoint and a provider-owned HTTPS destination", () => {
    // The catalog lists only providers that publish a hosted MCP server, so
    // no card can open a form demanding a URL the reader does not have. A
    // server RIFT does not list goes through the custom-endpoint flow.
    expect(MCP_CATALOG.length).toBeGreaterThan(0);
    for (const entry of MCP_CATALOG) {
      expect(hasConfiguredMcpEndpoint(entry)).toBe(true);
    }
    expect(new Set(MCP_CATALOG.map((entry) => entry.id))).toHaveProperty(
      "size",
      MCP_CATALOG.length,
    );

    for (const entry of MCP_CATALOG) {
      const url = new URL(getMcpProviderUrl(entry));
      expect(url.protocol).toBe("https:");
      expect(
        url.hostname === entry.domain ||
          url.hostname.endsWith(`.${entry.domain}`),
      ).toBe(true);
    }
  });

  it("rejects unsafe setup URL overrides", () => {
    const base = MCP_CATALOG[0];
    const entry = {
      ...base,
      setupUrl: "javascript:alert(1)",
    } satisfies McpCatalogEntry;

    expect(getMcpProviderUrl(entry)).toBe(`https://${base.domain}`);
  });

  it("keeps a valid provider setup URL", () => {
    const base = MCP_CATALOG[0];
    const entry = {
      ...base,
      domain: "example.com",
      setupUrl: "https://accounts.example.com/settings/integrations",
    } satisfies McpCatalogEntry;

    expect(getMcpProviderUrl(entry)).toBe(
      "https://accounts.example.com/settings/integrations",
    );
  });

  it("keeps Higgsfield on its official remote endpoint and provider setup", () => {
    const higgsfield = MCP_CATALOG.find((entry) => entry.id === "higgsfield");

    expect(higgsfield).toMatchObject({
      url: "https://mcp.higgsfield.ai/mcp",
      transport: "http",
      auth: "oauth",
      availability: "available",
      domain: "higgsfield.ai",
    });
    expect(getMcpProviderUrl(higgsfield!)).toBe("https://higgsfield.ai/mcp");
    expect(hasConfiguredMcpEndpoint(higgsfield!)).toBe(true);
  });

  it("keeps Hugging Face reachable on the domain that owns its setup page", () => {
    // The slug `def()` derives is "hugging-face", so a guessed domain lands on
    // huggingface.com — which does not own the .co setup page, and
    // getMcpProviderUrl drops any setupUrl it cannot attribute to the provider.
    const huggingFace = MCP_CATALOG.find(
      (entry) => entry.id === "hugging-face",
    );

    expect(huggingFace?.domain).toBe("huggingface.co");
    expect(getMcpProviderUrl(huggingFace!)).toBe(
      "https://huggingface.co/settings/mcp",
    );
  });

  it("orders the category filters so every catalog entry has exactly one home", () => {
    // The marketplace builds both its chip row and its grouped board straight
    // from this order: a category missing from it hides its entries from the
    // board entirely, and a repeated one duplicates a chip and a whole group.
    expect(MCP_CATEGORY_ORDER[0]).toBe("Featured");
    expect(new Set(MCP_CATEGORY_ORDER).size).toBe(MCP_CATEGORY_ORDER.length);
    for (const entry of MCP_CATALOG) {
      expect(MCP_CATEGORY_ORDER).toContain(entry.category);
    }
  });

  it("derives an actionable status from endpoint and authentication requirements", () => {
    const publicEndpoint = MCP_CATALOG.find((entry) => entry.id === "deepwiki");
    // GitHub stores bearer credentials obtained through Rift's registered OAuth app.
    const githubToken = MCP_CATALOG.find((entry) => entry.id === "github");
    const oauthEndpoint = MCP_CATALOG.find(
      (entry) => entry.id === "higgsfield",
    );

    expect(publicEndpoint?.availability).toBe("available");
    expect(githubToken).toMatchObject({
      auth: "token",
      connectFlow: "github",
      availability: "available",
    });
    expect(oauthEndpoint?.availability).toBe("available");
    expect(hasConfiguredMcpEndpoint(oauthEndpoint!)).toBe(true);
  });

  it("never invents an endpoint or a connection state", () => {
    for (const entry of MCP_CATALOG) {
      if (entry.availability === "available") {
        expect(
          entry.auth === "none" ||
            entry.auth === "oauth" ||
            entry.connectFlow === "github",
        ).toBe(true);
        expect(hasConfiguredMcpEndpoint(entry)).toBe(true);
      }
      if (entry.availability === "requires_configuration") {
        expect(["token", "oauth"]).toContain(entry.auth);
        expect(hasConfiguredMcpEndpoint(entry)).toBe(true);
      }
    }
  });

  it("pins known official hosted endpoints to their current HTTP contracts", () => {
    const expected = {
      linear: ["https://mcp.linear.app/mcp", "http", "oauth", "available"],
      higgsfield: [
        "https://mcp.higgsfield.ai/mcp",
        "http",
        "oauth",
        "available",
      ],
      cloudflare: [
        "https://mcp.cloudflare.com/mcp",
        "http",
        "oauth",
        "available",
      ],
      notion: ["https://mcp.notion.com/mcp", "http", "oauth", "available"],
      sentry: ["https://mcp.sentry.dev/mcp", "http", "oauth", "available"],
      "exa-search": ["https://mcp.exa.ai/mcp", "http", "none", "available"],
      context7: ["https://mcp.context7.com/mcp", "http", "none", "available"],
      github: [
        "https://api.githubcopilot.com/mcp/",
        "http",
        "token",
        "available",
      ],
      stripe: ["https://mcp.stripe.com", "http", "oauth", "available"],
    } as const;

    for (const [id, contract] of Object.entries(expected)) {
      const entry = MCP_CATALOG.find((candidate) => candidate.id === id);
      expect(entry).toBeDefined();
      expect([
        entry?.url,
        entry?.transport,
        entry?.auth,
        entry?.availability,
      ]).toEqual(contract);
    }
  });

  it("completes the bearer-token guidance for every entry that offers one", () => {
    // The connection wizard shows `tokenLabel` and `tokenHint` whenever the
    // reader picks a bearer credential, and falls back to a bare "Bearer
    // token" label with no hint — a password box and no way to learn what
    // belongs in it — for an entry that names the credential but not its home.
    const tokenEntries = MCP_CATALOG.filter(
      (entry) => entry.auth === "token" || entry.tokenLabel || entry.tokenHint,
    );

    expect(tokenEntries.length).toBeGreaterThan(0);
    for (const entry of tokenEntries) {
      expect(entry.availability).toBe(
        entry.connectFlow ? "available" : "requires_configuration",
      );
      expect(entry.tokenLabel).toBeTruthy();
      expect(entry.tokenHint).toBeTruthy();
      expect(entry.setupUrl).toBeTruthy();
    }
  });

  it("rejects an unrelated HTTPS setup host", () => {
    const base = MCP_CATALOG[0];
    const entry = {
      ...base,
      setupUrl: "https://lookalike.example/settings",
    } satisfies McpCatalogEntry;

    expect(getMcpProviderUrl(entry)).toBe(`https://${base.domain}`);
  });

  it("normalizes hosts and trailing slashes without changing case-sensitive endpoint data", () => {
    expect(normalizeMcpUrl("HTTPS://EXAMPLE.COM/Mcp/?Token=AbC")).toBe(
      "https://example.com/Mcp?Token=AbC",
    );
    expect(normalizeMcpUrl("https://example.com/mcp/")).toBe(
      normalizeMcpUrl("https://example.com/mcp"),
    );
    expect(normalizeMcpUrl("https://example.com/MCP")).not.toBe(
      normalizeMcpUrl("https://example.com/mcp"),
    );
  });
});
