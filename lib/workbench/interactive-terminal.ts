import { createFlowControlledTerminalStream } from "./flow-controlled-terminal-stream";
import "server-only";

import { randomBytes } from "node:crypto";
import type { ProcessInfo, Sandbox } from "@e2b/code-interpreter";
import { CommandExitError } from "@e2b/code-interpreter";
import { z } from "zod";
import {
  connectE2BPtyHandle,
  createE2BPtyHandle,
} from "@/lib/ai/tools/utils/e2b-pty-adapter";
import {
  DEFAULT_PTY_COLS,
  DEFAULT_PTY_ROWS,
  PtySessionManager,
  SESSION_MAX_LIFETIME_MS,
  type PtySession,
} from "@/lib/ai/tools/utils/pty-session-manager";
import {
  MAX_WORKBENCH_TERMINAL_COLS,
  MAX_WORKBENCH_TERMINAL_INPUT_BYTES,
  MAX_WORKBENCH_TERMINAL_ROWS,
  MAX_WORKBENCH_TERMINALS_PER_WORKSPACE,
  MIN_WORKBENCH_TERMINAL_COLS,
  MIN_WORKBENCH_TERMINAL_ROWS,
  WORKBENCH_CLIENT_TERMINAL_ID_PATTERN,
  WORKBENCH_TERMINAL_INPUT_LEASE_HEADER,
  WORKBENCH_TERMINAL_PROFILES,
  type WorkbenchCreateTerminalRequest,
  type WorkbenchInteractiveTerminalSummary,
  type WorkbenchTerminalProfile,
  type WorkbenchTerminalResizeRequest,
  type WorkbenchTerminalStreamEvent,
} from "./interactive-terminal-contract";
import {
  WORKBENCH_ROOT,
  absoluteWorkspacePath,
  normalizeWorkspacePath,
} from "./path-policy";
import {
  WorkbenchRequestError,
  assertWorkspaceDirectoryAccess,
} from "./workspace-server";
import {
  revokeWorkbenchTerminalInputLeases,
  type WorkbenchTerminalInputSender,
} from "./terminal-input-lease";
import {
  createLocalPtyHandle,
  resolveLocalTerminalCwd,
  resolveLocalTerminalLaunch,
} from "./local-pty-adapter";

const WORKBENCH_PTY_USER = "user" as const;
const WORKBENCH_PTY_VERSION = "2";
const WORKBENCH_PTY_SESSION_ENV = "RIFT_WORKBENCH_SESSION_ID";
const WORKBENCH_PTY_CLIENT_TERMINAL_ENV = "RIFT_WORKBENCH_CLIENT_TERMINAL_ID";
const WORKBENCH_PTY_MARKER_ENV = "RIFT_WORKBENCH_PTY_VERSION";
const SESSION_ID_PATTERN = /^[a-f0-9]{24}$/;
const MAX_CREATE_BODY_BYTES = 4 * 1024;
const MAX_MUTATION_BODY_BYTES = 32 * 1024;
const SSE_HEARTBEAT_MS = 15_000;
export const WORKBENCH_TERMINAL_SSE_ROTATE_MS = 255_000;

const RUNTIME_ROOT = "/var/lib/rift-workbench";
const LOGIN_HOME = `${RUNTIME_ROOT}/home`;
const LAUNCHER_SOURCE_PATH = `${RUNTIME_ROOT}/rift-workbench-shell.c`;
const ROOT_LOGIN_GUARD_PATH = `${RUNTIME_ROOT}/root-login-guard`;
const ROOT_COMMAND_ENVS = {
  HOME: "/root",
  USER: "root",
  LOGNAME: "root",
} as const;

export const MAX_WORKBENCH_TERMINAL_CREATE_BODY_BYTES = MAX_CREATE_BODY_BYTES;
export const MAX_WORKBENCH_TERMINAL_MUTATION_BODY_BYTES =
  MAX_MUTATION_BODY_BYTES;

const createSchema = z
  .object({
    cols: z
      .number()
      .int()
      .min(MIN_WORKBENCH_TERMINAL_COLS)
      .max(MAX_WORKBENCH_TERMINAL_COLS)
      .optional(),
    rows: z
      .number()
      .int()
      .min(MIN_WORKBENCH_TERMINAL_ROWS)
      .max(MAX_WORKBENCH_TERMINAL_ROWS)
      .optional(),
    cwd: z.string().max(1024).optional(),
    clientTerminalId: z
      .string()
      .regex(WORKBENCH_CLIENT_TERMINAL_ID_PATTERN)
      .optional(),
    profile: z.enum(["shell", "claude", "codex", "grok"]).optional(),
  })
  .strict();

const encodedInputLimit =
  Math.ceil((MAX_WORKBENCH_TERMINAL_INPUT_BYTES * 4) / 3) + 4;
const inputSchema = z
  .object({
    data: z.string().min(4).max(encodedInputLimit),
  })
  .strict();

const resizeSchema = z
  .object({
    cols: z
      .number()
      .int()
      .min(MIN_WORKBENCH_TERMINAL_COLS)
      .max(MAX_WORKBENCH_TERMINAL_COLS),
    rows: z
      .number()
      .int()
      .min(MIN_WORKBENCH_TERMINAL_ROWS)
      .max(MAX_WORKBENCH_TERMINAL_ROWS),
  })
  .strict();

type SessionMetadata = {
  cwd: string;
  clientTerminalId: string | null;
  createdAt: number;
  expiresAt: number;
  profile: WorkbenchTerminalProfile;
  profileAvailable: boolean;
  backend: "local" | "remote";
};

type LocatedPty = {
  process: ProcessInfo;
  metadata: SessionMetadata & { cols: number; rows: number };
};

type ParsedCreateTerminalRequest = Required<
  Omit<WorkbenchCreateTerminalRequest, "clientTerminalId">
> & {
  clientTerminalId: string | null;
};

export type { ParsedCreateTerminalRequest };

