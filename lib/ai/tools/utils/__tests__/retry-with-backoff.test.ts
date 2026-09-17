/** @jest-environment node */
jest.mock("@/lib/posthog/worker", () => ({
  createRetryLogger: () => jest.fn(),
}));
jest.mock("@e2b/code-interpreter", () => jest.requireActual("e2b"));
import { retryWithBackoff } from "../retry-with-backoff";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("cancellation during a rejected attempt does not install a backoff timer", async () => {
  const controller = new AbortController();
  const operation = jest.fn(async () => {
    controller.abort();
    throw new Error("transport ended");
  });
  const result = retryWithBackoff(operation, {
    signal: controller.signal,
    logger: jest.fn(),
  });
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(jest.getTimerCount()).toBe(0);
  await rejected;
  expect(operation).toHaveBeenCalledTimes(1);
});

test("an AbortError is not retried without a separate signal", async () => {
  const error = new DOMException("Canceled", "AbortError");
  const operation = jest.fn().mockRejectedValue(error);
  const result = retryWithBackoff(operation, { logger: jest.fn() });
  const rejected = expect(result).rejects.toBe(error);
  await jest.runAllTimersAsync();
  await rejected;
  expect(operation).toHaveBeenCalledTimes(1);
});

test("transient failures still recover with bounded attempts", async () => {
  const operation = jest
    .fn()
    .mockRejectedValueOnce(new Error("temporary"))
    .mockResolvedValue("ready");
  const result = retryWithBackoff(operation, {
    jitterMs: 0,
    logger: jest.fn(),
  });
  await jest.runAllTimersAsync();
  await expect(result).resolves.toBe("ready");
  expect(operation).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
});

test("Stop during backoff removes its timer and listener immediately", async () => {
  const controller = new AbortController();
  const remove = jest.spyOn(controller.signal, "removeEventListener");
  const operation = jest.fn().mockRejectedValue(new Error("temporary"));
  const result = retryWithBackoff(operation, {
    signal: controller.signal,
    logger: jest.fn(),
  });
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  controller.abort();
  await rejected;
  expect(jest.getTimerCount()).toBe(0);
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  expect(operation).toHaveBeenCalledTimes(1);
});
