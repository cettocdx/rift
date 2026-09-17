/** @jest-environment node */
/**
 * Tests for the E2B PTY adapter.
 *
 * Wraps E2B's callback-style `sandbox.pty.create({onData, cols, rows, ...})`
 * into a listener-set based `PtyHandle`. Verifies:
 * - correct propagation of options to `sandbox.pty.create`
 * - fan-out of `onData` chunks to multiple listeners
 * - unsubscribe removes the listener from future deliveries
 * - `sendInput`/`resize`/`kill` delegate with the captured pid
 * - `exited` is a memoized promise resolving once with `{exitCode}`
 *   (or `{exitCode: null}` if `wait()` rejects, with a logged error)
 */

import type { Sandbox } from "@e2b/code-interpreter";
import {
  connectE2BPtyHandle,
  createE2BPtyHandle,
  isExpectedPtyTerminationError,
  type CreatePtyOptions,
} from "../e2b-pty-adapter";
import { DEFAULT_PTY_COLS, DEFAULT_PTY_ROWS } from "../pty-session-manager";

// ── Mock helpers ─────────────────────────────────────────────────────

type OnDataCb = (bytes: Uint8Array) => void | Promise<void>;

interface CapturedCreateCall {
  cols: number;
  rows: number;
  cwd?: string;
  envs?: Record<string, string>;
  user?: string;
  onData: OnDataCb;
}

interface MockHandle {
  pid: number;
  wait: jest.Mock<Promise<{ exitCode: number }>>;
}

interface MockPtyCalls {
  capturedCreate: CapturedCreateCall | null;
  sendInput: jest.Mock;
  resize: jest.Mock;
  kill: jest.Mock;
  create: jest.Mock;
  connect: jest.Mock;
}

interface MockSandboxResult {
  sandbox: Sandbox;
  mock: MockPtyCalls;
  emitData: (bytes: Uint8Array) => Promise<void>;
  resolveWait: (result: { exitCode: number }) => void;
  rejectWait: (err: Error) => void;
}

function buildMockSandbox(pid = 4242): MockSandboxResult {
  const mock: MockPtyCalls = {
    capturedCreate: null,
    sendInput: jest.fn().mockResolvedValue(undefined),
    resize: jest.fn().mockResolvedValue(undefined),
    kill: jest.fn().mockResolvedValue(true),
    create: jest.fn(),
    connect: jest.fn(),
  };

  let resolveWait!: (result: { exitCode: number }) => void;
  let rejectWait!: (err: Error) => void;
  const waitPromise = new Promise<{ exitCode: number }>((resolve, reject) => {
    resolveWait = resolve;
    rejectWait = reject;
  });

  const handle: MockHandle = {
    pid,
    wait: jest.fn(() => waitPromise),
  };

  mock.create.mockImplementation(async (opts: CapturedCreateCall) => {
    mock.capturedCreate = opts;
    return handle;
  });
  mock.connect.mockImplementation(
    async (_pid: number, opts: Pick<CapturedCreateCall, "onData">) => {
      mock.capturedCreate = {
        cols: 0,
        rows: 0,
        onData: opts.onData,
      };
      return handle;
    },
  );

  const sandboxLike = {
    pty: {
      create: mock.create,
      connect: mock.connect,
      sendInput: mock.sendInput,
      resize: mock.resize,
      kill: mock.kill,
    },
  };

  return {
    sandbox: sandboxLike as unknown as Sandbox,
    mock,
    emitData: async (bytes) => {
      if (!mock.capturedCreate) {
        throw new Error(
          "onData not captured yet — call createE2BPtyHandle first",
        );
      }
      await mock.capturedCreate.onData(bytes);
    },
    resolveWait,
    rejectWait,
  };
}

const defaultOpts: CreatePtyOptions = {
  cols: DEFAULT_PTY_COLS,
  rows: DEFAULT_PTY_ROWS,
};

// ── Tests ────────────────────────────────────────────────────────────

