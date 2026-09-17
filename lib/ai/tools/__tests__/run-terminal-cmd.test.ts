jest.mock("@/lib/agent/remote-command-journal", () => {
  const actual = jest.requireActual("@/lib/agent/remote-command-journal");
  return {
    ...actual,
    prepareJournaledCommand: jest.fn(actual.prepareJournaledCommand),
  };
});
/**
 * Tests for `run_terminal_cmd` — focusing on exec and interactive session creation.
 *
 * The non-interactive (`action=exec`, `interactive=false`) path is already
 * covered by higher-level integration tests. Here we verify:
 *  - the dispatch contract for {exec, exec+interactive}
 *  - structured errors for non-E2B sandboxes and missing sessions
 *  - that the legacy schema ({command, brief, is_background, timeout})
 *    still flows through and produces a shaped result.
 *
 * PTY session action tests (send, wait, view, kill) are in
 * interact-terminal-session.test.ts.
 */

// Stub out @e2b/code-interpreter — its ESM `chalk` dependency trips Jest's
// default transformer. We only need the named exports that appear in
// `run-terminal-cmd.ts` to be importable.
jest.mock("@e2b/code-interpreter", () => ({
  AuthenticationError: class AuthenticationError extends Error {},
  NotFoundError: class NotFoundError extends Error {},
  NotEnoughSpaceError: class NotEnoughSpaceError extends Error {},
  TemplateError: class TemplateError extends Error {},
  InvalidArgumentError: class InvalidArgumentError extends Error {},
  TimeoutError: class TimeoutError extends Error {},
  SandboxError: class SandboxError extends Error {},
  RateLimitError: class RateLimitError extends Error {},
  CommandExitError: class CommandExitError extends Error {
    exitCode: number;
    constructor(msg = "exit", exitCode = 1) {
      super(msg);
      this.exitCode = exitCode;
    }
  },
  Sandbox: class {},
}));

// Same for the caido-proxy and proxy-manager imports that would drag in
// Convex/network deps during this unit test.
jest.mock("../utils/caido-proxy", () => ({
  getCaidoConfig: () => ({}),
  buildCaidoProxyEnvVars: () => undefined,
}));
jest.mock("../utils/proxy-manager", () => ({
  ensureCaido: async () => undefined,
}));

jest.mock("../utils/sandbox-health", () => ({
  waitForSandboxReady: jest.fn(async () => undefined),
  getSandboxDiagnostics: jest.fn(async () => "healthy"),
}));
jest.mock("../utils/pid-discovery", () => ({
  findProcessPid: jest.fn(async () => null),
}));
import { createRunTerminalCmd } from "../run-terminal-cmd";
import {
  AuthenticationError,
  NotFoundError,
  NotEnoughSpaceError,
  TemplateError,
  InvalidArgumentError,
  TimeoutError,
} from "../utils/e2b-errors";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PtyHandle } from "../utils/e2b-pty-adapter";
import {
  PtySessionManager,
  MAX_CONCURRENT_PTYS_PER_CHAT,
} from "../utils/pty-session-manager";

// ── Mock hybrid-sandbox-manager so we can return a fake sandbox ──────
jest.mock("../utils/e2b-pty-adapter", () => {
  const actual = jest.requireActual("../utils/e2b-pty-adapter");
  return {
    ...actual,
    // Overridden per test by assigning to `mockCreateHandle`
    createE2BPtyHandle: jest.fn(),
  };
});

import { createE2BPtyHandle } from "../utils/e2b-pty-adapter";
const mockCreateE2BPtyHandle = createE2BPtyHandle as jest.MockedFunction<
  typeof createE2BPtyHandle
>;

jest.mock("../utils/centrifugo-pty-adapter", () => ({
  createCentrifugoPtyHandle: jest.fn(),
}));

import { createCentrifugoPtyHandle } from "../utils/centrifugo-pty-adapter";
const mockCreateCentrifugoPtyHandle =
  createCentrifugoPtyHandle as jest.MockedFunction<
    typeof createCentrifugoPtyHandle
  >;

// ── Fake PTY handle factory ──────────────────────────────────────────

interface FakeHandle extends PtyHandle {
  emit: (bytes: Uint8Array) => void;
  sendInputCalls: Uint8Array[];
  killed: boolean;
  resolveExit: (code: number | null) => void;
}

function makeFakeHandle(pid = 4242): FakeHandle {
  const listeners = new Set<(bytes: Uint8Array) => void>();
  let resolveExit: (v: { exitCode: number | null }) => void;
  const exited = new Promise<{ exitCode: number | null }>((r) => {
    resolveExit = r;
  });
  const sendInputCalls: Uint8Array[] = [];

  const handle: FakeHandle = {
    pid,
    sendInput: jest.fn(async (bytes: Uint8Array) => {
      sendInputCalls.push(new Uint8Array(bytes));
    }) as unknown as PtyHandle["sendInput"],
    resize: jest.fn(async () => undefined) as unknown as PtyHandle["resize"],
    kill: jest.fn(async () => {
      handle.killed = true;
      resolveExit({ exitCode: 0 });
    }) as unknown as PtyHandle["kill"],
    onData: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    exited,
    // instrumentation
    emit: (bytes: Uint8Array) => {
      for (const l of Array.from(listeners)) l(bytes);
    },
    sendInputCalls,
    killed: false,
    resolveExit: (code: number | null) => resolveExit({ exitCode: code }),
  };
  return handle;
}

// ── Fake sandbox that passes isE2BSandbox (has `jupyterUrl`) ─────────

function makeFakeE2BSandbox() {
  return {
    jupyterUrl: "http://fake",
    commands: { run: jest.fn() },
  };
}

// ── Context factory ──────────────────────────────────────────────────

