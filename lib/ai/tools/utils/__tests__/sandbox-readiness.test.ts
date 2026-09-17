/** @jest-environment node */
jest.mock("@/lib/posthog/worker", () => ({
  createRetryLogger: () => jest.fn(),
}));
jest.mock("@e2b/code-interpreter", () => jest.requireActual("e2b"));
jest.mock("../sandbox-types", () => ({ isE2BSandbox: () => true }));

import {
  AuthenticationError,
  NotFoundError,
  NotEnoughSpaceError,
  TimeoutError,
} from "../e2b-errors";
import { waitForSandboxReady } from "../sandbox-health";
import type { AnySandbox } from "@/types";

const flush = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
const fixture = () => ({
  isRunning: jest.fn().mockResolvedValue(true),
  getMetrics: jest.fn().mockImplementation(() => new Promise(() => {})),
  commands: { run: jest.fn().mockResolvedValue({ exitCode: 0 }) },
});

test.each([
  new NotFoundError("missing"),
  new NotEnoughSpaceError("full"),
  new TimeoutError("sandbox timeout"),
])(
  "permanent readiness errors fail once without scheduling another probe: %s",
  async (error) => {
    jest.useFakeTimers();
    try {
      const sandbox = fixture();
      sandbox.commands.run.mockRejectedValue(error);
      let observed: unknown;
      const result = waitForSandboxReady(
        sandbox as unknown as AnySandbox,
      ).catch((e) => {
        observed = e;
      });
      await flush();
      expect(observed).toBe(error);
      expect(jest.getTimerCount()).toBe(0);
      expect(sandbox.commands.run).toHaveBeenCalledTimes(1);
      await result;
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  },
);

test("a healthy command probe does not wait for optional resource telemetry", async () => {
  const sandbox = fixture();
  let ready = false;
  const result = waitForSandboxReady(sandbox as unknown as AnySandbox).then(
    () => {
      ready = true;
    },
  );
  await flush();
  expect(ready).toBe(true);
  expect(sandbox.commands.run).toHaveBeenCalledTimes(1);
  expect(sandbox.getMetrics).not.toHaveBeenCalled();
  await result;
});

test("a permanent probe failure is preserved without waiting on diagnostics", async () => {
  const sandbox = fixture();
  sandbox.getMetrics.mockResolvedValueOnce([]);
  const error = new AuthenticationError("fixture auth rejected");
  sandbox.commands.run.mockRejectedValue(error);
  let observed: unknown;
  const result = waitForSandboxReady(sandbox as unknown as AnySandbox).catch(
    (e) => {
      observed = e;
    },
  );
  await flush();
  expect(observed).toBe(error);
  expect(sandbox.commands.run).toHaveBeenCalledTimes(1);
  await result;
});

test("Stop during a running-status read prevents the probe from starting", async () => {
  const sandbox = fixture();
  sandbox.getMetrics.mockResolvedValue([]);
  let resolve!: (running: boolean) => void;
  sandbox.isRunning.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const controller = new AbortController();
  const result = waitForSandboxReady(
    sandbox as unknown as AnySandbox,
    5,
    controller.signal,
  );
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  resolve(true);
  await rejected;
  expect(sandbox.commands.run).not.toHaveBeenCalled();
});

test("Stop at probe completion cannot return ready to the caller", async () => {
  const sandbox = fixture();
  sandbox.getMetrics.mockResolvedValue([]);
  const controller = new AbortController();
  sandbox.commands.run.mockImplementation(async () => {
    controller.abort();
    return { exitCode: 0 };
  });
  await expect(
    waitForSandboxReady(sandbox as unknown as AnySandbox, 5, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(sandbox.commands.run).toHaveBeenCalledTimes(1);
});
