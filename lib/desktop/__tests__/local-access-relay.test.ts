/** @jest-environment node */
import { requestDesktopLocalAccess } from "../local-access-relay";

const originalRelaySecret = process.env.CENTRIFUGO_TOKEN_SECRET;
afterAll(() => {
  if (originalRelaySecret === undefined)
    delete process.env.CENTRIFUGO_TOKEN_SECRET;
  else process.env.CENTRIFUGO_TOKEN_SECRET = originalRelaySecret;
});
const mockPresence = jest.fn();
jest.mock("@/lib/ai/tools/utils/local-sandbox-presence", () => ({
  assertLocalSandboxOnline: (...args: unknown[]) => mockPresence(...args),
}));
const mockQuery = jest.fn();
const mockToken = jest.fn();
const mockSubHandlers = new Map<string, (value?: any) => void>();
const mockClientHandlers = new Map<string, (value?: any) => void>();
const mockSubscription = {
  on: jest.fn((name, fn) => {
    mockSubHandlers.set(name, fn);
  }),
  subscribe: jest.fn(),
  unsubscribe: jest.fn(),
  removeAllListeners: jest.fn(),
  publish: jest.fn(),
};
const mockClient = {
  newSubscription: jest.fn(() => mockSubscription),
  on: jest.fn((name, fn) => {
    mockClientHandlers.set(name, fn);
  }),
  connect: jest.fn(),
  disconnect: jest.fn(),
};
jest.mock("server-only", () => ({}));
jest.mock("centrifuge", () => ({ Centrifuge: jest.fn(() => mockClient) }));
jest.mock("@/convex/_generated/api", () => ({
  api: { localSandbox: { listConnectionsForBackend: "connections" } },
}));
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: () => ({ query: mockQuery }),
}));
jest.mock("@/lib/centrifugo/jwt", () => ({
  generateCentrifugoToken: (...args: unknown[]) => mockToken(...args),
}));

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const request = (extra = {}) =>
  requestDesktopLocalAccess({
    userId: "user",
    serviceKey: "test-only",
    operation: "write_file",
    payload: { grantId: "grant", relativePath: "note.txt", content: "new" },
    ...extra,
  });
const answer = (ok = true) => {
  const sent = mockSubscription.publish.mock.calls[0][0];
  mockSubHandlers.get("publication")?.({
    data: {
      type: "desktop_local_access_result",
      requestId: sent.requestId,
      ok,
      ...(ok ? { result: { version: "saved" } } : { error: "read-only grant" }),
    },
  });
};
beforeEach(() => {
  jest.clearAllMocks();
  mockSubHandlers.clear();
  mockClientHandlers.clear();
  mockQuery.mockResolvedValue([
    { connectionId: "desktop", isDesktop: true, lastSeen: 1 },
  ]);
  mockPresence.mockResolvedValue(undefined);
  mockToken.mockResolvedValue("test-token");
  mockSubscription.publish.mockResolvedValue({});
  process.env.CENTRIFUGO_WS_URL = "ws://localhost.test";
  process.env.CENTRIFUGO_TOKEN_SECRET = "fixture-token-secret";
});

test("a reconnect never republishes a dispatched local operation", async () => {
  const result = request();
  await flush();
  mockSubHandlers.get("subscribed")?.();
  mockSubHandlers.get("subscribed")?.();
  answer();
  await expect(result).resolves.toEqual({ version: "saved" });
  expect(mockSubscription.publish).toHaveBeenCalledTimes(1);
});

test("abort during connection discovery prevents any command publication", async () => {
  const controller = new AbortController();
  let resolve!: (value: unknown) => void;
  mockQuery.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const result = request({ signal: controller.signal });
  const rejection = expect(result).rejects.toMatchObject({ code: "aborted" });
  controller.abort();
  resolve([{ connectionId: "desktop", isDesktop: true, lastSeen: 1 }]);
  await flush();
  mockSubHandlers.get("subscribed")?.();
  answerIfSent();
  await rejection;
  expect(mockSubscription.publish).not.toHaveBeenCalled();
});
function answerIfSent() {
  if (mockSubscription.publish.mock.calls.length) answer();
}

test("abort during token minting prevents any command publication", async () => {
  const controller = new AbortController();
  let resolve!: (value: string) => void;
  mockToken.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const result = request({ signal: controller.signal });
  const rejection = expect(result).rejects.toMatchObject({ code: "aborted" });
  await flush();
  controller.abort();
  resolve("late-token");
  await flush();
  mockSubHandlers.get("subscribed")?.();
  answerIfSent();
  await rejection;
  expect(mockSubscription.publish).not.toHaveBeenCalled();
});

test("losing acknowledgement after write dispatch reports an unknown outcome", async () => {
  const result = request();
  const rejection = expect(result).rejects.toMatchObject({
    code: "outcome_unknown",
  });
  await flush();
  mockSubHandlers.get("subscribed")?.();
  mockClientHandlers.get("error")?.({ error: { message: "network lost" } });
  await rejection;
});

test("a native rejection remains a definite denied result", async () => {
  const result = request();
  const rejection = expect(result).rejects.toMatchObject({ code: "denied" });
  await flush();
  mockSubHandlers.get("subscribed")?.();
  answer(false);
  await rejection;
});

test("read transport errors do not claim a possibly completed write", async () => {
  const result = request({ operation: "read_file" });
  const rejection = expect(result).rejects.toMatchObject({
    code: "disconnected",
  });
  await flush();
  mockSubHandlers.get("subscribed")?.();
  mockClientHandlers.get("error")?.({ error: { message: "network lost" } });
  await rejection;
});

test.each(["click", "type", "key", "scroll"])(
  "lost %s acknowledgement must not replay desktop input",
  async (action) => {
    const result = request({
      operation: "computer_action",
      payload: { action },
    });
    const rejection = expect(result).rejects.toMatchObject({
      code: "outcome_unknown",
    });
    await flush();
    mockSubHandlers.get("subscribed")?.();
    mockClientHandlers.get("error")?.({ error: { message: "network lost" } });
    await rejection;
    expect(mockSubscription.publish).toHaveBeenCalledTimes(1);
  },
);

test("an offline desktop is rejected before waiting for a native browser action", async () => {
  mockPresence.mockRejectedValueOnce(new Error("offline"));
  await expect(
    request({ operation: "open_visible_url" }),
  ).rejects.toMatchObject({ code: "disconnected" });
  expect(mockClient.connect).not.toHaveBeenCalled();
  expect(mockSubscription.publish).not.toHaveBeenCalled();
});