// This workspace-scoped registry improves live streaming, mutation latency and
// ring-buffer replay on one Node instance. It is deliberately not treated as
// the durable source of truth: input and resize use the local handle when it is
// present, then fall back to locating the marked PTY in E2B and operating by
// pid. The events endpoint can likewise reconnect with sandbox.pty.connect().
// Output emitted while no instance is attached cannot be recovered by E2B, so
// the stream explicitly emits `reset: stream_reconnected` in that case.
// The ten-minute idle close is likewise best-effort on the owning Node
// instance. The launcher's alarm provides the instance-independent one-hour
// ceiling; a distributed idle lease belongs in the production follow-up.
type InteractiveTerminalProcessState = {
  sessions: PtySessionManager;
  localMetadata: Map<string, Map<string, SessionMetadata>>;
  preparedSandboxes: WeakMap<object, Promise<void>>;
  localCreates: Set<string>;
  sessionMutationChains: Map<string, Promise<void>>;
};

const processGlobal = globalThis as typeof globalThis & {
  __riftInteractiveTerminalState?: InteractiveTerminalProcessState;
};

function createInteractiveTerminalProcessState(): InteractiveTerminalProcessState {
  return {
    sessions: new PtySessionManager(),
    localMetadata: new Map(),
    preparedSandboxes: new WeakMap(),
    localCreates: new Set(),
    sessionMutationChains: new Map(),
  };
}

const processState =
  process.env.NODE_ENV === "test"
    ? createInteractiveTerminalProcessState()
    : (processGlobal.__riftInteractiveTerminalState ??=
        createInteractiveTerminalProcessState());
const {
  sessions,
  localMetadata,
  preparedSandboxes,
  localCreates,
  sessionMutationChains,
} = processState;

const LAUNCHER_SOURCE = String.raw`
#define _GNU_SOURCE
#include <errno.h>
#include <grp.h>
#include <pwd.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

static void fail(const char *message) {
  dprintf(STDERR_FILENO, "rift terminal launcher: %s\n", message);
  _exit(126);
}

int main(int argc, char **argv) {
  (void)argv;
  if (argc != 1) fail("arguments are not accepted");
  if (geteuid() != 0) fail("setuid transition unavailable");

  struct passwd *user = getpwnam("user");
  if (user == NULL) fail("sandbox user unavailable");

  for (int cap = 0; cap <= 63; cap++) {
    if (prctl(PR_CAPBSET_DROP, cap, 0, 0, 0) != 0 && errno != EINVAL) {
      fail("could not clear capability bounding set");
    }
  }
  if (setgroups(0, NULL) != 0) fail("could not clear supplementary groups");
  if (setresgid(user->pw_gid, user->pw_gid, user->pw_gid) != 0) {
    fail("could not drop group privileges");
  }
  if (setresuid(user->pw_uid, user->pw_uid, user->pw_uid) != 0) {
    fail("could not drop user privileges");
  }
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
    fail("could not enable no-new-privileges");
  }
  (void)prctl(PR_SET_DUMPABLE, 0, 0, 0, 0);

  // alarm() survives exec. This is the durable one-hour wall-clock cap even
  // if the Next.js instance that owns the in-memory idle timer disappears.
  signal(SIGALRM, SIG_DFL);
  alarm(3600);
  umask(0022);

  clearenv();
  setenv("HOME", "/home/user", 1);
  setenv("USER", "user", 1);
  setenv("LOGNAME", "user", 1);
  setenv("SHELL", "/bin/bash", 1);
  setenv("TERM", "xterm-256color", 1);
  setenv("COLORTERM", "truecolor", 1);
  setenv("PATH", "/home/user/.local/bin:/home/user/go/bin:/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", 1);
  setenv("PS1", "\\[\\e[38;5;111m\\]rift\\[\\e[0m\\] \\[\\e[38;5;244m\\]\\w\\[\\e[0m\\]\\n❯ ", 1);
  setenv("HISTFILE", "/home/user/.rift_history", 1);

  char *const shell_argv[] = {"bash", "--noprofile", "--norc", "-i", NULL};
  execv("/bin/bash", shell_argv);
  fail("could not start bash");
}
`;

const LOGIN_PROFILE = [
  "# Root-owned Workbench login boundary.",
  `if [ "\${${WORKBENCH_PTY_MARKER_ENV}:-}" = "${WORKBENCH_PTY_VERSION}" ] &&`,
  `   [ -n "\${${WORKBENCH_PTY_SESSION_ENV}:-}" ]; then`,
  "  exec /usr/local/libexec/rift-workbench-shell",
  "  exit 126",
  "fi",
  "",
].join("\n");

const ROOT_LOGIN_GUARD = String.raw`
# RIFT_WORKBENCH_ROOT_HOME_V1
if [ "$(/usr/bin/id -u)" = "0" ]; then
  HOME=/root
  USER=root
  LOGNAME=root
  export HOME USER LOGNAME
fi
`;

const PREPARE_DIRECTORIES_COMMAND = String.raw`
set -eu
/usr/bin/install -d -m 0755 -o root -g root /var/lib/rift-workbench
/usr/bin/install -d -m 0755 -o root -g root /var/lib/rift-workbench/home
/usr/bin/install -d -m 0755 -o root -g root /usr/local/libexec
`;

