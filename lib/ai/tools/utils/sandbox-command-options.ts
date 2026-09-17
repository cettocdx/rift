import type { AnySandbox } from "@/types";
import { isCentrifugoSandbox, isE2BSandbox } from "./sandbox-types";

export const DEFAULT_COMMAND_EXECUTION_TIME = 10 * 60 * 1000;
// Leave ample room inside the agent worker's 58-minute execution window.
export const MAX_COMMAND_EXECUTION_TIME = 30 * 60 * 1000;
export const COMMAND_EXIT_DELIVERY_GRACE_MS = 15_000;

/**
 * Common directories where user-installed CLI tools live (Go, Rust, Homebrew, etc.).
 * Shell-expanded at runtime via `$HOME`.
 */
const LOCAL_EXTRA_PATH_DIRS = [
  "$HOME/go/bin",
  "$HOME/.local/bin",
  "$HOME/.cargo/bin",
  "/usr/local/bin",
  "/opt/homebrew/bin",
  "/usr/local/go/bin",
].join(":");

/**
 * Prepend common tool directories to PATH for local (non-E2B) sandboxes.
 * E2B sandboxes have their own pre-configured PATH and are left untouched.
 */
export function augmentCommandPath(
  command: string,
  sandbox: AnySandbox,
): string {
  if (isE2BSandbox(sandbox)) return command;
  // Windows local sandboxes use cmd.exe or git-bash — Unix PATH dirs
  // ($HOME/go/bin, /opt/homebrew/bin, etc.) don't apply, and `export`
  // syntax would break cmd.exe entirely.
  if (isCentrifugoSandbox(sandbox) && sandbox.isWindows()) return command;
  return `export PATH="${LOCAL_EXTRA_PATH_DIRS}:$PATH" && ${command}`;
}

/**
 * Build command options for sandbox execution.
 *
 * E2B sandbox requires user: "root" and cwd: "/home/user" for network tools
 * (ping, nmap, etc.) to work without sudo. CentrifugoSandbox (Docker) uses
 * --cap-add flags instead (NET_RAW, NET_ADMIN, SYS_PTRACE).
 *
 * @param sandbox - The sandbox instance
 * @param handlers - Optional stdout/stderr handlers for foreground commands
 * @returns Command options object
 */
export function buildSandboxCommandOptions(
  sandbox: AnySandbox,
  handlers?: {
    onStdout?: (data: string) => void;
    onStderr?: (data: string) => void;
  },
  extraEnvVars?: Record<string, string>,
  timeoutMs = DEFAULT_COMMAND_EXECUTION_TIME,
): {
  timeoutMs: number;
  user?: "root";
  cwd?: string;
  // Env vars are keyed differently per backend: E2B's commands.run reads `envs`,
  // CentrifugoSandbox reads `envVars`. We emit the right one for the sandbox so
  // injected keys (recon/OSINT, Caido) actually reach the process — passing only
  // `envVars` silently dropped them on E2B (the /hack Kali sandbox).
  envs?: Record<string, string>;
  envVars?: Record<string, string>;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
} {
  const e2b = isE2BSandbox(sandbox);
  return {
    timeoutMs:
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? Math.min(timeoutMs, MAX_COMMAND_EXECUTION_TIME)
        : DEFAULT_COMMAND_EXECUTION_TIME,
    // E2B specific: run as root with /home/user as working directory
    // This allows network tools (ping, nmap, etc.) to work without sudo
    ...(e2b && {
      user: "root" as const,
      cwd: "/home/user",
      // E2B runs commands through `bash -l -c`. HOME must never point at the
      // browser-writable workspace or a user-created .bash_profile would run
      // as root before the requested agent command.
      envs: {
        ...extraEnvVars,
        HOME: "/root",
        USER: "root",
        LOGNAME: "root",
      },
    }),
    ...(extraEnvVars && !e2b && { envVars: extraEnvVars }),
    ...(handlers && {
      onStdout: handlers.onStdout,
      onStderr: handlers.onStderr,
    }),
  };
}
