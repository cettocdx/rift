import {
  MAX_PERSISTED_TERMINAL_SCROLLBACK_BYTES,
  appendBoundedTerminalScrollback,
  clearWorkbenchTerminalScrollback,
  persistWorkbenchTerminalScrollback,
  readWorkbenchTerminalScrollback,
  readWorkbenchTerminalScrollbackSnapshot,
  workbenchTerminalReplayCursor,
  workbenchTerminalResetPolicy,
} from "../terminal-scrollback";

describe("Workbench terminal scrollback persistence", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("keeps only the newest bounded raw PTY bytes", () => {
    const first = new Uint8Array(
      MAX_PERSISTED_TERMINAL_SCROLLBACK_BYTES - 2,
    ).fill(1);
    const next = appendBoundedTerminalScrollback(
      first,
      new Uint8Array([2, 3, 4, 5]),
    );
    expect(next).toHaveLength(MAX_PERSISTED_TERMINAL_SCROLLBACK_BYTES);
    expect(Array.from(next.slice(0, 3))).toEqual([1, 1, 1]);
    expect(Array.from(next.slice(-5))).toEqual([1, 2, 3, 4, 5]);

    const oversized = new Uint8Array(
      MAX_PERSISTED_TERMINAL_SCROLLBACK_BYTES + 10,
    );
    oversized.set([7, 8, 9], oversized.length - 3);
    const newest = appendBoundedTerminalScrollback(next, oversized);
    expect(newest).toHaveLength(MAX_PERSISTED_TERMINAL_SCROLLBACK_BYTES);
    expect(Array.from(newest.slice(-3))).toEqual([7, 8, 9]);
  });

  it("isolates replay bytes per browser terminal and clears closed tabs", () => {
    const encoder = new TextEncoder();
    persistWorkbenchTerminalScrollback("terminal-replay-one", {
      bytes: encoder.encode("\u001b[32mfirst\u001b[0m"),
      sessionId: null,
      cursor: 0,
    });
    persistWorkbenchTerminalScrollback("terminal-replay-two", {
      bytes: encoder.encode("second"),
      sessionId: null,
      cursor: 0,
    });

    expect(
      new TextDecoder().decode(
        readWorkbenchTerminalScrollback("terminal-replay-one"),
      ),
    ).toBe("\u001b[32mfirst\u001b[0m");
    expect(
      new TextDecoder().decode(
        readWorkbenchTerminalScrollback("terminal-replay-two"),
      ),
    ).toBe("second");

    clearWorkbenchTerminalScrollback("terminal-replay-one");
    expect(readWorkbenchTerminalScrollback("terminal-replay-one")).toHaveLength(
      0,
    );
    expect(
      new TextDecoder().decode(
        readWorkbenchTerminalScrollback("terminal-replay-two"),
      ),
    ).toBe("second");
  });

  it("drops corrupted or invalid-id storage without affecting the terminal", () => {
    window.sessionStorage.setItem(
      "rift:workbench:terminal-scrollback:v2:terminal-corrupt",
      "not canonical base64 %",
    );
    expect(readWorkbenchTerminalScrollback("terminal-corrupt")).toHaveLength(0);
    expect(readWorkbenchTerminalScrollback("../invalid")).toHaveLength(0);
  });

  it("preserves restored scrollback on a cold stream reconnect with one notice", () => {
    expect(workbenchTerminalResetPolicy("stream_reconnected", true)).toEqual({
      preserveScrollback: true,
      notice:
        "Live terminal reconnected. Scrollback was restored for this browser tab.",
    });
    expect(workbenchTerminalResetPolicy("buffer_truncated", true)).toEqual({
      preserveScrollback: false,
      notice:
        "Earlier terminal output exceeded the replay buffer and is unavailable.",
    });
  });

  it("resumes the matching server cursor so restored output is not replayed twice", () => {
    const sessionId = "0123456789abcdef01234567";
    persistWorkbenchTerminalScrollback("terminal-cursor", {
      bytes: new TextEncoder().encode("one prompt only"),
      sessionId,
      cursor: 842,
    });
    const restored = readWorkbenchTerminalScrollbackSnapshot("terminal-cursor");

    expect(new TextDecoder().decode(restored.bytes)).toBe("one prompt only");
    expect(workbenchTerminalReplayCursor(restored, sessionId)).toBe(842);
    expect(
      workbenchTerminalReplayCursor(restored, "abcdef0123456789abcdef01"),
    ).toBe(0);
  });
});