// E2B currently creates PTYs with `/bin/bash -i -l` even when passwd(5)
// specifies another shell. We therefore set the passwd shell as defense in
// depth *and* make the login home's root-owned .bash_profile exec the same
// tiny launcher. The launcher is the only remaining setuid executable and can
// only drop to `user`; it accepts no arguments and can never return a root
// shell. No browser handle is returned before the post-create /proc check.
const HARDEN_INTERACTIVE_TERMINAL_COMMAND = String.raw`
set -eu
for rift_bin in /usr/bin/cc /usr/bin/install /usr/bin/chown /usr/bin/chmod /usr/bin/mv /usr/bin/find /usr/bin/sed /usr/bin/id /usr/bin/grep /usr/bin/getent /usr/bin/cut /usr/bin/passwd /usr/bin/stat /usr/bin/cat /usr/sbin/usermod; do
  [ -x "$rift_bin" ] || exit 70
done

/usr/bin/cc -O2 -Wall -Wextra -Werror -o /usr/local/libexec/.rift-workbench-shell.next /var/lib/rift-workbench/rift-workbench-shell.c
/usr/bin/chown root:root /usr/local/libexec/.rift-workbench-shell.next
/usr/bin/chmod 4755 /usr/local/libexec/.rift-workbench-shell.next
/usr/bin/mv -f /usr/local/libexec/.rift-workbench-shell.next /usr/local/libexec/rift-workbench-shell

/usr/bin/chown root:root /var/lib/rift-workbench/home/.bash_profile /var/lib/rift-workbench/home/.profile /var/lib/rift-workbench/rift-workbench-shell.c /var/lib/rift-workbench/root-login-guard
/usr/bin/chmod 0444 /var/lib/rift-workbench/home/.bash_profile /var/lib/rift-workbench/home/.profile /var/lib/rift-workbench/rift-workbench-shell.c /var/lib/rift-workbench/root-login-guard
/usr/sbin/usermod -d /var/lib/rift-workbench/home -s /usr/local/libexec/rift-workbench-shell user

# E2B executes every commands.run call through bash -l -c. Once the browser
# can write /home/user, a privileged login shell must canonicalize root's HOME
# before Bash selects a per-user profile. This root-owned /etc/profile guard is
# defense in depth; every root command in this setup also passes HOME=/root.
if ! /usr/bin/grep -q '^# RIFT_WORKBENCH_ROOT_HOME_V1$' /etc/profile; then
  /usr/bin/cat /etc/profile /var/lib/rift-workbench/root-login-guard > /etc/.profile.rift-next
  /usr/bin/chown root:root /etc/.profile.rift-next
  /usr/bin/chmod 0644 /etc/.profile.rift-next
  /usr/bin/mv -f /etc/.profile.rift-next /etc/profile
fi

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

# Old builds configured server-managed Git credentials under /home/user.
# Agent commands run explicitly as root, so their credential store now lives
# under /root. User project files remain shared intentionally; server-owned
# credentials do not.
/usr/bin/rm -f /home/user/.git-credentials /home/user/.gitconfig /home/user/.netrc /home/user/.npmrc /home/user/.pypirc

rift_privilege_roots=""
for rift_root in /bin /sbin /usr/bin /usr/sbin /usr/local/bin /usr/local/sbin; do
  [ -d "$rift_root" ] || continue
  rift_privilege_roots="$rift_privilege_roots $rift_root"
done
[ -n "$rift_privilege_roots" ] || exit 71
/usr/bin/find $rift_privilege_roots -xdev -type f -perm /6000 ! -path /usr/local/libexec/rift-workbench-shell -exec /usr/bin/chmod a-s {} +

[ "$(/usr/bin/getent passwd user | /usr/bin/cut -d: -f6)" = "/var/lib/rift-workbench/home" ] || exit 72
[ "$(/usr/bin/getent passwd user | /usr/bin/cut -d: -f7)" = "/usr/local/libexec/rift-workbench-shell" ] || exit 73
[ "$(/usr/bin/stat -c '%U:%G:%a' /usr/local/libexec/rift-workbench-shell)" = "root:root:4755" ] || exit 74
[ "$(/usr/bin/stat -c '%U:%G:%a' /var/lib/rift-workbench/home/.bash_profile)" = "root:root:444" ] || exit 75
/usr/bin/id -nG user | /usr/bin/grep -qw sudo && exit 76
if [ -x /usr/bin/sudo ] && /usr/bin/su -s /bin/sh -c '/usr/bin/sudo -n true' user >/dev/null 2>&1; then
  exit 77
fi
set +e
rift_other_privileged=$(/usr/bin/find $rift_privilege_roots -xdev -type f -perm /6000 ! -path /usr/local/libexec/rift-workbench-shell -print -quit 2>/dev/null)
rift_find_status=$?
set -e
[ "$rift_find_status" -eq 0 ] || exit 78
[ -z "$rift_other_privileged" ] || exit 79
`;

const ACQUIRE_CREATE_LOCK_COMMAND = String.raw`
set -eu
if /usr/bin/mkdir /var/lib/rift-workbench/create.lock 2>/dev/null; then
  exit 0
fi
rift_now=$(/usr/bin/date +%s)
rift_mtime=$(/usr/bin/stat -c %Y /var/lib/rift-workbench/create.lock 2>/dev/null || printf '0')
case "$rift_mtime" in ''|*[!0-9]*) exit 91 ;; esac
if [ $((rift_now - rift_mtime)) -gt 30 ]; then
  /usr/bin/rm -rf /var/lib/rift-workbench/create.lock
  /usr/bin/mkdir /var/lib/rift-workbench/create.lock
  exit 0
fi
exit 91
`;

const VERIFY_PTY_SECURITY_COMMAND = String.raw`
set -eu
case "$RIFT_PTY_PID" in ''|*[!0-9]*) exit 80 ;; esac
rift_expected_uid=$(/usr/bin/id -u user)
rift_status=/proc/$RIFT_PTY_PID/status
rift_ok=0
for rift_attempt in $(/usr/bin/seq 1 60); do
  if [ -r "$rift_status" ]; then
    rift_uids=$(/usr/bin/awk '/^Uid:/{print $2 " " $3 " " $4 " " $5}' "$rift_status")
    rift_nnp=$(/usr/bin/awk '/^NoNewPrivs:/{print $2}' "$rift_status")
    rift_eff=$(/usr/bin/awk '/^CapEff:/{print $2}' "$rift_status")
    rift_bnd=$(/usr/bin/awk '/^CapBnd:/{print $2}' "$rift_status")
    if [ "$rift_uids" = "$rift_expected_uid $rift_expected_uid $rift_expected_uid $rift_expected_uid" ] && [ "$rift_nnp" = "1" ] && printf '%s' "$rift_eff" | /usr/bin/grep -Eq '^0+$' && printf '%s' "$rift_bnd" | /usr/bin/grep -Eq '^0+$'; then
      rift_ok=1
      break
    fi
  fi
  /usr/bin/sleep 0.05
done
[ "$rift_ok" -eq 1 ] || exit 81
if [ -x /usr/bin/sudo ] && /usr/bin/su -s /bin/sh -c '/usr/bin/sudo -n true' user >/dev/null 2>&1; then
  exit 82
fi
[ "$(/usr/bin/getent passwd user | /usr/bin/cut -d: -f7)" = "/usr/local/libexec/rift-workbench-shell" ] || exit 83
`;

function metadataMap(workspaceKey: string) {
  let map = localMetadata.get(workspaceKey);
  if (!map) {
    map = new Map();
    localMetadata.set(workspaceKey, map);
  }
  return map;
}

function sessionMutationKey(workspaceKey: string, sessionId: string) {
  return `${workspaceKey}\0${sessionId}`;
}

