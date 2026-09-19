import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import fs, {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let adapter: typeof import("@/lib/workbench/local-pty-adapter");
const roots: string[] = [];
const originalRoot = process.env.RIFT_LOCAL_WORKSPACE_ROOT;
const originalPath = process.env.PATH;

// The local terminal feature is macOS-only: the shell profile is pinned to
// /bin/zsh and every profile probe is a direct filesystem check. Spies let
// each test describe the host it targets instead of depending on the CI
// runner actually having zsh (or claude/codex/grok) installed.
let accessSpy: jest.SpiedFunction<typeof fs.accessSync>;
let statSpy: jest.SpiedFunction<typeof fs.statSync>;
let realpathSpy: jest.SpiedFunction<typeof fs.realpathSync>;

function pretendZshHost(zshAvailable: boolean) {
  accessSpy.mockImplementation((path, mode) => {
    if (path === "/bin/zsh") {
      if (!zshAvailable) throw new Error("ENOENT: no such file or directory");
      return;
    }
    return fs.accessSync(path, mode);
  });
  statSpy.mockImplementation(((path: fs.PathLike, options?: unknown) => {
    if (path === "/bin/zsh") {
      if (!zshAvailable) throw new Error("ENOENT: no such file or directory");
      return { isFile: () => true };
    }
    return fs.statSync(path, options as never);
  }) as typeof fs.statSync);
  realpathSpy.mockImplementation(((path: fs.PathLike, options?: unknown) => {
    if (path === "/bin/zsh") {
      if (!zshAvailable) throw new Error("ENOENT: no such file or directory");
      return "/bin/zsh";
    }
    return fs.realpathSync(path, options as never);
  }) as typeof fs.realpathSync);
}

beforeAll(() => {
  jest.resetModules();
  jest.doMock("server-only", () => ({}), { virtual: true });
  adapter =
    require("@/lib/workbench/local-pty-adapter") as typeof import("@/lib/workbench/local-pty-adapter");
  accessSpy = jest.spyOn(fs, "accessSync");
  statSpy = jest.spyOn(fs, "statSync");
  realpathSpy = jest.spyOn(fs, "realpathSync");
});

afterEach(() => {
  accessSpy.mockRestore();
  statSpy.mockRestore();
  realpathSpy.mockRestore();
  accessSpy = jest.spyOn(fs, "accessSync");
  statSpy = jest.spyOn(fs, "statSync");
  realpathSpy = jest.spyOn(fs, "realpathSync");
  if (originalRoot === undefined) {
    delete process.env.RIFT_LOCAL_WORKSPACE_ROOT;
  } else {
    process.env.RIFT_LOCAL_WORKSPACE_ROOT = originalRoot;
  }
  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }
  while (roots.length > 0)
    rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("local macOS PTY policy", () => {
  it("resolves only a configured real workspace directory", () => {
    const root = mkdtempSync(join(tmpdir(), "rift-local-root-"));
    const linkedRoot = `${root}-link`;
    symlinkSync(root, linkedRoot);
    roots.push(root, linkedRoot);
    process.env.RIFT_LOCAL_WORKSPACE_ROOT = linkedRoot;

    expect(adapter.resolveLocalWorkspaceRoot()).toBe(realpathSync(root));
    delete process.env.RIFT_LOCAL_WORKSPACE_ROOT;
    expect(() => adapter.resolveLocalWorkspaceRoot()).toThrow(
      "must be an absolute directory",
    );
  });

  it("accepts a real child cwd and blocks traversal or symlink escape", () => {
    const root = mkdtempSync(join(tmpdir(), "rift-local-root-"));
    const outside = mkdtempSync(join(tmpdir(), "rift-local-outside-"));
    roots.push(root, outside);
    mkdirSync(join(root, "src"));
    symlinkSync(outside, join(root, "outside-link"));

    expect(adapter.resolveLocalTerminalCwd(root, "src")).toBe(
      realpathSync(join(root, "src")),
    );
    expect(() => adapter.resolveLocalTerminalCwd(root, "../outside")).toThrow(
      "leaves the workspace",
    );
    expect(() => adapter.resolveLocalTerminalCwd(root, "outside-link")).toThrow(
      "Symbolic links cannot move",
    );
  });

  it("uses a fixed executable mapping for the standard shell profile", () => {
    pretendZshHost(true);

    const launch = adapter.resolveLocalTerminalLaunch("shell");
    expect(launch).toEqual({
      profile: "shell",
      profileAvailable: true,
      executable: "/bin/zsh",
      args: ["-f"],
    });
  });

  it("falls back to the shell with a notice when a CLI profile is missing", () => {
    pretendZshHost(true);

    const launch = adapter.resolveLocalTerminalLaunch("claude");
    expect(launch).toEqual({
      profile: "claude",
      profileAvailable: false,
      executable: "/bin/zsh",
      args: ["-f"],
      notice: "Claude Code is not installed or is not available on PATH.",
    });
  });

  it("fails closed when the host has no zsh executable at all", () => {
    pretendZshHost(false);

    expect(() => adapter.resolveLocalTerminalLaunch("claude")).toThrow(
      "The local zsh executable is unavailable.",
    );
    const shell = adapter
      .resolveLocalTerminalProfileCapabilities()
      .find(({ profile }) => profile === "shell");
    expect(shell).toEqual(
      expect.objectContaining({
        available: false,
        unavailableReason: "macOS zsh is not available on this host.",
      }),
    );
  });

  it("reports the real availability of every allowlisted local CLI profile", () => {
    pretendZshHost(true);

    const capabilities = adapter.resolveLocalTerminalProfileCapabilities();

    expect(capabilities.map(({ profile }) => profile)).toEqual([
      "shell",
      "claude",
      "codex",
      "grok",
    ]);
    expect(capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profile: "shell",
          available: true,
          runtimeLabel: "macOS zsh",
          unavailableReason: null,
        }),
      ]),
    );
    for (const capability of capabilities) {
      expect(capability.available).toBe(capability.unavailableReason === null);
    }
  });

  it("detects every configured CLI from the server process PATH", () => {
    const bin = mkdtempSync(join(tmpdir(), "rift-local-bin-"));
    roots.push(bin);
    for (const command of ["claude", "codex", "grok"]) {
      const executable = join(bin, command);
      symlinkSync("/bin/sh", executable);
    }
    process.env.PATH = bin;

    expect(adapter.resolveLocalTerminalProfileCapabilities()).toEqual(
      expect.arrayContaining(
        ["claude", "codex", "grok"].map((profile) =>
          expect.objectContaining({
            profile,
            available: true,
            unavailableReason: null,
          }),
        ),
      ),
    );
  });

  it("opens Codex at its prompt instead of the startup update chooser when installed", () => {
    const codex = adapter
      .resolveLocalTerminalProfileCapabilities()
      .find(({ profile }) => profile === "codex");
    if (!codex?.available) return;

    expect(adapter.resolveLocalTerminalLaunch("codex")).toEqual(
      expect.objectContaining({
        profile: "codex",
        profileAvailable: true,
        args: ["-c", "check_for_update_on_startup=false"],
      }),
    );
  });
});
