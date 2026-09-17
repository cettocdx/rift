import { createTerminalOutputFlow } from "../terminal-output-flow";
import {
  createFlowControlledTerminalStream,
  TERMINAL_STREAM_FRAME_BYTES,
} from "../flow-controlled-terminal-stream";
import type { PtyHandle } from "@/lib/ai/tools/utils/e2b-pty-adapter";

it("does not let a fast reader release another attachment credit", () => {
  const pause = jest.fn(),
    resume = jest.fn();
  const acquire = createTerminalOutputFlow(pause, resume);
  const slow = acquire(),
    fast = acquire();
  slow.pause();
  fast.pause();
  fast.resume();
  fast.dispose();
  expect(pause).toHaveBeenCalledTimes(1);
  expect(resume).not.toHaveBeenCalled();
  slow.dispose();
  expect(resume).toHaveBeenCalledTimes(1);
  slow.pause();
  slow.resume();
  expect(pause).toHaveBeenCalledTimes(1);
  expect(resume).toHaveBeenCalledTimes(1);
});

function fixture(bytes = Buffer.alloc(0), exited = false, rotationMs = 10000) {
  const pause = jest.fn(),
    resume = jest.fn(),
    listeners = new Set<() => void>();
  let exit!: (value: { exitCode: number | null }) => void;
  const handle: PtyHandle = {
    pid: 1,
    sendInput: jest.fn(),
    resize: jest.fn(),
    kill: jest.fn(),
    acquireOutputFlowControl: createTerminalOutputFlow(pause, resume),
    onData: (cb) => {
      const f = () => cb(Buffer.alloc(0));
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    exited: new Promise((resolve) => {
      exit = resolve;
    }),
  };
  const abort = new AbortController();
  const stream = createFlowControlledTerminalStream({
    handle,
    read: (cursor, max) => ({
      bytes: bytes.subarray(cursor, cursor + max),
      nextCursor: Math.min(bytes.length, cursor + max),
      retainedFrom: 0,
      reset: false,
    }),
    ready: {
      type: "ready",
      session: {} as never,
      cursor: 0,
      reconnected: false,
    },
    exit: () => (exited ? { exitCode: 0 } : null),
    signal: abort.signal,
    heartbeatMs: 1000,
    rotationMs,
  });
  return { reader: stream.getReader(), abort, pause, resume, listeners, exit };
}
function event(value?: Uint8Array) {
  const line = new TextDecoder()
    .decode(value)
    .split("\n")
    .find((v) => v.startsWith("data: "));
  return line ? JSON.parse(line.slice(6)) : undefined;
}

it("splits replay into bounded frames and puts exit after every byte", async () => {
  const bytes = Buffer.from("π🙂x".repeat(100000));
  const f = fixture(bytes, true);
  const chunks: Buffer[] = [];
  const events: string[] = [];
  try {
    for (;;) {
      const n = await f.reader.read();
      if (n.done) break;
      const e = event(n.value);
      events.push(e.type);
      if (e.type === "output") {
        const b = Buffer.from(e.data, "base64");
        expect(b.length).toBeLessThanOrEqual(TERMINAL_STREAM_FRAME_BYTES);
        chunks.push(b);
      }
    }
    expect(Buffer.concat(chunks)).toEqual(bytes);
    expect(events[0]).toBe("ready");
    expect(events.at(-1)).toBe("exit");
    expect(f.listeners.size).toBe(0);
  } finally {
    f.abort.abort();
    await f.reader.cancel();
  }
});

it("rotation preserves the last delivered cursor after pending output", async () => {
  jest.useFakeTimers();
  const bytes = Buffer.from("bounded replay");
  const f = fixture(bytes, false, 100);
  try {
    await jest.advanceTimersByTimeAsync(100);
    expect(event((await f.reader.read()).value).type).toBe("ready");
    expect(event((await f.reader.read()).value).type).toBe("output");
    expect(event((await f.reader.read()).value)).toEqual({
      type: "rotate",
      cursor: bytes.length,
    });
    expect((await f.reader.read()).done).toBe(true);
    expect(f.listeners.size).toBe(0);
  } finally {
    f.abort.abort();
    await f.reader.cancel();
    jest.useRealTimers();
  }
});

it.each(["abort", "cancel"])(
  "releases producer credit and a pending read on %s",
  async (kind) => {
    const f = fixture();
    try {
      await f.reader.read();
      const pending = f.reader.read();
      await Promise.resolve();
      if (kind === "abort") f.abort.abort();
      else await f.reader.cancel();
      expect((await pending).done).toBe(true);
      expect(f.listeners.size).toBe(0);
      const resumes = f.resume.mock.calls.length;
      f.exit({ exitCode: 0 });
      await Promise.resolve();
      expect(f.resume.mock.calls.length).toBe(resumes);
    } finally {
      f.abort.abort();
      await f.reader.cancel();
    }
  },
);
