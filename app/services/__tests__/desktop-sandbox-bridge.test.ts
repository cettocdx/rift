import { DesktopSandboxBridge } from "../desktop-sandbox-bridge";

// ── Mocks ─────────────────────────────────────────────────────────────

const mockSubscription = {
  on: jest.fn(),
  subscribe: jest.fn(),
  unsubscribe: jest.fn(),
  removeAllListeners: jest.fn(),
  publish: jest.fn().mockResolvedValue(undefined),
};

const mockClient = {
  state: "connecting",
  newSubscription: jest.fn().mockReturnValue(mockSubscription),
  connect: jest.fn(),
  disconnect: jest.fn(),
  on: jest.fn(),
};

jest.mock("centrifuge", () => ({
  ...jest.requireActual("centrifuge"),
  Centrifuge: jest.fn().mockImplementation(() => mockClient),
}));

// Mock Tauri IPC
let mockInvokeHandler: (
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
let capturedChannel: { onmessage?: (event: unknown) => void } | null = null;

jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn((...args: unknown[]) => {
    const [cmd, invokeArgs] = args as [
      string,
      Record<string, unknown> | undefined,
    ];
    return mockInvokeHandler(cmd, invokeArgs);
  }),
  Channel: jest.fn().mockImplementation(() => {
    const ch = {
      onmessage: undefined as ((event: unknown) => void) | undefined,
    };
    capturedChannel = ch;
    return ch;
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────

function createTestJwt(sub: string): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({ sub, exp: Date.now() / 1000 + 3600 }));
  return `${header}.${payload}.fakesignature`;
}

function buildConfig(overrides: Record<string, unknown> = {}) {
  return {
    connectDesktop: jest.fn().mockResolvedValue({
      connectionId: "conn-123",
      centrifugoToken: createTestJwt("user-456"),
      centrifugoWsUrl: "ws://localhost:8000/connection/websocket",
    }),
    refreshCentrifugoTokenDesktop: jest
      .fn()
      .mockResolvedValue({ ok: true, centrifugoToken: "new-token" }),
    disconnectDesktop: jest.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
}

function getPublicationHandler(): (ctx: { data: unknown }) => void {
  const onCalls = mockSubscription.on.mock.calls;
  const pubCall = onCalls.find(([event]: [string]) => event === "publication");
  if (!pubCall) throw new Error("No publication handler registered");
  return pubCall[1];
}

// ── Setup ─────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockClient.state = "connecting";
  capturedChannel = null;

  mockInvokeHandler = async (cmd: string) => {
    if (cmd === "get_desktop_platform_info") {
      return {
        platform: "macos",
        arch: "aarch64",
        release: "unknown",
        hostname: "RIFT Desktop",
      };
    }
    if (cmd === "execute_command") {
      return {
        stdout: "Darwin 24.0.0 arm64\ntest-host\n",
        stderr: "",
        exit_code: 0,
      };
    }
    if (cmd === "execute_stream_command") {
      return undefined;
    }
    throw new Error(`Unknown command: ${cmd}`);
  };
});

// ── targetConnectionId filtering ──────────────────────────────────────

