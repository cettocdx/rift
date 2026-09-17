/** Called after run ownership validation. Local access is mandatory; cloud
 * warmup overlaps the first model request and actual tools surface its errors. */
export async function prepareTurnSandbox(args: {
  executionPreference: string;
  standaloneGreeting: boolean;
  ensureSandbox: () => Promise<unknown>;
  signal: AbortSignal;
}): Promise<void> {
  args.signal.throwIfAborted();
  if (args.executionPreference === "e2b") {
    if (!args.standaloneGreeting) void args.ensureSandbox().catch(() => {});
  } else {
    await args.ensureSandbox();
    args.signal.throwIfAborted();
  }
}
