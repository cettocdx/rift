jest.mock("@/lib/db/actions", () => ({
  getCancellationStatus: jest.fn(),
  getTempCancellationStatus: jest.fn(),
}));

jest.mock("@/lib/utils/redis-pubsub", () => ({
  createRedisSubscriber: jest.fn(),
  getCancelChannel: jest.fn((chatId: string) => `cancel:${chatId}`),
}));

jest.mock("@/lib/posthog/server", () => ({
  phLogger: {
    info: jest.fn(),
  },
}));

import { createPreemptiveTimeout } from "../stream-cancellation";

function neverResolvingAgent(signal: AbortSignal) {
  return new Promise<unknown>((resolve) => {
    if (signal.aborted) {
      resolve(signal.reason);
      return;
    }
    signal.addEventListener("abort", () => resolve(signal.reason), {
      once: true,
    });
  });
}

describe("preemptive request lifecycle", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000_000);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("aborts a never-resolving Hack agent at its explicit wall-clock budget", async () => {
    const abortController = new AbortController();
    const agent = neverResolvingAgent(abortController.signal);
    const timeout = createPreemptiveTimeout({
      chatId: "hack-chat",
      endpoint: "/api/hack-chat",
      abortController,
      maxStreamTimeMs: 370_000,
      startTime: Date.now(),
    });

    jest.advanceTimersByTime(369_999);
    expect(abortController.signal.aborted).toBe(false);
    expect(timeout.isPreemptive()).toBe(false);

    jest.advanceTimersByTime(1);

    expect(abortController.signal.aborted).toBe(true);
    expect(timeout.isPreemptive()).toBe(true);
    expect(timeout.getTriggerTime()).toBe(1_370_000);
    await expect(agent).resolves.toMatchObject({ name: "TimeoutError" });
  });

  it("counts preflight time against the route budget", () => {
    const abortController = new AbortController();
    const timeout = createPreemptiveTimeout({
      chatId: "hack-chat",
      endpoint: "/api/hack-chat",
      abortController,
      maxStreamTimeMs: 370_000,
      startTime: Date.now() - 10_000,
    });

    jest.advanceTimersByTime(359_999);
    expect(abortController.signal.aborted).toBe(false);

    jest.advanceTimersByTime(1);
    expect(abortController.signal.aborted).toBe(true);
    expect(timeout.getTriggerTime()).toBe(Date.now());
  });

  it("can be cleared after normal completion without a later abort", () => {
    const abortController = new AbortController();
    const timeout = createPreemptiveTimeout({
      chatId: "hack-chat",
      endpoint: "/api/hack-chat",
      abortController,
      maxStreamTimeMs: 370_000,
    });

    timeout.clear();
    jest.advanceTimersByTime(400_000);

    expect(abortController.signal.aborted).toBe(false);
    expect(timeout.isPreemptive()).toBe(false);
  });

  it.each(["user stop", "budget exhausted"])(
    "does not reclassify an earlier %s while cleanup is still pending",
    (reason) => {
      const abortController = new AbortController();
      const timeout = createPreemptiveTimeout({
        chatId: "hack-chat",
        endpoint: "/api/hack-chat",
        abortController,
        maxStreamTimeMs: 370_000,
      });
      jest.advanceTimersByTime(369_999);
      const firstReason = new Error(reason);
      abortController.abort(firstReason);
      jest.advanceTimersByTime(1);

      expect(abortController.signal.reason).toBe(firstReason);
      expect(timeout.isPreemptive()).toBe(false);
      expect(timeout.getTriggerTime()).toBeNull();
    },
  );
});