describe("targetConnectionId filtering", () => {
  it("relays only a targeted, narrow localhost read through native IPC", async () => {
    const config = buildConfig();
    const bridge = new DesktopSandboxBridge(config);
    await bridge.start();
    const handler = getPublicationHandler();

    mockInvokeHandler = async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "fetch_loopback_url") {
        expect(args).toEqual({ url: "http://localhost:3000/", method: "GET" });
        return {
          status: 200,
          finalUrl: "http://localhost:3000/",
          contentType: "text/html",
          encoding: "utf8",
          body: "<title>Local</title>",
          bytes: 20,
          truncated: false,
        };
      }
      return undefined;
    };

    handler({
      data: {
        type: "desktop_local_access_request",
        requestId: "request-1",
        operation: "fetch_loopback",
        payload: { url: "http://localhost:3000/", method: "GET" },
        targetConnectionId: "conn-123",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockSubscription.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "desktop_local_access_result",
        requestId: "request-1",
        ok: true,
      }),
    );
  });

  it("handles command when targetConnectionId matches this connection", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const config = buildConfig();
    const bridge = new DesktopSandboxBridge(config);
    await bridge.start();

    const handler = getPublicationHandler();
    (invoke as jest.Mock).mockClear();

    // Set up streaming mock that sends exit event via channel
    mockInvokeHandler = async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "execute_stream_command") {
        // Simulate the Rust side sending an exit event via channel
        if (capturedChannel?.onmessage) {
          capturedChannel.onmessage({ type: "exit", exitCode: 0 });
        }
        return undefined;
      }
      return undefined;
    };

    handler({
      data: {
        type: "command",
        commandId: "cmd-1",
        command: "echo hi",
        targetConnectionId: "conn-123",
      },
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(invoke).toHaveBeenCalledWith(
      "execute_stream_command",
      expect.objectContaining({ command: "echo hi" }),
    );
  });

  it("ignores command when targetConnectionId does not match", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const config = buildConfig();
    const bridge = new DesktopSandboxBridge(config);
    await bridge.start();

    const handler = getPublicationHandler();
    (invoke as jest.Mock).mockClear();

    handler({
      data: {
        type: "command",
        commandId: "cmd-2",
        command: "echo hi",
        targetConnectionId: "other-connection",
      },
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(invoke).not.toHaveBeenCalledWith(
      "execute_stream_command",
      expect.anything(),
    );
  });

  it("ignores command when targetConnectionId is undefined", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const config = buildConfig();
    const bridge = new DesktopSandboxBridge(config);
    await bridge.start();

    const handler = getPublicationHandler();
    (invoke as jest.Mock).mockClear();

    mockInvokeHandler = async (cmd: string) => {
      if (cmd === "execute_stream_command") {
        if (capturedChannel?.onmessage) {
          capturedChannel.onmessage({ type: "exit", exitCode: 0 });
        }
        return undefined;
      }
      return undefined;
    };

    handler({
      data: {
        type: "command",
        commandId: "cmd-3",
        command: "echo broadcast",
      },
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(invoke).not.toHaveBeenCalledWith(
      "execute_stream_command",
      expect.anything(),
    );
  });

  it("ignores PTY control messages when targetConnectionId is undefined", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const config = buildConfig();
    const bridge = new DesktopSandboxBridge(config);
    await bridge.start();

    const handler = getPublicationHandler();
    (invoke as jest.Mock).mockClear();

    handler({
      data: {
        type: "pty_create",
        sessionId: "pty-1",
        command: "bash",
        cols: 80,
        rows: 24,
      },
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(invoke).not.toHaveBeenCalledWith(
      "execute_pty_create",
      expect.anything(),
    );
  });
});

// ── extractUserIdFromToken ────────────────────────────────────────────

describe("extractUserIdFromToken", () => {
  it("extracts sub from a valid JWT", async () => {
    const config = buildConfig();
    const bridge = new DesktopSandboxBridge(config);
    await bridge.start();

    expect(mockClient.newSubscription).toHaveBeenCalledWith(
      "sandbox:connection:conn-123#user-456",
    );
  });

  it("throws on JWT with fewer than 3 parts", async () => {
    const config = buildConfig({
      connectDesktop: jest.fn().mockResolvedValue({
        connectionId: "conn-bad",
        centrifugoToken: "only.twoparts",
        centrifugoWsUrl: "ws://localhost:8000/connection/websocket",
      }),
    });
    const bridge = new DesktopSandboxBridge(config);

    await expect(bridge.start()).rejects.toThrow("Invalid JWT");
  });

  it("throws on JWT missing sub field", async () => {
    const header = btoa(JSON.stringify({ alg: "HS256" }));
    const payload = btoa(JSON.stringify({ exp: 9999999999 }));
    const tokenNoSub = `${header}.${payload}.sig`;

    const config = buildConfig({
      connectDesktop: jest.fn().mockResolvedValue({
        connectionId: "conn-nosub",
        centrifugoToken: tokenNoSub,
        centrifugoWsUrl: "ws://localhost:8000/connection/websocket",
      }),
    });
    const bridge = new DesktopSandboxBridge(config);

    await expect(bridge.start()).rejects.toThrow("JWT missing 'sub' claim");
  });
});

// ── forwardChunk ──────────────────────────────────────────────────────

describe("forwardChunk", () => {
  async function startBridgeAndForwardChunks(
    chunks: Array<Record<string, unknown>>,
  ) {
    const config = buildConfig();
    const bridge = new DesktopSandboxBridge(config);
    await bridge.start();

    const handler = getPublicationHandler();

    // Mock execute_stream_command to send chunks via channel
    mockInvokeHandler = async (cmd: string) => {
      if (cmd === "execute_stream_command") {
        if (capturedChannel?.onmessage) {
          for (const chunk of chunks) {
            capturedChannel.onmessage(chunk);
          }
        }
        return undefined;
      }
      return undefined;
    };

    handler({
      data: {
        type: "command",
        commandId: "cmd-fwd",
        command: "test",
        targetConnectionId: "conn-123",
      },
    });

    await new Promise((r) => setTimeout(r, 50));
    return mockSubscription.publish.mock.calls;
  }

  it("publishes stdout message for stdout chunk", async () => {
    const calls = await startBridgeAndForwardChunks([
      { type: "stdout", data: "hello world" },
    ]);

    expect(calls).toContainEqual([
      { type: "stdout", commandId: "cmd-fwd", data: "hello world" },
    ]);
  });

  it("does not publish for stderr chunk with empty data", async () => {
    const calls = await startBridgeAndForwardChunks([
      { type: "stderr", data: "" },
    ]);

    const stderrCalls = calls.filter(
      ([msg]: [{ type: string }]) => msg.type === "stderr",
    );
    expect(stderrCalls).toHaveLength(0);
  });

  it("defaults exitCode to -1 when missing from exit chunk", async () => {
    const calls = await startBridgeAndForwardChunks([{ type: "exit" }]);

    expect(calls).toContainEqual([
      { type: "exit", commandId: "cmd-fwd", exitCode: -1 },
    ]);
  });

  it("publishes correct exitCode when provided", async () => {
    const calls = await startBridgeAndForwardChunks([
      { type: "exit", exitCode: 42 },
    ]);

    expect(calls).toContainEqual([
      { type: "exit", commandId: "cmd-fwd", exitCode: 42 },
    ]);
  });

  it("forwards exitCode 0 for successful commands", async () => {
    const calls = await startBridgeAndForwardChunks([
      { type: "exit", exitCode: 0 },
    ]);

    expect(calls).toContainEqual([
      { type: "exit", commandId: "cmd-fwd", exitCode: 0 },
    ]);
  });

  it("warns when exitCode is missing from exit chunk", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    await startBridgeAndForwardChunks([{ type: "exit" }]);

    expect(warnSpy).toHaveBeenCalledWith(
      "[desktop-bridge]",
      expect.stringContaining("desktop_stream_exit_code_missing"),
    );
    warnSpy.mockRestore();
  });
});

