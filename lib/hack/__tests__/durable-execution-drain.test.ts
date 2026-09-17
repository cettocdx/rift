/** @jest-environment node */
import type { ToolSet } from "ai";
import { PtySessionManager } from "@/lib/ai/tools/utils/pty-session-manager";
import type { PtyHandle } from "@/lib/ai/tools/utils/e2b-pty-adapter";
import { createDurableHackExecutionDrain } from "../durable-execution-drain";
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const handleFixture = () => {
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
const create = (manager: PtySessionManager, handle: PtyHandle) =>
  manager.create("chat", {
    createHandle: async () => handle,
    cols: 80,
    rows: 24,
  });
const tools = (execute: () => unknown) =>
  ({ work: { execute } }) as unknown as ToolSet;
const invoke = (set: ToolSet) =>
  (set.work.execute as Function)({}, { toolCallId: "call", messages: [] });
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("legacy close releases after two seconds while strict drain still waits for exit", async () => {
  const manager = new PtySessionManager(),
    legacy = handleFixture(),
    strict = handleFixture();
  await create(manager, legacy.handle);
  const old = manager.closeAll("chat");
  await jest.advanceTimersByTimeAsync(2001);
  await old;
  const drain = createDurableHackExecutionDrain({
    runId: "run",
    chatId: "chat",
    manager,
  });
  await drain.runInScope(() => create(manager, strict.handle));
  let done = false;
  const settlement = drain.settle();
  settlement.then(() => {
    done = true;
  });
  expect(drain.settle()).toBe(settlement);
  await jest.advanceTimersByTimeAsync(3000);
  expect(done).toBe(false);
  strict.exit.resolve({ exitCode: 0 });
  await settlement;
  expect(done).toBe(true);
});

test("starts PTY shutdown while abort-ignoring tool is pending, then joins both", async () => {
  const manager = new PtySessionManager(),
    pty = handleFixture(),
    tool = deferred<string>();
  const release = jest.spyOn(manager, "releaseConfirmedScope");
  const drain = createDurableHackExecutionDrain({
    runId: "run",
    chatId: "chat",
    manager,
  });
  const wrapped = drain.wrap(
    tools(async () => {
      await create(manager, pty.handle);
      return tool.promise;
    }),
  );
  const work = invoke(wrapped);
  await jest.advanceTimersByTimeAsync(0);
  const settlement = drain.settle();
  expect(pty.handle.kill).toHaveBeenCalled();
  expect(() => invoke(wrapped)).toThrow(/closed/);
  pty.exit.resolve({ exitCode: 0 });
  await jest.advanceTimersByTimeAsync(3000);
  expect(release).not.toHaveBeenCalled();
  tool.resolve("done");
  await expect(work).resolves.toBe("done");
  await settlement;
  expect(release).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledWith("run");
  expect(() =>
    drain.runInScope(() => create(manager, handleFixture().handle)),
  ).toThrow(/closed/);
});

test("joins canceled creation's late handle and actual exit receipt", async () => {
  const manager = new PtySessionManager(),
    factory = deferred<PtyHandle>(),
    pty = handleFixture(),
    abort = new AbortController();
  const drain = createDurableHackExecutionDrain({
    runId: "run",
    chatId: "chat",
    manager,
  });
  const result = drain.runInScope(() =>
    manager.create("chat", {
      createHandle: () => factory.promise,
      cols: 80,
      rows: 24,
      signal: abort.signal,
    }),
  );
  abort.abort();
  await expect(result).rejects.toThrow();
  let done = false;
  const settlement = drain.settle().then(() => {
    done = true;
  });
  await jest.advanceTimersByTimeAsync(3000);
  expect(done).toBe(false);
  factory.resolve(pty.handle);
  await jest.advanceTimersByTimeAsync(0);
  expect(pty.handle.kill).toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(3000);
  expect(done).toBe(false);
  pty.exit.resolve({ exitCode: 0 });
  await settlement;
});

test.each(["missing", "rejected"])(
  "%s exit confirmation rejects without releasing scope",
  async (kind) => {
    const manager = new PtySessionManager(),
      pty = handleFixture();
    if (kind === "missing")
      Object.assign(pty.handle, { confirmedExited: undefined });
    const release = jest.spyOn(manager, "releaseConfirmedScope");
    const drain = createDurableHackExecutionDrain({
      runId: "run",
      chatId: "chat",
      manager,
    });
    await drain.runInScope(() => create(manager, pty.handle));
    const result = drain.settle();
    const rejection = expect(result).rejects.toThrow();
    if (kind === "rejected") pty.exit.reject(new Error("unknown exit"));
    await jest.advanceTimersByTimeAsync(3000);
    await rejection;
    expect(release).not.toHaveBeenCalled();
    expect(drain.settle()).toBe(result);
  },
);

test("uncertain PTY failure still waits for an active tool and never releases proof scope", async () => {
  const manager = new PtySessionManager();
  const pty = handleFixture();
  Object.assign(pty.handle, { confirmedExited: undefined });
  const tool = deferred<void>();
  const release = jest.spyOn(manager, "releaseConfirmedScope");
  const drain = createDurableHackExecutionDrain({
    runId: "run",
    chatId: "chat",
    manager,
  });
  await drain.runInScope(() => create(manager, pty.handle));
  const work = invoke(drain.wrap(tools(() => tool.promise)));
  let settled = false;
  const result = drain.settle();
  const observed = result.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await jest.advanceTimersByTimeAsync(3000);
  expect(settled).toBe(false);
  tool.resolve();
  await work;
  await expect(result).rejects.toThrow(/confirmation/);
  await observed;
  expect(release).not.toHaveBeenCalled();
});

test.each(["pending", "rejected"])(
  "%s PTY proof permits the tool stage but cannot confirm cleanup",
  async (proof) => {
    const manager = new PtySessionManager();
    const pty = handleFixture();
    const tool = deferred<string>();
    const release = jest.spyOn(manager, "releaseConfirmedScope");
    const close = jest.spyOn(manager, "closeAllConfirmed");
    const drain = createDurableHackExecutionDrain({
      runId: "run",
      chatId: "chat",
      manager,
    });
    await drain.runInScope(() => create(manager, pty.handle));
    const wrapped = drain.wrap(tools(() => tool.promise));
    const work = invoke(wrapped);
    const toolStage = drain.drainTools();
    expect(drain.drainTools()).toBe(toolStage);
    expect(pty.handle.kill).toHaveBeenCalled();
    expect(() => invoke(wrapped)).toThrow(/closed/);
    let toolsDone = false;
    toolStage.then(() => {
      toolsDone = true;
    });
    const failure = new Error("exit unavailable");
    if (proof === "rejected") pty.exit.reject(failure);
    await jest.advanceTimersByTimeAsync(3000);
    expect(toolsDone).toBe(false);
    tool.resolve("known output");
    await expect(work).resolves.toBe("known output");
    await toolStage;
    // Let an early proof rejection settle before anyone requests full cleanup.
    // Jest will also fail if the cached full-settlement rejection is unhandled.
    await jest.advanceTimersByTimeAsync(0);
    expect(release).not.toHaveBeenCalled();
    const full = drain.settle();
    expect(drain.settle()).toBe(full);
    if (proof === "rejected") {
      await expect(full).rejects.toBe(failure);
      expect(release).not.toHaveBeenCalled();
    } else {
      let confirmed = false;
      full.then(() => {
        confirmed = true;
      });
      await jest.advanceTimersByTimeAsync(3000);
      expect(confirmed).toBe(false);
      pty.exit.resolve({ exitCode: 0 });
      await full;
      expect(release).toHaveBeenCalledTimes(1);
    }
    expect(close).toHaveBeenCalledTimes(1);
  },
);

test("ordinary remote commands retain late-start and exit proof independently of tool return", async () => {
  const manager = new PtySessionManager();
  const started =
    deferred<Pick<PtyHandle, "pid" | "kill" | "confirmedExited">>();
  const pty = handleFixture();
  const drain = createDurableHackExecutionDrain({
    runId: "build",
    chatId: "chat",
    manager,
  });
  drain.runInScope(() => manager.trackRemoteCommand("chat", started.promise));
  let done = false;
  const settled = drain.settle().then(() => {
    done = true;
  });
  await jest.advanceTimersByTimeAsync(3000);
  expect(done).toBe(false);
  started.resolve(pty.handle);
  await jest.advanceTimersByTimeAsync(0);
  expect(pty.handle.kill).toHaveBeenCalledTimes(1);
  expect(done).toBe(false);
  pty.exit.resolve({ exitCode: 130 });
  await settled;
});
