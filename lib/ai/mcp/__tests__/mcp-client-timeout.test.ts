import { withAbortableTimeout } from "../mcp-timeout";

describe("MCP client abortable deadlines", () => {
  it("aborts the SDK operation and awaits transport cleanup on timeout", async () => {
    jest.useFakeTimers();
    try {
      let observedSignal: AbortSignal | undefined;
      const cleanup = jest.fn(async () => undefined);
      const operation = withAbortableTimeout(
        (signal) => {
          observedSignal = signal;
          return new Promise<never>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(signal.reason),
              { once: true },
            );
          });
        },
        50,
        "MCP test operation",
        cleanup,
      );
      const assertion = expect(operation).rejects.toMatchObject({
        name: "McpTimeoutError",
        message: "MCP test operation timed out after 50ms",
      });

      await jest.advanceTimersByTimeAsync(51);

      await assertion;
      expect(observedSignal?.aborted).toBe(true);
      expect(cleanup).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("clears its deadline without aborting a successful operation", async () => {
    jest.useFakeTimers();
    try {
      const cleanup = jest.fn();
      let observedSignal: AbortSignal | undefined;
      const result = await withAbortableTimeout(
        async (signal) => {
          observedSignal = signal;
          return "ok";
        },
        50,
        "MCP successful operation",
        cleanup,
      );

      await jest.advanceTimersByTimeAsync(100);

      expect(result).toBe("ok");
      expect(observedSignal?.aborted).toBe(false);
      expect(cleanup).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