async function enqueueSessionMutation<T>(
  workspaceKey: string,
  sessionId: string,
  mutation: () => Promise<T>,
): Promise<T> {
  const key = sessionMutationKey(workspaceKey, sessionId);
  const previous = sessionMutationChains.get(key) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(mutation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  sessionMutationChains.set(key, tail);
  try {
    return await result;
  } finally {
    if (sessionMutationChains.get(key) === tail) {
      sessionMutationChains.delete(key);
    }
  }
}

function positiveInteger(value: string | undefined, fallback: number) {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function processMetadata(process: ProcessInfo): LocatedPty["metadata"] {
  const createdAt = positiveInteger(
    process.envs.RIFT_WORKBENCH_CREATED_AT,
    Date.now(),
  );
  const clientTerminalId = process.envs[WORKBENCH_PTY_CLIENT_TERMINAL_ENV];
  return {
    cwd: process.envs.RIFT_WORKBENCH_CWD || process.cwd || WORKBENCH_ROOT,
    clientTerminalId:
      clientTerminalId &&
      WORKBENCH_CLIENT_TERMINAL_ID_PATTERN.test(clientTerminalId)
        ? clientTerminalId
        : null,
    cols: positiveInteger(process.envs.RIFT_WORKBENCH_COLS, DEFAULT_PTY_COLS),
    rows: positiveInteger(process.envs.RIFT_WORKBENCH_ROWS, DEFAULT_PTY_ROWS),
    createdAt,
    expiresAt: positiveInteger(
      process.envs.RIFT_WORKBENCH_EXPIRES_AT,
      createdAt + SESSION_MAX_LIFETIME_MS,
    ),
    profile: "shell",
    profileAvailable: true,
    backend: "remote",
  };
}

function isWorkbenchPty(process: ProcessInfo) {
  return (
    process.envs?.[WORKBENCH_PTY_MARKER_ENV] === WORKBENCH_PTY_VERSION &&
    SESSION_ID_PATTERN.test(process.envs?.[WORKBENCH_PTY_SESSION_ENV] ?? "")
  );
}

async function runningWorkbenchPtys(sandbox: Sandbox) {
  const processes = await sandbox.commands.list();
  return processes.filter(isWorkbenchPty);
}

async function locatePty(
  sandbox: Sandbox,
  sessionId: string,
): Promise<LocatedPty | undefined> {
  const process = (await runningWorkbenchPtys(sandbox)).find(
    (candidate) => candidate.envs[WORKBENCH_PTY_SESSION_ENV] === sessionId,
  );
  if (!process) return undefined;
  const metadata = processMetadata(process);
  if (metadata.expiresAt <= Date.now()) {
    await sandbox.pty.kill(process.pid).catch(() => false);
    return undefined;
  }
  return { process, metadata };
}

async function prepareTerminalSandbox(sandbox: Sandbox) {
  const existing = preparedSandboxes.get(sandbox);
  if (existing) return existing;

  const preparation = (async () => {
    await sandbox.commands.run(PREPARE_DIRECTORIES_COMMAND, {
      user: "root",
      cwd: WORKBENCH_ROOT,
      timeoutMs: 10_000,
      envs: ROOT_COMMAND_ENVS,
    });
    await Promise.all([
      sandbox.files.write(LAUNCHER_SOURCE_PATH, LAUNCHER_SOURCE, {
        user: "root",
      }),
      sandbox.files.write(`${LOGIN_HOME}/.bash_profile`, LOGIN_PROFILE, {
        user: "root",
      }),
      sandbox.files.write(`${LOGIN_HOME}/.profile`, LOGIN_PROFILE, {
        user: "root",
      }),
      sandbox.files.write(ROOT_LOGIN_GUARD_PATH, ROOT_LOGIN_GUARD, {
        user: "root",
      }),
    ]);
    await sandbox.commands.run(HARDEN_INTERACTIVE_TERMINAL_COMMAND, {
      user: "root",
      cwd: WORKBENCH_ROOT,
      timeoutMs: 20_000,
      envs: ROOT_COMMAND_ENVS,
    });
  })();

  preparedSandboxes.set(sandbox, preparation);
  try {
    await preparation;
  } catch (error) {
    if (preparedSandboxes.get(sandbox) === preparation) {
      preparedSandboxes.delete(sandbox);
    }
    throw error;
  }
}

async function acquireCreateLock(sandbox: Sandbox) {
  try {
    await sandbox.commands.run(ACQUIRE_CREATE_LOCK_COMMAND, {
      user: "root",
      cwd: WORKBENCH_ROOT,
      timeoutMs: 5_000,
      envs: ROOT_COMMAND_ENVS,
    });
  } catch (error) {
    if (error instanceof CommandExitError && error.exitCode === 91) {
      throw new WorkbenchRequestError(
        "Another terminal session is being created.",
        409,
        "terminal_create_busy",
      );
    }
    throw error;
  }
}

async function releaseCreateLock(sandbox: Sandbox) {
  await sandbox.commands
    .run("/usr/bin/rmdir /var/lib/rift-workbench/create.lock", {
      user: "root",
      cwd: WORKBENCH_ROOT,
      timeoutMs: 5_000,
      envs: ROOT_COMMAND_ENVS,
    })
    .catch(() => undefined);
}

function summaryFromSession(
  workspaceKey: string,
  session: PtySession,
): WorkbenchInteractiveTerminalSummary {
  const metadata = metadataMap(workspaceKey).get(session.sessionId) ?? {
    cwd: WORKBENCH_ROOT,
    clientTerminalId: null,
    createdAt: session.createdAt,
    expiresAt: session.createdAt + SESSION_MAX_LIFETIME_MS,
    profile: "shell" as const,
    profileAvailable: true,
    backend: "remote" as const,
  };
  const exited = sessions.getExitInfo(session);
  return {
    id: session.sessionId,
    clientTerminalId: metadata.clientTerminalId,
    pid: session.pid,
    cwd: metadata.cwd,
    cols: session.cols,
    rows: session.rows,
    status: exited ? "exited" : "running",
    exitCode: exited?.exitCode ?? null,
    createdAt: metadata.createdAt,
    lastActivityAt: session.lastActivityAt,
    expiresAt: metadata.expiresAt,
    profile: metadata.profile,
    profileAvailable: metadata.profileAvailable,
    backend: metadata.backend,
  };
}

function summaryFromProcess(
  process: ProcessInfo,
): WorkbenchInteractiveTerminalSummary {
  const metadata = processMetadata(process);
  return {
    id: process.envs[WORKBENCH_PTY_SESSION_ENV],
    clientTerminalId: metadata.clientTerminalId,
    pid: process.pid,
    cwd: metadata.cwd,
    cols: metadata.cols,
    rows: metadata.rows,
    status: "running",
    exitCode: null,
    createdAt: metadata.createdAt,
    lastActivityAt: metadata.createdAt,
    expiresAt: metadata.expiresAt,
    profile: metadata.profile,
    profileAvailable: metadata.profileAvailable,
    backend: metadata.backend,
  };
}

export function parseCreateTerminalRequest(
  value: unknown,
): ParsedCreateTerminalRequest {
  const parsed = createSchema.safeParse(value);
  if (!parsed.success) {
    throw new WorkbenchRequestError(
      "Terminal size and working directory are invalid.",
      400,
      "invalid_terminal_session",
    );
  }
  const cwd = normalizeWorkspacePath(parsed.data.cwd ?? "");
  return {
    cols: parsed.data.cols ?? DEFAULT_PTY_COLS,
    rows: parsed.data.rows ?? DEFAULT_PTY_ROWS,
    cwd,
    clientTerminalId: parsed.data.clientTerminalId ?? null,
    profile: parsed.data.profile ?? "shell",
  };
}

export function parseTerminalInput(value: unknown): Uint8Array {
  const parsed = inputSchema.safeParse(value);
  if (
    !parsed.success ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      parsed.data?.data ?? "",
    )
  ) {
    throw new WorkbenchRequestError(
      "Terminal input must be canonical base64.",
      400,
      "invalid_terminal_input",
    );
  }
  const bytes = Buffer.from(parsed.data.data, "base64");
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_WORKBENCH_TERMINAL_INPUT_BYTES ||
    bytes.toString("base64") !== parsed.data.data
  ) {
    throw new WorkbenchRequestError(
      "Terminal input is invalid or too large.",
      400,
      "invalid_terminal_input",
    );
  }
  return bytes;
}