// ── pty_data publish ordering ─────────────────────────────────────────
//
// Regression guard for the publishQueue serialization in handlePtyCreate.
// Rust flushes per-read (often per-char on interactive echo); firing N
// unawaited publishes at Centrifuge reordered arrivals server-side, which
// produced garbled terminal rendering. The chain through `publishQueue`
// must preserve FIFO order even when earlier publishes take longer.

describe("pty_data publish ordering", () => {
  it("serializes rapid pty_data publishes to preserve FIFO order", async () => {
    const config = buildConfig();
    const bridge = new DesktopSandboxBridge(config);
    await bridge.start();

    const handler = getPublicationHandler();

    const publishOrder: string[] = [];
    let dataIdx = 0;
    mockSubscription.publish.mockImplementation(async (msg: unknown) => {
      const m = msg as { type: string; data?: string };
      if (m.type === "pty_data") {
        const idx = dataIdx++;
        // Decreasing delay — first chunk waits longest. Without the
        // publishQueue chain, later chunks (shorter delay) would land first.
        const delay = Math.max(0, 20 - idx * 2);
        await new Promise((r) => setTimeout(r, delay));
        publishOrder.push(m.data ?? "");
      }
    });

    mockInvokeHandler = async (cmd: string) => {
      if (cmd === "execute_pty_create") {
        return { pid: 9999, session_id: "sess-x" };
      }
      return undefined;
    };

    handler({
      data: {
        type: "pty_create",
        sessionId: "sess-x",
        command: "bash",
        cols: 80,
        rows: 24,
        targetConnectionId: "conn-123",
      },
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(capturedChannel?.onmessage).toBeDefined();

    const chunks = Array.from({ length: 10 }, (_, i) => `chunk-${i}`);
    for (const c of chunks) {
      capturedChannel!.onmessage!(c);
    }

    await new Promise((r) => setTimeout(r, 400));

    // With debounce buffering, rapid chunks are batched into fewer publishes.
    // Verify the concatenated content preserves order (FIFO).
    const receivedContent = publishOrder.join("");
    expect(receivedContent).toEqual(chunks.join(""));
  });
});

function emitBridgeEvent(
  source: typeof mockSubscription | typeof mockClient,
  event: string,
  context: Record<string, unknown> = {},
) {
  const handler = source.on.mock.calls.find(([name]) => name === event)?.[1];
  if (!handler) throw new Error(`No ${event} listener`);
  handler(context);
}

describe("terminal message-size disconnect recovery", () => {
  it("reconnects the same socket registration once without claiming readiness early", async () => {
    const config = buildConfig();
    const bridge = new DesktopSandboxBridge(config);
    await bridge.start();
    emitBridgeEvent(mockSubscription, "subscribed");
    mockClient.state = "disconnected";
    emitBridgeEvent(mockClient, "disconnected", { code: 3 });

    expect(bridge.reconnectTransport()).toBe(true);
    expect(bridge.reconnectTransport()).toBe(false);
    expect(mockClient.connect).toHaveBeenCalledTimes(2);
    expect(config.connectDesktop).toHaveBeenCalledTimes(1);
    expect(mockClient.newSubscription).toHaveBeenCalledTimes(1);
    expect(mockSubscription.unsubscribe).not.toHaveBeenCalled();
    expect(config.disconnectDesktop).not.toHaveBeenCalled();
    expect(bridge.getConnectionId()).toBe("conn-123");
    expect(bridge.isReady()).toBe(false);
    emitBridgeEvent(mockSubscription, "subscribed");
    expect(bridge.isReady()).toBe(true);
  });

  it.each([0, 1, 2, 3500, 3501, 4500])(
    "does not restart a terminal disconnect with code %i",
    async (code) => {
      const bridge = new DesktopSandboxBridge(buildConfig());
      await bridge.start();
      mockClient.state = "disconnected";
      emitBridgeEvent(mockClient, "disconnected", { code });
      expect(bridge.reconnectTransport()).toBe(false);
      expect(mockClient.connect).toHaveBeenCalledTimes(1);
    },
  );

  it("does not interrupt a client that is already reconnecting", async () => {
    const bridge = new DesktopSandboxBridge(buildConfig());
    await bridge.start();
    emitBridgeEvent(mockClient, "disconnected", { code: 3 });
    mockClient.state = "connecting";
    expect(bridge.reconnectTransport()).toBe(false);
    expect(mockClient.connect).toHaveBeenCalledTimes(1);
  });

  it("does not revive a stopped connection even if a late disconnect arrives", async () => {
    const bridge = new DesktopSandboxBridge(buildConfig());
    await bridge.start();
    mockClient.state = "disconnected";
    emitBridgeEvent(mockClient, "disconnected", { code: 3 });
    await bridge.stop();
    emitBridgeEvent(mockClient, "disconnected", { code: 3 });
    expect(bridge.reconnectTransport()).toBe(false);
    expect(mockClient.connect).toHaveBeenCalledTimes(1);
  });

  it("does not recover code3 after token refresh reports a signed-out user", async () => {
    const { Centrifuge } = await import("centrifuge");
    const unauthorized = { data: { code: "UNAUTHORIZED" } };
    const bridge = new DesktopSandboxBridge(
      buildConfig({
        refreshCentrifugoTokenDesktop: jest
          .fn()
          .mockRejectedValue(unauthorized),
      }),
    );
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await bridge.start();
      mockClient.state = "disconnected";
      emitBridgeEvent(mockClient, "disconnected", { code: 3 });
      const options = (Centrifuge as unknown as jest.Mock).mock.calls[0][1];
      await expect(options.getToken()).rejects.toBe(unauthorized);
      expect(bridge.reconnectTransport()).toBe(false);
      expect(bridge.canReconnect()).toBe(false);
      expect(mockClient.connect).toHaveBeenCalledTimes(1);
    } finally {
      warning.mockRestore();
    }
  });
});

describe("desktop relay readiness and bounded file writes", () => {
  it("reports ready only after subscription acknowledgement and clears readiness during reconnect", async () => {
    const onConnectionStateChange = jest.fn();
    const bridge = new DesktopSandboxBridge(
      buildConfig({ onConnectionStateChange }),
    );
    await bridge.start();
    expect(bridge.isReady()).toBe(false);
    expect(onConnectionStateChange).not.toHaveBeenCalledWith(true);
    emitBridgeEvent(mockSubscription, "subscribed");
    expect(bridge.isReady()).toBe(true);
    expect(onConnectionStateChange).toHaveBeenLastCalledWith(true);
    emitBridgeEvent(mockSubscription, "subscribing");
    expect(bridge.isReady()).toBe(false);
    emitBridgeEvent(mockSubscription, "subscribed");
    emitBridgeEvent(mockClient, "disconnected");
    expect(onConnectionStateChange).toHaveBeenLastCalledWith(false);
    emitBridgeEvent(mockSubscription, "subscribed");
    emitBridgeEvent(mockSubscription, "unsubscribed");
    expect(bridge.isReady()).toBe(false);
    emitBridgeEvent(mockSubscription, "subscribed");
    await bridge.stop();
    emitBridgeEvent(mockSubscription, "subscribed");
    expect(bridge.isReady()).toBe(false);
    expect(onConnectionStateChange).toHaveBeenLastCalledWith(false);
  });

  it("cannot resurrect a relay when access is revoked while registration is in flight", async () => {
    let resolveConnect!: (value: unknown) => void;
    const config = buildConfig({
      connectDesktop: jest.fn(
        () =>
          new Promise((resolve) => {
            resolveConnect = resolve;
          }),
      ),
    });
    const bridge = new DesktopSandboxBridge(config);
    const starting = bridge.start();
    const rejected = expect(starting).rejects.toThrow(/stopped/i);
    while (!resolveConnect) await Promise.resolve();
    await bridge.stop();
    resolveConnect({
      connectionId: "late-connection",
      centrifugoToken: createTestJwt("owner"),
      centrifugoWsUrl: "ws://localhost:8000",
    });
    await rejected;
    expect(mockClient.connect).not.toHaveBeenCalled();
    expect(bridge.getConnectionId()).toBeNull();
    expect(config.disconnectDesktop).toHaveBeenCalledWith({
      connectionId: "late-connection",
    });
  });

  it("forwards an empty file write and its optimistic version unchanged", async () => {
    const bridge = new DesktopSandboxBridge(buildConfig());
    await bridge.start();
    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as jest.Mock).mockClear();
    mockInvokeHandler = async () => ({ relativePath: "empty.txt", size: 0 });
    getPublicationHandler()({
      data: {
        type: "desktop_local_access_request",
        operation: "write_file",
        requestId: "write-empty",
        targetConnectionId: "conn-123",
        payload: {
          grantId: "opaque-grant",
          relativePath: "empty.txt",
          content: "",
          encoding: "utf8",
          expectedVersion: "version-abc",
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(invoke).toHaveBeenCalledWith("write_workspace_file", {
      grantId: "opaque-grant",
      relativePath: "empty.txt",
      content: "",
      encoding: "utf8",
      expectedVersion: "version-abc",
    });
    expect(mockSubscription.publish).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "write-empty", ok: true }),
    );
  });

  it("rejects non-string and oversized UTF-8 writes before invoking native code", async () => {
    const bridge = new DesktopSandboxBridge(buildConfig());
    await bridge.start();
    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as jest.Mock).mockClear();
    for (const [index, content] of [42, "😀".repeat(150_000)].entries()) {
      getPublicationHandler()({
        data: {
          type: "desktop_local_access_request",
          operation: "write_file",
          requestId: `bad-write-${index}`,
          targetConnectionId: "conn-123",
          payload: { grantId: "opaque-grant", relativePath: "a.txt", content },
        },
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(invoke).not.toHaveBeenCalledWith(
      "write_workspace_file",
      expect.anything(),
    );
    expect(mockSubscription.publish).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "bad-write-0", ok: false }),
    );
    expect(mockSubscription.publish).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "bad-write-1", ok: false }),
    );
  });
});

