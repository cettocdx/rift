/** @jest-environment node */
import { PtySessionManager } from "../pty-session-manager";
import type { PtyHandle } from "../e2b-pty-adapter";
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const fake = () => {
  const exit = deferred<{ exitCode: number | null }>();
  const handle: PtyHandle = {
    pid: 42,
    sendInput: jest.fn(),
    resize: jest.fn(),
    kill: jest.fn(async () => {}),
    onData: () => () => {},
    exited: exit.promise,
    confirmedExited: exit.promise,
  };
  return { handle, exit };
};
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const create = (manager: PtySessionManager, handle: PtyHandle) =>
  manager.create("chat", {
    createHandle: async () => handle,
    cols: 80,
    rows: 24,
  });
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it("joins a canceled underlying factory and late handle exit after the API returned", async () => {
  const manager = new PtySessionManager();
  const factory = deferred<PtyHandle>();
  const { handle, exit } = fake();
  const abort = new AbortController();
  const result = manager.withConfirmedScope("execution", () =>
    manager.create("chat", {
      createHandle: () => factory.promise,
      cols: 80,
      rows: 24,
      signal: abort.signal,
    }),
  );
  abort.abort();
  await expect(result).rejects.toThrow();
  let confirmed = false;
  const close = manager
    .withConfirmedScope("execution", () => manager.closeAllConfirmed("chat"))
    .then(() => {
      confirmed = true;
    });
  await jest.advanceTimersByTimeAsync(3000);
  expect(confirmed).toBe(false);
  factory.resolve(handle);
  await flush();
  expect(handle.kill).toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(3000);
  expect(confirmed).toBe(false);
  exit.resolve({ exitCode: 0 });
  await close;
  expect(confirmed).toBe(true);
});
it("does not treat bounded cache cleanup or a pending kill RPC as exit proof", async () => {
  const manager = new PtySessionManager();
  const { handle, exit } = fake();
  (handle.kill as jest.Mock).mockImplementation(() => new Promise(() => {}));
  await manager.withConfirmedScope("execution", () => create(manager, handle));
  let confirmed = false;
  const close = manager
    .withConfirmedScope("execution", () => manager.closeAllConfirmed("chat"))
    .then(() => {
      confirmed = true;
    });
  await jest.advanceTimersByTimeAsync(3000);
  expect(confirmed).toBe(false);
  exit.resolve({ exitCode: 0 });
  await close;
  expect(confirmed).toBe(true);
});
it("cannot confirm an unknown exit even if the legacy adapter normalized it", async () => {
  const manager = new PtySessionManager();
  const { handle, exit } = fake();
  const failure = new Error("lost exit receipt");
  Object.assign(handle, { exited: Promise.resolve({ exitCode: null }) });
  await manager.withConfirmedScope("execution", () => create(manager, handle));
  exit.reject(failure);
  await flush();
  await expect(
    manager.withConfirmedScope("execution", () =>
      manager.closeAllConfirmed("chat"),
    ),
  ).rejects.toBe(failure);
  await expect(
    manager.withConfirmedScope("execution", () =>
      manager.closeAllConfirmed("chat"),
    ),
  ).rejects.toBe(failure);
});
it("retains uncertain factory failure and rejects handles without an exit proof contract", async () => {
  const manager = new PtySessionManager();
  const failure = new Error("create receipt lost");
  await expect(
    manager.withConfirmedScope("factory", () =>
      manager.create("chat", {
        createHandle: async () => {
          throw failure;
        },
        cols: 80,
        rows: 24,
      }),
    ),
  ).rejects.toBe(failure);
  await expect(
    manager.withConfirmedScope("factory", () =>
      manager.closeAllConfirmed("chat"),
    ),
  ).rejects.toBe(failure);
  const { handle } = fake();
  Object.assign(handle, { confirmedExited: undefined });
  await manager.withConfirmedScope("missing", () => create(manager, handle));
  await expect(
    manager.withConfirmedScope("missing", () =>
      manager.closeAllConfirmed("chat"),
    ),
  ).rejects.toThrow("confirmation");
});
it("confirms attached and naturally exited handles without retaining completed proof entries", async () => {
  const manager = new PtySessionManager();
  const { handle, exit } = fake();
  manager.withConfirmedScope("execution", () =>
    manager.attach("chat", {
      sessionId: "attached",
      handle,
      cols: 80,
      rows: 24,
    }),
  );
  exit.resolve({ exitCode: 0 });
  await flush();
  expect((manager as any).confirmationLedgers.size).toBe(0);
  await manager.withConfirmedScope("execution", () =>
    manager.closeAllConfirmed("chat"),
  );
  expect((manager as any).confirmationLedgers.size).toBe(0);
});
it("isolates exact executions and preserves legacy bounded close", async () => {
  const manager = new PtySessionManager();
  const one = fake(),
    two = fake(),
    legacy = fake();
  await manager.withConfirmedScope("one", () => create(manager, one.handle));
  await manager.withConfirmedScope("two", () => create(manager, two.handle));
  await create(manager, legacy.handle);
  one.exit.resolve({ exitCode: 0 });
  await manager.withConfirmedScope("one", () =>
    manager.closeAllConfirmed("chat"),
  );
  expect(two.handle.kill).not.toHaveBeenCalled();
  expect(legacy.handle.kill).not.toHaveBeenCalled();
  const close = manager.closeAll("chat");
  await jest.advanceTimersByTimeAsync(2001);
  await close;
  expect(two.handle.kill).not.toHaveBeenCalled();
  await expect(manager.closeAllConfirmed("chat")).rejects.toThrow("scope");
});
it("seals an empty scope and keeps old async callbacks sealed after lookup release", async () => {
  const manager = new PtySessionManager();
  const resume = deferred<void>();
  const { handle } = fake();
  const late = manager.withConfirmedScope("execution", async () => {
    await resume.promise;
    await create(manager, handle);
  });
  await manager.withConfirmedScope("execution", () =>
    manager.closeAllConfirmed("chat"),
  );
  manager.releaseConfirmedScope("execution");
  expect((manager as any).confirmationScopes.size).toBe(0);
  resume.resolve();
  await expect(late).rejects.toThrow("closing");
  expect(handle.kill).not.toHaveBeenCalled();
});