export function parseTerminalResize(
  value: unknown,
): WorkbenchTerminalResizeRequest {
  const parsed = resizeSchema.safeParse(value);
  if (!parsed.success) {
    throw new WorkbenchRequestError(
      "Terminal columns or rows are outside the supported range.",
      400,
      "invalid_terminal_size",
    );
  }
  return parsed.data;
}

export function parseTerminalSessionId(value: string) {
  if (!SESSION_ID_PATTERN.test(value)) {
    throw new WorkbenchRequestError(
      "Terminal session was not found.",
      404,
      "terminal_not_found",
    );
  }
  return value;
}

export function parseTerminalCursor(value: string | null) {
  if (value === null || value === "") return 0;
  if (!/^\d+$/.test(value)) {
    throw new WorkbenchRequestError(
      "Terminal output cursor is invalid.",
      400,
      "invalid_terminal_cursor",
    );
  }
  const cursor = Number(value);
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw new WorkbenchRequestError(
      "Terminal output cursor is invalid.",
      400,
      "invalid_terminal_cursor",
    );
  }
  return cursor;
}

export async function listInteractiveTerminalSessions(
  sandbox: Sandbox,
  workspaceKey: string,
) {
  const processes: ProcessInfo[] = [];
  for (const process of await runningWorkbenchPtys(sandbox)) {
    if (processMetadata(process).expiresAt <= Date.now()) {
      await sandbox.pty.kill(process.pid).catch(() => false);
    } else {
      processes.push(process);
    }
  }
  const runningIds = new Set(
    processes.map((process) => process.envs[WORKBENCH_PTY_SESSION_ENV]),
  );
  const local = sessions.list(workspaceKey).filter((session) => {
    // A route bundle can outlive the E2B process it originally attached to
    // (notably after a deploy or dev-server refresh). Never advertise that
    // stale in-memory handle as a running terminal. Exited sessions remain
    // useful to the current client for their final exit status.
    return (
      Boolean(sessions.getExitInfo(session)) ||
      runningIds.has(session.sessionId)
    );
  });
  const summaries = new Map(
    local.map((session) => [
      session.sessionId,
      summaryFromSession(workspaceKey, session),
    ]),
  );

  for (const process of processes) {
    const id = process.envs[WORKBENCH_PTY_SESSION_ENV];
    if (!summaries.has(id)) summaries.set(id, summaryFromProcess(process));
  }
  return { sessions: Array.from(summaries.values()) };
}

