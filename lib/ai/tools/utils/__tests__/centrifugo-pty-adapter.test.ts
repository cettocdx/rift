/** @jest-environment node */
import { EventEmitter } from "node:events";
import { createCentrifugoPtyHandle } from "../centrifugo-pty-adapter";
import type { CentrifugoSandbox } from "../centrifugo-sandbox";
let mockClient: EventEmitter & { disconnect: jest.Mock };
let mockSub: EventEmitter & { publish: jest.Mock; unsubscribe: jest.Mock };
let mockOptions: { getToken?: () => Promise<string> };
jest.mock("centrifuge", () => ({
  Centrifuge: jest.fn((_url, options) => {
    mockOptions = options;
    mockSub = Object.assign(new EventEmitter(), {
      publish: jest.fn().mockResolvedValue({}),
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
    });
    mockClient = Object.assign(new EventEmitter(), {
      connect: jest.fn(),
      disconnect: jest.fn(),
      newSubscription: () => mockSub,
    });
    return mockClient;
  }),
}));
const issueToken = jest.fn(async () => "token");
const sandbox = {
  getUserId: () => "user",
  getConnectionId: () => "connection",
  getWsUrl: () => "ws://local.test",
  issueToken,
} as unknown as CentrifugoSandbox;
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const start = async () => {
  const pending = createCentrifugoPtyHandle(sandbox, {
    command: "long-work",
    cols: 80,
    rows: 24,
  });
  await flush();
  return { pending };
};
const sessionId = () => mockSub.publish.mock.calls[0][0].sessionId;
const ready = () =>
  mockSub.emit("publication", {
    data: { type: "pty_ready", sessionId: sessionId(), pid: 1 },
  });
const exit = () =>
  mockSub.emit("publication", {
    data: { type: "pty_exit", sessionId: sessionId(), exitCode: 0 },
  });
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});
test.each([false, true])(
  "never recreates the same PTY on reconnect, ready=%s",
  async (wasReady) => {
    const { pending } = await start();
    mockSub.emit("subscribed");
    if (wasReady) ready();
    mockSub.emit("subscribed");
    expect(mockSub.publish).toHaveBeenCalledTimes(1);
    if (!wasReady) ready();
    const handle = await pending;
    exit();
    await expect(handle.exited).resolves.toEqual({ exitCode: 0 });
  },
);
test("long-lived PTYs can refresh their connection token without recreating the command", async () => {
  const { pending } = await start();
  mockSub.emit("subscribed");
  ready();
  const handle = await pending;
  expect(mockOptions.getToken).toEqual(expect.any(Function));
  await expect(mockOptions.getToken!()).resolves.toBe("token");
  expect(issueToken).toHaveBeenCalledTimes(2);
  expect(mockSub.publish).toHaveBeenCalledTimes(1);
  exit();
  await handle.exited;
});
test("a terminal disconnect after ready resolves an unknown exit rather than hanging", async () => {
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const { pending } = await start();
    mockSub.emit("subscribed");
    ready();
    const handle = await pending;
    let outcome: unknown = "pending";
    void handle.exited.then((value) => {
      outcome = value;
    });
    mockClient.emit("disconnected", { code: 1, reason: "unauthorized" });
    await flush();
    expect(outcome).toEqual({ exitCode: null });
  } finally {
    spy.mockRestore();
  }
});
test("a terminal disconnect before ready immediately rejects startup", async () => {
  const { pending } = await start();
  let outcome: unknown = "pending";
  void pending.catch((error) => {
    outcome = error;
  });
  mockClient.emit("disconnected", { code: 1, reason: "unauthorized" });
  await flush();
  expect(outcome).toBeInstanceOf(Error);
});

test.each(["disconnect", "timeout", "pty_error"])(
  "%s cannot confirm termination despite legacy unknown exit",
  async (kind) => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { pending } = await start();
      mockSub.emit("subscribed");
      ready();
      const handle = await pending;
      expect(handle.confirmedExited).toBeDefined();
      const rejection = expect(handle.confirmedExited).rejects.toThrow();
      if (kind === "disconnect") mockClient.emit("disconnected", {});
      else if (kind === "pty_error")
        mockSub.emit("publication", {
          data: {
            type: "pty_error",
            sessionId: sessionId(),
            message: "unknown outcome",
          },
        });
      else {
        const kill = handle.kill();
        await jest.advanceTimersByTimeAsync(1501);
        await kill;
      }
      await expect(handle.exited).resolves.toEqual({ exitCode: null });
      await rejection;
    } finally {
      spy.mockRestore();
    }
  },
);
test("only the matching actual pty_exit publication confirms termination", async () => {
  const { pending } = await start();
  mockSub.emit("subscribed");
  ready();
  const handle = await pending;
  expect(handle.confirmedExited).toBeDefined();
  let done = false;
  void handle.confirmedExited!.then(() => {
    done = true;
  });
  mockSub.emit("publication", {
    data: { type: "pty_exit", sessionId: "other", exitCode: 0 },
  });
  await flush();
  expect(done).toBe(false);
  exit();
  await expect(handle.confirmedExited).resolves.toEqual({ exitCode: 0 });
});
