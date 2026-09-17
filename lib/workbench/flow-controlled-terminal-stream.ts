import type { PtyHandle } from "@/lib/ai/tools/utils/e2b-pty-adapter";
import type { WorkbenchTerminalStreamEvent } from "./interactive-terminal-contract";

export const TERMINAL_STREAM_FRAME_BYTES = 64 * 1024;

type Read = {
  bytes: Uint8Array;
  nextCursor: number;
  reset: boolean;
  retainedFrom: number;
};

/** Demand-driven PTY path: no producer callback enqueues into the HTTP stream.
 * Output is paused until the current attachment asks for another frame.
 * The session ring owns raw replay; this adapter holds one bounded frame.
 * E2B handles participate only with the awaited SDK callback patch. */
export function createFlowControlledTerminalStream(args: {
  handle: PtyHandle;
  read: (cursor: number, maxBytes: number) => Read;
  ready: Extract<WorkbenchTerminalStreamEvent, { type: "ready" }>;
  exit: () => { exitCode: number | null } | null;
  signal: AbortSignal;
  heartbeatMs: number;
  rotationMs: number;
}) {
  const flow = args.handle.acquireOutputFlowControl!();
  const encoder = new TextEncoder();
  let cursor = args.ready.cursor;
  let closed = false;
  let first = true;
  let reconnectReset = args.ready.reconnected;
  let exit = args.exit();
  let rotate = false;
  let heartbeatDue = false;
  let wake: (() => void) | undefined;
  let finish = () => {};
  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        const notify = () => {
          wake?.();
          wake = undefined;
        };
        flow.pause();
        const unsubscribe = args.handle.onData(() => {
          flow.pause();
          notify();
        });
        const heartbeat = setInterval(() => {
          heartbeatDue = true;
          notify();
        }, args.heartbeatMs);
        const rotation = setTimeout(() => {
          rotate = true;
          notify();
        }, args.rotationMs);
        finish = () => {
          if (closed) return;
          closed = true;
          unsubscribe();
          clearInterval(heartbeat);
          clearTimeout(rotation);
          args.signal.removeEventListener("abort", finish);
          flow.dispose();
          notify();
          try {
            controller.close();
          } catch {
            /* consumer already canceled */
          }
        };
        args.signal.addEventListener("abort", finish, { once: true });
        if (args.signal.aborted) finish();
        void args.handle.exited.then((value) => {
          if (closed) return;
          exit = value;
          notify();
        });
      },
      async pull(controller) {
        const emit = (event: WorkbenchTerminalStreamEvent) => {
          controller.enqueue(
            encoder.encode(
              `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            ),
          );
        };
        while (!closed) {
          if (first) {
            first = false;
            emit(args.ready);
            return;
          }
          if (reconnectReset) {
            reconnectReset = false;
            emit({ type: "reset", reason: "stream_reconnected", cursor });
            return;
          }
          const read = args.read(cursor, TERMINAL_STREAM_FRAME_BYTES);
          if (read.reset) {
            const reason =
              cursor < read.retainedFrom
                ? "buffer_truncated"
                : "invalid_cursor";
            cursor = read.retainedFrom;
            emit({ type: "reset", reason, cursor });
            return;
          }
          if (read.bytes.byteLength) {
            cursor = read.nextCursor;
            emit({
              type: "output",
              encoding: "base64",
              data: Buffer.from(read.bytes).toString("base64"),
              cursor,
            });
            return;
          }
          if (exit) {
            emit({ type: "exit", exitCode: exit.exitCode, cursor });
            finish();
            return;
          }
          if (rotate) {
            emit({ type: "rotate", cursor });
            finish();
            return;
          }
          if (heartbeatDue) {
            heartbeatDue = false;
            controller.enqueue(encoder.encode(": keepalive\n\n"));
            return;
          }
          // Install the wakeup before resuming: an adapter may publish immediately.
          const ready = new Promise<void>((resolve) => {
            wake = resolve;
          });
          flow.resume();
          await ready;
          flow.pause();
        }
      },
      cancel() {
        finish();
      },
    },
    { highWaterMark: 0 },
  );
}
