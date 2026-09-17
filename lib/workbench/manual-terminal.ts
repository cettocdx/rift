import "server-only";

import { posix } from "node:path";
import type { Sandbox } from "@e2b/code-interpreter";
import { z } from "zod";
import { WorkbenchRequestError } from "./workspace-server";
import {
  DEFAULT_WORKBENCH_TERMINAL_CWD,
  type WorkbenchTerminalResult,
} from "./terminal-contract";

export const MAX_WORKBENCH_TERMINAL_COMMAND_BYTES = 4 * 1024;
export const MAX_WORKBENCH_TERMINAL_OUTPUT_BYTES = 128 * 1024;
export const WORKBENCH_TERMINAL_TIMEOUT_MS = 20_000;

const TERMINAL_RUNTIME_HOME = "/var/lib/rift-cli-home";
const TERMINAL_TRUSTED_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

const VERIFIED_TERMINAL_PROCESS_CLEANUP = String.raw`
rift_no_live_user_processes() {
  rift_seen_pids=""
  for rift_uid_flag in -u -U; do
    set +e
    rift_pids=$(/usr/bin/pgrep "$rift_uid_flag" user 2>/dev/null)
    rift_pgrep_status=$?
    set -e
    case "$rift_pgrep_status" in
      0) [ -n "$rift_pids" ] || exit 72 ;;
      1) rift_pids="" ;;
      *) exit 72 ;;
    esac
    rift_seen_pids="$rift_seen_pids $rift_pids"
  done

  for rift_pid in $rift_seen_pids; do
    case "$rift_pid" in
      ''|*[!0-9]*) exit 72 ;;
    esac
    set +e
    rift_process_state=$(/usr/bin/ps -p "$rift_pid" -o stat= 2>/dev/null)
    rift_ps_status=$?
    set -e
    case "$rift_ps_status" in
      0) ;;
      1) continue ;;
      *) exit 72 ;;
    esac
    set +e
    printf '%s\n' "$rift_process_state" | /usr/bin/grep -Eq '^[[:space:]]*Z'
    rift_zombie_status=$?
    set -e
    case "$rift_zombie_status" in
      0) ;;
      1) return 1 ;;
      *) exit 72 ;;
    esac
  done
  return 0
}

rift_kill_user_processes() {
  for rift_cleanup_attempt in 1 2 3 4 5 6 7 8 9 10; do
    for rift_uid_flag in -u -U; do
      set +e
      /usr/bin/pkill -KILL "$rift_uid_flag" user >/dev/null 2>&1
      rift_pkill_status=$?
      set -e
      case "$rift_pkill_status" in
        0|1) ;;
        *) exit 71 ;;
      esac
    done
    if rift_no_live_user_processes; then
      /usr/bin/sleep 0.02
      if rift_no_live_user_processes; then
        return 0
      fi
    fi
    /usr/bin/sleep 0.05
  done
  exit 72
}

rift_kill_user_processes
`;

