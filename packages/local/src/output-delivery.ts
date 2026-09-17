import { randomUUID } from "node:crypto";

/** Keeps command output ordered across transient relay failures. Not process durability. */
export class OutputDelivery {
  private tail: Promise<void> = Promise.resolve();
  private bytes = 0;
  private stopped = false;
  private failure: Error | undefined;

  constructor(
    private readonly publish: (data: object) => Promise<unknown>,
    private readonly retryMs = 250,
    private readonly deadlineMs = 120_000,
    private readonly maxBytes = 32 * 1024 * 1024,
  ) {}

  send(data: object): Promise<void> {
    const envelope = { ...data, deliveryId: randomUUID() };
    const size = Buffer.byteLength(JSON.stringify(envelope));
    if (this.bytes + size > this.maxBytes) {
      this.failure = new Error("Local output delivery buffer exceeded; output is incomplete");
      return Promise.reject(this.failure);
    }
    this.bytes += size;
    const task = this.tail.then(async () => {
      const deadline = Date.now() + this.deadlineMs;
      for (;;) {
        if (this.stopped) throw new Error("Local output delivery stopped");
        if (this.failure) throw this.failure;
        try {
          await this.publish(envelope);
          return;
        } catch (error) {
          if (Date.now() >= deadline) {
            this.failure = new Error("Local output delivery timed out", { cause: error });
            throw this.failure;
          }
          await new Promise(resolve => setTimeout(resolve, this.retryMs));
        }
      }
    }).finally(() => { this.bytes -= size; });
    this.tail = task.catch(() => {});
    return task;
  }

  stop(): void { this.stopped = true; }
}
