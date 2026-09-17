import { isWorkbenchClientTerminalId } from "@/lib/workbench/interactive-terminal-contract";

/** Six terminals stay below ~1 MiB of sessionStorage after base64 encoding. */
export const MAX_PERSISTED_TERMINAL_SCROLLBACK_BYTES = 128 * 1024;
const TERMINAL_SESSION_ID_PATTERN = /^[a-f0-9]{24}$/;

export type WorkbenchTerminalScrollbackSnapshot = {
  bytes: Uint8Array;
  sessionId: string | null;
  cursor: number;
};

export type WorkbenchTerminalResetReason =
  | "buffer_truncated"
  | "stream_reconnected"
  | "invalid_cursor";

const RESET_NOTICE: Record<WorkbenchTerminalResetReason, string> = {
  buffer_truncated:
    "Earlier terminal output exceeded the replay buffer and is unavailable.",
  stream_reconnected:
    "The terminal reconnected on another server; earlier output is unavailable.",
  invalid_cursor:
    "The terminal replay position was invalid; earlier output is unavailable.",
};

export function workbenchTerminalResetPolicy(
  reason: WorkbenchTerminalResetReason,
  hasLocalScrollback: boolean,
) {
  const preserveScrollback =
    reason === "stream_reconnected" && hasLocalScrollback;
  return {
    preserveScrollback,
    notice: preserveScrollback
      ? "Live terminal reconnected. Scrollback was restored for this browser tab."
      : RESET_NOTICE[reason],
  } as const;
}

function storageKey(clientTerminalId: string) {
  return `rift:workbench:terminal-scrollback:v2:${clientTerminalId}`;
}

function emptySnapshot(): WorkbenchTerminalScrollbackSnapshot {
  return { bytes: new Uint8Array(), sessionId: null, cursor: 0 };
}

function browserSessionStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  const blockSize = 8192;
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + blockSize),
    );
  }
  return window.btoa(binary);
}

function decodeBase64(value: string) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function appendBoundedTerminalScrollback(
  current: Uint8Array,
  incoming: Uint8Array,
) {
  return appendBoundedTerminalScrollbackChunks(current, [incoming]);
}

export function appendBoundedTerminalScrollbackChunks(
  current: Uint8Array,
  incoming: readonly Uint8Array[],
) {
  const incomingBytes = incoming.reduce(
    (total, chunk) => total + chunk.byteLength,
    0,
  );
  const next = new Uint8Array(
    Math.min(
      MAX_PERSISTED_TERMINAL_SCROLLBACK_BYTES,
      current.byteLength + incomingBytes,
    ),
  );
  let writeOffset = next.byteLength;
  for (
    let index = incoming.length - 1;
    index >= 0 && writeOffset > 0;
    index -= 1
  ) {
    const chunk = incoming[index];
    const copiedBytes = Math.min(writeOffset, chunk.byteLength);
    writeOffset -= copiedBytes;
    next.set(chunk.subarray(chunk.byteLength - copiedBytes), writeOffset);
  }
  if (writeOffset > 0) {
    const copiedBytes = Math.min(writeOffset, current.byteLength);
    writeOffset -= copiedBytes;
    next.set(current.subarray(current.byteLength - copiedBytes), writeOffset);
  }
  return next;
}

export function readWorkbenchTerminalScrollbackSnapshot(
  clientTerminalId: string,
  storage: Storage | null = browserSessionStorage(),
): WorkbenchTerminalScrollbackSnapshot {
  if (!storage || !isWorkbenchClientTerminalId(clientTerminalId)) {
    return emptySnapshot();
  }
  try {
    const serialized = storage.getItem(storageKey(clientTerminalId));
    if (!serialized) return emptySnapshot();
    const value = JSON.parse(serialized) as Record<string, unknown>;
    if (
      value.version !== 2 ||
      typeof value.data !== "string" ||
      !Number.isSafeInteger(value.cursor) ||
      (value.cursor as number) < 0 ||
      !(
        value.sessionId === null ||
        (typeof value.sessionId === "string" &&
          TERMINAL_SESSION_ID_PATTERN.test(value.sessionId))
      )
    ) {
      throw new Error("Invalid terminal scrollback snapshot");
    }
    const decoded = decodeBase64(value.data);
    return decoded.byteLength <= MAX_PERSISTED_TERMINAL_SCROLLBACK_BYTES
      ? {
          bytes: decoded,
          sessionId: value.sessionId,
          cursor: value.cursor as number,
        }
      : {
          bytes: decoded.slice(-MAX_PERSISTED_TERMINAL_SCROLLBACK_BYTES),
          sessionId: value.sessionId,
          cursor: value.cursor as number,
        };
  } catch {
    try {
      storage.removeItem(storageKey(clientTerminalId));
    } catch {
      // Ignore a second privacy-mode storage failure.
    }
    return emptySnapshot();
  }
}

export function readWorkbenchTerminalScrollback(
  clientTerminalId: string,
  storage: Storage | null = browserSessionStorage(),
) {
  return readWorkbenchTerminalScrollbackSnapshot(clientTerminalId, storage)
    .bytes;
}

export function workbenchTerminalReplayCursor(
  snapshot: WorkbenchTerminalScrollbackSnapshot,
  sessionId: string,
) {
  return snapshot.sessionId === sessionId ? snapshot.cursor : 0;
}

export function persistWorkbenchTerminalScrollback(
  clientTerminalId: string,
  snapshot: WorkbenchTerminalScrollbackSnapshot,
  storage: Storage | null = browserSessionStorage(),
) {
  if (!storage || !isWorkbenchClientTerminalId(clientTerminalId)) return;
  try {
    const bounded =
      snapshot.bytes.byteLength <= MAX_PERSISTED_TERMINAL_SCROLLBACK_BYTES
        ? snapshot.bytes
        : snapshot.bytes.slice(-MAX_PERSISTED_TERMINAL_SCROLLBACK_BYTES);
    const sessionId =
      snapshot.sessionId && TERMINAL_SESSION_ID_PATTERN.test(snapshot.sessionId)
        ? snapshot.sessionId
        : null;
    const cursor =
      Number.isSafeInteger(snapshot.cursor) && snapshot.cursor >= 0
        ? snapshot.cursor
        : 0;
    storage.setItem(
      storageKey(clientTerminalId),
      JSON.stringify({
        version: 2,
        sessionId,
        cursor,
        data: encodeBase64(bounded),
      }),
    );
  } catch {
    // Quota and privacy-mode failures must never interrupt the live PTY.
  }
}

export function clearWorkbenchTerminalScrollback(
  clientTerminalId: string,
  storage: Storage | null = browserSessionStorage(),
) {
  if (!storage || !isWorkbenchClientTerminalId(clientTerminalId)) return;
  try {
    storage.removeItem(storageKey(clientTerminalId));
  } catch {
    // The terminal remains usable when storage is unavailable.
  }
}