it.each([
  ["desktop_disconnect", false],
  ["desktop_kicked_by_new_session", false],
  ["presence_sweep", true],
])(
  "clears ready state after %s and only permits appropriate reconnect",
  async (disconnectReason, canReconnect) => {
    const { Centrifuge } = await import("centrifuge");
    const onConnectionStateChange = jest.fn();
    const bridge = new DesktopSandboxBridge(
      buildConfig({
        onConnectionStateChange,
        refreshCentrifugoTokenDesktop: jest.fn().mockResolvedValue({
          ok: false,
          terminated: true,
          reason: "connection_inactive",
          connectionId: "conn-123",
          clientVersion: null,
          status: "disconnected",
          disconnectReason,
          msSinceDisconnected: 0,
          msSinceLastHeartbeat: 0,
          msSinceCreated: 0,
        }),
      }),
    );
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
    await bridge.start();
    emitBridgeEvent(mockSubscription, "subscribed");
    mockClient.state = "disconnected";
    emitBridgeEvent(mockClient, "disconnected", { code: 3 });
    const options = (Centrifuge as unknown as jest.Mock).mock.calls[0][1];
    await expect(options.getToken()).rejects.toThrow(/connection_inactive/);
    expect(bridge.isReady()).toBe(false);
    expect(bridge.getConnectionId()).toBeNull();
    expect(bridge.canReconnect()).toBe(canReconnect);
    expect(bridge.reconnectTransport()).toBe(false);
    expect(mockClient.connect).toHaveBeenCalledTimes(1);
    expect(onConnectionStateChange).toHaveBeenLastCalledWith(false);
    warning.mockRestore();
  },
);