// This command runs as root before any browser-controlled command. The CLI
// sandbox has its own namespace, so revoking the template user's sudo access
// does not affect the privileged agent sandbox. A root-owned login home keeps
// E2B's login-shell wrapper from reading user-mutable profiles, while the
// writable workspace remains available to the unprivileged command itself.
const HARDEN_TERMINAL_SANDBOX_COMMAND = String.raw`
set -eu
for rift_required_binary in /usr/bin/pkill /usr/bin/pgrep /usr/bin/ps /usr/bin/sleep /usr/bin/id /usr/bin/grep /usr/bin/gpasswd /usr/bin/passwd /usr/bin/sed /usr/bin/install /usr/bin/stat /usr/bin/getent /usr/bin/cut /usr/bin/su /usr/bin/find /usr/bin/chmod /usr/sbin/usermod; do
  [ -x "$rift_required_binary" ] || exit 70
done
${VERIFIED_TERMINAL_PROCESS_CLEANUP}
if /usr/bin/id -nG user | /usr/bin/grep -qw sudo; then
  /usr/bin/gpasswd -d user sudo >/dev/null
fi
/usr/bin/passwd -l user >/dev/null
/usr/bin/sed -i '/^[[:space:]]*user[[:space:]].*ALL=/d' /etc/sudoers
if [ -d /etc/sudoers.d ]; then
  for rift_sudo_file in /etc/sudoers.d/*; do
    [ -f "$rift_sudo_file" ] || continue
    /usr/bin/sed -i '/^[[:space:]]*user[[:space:]]/d' "$rift_sudo_file"
  done
fi
/usr/bin/install -d -m 0755 -o root -g root /var/lib/rift-cli-home
/usr/bin/install -d -m 0750 -o user -g user /home/user/workspace
/usr/bin/chown root:root /home/user
/usr/bin/chmod 0755 /home/user
for rift_profile in .bash_profile .bash_login .bash_logout .bashrc .profile; do
  : > "/home/user/$rift_profile"
  /usr/bin/chown root:root "/home/user/$rift_profile"
  /usr/bin/chmod 0444 "/home/user/$rift_profile"
  : > "/var/lib/rift-cli-home/$rift_profile"
  /usr/bin/chown root:root "/var/lib/rift-cli-home/$rift_profile"
  /usr/bin/chmod 0444 "/var/lib/rift-cli-home/$rift_profile"
done
/usr/sbin/usermod -d /var/lib/rift-cli-home -s /bin/bash user
rift_privilege_roots=""
for rift_privilege_root in /bin /sbin /usr/bin /usr/sbin /usr/local/bin /usr/local/sbin; do
  [ -d "$rift_privilege_root" ] || continue
  rift_privilege_roots="$rift_privilege_roots $rift_privilege_root"
done
[ -n "$rift_privilege_roots" ] || exit 81
/usr/bin/find $rift_privilege_roots -xdev -type f -perm /6000 -exec /usr/bin/chmod a-s {} +
/usr/bin/id -nG user | /usr/bin/grep -qw sudo && exit 73
[ "$(/usr/bin/passwd -S user | /usr/bin/cut -d' ' -f2)" = "L" ] || exit 80
if [ -x /usr/bin/sudo ] && /usr/bin/su -s /bin/sh -c '/usr/bin/sudo -n true' user >/dev/null 2>&1; then
  exit 74
fi
[ "$(/usr/bin/stat -c '%U:%G:%a' /home/user)" = "root:root:755" ] || exit 75
[ "$(/usr/bin/stat -c '%U:%G:%a' /home/user/workspace)" = "user:user:750" ] || exit 76
[ "$(/usr/bin/getent passwd user | /usr/bin/cut -d: -f6)" = "/var/lib/rift-cli-home" ] || exit 77
for rift_profile in .bash_profile .bash_login .bash_logout .bashrc .profile; do
  [ "$(/usr/bin/stat -c '%U:%G:%a' "/home/user/$rift_profile")" = "root:root:444" ] || exit 78
  [ "$(/usr/bin/stat -c '%U:%G:%a' "/var/lib/rift-cli-home/$rift_profile")" = "root:root:444" ] || exit 79
done
set +e
rift_privileged_files=$(/usr/bin/find $rift_privilege_roots -xdev -type f -perm /6000 -print -quit 2>/dev/null)
rift_find_status=$?
set -e
[ "$rift_find_status" -eq 0 ] || exit 81
[ -z "$rift_privileged_files" ] || exit 82
`;

const CLEAN_TERMINAL_PROCESSES_COMMAND = String.raw`
set -eu
for rift_required_binary in /usr/bin/pkill /usr/bin/pgrep /usr/bin/ps /usr/bin/grep /usr/bin/sleep; do
  [ -x "$rift_required_binary" ] || exit 70
done
${VERIFIED_TERMINAL_PROCESS_CLEANUP}
`;

const terminalCommandSchema = z
  .object({
    command: z
      .string()
      .min(1)
      .max(MAX_WORKBENCH_TERMINAL_COMMAND_BYTES)
      .refine((value) => !/[\u0000\r\n]/.test(value))
      .refine(
        (value) =>
          Buffer.byteLength(value, "utf8") <=
          MAX_WORKBENCH_TERMINAL_COMMAND_BYTES,
      ),
    cwd: z
      .string()
      .min(1)
      .max(1024)
      .refine(
        (value) =>
          value.startsWith("/") &&
          !value.includes("\\") &&
          !/[\u0000-\u001f\u007f]/.test(value),
      ),
  })
  .strict();

const encodedOutputLimit =
  Math.ceil((MAX_WORKBENCH_TERMINAL_OUTPUT_BYTES * 4) / 3) + 8;
const runnerResultSchema = z.object({
  stdout: z.string().max(encodedOutputLimit),
  stderr: z.string().max(encodedOutputLimit),
  exitCode: z.number().int().min(-255).max(255),
  cwd: z
    .string()
    .min(1)
    .max(4096)
    .refine(
      (value) =>
        value.startsWith("/") &&
        !value.includes("\\") &&
        !/[\u0000-\u001f\u007f]/.test(value),
    ),
  timedOut: z.boolean(),
  stdoutTruncated: z.boolean(),
  stderrTruncated: z.boolean(),
  durationMs: z.number().int().nonnegative().max(60_000),
  error: z.string().max(500).optional(),
});

