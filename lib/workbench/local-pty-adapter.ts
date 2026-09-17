import { createTerminalOutputFlow } from "./terminal-output-flow";
import "server-only";

import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import type { IPty, IPtyForkOptions } from "node-pty";
import type { PtyHandle } from "@/lib/ai/tools/utils/e2b-pty-adapter";
import {
  WORKBENCH_TERMINAL_PROFILES,
  type WorkbenchTerminalProfile,
  type WorkbenchTerminalProfileCapability,
} from "./interactive-terminal-contract";

type NodePtyModule = typeof import("node-pty");

const MAX_PRE_SUBSCRIPTION_BYTES = 64 * 1024;
const LOCAL_TERMINAL_ENV_ALLOWLIST = [
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "PATH",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "SSH_AUTH_SOCK",
  "GPG_TTY",
] as const;

const PROFILE_COMMANDS: Record<
  WorkbenchTerminalProfile,
  { label: string; command: string; args: string[] }
> = {
  // `-f` keeps the host user's plugins from adding seconds of startup work or
  // mutating the Next.js server process environment. PATH/HOME/locale are
  // still initialized below, so this behaves like a clean macOS terminal.
  shell: { label: "macOS zsh", command: "/bin/zsh", args: ["-f"] },
  claude: { label: "Claude Code", command: "claude", args: [] },
  // Keep the embedded terminal immediately usable. Codex's own update chooser
  // otherwise captures the first keystroke before the agent prompt appears;
  // updates remain available explicitly through `codex update`.
  codex: {
    label: "Codex",
    command: "codex",
    args: ["-c", "check_for_update_on_startup=false"],
  },
  grok: { label: "Grok", command: "grok", args: [] },
};

export type LocalPtyLaunch = {
  profile: WorkbenchTerminalProfile;
  profileAvailable: boolean;
  executable: string;
  args: string[];
  notice?: string;
};

function executableFile(path: string) {
  try {
    // These paths come from the host PATH at request time. They are runtime
    // capabilities, not application assets that belong in Next's NFT output.
    accessSync(/* turbopackIgnore: true */ path, constants.X_OK);
    return statSync(/* turbopackIgnore: true */ path).isFile()
      ? realpathSync(/* turbopackIgnore: true */ path)
      : null;
  } catch {
    return null;
  }
}

function executableSearchPaths() {
  const home = homedir();
  const configured = (process.env.PATH ?? "")
    .split(delimiter)
    .filter((entry) => entry && isAbsolute(entry));
  return Array.from(
    new Set([
      ...configured,
      join(home, ".local", "bin"),
      join(home, ".grok", "bin"),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    ]),
  );
}

function findExecutable(command: string) {
  if (isAbsolute(command)) return executableFile(command);
  for (const directory of executableSearchPaths()) {
    const executable = executableFile(join(directory, command));
    if (executable) return executable;
  }
  return null;
}

export function resolveLocalTerminalLaunch(
  profile: WorkbenchTerminalProfile,
): LocalPtyLaunch {
  const requested = PROFILE_COMMANDS[profile];
  const executable = findExecutable(requested.command);
  if (executable) {
    return {
      profile,
      profileAvailable: true,
      executable,
      args: [...requested.args],
    };
  }

  const shell = findExecutable(PROFILE_COMMANDS.shell.command);
  if (!shell) {
    throw new Error("The local zsh executable is unavailable.");
  }
  return {
    profile,
    profileAvailable: false,
    executable: shell,
    args: [...PROFILE_COMMANDS.shell.args],
    notice: `${requested.label} is not installed or is not available on PATH.`,
  };
}

export function resolveLocalTerminalProfileCapabilities(): WorkbenchTerminalProfileCapability[] {
  return WORKBENCH_TERMINAL_PROFILES.map(({ id }) => {
    const requested = PROFILE_COMMANDS[id];
    const executable = findExecutable(requested.command);
    return {
      profile: id,
      available: executable !== null,
      runtimeLabel: requested.label,
      unavailableReason: executable
        ? null
        : id === "shell"
          ? "macOS zsh is not available on this host."
          : `${requested.label} is not installed or is not available on PATH.`,
    };
  });
}

export function resolveLocalWorkspaceRoot() {
  const configured = process.env.RIFT_LOCAL_WORKSPACE_ROOT?.trim();
  if (!configured || !isAbsolute(configured)) {
    throw new Error(
      "RIFT_LOCAL_WORKSPACE_ROOT must be an absolute directory before local terminal access is enabled.",
    );
  }
  // The configured root can intentionally be the repository itself for the
  // localhost workbench. Do not let output tracing treat that runtime-only
  // directory lookup as a request to package the whole project.
  const root = realpathSync(/* turbopackIgnore: true */ configured);
  if (!statSync(/* turbopackIgnore: true */ root).isDirectory()) {
    throw new Error("RIFT_LOCAL_WORKSPACE_ROOT is not a directory.");
  }
  return root;
}

