import { runTrackedPreflight } from "@/lib/rate-limit/preflight";
import type { RateLimitInfo } from "@/types";
import {
  prepareWorkerIntegrations,
  prepareWorkerUsage,
} from "../agent-worker-preparation";

it("checks entitlement while context loads and builds config as soon as its dependencies resolve", async () => {
  let finishCustomization!: (value: string) => void;
  let finishEntitlement!: () => void;
  const customization = new Promise<string>((resolve) => {
    finishCustomization = resolve;
  });
  const entitlement = new Promise<void>((resolve) => {
    finishEntitlement = resolve;
  });
  const check = jest.fn(() => entitlement);
  const build = jest.fn(async (custom: string, balance: number) => ({
    custom,
    balance,
  }));
  const pending = prepareWorkerUsage({
    check,
    customization,
    balance: Promise.resolve(42),
    build,
  });
  await Promise.resolve();
  expect(check).toHaveBeenCalledTimes(1);
  expect(build).not.toHaveBeenCalled();
  finishCustomization("settings");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(build).toHaveBeenCalledWith("settings", 42);
  let complete = false;
  void pending.then(() => {
    complete = true;
  });
  expect(complete).toBe(false);
  finishEntitlement();
  await expect(pending).resolves.toEqual({ custom: "settings", balance: 42 });
});

