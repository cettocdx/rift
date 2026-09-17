import type { ToolSet } from "ai";

/** Tracks actual tool settlement, independently of the model stream's abort. */
export function createHttpToolExecutionDrain({
  runInScope = (callback) => callback(),
}: {
  runInScope?: <T>(callback: () => T) => T;
} = {}): {
  wrap<T extends ToolSet>(tools: T): T;
  closeAndWait(): Promise<void>;
} {
  let closed = false;
  const pending = new Set<Promise<void>>();
  const wrappers = new WeakMap<object, ToolSet[string]>();
  const reserve = () => {
    if (closed)
      throw new Error("HTTP tool execution is closed. No tool was started.");
    let resolve!: () => void;
    const ticket = new Promise<void>((done) => {
      resolve = done;
    });
    pending.add(ticket);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      pending.delete(ticket);
      resolve();
    };
  };
  const track = (value: unknown, release: () => void): unknown => {
    if (value && typeof (value as PromiseLike<unknown>).then === "function") {
      return Promise.resolve(value).then(
        (result) => {
          try {
            return track(result, release);
          } catch (error) {
            release();
            throw error;
          }
        },
        (error) => {
          release();
          throw error;
        },
      );
    }
    if (
      value &&
      typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] ===
        "function"
    ) {
      const iterator = (value as AsyncIterable<unknown>)[
        Symbol.asyncIterator
      ]();
      const settle = async (
        operation: () =>
          | PromiseLike<IteratorResult<unknown>>
          | IteratorResult<unknown>,
      ) => {
        try {
          const result = await runInScope(operation);
          if (result.done) release();
          return result;
        } catch (error) {
          release();
          throw error;
        }
      };
      // One iterator per tool result. In particular return() before next() must
      // release its ticket too; an unstarted async-generator finally would not.
      const wrapped: AsyncIterableIterator<unknown> = {
        [Symbol.asyncIterator]() {
          return this;
        },
        next: (...args) => settle(() => iterator.next(...args)),
        return: (result) =>
          settle(() =>
            iterator.return
              ? iterator.return(result)
              : { done: true, value: result },
          ),
        throw: (error) =>
          settle(() => {
            if (iterator.throw) return iterator.throw(error);
            throw error;
          }),
      };
      return wrapped;
    }
    release();
    return value;
  };
  return {
    wrap<T extends ToolSet>(tools: T): T {
      // Preserve the live tool map: MCP discovery may add tools after setup.
      return new Proxy(tools, {
        get(target, key, receiver) {
          const tool = Reflect.get(target, key, receiver);
          if (!tool || typeof tool.execute !== "function") return tool;
          let wrapped = wrappers.get(tool);
          if (!wrapped) {
            const execute = tool.execute;
            wrapped = {
              ...tool,
              execute(this: unknown, ...args: Parameters<typeof execute>) {
                const release = reserve();
                try {
                  return track(
                    runInScope(() => Reflect.apply(execute, this, args)),
                    release,
                  );
                } catch (error) {
                  release();
                  throw error;
                }
              },
            } as ToolSet[string];
            wrappers.set(tool, wrapped);
          }
          return wrapped;
        },
      });
    },
    async closeAndWait() {
      closed = true;
      await Promise.all([...pending]);
    },
  };
}