describe("createE2BPtyHandle", () => {
  it("calls sandbox.pty.create with cols/rows/cwd/envs and attaches an onData callback", async () => {
    const { sandbox, mock } = buildMockSandbox();
    const opts: CreatePtyOptions = {
      cols: 80,
      rows: 24,
      cwd: "/workspace",
      envs: { FOO: "bar" },
      user: "user",
    };

    const handle = await createE2BPtyHandle(sandbox, opts);

    expect(handle.pid).toBe(4242);
    expect(mock.create).toHaveBeenCalledTimes(1);
    const created = mock.capturedCreate;
    expect(created).not.toBeNull();
    expect(created!.cols).toBe(80);
    expect(created!.rows).toBe(24);
    expect(created!.cwd).toBe("/workspace");
    expect(created!.envs).toEqual({ FOO: "bar" });
    expect(created!.user).toBe("user");
    expect(typeof created!.onData).toBe("function");
  });

  it("replays prompt bytes emitted before the manager subscribes", async () => {
    const { sandbox, emitData } = buildMockSandbox();
    const handle = await createE2BPtyHandle(sandbox, defaultOpts);
    const prompt = new Uint8Array([0x72, 0x69, 0x66, 0x74]);

    await emitData(prompt);
    const listener = jest.fn();
    handle.onData(listener);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(Array.from(listener.mock.calls[0][0])).toEqual(Array.from(prompt));
  });

  it("connects to an existing PTY by pid and returns the same handle contract", async () => {
    const { sandbox, mock, emitData } = buildMockSandbox(31337);
    const handle = await connectE2BPtyHandle(sandbox, 31337);
    const listener = jest.fn();
    handle.onData(listener);
    await emitData(new Uint8Array([0x41]));
    await handle.sendInput(new Uint8Array([0x42]));

    expect(mock.connect).toHaveBeenCalledTimes(1);
    expect(mock.connect.mock.calls[0][0]).toBe(31337);
    expect(typeof mock.connect.mock.calls[0][1].onData).toBe("function");
    expect(handle.pid).toBe(31337);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(mock.sendInput).toHaveBeenCalledWith(31337, new Uint8Array([0x42]));
  });

  it("fans out onData chunks from E2B to every registered listener", async () => {
    const { sandbox, emitData } = buildMockSandbox();
    const handle = await createE2BPtyHandle(sandbox, defaultOpts);

    const a = jest.fn();
    const b = jest.fn();
    const c = jest.fn();
    handle.onData(a);
    handle.onData(b);
    handle.onData(c);

    const chunk = new Uint8Array([1, 2, 3]);
    await emitData(chunk);

    expect(a).toHaveBeenCalledWith(chunk);
    expect(b).toHaveBeenCalledWith(chunk);
    expect(c).toHaveBeenCalledWith(chunk);
  });

  it("returned unsubscribe function stops delivery to that listener only", async () => {
    const { sandbox, emitData } = buildMockSandbox();
    const handle = await createE2BPtyHandle(sandbox, defaultOpts);

    const keep = jest.fn();
    const drop = jest.fn();
    handle.onData(keep);
    const unsub = handle.onData(drop);

    await emitData(new Uint8Array([0x41]));
    expect(keep).toHaveBeenCalledTimes(1);
    expect(drop).toHaveBeenCalledTimes(1);

    unsub();

    await emitData(new Uint8Array([0x42]));
    expect(keep).toHaveBeenCalledTimes(2);
    expect(drop).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe is idempotent (calling twice does not throw or affect others)", async () => {
    const { sandbox, emitData } = buildMockSandbox();
    const handle = await createE2BPtyHandle(sandbox, defaultOpts);

    const keep = jest.fn();
    const drop = jest.fn();
    handle.onData(keep);
    const unsub = handle.onData(drop);

    unsub();
    expect(() => unsub()).not.toThrow();

    await emitData(new Uint8Array([7]));
    expect(keep).toHaveBeenCalledTimes(1);
    expect(drop).not.toHaveBeenCalled();
  });

  it("sendInput delegates to sandbox.pty.sendInput with the captured pid", async () => {
    const { sandbox, mock } = buildMockSandbox(9999);
    const handle = await createE2BPtyHandle(sandbox, defaultOpts);

    const payload = new Uint8Array([0x65, 0x78, 0x69, 0x74]); // "exit"
    await handle.sendInput(payload);

    expect(mock.sendInput).toHaveBeenCalledTimes(1);
    expect(mock.sendInput).toHaveBeenCalledWith(9999, payload);
  });

  it("resize delegates to sandbox.pty.resize with the captured pid and size object", async () => {
    const { sandbox, mock } = buildMockSandbox(1234);
    const handle = await createE2BPtyHandle(sandbox, defaultOpts);

    await handle.resize(80, 24);

    expect(mock.resize).toHaveBeenCalledTimes(1);
    expect(mock.resize).toHaveBeenCalledWith(1234, { cols: 80, rows: 24 });
  });

  it("kill delegates to sandbox.pty.kill with the captured pid", async () => {
    const { sandbox, mock } = buildMockSandbox(5555);
    const handle = await createE2BPtyHandle(sandbox, defaultOpts);

    await handle.kill();

    expect(mock.kill).toHaveBeenCalledTimes(1);
    expect(mock.kill).toHaveBeenCalledWith(5555);
  });

  it("kill throws when sandbox.pty.kill returns false (PTY not found)", async () => {
    const { sandbox, mock } = buildMockSandbox(5555);
    mock.kill.mockResolvedValueOnce(false);
    const handle = await createE2BPtyHandle(sandbox, defaultOpts);

    await expect(handle.kill()).rejects.toThrow(/pid=5555/);
  });

  it("exited resolves with {exitCode: 0} when wait() resolves with 0", async () => {
    const { sandbox, resolveWait } = buildMockSandbox();
    const handle = await createE2BPtyHandle(sandbox, defaultOpts);

    resolveWait({ exitCode: 0 });

    await expect(handle.exited).resolves.toEqual({ exitCode: 0 });
  });

  it("exited resolves with the reported non-zero exit code", async () => {
    const { sandbox, resolveWait } = buildMockSandbox();
    const handle = await createE2BPtyHandle(sandbox, defaultOpts);

    resolveWait({ exitCode: 137 });

    await expect(handle.exited).resolves.toEqual({ exitCode: 137 });
  });

  it("exited resolves with {exitCode: null} and logs when wait() rejects", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { sandbox, rejectWait } = buildMockSandbox();
      const handle = await createE2BPtyHandle(sandbox, defaultOpts);

      rejectWait(new Error("boom"));

      await expect(handle.exited).resolves.toEqual({ exitCode: null });
      expect(errorSpy).toHaveBeenCalled();
      const firstCall = errorSpy.mock.calls[0];
      expect(String(firstCall[0])).toContain("[e2b-pty-adapter]");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("treats normal kill and expired sandbox rejections as expected terminal states", () => {
    const killed = Object.assign(new Error("signal: killed"), {
      name: "CommandExitError",
    });
    const alarmClock = Object.assign(new Error("signal: alarm clock"), {
      name: "CommandExitError",
    });
    const expired = Object.assign(
      new Error("The sandbox was not found because it timed out"),
      { name: "TimeoutError" },
    );
    const alreadyClosedKill = new Error("Failed to kill PTY process: pid=7721");
    const grpcTeardown = new Error("2: [unknown] terminated");

    expect(isExpectedPtyTerminationError(killed)).toBe(true);
    expect(isExpectedPtyTerminationError(alarmClock)).toBe(true);
    expect(isExpectedPtyTerminationError(expired)).toBe(true);
    expect(isExpectedPtyTerminationError(alreadyClosedKill)).toBe(true);
    expect(isExpectedPtyTerminationError(grpcTeardown)).toBe(true);
    expect(isExpectedPtyTerminationError(new Error("network reset"))).toBe(
      false,
    );
    expect(
      isExpectedPtyTerminationError(
        Object.assign(new Error("Command exited with code 1"), {
          name: "CommandExitError",
          exitCode: 1,
        }),
      ),
    ).toBe(false);
    expect(
      isExpectedPtyTerminationError(
        new Error("Connection terminated unexpectedly"),
      ),
    ).toBe(false);
  });

  it("does not log expected wait rejection noise", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { sandbox, rejectWait } = buildMockSandbox();
      const handle = await createE2BPtyHandle(sandbox, defaultOpts);
      rejectWait(
        Object.assign(new Error("signal: killed"), {
          name: "CommandExitError",
        }),
      );

      await expect(handle.exited).resolves.toEqual({ exitCode: null });
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("does not log the Workbench launcher alarm as an application failure", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { sandbox, rejectWait } = buildMockSandbox();
      const handle = await createE2BPtyHandle(sandbox, defaultOpts);
      rejectWait(
        Object.assign(new Error("signal: alarm clock"), {
          name: "CommandExitError",
        }),
      );

      await expect(handle.exited).resolves.toEqual({ exitCode: null });
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("exited is memoized — every await returns the same resolution", async () => {
    const { sandbox, resolveWait } = buildMockSandbox();
    const handle = await createE2BPtyHandle(sandbox, defaultOpts);

    resolveWait({ exitCode: 0 });

    const [a, b, c] = await Promise.all([
      handle.exited,
      handle.exited,
      handle.exited,
    ]);
    expect(a).toEqual({ exitCode: 0 });
    expect(b).toBe(a);
    expect(c).toBe(a);
    // handle.exited is the same Promise instance across accesses
    expect(handle.exited).toBe(handle.exited);
  });

  it("kicks off wait() eagerly inside createE2BPtyHandle (not deferred to first access)", async () => {
    const { sandbox, mock } = buildMockSandbox();
    await createE2BPtyHandle(sandbox, defaultOpts);

    // The mock handle's `wait` is invoked by the adapter as soon as it's
    // wired up — before any consumer touches `.exited`.
    // Read through the captured handle via the create mock's resolved value.
    // We verify indirectly: the adapter memoizes from a single wait() call,
    // so wait should have been called exactly once by creation time.
    const handleReturn = await mock.create.mock.results[0].value;
    const mockHandle = handleReturn as MockHandle;
    expect(mockHandle.wait).toHaveBeenCalledTimes(1);
  });
});

it("holds SDK output until every reader releases credit without blocking input or resize", async () => {
  const { sandbox, emitData, mock } = buildMockSandbox();
  const handle = await createE2BPtyHandle(sandbox, defaultOpts);
  expect(handle.acquireOutputFlowControl).toBeDefined();
  const slow = handle.acquireOutputFlowControl!();
  const fast = handle.acquireOutputFlowControl!();
  const got: Buffer[] = [];
  handle.onData((b) => got.push(Buffer.from(b)));
  slow.pause();
  fast.pause();
  let settled = false;
  const output = emitData(Buffer.from("π terminal")).then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(got).toHaveLength(0);
  fast.resume();
  await handle.sendInput(Buffer.from("x"));
  await handle.resize(100, 30);
  expect(mock.sendInput).toHaveBeenCalled();
  expect(mock.resize).toHaveBeenCalled();
  expect(got).toHaveLength(0);
  slow.dispose();
  await output;
  expect(Buffer.concat(got).toString()).toBe("π terminal");
  fast.dispose();
});

it("kill releases an SDK callback blocked by a disconnected reader", async () => {
  const { sandbox, emitData } = buildMockSandbox();
  const handle = await createE2BPtyHandle(sandbox, defaultOpts);
  expect(handle.acquireOutputFlowControl).toBeDefined();
  const flow = handle.acquireOutputFlowControl!();
  flow.pause();
  const output = emitData(Buffer.from("queued"));
  await handle.kill();
  await output;
  flow.dispose();
});

it("keeps strict termination proof separate from a normalized wait failure", async () => {
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const { sandbox, rejectWait } = buildMockSandbox();
    const handle = await createE2BPtyHandle(sandbox, { cols: 80, rows: 24 });
    const failure = new Error("transport receipt unavailable");
    rejectWait(failure);
    await expect(handle.exited).resolves.toEqual({ exitCode: null });
    expect(handle.confirmedExited).toBeDefined();
    await expect(handle.confirmedExited).rejects.toBe(failure);
  } finally {
    spy.mockRestore();
  }
});
it("confirms actual E2B wait completion including nonzero process exit", async () => {
  const { sandbox, resolveWait } = buildMockSandbox();
  const handle = await createE2BPtyHandle(sandbox, { cols: 80, rows: 24 });
  resolveWait({ exitCode: 137 });
  expect(handle.confirmedExited).toBeDefined();
  await expect(handle.confirmedExited).resolves.toEqual({ exitCode: 137 });
});
it.each([null, undefined])(
  "does not confirm an E2B wait result with unknown exit code %s",
  async (exitCode) => {
    const { sandbox, resolveWait } = buildMockSandbox();
    const handle = await createE2BPtyHandle(sandbox, { cols: 80, rows: 24 });
    resolveWait({ exitCode } as any);
    await expect(handle.exited).resolves.toEqual({ exitCode: null });
    await expect(handle.confirmedExited).rejects.toThrow("exit");
  },
);
it("confirms SDK CommandExitError termination but refuses error-shaped transport objects", async () => {
  const { CommandExitError } = jest.requireActual<
    typeof import("@e2b/code-interpreter")
  >("@e2b/code-interpreter");
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const actual = buildMockSandbox();
    const handle = await createE2BPtyHandle(actual.sandbox, {
      cols: 80,
      rows: 24,
    });
    actual.rejectWait(
      new CommandExitError({
        exitCode: 137,
        stdout: "",
        stderr: "",
        error: "killed",
      }),
    );
    await expect(handle.confirmedExited).resolves.toEqual({ exitCode: 137 });
    const uncertain = buildMockSandbox();
    const second = await createE2BPtyHandle(uncertain.sandbox, {
      cols: 80,
      rows: 24,
    });
    const forged = Object.assign(new Error("transport failed"), {
      name: "CommandExitError",
      exitCode: 137,
    });
    uncertain.rejectWait(forged);
    await expect(second.confirmedExited).rejects.toBe(forged);
  } finally {
    spy.mockRestore();
  }
});
