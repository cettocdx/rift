interface ProbeSubscription {
  publish(data: unknown): Promise<unknown>;
  on(event: "publication", handler: (context: { data: unknown }) => void): unknown;
  off(event: "publication", handler: (context: { data: unknown }) => void): unknown;
}

/** A connected output worker cannot acknowledge this: only the command
 * receiver does. Retry harmless probes, never the actual command. */
export function waitForCommandReceiver(
  subscription: ProbeSubscription,
  targetConnectionId: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const probeId = crypto.randomUUID();
    let settled = false;
    let publishing = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearInterval(retry);
      subscription.off("publication", receive);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve();
    };
    const receive = ({ data: publication }: { data: unknown }) => {
      if (!publication || typeof publication !== "object") return;
      const data = publication as Record<string, unknown>;
      if (data?.type === "runner_ready" && data.probeId === probeId &&
          data.targetConnectionId === targetConnectionId) finish();
    };
    const abort = () => finish(signal?.reason ?? new Error("Stopped"));
    const probe = () => {
      if (settled || publishing) return;
      publishing = true;
      void Promise.resolve().then(() => settled ? undefined : subscription.publish({
        type: "runner_probe", probeId, targetConnectionId,
      })).catch(() => {}).finally(() => { publishing = false; });
    };
    const deadline = setTimeout(() => finish(new Error(
      "Local command receiver is not ready. No command was sent; reconnect and retry.",
    )), 10000);
    const retry = setInterval(probe, 500);
    subscription.on("publication", receive);
    signal?.addEventListener("abort", abort, { once: true });
    probe();
  });
}