it("rejects a malformed expected version instead of removing its concurrency guard", async () => {
  const bridge = new DesktopSandboxBridge(buildConfig());
  await bridge.start();
  const { invoke } = await import("@tauri-apps/api/core");
  (invoke as jest.Mock).mockClear();
  getPublicationHandler()({
    data: {
      type: "desktop_local_access_request",
      operation: "write_file",
      requestId: "bad-version",
      targetConnectionId: "conn-123",
      payload: {
        grantId: "opaque-grant",
        relativePath: "a.txt",
        content: "hello",
        expectedVersion: 42,
      },
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(invoke).not.toHaveBeenCalledWith(
    "write_workspace_file",
    expect.anything(),
  );
  expect(mockSubscription.publish).toHaveBeenCalledWith(
    expect.objectContaining({ requestId: "bad-version", ok: false }),
  );
});

it("disconnects the socket even if unsubscribing fails during stop", async () => {
  const bridge = new DesktopSandboxBridge(buildConfig());
  await bridge.start();
  emitBridgeEvent(mockSubscription, "subscribed");
  mockSubscription.unsubscribe.mockImplementationOnce(() => {
    throw new Error("Already closed");
  });
  await bridge.stop();
  expect(mockClient.disconnect).toHaveBeenCalled();
  expect(bridge.isReady()).toBe(false);
});

describe("local operation outcomes across reconnect", () => {
  const writeRequest = {
    type: "desktop_local_access_request" as const,
    requestId: "write-once",
    operation: "write_file" as const,
    targetConnectionId: "conn-123",
    payload: { grantId: "grant", relativePath: "note.txt", content: "updated" },
  };
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };

  it("executes duplicate pending and completed writes only once", async () => {
    const bridge = new DesktopSandboxBridge(buildConfig());
    await bridge.start();
    let finish!: (value: unknown) => void;
    const write = jest.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    mockInvokeHandler = async (cmd) =>
      cmd === "write_workspace_file" ? write() : undefined;
    const handler = getPublicationHandler();
    handler({ data: writeRequest });
    handler({ data: writeRequest });
    await flush();
    expect(write).toHaveBeenCalledTimes(1);
    finish({ version: "saved", size: 7 });
    await flush();
    handler({ data: writeRequest });
    await flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(mockSubscription.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ok: true,
        result: { version: "saved", size: 7 },
      }),
    );
  });

  it("retries only the buffered success response after reconnect, never the write", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const bridge = new DesktopSandboxBridge(buildConfig());
      await bridge.start();
      const write = jest.fn(async () => ({ version: "saved" }));
      mockInvokeHandler = async (cmd) =>
        cmd === "write_workspace_file" ? write() : undefined;
      mockSubscription.publish.mockRejectedValueOnce(new Error("socket lost"));
      getPublicationHandler()({ data: writeRequest });
      await flush();
      expect(
        mockSubscription.publish.mock.calls.some(
          ([message]) => message.ok === false,
        ),
      ).toBe(false);
      const subscribed = mockSubscription.on.mock.calls.find(
        ([event]) => event === "subscribed",
      )![1];
      subscribed({});
      await flush();
      expect(write).toHaveBeenCalledTimes(1);
      expect(mockSubscription.publish).toHaveBeenLastCalledWith(
        expect.objectContaining({ ok: true, result: { version: "saved" } }),
      );
      expect(mockSubscription.publish).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("preserves buffered results and native deduplication through code3 transport recovery", async () => {
    const config = buildConfig();
    const bridge = new DesktopSandboxBridge(config);
    await bridge.start();
    const write = jest.fn(async () => ({ version: "saved" }));
    mockInvokeHandler = async (cmd) =>
      cmd === "write_workspace_file" ? write() : undefined;
    mockSubscription.publish.mockRejectedValueOnce(
      new Error("message too large"),
    );
    const handler = getPublicationHandler();
    handler({ data: writeRequest });
    await flush();
    mockClient.state = "disconnected";
    emitBridgeEvent(mockClient, "disconnected", { code: 3 });
    expect(bridge.reconnectTransport()).toBe(true);
    emitBridgeEvent(mockSubscription, "subscribed");
    await flush();
    expect(mockSubscription.publish).toHaveBeenCalledTimes(2);
    handler({ data: writeRequest });
    await flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(config.connectDesktop).toHaveBeenCalledTimes(1);
    expect(mockSubscription.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ ok: true, result: { version: "saved" } }),
    );
  });

  it("never publishes an old native result into a replacement connection", async () => {
    const config = buildConfig();
    const bridge = new DesktopSandboxBridge(config);
    await bridge.start();
    let finish!: (value: unknown) => void;
    mockInvokeHandler = async (cmd) =>
      cmd === "write_workspace_file"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : undefined;
    getPublicationHandler()({ data: writeRequest });
    await flush();
    await bridge.stop();
    config.connectDesktop.mockResolvedValueOnce({
      connectionId: "new-connection",
      centrifugoToken: createTestJwt("other-user"),
      centrifugoWsUrl: "ws://localhost:8000/connection/websocket",
    });
    await bridge.start();
    finish({ version: "saved" });
    await flush();
    expect(mockSubscription.publish).not.toHaveBeenCalled();
  });
});

test("duplicate computer inputs reach native control only once", async () => {
  const bridge = new DesktopSandboxBridge(buildConfig());
  await bridge.start();
  const input = jest.fn(async () => ({ performed: true }));
  mockInvokeHandler = async (cmd, args) =>
    cmd === "desktop_computer_action" ? input(args) : undefined;
  const request = {
    type: "desktop_local_access_request",
    targetConnectionId: "conn-123",
    requestId: "mouse-once",
    operation: "computer_action",
    payload: { action: "click", x: 0.2, y: 0.4 },
  };
  const handler = getPublicationHandler();
  handler({ data: request });
  handler({ data: request });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  handler({ data: request });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(input).toHaveBeenCalledTimes(1);
  expect(input).toHaveBeenCalledWith({ request: request.payload });
  await bridge.stop();
});
