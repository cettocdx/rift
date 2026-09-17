/** Read-only preparation may overlap context loading, but all checks must pass
 * before the caller acquires a free-run lock or reserves usage. */
export async function prepareWorkerUsage<C, B, U>({
  check,
  customization,
  balance,
  build,
}: {
  check: () => Promise<unknown>;
  customization: Promise<C>;
  balance: Promise<B>;
  build: (customization: C, balance: B) => Promise<U>;
}): Promise<U> {
  const [, config] = await Promise.all([
    Promise.resolve().then(check),
    Promise.all([customization, balance]).then(([custom, state]) =>
      build(custom, state),
    ),
  ]);
  return config;
}

/**
 * Start owner-scoped database reads after worker admission, while preflight
 * finishes. loadMcp MUST use lazy:true: no transport, credential refresh or tool
 * execution may start here. Callers still await billing/moderation and recheck
 * cancellation before consuming ready. close also owns any late MCP result.
 */
export function prepareWorkerIntegrations<
  M extends { close: () => Promise<void> },
  G,
>({
  signal,
  loadMcp,
  loadGithub,
}: {
  signal: AbortSignal;
  loadMcp: () => Promise<M>;
  loadGithub: () => Promise<G>;
}): {
  ready: Promise<{ mcp: M; github: G }>;
  close: () => Promise<void>;
} {
  let closed = false;
  let rejectUnavailable!: (error: unknown) => void;
  const unavailable = new Promise<never>((_, reject) => {
    rejectUnavailable = reject;
  });
  let mcp: M | undefined;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (!closed) {
      closed = true;
      rejectUnavailable(
        signal.aborted
          ? signal.reason
          : new Error("Worker integration preparation is closed."),
      );
    }
    signal.removeEventListener("abort", onAbort);
    // Do not delay Stop/refund cleanup waiting for an unfinished database read.
    // Its fulfillment handler below owns the eventual result instead.
    if (!mcp) return Promise.resolve();
    closing ??= Promise.resolve().then(() => mcp!.close());
    return closing;
  };
  const onAbort = () => {
    void close().catch(() => {});
  };
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();

  const mcpReady = Promise.resolve()
    .then(() => {
      signal.throwIfAborted();
      if (closed) throw new Error("Worker integration preparation is closed.");
      return loadMcp();
    })
    .then((loaded) => {
      mcp = loaded;
      if (closed || signal.aborted) void close().catch(() => {});
      return loaded;
    });
  const githubReady = Promise.resolve().then(() => {
    signal.throwIfAborted();
    if (closed) throw new Error("Worker integration preparation is closed.");
    return loadGithub();
  });
  const ready = Promise.race([
    Promise.all([mcpReady, githubReady]),
    unavailable,
  ]).then(([mcp, github]) => {
    signal.throwIfAborted();
    if (closed) throw new Error("Worker integration preparation is closed.");
    return { mcp, github };
  });
  // Admission/preflight can fail before the caller awaits ready. Observe both
  // loader failures now and release a result arriving after that failure.
  void ready.catch(() => {
    void close().catch(() => {});
  });
  return { ready, close };
}