export type WorkbenchTerminalCommand = z.infer<typeof terminalCommandSchema>;

// The browser-controlled command is passed in an environment variable and is
// evaluated only inside the isolated CLI sandbox. This fixed runner drains
// stdout/stderr continuously, bounds the retained bytes, enforces a wall-clock
// timeout, and records the shell's final working directory for the next line.
const TERMINAL_RUNNER_SOURCE = String.raw`
import base64
import json
import os
import signal
import subprocess
import tempfile
import threading
import time

max_bytes = int(os.environ["RIFT_MAX_OUTPUT_BYTES"])
timeout_seconds = float(os.environ["RIFT_TIMEOUT_SECONDS"])
command = os.environ["RIFT_COMMAND"]
requested_cwd = os.environ["RIFT_CWD"]
started = time.monotonic()
cwd_fd, cwd_path = tempfile.mkstemp(prefix="rift-cli-cwd-")
os.close(cwd_fd)

shell_source = r'''
__rift_capture_cwd() {
  __rift_status=$?
  trap - EXIT
  pwd -P > "$RIFT_CWD_FILE" 2>/dev/null || true
  exit "$__rift_status"
}
trap __rift_capture_cwd EXIT
eval "$RIFT_COMMAND"
'''

buffers = {"stdout": bytearray(), "stderr": bytearray()}
truncated = {"stdout": False, "stderr": False}

def drain(stream, key):
    while True:
        chunk = stream.read(8192)
        if not chunk:
            break
        remaining = max_bytes - len(buffers[key])
        if remaining > 0:
            buffers[key].extend(chunk[:remaining])
        if len(chunk) > max(remaining, 0):
            truncated[key] = True

result = None
try:
    child_env = {
        "HOME": "/home/user/workspace",
        "USER": "user",
        "LOGNAME": "user",
        "SHELL": "/bin/bash",
        "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "TERM": "xterm-256color",
        "RIFT_COMMAND": command,
        "RIFT_CWD_FILE": cwd_path,
    }
    process = subprocess.Popen(
        ["bash", "--noprofile", "--norc", "-c", shell_source],
        cwd=requested_cwd,
        env=child_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    stdout_thread = threading.Thread(
        target=drain, args=(process.stdout, "stdout"), daemon=True
    )
    stderr_thread = threading.Thread(
        target=drain, args=(process.stderr, "stderr"), daemon=True
    )
    stdout_thread.start()
    stderr_thread.start()

    timed_out = False
    try:
        exit_code = process.wait(timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        timed_out = True
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=0.75)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
        exit_code = 124

    stdout_thread.join(timeout=2)
    stderr_thread.join(timeout=2)
    final_cwd = requested_cwd
    try:
        with open(cwd_path, "r", encoding="utf-8") as cwd_file:
            captured_cwd = cwd_file.read(4096).strip()
            if (
                captured_cwd.startswith("/")
                and "\\" not in captured_cwd
                and not any(ord(char) < 32 or ord(char) == 127 for char in captured_cwd)
            ):
                final_cwd = captured_cwd
    except OSError:
        pass

    result = {
        "stdout": base64.b64encode(bytes(buffers["stdout"])).decode("ascii"),
        "stderr": base64.b64encode(bytes(buffers["stderr"])).decode("ascii"),
        "exitCode": exit_code,
        "cwd": final_cwd,
        "timedOut": timed_out,
        "stdoutTruncated": truncated["stdout"],
        "stderrTruncated": truncated["stderr"],
        "durationMs": round((time.monotonic() - started) * 1000),
    }
except (FileNotFoundError, NotADirectoryError, PermissionError) as error:
    result = {
        "stdout": "",
        "stderr": "",
        "exitCode": 1,
        "cwd": requested_cwd,
        "timedOut": False,
        "stdoutTruncated": False,
        "stderrTruncated": False,
        "durationMs": round((time.monotonic() - started) * 1000),
        "error": str(error),
    }
finally:
    try:
        os.unlink(cwd_path)
    except OSError:
        pass

print(json.dumps(result, separators=(",", ":")))
`;

export function parseWorkbenchTerminalCommand(
  value: unknown,
): WorkbenchTerminalCommand {
  const parsed = terminalCommandSchema.safeParse(value);
  if (!parsed.success || !parsed.data.command.trim()) {
    throw new WorkbenchRequestError(
      "Enter one terminal command and a valid working directory.",
      400,
      "invalid_terminal_command",
    );
  }

  return {
    command: parsed.data.command,
    cwd: posix.normalize(parsed.data.cwd) || DEFAULT_WORKBENCH_TERMINAL_CWD,
  };
}

