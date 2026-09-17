/** @jest-environment node */
import { EventEmitter } from "node:events";
import { waitForCommandReceiver } from "../command-readiness";

it("repeats only readiness probes until the receiver returns the matching nonce", async () => {
  jest.useFakeTimers();
  const sub = Object.assign(new EventEmitter(), { publish: jest.fn(async (_message: unknown) => {}) });
  const pending = waitForCommandReceiver(sub, "runner");
  await Promise.resolve();
  const probe = sub.publish.mock.calls[0][0] as any;
  sub.emit("publication", { data: { ...probe, type: "runner_ready", targetConnectionId: "other" } });
  await jest.advanceTimersByTimeAsync(500);
  expect(sub.publish).toHaveBeenCalledTimes(2);
  expect(sub.publish.mock.calls.every(([data]) => (data as any).type === "runner_probe")).toBe(true);
  sub.emit("publication", { data: { ...probe, type: "runner_ready" } });
  await pending;
  expect(sub.listenerCount("publication")).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

it("fails without issuing a command when readiness times out", async () => {
  jest.useFakeTimers();
  const sub = Object.assign(new EventEmitter(), { publish: jest.fn(async () => {}) });
  const pending = waitForCommandReceiver(sub, "runner");
  const rejected = expect(pending).rejects.toThrow("not ready");
  await jest.advanceTimersByTimeAsync(10000);
  await rejected;
  expect(sub.listenerCount("publication")).toBe(0);
  jest.useRealTimers();
});

it("cancels the readiness wait without sending a command", async () => {
  const sub = Object.assign(new EventEmitter(), { publish: jest.fn(async () => {}) });
  const stop = new AbortController();
  const pending = waitForCommandReceiver(sub, "runner", stop.signal);
  stop.abort(new Error("Stopped"));
  await expect(pending).rejects.toThrow("Stopped");
  expect(sub.listenerCount("publication")).toBe(0);
});
