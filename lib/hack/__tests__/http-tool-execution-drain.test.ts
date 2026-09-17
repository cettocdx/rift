import { createHttpToolExecutionDrain } from "../http-tool-execution-drain";
import type { ToolSet } from "ai";
const deferred = () => {
  let resolve!: (value?: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const toolsWith = (execute: (...args: any[]) => any) =>
  ({ work: { execute } }) as unknown as ToolSet;
const invoke = (tools: ToolSet) =>
  tools.work.execute!({}, { toolCallId: "call", messages: [] });
it("waits for an abort-ignoring call and blocks new calls after sealing", async () => {
  const task = deferred();
  const execute = jest.fn(() => task.promise);
  const drain = createHttpToolExecutionDrain();
  const tools = drain.wrap(toolsWith(execute));
  const result = invoke(tools);
  let closed = false;
  const wait = drain.closeAndWait().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  expect(() => invoke(tools)).toThrow("closed");
  expect(execute).toHaveBeenCalledTimes(1);
  task.resolve("done");
  await expect(result).resolves.toBe("done");
  await wait;
  expect(closed).toBe(true);
});
it("drains rejected and synchronous throwing calls without swallowing their errors", async () => {
  const drain = createHttpToolExecutionDrain();
  const failure = new Error("failed");
  await expect(
    invoke(drain.wrap(toolsWith(() => Promise.reject(failure)))),
  ).rejects.toBe(failure);
  expect(() =>
    invoke(
      drain.wrap(
        toolsWith(() => {
          throw failure;
        }),
      ),
    ),
  ).toThrow(failure);
  await drain.closeAndWait();
});
it("waits for all parallel calls and preserves this, input and options", async () => {
  const one = deferred(),
    two = deferred();
  let calls = 0;
  const receiver = { custom: true };
  const original = toolsWith(function (
    this: unknown,
    input: unknown,
    options: unknown,
  ) {
    expect(this).toBe(receiver);
    expect(input).toEqual({});
    expect(options).toMatchObject({ toolCallId: "call" });
    return calls++ ? two.promise : one.promise;
  });
  const drain = createHttpToolExecutionDrain(),
    tools = drain.wrap(original);
  const call = () =>
    tools.work.execute!.call(
      receiver,
      {},
      { toolCallId: "call", messages: [] },
    );
  const a = call(),
    b = call();
  let closed = false;
  const wait = drain.closeAndWait().then(() => {
    closed = true;
  });
  one.resolve();
  await a;
  await Promise.resolve();
  expect(closed).toBe(false);
  two.resolve();
  await b;
  await wait;
});
it("holds async iterable calls until their iterator closes", async () => {
  let finalized = false;
  const drain = createHttpToolExecutionDrain();
  const tools = drain.wrap(
    toolsWith(async function* () {
      try {
        yield "one";
        yield "two";
      } finally {
        finalized = true;
      }
    }),
  );
  const result = invoke(tools) as AsyncIterable<unknown>;
  const iterator = result[Symbol.asyncIterator]();
  expect(await iterator.next()).toEqual({ value: "one", done: false });
  let closed = false;
  const wait = drain.closeAndWait().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  await iterator.return!();
  await wait;
  expect(finalized).toBe(true);
});
it("wraps tools added lazily after wrapping", async () => {
  const original = {} as ToolSet,
    drain = createHttpToolExecutionDrain();
  const tools = drain.wrap(original);
  original.work = toolsWith(() => "ok").work;
  expect(invoke(tools)).toBe("ok");
  await drain.closeAndWait();
  expect(() => invoke(tools)).toThrow("closed");
});
it("drains a promised iterable only after iteration and handles return before first next", async () => {
  const drain = createHttpToolExecutionDrain();
  const result = (await invoke(
    drain.wrap(
      toolsWith(() =>
        Promise.resolve(
          (async function* () {
            yield 1;
          })(),
        ),
      ),
    ),
  )) as AsyncIterable<unknown>;
  let closed = false;
  const waiting = drain.closeAndWait().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  await result[Symbol.asyncIterator]().return!();
  await waiting;
});
it("propagates iterator failures while releasing the drain", async () => {
  const drain = createHttpToolExecutionDrain();
  const failure = new Error("iterator failed");
  const result = invoke(
    drain.wrap(
      toolsWith(async function* () {
        throw failure;
      }),
    ),
  ) as AsyncIterable<unknown>;
  const waiting = drain.closeAndWait();
  await expect(result[Symbol.asyncIterator]().next()).rejects.toBe(failure);
  await waiting;
});

it("retains the exact execution scope across asynchronous tool work", async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  const scope = new AsyncLocalStorage<string>();
  const drain = createHttpToolExecutionDrain({
    runInScope: (callback) => scope.run("execution-a", callback),
  });
  const tools = drain.wrap(
    toolsWith(async () => {
      await Promise.resolve();
      return scope.getStore();
    }),
  );
  expect(await invoke(tools)).toBe("execution-a");
  expect(scope.getStore()).toBeUndefined();
  await drain.closeAndWait();
});

it("retains the exact scope when a tool result is consumed as an async iterator", async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  const scope = new AsyncLocalStorage<string>();
  const drain = createHttpToolExecutionDrain({
    runInScope: (callback) => scope.run("execution-a", callback),
  });
  const tools = drain.wrap(
    toolsWith(async function* () {
      await Promise.resolve();
      yield scope.getStore();
    }),
  );
  const iterator = invoke(tools) as AsyncIterableIterator<unknown>;
  expect((await iterator.next()).value).toBe("execution-a");
  await iterator.return?.();
  await drain.closeAndWait();
});
