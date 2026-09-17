export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body exceeds the configured byte limit.");
    this.name = "RequestBodyTooLargeError";
  }
}

/**
 * Read a request body without ever buffering more than `maxBytes`.
 * `request.text()` only exposes the size after the full payload is allocated,
 * which makes Content-Length-free/chunked requests able to bypass the intended
 * memory boundary.
 */
export async function readLimitedTextBody(
  request: Request,
  maxBytes: number,
): Promise<string> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      throw new RequestBodyTooLargeError();
    }
  }

  const reader = request.body?.getReader();
  if (!reader) {
    // Request-like test doubles and genuinely empty requests may not expose a
    // web stream. Keep the same bounded guarantee on that compatibility path.
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > maxBytes) {
      throw new RequestBodyTooLargeError();
    }
    return raw;
  }

  const decoder = new TextDecoder();
  let totalBytes = 0;
  let raw = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError();
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    return raw;
  } finally {
    reader.releaseLock();
  }
}