function makeContext(opts: {
  sandbox: unknown | null;
  ptySessionManager?: PtySessionManager;
  chatId?: string;
}) {
  const writerWrites: unknown[] = [];
  const writer = {
    write: (p: unknown) => {
      writerWrites.push(p);
    },
  } as unknown as import("ai").UIMessageStreamWriter;

  const sandboxManager = {
    getSandbox: jest.fn(async () => ({ sandbox: opts.sandbox })),
    setSandbox: jest.fn(),
    getSandboxType: jest.fn(),
    getSandboxInfo: jest.fn(() => null),
    getEffectivePreference: jest.fn(() => "e2b"),
    recordHealthFailure: jest.fn(() => false),
    resetHealthFailures: jest.fn(),
    isSandboxUnavailable: jest.fn(() => false),
    consumeFallbackInfo: jest.fn(() => null),
  };

  const ptySessionManager = opts.ptySessionManager ?? new PtySessionManager();

  // Match the real `isE2BSandbox` discriminator from sandbox-types.ts:
  //   - reject if sandboxKind === "centrifugo" (Centrifugo mock)
  //   - accept only if `jupyterUrl` (string) OR `pty` (object) is present
  //   - reject partial mocks lacking both (treated as non-E2B)
  const context = {
    sandboxManager,
    writer,
    userLocation: {} as never,
    todoManager: {} as never,
    userID: "u1",
    chatId: opts.chatId ?? "chat-1",
    fileAccumulator: {} as never,
    backgroundProcessTracker: {} as never,
    ptySessionManager,
    mode: "agent",
    isE2BSandbox: (s: unknown) => {
      if (!s || typeof s !== "object") return false;
      if ((s as { sandboxKind?: unknown }).sandboxKind === "centrifugo")
        return false;
      const sb = s as { jupyterUrl?: unknown; pty?: unknown };
      return typeof sb.jupyterUrl === "string" || typeof sb.pty === "object";
    },
    guardrailsConfig: undefined,
    caidoEnabled: false,
  } as unknown as import("@/types").ToolContext;

  return { context, writerWrites, sandboxManager, ptySessionManager };
}

describe("security command duration guidance", () => {
  it("reserves time for reporting and verifies timed-out commands before retrying", () => {
    const { context } = makeContext({ sandbox: null });
    context.purpose = "security";
    const description = createRunTerminalCmd(context).description!;
    expect(description).not.toContain("under seven minutes");
    expect(description).toContain("remaining request budget");
    expect(description).toContain("leave time to report");
    expect(description).toContain("may still be running");
    expect(description).toContain("verify its state before retrying");
  });
});

// Helper: invoke the tool.execute with given args/options.
async function runTool(
  tool: ReturnType<typeof createRunTerminalCmd>,
  input: Record<string, unknown>,
) {
  const execute = (
    tool as unknown as {
      execute: (i: unknown, o: unknown) => Promise<unknown>;
    }
  ).execute;
  return execute(input, {
    toolCallId: "call-1",
    abortSignal: undefined,
    messages: [],
  });
}

describe("sandbox health failures preserve the workspace", () => {
  test("an unavailable workspace does not claim the unstarted command exited", async () => {
    const sandbox = {
      jupyterUrl: "https://existing.test",
      kill: jest.fn(),
      commands: { run: jest.fn() },
    };
    const { context, sandboxManager } = makeContext({ sandbox });
    sandboxManager.isSandboxUnavailable.mockReturnValue(true);
    const result = await runTool(createRunTerminalCmd(context), {
      command: "echo test",
      brief: "Check workspace",
    });
    expect(result).toMatchObject({
      result: { exitCode: null, outcome: "not_started", retryable: false },
    });
    expect(sandbox.commands.run).not.toHaveBeenCalled();
    expect(sandbox.kill).not.toHaveBeenCalled();
    expect(sandboxManager.setSandbox).not.toHaveBeenCalled();
  });
  test.each([
    new AuthenticationError("rejected"),
    new NotFoundError("missing"),
    new NotEnoughSpaceError("full"),
    new TemplateError("incompatible"),
    new InvalidArgumentError("invalid"),
    new TimeoutError("sandbox timeout"),
  ])(
    "does not tell the agent to retry an unchanged permanent readiness failure: %s",
    async (error) => {
      const { waitForSandboxReady } = await import("../utils/sandbox-health");
      jest.mocked(waitForSandboxReady).mockRejectedValueOnce(error);
      const sandbox = {
        jupyterUrl: "https://existing.test",
        kill: jest.fn(),
        commands: { run: jest.fn() },
      };
      const { context, sandboxManager } = makeContext({ sandbox });
      const result = await runTool(createRunTerminalCmd(context), {
        command: "printf saved >> work.txt",
        brief: "Update existing work",
      });
      expect(result).toMatchObject({
        result: {
          exitCode: null,
          outcome: "not_started",
          retryable: false,
        },
      });
      expect(sandbox.commands.run).not.toHaveBeenCalled();
      expect(sandbox.kill).not.toHaveBeenCalled();
      expect(sandboxManager.setSandbox).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toMatch(
        /created automatically|delete the sandbox/i,
      );
    },
  );

  test("a failed readiness probe never kills or replaces the workspace or dispatches the command", async () => {
    const { waitForSandboxReady } = await import("../utils/sandbox-health");
    const readiness = jest.mocked(waitForSandboxReady);
    readiness.mockRejectedValueOnce(new Error("temporary health API timeout"));
    const sandbox = {
      jupyterUrl: "https://existing.test",
      kill: jest.fn(async () => true),
      commands: { run: jest.fn() },
    };
    const { context, sandboxManager } = makeContext({ sandbox });
    const result = await runTool(createRunTerminalCmd(context), {
      command: "printf saved >> work.txt",
      brief: "Update existing work",
    });
    expect(sandbox.kill).not.toHaveBeenCalled();
    expect(sandboxManager.setSandbox).not.toHaveBeenCalled();
    expect(sandboxManager.getSandbox).toHaveBeenCalledTimes(1);
    expect(sandbox.commands.run).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      result: {
        exitCode: null,
        outcome: "not_started",
        retryable: true,
      },
    });
  });
});

