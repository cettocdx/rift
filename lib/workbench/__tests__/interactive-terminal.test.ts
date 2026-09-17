import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { Sandbox } from "@e2b/code-interpreter";
import type { PtyHandle } from "@/lib/ai/tools/utils/e2b-pty-adapter";

class TestWorkbenchRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
  }
}

type FakeHandle = PtyHandle & {
  emit(bytes: Uint8Array): void;
  exit(code: number | null): void;
  unsubscribeCalls: jest.Mock<void, []>;
  listenerCount(): number;
  sendInput: jest.Mock<Promise<void>, [Uint8Array]>;
  resize: jest.Mock<Promise<void>, [number, number]>;
  kill: jest.Mock<Promise<void>, []>;
};

function fakeHandle(pid: number): FakeHandle {
  const listeners = new Set<(bytes: Uint8Array) => void>();
  let resolveExit!: (value: { exitCode: number | null }) => void;
  const exited = new Promise<{ exitCode: number | null }>((resolve) => {
    resolveExit = resolve;
  });
  const unsubscribeCalls = jest.fn<void, []>();
  return {
    pid,
    sendInput: jest.fn().mockResolvedValue(undefined),
    resize: jest.fn().mockResolvedValue(undefined),
    kill: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    onData(callback) {
      listeners.add(callback);
      return () => {
        unsubscribeCalls();
        listeners.delete(callback);
      };
    },
    unsubscribeCalls,
    listenerCount: () => listeners.size,
    exited,
    emit(bytes) {
      for (const listener of listeners) listener(bytes);
    },
    exit(exitCode) {
      resolveExit({ exitCode });
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const createdHandle = fakeHandle(4242);
const reconnectedHandle = fakeHandle(4343);
const localHandle = fakeHandle(5151);
const mockCreateHandle = jest.fn().mockResolvedValue(createdHandle);
const mockConnectHandle = jest.fn().mockResolvedValue(reconnectedHandle);
const mockCreateLocalHandle = jest.fn().mockResolvedValue(localHandle);
const mockAssertWorkspaceDirectoryAccess = jest.fn().mockResolvedValue("");
const mockResolveLocalTerminalLaunch = jest.fn((profile: string) => ({
  profile,
  profileAvailable: true,
  executable: `/mock/${profile}`,
  args: [],
}));

let terminal: typeof import("@/lib/workbench/interactive-terminal");

beforeAll(() => {
  if (typeof globalThis.Response === "undefined") {
    class TestResponse {
      readonly body: ReadableStream<Uint8Array> | null;
      readonly status: number;
      readonly headers: Headers;

      constructor(
        body: ReadableStream<Uint8Array> | null,
        init?: ResponseInit,
      ) {
        this.body = body;
        this.status = init?.status ?? 200;
        this.headers = new Headers(init?.headers);
      }
    }
    Object.defineProperty(globalThis, "Response", {
      configurable: true,
      value: TestResponse,
    });
  }
  jest.resetModules();
  jest.doMock("server-only", () => ({}), { virtual: true });
  jest.doMock("@e2b/code-interpreter", () => ({
    CommandExitError: class CommandExitError extends Error {
      exitCode = 1;
    },
  }));
  jest.doMock("@/lib/ai/tools/utils/e2b-pty-adapter", () => ({
    createE2BPtyHandle: mockCreateHandle,
    connectE2BPtyHandle: mockConnectHandle,
  }));
  jest.doMock("@/lib/workbench/local-pty-adapter", () => ({
    createLocalPtyHandle: mockCreateLocalHandle,
    resolveLocalTerminalCwd: (root: string, cwd: string) =>
      cwd ? `${root}/${cwd}` : root,
    resolveLocalTerminalLaunch: mockResolveLocalTerminalLaunch,
  }));
  jest.doMock("@/lib/workbench/workspace-server", () => ({
    WorkbenchRequestError: TestWorkbenchRequestError,
    assertWorkspaceDirectoryAccess: mockAssertWorkspaceDirectoryAccess,
  }));
  terminal =
    require("@/lib/workbench/interactive-terminal") as typeof import("@/lib/workbench/interactive-terminal");
});

function mockSandbox() {
  const run = jest
    .fn()
    .mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
  const list = jest.fn().mockResolvedValue([]);
  const write = jest.fn().mockResolvedValue({});
  const sendInput = jest.fn().mockResolvedValue(undefined);
  const resize = jest.fn().mockResolvedValue(undefined);
  const kill = jest.fn().mockResolvedValue(true);
  return {
    sandbox: {
      commands: { run, list },
      files: { write },
      pty: { sendInput, resize, kill },
    } as unknown as Sandbox,
    run,
    list,
    write,
    sendInput,
    resize,
    kill,
  };
}

describe("Workbench interactive terminal", () => {
  it("validates create, input, resize, session id and cursor payloads", () => {
    expect(
      terminal.parseCreateTerminalRequest({
        cwd: "project/../src",
        cols: 100,
        rows: 28,
      }),
    ).toEqual({
      cwd: "src",
      cols: 100,
      rows: 28,
      clientTerminalId: null,
      profile: "shell",
    });
    expect(
      terminal.parseCreateTerminalRequest({ profile: "claude" }).profile,
    ).toBe("claude");
    expect(() =>
      terminal.parseCreateTerminalRequest({ profile: "arbitrary-command" }),
    ).toThrow(expect.objectContaining({ code: "invalid_terminal_session" }));
    expect(Array.from(terminal.parseTerminalInput({ data: "G1tB" }))).toEqual([
      27, 91, 65,
    ]);
    expect(terminal.parseTerminalResize({ cols: 80, rows: 24 })).toEqual({
      cols: 80,
      rows: 24,
    });
    expect(terminal.parseTerminalCursor("123")).toBe(123);
    expect(() => terminal.parseTerminalInput({ data: "not base64" })).toThrow(
      expect.objectContaining({ code: "invalid_terminal_input" }),
    );
    expect(() => terminal.parseTerminalResize({ cols: 4, rows: 999 })).toThrow(
      expect.objectContaining({ code: "invalid_terminal_size" }),
    );
    expect(() => terminal.parseTerminalSessionId("../root")).toThrow(
      expect.objectContaining({ code: "terminal_not_found" }),
    );
    expect(() =>
      terminal.parseCreateTerminalRequest({ clientTerminalId: "short" }),
    ).toThrow(expect.objectContaining({ code: "invalid_terminal_session" }));
  });

  it("rejects agent CLI profiles that the remote sandbox cannot launch", async () => {
    const mocks = mockSandbox();
    mockCreateHandle.mockClear();

    await expect(
      terminal.createInteractiveTerminalSession(
        mocks.sandbox,
        "remote-agent-profile",
        terminal.parseCreateTerminalRequest({ profile: "codex" }),
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        status: 409,
        code: "terminal_profile_unavailable",
      }),
    );
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mockCreateHandle).not.toHaveBeenCalled();
  });

  it("rejects a missing local CLI instead of silently opening a shell", async () => {
    mockCreateLocalHandle.mockClear();
    mockResolveLocalTerminalLaunch.mockReturnValueOnce({
      profile: "grok",
      profileAvailable: false,
      executable: "/bin/zsh",
      args: ["-f"],
      notice: "Grok is not installed or is not available on PATH.",
    });

    await expect(
      terminal.createLocalInteractiveTerminalSession(
        "local-missing-profile",
        "/Users/example/project",
        terminal.parseCreateTerminalRequest({ profile: "grok" }),
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        status: 409,
        code: "terminal_profile_unavailable",
        message: "Grok is not installed or is not available on PATH.",
      }),
    );
    expect(mockCreateLocalHandle).not.toHaveBeenCalled();
  });

  it("creates an explicit unprivileged PTY only after hardening and /proc verification", async () => {
    const mocks = mockSandbox();
    const request = terminal.parseCreateTerminalRequest({
      cwd: "src",
      cols: 100,
      rows: 28,
    });

    const created = await terminal.createInteractiveTerminalSession(
      mocks.sandbox,
      "premium-user",
      request,
    );
    const summary = created.session;

    expect(created.created).toBe(true);

    expect(summary).toMatchObject({
      clientTerminalId: null,
      pid: 4242,
      cwd: "/home/user/src",
      cols: 100,
      rows: 28,
      status: "running",
    });
    expect(summary.id).toMatch(/^[a-f0-9]{24}$/);
    expect(mockAssertWorkspaceDirectoryAccess).toHaveBeenCalledWith(
      mocks.sandbox,
      "src",
    );
    expect(mockCreateHandle).toHaveBeenCalledWith(
      mocks.sandbox,
      expect.objectContaining({
        user: "user",
        cwd: "/home/user/src",
        cols: 100,
        rows: 28,
        envs: expect.objectContaining({
          HOME: "/var/lib/rift-workbench/home",
          SHELL: "/usr/local/libexec/rift-workbench-shell",
          RIFT_WORKBENCH_PTY_VERSION: "2",
          RIFT_WORKBENCH_SESSION_ID: summary.id,
        }),
      }),
    );

    const commands = mocks.run.mock.calls.map((call) => String(call[0]));
    const hardening = commands.find((command) =>
      command.includes("rift-workbench-shell.next"),
    );
    const verification = commands.find((command) =>
      command.includes("NoNewPrivs"),
    );
    expect(hardening).toContain(
      "usermod -d /var/lib/rift-workbench/home -s /usr/local/libexec/rift-workbench-shell user",
    );
    expect(hardening).toContain("sudo -n true");
    expect(hardening).toContain("-perm /6000");
    expect(hardening).not.toContain("/etc/profile.d");
    expect(verification).toContain("CapEff");
    expect(verification).toContain("CapBnd");
    expect(verification).toContain("NoNewPrivs");
    expect(
      mocks.run.mock.calls.find((call) =>
        String(call[0]).includes("NoNewPrivs"),
      )?.[1],
    ).toEqual(
      expect.objectContaining({
        user: "root",
        envs: expect.objectContaining({
          HOME: "/root",
          RIFT_PTY_PID: "4242",
        }),
      }),
    );

    const writtenSources = mocks.write.mock.calls.map((call) =>
      String(call[1]),
    );
    expect(
      writtenSources.some((source) => source.includes("PR_CAPBSET_DROP")),
    ).toBe(true);
    expect(
      writtenSources.some((source) => source.includes("PR_SET_NO_NEW_PRIVS")),
    ).toBe(true);
    expect(
      writtenSources.some((source) => source.includes("alarm(3600)")),
    ).toBe(true);
    expect(
      writtenSources.some((source) =>
        source.includes("RIFT_WORKBENCH_ROOT_HOME_V1"),
      ),
    ).toBe(true);
    const loginProfiles = writtenSources.filter((source) =>
      source.includes("Root-owned Workbench login boundary"),
    );
    expect(loginProfiles).toHaveLength(2);
    for (const profile of loginProfiles) {
      expect(profile).toContain('[ "${RIFT_WORKBENCH_PTY_VERSION:-}" = "2" ]');
      expect(profile).toContain('[ -n "${RIFT_WORKBENCH_SESSION_ID:-}" ]');
      expect(profile).toContain("exec /usr/local/libexec/rift-workbench-shell");
      expect(profile.indexOf("RIFT_WORKBENCH_PTY_VERSION")).toBeLessThan(
        profile.indexOf("exec /usr/local/libexec/rift-workbench-shell"),
      );
    }

    mocks.list.mockResolvedValue([
      {
        pid: 4242,
        cmd: "/bin/bash",
        args: [],
        cwd: "/home/user/src",
        envs: {
          RIFT_WORKBENCH_PTY_VERSION: "2",
          RIFT_WORKBENCH_SESSION_ID: summary.id,
          RIFT_WORKBENCH_CREATED_AT: String(summary.createdAt),
          RIFT_WORKBENCH_EXPIRES_AT: String(summary.expiresAt),
          RIFT_WORKBENCH_CWD: "/home/user/src",
          RIFT_WORKBENCH_COLS: "100",
          RIFT_WORKBENCH_ROWS: "28",
        },
      },
    ]);

    await terminal.sendInteractiveTerminalInput(
      mocks.sandbox,
      "premium-user",
      summary.id,
      new Uint8Array([3]),
    );
    await terminal.resizeInteractiveTerminal(
      mocks.sandbox,
      "premium-user",
      summary.id,
      { cols: 120, rows: 32 },
    );
    expect(createdHandle.sendInput).toHaveBeenCalledWith(new Uint8Array([3]));
    expect(createdHandle.resize).toHaveBeenCalledWith(120, 32);
    expect(mocks.sendInput).not.toHaveBeenCalled();
    expect(mocks.resize).not.toHaveBeenCalled();

    createdHandle.sendInput.mockClear();
    const firstInput = deferred();
    createdHandle.sendInput.mockImplementationOnce(() => firstInput.promise);
    const firstMutation = terminal.sendInteractiveTerminalInput(
      mocks.sandbox,
      "premium-user",
      summary.id,
      new Uint8Array([5]),
    );
    const secondMutation = terminal.sendInteractiveTerminalInput(
      mocks.sandbox,
      "premium-user",
      summary.id,
      new Uint8Array([6]),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(createdHandle.sendInput).toHaveBeenCalledTimes(1);
    firstInput.resolve();
    await Promise.all([firstMutation, secondMutation]);
    expect(createdHandle.sendInput.mock.calls).toEqual([
      [new Uint8Array([5])],
      [new Uint8Array([6])],
    ]);

    await terminal.sendInteractiveTerminalInput(
      mocks.sandbox,
      "different-workspace",
      summary.id,
      new Uint8Array([7]),
    );
    expect(mocks.sendInput).toHaveBeenCalledWith(4242, new Uint8Array([7]));
    expect(createdHandle.sendInput).not.toHaveBeenCalledWith(
      new Uint8Array([7]),
    );

    const reopened = await terminal.createInteractiveTerminalSession(
      mocks.sandbox,
      "premium-user",
      request,
    );
    expect(reopened).toEqual({
      session: expect.objectContaining({ id: summary.id }),
      created: false,
    });
    expect(mockCreateHandle).toHaveBeenCalledTimes(1);

    const abort = new AbortController();
    const connected = await terminal.connectInteractiveTerminalEvents(
      mocks.sandbox,
      "premium-user",
      summary.id,
    );
    const response = terminal.createInteractiveTerminalEventResponse({
      workspaceKey: "premium-user",
      session: connected.session,
      cursor: 0,
      reconnected: connected.reconnected,
      signal: abort.signal,
      inputLease: "a".repeat(43),
    });
    expect(response.headers.get("X-RIFT-Terminal-Input-Lease")).toBe(
      "a".repeat(43),
    );
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const reader = response.body!.getReader();
    const ready = await reader.read();
    expect(new TextDecoder().decode(ready.value)).toContain("event: ready");
    createdHandle.emit(new TextEncoder().encode("terminal output"));
    const output = await reader.read();
    expect(new TextDecoder().decode(output.value)).toContain(
      Buffer.from("terminal output").toString("base64"),
    );
    abort.abort();

    createdHandle.exit(0);
    await terminal.closeInteractiveTerminal(
      mocks.sandbox,
      "premium-user",
      summary.id,
    );
    expect(createdHandle.kill).toHaveBeenCalledTimes(1);
  });

  it("runs an allowlisted local CLI profile without any remote sandbox RPC", async () => {
    const request = terminal.parseCreateTerminalRequest({
      cols: 96,
      rows: 30,
      clientTerminalId: "terminal-local-claude",
      profile: "claude",
    });
    const created = await terminal.createLocalInteractiveTerminalSession(
      "local-user-project",
      "/Users/example/project",
      request,
    );

    expect(created).toEqual({
      created: true,
      session: expect.objectContaining({
        clientTerminalId: "terminal-local-claude",
        pid: 5151,
        cwd: "/Users/example/project",
        profile: "claude",
        profileAvailable: true,
        backend: "local",
      }),
    });
    expect(mockCreateLocalHandle).toHaveBeenCalledWith({
      launch: expect.objectContaining({
        profile: "claude",
        executable: "/mock/claude",
      }),
      cwd: "/Users/example/project",
      cols: 96,
      rows: 30,
    });

    const sender = await terminal.sendLocalInteractiveTerminalInput(
      "local-user-project",
      created.session.id,
      new Uint8Array([97]),
    );
    await sender(new Uint8Array([98]));
    await terminal.resizeLocalInteractiveTerminal(
      "local-user-project",
      created.session.id,
      { cols: 120, rows: 40 },
    );
    expect(localHandle.sendInput.mock.calls).toEqual([
      [new Uint8Array([97])],
      [new Uint8Array([98])],
    ]);
    expect(localHandle.resize).toHaveBeenCalledWith(120, 40);

    const connected = await terminal.connectLocalInteractiveTerminalEvents(
      "local-user-project",
      created.session.id,
    );
    expect(connected.reconnected).toBe(false);
    expect(
      await terminal.listLocalInteractiveTerminalSessions("local-user-project"),
    ).toEqual({
      sessions: [expect.objectContaining({ id: created.session.id })],
    });

    localHandle.exit(0);
    await terminal.closeLocalInteractiveTerminal(
      "local-user-project",
      created.session.id,
    );
    expect(localHandle.kill).toHaveBeenCalledTimes(1);
  });

  it("creates distinct browser-owned terminals, reuses the matching id, and enforces the workspace cap", async () => {
    const mocks = mockSandbox();
    const workspaceKey = "multi-terminal-workspace";
    const processes: Array<{
      pid: number;
      cmd: string;
      args: never[];
      cwd: string;
      envs: Record<string, string>;
    }> = [];
    const handles: FakeHandle[] = [];
    const summaries: Array<
      Awaited<
        ReturnType<typeof terminal.createInteractiveTerminalSession>
      >["session"]
    > = [];
    mocks.list.mockImplementation(async () => processes);
    mockCreateHandle.mockClear();

    const createFor = async (ordinal: number) => {
      const clientTerminalId = `terminal-client-${ordinal}`;
      const handle = fakeHandle(6000 + ordinal);
      handles.push(handle);
      mockCreateHandle.mockResolvedValueOnce(handle);
      const request = terminal.parseCreateTerminalRequest({
        cols: 90,
        rows: 24,
        clientTerminalId,
      });
      const result = await terminal.createInteractiveTerminalSession(
        mocks.sandbox,
        workspaceKey,
        request,
      );
      summaries.push(result.session);
      processes.push({
        pid: handle.pid,
        cmd: "/bin/bash",
        args: [],
        cwd: "/home/user",
        envs: {
          RIFT_WORKBENCH_PTY_VERSION: "2",
          RIFT_WORKBENCH_SESSION_ID: result.session.id,
          RIFT_WORKBENCH_CLIENT_TERMINAL_ID: clientTerminalId,
          RIFT_WORKBENCH_CREATED_AT: String(result.session.createdAt),
          RIFT_WORKBENCH_EXPIRES_AT: String(result.session.expiresAt),
          RIFT_WORKBENCH_CWD: "/home/user",
          RIFT_WORKBENCH_COLS: "90",
          RIFT_WORKBENCH_ROWS: "24",
        },
      });
      return result;
    };

    const first = await createFor(1);
    expect(first).toEqual({
      created: true,
      session: expect.objectContaining({
        clientTerminalId: "terminal-client-1",
      }),
    });
    expect(mockCreateHandle).toHaveBeenLastCalledWith(
      mocks.sandbox,
      expect.objectContaining({
        envs: expect.objectContaining({
          RIFT_WORKBENCH_CLIENT_TERMINAL_ID: "terminal-client-1",
        }),
      }),
    );

    const reused = await terminal.createInteractiveTerminalSession(
      mocks.sandbox,
      workspaceKey,
      terminal.parseCreateTerminalRequest({
        clientTerminalId: "terminal-client-1",
      }),
    );
    expect(reused).toEqual({
      created: false,
      session: expect.objectContaining({ id: first.session.id }),
    });
    expect(mockCreateHandle).toHaveBeenCalledTimes(1);

    const second = await createFor(2);
    expect(second.session.id).not.toBe(first.session.id);
    expect(second.session.clientTerminalId).toBe("terminal-client-2");
    for (let ordinal = 3; ordinal <= 6; ordinal += 1) {
      await createFor(ordinal);
    }
    expect(mockCreateHandle).toHaveBeenCalledTimes(6);

    await expect(
      terminal.createInteractiveTerminalSession(
        mocks.sandbox,
        workspaceKey,
        terminal.parseCreateTerminalRequest({
          clientTerminalId: "terminal-client-7",
        }),
      ),
    ).rejects.toEqual(
      expect.objectContaining({ status: 409, code: "terminal_limit_reached" }),
    );
    expect(mockCreateHandle).toHaveBeenCalledTimes(6);

    for (const handle of handles) handle.exit(0);
    for (const summary of summaries) {
      await terminal.closeInteractiveTerminal(
        mocks.sandbox,
        workspaceKey,
        summary.id,
      );
    }
  });

  it("returns a guarded sender even when the shell exits during the authenticated input", async () => {
    const mocks = mockSandbox();
    const handle = fakeHandle(7070);
    mockCreateHandle.mockResolvedValueOnce(handle);
    const created = await terminal.createInteractiveTerminalSession(
      mocks.sandbox,
      "input-exit-race-workspace",
      terminal.parseCreateTerminalRequest({
        clientTerminalId: "terminal-exit-race",
      }),
    );
    handle.sendInput.mockImplementationOnce(async () => {
      handle.exit(0);
      await Promise.resolve();
    });

    const sendInput = await terminal.sendInteractiveTerminalInput(
      mocks.sandbox,
      "input-exit-race-workspace",
      created.session.id,
      new Uint8Array([4]),
    );

    expect(sendInput).toEqual(expect.any(Function));
    await expect(sendInput(new Uint8Array([5]))).rejects.toThrow(
      "Terminal input handle is no longer current.",
    );
    await terminal.closeInteractiveTerminal(
      mocks.sandbox,
      "input-exit-race-workspace",
      created.session.id,
    );
  });

  it("reconnects by E2B process metadata when the local registry is empty", async () => {
    const mocks = mockSandbox();
    const id = "0123456789abcdef01234567";
    const now = Date.now();
    mocks.list.mockResolvedValue([
      {
        pid: 4343,
        cmd: "/bin/bash",
        args: [],
        cwd: "/home/user",
        envs: {
          RIFT_WORKBENCH_PTY_VERSION: "2",
          RIFT_WORKBENCH_SESSION_ID: id,
          RIFT_WORKBENCH_CREATED_AT: String(now),
          RIFT_WORKBENCH_EXPIRES_AT: String(now + 60_000),
          RIFT_WORKBENCH_CWD: "/home/user",
          RIFT_WORKBENCH_COLS: "80",
          RIFT_WORKBENCH_ROWS: "24",
        },
      },
    ]);

    const connected = await terminal.connectInteractiveTerminalEvents(
      mocks.sandbox,
      "cold-instance-user",
      id,
    );

    expect(connected.reconnected).toBe(true);
    expect(mockConnectHandle).toHaveBeenCalledWith(mocks.sandbox, 4343);
    reconnectedHandle.exit(0);
    await terminal.closeInteractiveTerminal(
      mocks.sandbox,
      "cold-instance-user",
      id,
    );
  });

  it("falls back to pid-based E2B mutations when the scoped local registry is cold", async () => {
    const mocks = mockSandbox();
    const id = "abcdef0123456789abcdef01";
    const now = Date.now();
    mocks.list.mockResolvedValue([
      {
        pid: 5252,
        cmd: "/bin/bash",
        args: [],
        cwd: "/home/user",
        envs: {
          RIFT_WORKBENCH_PTY_VERSION: "2",
          RIFT_WORKBENCH_SESSION_ID: id,
          RIFT_WORKBENCH_CREATED_AT: String(now),
          RIFT_WORKBENCH_EXPIRES_AT: String(now + 60_000),
          RIFT_WORKBENCH_CWD: "/home/user",
          RIFT_WORKBENCH_COLS: "80",
          RIFT_WORKBENCH_ROWS: "24",
        },
      },
    ]);

    const sendInput = await terminal.sendInteractiveTerminalInput(
      mocks.sandbox,
      "cold-mutation-workspace",
      id,
      new Uint8Array([4]),
    );
    await sendInput(new Uint8Array([8]));
    expect(mocks.list).toHaveBeenCalledTimes(1);
    await terminal.resizeInteractiveTerminal(
      mocks.sandbox,
      "cold-mutation-workspace",
      id,
      { cols: 90, rows: 25 },
    );

    expect(mocks.sendInput.mock.calls).toEqual([
      [5252, new Uint8Array([4])],
      [5252, new Uint8Array([8])],
    ]);
    expect(mocks.resize).toHaveBeenCalledWith(5252, { cols: 90, rows: 25 });
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it("rotates a long-lived SSE stream at 255s and resumes from its cursor without duplicate output", async () => {
    jest.useFakeTimers();
    const handle = fakeHandle(8181);
    const workspaceKey = "sse-rotation-workspace";
    mockCreateLocalHandle.mockResolvedValueOnce(handle);

    const readUntilEvent = async (
      reader: ReadableStreamDefaultReader<Uint8Array>,
      eventType: string,
    ) => {
      for (let index = 0; index < 32; index += 1) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error(`Stream ended before ${eventType}`);
        const frame = new TextDecoder().decode(chunk.value);
        if (frame.includes(`event: ${eventType}`)) return frame;
      }
      throw new Error(`Did not receive ${eventType}`);
    };

    try {
      const created = await terminal.createLocalInteractiveTerminalSession(
        workspaceKey,
        "/Users/example/project",
        terminal.parseCreateTerminalRequest({
          clientTerminalId: "terminal-sse-rotation",
        }),
      );
      const connected = await terminal.connectLocalInteractiveTerminalEvents(
        workspaceKey,
        created.session.id,
      );
      const firstAbort = new AbortController();
      const firstResponse = terminal.createInteractiveTerminalEventResponse({
        workspaceKey,
        session: connected.session,
        cursor: 0,
        reconnected: false,
        signal: firstAbort.signal,
      });
      const firstReader = firstResponse.body!.getReader();

      await readUntilEvent(firstReader, "ready");
      handle.emit(new TextEncoder().encode("alpha"));
      const firstOutput = await readUntilEvent(firstReader, "output");
      expect(firstOutput).toContain(Buffer.from("alpha").toString("base64"));
      expect(firstOutput).toContain('"cursor":5');

      jest.advanceTimersByTime(terminal.WORKBENCH_TERMINAL_SSE_ROTATE_MS);
      const rotate = await readUntilEvent(firstReader, "rotate");
      expect(rotate).toContain('"cursor":5');
      await expect(firstReader.read()).resolves.toEqual({
        done: true,
        value: undefined,
      });
      expect(handle.unsubscribeCalls).toHaveBeenCalledTimes(1);
      expect(handle.listenerCount()).toBe(1);

      // The PTY continues producing output while the HTTP connection rotates.
      handle.emit(new TextEncoder().encode("beta"));
      const secondAbort = new AbortController();
      const secondResponse = terminal.createInteractiveTerminalEventResponse({
        workspaceKey,
        session: connected.session,
        cursor: 5,
        reconnected: false,
        signal: secondAbort.signal,
      });
      const secondReader = secondResponse.body!.getReader();

      const secondReady = await readUntilEvent(secondReader, "ready");
      expect(secondReady).toContain('"cursor":5');
      const secondOutput = await readUntilEvent(secondReader, "output");
      expect(secondOutput).toContain(Buffer.from("beta").toString("base64"));
      expect(secondOutput).not.toContain(
        Buffer.from("alpha").toString("base64"),
      );
      expect(secondOutput).toContain('"cursor":9');

      secondAbort.abort();
      firstAbort.abort();
      expect(handle.unsubscribeCalls).toHaveBeenCalledTimes(2);

      handle.exit(0);
      await terminal.closeLocalInteractiveTerminal(
        workspaceKey,
        created.session.id,
      );
      expect(handle.unsubscribeCalls).toHaveBeenCalledTimes(3);
      expect(handle.listenerCount()).toBe(0);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});

it("pauses a local producer while the SSE reader is withheld and drains exact bytes", async () => {
  const handle = fakeHandle(9898);
  let paused = false;
  let resumeWait: (() => void) | undefined;
  const pause = jest.fn(() => {
    paused = true;
  });
  const resume = jest.fn(() => {
    paused = false;
    resumeWait?.();
    resumeWait = undefined;
  });
  Object.assign(handle, {
    acquireOutputFlowControl: () => ({ pause, resume, dispose: resume }),
  });
  mockCreateLocalHandle.mockResolvedValueOnce(handle);
  const key = "local-backpressure-regression";
  const created = await terminal.createLocalInteractiveTerminalSession(
    key,
    "/Users/example/project",
    terminal.parseCreateTerminalRequest({ profile: "shell" }),
  );
  const connected = await terminal.connectLocalInteractiveTerminalEvents(
    key,
    created.session.id,
  );
  const abort = new AbortController();
  const response = terminal.createInteractiveTerminalEventResponse({
    ...connected,
    cursor: 0,
    signal: abort.signal,
  });
  const reader = response.body!.getReader();
  try {
    await Promise.resolve();
    expect(pause).toHaveBeenCalled();
    expect(paused).toBe(true);
    const chunk = Buffer.from("abcπ界\n".repeat(512));
    const pieces = 128;
    const producing = (async () => {
      for (let i = 0; i < pieces; i++) {
        while (paused)
          await new Promise<void>((resolve) => {
            resumeWait = resolve;
          });
        handle.emit(chunk);
        await Promise.resolve();
      }
      handle.exit(0);
    })();
    const output: Buffer[] = [];
    const events: string[] = [];
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      for (const line of new TextDecoder().decode(next.value).split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const event = JSON.parse(line.slice(6));
        events.push(event.type);
        if (event.type === "output")
          output.push(Buffer.from(event.data, "base64"));
      }
    }
    await producing;
    expect(Buffer.concat(output)).toEqual(
      Buffer.concat(Array(pieces).fill(chunk)),
    );
    expect(events[0]).toBe("ready");
    expect(events.at(-1)).toBe("exit");
    expect(events).not.toContain("reset");
    expect(pause.mock.calls.length).toBeGreaterThan(1);
  } finally {
    abort.abort();
    await reader.cancel().catch(() => {});
    handle.exit(0);
    await terminal.closeLocalInteractiveTerminal(key, created.session.id);
  }
});
