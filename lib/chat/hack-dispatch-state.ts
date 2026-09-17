export type HackDispatchSnapshot = {
  dispatchId?: string;
  transport?: "durable" | "http" | "legacy";
  stopTransport?: "durable" | "http" | "legacy";
  stoppingDispatchId?: string;
  status: "idle" | "stopping" | "failed" | "stopped";
};

/** Lives with the authenticated retained chat, so navigating cannot lose Stop. */
export class HackDispatchState {
  private snapshot: HackDispatchSnapshot = { status: "idle" };
  private listeners = new Set<() => void>();
  private pending: Promise<void> | undefined;
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(snapshot: HackDispatchSnapshot) {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
  get unresolved() {
    return (
      this.snapshot.status === "stopping" || this.snapshot.status === "failed"
    );
  }
  begin(
    dispatchId?: string,
    transport: "durable" | "http" | "legacy" = "durable",
  ) {
    if (dispatchId === this.snapshot.dispatchId) return;
    if (this.unresolved)
      throw new Error(
        "Confirm the previous assessment's Stop before starting another.",
      );
    this.update({ dispatchId, transport, status: "idle" });
  }
  restore(
    expectedId: string | undefined,
    dispatchId: string,
    transport: "durable" | "http" = "durable",
  ) {
    if (this.snapshot.dispatchId !== expectedId || this.unresolved) return;
    this.update({ ...this.snapshot, dispatchId, transport });
  }
  rejectUnidentifiedStop() {
    if (this.pending) return;
    this.update({ ...this.snapshot, status: "failed" });
  }
  cancel(
    fallbackId: string | undefined,
    operation: (dispatchId?: string) => Promise<void>,
    transport: "durable" | "http" | "legacy" = "durable",
  ): Promise<void> {
    if (this.pending) return this.pending;
    const stoppingDispatchId =
      this.snapshot.stoppingDispatchId ??
      this.snapshot.dispatchId ??
      fallbackId;
    this.update({
      ...this.snapshot,
      stoppingDispatchId,
      stopTransport: this.snapshot.stopTransport ?? transport,
      status: "stopping",
    });
    const pending = Promise.resolve()
      .then(() => operation(stoppingDispatchId))
      .then(
        () => {
          this.update({ ...this.snapshot, status: "stopped" });
        },
        (error) => {
          this.update({ ...this.snapshot, status: "failed" });
          throw error;
        },
      )
      .finally(() => {
        if (this.pending === pending) this.pending = undefined;
      });
    this.pending = pending;
    return pending;
  }
  dispose() {
    this.listeners.clear();
  }
}