export async function createInteractiveTerminalSession(
  sandbox: Sandbox,
  workspaceKey: string,
  request: ParsedCreateTerminalRequest,
) {
  if (request.profile !== "shell") {
    throw new WorkbenchRequestError(
      `${WORKBENCH_TERMINAL_PROFILES.find(({ id }) => id === request.profile)?.label ?? "This agent CLI"} is unavailable in the isolated sandbox. Use the shell profile or open a local macOS workspace.`,
      409,
      "terminal_profile_unavailable",
    );
  }
  if (localCreates.has(workspaceKey)) {
    throw new WorkbenchRequestError(
      "Another terminal session is being created.",
      409,
      "terminal_create_busy",
    );
  }
  localCreates.add(workspaceKey);

  try {
    const existing = await listInteractiveTerminalSessions(
      sandbox,
      workspaceKey,
    );
    const runningSessions = existing.sessions.filter(
      (session) => session.status === "running",
    );
    const running = request.clientTerminalId
      ? runningSessions.find(
          (session) => session.clientTerminalId === request.clientTerminalId,
        )
      : runningSessions[0];
    if (running) {
      // Legacy callers without an id keep the original "reuse any running
      // terminal" behavior. Browser tabs with an id only ever reuse their own
      // PTY, so opening a second tab cannot silently take over the first.
      return { session: running, created: false } as const;
    }
    if (runningSessions.length >= MAX_WORKBENCH_TERMINALS_PER_WORKSPACE) {
      throw new WorkbenchRequestError(
        `A workspace can run up to ${MAX_WORKBENCH_TERMINALS_PER_WORKSPACE} terminals.`,
        409,
        "terminal_limit_reached",
      );
    }

    await assertWorkspaceDirectoryAccess(sandbox, request.cwd);
    await prepareTerminalSandbox(sandbox);
    await acquireCreateLock(sandbox);

    try {
      // Re-check under the sandbox lock to close the cross-instance race.
      const raced = await listInteractiveTerminalSessions(
        sandbox,
        workspaceKey,
      );
      const racedRunningSessions = raced.sessions.filter(
        (session) => session.status === "running",
      );
      const racedRunning = request.clientTerminalId
        ? racedRunningSessions.find(
            (session) => session.clientTerminalId === request.clientTerminalId,
          )
        : racedRunningSessions[0];
      if (racedRunning) {
        return { session: racedRunning, created: false } as const;
      }
      if (
        racedRunningSessions.length >= MAX_WORKBENCH_TERMINALS_PER_WORKSPACE
      ) {
        throw new WorkbenchRequestError(
          `A workspace can run up to ${MAX_WORKBENCH_TERMINALS_PER_WORKSPACE} terminals.`,
          409,
          "terminal_limit_reached",
        );
      }

      const sessionId = randomBytes(12).toString("hex");
      const createdAt = Date.now();
      const expiresAt = createdAt + SESSION_MAX_LIFETIME_MS;
      const cwd = absoluteWorkspacePath(request.cwd);
      const handle = await createE2BPtyHandle(sandbox, {
        user: WORKBENCH_PTY_USER,
        cols: request.cols,
        rows: request.rows,
        cwd,
        envs: {
          HOME: LOGIN_HOME,
          SHELL: "/usr/local/libexec/rift-workbench-shell",
          USER: WORKBENCH_PTY_USER,
          LOGNAME: WORKBENCH_PTY_USER,
          [WORKBENCH_PTY_MARKER_ENV]: WORKBENCH_PTY_VERSION,
          [WORKBENCH_PTY_SESSION_ENV]: sessionId,
          ...(request.clientTerminalId
            ? {
                [WORKBENCH_PTY_CLIENT_TERMINAL_ENV]: request.clientTerminalId,
              }
            : {}),
          RIFT_WORKBENCH_CREATED_AT: String(createdAt),
          RIFT_WORKBENCH_EXPIRES_AT: String(expiresAt),
          RIFT_WORKBENCH_CWD: cwd,
          RIFT_WORKBENCH_COLS: String(request.cols),
          RIFT_WORKBENCH_ROWS: String(request.rows),
        },
      });

      try {
        await sandbox.commands.run(VERIFY_PTY_SECURITY_COMMAND, {
          user: "root",
          cwd: WORKBENCH_ROOT,
          timeoutMs: 5_000,
          envs: {
            ...ROOT_COMMAND_ENVS,
            RIFT_PTY_PID: String(handle.pid),
          },
        });
      } catch (error) {
        await handle.kill().catch(() => undefined);
        console.error(
          `[workbench-terminal] PTY security verification failed pid=${handle.pid}`,
          error,
        );
        throw new WorkbenchRequestError(
          "The isolated terminal could not be started safely.",
          503,
          "terminal_security_check_failed",
        );
      }

      let session: PtySession;
      try {
        session = sessions.attach(workspaceKey, {
          sessionId,
          handle,
          cols: request.cols,
          rows: request.rows,
          createdAt,
          lastActivityAt: createdAt,
        });
      } catch (error) {
        await handle.kill().catch(() => undefined);
        throw error;
      }
      metadataMap(workspaceKey).set(sessionId, {
        cwd,
        clientTerminalId: request.clientTerminalId,
        createdAt,
        expiresAt,
        profile: "shell",
        profileAvailable: true,
        backend: "remote",
      });
      void handle.exited.then(() => {
        revokeWorkbenchTerminalInputLeases(workspaceKey, sessionId);
      });
      return {
        session: summaryFromSession(workspaceKey, session),
        created: true,
      } as const;
    } finally {
      await releaseCreateLock(sandbox);
    }
  } finally {
    localCreates.delete(workspaceKey);
  }
}

export async function listLocalInteractiveTerminalSessions(
  workspaceKey: string,
) {
  return {
    sessions: sessions
      .list(workspaceKey)
      .map((session) => summaryFromSession(workspaceKey, session)),
  };
}

async function removeExitedLocalTerminalSessions(workspaceKey: string) {
  const exited = sessions
    .list(workspaceKey)
    .filter((session) => sessions.getExitInfo(session));
  for (const session of exited) {
    revokeWorkbenchTerminalInputLeases(workspaceKey, session.sessionId);
    await sessions.close(workspaceKey, session.sessionId);
    metadataMap(workspaceKey).delete(session.sessionId);
  }
}

