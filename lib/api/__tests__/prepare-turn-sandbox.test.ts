/** @jest-environment node */
import { prepareTurnSandbox } from "../prepare-turn-sandbox";

it("starts cloud work without awaiting a cold sandbox", async () => {
  let finish!: () => void;
  const ensureSandbox = jest.fn(
    () =>
      new Promise<void>((r) => {
        finish = r;
      }),
  );
  await prepareTurnSandbox({
    executionPreference: "e2b",
    standaloneGreeting: false,
    ensureSandbox,
    signal: new AbortController().signal,
  });
  expect(ensureSandbox).toHaveBeenCalledTimes(1);
  finish();
});
it("requires the selected local computer even for a greeting", async () => {
  const ensureSandbox = jest.fn().mockRejectedValue(new Error("offline"));
  await expect(
    prepareTurnSandbox({
      executionPreference: "local",
      standaloneGreeting: true,
      ensureSandbox,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("offline");
  expect(ensureSandbox).toHaveBeenCalledTimes(1);
});
it("does not start anything after cancellation", async () => {
  const abort = new AbortController();
  abort.abort();
  const ensureSandbox = jest.fn();
  await expect(
    prepareTurnSandbox({
      executionPreference: "e2b",
      standaloneGreeting: false,
      ensureSandbox,
      signal: abort.signal,
    }),
  ).rejects.toThrow();
  expect(ensureSandbox).not.toHaveBeenCalled();
});
it("lets the eventual cloud tool surface a failed optional warmup", async () => {
  const ensureSandbox = jest
    .fn()
    .mockRejectedValue(new Error("temporarily unavailable"));
  await expect(
    prepareTurnSandbox({
      executionPreference: "e2b",
      standaloneGreeting: false,
      ensureSandbox,
      signal: new AbortController().signal,
    }),
  ).resolves.toBeUndefined();
});
it("does not allocate a cloud sandbox for a standalone greeting", async () => {
  const ensureSandbox = jest.fn().mockResolvedValue({});
  await prepareTurnSandbox({
    executionPreference: "e2b",
    standaloneGreeting: true,
    ensureSandbox,
    signal: new AbortController().signal,
  });
  expect(ensureSandbox).not.toHaveBeenCalled();
});