function decodeRunnerOutput(value: string, field: "stdout" | "stderr") {
  const buffer = Buffer.from(value, "base64");
  if (buffer.toString("base64") !== value) {
    throw new WorkbenchRequestError(
      `The terminal returned invalid ${field} data.`,
      502,
      "invalid_terminal_response",
    );
  }
  return buffer.toString("utf8");
}

async function hardenTerminalSandbox(sandbox: Sandbox) {
  try {
    await sandbox.commands.run(HARDEN_TERMINAL_SANDBOX_COMMAND, {
      cwd: "/",
      user: "root",
      timeoutMs: 10_000,
      envs: {
        HOME: "/root",
        PATH: TERMINAL_TRUSTED_PATH,
      },
    });
  } catch {
    await sandbox.kill().catch(() => {});
    throw new WorkbenchRequestError(
      "The isolated command sandbox could not be secured.",
      503,
      "terminal_hardening_failed",
      { retryable: true },
    );
  }
}

async function cleanTerminalProcesses(sandbox: Sandbox) {
  try {
    await sandbox.commands.run(CLEAN_TERMINAL_PROCESSES_COMMAND, {
      cwd: "/",
      user: "root",
      timeoutMs: 5_000,
      envs: { HOME: "/root", PATH: TERMINAL_TRUSTED_PATH },
    });
  } catch {
    // If cleanup cannot be proven, discard the entire isolated VM so a daemon
    // or a tampered profile is never inherited by the next request.
    await sandbox.kill().catch(() => {});
    throw new WorkbenchRequestError(
      "The isolated command sandbox was reset after cleanup failed.",
      503,
      "terminal_cleanup_failed",
      { retryable: true },
    );
  }
}

export async function runWorkbenchTerminalCommand(
  sandbox: Sandbox,
  input: WorkbenchTerminalCommand,
  signal?: AbortSignal,
): Promise<WorkbenchTerminalResult> {
  const command = parseWorkbenchTerminalCommand(input);
  await hardenTerminalSandbox(sandbox);

  let result;
  let runnerError: unknown;
  try {
    result = await sandbox.commands.run(
      'exec /usr/bin/python3 -I -S -c "$RIFT_TERMINAL_RUNNER"',
      {
        cwd: DEFAULT_WORKBENCH_TERMINAL_CWD,
        user: "user",
        timeoutMs: WORKBENCH_TERMINAL_TIMEOUT_MS + 10_000,
        signal,
        envs: {
          HOME: TERMINAL_RUNTIME_HOME,
          PATH: TERMINAL_TRUSTED_PATH,
          LANG: "C.UTF-8",
          LC_ALL: "C.UTF-8",
          RIFT_TERMINAL_RUNNER: TERMINAL_RUNNER_SOURCE,
          RIFT_COMMAND: command.command,
          RIFT_CWD: command.cwd,
          RIFT_MAX_OUTPUT_BYTES: String(MAX_WORKBENCH_TERMINAL_OUTPUT_BYTES),
          RIFT_TIMEOUT_SECONDS: String(WORKBENCH_TERMINAL_TIMEOUT_MS / 1000),
        },
      },
    );
  } catch (error) {
    runnerError = error;
  }

  await cleanTerminalProcesses(sandbox);
  if (runnerError || !result) {
    throw new WorkbenchRequestError(
      signal?.aborted
        ? "The command was interrupted."
        : "The isolated command runner could not complete the request.",
      signal?.aborted ? 499 : 502,
      signal?.aborted ? "terminal_interrupted" : "terminal_runner_failed",
      { retryable: !signal?.aborted },
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    throw new WorkbenchRequestError(
      "The isolated terminal returned an invalid response.",
      502,
      "invalid_terminal_response",
    );
  }

  const parsed = runnerResultSchema.safeParse(json);
  if (!parsed.success) {
    throw new WorkbenchRequestError(
      "The isolated terminal returned an invalid response.",
      502,
      "invalid_terminal_response",
    );
  }
  if (parsed.data.error) {
    throw new WorkbenchRequestError(
      "That terminal working directory is not available.",
      400,
      "invalid_terminal_cwd",
    );
  }

  return {
    stdout: decodeRunnerOutput(parsed.data.stdout, "stdout"),
    stderr: decodeRunnerOutput(parsed.data.stderr, "stderr"),
    exitCode: parsed.data.exitCode,
    cwd: posix.normalize(parsed.data.cwd),
    timedOut: parsed.data.timedOut,
    truncated: parsed.data.stdoutTruncated || parsed.data.stderrTruncated,
    durationMs: parsed.data.durationMs,
  };
}
