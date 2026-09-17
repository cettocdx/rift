/** @jest-environment node */
import { getEventListeners } from "node:events";
import {
  PtySessionManager,
  MAX_CONCURRENT_PTYS_PER_CHAT,
} from "../pty-session-manager";
import type { PtyHandle } from "../e2b-pty-adapter";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function handle() {
  const exit = deferred<{ exitCode: number | null }>();
  return {
    pid: 1,
    exited: exit.promise,
    kill: jest.fn(async () => {
      exit.resolve({ exitCode: 0 });
    }),
    sendInput: jest.fn(async () => {}),
    resize: jest.fn(async () => {}),
    onData: jest.fn(() => jest.fn()),
  } satisfies PtyHandle;
}
const options = (createHandle: () => Promise<PtyHandle>) => ({
  createHandle,
  cols: 80,
  rows: 24,
});
const observe = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => ({ value, error: undefined }),
    (error: unknown) => ({ value: undefined, error }),
  );

describe("PTY pending creation lifecycle", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it.each(["abort", "cleanup"])(
    "settles immediately on %s while retaining cleanup for a late handle",
    async (reason) => {
      const manager = new PtySessionManager();
      const pending = deferred<PtyHandle>();
      const controller = new AbortController();
      const late = handle();
      let settled = false;
      const result = observe(
        manager.create("chat", {
          ...options(() => pending.promise),
          signal: controller.signal,
        }),
      ).then((value) => {
        settled = true;
        return value;
      });
      if (reason === "abort") controller.abort();
      else await manager.closeAll("chat");
      await jest.advanceTimersByTimeAsync(0);
      expect(settled).toBe(true);
      if (reason === "abort")
        expect((await result).error).toBe(controller.signal.reason);
      else expect((await result).error).toBeInstanceOf(Error);
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
      expect(late.kill).not.toHaveBeenCalled();
      pending.resolve(late);
      await jest.advanceTimersByTimeAsync(0);
      expect(late.kill).toHaveBeenCalledTimes(1);
      expect(late.onData).not.toHaveBeenCalled();
      expect(manager.list("chat")).toEqual([]);
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it("observes a factory rejection after cancellation has already settled", async () => {
    const manager = new PtySessionManager();
    const pending = deferred<PtyHandle>();
    const controller = new AbortController();
    let settled = false;
    const result = observe(
      manager.create("chat", {
        ...options(() => pending.promise),
        signal: controller.signal,
      }),
    ).then((value) => {
      settled = true;
      return value;
    });
    controller.abort();
    await jest.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect((await result).error).toBe(controller.signal.reason);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    pending.reject(new Error("late SDK create rejection"));
    await jest.advanceTimersByTimeAsync(0);
    expect(manager.list("chat")).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([true, false])(
    "removes the abort listener when the factory settles normally (success %s)",
    async (success) => {
      const manager = new PtySessionManager();
      const controller = new AbortController();
      const result = await observe(
        manager.create("chat", {
          ...options(async () => {
            if (!success) throw new Error("factory failed");
            return handle();
          }),
          signal: controller.signal,
        }),
      );
      expect(Boolean(result.value)).toBe(success);
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
      await manager.closeAll("chat");
    },
  );

  it("releases canceled reservations synchronously for fresh Workbench work", async () => {
    const manager = new PtySessionManager();
    const controller = new AbortController();
    const old = Array.from({ length: MAX_CONCURRENT_PTYS_PER_CHAT }, () =>
      observe(
        manager.create("chat", {
          ...options(() => new Promise<PtyHandle>(() => {})),
          signal: controller.signal,
        }),
      ),
    );
    controller.abort();
    const fresh = manager.create(
      "chat",
      options(async () => handle()),
    );
    expect(await fresh).toHaveProperty("sessionId");
    await Promise.all(old);
    await manager.closeAll("chat");
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it.each([undefined, "run-a"])(
    "closes late handles without registration and permits a fresh session (scope %s)",
    async (scope) => {
      const manager = new PtySessionManager();
      const inScope = <T>(callback: () => T) =>
        scope ? manager.withScope(scope, callback) : callback();
      const pending = deferred<PtyHandle>();
      const late = handle();
      const result = observe(
        inScope(() =>
          manager.create(
            "chat",
            options(() => pending.promise),
          ),
        ),
      );
      await inScope(() => manager.closeAll("chat"));
      const fresh = handle();
      const freshSession = await inScope(() =>
        manager.create(
          "chat",
          options(async () => fresh),
        ),
      );
      pending.resolve(late);
      expect((await result).error).toBeInstanceOf(Error);
      expect(late.kill).toHaveBeenCalledTimes(1);
      expect(late.onData).not.toHaveBeenCalled();
      expect(inScope(() => manager.list("chat"))).toEqual([freshSession]);
      expect(fresh.kill).not.toHaveBeenCalled();
      await inScope(() => manager.closeAll("chat"));
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it("does not cancel run B's pending create or its completed session", async () => {
    const manager = new PtySessionManager();
    const a = deferred<PtyHandle>(),
      b = deferred<PtyHandle>();
    const aHandle = handle(),
      bHandle = handle();
    const aResult = observe(
      manager.withScope("a", () =>
        manager.create(
          "chat",
          options(() => a.promise),
        ),
      ),
    );
    const bResult = manager.withScope("b", () =>
      manager.create(
        "chat",
        options(() => b.promise),
      ),
    );
    await manager.withScope("a", () => manager.closeAll("chat"));
    b.resolve(bHandle);
    const bSession = await bResult;
    a.resolve(aHandle);
    expect((await aResult).error).toBeInstanceOf(Error);
    expect(manager.withScope("a", () => manager.list("chat"))).toEqual([]);
    expect(manager.withScope("b", () => manager.list("chat"))).toEqual([
      bSession,
    ]);
    expect(bHandle.kill).not.toHaveBeenCalled();
    await manager.withScope("b", () => manager.closeAll("chat"));
  });

  it("counts pending creates against the cap before invoking an overflow factory or attach", async () => {
    const manager = new PtySessionManager();
    const pending = Array.from({ length: MAX_CONCURRENT_PTYS_PER_CHAT }, () =>
      deferred<PtyHandle>(),
    );
    const results = pending.map((item) =>
      observe(
        manager.create(
          "chat",
          options(() => item.promise),
        ),
      ),
    );
    const overflow = jest.fn(async () => handle());
    await expect(manager.create("chat", options(overflow))).rejects.toThrow(
      "MAX_CONCURRENT_PTYS_PER_CHAT",
    );
    expect(overflow).not.toHaveBeenCalled();
    expect(() =>
      manager.attach("chat", {
        sessionId: "attach",
        handle: handle(),
        cols: 80,
        rows: 24,
      }),
    ).toThrow("MAX_CONCURRENT_PTYS_PER_CHAT");
    await manager.closeAll("chat");
    pending.forEach((item) => item.resolve(handle()));
    expect(
      (await Promise.all(results)).every(
        (result) => result.error instanceof Error,
      ),
    ).toBe(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(manager.list("chat")).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("releases pending capacity when the factory rejects", async () => {
    const manager = new PtySessionManager();
    for (let index = 0; index <= MAX_CONCURRENT_PTYS_PER_CHAT; index++) {
      await expect(
        manager.create(
          "chat",
          options(async () => {
            throw new Error("spawn failed");
          }),
        ),
      ).rejects.toThrow("spawn failed");
    }
    const session = await manager.create(
      "chat",
      options(async () => handle()),
    );
    expect(manager.list("chat")).toEqual([session]);
    await manager.closeAll("chat");
  });

  it("transfers a resolved creation reservation to registration without double counting", async () => {
    const manager = new PtySessionManager();
    const pending = deferred<PtyHandle>();
    const first = manager.create(
      "chat",
      options(() => pending.promise),
    );
    // Leave exactly one free slot. These are registered, not pending creates.
    for (let index = 0; index < MAX_CONCURRENT_PTYS_PER_CHAT - 2; index++) {
      manager.attach("chat", {
        sessionId: `existing-${index}`,
        handle: handle(),
        cols: 80,
        rows: 24,
      });
    }
    pending.resolve(handle());
    // The handle is now registered, but create's outer promise is still
    // settling. Its reservation must no longer consume a second slot.
    await Promise.resolve();
    const last = manager.create(
      "chat",
      options(async () => handle()),
    );
    await expect(last).resolves.toHaveProperty("sessionId");
    await first;
    expect(manager.list("chat")).toHaveLength(MAX_CONCURRENT_PTYS_PER_CHAT);
    await manager.closeAll("chat");
  });

  it("bounds orphan teardown when kill and exit never settle, and observes late rejection", async () => {
    const manager = new PtySessionManager();
    const pending = deferred<PtyHandle>(),
      kill = deferred<void>();
    const orphan = handle();
    orphan.kill.mockImplementation(() => kill.promise);
    const result = observe(
      manager.create(
        "chat",
        options(() => pending.promise),
      ),
    );
    await manager.closeAll("chat");
    pending.resolve(orphan);
    await jest.advanceTimersByTimeAsync(2000);
    expect((await result).error).toBeInstanceOf(Error);
    expect(orphan.kill).toHaveBeenCalledTimes(1);
    expect(manager.list("chat")).toEqual([]);
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      kill.reject(new Error("late teardown failure"));
      await Promise.resolve();
      expect(log).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      log.mockRestore();
    }
  });
});
