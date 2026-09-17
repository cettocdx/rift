export type JsonSseParser<T> = {
  push(chunk: Uint8Array | string): void;
  finish(): void;
};

const EVENT_BOUNDARY = /\r?\n\r?\n/;

function eventData(frame: string): string | null {
  const data: string[] = [];
  const lines = frame.replace(/\r\n?/g, "\n").split("\n");

  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;

    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    if (field !== "data") continue;

    let value = separator === -1 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    data.push(value);
  }

  return data.length > 0 ? data.join("\n") : null;
}

/**
 * Incrementally parses a fetch-based SSE response and emits JSON `data` frames.
 * It intentionally ignores comments, event names, ids, and retry hints.
 */
export function createJsonSseParser<T>(
  onMessage: (message: T) => void,
): JsonSseParser<T> {
  const decoder = new TextDecoder();
  let buffer = "";

  const dispatch = (frame: string) => {
    const data = eventData(frame);
    if (data === null) return;

    let message: T;
    try {
      message = JSON.parse(data) as T;
    } catch (error) {
      throw new Error("The terminal event stream returned invalid JSON.", {
        cause: error,
      });
    }
    onMessage(message);
  };

  const drain = (flushRemainder = false) => {
    let boundary = EVENT_BOUNDARY.exec(buffer);
    while (boundary) {
      dispatch(buffer.slice(0, boundary.index));
      buffer = buffer.slice(boundary.index + boundary[0].length);
      boundary = EVENT_BOUNDARY.exec(buffer);
    }

    if (flushRemainder && buffer.trim()) dispatch(buffer);
    if (flushRemainder) buffer = "";
  };

  return {
    push(chunk) {
      buffer +=
        typeof chunk === "string"
          ? chunk
          : decoder.decode(chunk, { stream: true });
      drain();
    },
    finish() {
      buffer += decoder.decode();
      drain(true);
    },
  };
}
