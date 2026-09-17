type Identity = { id: string; name: string; input: unknown };

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

/** Per-run admission only. Persistent checkpoints still own crash recovery. */
export function createExecutionLedger() {
  const calls = new Map<
    string,
    { signature: string; result: Promise<unknown> }
  >();
  return {
    async run<T>(identity: Identity, execute: () => Promise<T>): Promise<T> {
      if (!identity.id || !identity.name)
        throw new Error("Missing tool call identity");
      const signature = JSON.stringify([
        identity.name,
        canonical(identity.input),
      ]);
      const previous = calls.get(identity.id);
      if (previous) {
        if (previous.signature !== signature)
          throw new Error(
            "Conflicting tool call identity. No action was repeated.",
          );
        return previous.result as Promise<T>;
      }
      if (calls.size >= 4096)
        throw new Error("Run tool limit reached. Completed work is preserved.");
      // Publish before execute starts, including when execute throws synchronously.
      const result = Promise.resolve().then(execute);
      calls.set(identity.id, { signature, result });
      return result;
    },
  };
}