it("never treats a denied entitlement as prepared usage", async () => {
  await expect(
    prepareWorkerUsage({
      check: async () => {
        throw new Error("account denied");
      },
      customization: Promise.resolve(null),
      balance: Promise.resolve(null),
      build: async () => ({ ready: true }),
    }),
  ).rejects.toThrow("account denied");
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

it("starts independent lazy integration reads together and waits for both", async () => {
  const mcp = deferred<{ close: () => Promise<void> }>();
  const github = deferred<string | null>();
  const loadMcp = jest.fn(() => mcp.promise);
  const loadGithub = jest.fn(() => github.promise);
  const preparation = prepareWorkerIntegrations({
    signal: new AbortController().signal,
    loadMcp,
    loadGithub,
  });
  await tick();
  expect(loadMcp).toHaveBeenCalledTimes(1);
  expect(loadGithub).toHaveBeenCalledTimes(1);
  let ready = false;
  void preparation.ready.then(() => {
    ready = true;
  });
  mcp.resolve({ close: jest.fn(async () => {}) });
  await tick();
  expect(ready).toBe(false);
  github.resolve(null);
  await expect(preparation.ready).resolves.toMatchObject({ github: null });
  await preparation.close();
});

it("does not start either read when the run is already canceled", async () => {
  const stop = new AbortController();
  stop.abort(new Error("Stopped"));
  const loadMcp = jest.fn();
  const loadGithub = jest.fn();
  const preparation = prepareWorkerIntegrations({
    signal: stop.signal,
    loadMcp,
    loadGithub,
  });
  await expect(preparation.ready).rejects.toThrow("Stopped");
  await preparation.close();
  expect(loadMcp).not.toHaveBeenCalled();
  expect(loadGithub).not.toHaveBeenCalled();
});

it("closes an MCP result arriving after cancellation exactly once without delaying cancellation cleanup", async () => {
  const mcp = deferred<{ close: () => Promise<void> }>();
  const stop = new AbortController();
  const close = jest.fn(async () => {});
  const preparation = prepareWorkerIntegrations({
    signal: stop.signal,
    loadMcp: () => mcp.promise,
    loadGithub: async () => null,
  });
  await tick();
  stop.abort(new Error("Stopped"));
  await preparation.close();
  expect(close).not.toHaveBeenCalled();
  mcp.resolve({ close });
  await expect(preparation.ready).rejects.toThrow("Stopped");
  await preparation.close();
  await preparation.close();
  expect(close).toHaveBeenCalledTimes(1);
});

it("rejects use after early cleanup and consumes late loader rejections", async () => {
  const mcp = deferred<{ close: () => Promise<void> }>();
  const github = deferred<null>();
  const preparation = prepareWorkerIntegrations({
    signal: new AbortController().signal,
    loadMcp: () => mcp.promise,
    loadGithub: () => github.promise,
  });
  await tick();
  await preparation.close();
  github.reject(new Error("lookup failed"));
  await tick();
  const close = jest.fn(async () => {});
  mcp.resolve({ close });
  await tick();
  await expect(preparation.ready).rejects.toThrow(/closed/i);
  await preparation.close();
  expect(close).toHaveBeenCalledTimes(1);
});

it("never hands a closed integration to a caller even if both reads succeed", async () => {
  const mcp = deferred<{ close: () => Promise<void> }>();
  const preparation = prepareWorkerIntegrations({
    signal: new AbortController().signal,
    loadMcp: () => mcp.promise,
    loadGithub: async () => null,
  });
  await tick();
  await preparation.close();
  const close = jest.fn(async () => {});
  mcp.resolve({ close });
  await expect(preparation.ready).rejects.toThrow(/closed/i);
  await preparation.close();
  expect(close).toHaveBeenCalledTimes(1);
});

it("consumes a late close failure after cancellation while allowing explicit cleanup to observe it", async () => {
  const mcp = deferred<{ close: () => Promise<void> }>();
  const stop = new AbortController();
  const failure = new Error("close failed");
  const close = jest.fn(async () => {
    throw failure;
  });
  const preparation = prepareWorkerIntegrations({
    signal: stop.signal,
    loadMcp: () => mcp.promise,
    loadGithub: async () => null,
  });
  await tick();
  stop.abort(new Error("Stopped"));
  await preparation.close();
  mcp.resolve({ close });
  await tick();
  await expect(preparation.close()).rejects.toBe(failure);
  await expect(preparation.ready).rejects.toThrow("Stopped");
  expect(close).toHaveBeenCalledTimes(1);
});

it("settles preparation cancellation without waiting for either database read", async () => {
  const mcp = deferred<{ close: () => Promise<void> }>();
  const github = deferred<null>();
  const stop = new AbortController();
  const preparation = prepareWorkerIntegrations({
    signal: stop.signal,
    loadMcp: () => mcp.promise,
    loadGithub: () => github.promise,
  });
  let observed: unknown;
  const settled = preparation.ready.catch((error) => {
    observed = error;
  });
  await tick();
  stop.abort(new Error("Stopped immediately"));
  await tick();
  try {
    expect(observed).toBe(stop.signal.reason);
  } finally {
    mcp.resolve({ close: jest.fn(async () => {}) });
    github.resolve(null);
    await settled;
    await preparation.close();
  }
});

it.each(["moderation", "reservation"] as const)(
  "never advances to model use when %s denies preflight",
  async (stage) => {
    const gate = deferred<null>();
    const close = jest.fn(async () => {});
    const preparation = prepareWorkerIntegrations({
      signal: new AbortController().signal,
      loadMcp: async () => ({ close }),
      loadGithub: async () => null,
    });
    const denied = new Error("Denied preflight");
    const usage = {
      servedFrom: "balance",
      pointsDeducted: 10,
    } as RateLimitInfo;
    const tracker = {
      recordDeductions: jest.fn(),
      recordFreeAgentClaim: jest.fn(),
    };
    const useModel = jest.fn();
    const result = runTrackedPreflight({
      reserve: async () => {
        if (stage === "reservation") throw denied;
        return usage;
      },
      snapshot: async () => null,
      moderation: gate.promise,
      tracker,
      agentMode: true,
    })
      .then(() => preparation.ready)
      .then(useModel)
      .finally(() => preparation.close());
    const rejected = expect(result).rejects.toBe(denied);
    await preparation.ready;
    expect(useModel).not.toHaveBeenCalled();
    if (stage === "moderation") gate.reject(denied);
    else gate.resolve(null);
    await rejected;
    expect(useModel).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(tracker.recordDeductions).toHaveBeenCalledTimes(
      stage === "moderation" ? 1 : 0,
    );
  },
);