export function resolveLocalTerminalCwd(root: string, relativeCwd: string) {
  const canonicalRoot = realpathSync(/* turbopackIgnore: true */ root);
  const candidate = resolve(
    /* turbopackIgnore: true */ canonicalRoot,
    relativeCwd || ".",
  );
  const relativeBoundary = `${canonicalRoot}${sep}`;
  if (candidate !== canonicalRoot && !candidate.startsWith(relativeBoundary)) {
    throw new Error(
      "The local terminal working directory leaves the workspace.",
    );
  }
  const canonicalCandidate = realpathSync(
    /* turbopackIgnore: true */ candidate,
  );
  if (
    canonicalCandidate !== canonicalRoot &&
    !canonicalCandidate.startsWith(relativeBoundary)
  ) {
    throw new Error(
      "Symbolic links cannot move the local terminal outside the workspace.",
    );
  }
  if (!statSync(/* turbopackIgnore: true */ canonicalCandidate).isDirectory()) {
    throw new Error("The local terminal working directory is not a directory.");
  }
  return canonicalCandidate;
}

function localTerminalEnvironment(cwd: string) {
  const env: Record<string, string> = {};
  for (const key of LOCAL_TERMINAL_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  env.HOME ||= homedir();
  env.USER ||= process.env.LOGNAME || "user";
  env.LOGNAME ||= env.USER;
  env.SHELL = "/bin/zsh";
  env.PATH = executableSearchPaths().join(delimiter);
  env.PWD = cwd;
  env.OLDPWD = cwd;
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  env.TERM_PROGRAM = "RIFT";
  env.RIFT_LOCAL_TERMINAL = "1";
  return env;
}

async function loadNodePty(): Promise<NodePtyModule> {
  try {
    return await import("node-pty");
  } catch (error) {
    const message = error instanceof Error ? ` ${error.message}` : "";
    throw new Error(`The local PTY runtime could not be loaded.${message}`);
  }
}

export async function createLocalPtyHandle(options: {
  launch: LocalPtyLaunch;
  cwd: string;
  cols: number;
  rows: number;
}): Promise<PtyHandle> {
  const nodePty = await loadNodePty();
  const listeners = new Set<(bytes: Uint8Array) => void>();
  const pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let exited = false;

  const publish = (bytes: Uint8Array) => {
    if (listeners.size === 0) {
      const owned = new Uint8Array(bytes);
      pending.push(owned);
      pendingBytes += owned.byteLength;
      while (pendingBytes > MAX_PRE_SUBSCRIPTION_BYTES && pending.length > 0) {
        pendingBytes -= pending.shift()!.byteLength;
      }
      return;
    }
    for (const listener of Array.from(listeners)) {
      try {
        listener(bytes);
      } catch (error) {
        console.error("[local-pty] output listener failed", error);
      }
    }
  };

  if (options.launch.notice) {
    publish(Buffer.from(options.launch.notice, "utf8"));
  }

  const spawnOptions: IPtyForkOptions = {
    name: "xterm-256color",
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: localTerminalEnvironment(options.cwd),
  };
  const processHandle: IPty = nodePty.spawn(
    options.launch.executable,
    options.launch.args,
    spawnOptions,
  );
  processHandle.onData((data) => publish(Buffer.from(data, "utf8")));
  const exitPromise = new Promise<{ exitCode: number | null }>(
    (resolveExit) => {
      processHandle.onExit(({ exitCode }) => {
        exited = true;
        resolveExit({ exitCode: Number.isInteger(exitCode) ? exitCode : null });
      });
    },
  );

  return {
    acquireOutputFlowControl: createTerminalOutputFlow(
      () => {
        if (!exited) processHandle.pause();
      },
      () => {
        if (!exited) processHandle.resume();
      },
    ),
    pid: processHandle.pid,
    async sendInput(bytes) {
      if (exited) throw new Error("The local terminal has exited.");
      processHandle.write(Buffer.from(bytes).toString("utf8"));
    },
    async resize(cols, rows) {
      if (exited) throw new Error("The local terminal has exited.");
      processHandle.resize(cols, rows);
    },
    async kill() {
      if (exited) return;
      processHandle.kill("SIGTERM");
    },
    onData(callback) {
      const firstListener = listeners.size === 0;
      listeners.add(callback);
      if (firstListener && pending.length > 0) {
        const backlog = pending.splice(0);
        pendingBytes = 0;
        for (const bytes of backlog) callback(bytes);
      }
      return () => listeners.delete(callback);
    },
    get exited() {
      return exitPromise;
    },
  };
}
