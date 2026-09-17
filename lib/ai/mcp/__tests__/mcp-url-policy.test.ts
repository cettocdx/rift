import type { LookupOptions } from "node:dns";
import { Readable } from "node:stream";

import {
  createGuardedMcpFetchResponse,
  createPinnedLookup,
  createSafeMcpFetch,
  guardMcpResponseStream,
  isLocalMcpDevelopmentEnabled,
  resolveSafeMcpTarget,
  type ResolvedMcpRequest,
} from "../mcp-url-policy";

const PUBLIC_V4 = { address: "93.184.216.34", family: 4 as const };

if (typeof globalThis.Response === "undefined") {
  class TestResponse {
    readonly body: ReadableStream<Uint8Array> | null;
    readonly status: number;
    readonly statusText: string;
    readonly headers: Headers;

    constructor(body: ReadableStream<Uint8Array> | null, init?: ResponseInit) {
      this.body = body;
      this.status = init?.status ?? 200;
      this.statusText = init?.statusText ?? "";
      this.headers = new Headers(init?.headers);
    }
  }
  Object.defineProperty(globalThis, "Response", {
    configurable: true,
    value: TestResponse,
  });
}

function headersOf(request: ResolvedMcpRequest): Headers {
  return new Headers(request.init.headers);
}

function mockResponse(status = 200, location?: string): Response {
  return {
    status,
    headers: new Headers(location ? { location } : undefined),
    body: null,
  } as Response;
}

function streamFromStrings(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function consumeStream(
  stream: ReadableStream<Uint8Array>,
): Promise<number> {
  const reader = stream.getReader();
  let bytes = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) return bytes;
    bytes += result.value.byteLength;
  }
}