describe("run_terminal_cmd — PTY action dispatch", () => {
  beforeEach(() => {
    mockCreateE2BPtyHandle.mockReset();
    mockCreateCentrifugoPtyHandle.mockReset();
  });

  test.each([false, true])(
    "does not replay a local command after a lost result (background=%s)",
    async (isBackground) => {
      const run = jest
        .fn()
        // The remote process may already have started before this ACK is lost.
        .mockRejectedValueOnce(
          new Error("Failed to publish command: acknowledgement lost"),
        )
        .mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, pid: 42 });
      const { context } = makeContext({
        sandbox: {
          sandboxKind: "centrifugo",
          isWindows: () => false,
          commands: { run },
        },
      });
      context.backgroundProcessTracker = {
        addProcess: jest.fn(),
      } as unknown as typeof context.backgroundProcessTracker;

      const result = (await runTool(createRunTerminalCmd(context), {
        command: "printf x >> /tmp/operation-count",
        brief: "perform one operation",
        is_background: isBackground,
        timeout: 5,
      })) as {
        result: { error?: string; exitCode?: number | null; outcome?: string };
      };

      expect(run).toHaveBeenCalledTimes(1);
      expect(result.result.exitCode).toBeNull();
      expect(result.result.outcome).toBe("unknown");
      expect(result.result.error).toMatch(/may already have (started|run)/i);
      expect(result.result.error).toMatch(/do not.*repeat/i);
      expect(
        context.backgroundProcessTracker.addProcess,
      ).not.toHaveBeenCalled();
    },
  );

  test("sealed execution cannot start a late foreground cloud command", async () => {
    const run = jest.fn(async () => ({
      pid: 8080,
      kill: async () => true,
      wait: async () => ({ exitCode: 0 }),
    }));
    const manager = new PtySessionManager();
    const { context } = makeContext({
      sandbox: { jupyterUrl: "http://fake", commands: { run } },
      ptySessionManager: manager,
    });
    await manager.withConfirmedScope("closed", () =>
      manager.closeAllConfirmed("chat-1"),
    );
    await manager.withConfirmedScope("closed", () =>
      runTool(createRunTerminalCmd(context), {
        command: "one operation",
        brief: "late command",
      }),
    );
    expect(run).not.toHaveBeenCalled();
    manager.releaseConfirmedScope("closed");
  });

  test("successful preview background server survives foreground cleanup", async () => {
    const kill = jest.fn(async () => true);
    const wait = jest.fn();
    const run = jest.fn(async () => ({ pid: 8080, kill, wait }));
    const manager = new PtySessionManager();
    const { context } = makeContext({
      sandbox: { jupyterUrl: "http://fake", commands: { run } },
      ptySessionManager: manager,
    });
    context.backgroundProcessTracker = {
      addProcess: jest.fn(),
    } as unknown as typeof context.backgroundProcessTracker;
    const result = (await manager.withConfirmedScope("preview-owner", () =>
      runTool(createRunTerminalCmd(context), {
        command: "npm run dev",
        brief: "start preview",
        is_background: true,
      }),
    )) as { result: { pid: number } };
    expect(result.result.pid).toBe(8080);
    await manager.withConfirmedScope("preview-owner", () =>
      manager.closeAllConfirmed("chat-1"),
    );
    manager.releaseConfirmedScope("preview-owner");
    expect(kill).not.toHaveBeenCalled();
    expect(wait).not.toHaveBeenCalled();
    expect(context.backgroundProcessTracker.addProcess).toHaveBeenCalledWith(
      8080,
      "npm run dev",
      expect.anything(),
    );
  });

  test.each([-1, 2, 130])(
    "preserves a failed local background start (exitCode=%s)",
    async (exitCode) => {
      const run = jest.fn().mockResolvedValue({
        stdout: "",
        stderr: "The process could not start",
        exitCode,
      });
      const { context, writerWrites } = makeContext({
        sandbox: {
          sandboxKind: "centrifugo",
          isWindows: () => false,
          commands: { run },
        },
      });
      context.backgroundProcessTracker = {
        addProcess: jest.fn(),
      } as unknown as typeof context.backgroundProcessTracker;

      const result = (await runTool(createRunTerminalCmd(context), {
        command: "start-task",
        brief: "start a background task",
        is_background: true,
      })) as { result: { exitCode?: number; error?: string; output?: string } };

      expect(run).toHaveBeenCalledTimes(1);
      expect(result.result.exitCode).toBe(exitCode);
      expect(result.result.error).toBe("The process could not start");
      expect(result.result.output).not.toMatch(/Background process started/i);
      expect(JSON.stringify(writerWrites)).not.toMatch(
        /Background process started/i,
      );
      expect(
        context.backgroundProcessTracker.addProcess,
      ).not.toHaveBeenCalled();
    },
  );

  test("regression: legacy schema {command, brief, is_background, timeout} still works", async () => {
    // Use a non-E2B sandbox (sandboxKind !== "centrifugo" is NOT enough after
    // the isE2BSandbox hardening — a sandbox with sandboxKind: "centrifugo" is
    // explicitly non-E2B and bypasses the E2B health check entirely).
    const nonE2B = {
      sandboxKind: "centrifugo" as const,
      isWindows: () => false,
      commands: {
        // The tool's handler reads output via the onStdout callback (not from
        // the resolved value), so we feed the mock stream through there.
        run: jest.fn(
          async (_cmd: string, opts?: { onStdout?: (s: string) => void }) => {
            opts?.onStdout?.("hi\n");
            return { stdout: "hi\n", stderr: "", exitCode: 0 };
          },
        ),
      },
    };

    const { context } = makeContext({ sandbox: nonE2B });
    const tool = createRunTerminalCmd(context);

    const result = (await runTool(tool, {
      command: "echo hi",
      brief: "say hi",
      is_background: false,
      timeout: 5,
    })) as {
      result: {
        output: string;
        exitCode: number | null;
        session?: string;
        pid?: number;
      };
    };

    expect(result).toHaveProperty("result");
    expect(typeof result.result.output).toBe("string");
    expect(result.result.output).toContain("hi");
    // Foreground non-background returns an exitCode (may be null on timeout paths,
    // but here the mock resolves with 0).
    expect(result.result.exitCode).toBe(0);
    // The legacy foreground path must NOT return interactive-PTY fields.
    expect(result.result.session).toBeUndefined();
    expect(result.result.pid).toBeUndefined();
    // commands.run was invoked exactly once with the command.
    expect(nonE2B.commands.run).toHaveBeenCalledTimes(1);
    expect(
      (nonE2B.commands.run as jest.Mock).mock.calls[0][0] as string,
    ).toContain("echo hi");
    // E5: the non-interactive result carries durable evidence timing.
    const timed = result.result as unknown as {
      startedAt?: number;
      endedAt?: number;
      durationMs?: number;
    };
    expect(typeof timed.startedAt).toBe("number");
    expect(typeof timed.endedAt).toBe("number");
    expect(typeof timed.durationMs).toBe("number");
    expect(timed.durationMs).toBeGreaterThanOrEqual(0);
    expect(timed.endedAt! - timed.startedAt!).toBe(timed.durationMs);
  });

  test("schema defaults action=exec and interactive=false when omitted", async () => {
    // A bare `{command, brief}` must flow through the legacy path
    // (action defaults to "exec", interactive to false) — no session/pid.
    const nonE2B = {
      sandboxKind: "centrifugo" as const,
      isWindows: () => false,
      commands: {
        run: jest
          .fn()
          .mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
      },
    };
    const { context } = makeContext({ sandbox: nonE2B });
    const tool = createRunTerminalCmd(context);
    const result = (await runTool(tool, {
      command: "true",
      brief: "default dispatch",
    })) as { result: { session?: string; exitCode: number | null } };
    expect(result.result.session).toBeUndefined();
    expect(result.result.exitCode).toBe(0);
  });

  test("exec + interactive=true on Centrifugo sandbox invokes createCentrifugoPtyHandle", async () => {
    const fakeHandle = makeFakeHandle();
    mockCreateCentrifugoPtyHandle.mockResolvedValue(fakeHandle);

    const centrifugoSandbox = {
      sandboxKind: "centrifugo" as const,
      commands: { run: jest.fn() },
      getUserId: () => "user-1",
      getConnectionId: () => "conn-1",
      getConfig: () => ({ wsUrl: "ws://fake", tokenSecret: "secret" }),
      isWindows: () => false,
    };
    const { context } = makeContext({ sandbox: centrifugoSandbox });
    const tool = createRunTerminalCmd(context);

    // Emit some data so waitForOutput resolves
    setTimeout(() => {
      fakeHandle.emit(new TextEncoder().encode("$ top\n"));
      fakeHandle.resolveExit(0);
    }, 50);

    const result = (await runTool(tool, {
      action: "exec",
      command: "top",
      brief: "x",
      is_background: false,
      interactive: true,
      timeout: 0.2,
    })) as { result: { output?: string; session?: string; pid?: number } };

    expect(mockCreateCentrifugoPtyHandle).toHaveBeenCalledTimes(1);
    expect(result.result.session).toBeDefined();
    expect(result.result.pid).toBe(fakeHandle.pid);
  });

  test("exec + interactive=true on Centrifugo sandbox does NOT send initial command via sendInput", async () => {
    const fakeHandle = makeFakeHandle();
    mockCreateCentrifugoPtyHandle.mockResolvedValue(fakeHandle);

    const centrifugoSandbox = {
      sandboxKind: "centrifugo" as const,
      commands: { run: jest.fn() },
      getUserId: () => "user-1",
      getConnectionId: () => "conn-1",
      getConfig: () => ({ wsUrl: "ws://fake", tokenSecret: "secret" }),
      isWindows: () => false,
    };
    const { context } = makeContext({ sandbox: centrifugoSandbox });
    const tool = createRunTerminalCmd(context);

    setTimeout(() => {
      fakeHandle.emit(new TextEncoder().encode("output\n"));
      fakeHandle.resolveExit(0);
    }, 50);

    await runTool(tool, {
      action: "exec",
      command: "top",
      brief: "x",
      is_background: false,
      interactive: true,
      timeout: 0.2,
    });

    // Centrifugo PTY sends the command in pty_create, so sendInput
    // must NOT be called with the initial "command\n".
    expect(fakeHandle.sendInputCalls).toHaveLength(0);
  });

  test("exec + interactive=true on E2B creates a session and returns {session, pid, output}", async () => {
    const e2b = makeFakeE2BSandbox();
    const handle = makeFakeHandle(9999);
    mockCreateE2BPtyHandle.mockImplementation(async () => handle);

    const { context, ptySessionManager } = makeContext({ sandbox: e2b });
    const tool = createRunTerminalCmd(context);

    // Emit some output shortly after the command is sent so the test
    // captures it before the timeout fires.
    const p = runTool(tool, {
      action: "exec",
      command: "ls",
      brief: "list",
      is_background: false,
      interactive: true,
      timeout: 1,
    });
    // Let the `exec` path send the command, then emit output.
    await new Promise((r) => setTimeout(r, 0));
    handle.emit(new TextEncoder().encode("file1\nfile2\n"));

    const result = (await p) as {
      result: { session: string; pid: number; output: string };
    };

    expect(result.result.pid).toBe(9999);
    expect(typeof result.result.session).toBe("string");
    expect(result.result.output).toContain("file1");
    // Command was sent through as initial input
    expect(handle.sendInputCalls.length).toBeGreaterThanOrEqual(1);
    expect(new TextDecoder().decode(handle.sendInputCalls[0])).toBe("ls\n");
    // Session is tracked
    expect(
      ptySessionManager.get("chat-1", result.result.session),
    ).toBeDefined();
  });

  test.each([false, true])(
    "a canceled pending PTY sends no command and leaves no session (cleanup %s)",
    async (cleanup) => {
      const { context, ptySessionManager } = makeContext({
        sandbox: makeFakeE2BSandbox(),
      });
      const handle = makeFakeHandle();
      const stop = new AbortController();
      let started!: () => void;
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      let release!: (handle: PtyHandle) => void;
      const pending = new Promise<PtyHandle>((resolve) => {
        release = resolve;
      });
      mockCreateE2BPtyHandle.mockImplementation(() => {
        started();
        return pending;
      });
      const result = (createRunTerminalCmd(context) as any).execute(
        {
          command: "must-not-run",
          brief: "run",
          interactive: true,
          timeout: 1,
        },
        { toolCallId: "canceled-pty", abortSignal: stop.signal, messages: [] },
      );
      await entered;
      let settled = false;
      void result.then(() => {
        settled = true;
      });
      stop.abort();
      if (cleanup) await ptySessionManager.closeAll("chat-1");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(settled).toBe(true);
      release(handle);
      const output = await result;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(handle.sendInputCalls).toEqual([]);
      expect(handle.killed).toBe(true);
      expect(ptySessionManager.list("chat-1")).toEqual([]);
      expect(output.result).not.toHaveProperty("session");
    },
  );

  test("abort after registration closes the session before initial input", async () => {
    const { context, ptySessionManager } = makeContext({
      sandbox: makeFakeE2BSandbox(),
    });
    const handle = makeFakeHandle();
    const stop = new AbortController();
    mockCreateE2BPtyHandle.mockResolvedValue(handle);
    const create = ptySessionManager.create.bind(ptySessionManager);
    jest
      .spyOn(ptySessionManager, "create")
      .mockImplementation(async (...args) => {
        const session = await create(...args);
        stop.abort();
        return session;
      });
    const result = await (createRunTerminalCmd(context) as any).execute(
      { command: "must-not-run", brief: "run", interactive: true, timeout: 1 },
      {
        toolCallId: "registered-pty-abort",
        abortSignal: stop.signal,
        messages: [],
      },
    );
    expect(handle.sendInputCalls).toEqual([]);
    expect(handle.killed).toBe(true);
    expect(ptySessionManager.list("chat-1")).toEqual([]);
    expect(result.result).not.toHaveProperty("session");
  });

  test("an already-aborted interactive request never starts a sandbox or PTY", async () => {
    const { context, sandboxManager } = makeContext({
      sandbox: makeFakeE2BSandbox(),
    });
    const stop = new AbortController();
    stop.abort();
    const getSandbox = jest.spyOn(sandboxManager, "getSandbox");
    await (createRunTerminalCmd(context) as any).execute(
      { command: "must-not-run", brief: "run", interactive: true },
      {
        toolCallId: "already-canceled-pty",
        abortSignal: stop.signal,
        messages: [],
      },
    );
    expect(getSandbox).not.toHaveBeenCalled();
    expect(mockCreateE2BPtyHandle).not.toHaveBeenCalled();
  });

  // ── FIX 4 — factory is not invoked when cap is already hit ───────────
  test("ptySessionManager.create does NOT invoke factory when concurrency cap is hit", async () => {
    const e2b = makeFakeE2BSandbox();

    const { context, ptySessionManager } = makeContext({ sandbox: e2b });
    // Seed the manager with MAX_CONCURRENT_PTYS_PER_CHAT existing sessions
    // against the same chat so the next create must reject.
    for (let i = 0; i < MAX_CONCURRENT_PTYS_PER_CHAT; i++) {
      const h = makeFakeHandle(i + 1);
      await ptySessionManager.create("chat-1", {
        createHandle: async () => h,
        cols: 80,
        rows: 24,
      });
    }

    // Now attempt one over the cap through the tool — factory must NOT be invoked.
    const factory = jest.fn();
    mockCreateE2BPtyHandle.mockImplementation(factory as never);

    const result = (await runTool(tool(context), {
      action: "exec",
      command: "sh",
      brief: "x",
      is_background: false,
      interactive: true,
    })) as { result: { error?: string } };

    expect(factory).not.toHaveBeenCalled();
    expect(result.result.error).toMatch(/MAX_CONCURRENT_PTYS_PER_CHAT/);

    function tool(ctx: Parameters<typeof createRunTerminalCmd>[0]) {
      return createRunTerminalCmd(ctx);
    }
  });

  test("if createHandle factory throws, no session is stored", async () => {
    const e2b = makeFakeE2BSandbox();
    mockCreateE2BPtyHandle.mockImplementation(async () => {
      throw new Error("spawn failed");
    });
    const { context, ptySessionManager } = makeContext({ sandbox: e2b });
    const tool = createRunTerminalCmd(context);

    const result = (await runTool(tool, {
      action: "exec",
      command: "sh",
      brief: "x",
      is_background: false,
      interactive: true,
    })) as { result: { error?: string } };

    expect(result.result.error).toMatch(/spawn failed/);
    expect(ptySessionManager.list("chat-1")).toEqual([]);
  });
});

