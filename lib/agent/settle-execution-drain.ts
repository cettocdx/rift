type ExecutionDrain = {
  drainTools(): Promise<void>;
  settle(): Promise<void>;
};

export async function settleExecutionDrain(options: {
  drain: ExecutionDrain;
  closeIntegrations(): Promise<void>;
  recordLocalDrain(): void | Promise<void>;
  stage(value: "tool_drain" | "integration_close" | "remote_exit"): void;
}) {
  // Local callbacks and integration clients can finish even when an exit
  // receipt is unavailable. That proof lets independent recovery verify the
  // remote process later; it never certifies remote exit or task success.
  options.stage("tool_drain");
  await options.drain.drainTools();
  options.stage("integration_close");
  await options.closeIntegrations();
  await options.recordLocalDrain();
  options.stage("remote_exit");
  await options.drain.settle();
}
