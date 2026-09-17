import { beforeAll, describe, expect, it, jest } from "@jest/globals";

let listMcpToolsPaginated: typeof import("../mcp-client").listMcpToolsPaginated;
let normalizeMcpToolResultForModel: typeof import("../mcp-client").normalizeMcpToolResultForModel;

describe("MCP client discovery and rich results", () => {
  beforeAll(() => {
    // These helpers are transport-independent. Avoid executing the SDK's
    // browser-only ESM PKCE dependency in Jest's CommonJS runtime.
    jest.resetModules();
    jest.doMock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
      StreamableHTTPClientTransport: class StreamableHTTPClientTransport {},
    }));
    jest.doMock("@modelcontextprotocol/sdk/client/sse.js", () => ({
      SSEClientTransport: class SSEClientTransport {},
    }));
    ({ listMcpToolsPaginated, normalizeMcpToolResultForModel } =
      require("../mcp-client") as typeof import("../mcp-client"));
  });
  it("follows bounded tools/list cursors in order", async () => {
    const listTools = jest
      .fn<any>()
      .mockResolvedValueOnce({
        tools: [{ name: "first", inputSchema: { type: "object" } }],
        nextCursor: "page-2",
      })
      .mockResolvedValueOnce({
        tools: [{ name: "second", inputSchema: { type: "object" } }],
      });

    const tools = await listMcpToolsPaginated(
      { listTools } as never,
      new AbortController().signal,
    );

    expect(tools.map((tool) => tool.name)).toEqual(["first", "second"]);
    expect(listTools).toHaveBeenNthCalledWith(
      1,
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(listTools).toHaveBeenNthCalledWith(
      2,
      { cursor: "page-2" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("rejects repeated cursors instead of looping", async () => {
    const listTools = jest.fn<any>().mockResolvedValue({
      tools: [],
      nextCursor: "same-cursor",
    });

    await expect(
      listMcpToolsPaginated(
        { listTools } as never,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/cursor/);
    expect(listTools).toHaveBeenCalledTimes(2);
  });

  it("preserves structured, image, audio, and resource results within budgets", () => {
    const result = normalizeMcpToolResultForModel({
      content: [
        { type: "text", text: "done" },
        { type: "image", mimeType: "image/png", data: "aW1hZ2U=" },
        { type: "audio", mimeType: "audio/wav", data: "YXVkaW8=" },
        {
          type: "resource",
          resource: {
            uri: "https://example.com/report.json",
            mimeType: "application/json",
            text: '{"ok":true}',
          },
        },
      ],
      structuredContent: { ok: true, count: 3 },
    });

    expect(result).toEqual(
      expect.objectContaining({
        isError: false,
        structuredContent: { ok: true, count: 3 },
        content: expect.arrayContaining([
          expect.objectContaining({ type: "image", data: "aW1hZ2U=" }),
          expect.objectContaining({ type: "audio", data: "YXVkaW8=" }),
          expect.objectContaining({
            type: "resource",
            uri: "https://example.com/report.json",
          }),
        ]),
      }),
    );
  });

  it("keeps MCP text-only failures machine-readable instead of flattening away isError", () => {
    expect(
      normalizeMcpToolResultForModel({
        isError: true,
        content: [{ type: "text", text: "Browser credentials required" }],
      }),
    ).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "Browser credentials required" }],
    });
    expect(
      normalizeMcpToolResultForModel({
        content: [{ type: "text", text: "ok" }],
      }),
    ).toBe("ok");
  });

  it("omits oversized inline binary data without dropping its type/metadata", () => {
    const result = normalizeMcpToolResultForModel({
      content: [
        {
          type: "image",
          mimeType: "image/png",
          data: "a".repeat(140 * 1024),
        },
      ],
    }) as { content: Array<Record<string, unknown>> };

    expect(result.content[0]).toEqual({
      type: "image",
      mimeType: "image/png",
      omitted: true,
      encodedLength: 140 * 1024,
    });
  });

  it("shares one bounded text budget across resource parts", () => {
    const result = normalizeMcpToolResultForModel({
      content: Array.from({ length: 4 }, (_, index) => ({
        type: "resource",
        resource: {
          uri: `https://example.com/resource-${index}`,
          mimeType: "text/plain",
          text: "r".repeat(200 * 1024),
        },
      })),
    }) as { content: Array<{ text?: string }> };

    const returnedTextChars = result.content.reduce(
      (total, part) => total + (part.text?.length ?? 0),
      0,
    );

    expect(returnedTextChars).toBeLessThanOrEqual(256 * 1024 + 64);
    expect(JSON.stringify(result).length).toBeLessThan(400 * 1024);
  });
});
