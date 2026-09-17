/** @jest-environment node */
jest.mock("server-only", () => ({}), { virtual: true });
import {
  fetchRegistrySnapshot,
  normalizeRegistryRecords,
  registryIdentity,
} from "../catalog";
const record = (
  server: Record<string, unknown> = {},
  meta: Record<string, unknown> = {},
) => ({
  server: {
    name: "io.example/tools",
    version: "1.2.0",
    title: "Example",
    description: "Useful tools",
    remotes: [{ type: "streamable-http", url: "https://example.com/mcp" }],
    ...server,
  },
  _meta: {
    "io.modelcontextprotocol.registry/official": {
      status: "active",
      isLatest: true,
      ...meta,
    },
  },
});
describe("official MCP registry discovery", () => {
  it("only offers latest active concrete supported remote servers", () => {
    const entries = normalizeRegistryRecords([
      record(),
      record({}, { isLatest: false }),
      record({}, { status: "deprecated" }),
      record({ remotes: [{ type: "stdio", url: "https://example.com" }] }),
      record({
        remotes: [
          { type: "streamable-http", url: "https://{tenant}.example.com" },
        ],
      }),
      record({ remotes: [{ type: "sse", url: "https://localhost/mcp" }] }),
      record({
        remotes: [{ type: "sse", url: "https://example.com/mcp?token=secret" }],
      }),
      record({
        remotes: [
          {
            type: "sse",
            url: "https://example.com/mcp",
            headers: [{ name: "Authorization", isRequired: true }],
          },
        ],
      }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      namespace: "io.example/tools",
      version: "1.2.0",
      transport: "http",
      url: "https://example.com/mcp",
    });
  });
  it("binds identity to namespace, version, endpoint and transport rather than display name", () => {
    const first = normalizeRegistryRecords([record()])[0];
    expect(first.id).toBe(
      registryIdentity(
        first.namespace,
        first.version,
        first.url,
        first.transport,
      ),
    );
    expect(
      normalizeRegistryRecords([record({ version: "2.0" })])[0].id,
    ).not.toBe(first.id);
    expect(
      normalizeRegistryRecords([record({ title: "Spoofed name" })])[0].id,
    ).toBe(first.id);
  });
  it("uses fixed upstream origin and paginates opaque cursors safely", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            servers: [record()],
            metadata: { nextCursor: "https://evil.test/?x" },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            servers: [
              record({
                name: "io.example/other",
                remotes: [
                  { type: "sse", url: "https://other.example.com/mcp" },
                ],
              }),
            ],
            metadata: {},
          }),
        ),
      );
    const result = await fetchRegistrySnapshot(fetcher);
    expect(result.entries).toHaveLength(2);
    expect(result.truncated).toBe(false);
    expect(fetcher.mock.calls[1][0].origin).toBe(
      "https://registry.modelcontextprotocol.io",
    );
    expect(fetcher.mock.calls[1][0].searchParams.get("cursor")).toBe(
      "https://evil.test/?x",
    );
    expect(fetcher.mock.calls[0][1].redirect).toBe("error");
  });
  it("rejects outage, malformed data, repeated cursors and oversized responses without saving partial results", async () => {
    await expect(
      fetchRegistrySnapshot(
        jest.fn().mockResolvedValue(new Response("", { status: 503 })),
      ),
    ).rejects.toThrow();
    await expect(
      fetchRegistrySnapshot(jest.fn().mockResolvedValue(new Response("{}"))),
    ).rejects.toThrow("Invalid registry");
    await expect(
      fetchRegistrySnapshot(
        jest
          .fn()
          .mockImplementation(() =>
            Promise.resolve(
              new Response(
                JSON.stringify({
                  servers: [],
                  metadata: { nextCursor: "repeat" },
                }),
              ),
            ),
          ),
      ),
    ).rejects.toThrow("cursor");
    await expect(
      fetchRegistrySnapshot(
        jest.fn().mockResolvedValue(new Response(" ".repeat(2_000_001))),
      ),
    ).rejects.toThrow("too large");
  });
});

it("retains a persisted snapshot and rejects a forged endpoint before connecting", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { getRegistrySnapshot, resolveRegistryBinding } =
    await import("../catalog");
  const folder = await mkdtemp(join(tmpdir(), "rift-registry-test-"));
  const previous = process.env.RIFT_MCP_REGISTRY_CACHE_PATH;
  process.env.RIFT_MCP_REGISTRY_CACHE_PATH = join(folder, "catalog.json");
  const entry = normalizeRegistryRecords([record()])[0];
  await writeFile(
    process.env.RIFT_MCP_REGISTRY_CACHE_PATH,
    JSON.stringify({
      entries: [entry],
      fetchedAt: Date.now(),
      truncated: false,
    }),
  );
  try {
    expect((await getRegistrySnapshot()).entries).toEqual([entry]);
    await expect(
      resolveRegistryBinding({
        catalogId: entry.id,
        url: entry.url,
        transport: entry.transport,
      }),
    ).resolves.toBe(true);
    await expect(
      resolveRegistryBinding({
        catalogId: entry.id,
        url: "https://attacker.example.com/mcp",
        transport: entry.transport,
      }),
    ).rejects.toThrow("changed");
    await expect(
      resolveRegistryBinding({
        catalogId: entry.id,
        url: entry.url,
        transport: "sse",
      }),
    ).rejects.toThrow("changed");
    await expect(
      resolveRegistryBinding({
        catalogId: "registry-not-published",
        url: entry.url,
        transport: entry.transport,
      }),
    ).rejects.toThrow("changed");
    await expect(
      resolveRegistryBinding({
        catalogId: "github",
        url: entry.url,
        transport: entry.transport,
      }),
    ).resolves.toBe(false);
  } finally {
    if (previous === undefined) delete process.env.RIFT_MCP_REGISTRY_CACHE_PATH;
    else process.env.RIFT_MCP_REGISTRY_CACHE_PATH = previous;
    await rm(folder, { recursive: true, force: true });
  }
});

(process.env.RIFT_MCP_REGISTRY_LIVE === "1" ? it : it.skip)(
  "reads the official live registry through the production adapter",
  async () => {
    const snapshot = await fetchRegistrySnapshot();
    expect(snapshot.entries.length).toBeGreaterThan(0);
    console.info("Live Registry discovery", {
      count: snapshot.entries.length,
      truncated: snapshot.truncated,
    });
  },
  20_000,
);