describe("MCP runtime URL policy", () => {
  it("requires both an explicit flag and development mode for local MCP", () => {
    expect(
      isLocalMcpDevelopmentEnabled({
        NODE_ENV: "development",
        MCP_ALLOW_INSECURE_LOCALHOST: "true",
      }),
    ).toBe(true);
    expect(
      isLocalMcpDevelopmentEnabled({
        NODE_ENV: "production",
        MCP_ALLOW_INSECURE_LOCALHOST: "true",
      }),
    ).toBe(false);
    expect(
      isLocalMcpDevelopmentEnabled({
        NODE_ENV: "development",
        MCP_ALLOW_INSECURE_LOCALHOST: "false",
      }),
    ).toBe(false);
  });

  it("rejects a DNS answer set containing any private address", async () => {
    await expect(
      resolveSafeMcpTarget("https://mcp.example.test/rpc", {
        resolveHostname: async () => [
          PUBLIC_V4,
          { address: "10.0.0.7", family: 4 },
        ],
      }),
    ).rejects.toThrow(/blocked private/);
  });

  it("does not let a public name use the localhost development exception", async () => {
    await expect(
      resolveSafeMcpTarget("https://public.example.test/rpc", {
        allowLocalDevelopment: true,
        resolveHostname: async () => [{ address: "127.0.0.1", family: 4 }],
      }),
    ).rejects.toThrow(/blocked loopback/);
  });

  it("allows an explicit localhost name only when every answer is loopback", async () => {
    await expect(
      resolveSafeMcpTarget("http://localhost:8181/rpc", {
        allowLocalDevelopment: true,
        resolveHostname: async () => [
          { address: "127.0.0.1", family: 4 },
          { address: "::1", family: 6 },
        ],
      }),
    ).resolves.toMatchObject({ address: "127.0.0.1", family: 4 });

    await expect(
      resolveSafeMcpTarget("http://localhost:8181/rpc", {
        allowLocalDevelopment: true,
        resolveHostname: async () => [
          { address: "127.0.0.1", family: 4 },
          PUBLIC_V4,
        ],
      }),
    ).rejects.toThrow(/local MCP hostname/);
  });

  it("pins Node lookup to the vetted address", async () => {
    const lookup = createPinnedLookup(PUBLIC_V4.address, PUBLIC_V4.family);
    const result = await new Promise<{
      address: string | import("node:dns").LookupAddress[];
      family?: number;
    }>((resolve, reject) => {
      lookup(
        "a-different-host.example",
        { all: false } as LookupOptions,
        (error, address, family) => {
          if (error) reject(error);
          else resolve({ address, family });
        },
      );
    });

    expect(result).toEqual({
      address: PUBLIC_V4.address,
      family: PUBLIC_V4.family,
    });
  });

  it("resolves and pins every redirect hop", async () => {
    const resolveHostname = jest.fn(async () => [PUBLIC_V4]);
    const dispatch = jest.fn(async (request: ResolvedMcpRequest) => {
      if (request.url.hostname === "first.example.test") {
        return mockResponse(302, "https://second.example.test/final");
      }
      return mockResponse();
    });
    const safeFetch = createSafeMcpFetch({ resolveHostname, dispatch });

    await expect(
      safeFetch("https://first.example.test/start"),
    ).resolves.toMatchObject({ status: 200 });

    expect(resolveHostname.mock.calls.map(([hostname]) => hostname)).toEqual([
      "first.example.test",
      "second.example.test",
    ]);
    expect(dispatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining(PUBLIC_V4),
    );
    expect(dispatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining(PUBLIC_V4),
    );
  });

  it("strips configured and transient secret headers across origins", async () => {
    const seen: ResolvedMcpRequest[] = [];
    const dispatch = jest.fn(async (request: ResolvedMcpRequest) => {
      seen.push(request);
      if (seen.length === 1) {
        return mockResponse(307, "https://redirect.example.test/rpc");
      }
      return mockResponse();
    });
    const safeFetch = createSafeMcpFetch({
      baseHeaders: {
        Authorization: "Bearer top-secret",
        "X-Api-Key": "custom-secret",
      },
      configuredUrl: "https://origin.example.test/rpc",
      resolveHostname: async () => [PUBLIC_V4],
      dispatch,
    });

    await safeFetch("https://origin.example.test/rpc", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Mcp-Session-Id": "session-secret",
        "X-Transient-Secret": "also-secret",
      },
      body: "{}",
    });

    expect(headersOf(seen[0]).get("authorization")).toBe("Bearer top-secret");
    expect(headersOf(seen[0]).get("x-api-key")).toBe("custom-secret");

    const redirectedHeaders = headersOf(seen[1]);
    expect(redirectedHeaders.get("accept")).toBe("application/json");
    expect(redirectedHeaders.has("authorization")).toBe(false);
    expect(redirectedHeaders.has("x-api-key")).toBe(false);
    expect(redirectedHeaders.has("mcp-session-id")).toBe(false);
    expect(redirectedHeaders.has("x-transient-secret")).toBe(false);
  });

  it("does not attach server credentials to a direct cross-origin SDK fetch", async () => {
    let seen: ResolvedMcpRequest | undefined;
    const safeFetch = createSafeMcpFetch({
      baseHeaders: {
        Authorization: "Bearer top-secret",
        "X-Api-Key": "custom-secret",
      },
      configuredUrl: "https://configured.example.test/rpc",
      resolveHostname: async () => [PUBLIC_V4],
      dispatch: async (request) => {
        seen = request;
        return mockResponse();
      },
    });

    await safeFetch("https://metadata.example.test/resource", {
      headers: { "Mcp-Session-Id": "session-secret" },
    });

    const headers = headersOf(seen as ResolvedMcpRequest);
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("x-api-key")).toBe(false);
    expect(headers.has("mcp-session-id")).toBe(false);
  });

  it("re-resolves a same-origin redirect and stops a rebinding answer", async () => {
    const resolveHostname = jest
      .fn()
      .mockResolvedValueOnce([PUBLIC_V4])
      .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    const dispatch = jest.fn(async () => mockResponse(302, "/next"));
    const safeFetch = createSafeMcpFetch({ resolveHostname, dispatch });

    await expect(
      safeFetch("https://rebind.example.test/start"),
    ).rejects.toThrow(/blocked link-local/);
    expect(resolveHostname).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("does not allow a public redirect chain to enter localhost", async () => {
    const dispatch = jest.fn(async () =>
      mockResponse(302, "http://localhost:8080/private"),
    );
    const safeFetch = createSafeMcpFetch({
      allowLocalDevelopment: true,
      resolveHostname: async () => [PUBLIC_V4],
      dispatch,
    });

    await expect(
      safeFetch("https://public.example.test/start"),
    ).rejects.toThrow(/HTTPS/);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("enforces the redirect limit", async () => {
    const dispatch = jest.fn(async () => mockResponse(302, "/again"));
    const safeFetch = createSafeMcpFetch({
      maxRedirects: 1,
      resolveHostname: async () => [PUBLIC_V4],
      dispatch,
    });

    await expect(safeFetch("https://loop.example.test/start")).rejects.toThrow(
      /exceeded 1 redirects/,
    );
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("rejects transport-level host and framing headers", () => {
    expect(() =>
      createSafeMcpFetch({
        baseHeaders: { Host: "internal.service" },
        configuredUrl: "https://mcp.example.test/rpc",
      }),
    ).toThrow(/not allowed/);
    expect(() =>
      createSafeMcpFetch({
        baseHeaders: { "Content-Length": "1" },
        configuredUrl: "https://mcp.example.test/rpc",
      }),
    ).toThrow(/not allowed/);
  });

  it("rejects malformed Node HTTP statuses before constructing a Response", () => {
    const incoming = Object.assign(Readable.from([]), {
      statusCode: 999,
      statusMessage: "Invalid",
      rawHeaders: [] as string[],
    }) as unknown as import("node:http").IncomingMessage;

    expect(() => createGuardedMcpFetchResponse(incoming, "GET")).toThrow(
      /invalid HTTP status \(999\)/,
    );
    expect(incoming.destroyed).toBe(false);
    incoming.destroy();
  });

  it("detaches IncomingMessage data listeners before response cancellation", async () => {
    const incoming = Object.assign(
      new Readable({
        read() {},
      }),
      {
        statusCode: 401,
        statusMessage: "Unauthorized",
        rawHeaders: ["content-type", "application/json"],
      },
    ) as unknown as import("node:http").IncomingMessage;

    const response = createGuardedMcpFetchResponse(incoming, "GET");
    const reader = response.body!.getReader();
    incoming.push(Buffer.from('{"error":"unauthorized"}'));
    await expect(reader.read()).resolves.toMatchObject({ done: false });

    await reader.cancel("MCP transport rejected the response");

    expect(incoming.listenerCount("data")).toBe(0);
    expect(() =>
      incoming.emit("data", Buffer.from("late socket bytes")),
    ).not.toThrow();
  });

  it("caps buffered JSON/HTTP responses across chunks", async () => {
    const abort = jest.fn();
    const guarded = guardMcpResponseStream(streamFromStrings("1234", "5678"), {
      isEventStream: false,
      maxResponseBytes: 7,
      idleTimeoutMs: 1_000,
      overallTimeoutMs: 1_000,
      abort,
    });

    await expect(consumeStream(guarded)).rejects.toThrow(/7-byte limit/);
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it("caps each SSE event while allowing an unlimited sequence of small events", async () => {
    const smallEvents = guardMcpResponseStream(
      streamFromStrings("data: one\n\n", "data: two\n\n", "data: three\n\n"),
      {
        isEventStream: true,
        maxEventBytes: 16,
        maxResponseBytes: 1,
        idleTimeoutMs: 1_000,
      },
    );
    await expect(consumeStream(smallEvents)).resolves.toBeGreaterThan(16);

    const abort = jest.fn();
    const oversizedEvent = guardMcpResponseStream(
      streamFromStrings("data: 123456", "78901234567890"),
      {
        isEventStream: true,
        maxEventBytes: 16,
        idleTimeoutMs: 1_000,
        abort,
      },
    );
    await expect(consumeStream(oversizedEvent)).rejects.toThrow(
      /SSE event exceeded the 16-byte limit/,
    );
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it("aborts a stalled stream on its idle deadline", async () => {
    jest.useFakeTimers();
    try {
      const abort = jest.fn();
      const source = new ReadableStream<Uint8Array>({});
      const guarded = guardMcpResponseStream(source, {
        isEventStream: true,
        idleTimeoutMs: 50,
        abort,
      });
      const pendingRead = guarded.getReader().read();
      const assertion = expect(pendingRead).rejects.toThrow(/idle.*50ms/);

      await jest.advanceTimersByTimeAsync(51);

      await assertion;
      expect(abort).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("enforces an overall deadline for buffered responses", async () => {
    jest.useFakeTimers();
    try {
      const abort = jest.fn();
      const guarded = guardMcpResponseStream(
        new ReadableStream<Uint8Array>({}),
        {
          isEventStream: false,
          idleTimeoutMs: 1_000,
          overallTimeoutMs: 50,
          abort,
        },
      );
      const pendingRead = guarded.getReader().read();
      const assertion = expect(pendingRead).rejects.toThrow(
        /50ms overall deadline/,
      );

      await jest.advanceTimersByTimeAsync(51);

      await assertion;
      expect(abort).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not impose an overall lifetime deadline on active SSE", async () => {
    jest.useFakeTimers();
    try {
      let sourceController:
        | ReadableStreamDefaultController<Uint8Array>
        | undefined;
      const source = new ReadableStream<Uint8Array>({
        start(controller) {
          sourceController = controller;
        },
      });
      const guarded = guardMcpResponseStream(source, {
        isEventStream: true,
        idleTimeoutMs: 1_000,
        overallTimeoutMs: 10,
      });
      const reader = guarded.getReader();
      const pendingRead = reader.read();

      await jest.advanceTimersByTimeAsync(50);
      sourceController?.enqueue(new TextEncoder().encode(": heartbeat\n\n"));

      await expect(pendingRead).resolves.toMatchObject({ done: false });
      await reader.cancel();
    } finally {
      jest.useRealTimers();
    }
  });
});