describe("project checkout working directory", () => {
  test.each([false, true])(
    "executes a real command in the checkout unless cwd is explicit (%s)",
    async (explicit) => {
      const workspace = realpathSync(
        mkdtempSync(join(tmpdir(), "rift-command-cwd-")),
      );
      const checkout = join(workspace, "repo");
      const selected = explicit ? join(workspace, "explicit") : checkout;
      mkdirSync(checkout);
      if (explicit) mkdirSync(selected);
      const run = jest.fn(async (command, options) => ({
        pid: 4242,
        wait: async () => ({
          stdout: execFileSync("/bin/sh", ["-c", command], {
            cwd: options.cwd,
            encoding: "utf8",
          }),
          stderr: "",
          exitCode: 0,
        }),
      }));
      const { context } = makeContext({ sandbox: { commands: { run } } });
      const tool = createRunTerminalCmd(context);
      context.projectWorkingDirectory = checkout;
      try {
        const result = (await runTool(tool, {
          command: "pwd",
          brief: "Inspect working directory",
          ...(explicit ? { cwd: selected } : {}),
        })) as any;
        expect(result.result.exitCode).toBe(0);
        expect(result.result.output.trim()).toBe(selected);
        expect(run).toHaveBeenCalledTimes(1);
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    },
  );

  test("starts cloud interactive PTYs in the selected checkout", async () => {
    const handle = makeFakeHandle();
    handle.resolveExit(0);
    mockCreateE2BPtyHandle.mockResolvedValue(handle);
    const { context, ptySessionManager } = makeContext({
      sandbox: makeFakeE2BSandbox(),
    });
    context.projectWorkingDirectory = "/home/user/selected-repo";
    try {
      await runTool(createRunTerminalCmd(context), {
        command: "pwd",
        brief: "Inspect checkout",
        interactive: true,
        timeout: 0.001,
      });
      expect(mockCreateE2BPtyHandle).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ cwd: "/home/user/selected-repo" }),
      );
    } finally {
      await ptySessionManager.closeAll("chat-1");
    }
  });
});

