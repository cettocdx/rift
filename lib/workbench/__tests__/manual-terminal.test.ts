import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { Sandbox } from "@e2b/code-interpreter";

class TestWorkbenchRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
  }
}

let parseWorkbenchTerminalCommand: (typeof import("@/lib/workbench/manual-terminal"))["parseWorkbenchTerminalCommand"];
let runWorkbenchTerminalCommand: (typeof import("@/lib/workbench/manual-terminal"))["runWorkbenchTerminalCommand"];

beforeAll(() => {
  jest.resetModules();
  jest.doMock("server-only", () => ({}), { virtual: true });
  jest.doMock("@/lib/workbench/workspace-server", () => ({
    WorkbenchRequestError: TestWorkbenchRequestError,
  }));

  const terminal =
    require("@/lib/workbench/manual-terminal") as typeof import("@/lib/workbench/manual-terminal");
  parseWorkbenchTerminalCommand = terminal.parseWorkbenchTerminalCommand;
  runWorkbenchTerminalCommand = terminal.runWorkbenchTerminalCommand;
});

function encoded(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}

describe("Workbench manual terminal", () => {
  it("accepts one shell line and normalizes an absolute cwd", () => {
    expect(
      parseWorkbenchTerminalCommand({
        command: "printf 'ok'",
        cwd: "/home/user/project/../src",
      }),
    ).toEqual({ command: "printf 'ok'", cwd: "/home/user/src" });
  });

  it.each([
    { command: "", cwd: "/home/user" },
    { command: "   ", cwd: "/home/user" },
    { command: "pwd\nwhoami", cwd: "/home/user" },
    { command: "pwd", cwd: "home/user" },
    { command: "pwd", cwd: "/home/user\u0000secret" },
    { command: "pwd", cwd: "/home/user", extra: true },
    { command: "ş".repeat(4096), cwd: "/home/user" },
  ])("rejects malformed command payload %#", (payload) => {
    expect(() => parseWorkbenchTerminalCommand(payload)).toThrow(
      expect.objectContaining({
        status: 400,
        code: "invalid_terminal_command",
      }),
    );
  });

  it("runs as the unprivileged user with only runner-owned environment data", async () => {
    const run = jest.fn().mockResolvedValue({
      stdout: JSON.stringify({
        stdout: encoded("cli-ok\n"),
        stderr: encoded("warning\n"),
        exitCode: 7,
        cwd: "/home/user/src",
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: true,
        durationMs: 42,
      }),
      stderr: "",
      exitCode: 0,
    });
    const sandbox = { commands: { run } } as unknown as Sandbox;

    await expect(
      runWorkbenchTerminalCommand(sandbox, {
        command: "printf cli-ok",
        cwd: "/home/user",
      }),
    ).resolves.toEqual({
      stdout: "cli-ok\n",
      stderr: "warning\n",
      exitCode: 7,
      cwd: "/home/user/src",
      timedOut: false,
      truncated: true,
      durationMs: 42,
    });

    expect(run).toHaveBeenCalledTimes(3);
    expect(run).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("gpasswd -d user sudo"),
      expect.objectContaining({ user: "root", cwd: "/" }),
    );
    const hardeningCommand = run.mock.calls[0]?.[0] as string;
    expect(hardeningCommand).toContain('pgrep "$rift_uid_flag" user');
    expect(hardeningCommand).toContain('pkill -KILL "$rift_uid_flag" user');
    expect(hardeningCommand).toContain("for rift_uid_flag in -u -U");
    expect(hardeningCommand).toContain('ps -p "$rift_pid" -o stat=');
    expect(hardeningCommand).toContain("-perm /6000");
    expect(hardeningCommand).toContain("passwd -S user");
    expect(hardeningCommand).toContain("sudo -n true");
    expect(hardeningCommand).not.toContain(
      "pkill -KILL -u user >/dev/null 2>&1 || true",
    );
    expect(run).toHaveBeenNthCalledWith(
      2,
      'exec /usr/bin/python3 -I -S -c "$RIFT_TERMINAL_RUNNER"',
      expect.objectContaining({
        cwd: "/home/user/workspace",
        user: "user",
        envs: expect.objectContaining({
          RIFT_COMMAND: "printf cli-ok",
          RIFT_CWD: "/home/user",
        }),
      }),
    );
    const options = run.mock.calls[1]?.[1] as {
      envs: Record<string, string>;
    };
    expect(options.envs).not.toHaveProperty("GITHUB_TOKEN");
    expect(options.envs).not.toHaveProperty("CENSYS_API_SECRET");
    expect(options.envs).not.toHaveProperty("CONVEX_SERVICE_ROLE_KEY");
    expect(options.envs.PATH).toBe(
      "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    );
    expect(run).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('pkill -KILL "$rift_uid_flag" user'),
      expect.objectContaining({ user: "root", cwd: "/" }),
    );
    const cleanupCommand = run.mock.calls[2]?.[0] as string;
    expect(cleanupCommand).toContain("for rift_uid_flag in -u -U");
    expect(cleanupCommand).toContain('ps -p "$rift_pid" -o stat=');
    expect(cleanupCommand).not.toContain("|| true");
  });

  it("rejects malformed base64 returned by the sandbox runner", async () => {
    const sandbox = {
      commands: {
        run: jest.fn().mockResolvedValue({
          stdout: JSON.stringify({
            stdout: "not base64!",
            stderr: "",
            exitCode: 0,
            cwd: "/home/user",
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            durationMs: 1,
          }),
          stderr: "",
          exitCode: 0,
        }),
      },
    } as unknown as Sandbox;

    await expect(
      runWorkbenchTerminalCommand(sandbox, {
        command: "pwd",
        cwd: "/home/user",
      }),
    ).rejects.toMatchObject({
      status: 502,
      code: "invalid_terminal_response",
    });
  });
});
