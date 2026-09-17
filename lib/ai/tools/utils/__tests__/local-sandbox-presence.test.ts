import { EventEmitter } from "events";
jest.mock("@/lib/centrifugo/jwt", () => ({
  generateCentrifugoToken: jest.fn(async () => "fixture-token"),
}));
jest.mock("centrifuge", () => ({ Centrifuge: jest.fn(() => mockClient) }));
import { assertLocalSandboxOnline } from "../local-sandbox-presence";

let mockClient: EventEmitter & {
  newSubscription: jest.Mock;
  connect: jest.Mock;
  disconnect: jest.Mock;
  removeSubscription: jest.Mock;
};
let subscription: EventEmitter & {
  subscribe: jest.Mock;
  unsubscribe: jest.Mock;
  presence: jest.Mock;
};
beforeEach(() => {
  jest.useFakeTimers();
  subscription = Object.assign(new EventEmitter(), {
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    presence: jest.fn(),
  });
  mockClient = Object.assign(new EventEmitter(), {
    newSubscription: jest.fn(() => subscription),
    connect: jest.fn(() => subscription.emit("subscribed")),
    disconnect: jest.fn(),
    removeSubscription: jest.fn(),
  });
});
afterEach(() => jest.useRealTimers());

it("accepts only actual selected-runner presence and closes the read-only probe", async () => {
  subscription.presence.mockResolvedValue({
    clients: { runner: { connInfo: { connectionId: "runner" } } },
  });
  await expect(
    assertLocalSandboxOnline("owner", "runner", "ws://relay.test"),
  ).resolves.toBeUndefined();
  expect(mockClient.newSubscription).toHaveBeenCalledWith(
    "sandbox:connection:runner#owner",
  );
  expect(mockClient.disconnect).toHaveBeenCalled();
  expect(subscription.unsubscribe).toHaveBeenCalled();
});

it("does not mistake its own backend subscription for an online runner", async () => {
  subscription.presence.mockResolvedValue({
    clients: { probe: { user: "owner" } },
  });
  const rejected = expect(
    assertLocalSandboxOnline("owner", "runner", "ws://relay.test"),
  ).rejects.toThrow(/offline/);
  await jest.advanceTimersByTimeAsync(5_000);
  await rejected;
  expect(mockClient.disconnect).toHaveBeenCalled();
});

it("waits for the selected runner to finish reconnecting within the existing deadline", async () => {
  subscription.presence
    .mockResolvedValueOnce({ clients: { probe: { user: "owner" } } })
    .mockResolvedValue({
      clients: { runner: { connInfo: { connectionId: "runner" } } },
    });
  const result = assertLocalSandboxOnline("owner", "runner", "ws://relay.test");
  const resolved = expect(result).resolves.toBeUndefined();
  await jest.advanceTimersByTimeAsync(1_000);
  await resolved;
  expect(subscription.presence).toHaveBeenCalledTimes(2);
  expect(mockClient.disconnect).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it("recovers a transient presence request failure without replacing the subscription", async () => {
  subscription.presence
    .mockRejectedValueOnce(new Error("transport temporarily closed"))
    .mockResolvedValue({
      clients: { runner: { connInfo: { connectionId: "runner" } } },
    });
  const result = assertLocalSandboxOnline("owner", "runner", "ws://relay.test");
  const resolved = expect(result).resolves.toBeUndefined();
  await jest.advanceTimersByTimeAsync(1_000);
  await resolved;
  expect(mockClient.newSubscription).toHaveBeenCalledTimes(1);
  expect(subscription.presence).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
});

it("allows the SDK to reconnect after a transient initial transport error", async () => {
  subscription.presence.mockResolvedValue({
    clients: { runner: { connInfo: { connectionId: "runner" } } },
  });
  mockClient.connect.mockImplementation(() => {
    mockClient.emit("error", {
      type: "transport",
      error: { code: 2, message: "closed" },
    });
    setTimeout(() => subscription.emit("subscribed"), 300);
  });
  const result = assertLocalSandboxOnline("owner", "runner", "ws://relay.test");
  const resolved = expect(result).resolves.toBeUndefined();
  await jest.advanceTimersByTimeAsync(1_000);
  await resolved;
  expect(subscription.presence).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it("still rejects a terminal disconnection immediately", async () => {
  mockClient.connect.mockImplementation(() =>
    mockClient.emit("disconnected", { code: 1, reason: "unauthorized" }),
  );
  await expect(
    assertLocalSandboxOnline("owner", "runner", "ws://relay.test"),
  ).rejects.toThrow(/offline/);
  expect(subscription.presence).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

it("bounds an unresponsive relay and releases the connection", async () => {
  mockClient.connect.mockImplementation(() => {});
  const result = assertLocalSandboxOnline("owner", "runner", "ws://relay.test");
  const rejected = expect(result).rejects.toThrow(/offline|unavailable/);
  await jest.advanceTimersByTimeAsync(5_000);
  await rejected;
  expect(mockClient.disconnect).toHaveBeenCalled();
});

it("does not resume probing when an old presence response arrives after the deadline", async () => {
  let resolve!: (presence: unknown) => void;
  subscription.presence.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const result = assertLocalSandboxOnline("owner", "runner", "ws://relay.test");
  const rejected = expect(result).rejects.toThrow(/offline/);
  await jest.advanceTimersByTimeAsync(5_000);
  await rejected;
  resolve({ clients: { runner: { connInfo: { connectionId: "runner" } } } });
  await jest.advanceTimersByTimeAsync(1_000);
  expect(subscription.presence).toHaveBeenCalledTimes(1);
  expect(mockClient.disconnect).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it("does not accept another connected runner while the selected device is offline", async () => {
  subscription.presence.mockResolvedValue({
    clients: { other: { connInfo: { connectionId: "another-runner" } } },
  });
  const result = assertLocalSandboxOnline("owner", "runner", "ws://relay.test");
  const rejected = expect(result).rejects.toThrow(/offline/);
  await jest.advanceTimersByTimeAsync(5_000);
  await rejected;
  expect(subscription.presence.mock.calls.length).toBeGreaterThan(1);
  expect(jest.getTimerCount()).toBe(0);
});