export async function createLocalInteractiveTerminalSession(
  workspaceKey: string,
  workspaceRoot: string,
  request: ParsedCreateTerminalRequest,
) {
  if (localCreates.has(workspaceKey)) {
    throw new WorkbenchRequestError(
      "Another terminal session is being created.",
      409,
      "terminal_create_busy",
    );
  }
  localCreates.add(workspaceKey);

  try {
    // Natural CLI exits remain visible long enough for the open SSE stream to
    // publish its final status. Remove them before the next create so repeated
    // restarts cannot exhaust the process-local manager's attachment cap.
    await removeExitedLocalTerminalSessions(workspaceKey);
    const existing = await listLocalInteractiveTerminalSessions(workspaceKey);
    const runningSessions = existing.sessions.filter(
      (session) => session.status === "running",
    );
    const running = request.clientTerminalId
      ? runningSessions.find(
          (session) => session.clientTerminalId === request.clientTerminalId,
        )
      : runningSessions[0];
    if (running) return { session: running, created: false } as const;
    if (runningSessions.length >= MAX_WORKBENCH_TERMINALS_PER_WORKSPACE) {
      throw new WorkbenchRequestError(
        `A workspace can run up to ${MAX_WORKBENCH_TERMINALS_PER_WORKSPACE} terminals.`,
        409,
        "terminal_limit_reached",
      );
    }

    let cwd: string;
    try {
      cwd = resolveLocalTerminalCwd(workspaceRoot, request.cwd);
    } catch (error) {
      throw new WorkbenchRequestError(
        error instanceof Error
          ? error.message
          : "The local terminal working directory is invalid.",
        400,
        "invalid_local_terminal_cwd",
      );
    }

    const launch = resolveLocalTerminalLaunch(request.profile);
    if (!launch.profileAvailable) {
      throw new WorkbenchRequestError(
        launch.notice
          ? launch.notice.replace(/\u001b\[[0-9;]*m/g, "").trim()
          : "The requested CLI profile is not installed or is not available on PATH.",
        409,
        "terminal_profile_unavailable",
      );
    }
    const sessionId = randomBytes(12).toString("hex");
    const createdAt = Date.now();
    const expiresAt = createdAt + SESSION_MAX_LIFETIME_MS;
    const handle = await createLocalPtyHandle({
      launch,
      cwd,
      cols: request.cols,
      rows: request.rows,
    });

    let session: PtySession;
    try {
      session = sessions.attach(workspaceKey, {
        sessionId,
        handle,
        cols: request.cols,
        rows: request.rows,
        createdAt,
        lastActivityAt: createdAt,
      });
    } catch (error) {
      await handle.kill().catch(() => undefined);
      throw error;
    }
    metadataMap(workspaceKey).set(sessionId, {
      cwd,
      clientTerminalId: request.clientTerminalId,
      createdAt,
      expiresAt,
      profile: request.profile,
      profileAvailable: launch.profileAvailable,
      backend: "local",
    });
    void handle.exited.then(() => {
      revokeWorkbenchTerminalInputLeases(workspaceKey, sessionId);
    });
    return {
      session: summaryFromSession(workspaceKey, session),
      created: true,
    } as const;
  } finally {
    localCreates.delete(workspaceKey);
  }
}

export async function sendLocalInteractiveTerminalInput(
  workspaceKey: string,
  sessionId: string,
  bytes: Uint8Array,
): Promise<WorkbenchTerminalInputSender> {
  const sender = createLocalInteractiveTerminalInputSender(
    workspaceKey,
    sessionId,
  );
  if (!sender) {
    throw new WorkbenchRequestError(
      "Terminal session was not found or has exited.",
      404,
      "terminal_not_found",
    );
  }
  await sender(bytes);
  return sender;
}

export async function resizeLocalInteractiveTerminal(
  workspaceKey: string,
  sessionId: string,
  size: WorkbenchTerminalResizeRequest,
) {
  await enqueueSessionMutation(workspaceKey, sessionId, async () => {
    const local = sessions.get(workspaceKey, sessionId);
    if (!local || sessions.getExitInfo(local)) {
      throw new WorkbenchRequestError(
        "Terminal session was not found or has exited.",
        404,
        "terminal_not_found",
      );
    }
    await local.handle.resize(size.cols, size.rows);
    local.cols = size.cols;
    local.rows = size.rows;
    sessions.touch(local);
  });
}

export async function closeLocalInteractiveTerminal(
  workspaceKey: string,
  sessionId: string,
) {
  await enqueueSessionMutation(workspaceKey, sessionId, async () => {
    revokeWorkbenchTerminalInputLeases(workspaceKey, sessionId);
    await sessions.close(workspaceKey, sessionId);
    const map = localMetadata.get(workspaceKey);
    map?.delete(sessionId);
    if (map?.size === 0) localMetadata.delete(workspaceKey);
  });
}

export async function connectLocalInteractiveTerminalEvents(
  workspaceKey: string,
  sessionId: string,
) {
  const session = sessions.get(workspaceKey, sessionId);
  if (!session) {
    throw new WorkbenchRequestError(
      "Terminal session was not found or has exited.",
      404,
      "terminal_not_found",
    );
  }
  return { session, reconnected: false, workspaceKey };
}

async function requireLocatedPty(sandbox: Sandbox, sessionId: string) {
  const located = await locatePty(sandbox, sessionId);
  if (!located) {
    throw new WorkbenchRequestError(
      "Terminal session was not found or has exited.",
      404,
      "terminal_not_found",
    );
  }
  return located;
}

export async function sendInteractiveTerminalInput(
  sandbox: Sandbox,
  workspaceKey: string,
  sessionId: string,
  bytes: Uint8Array,
): Promise<WorkbenchTerminalInputSender> {
  return enqueueSessionMutation(workspaceKey, sessionId, async () => {
    const local = sessions.get(workspaceKey, sessionId);
    if (local && !sessions.getExitInfo(local)) {
      const sendInput = createLocalInteractiveTerminalInputSender(
        workspaceKey,
        sessionId,
        local,
      );
      if (!sendInput) {
        throw new WorkbenchRequestError(
          "Terminal session was not found or has exited.",
          404,
          "terminal_not_found",
        );
      }
      await local.handle.sendInput(bytes);
      sessions.touch(local);
      return sendInput;
    }

    const located = await requireLocatedPty(sandbox, sessionId);
    await sandbox.pty.sendInput(located.process.pid, bytes);
    const pid = located.process.pid;
    return (nextBytes) =>
      enqueueSessionMutation(workspaceKey, sessionId, async () => {
        const current = sessions.get(workspaceKey, sessionId);
        if (current && !sessions.getExitInfo(current)) {
          if (current.pid !== pid) {
            throw new Error("Terminal process identity changed.");
          }
          await current.handle.sendInput(nextBytes);
          sessions.touch(current);
          return;
        }
        // This closure is created only after the authenticated workspace
        // lookup located the marked session id at this exact pid. It avoids a
        // second output attachment and keeps subsequent input mutations on
        // this route instance lightweight.
        await sandbox.pty.sendInput(pid, nextBytes);
      });
  });
}

export function hasLocalInteractiveTerminalSession(
  workspaceKey: string,
  sessionId: string,
) {
  const local = sessions.get(workspaceKey, sessionId);
  return Boolean(local && !sessions.getExitInfo(local));
}

export function createLocalInteractiveTerminalInputSender(
  workspaceKey: string,
  sessionId: string,
  expected = sessions.get(workspaceKey, sessionId),
): WorkbenchTerminalInputSender | null {
  if (!expected || sessions.getExitInfo(expected)) return null;
  return (bytes) =>
    enqueueSessionMutation(workspaceKey, sessionId, async () => {
      const current = sessions.get(workspaceKey, sessionId);
      if (current !== expected || sessions.getExitInfo(expected)) {
        throw new Error("Terminal input handle is no longer current.");
      }
      await expected.handle.sendInput(bytes);
      sessions.touch(expected);
    });
}

export async function resizeInteractiveTerminal(
  sandbox: Sandbox,
  workspaceKey: string,
  sessionId: string,
  size: WorkbenchTerminalResizeRequest,
) {
  await enqueueSessionMutation(workspaceKey, sessionId, async () => {
    const local = sessions.get(workspaceKey, sessionId);
    if (local && !sessions.getExitInfo(local)) {
      await local.handle.resize(size.cols, size.rows);
      local.cols = size.cols;
      local.rows = size.rows;
      sessions.touch(local);
      return;
    }

    const located = await requireLocatedPty(sandbox, sessionId);
    await sandbox.pty.resize(located.process.pid, size);
  });
}

export async function closeInteractiveTerminal(
  sandbox: Sandbox,
  workspaceKey: string,
  sessionId: string,
) {
  await enqueueSessionMutation(workspaceKey, sessionId, async () => {
    revokeWorkbenchTerminalInputLeases(workspaceKey, sessionId);
    const local = sessions.get(workspaceKey, sessionId);
    if (local) {
      await sessions.close(workspaceKey, sessionId);
    } else {
      const located = await locatePty(sandbox, sessionId);
      if (located) {
        await sandbox.pty.kill(located.process.pid).catch(() => false);
      }
    }
    const map = localMetadata.get(workspaceKey);
    map?.delete(sessionId);
    if (map?.size === 0) localMetadata.delete(workspaceKey);
  });
}

export async function connectInteractiveTerminalEvents(
  sandbox: Sandbox,
  workspaceKey: string,
  sessionId: string,
) {
  const local = sessions.get(workspaceKey, sessionId);
  if (local) return { session: local, reconnected: false, workspaceKey };

  const located = await requireLocatedPty(sandbox, sessionId);
  const handle = await connectE2BPtyHandle(sandbox, located.process.pid);
  try {
    const session = sessions.attach(workspaceKey, {
      sessionId,
      handle,
      cols: located.metadata.cols,
      rows: located.metadata.rows,
      createdAt: located.metadata.createdAt,
      lastActivityAt: Date.now(),
    });
    metadataMap(workspaceKey).set(sessionId, located.metadata);
    void handle.exited.then(() => {
      revokeWorkbenchTerminalInputLeases(workspaceKey, sessionId);
    });
    return { session, reconnected: true, workspaceKey };
  } catch (error) {
    const raced = sessions.get(workspaceKey, sessionId);
    if (raced) return { session: raced, reconnected: false, workspaceKey };
    throw error;
  }
}

function sseFrame(event: WorkbenchTerminalStreamEvent) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function createInteractiveTerminalEventResponse(args: {
  workspaceKey: string;
  session: PtySession;
  cursor: number;
  reconnected: boolean;
  signal: AbortSignal;
  inputLease?: string;
}) {
  const encoder = new TextEncoder();
  let cleanup: (() => void) | undefined;

  const stream = args.session.handle.acquireOutputFlowControl
    ? createFlowControlledTerminalStream({
        handle: args.session.handle,
        read: (cursor, maxBytes) =>
          sessions.readFromCursor(args.session, cursor, maxBytes),
        ready: {
          type: "ready",
          session: summaryFromSession(args.workspaceKey, args.session),
          cursor: args.reconnected ? 0 : args.cursor,
          reconnected: args.reconnected,
        },
        exit: () => sessions.getExitInfo(args.session),
        signal: args.signal,
        heartbeatMs: SSE_HEARTBEAT_MS,
        rotationMs: WORKBENCH_TERMINAL_SSE_ROTATE_MS,
      })
    : new ReadableStream<Uint8Array>({
        start(controller) {
          let closed = false;
          let cursor = args.reconnected ? 0 : args.cursor;
          let heartbeat: ReturnType<typeof setInterval> | undefined;
          let rotation: ReturnType<typeof setTimeout> | undefined;
          let unsubscribe: (() => void) | undefined;

          const enqueue = (frame: string) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(frame));
            } catch {
              finish();
            }
          };
          const emit = (event: WorkbenchTerminalStreamEvent) => {
            enqueue(sseFrame(event));
          };
          const flush = () => {
            if (closed) return;
            const read = sessions.readFromCursor(args.session, cursor);
            if (read.reset) {
              emit({
                type: "reset",
                reason:
                  cursor < read.retainedFrom
                    ? "buffer_truncated"
                    : "invalid_cursor",
                cursor: read.retainedFrom,
              });
            }
            cursor = read.nextCursor;
            if (read.bytes.byteLength > 0) {
              emit({
                type: "output",
                encoding: "base64",
                data: Buffer.from(read.bytes).toString("base64"),
                cursor,
              });
            }
          };
          const onAbort = () => finish();
          const finish = () => {
            if (closed) return;
            closed = true;
            const unsubscribeFromData = unsubscribe;
            unsubscribe = undefined;
            try {
              unsubscribeFromData?.();
            } catch {
              // Continue clearing the remaining connection resources.
            }
            if (heartbeat !== undefined) clearInterval(heartbeat);
            heartbeat = undefined;
            if (rotation !== undefined) clearTimeout(rotation);
            rotation = undefined;
            args.signal.removeEventListener("abort", onAbort);
            try {
              controller.close();
            } catch {
              // The client may already have cancelled the stream.
            }
          };

          cleanup = finish;
          args.signal.addEventListener("abort", onAbort, { once: true });
          unsubscribe = args.session.handle.onData(flush);

          if (args.signal.aborted) {
            finish();
            return;
          }

          emit({
            type: "ready",
            session: summaryFromSession(args.workspaceKey, args.session),
            cursor,
            reconnected: args.reconnected,
          });
          if (args.reconnected) {
            emit({
              type: "reset",
              reason: "stream_reconnected",
              cursor: 0,
            });
          }
          flush();

          const alreadyExited = sessions.getExitInfo(args.session);
          if (alreadyExited) {
            emit({ type: "exit", exitCode: alreadyExited.exitCode, cursor });
            finish();
            return;
          }

          void args.session.handle.exited.then((exit) => {
            if (closed) return;
            flush();
            emit({ type: "exit", exitCode: exit.exitCode, cursor });
            finish();
          });
          heartbeat = setInterval(
            () => enqueue(": keepalive\n\n"),
            SSE_HEARTBEAT_MS,
          );
          rotation = setTimeout(() => {
            if (closed) return;
            // Include every byte observed before handing the cursor to the next
            // connection. The next /events request replays strictly after it.
            flush();
            emit({ type: "rotate", cursor });
            finish();
          }, WORKBENCH_TERMINAL_SSE_ROTATE_MS);
        },
        cancel() {
          cleanup?.();
        },
      });

  return new Response(stream, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
      ...(args.inputLease
        ? { [WORKBENCH_TERMINAL_INPUT_LEASE_HEADER]: args.inputLease }
        : {}),
    },
  });
}
