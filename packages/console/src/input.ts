import { PassThrough } from "node:stream";
import { emitKeypressEvents, type Key } from "node:readline";

/** Bracketed paste is buffered until its closing marker, so pasted newlines cannot submit. */
export function createTerminalInput(
  onKey: (text: string, key: Key) => void,
  onPaste: (text: string) => void,
) {
  const stream = new PassThrough();
  emitKeypressEvents(stream);
  stream.on("keypress", onKey);
  let pending = "";
  let pasting = false;
  let pasted = "";
  const start = "\x1b[200~";
  const end = "\x1b[201~";
  function write(chunk: string) {
    pending += chunk;
    while (pending) {
      const marker = pasting ? end : start;
      const index = pending.indexOf(marker);
      if (index !== -1) {
        const prefix = pending.slice(0, index);
        if (pasting) {
          pasted = (pasted + prefix).slice(0, 32_000);
          onPaste(pasted);
          pasted = "";
        } else if (prefix) stream.write(prefix);
        pending = pending.slice(index + marker.length);
        pasting = !pasting;
        continue;
      }
      let suffix = 0;
      for (let size = 1; size < marker.length; size++)
        if (pending.endsWith(marker.slice(0, size))) suffix = size;
      const body = suffix ? pending.slice(0, -suffix) : pending;
      if (pasting) pasted = (pasted + body).slice(0, 32_000);
      else if (body) stream.write(body);
      pending = suffix ? pending.slice(-suffix) : "";
      break;
    }
  }
  function flushEscape() {
    if (!pasting && pending === "\x1b") {
      stream.write(pending);
      pending = "";
    }
  }
  return {
    write,
    flushEscape,
    close: () => {
      stream.removeAllListeners();
      stream.destroy();
    },
  };
}
