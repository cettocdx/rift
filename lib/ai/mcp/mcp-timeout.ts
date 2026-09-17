/**
 * Apply a real cancellation deadline. The AbortSignal reaches the MCP SDK and
 * `onTimeout` closes its transport, which in turn aborts any pending pinned
 * HTTP/SSE socket instead of leaving work alive after a Promise race settles.
 */
export async function withAbortableTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
  onTimeout?: () => void | Promise<void>,
): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error("MCP timeout must be a positive finite number.");
  }

  const controller = new AbortController();
  const timeoutError = new Error(`${label} timed out after ${ms}ms`);
  timeoutError.name = "McpTimeoutError";
  let timedOut = false;
  let cleanupPromise: Promise<void> | undefined;
  let rejectTimeout: ((error: Error) => void) | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    cleanupPromise = (async () => {
      controller.abort(timeoutError);
      try {
        await onTimeout?.();
      } catch {
        // Timeout cleanup is best-effort; preserve the deterministic deadline
        // error rather than replacing it with a transport close failure.
      }
    })();
    void cleanupPromise.finally(() => rejectTimeout?.(timeoutError));
  }, ms);

  const operationPromise = Promise.resolve()
    .then(() => operation(controller.signal))
    .catch(async (error) => {
      if (timedOut && cleanupPromise) {
        await cleanupPromise;
        throw timeoutError;
      }
      throw error;
    });

  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}
