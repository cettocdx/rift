/** @jest-environment node */
import { createScopedCancellationSubscriber } from "../http-execution-cancellation";
import { readHackHttpExecution } from "@/lib/hack/http-execution";
import { createRedisSubscriber } from "../redis-pubsub";
jest.mock("@/lib/hack/http-execution", () => ({
  readHackHttpExecution: jest.fn(),
}));
jest.mock("../redis-pubsub", () => ({
  createRedisSubscriber: jest.fn(),
  getCancelChannel: (chat: string, id?: string) =>
    id
      ? `stream:cancel:execution:${encodeURIComponent(chat)}:${encodeURIComponent(id)}`
      : `stream:cancel:${chat}`,
}));
const binding = { userId: "owner", chatId: "chat", executionId: "one" };
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
let listener: (value: string) => void;
let client: any;
beforeEach(() => {
  jest.useFakeTimers();
  (readHackHttpExecution as jest.Mock)
    .mockReset()
    .mockResolvedValue({ executionId: "one", stopped: false, discard: false });
  client = {
    subscribe: jest.fn(async (_channel, callback) => {
      listener = callback;
    }),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
  };
  (createRedisSubscriber as jest.Mock).mockReset().mockResolvedValue(client);
});
afterEach(() => jest.useRealTimers());
it("keeps durable polling even with healthy Redis so missed messages still stop the exact run", async () => {
  const abortController = new AbortController();
  const onStop = jest.fn();
  const sub = await createScopedCancellationSubscriber({
    binding,
    abortController,
    onStop,
    pollIntervalMs: 10,
  });
  await tick();
  expect(client.subscribe).toHaveBeenCalledWith(
    "stream:cancel:execution:chat:one",
    expect.any(Function),
  );
  (readHackHttpExecution as jest.Mock).mockResolvedValue({
    executionId: "one",
    stopped: true,
    discard: true,
  });
  await jest.advanceTimersByTimeAsync(10);
  expect(abortController.signal.aborted).toBe(true);
  expect(onStop).toHaveBeenCalledTimes(1);
  expect(await sub.resolveSkipSave()).toBe(true);
  await sub.stop();
});
it("ignores a notification from another generation and confirms matching notifications against durable state", async () => {
  const abortController = new AbortController();
  const sub = await createScopedCancellationSubscriber({
    binding,
    abortController,
    onStop: jest.fn(),
  });
  await tick();
  const calls = (readHackHttpExecution as jest.Mock).mock.calls.length;
  listener(JSON.stringify({ executionId: "two", canceled: true }));
  await tick();
  expect(readHackHttpExecution).toHaveBeenCalledTimes(calls);
  listener(JSON.stringify({ executionId: "one", canceled: true }));
  await tick();
  expect(abortController.signal.aborted).toBe(false);
  (readHackHttpExecution as jest.Mock).mockResolvedValue({
    executionId: "one",
    stopped: true,
  });
  listener(JSON.stringify({ executionId: "one", canceled: true }));
  await tick();
  expect(abortController.signal.aborted).toBe(true);
  await sub.stop();
});
it("registers abort cleanup before async Redis setup and cleans a late connection", async () => {
  let connected!: (client: any) => void;
  (createRedisSubscriber as jest.Mock).mockImplementation(
    () =>
      new Promise((resolve) => {
        connected = resolve;
      }),
  );
  const abortController = new AbortController();
  const onStop = jest.fn();
  const sub = await createScopedCancellationSubscriber({
    binding,
    abortController,
    onStop,
  });
  abortController.abort();
  connected(client);
  await tick();
  expect(onStop).toHaveBeenCalledTimes(1);
  expect(client.subscribe).not.toHaveBeenCalled();
  expect(client.quit).toHaveBeenCalledTimes(1);
  await sub.stop();
});
it("does not allocate Redis or polling after an already-aborted request", async () => {
  const abortController = new AbortController();
  abortController.abort();
  const onStop = jest.fn();
  const sub = await createScopedCancellationSubscriber({
    binding,
    abortController,
    onStop,
  });
  expect(createRedisSubscriber).not.toHaveBeenCalled();
  expect(readHackHttpExecution).not.toHaveBeenCalled();
  expect(onStop).toHaveBeenCalledTimes(1);
  await sub.stop();
});
it("checks again after subscription installation to cover Stop during the setup gap", async () => {
  client.subscribe.mockImplementation(async () => {
    (readHackHttpExecution as jest.Mock).mockResolvedValue({
      executionId: "one",
      stopped: true,
    });
  });
  const abortController = new AbortController();
  const onStop = jest.fn();
  const sub = await createScopedCancellationSubscriber({
    binding,
    abortController,
    onStop,
  });
  await tick();
  expect(abortController.signal.aborted).toBe(true);
  expect(onStop).toHaveBeenCalledTimes(1);
  await sub.stop();
});
it("manual cleanup removes callbacks and future polls without recording a user Stop", async () => {
  const abortController = new AbortController();
  const onStop = jest.fn();
  const sub = await createScopedCancellationSubscriber({
    binding,
    abortController,
    onStop,
    pollIntervalMs: 10,
  });
  await tick();
  await sub.stop();
  const calls = (readHackHttpExecution as jest.Mock).mock.calls.length;
  abortController.abort();
  await jest.advanceTimersByTimeAsync(100);
  expect(onStop).not.toHaveBeenCalled();
  expect(readHackHttpExecution).toHaveBeenCalledTimes(calls);
});
it("settles startup promptly when aborted during a stalled initial read", async () => {
  (readHackHttpExecution as jest.Mock).mockImplementation(
    () => new Promise(() => {}),
  );
  const abortController = new AbortController();
  const pending = createScopedCancellationSubscriber({
    binding,
    abortController,
    onStop: jest.fn(),
    readTimeoutMs: 20,
  });
  abortController.abort();
  await tick();
  const sub = await pending;
  expect(createRedisSubscriber).not.toHaveBeenCalled();
  await sub.stop();
});
it("retries polling after a stalled durable read times out", async () => {
  (createRedisSubscriber as jest.Mock).mockResolvedValue(null);
  (readHackHttpExecution as jest.Mock)
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValue({ executionId: "one", stopped: true });
  const abortController = new AbortController();
  const pending = createScopedCancellationSubscriber({
    binding,
    abortController,
    onStop: jest.fn(),
    readTimeoutMs: 20,
    pollIntervalMs: 10,
  });
  await jest.advanceTimersByTimeAsync(20);
  const sub = await pending;
  await jest.advanceTimersByTimeAsync(10);
  expect(abortController.signal.aborted).toBe(true);
  await sub.stop();
});
it("bounds finalization reads but still checks discard after abort", async () => {
  const abortController = new AbortController();
  abortController.abort();
  const sub = await createScopedCancellationSubscriber({
    binding,
    abortController,
    onStop: jest.fn(),
    readTimeoutMs: 20,
  });
  (readHackHttpExecution as jest.Mock).mockImplementationOnce(
    () => new Promise(() => {}),
  );
  const stalled = sub.resolveSkipSave();
  await jest.advanceTimersByTimeAsync(20);
  expect(await stalled).toBe(false);
  (readHackHttpExecution as jest.Mock).mockResolvedValue({
    executionId: "one",
    stopped: true,
    discard: true,
  });
  expect(await sub.resolveSkipSave()).toBe(true);
});
it("continues scheduled polling after a later read stalls and ignores its late Stop", async () => {
  (createRedisSubscriber as jest.Mock).mockResolvedValue(null);
  let late!: (value: unknown) => void;
  (readHackHttpExecution as jest.Mock)
    .mockResolvedValueOnce({ executionId: "one", stopped: false })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          late = resolve;
        }),
    )
    .mockResolvedValue({ executionId: "one", stopped: false });
  const abortController = new AbortController();
  const sub = await createScopedCancellationSubscriber({
    binding,
    abortController,
    onStop: jest.fn(),
    pollIntervalMs: 10,
    readTimeoutMs: 20,
  });
  await jest.advanceTimersByTimeAsync(40);
  expect(readHackHttpExecution).toHaveBeenCalledTimes(3);
  late({ executionId: "one", stopped: true, discard: true });
  await tick();
  expect(abortController.signal.aborted).toBe(false);
  expect(sub.shouldSkipSave()).toBe(false);
  await sub.stop();
  expect(jest.getTimerCount()).toBe(0);
});
