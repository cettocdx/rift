/** A transport error is not absence. Require typed control-plane not-found,
 * a complete authenticated inventory including paused VMs, then a second check.
 * This never resumes a VM or executes/kills a process. */
export async function confirmSandboxAbsence(
  sandboxId: string,
  deps: {
    info(): Promise<unknown>;
    isNotFound(error: unknown): boolean;
    inventory(): AsyncIterable<readonly { sandboxId: string }[]>;
  },
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    signal?.throwIfAborted();
    try {
      await deps.info();
      return false;
    } catch (error) {
      if (!deps.isNotFound(error)) return false;
    }
    for await (const page of deps.inventory()) {
      signal?.throwIfAborted();
      if (page.some((item) => item.sandboxId === sandboxId)) return false;
    }
    signal?.throwIfAborted();
    try {
      await deps.info();
      return false;
    } catch (error) {
      return !signal?.aborted && deps.isNotFound(error);
    }
  } catch {
    return false;
  }
}
