/**
 * Read one stream chunk while allowing the caller to stop waiting.
 *
 * Promise.race alone is not enough here: adding a fresh abort listener for
 * every chunk without removing it after a successful read leaks listeners for
 * the lifetime of a long response. This helper always detaches the listener.
 */
export async function readStreamChunkWithAbort<T>(
  reader: Pick<ReadableStreamDefaultReader<T>, "read">,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<T>> {
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  let onAbort: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    return await Promise.race([reader.read(), abortPromise]);
  } finally {
    if (onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}