describe("foreground command execution and observation deadlines", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const makeBackend = (kind: "local" | "cloud", run: jest.Mock) => {
    if (kind === "local")
      return {
        sandboxKind: "centrifugo",
        isWindows: () => false,
        commands: { run },
      };
    const completion = run.getMockImplementation()!;
    run.mockImplementation((command, options) => {
      const waiting = completion(command, options);
      return Promise.resolve({
        pid: 4242,
        kill: jest.fn(async () => true),
        wait: () => waiting,
      });
    });
    return { jupyterUrl: "http://fake", commands: { run } };
  };

  test("cloud Stop cannot confirm cleanup until the original foreground command exits", async () => {
    let exit!: (value: {
      exitCode: number;
      stdout: string;
      stderr: string;
    }) => void;
    const completion = new Promise<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>((resolve) => {
      exit = resolve;
    });
    const kill = jest.fn(async () => true);
    const wait = jest.fn(() => completion);
    const run = jest.fn(async () => ({ pid: 4242, kill, wait }));
    const manager = new PtySessionManager();
    const { context } = makeContext({
      sandbox: { jupyterUrl: "http://fake", commands: { run } },
      ptySessionManager: manager,
    });
    const controller = new AbortController();
    const pending = manager.withConfirmedScope("build", () =>
      (createRunTerminalCmd(context) as any).execute(
        { command: "one operation", brief: "one operation", timeout: 630 },
        {
          toolCallId: "confirmed-command",
          abortSignal: controller.signal,
          messages: [],
        },
      ),
    );
    await jest.advanceTimersByTimeAsync(0);
    controller.abort();
    expect((await pending).result.exitCode).toBe(130);
    let closed = false;
    const cleanup = manager
      .withConfirmedScope("build", () => manager.closeAllConfirmed("chat-1"))
      .then(() => {
        closed = true;
      });
    await jest.advanceTimersByTimeAsync(3000);
    expect(closed).toBe(false);
    exit({ exitCode: 130, stdout: "", stderr: "" });
    await cleanup;
    expect(closed).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(
      "one operation",
      expect.objectContaining({ signal: undefined }),
    );
    expect(wait).toHaveBeenCalledTimes(1);
    manager.releaseConfirmedScope("build");
  });

  test.each(["local", "cloud"] as const)(
    "%s honors 630 seconds and waits for its real exit",
    async (kind) => {
      const run = jest.fn(
        (_command, options) =>
          new Promise((resolve) => {
            setTimeout(() => options.onStdout?.("at old deadline\n"), 600000);
            setTimeout(
              () => resolve({ stdout: "complete\n", stderr: "", exitCode: 0 }),
              630000,
            );
          }),
      );
      const { context } = makeContext({ sandbox: makeBackend(kind, run) });
      let settled = false;
      const pending = runTool(createRunTerminalCmd(context), {
        command: "one-side-effect",
        brief: "long command",
        timeout: 630,
      }).then((value) => {
        settled = true;
        return value as any;
      });
      await jest.advanceTimersByTimeAsync(0);
      expect(run.mock.calls[0][1].timeoutMs).toBe(
        kind === "cloud" ? 645000 : 630000,
      );
      await jest.advanceTimersByTimeAsync(600000);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(30000);
      expect((await pending).result.exitCode).toBe(0);
      expect(run).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  test("a timeout exit delivered after the execution deadline remains authoritative", async () => {
    const run = jest.fn(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ stdout: "partial", stderr: "", exitCode: 124 }),
            634000,
          ),
        ),
    );
    const { context } = makeContext({ sandbox: makeBackend("local", run) });
    const pending = runTool(createRunTerminalCmd(context), {
      command: "slow",
      brief: "wait",
      timeout: 630,
    });
    await jest.advanceTimersByTimeAsync(634000);
    expect(((await pending) as any).result.exitCode).toBe(124);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test.each(["local", "cloud"] as const)(
    "%s never repeats after an observation cutoff and late transport failure",
    async (kind) => {
      const run = jest.fn(
        () =>
          new Promise((_resolve, reject) =>
            setTimeout(
              () => reject(new Error("transport timeout; outcome unknown")),
              610000,
            ),
          ),
      );
      const { context } = makeContext({ sandbox: makeBackend(kind, run) });
      const pending = runTool(createRunTerminalCmd(context), {
        command: "append-once",
        brief: "do one operation",
      });
      await jest.advanceTimersByTimeAsync(60000);
      expect(((await pending) as any).result.exitCode).toBeNull();
      await jest.advanceTimersByTimeAsync(800000);
      expect(run).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  test.each(["local", "cloud"] as const)(
    "%s never repeats an aborted command after a late rejection",
    async (kind) => {
      const controller = new AbortController();
      const run = jest.fn(
        () =>
          new Promise((_resolve, reject) =>
            setTimeout(() => reject(new Error("late timeout")), 610000),
          ),
      );
      const { context } = makeContext({ sandbox: makeBackend(kind, run) });
      const tool = createRunTerminalCmd(context);
      const pending = (tool as any).execute(
        { command: "one-side-effect", brief: "long command", timeout: 630 },
        {
          toolCallId: "abort-long",
          abortSignal: controller.signal,
          messages: [],
        },
      );
      await jest.advanceTimersByTimeAsync(0);
      controller.abort();
      await jest.advanceTimersByTimeAsync(0);
      expect((await pending).result.exitCode).toBe(130);
      if (kind === "cloud")
        expect((await run.mock.results[0].value).kill).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(800000);
      expect(run).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    },
  );
  test.each([false, true])(
    "cloud lost start acknowledgement is unknown and never replayed (background=%s)",
    async (background) => {
      const run = jest
        .fn()
        .mockRejectedValue(new Error("lost start acknowledgement"));
      const { context } = makeContext({
        sandbox: { jupyterUrl: "http://fake", commands: { run } },
      });
      const pending = runTool(createRunTerminalCmd(context), {
        command: "append-once",
        brief: "one operation",
        timeout: 630,
        is_background: background,
      });
      await jest.advanceTimersByTimeAsync(0);
      expect(((await pending) as any).result).toMatchObject({
        exitCode: null,
        outcome: "unknown",
      });
      await jest.advanceTimersByTimeAsync(1800000);
      expect(run).toHaveBeenCalledTimes(1);
    },
  );

  test("cloud abort before the start acknowledgement kills only the late returned handle", async () => {
    let acknowledge!: (value: unknown) => void;
    const run = jest.fn(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    const kill = jest.fn(async () => true),
      wait = jest.fn(async () => ({ exitCode: 130 }));
    const controller = new AbortController();
    const { context } = makeContext({
      sandbox: { jupyterUrl: "http://fake", commands: { run } },
    });
    const pending = (createRunTerminalCmd(context) as any).execute(
      { command: "append-once", brief: "one operation", timeout: 630 },
      {
        toolCallId: "late-start",
        abortSignal: controller.signal,
        messages: [],
      },
    );
    await jest.advanceTimersByTimeAsync(0);
    controller.abort();
    expect((await pending).result.exitCode).toBe(130);
    acknowledge({ pid: 9123, kill, wait });
    await jest.advanceTimersByTimeAsync(0);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("cloud stream failure retains partial output and the original process identity", async () => {
    const run = jest.fn((_command, options) => {
      options.onStdout("already performed one operation\n");
      return Promise.reject(new Error("stream disconnected"));
    });
    const { context } = makeContext({ sandbox: makeBackend("cloud", run) });
    const pending = runTool(createRunTerminalCmd(context), {
      command: "append-once",
      brief: "one operation",
      timeout: 630,
    });
    await jest.advanceTimersByTimeAsync(0);
    const result = ((await pending) as any).result;
    expect(result).toMatchObject({
      exitCode: null,
      outcome: "unknown",
      pid: 4242,
    });
    expect(result.output).toContain("already performed");
    expect(result.error).toMatch(/Do not automatically repeat/);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("missing foreground exit never becomes success", async () => {
    const run = jest
      .fn()
      .mockResolvedValue({ stdout: "partial", stderr: "", exitCode: null });
    const { context } = makeContext({ sandbox: makeBackend("local", run) });
    const result = (await runTool(createRunTerminalCmd(context), {
      command: "one-operation",
      brief: "run",
      timeout: 630,
    })) as any;
    expect(result.result).toMatchObject({ exitCode: null, outcome: "unknown" });
    expect(run).toHaveBeenCalledTimes(1);
  });
  test("cloud process exit errors keep their actual nonzero code and output", async () => {
    const { CommandExitError } = jest.requireMock("@e2b/code-interpreter");
    const run = jest.fn((_command, options) => {
      options.onStdout("before exit\n");
      return Promise.reject(new CommandExitError("process exited", 7));
    });
    const { context } = makeContext({ sandbox: makeBackend("cloud", run) });
    const result = (await runTool(createRunTerminalCmd(context), {
      command: "exit-seven",
      brief: "test exit",
      timeout: 630,
    })) as any;
    expect(result.result.exitCode).toBe(7);
    expect(result.result.output).toContain("before exit");
    expect(run).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("abort before admission starts no process", async () => {
    const controller = new AbortController();
    controller.abort();
    const run = jest.fn();
    const { context } = makeContext({ sandbox: makeBackend("local", run) });
    const result = await (createRunTerminalCmd(context) as any).execute(
      { command: "one-operation", brief: "run", timeout: 630 },
      {
        toolCallId: "already-aborted",
        abortSignal: controller.signal,
        messages: [],
      },
    );
    expect(result.result.exitCode).toBe(130);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("terminal credential origin", () => {
  const savedKey = process.env.SHODAN_API_KEY;
  afterEach(() => {
    if (savedKey === undefined) delete process.env.SHODAN_API_KEY;
    else process.env.SHODAN_API_KEY = savedKey;
  });
  test.each([true, false])(
    "late command retains original credential presence (%s)",
    async (present) => {
      if (present) process.env.SHODAN_API_KEY = "fixture-origin-a";
      else delete process.env.SHODAN_API_KEY;
      const run = jest
        .fn()
        .mockResolvedValue({ stdout: "done", stderr: "", exitCode: 0 });
      const { context } = makeContext({
        sandbox: {
          sandboxKind: "centrifugo",
          isWindows: () => false,
          commands: { run },
        },
      });
      const tool = createRunTerminalCmd(context);
      process.env.SHODAN_API_KEY = "fixture-origin-b";
      const result = await runTool(tool, {
        command: "echo fixture",
        brief: "fixture",
        timeout: 5,
      });
      expect(run).toHaveBeenCalledTimes(1);
      expect(run.mock.calls[0][1].envVars?.SHODAN_API_KEY).toBe(
        present ? "fixture-origin-a" : undefined,
      );
      expect(JSON.stringify(result)).not.toContain("fixture-origin-");
    },
  );
  test.each(["cloud", "local"])(
    "late %s PTY receives the original credentials",
    async (kind) => {
      process.env.SHODAN_API_KEY = "fixture-origin-a";
      const handle = makeFakeHandle();
      mockCreateE2BPtyHandle.mockResolvedValue(handle);
      mockCreateCentrifugoPtyHandle.mockResolvedValue(handle);
      const sandbox =
        kind === "cloud"
          ? makeFakeE2BSandbox()
          : {
              sandboxKind: "centrifugo",
              commands: { run: jest.fn() },
              isWindows: () => false,
            };
      const { context, ptySessionManager } = makeContext({ sandbox });
      const tool = createRunTerminalCmd(context);
      process.env.SHODAN_API_KEY = "fixture-origin-b";
      setTimeout(() => {
        handle.emit(new TextEncoder().encode("fixture output"));
        handle.resolveExit(0);
      }, 10);
      try {
        await runTool(tool, {
          command: "echo fixture",
          brief: "fixture",
          interactive: true,
          timeout: 0.1,
        });
        const mock =
          kind === "cloud"
            ? mockCreateE2BPtyHandle
            : mockCreateCentrifugoPtyHandle;
        expect(mock.mock.calls.at(-1)?.[1].envs?.SHODAN_API_KEY).toBe(
          "fixture-origin-a",
        );
      } finally {
        await ptySessionManager.closeAll("chat-1");
      }
    },
  );
});

describe("foreground durable journal integration", () => {
  const journalModule = jest.requireMock<
    typeof import("@/lib/agent/remote-command-journal")
  >("@/lib/agent/remote-command-journal");
  afterEach(() => jest.restoreAllMocks());
  function journal() {
    return {
      command: "wrapped-command",
      started: jest.fn(async () => ({}) as any),
      exited: jest.fn(async () => {}),
      notStarted: jest.fn(async () => {}),
      stop: jest.fn(async () => {}),
    };
  }
  test("launches the wrapper once and joins the saved exit receipt before cleanup", async () => {
    const receipt = journal();
    jest
      .spyOn(journalModule, "prepareJournaledCommand")
      .mockResolvedValue(receipt);
    const run = jest.fn(async () => ({
      pid: 123,
      kill: jest.fn(),
      wait: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    }));
    const { context, ptySessionManager } = makeContext({
      sandbox: { jupyterUrl: "http://fake", commands: { run } },
    });
    await ptySessionManager.withConfirmedScope("journal-run", async () => {
      await runTool(createRunTerminalCmd(context), {
        command: "original",
        brief: "test",
        timeout: 5,
      });
      await ptySessionManager.closeAllConfirmed("chat-1");
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toBe("wrapped-command");
    expect(receipt.started).toHaveBeenCalledWith(123);
    expect(receipt.exited).toHaveBeenCalledWith(123);
    expect(receipt.notStarted).not.toHaveBeenCalled();
  });
  test("missing cwd fails inside the supervisor and cannot strand cleanup", async () => {
    const { CommandExitError } = jest.requireMock("@e2b/code-interpreter");
    const receipt = journal();
    jest
      .spyOn(journalModule, "prepareJournaledCommand")
      .mockResolvedValue(receipt);
    const run = jest.fn(async () => ({
      pid: 124,
      kill: jest.fn(),
      wait: async () => {
        throw new CommandExitError("cd: no such directory", 1);
      },
    }));
    const { context, ptySessionManager } = makeContext({
      sandbox: { jupyterUrl: "http://fake", commands: { run } },
    });
    await ptySessionManager.withConfirmedScope(
      "journal-missing-cwd",
      async () => {
        await runTool(createRunTerminalCmd(context), {
          command: "printf FIRST; printf SHOULD_NOT_RUN",
          brief: "test",
          timeout: 5,
          cwd: "/code/not-created",
        });
        await ptySessionManager.closeAllConfirmed("chat-1");
      },
    );
    expect(journalModule.prepareJournaledCommand).toHaveBeenCalledWith(
      "cd -- '/code/not-created' || exit $?\nprintf FIRST; printf SHOULD_NOT_RUN",
      expect.anything(),
      undefined,
      expect.any(Number),
    );
    expect(run).toHaveBeenCalledWith(
      "wrapped-command",
      expect.objectContaining({ cwd: undefined }),
    );
    const submitted = jest.mocked(journalModule.prepareJournaledCommand).mock
      .calls[0][0];
    const shell = require("node:child_process").spawnSync(
      "/bin/bash",
      ["-c", submitted],
      { encoding: "utf8" },
    );
    expect(shell.status).not.toBe(0);
    expect(shell.stdout).not.toContain("SHOULD_NOT_RUN");
    expect(receipt.exited).toHaveBeenCalledWith(124);
  });
  test("Stop requests supervisor cleanup instead of killing its PID directly", async () => {
    const receipt = journal(),
      controller = new AbortController();
    let finish!: (value: unknown) => void;
    const completion = new Promise((resolve) => {
      finish = resolve;
    });
    receipt.stop.mockImplementation(async () => {
      finish({ exitCode: 130, stdout: "", stderr: "" });
    });
    jest
      .spyOn(journalModule, "prepareJournaledCommand")
      .mockResolvedValue(receipt);
    const rawKill = jest.fn(async () => true);
    const run = jest.fn(async () => ({
      pid: 123,
      kill: rawKill,
      wait: () => completion,
    }));
    const { context, ptySessionManager } = makeContext({
      sandbox: { jupyterUrl: "http://fake", commands: { run } },
    });
    await ptySessionManager.withConfirmedScope("journal-stop", async () => {
      const pending = (createRunTerminalCmd(context) as any).execute(
        { command: "original", brief: "test", timeout: 5 },
        {
          toolCallId: "supervised-stop",
          messages: [],
          abortSignal: controller.signal,
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      controller.abort();
      await pending;
      await ptySessionManager.closeAllConfirmed("chat-1");
    });
    expect(receipt.stop).toHaveBeenCalledWith(123);
    expect(rawKill).not.toHaveBeenCalled();
    expect(receipt.exited).toHaveBeenCalledWith(123);
  });
  test("does not classify a lost SDK acknowledgment as unsent", async () => {
    const receipt = journal();
    jest
      .spyOn(journalModule, "prepareJournaledCommand")
      .mockResolvedValue(receipt);
    const run = jest.fn(async () => {
      throw new Error("transport lost");
    });
    const { context } = makeContext({
      sandbox: { jupyterUrl: "http://fake", commands: { run } },
    });
    await runTool(createRunTerminalCmd(context), {
      command: "original",
      brief: "test",
      timeout: 5,
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(receipt.notStarted).not.toHaveBeenCalled();
    expect(receipt.exited).not.toHaveBeenCalled();
  });
  test("records unsent proof if Stop wins while the reservation is in flight", async () => {
    const receipt = journal(),
      controller = new AbortController();
    jest
      .spyOn(journalModule, "prepareJournaledCommand")
      .mockImplementation(async () => {
        controller.abort();
        return receipt;
      });
    const run = jest.fn();
    const { context } = makeContext({
      sandbox: { jupyterUrl: "http://fake", commands: { run } },
    });
    await (createRunTerminalCmd(context) as any).execute(
      { command: "original", brief: "test", timeout: 5 },
      {
        toolCallId: "stop-reservation",
        messages: [],
        abortSignal: controller.signal,
      },
    );
    // Tool cancellation may resolve before its internal launch callback settles.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(run).not.toHaveBeenCalled();
    expect(receipt.notStarted).toHaveBeenCalledTimes(1);
  });
});
