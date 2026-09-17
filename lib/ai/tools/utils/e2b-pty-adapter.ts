/**
 * E2B PTY adapter.
 *
 * Wraps E2B's callback-style `sandbox.pty.create({onData, cols, rows, ...})`
 * into a listener-set based handle that higher-level code (PtySessionManager,
 * run_terminal_cmd action dispatch) can consume without thinking about E2B
 * internals. Every byte chunk emitted by E2B fans out to all subscribed
 * listeners; `exited` is a single memoized promise resolved from the E2B
 * handle's `wait()`.
 */

import { createTerminalOutputFlow } from "@/lib/workbench/terminal-output-flow";
import type { Sandbox, Username } from "@e2b/code-interpreter";

// ── Narrow structural types over the E2B SDK surface we actually touch ─
// Prevents `any` leakage and keeps the adapter resilient to SDK churn.

type PtyDataCb = (data: Uint8Array) => void | Promise<void>;

interface E2BPtyCreateOpts {
  cols: number;
  rows: number;
  onData: PtyDataCb;
  cwd?: string;
  envs?: Record<string, string>;
  user?: Username;
  timeoutMs?: number;
}

interface E2BCommandHandle {
  readonly pid: number;
  wait(opts?: {
    timeoutMs?: number;
  }): Promise<{ exitCode: number | null | undefined }>;
}

interface E2BPtyModule {
  create(opts: E2BPtyCreateOpts): Promise<E2BCommandHandle>;
  connect(
    pid: number,
    opts: { onData: PtyDataCb; timeoutMs?: number },
  ): Promise<E2BCommandHandle>;
  sendInput(pid: number, data: Uint8Array): Promise<void>;
  resize(pid: number, size: { cols: number; rows: number }): Promise<void>;
  kill(pid: number): Promise<boolean>;
}

interface SandboxWithPty {
  pty: E2BPtyModule;
}

// ── Public contract ─────────────────────────────────────────────────

export interface PtyOutputFlowControl {
  pause(): void;
  resume(): void;
  dispose(): void;
}

export interface PtyHandle {
  /** Present only when pause/resume controls native output or SDK stream reads. */
  acquireOutputFlowControl?: () => PtyOutputFlowControl;
  readonly pid: number;
  sendInput(bytes: Uint8Array): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  kill(): Promise<void>;
  /** Returns an unsubscribe function. */
  onData(cb: (bytes: Uint8Array) => void): () => void;
  readonly exited: Promise<{ exitCode: number | null }>;
  /** Actual termination receipt; unknown transport failures reject. */
  readonly confirmedExited?: Promise<{ exitCode: number | null }>;
}

export interface CreatePtyOptions {
  cols: number;
  rows: number;
  cwd?: string;
  envs?: Record<string, string>;
  /** Explicit sandbox user. Browser-controlled PTYs must always pass `user`. */
  user?: Username;
}

// ── Implementation ──────────────────────────────────────────────────

const LOG_PREFIX = "[e2b-pty-adapter]";

const errorMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");

/**
 * E2B rejects `wait()` and teardown RPCs when a PTY was killed normally or
 * its sandbox already expired. Those are terminal states, not application
 * failures. Keep unexpected transport errors visible while avoiding noisy
 * error logs for successful/expected cleanup.
 */
export const isExpectedPtyTerminationError = (error: unknown): boolean => {
  const message = errorMessage(error).toLowerCase();
  return (
    /^\d+: \[unknown\] terminated$/.test(message.trim()) ||
    message.includes("signal: killed") ||
    message.includes("signal: alarm clock") ||
    message.includes("sandbox was not found") ||
    message.includes("sandbox not found") ||
    message.includes("already exited") ||
    message.includes("pty was not found") ||
    message.includes("failed to kill pty process")
  );
};

// Disable the SDK's per-RPC deadline. Lifetime is owned by PtySessionManager
// (idle + max-lifetime timers). Without this, the default RPC timeout (~60s)
// rejects pty.create / handle.wait while the process is still healthy in the
// sandbox, leaving the manager to mark the session as exitedNaturally.
const PTY_NO_TIMEOUT_MS = 0;
const MAX_PRE_SUBSCRIPTION_BYTES = 64 * 1024;

export async function createE2BPtyHandle(
  sandbox: Sandbox,
  opts: CreatePtyOptions,
): Promise<PtyHandle> {
  const pty = (sandbox as unknown as SandboxWithPty).pty;

  return createHandle(pty, (onData) =>
    pty.create({
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      envs: opts.envs,
      user: opts.user,
      onData,
      timeoutMs: PTY_NO_TIMEOUT_MS,
    }),
  );
}

/**
 * Re-attach to an E2B PTY that is still alive in the sandbox.
 *
 * This is intentionally separate from `createE2BPtyHandle`: E2B's reconnect
 * API only needs a pid and output callback, while input/resize/kill keep using
 * the same instance-independent pid RPCs.
 */
export async function connectE2BPtyHandle(
  sandbox: Sandbox,
  pid: number,
): Promise<PtyHandle> {
  const pty = (sandbox as unknown as SandboxWithPty).pty;
  return createHandle(pty, (onData) =>
    pty.connect(pid, { onData, timeoutMs: PTY_NO_TIMEOUT_MS }),
  );
}

async function createHandle(
  pty: E2BPtyModule,
  connect: (onData: PtyDataCb) => Promise<E2BCommandHandle>,
): Promise<PtyHandle> {
  const listeners = new Set<(bytes: Uint8Array) => void>();
  const pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let paused = false;
  let killed = false;
  let wake: (() => void) | undefined;
  const acquireOutputFlowControl = createTerminalOutputFlow(
    () => {
      paused = true;
    },
    () => {
      paused = false;
      wake?.();
      wake = undefined;
    },
  );
  const waitForCredit = async () => {
    // Another reader may acquire credit before this continuation resumes.
    while (paused && !killed)
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
  };

  const onData: PtyDataCb = async (data) => {
    // e2b@2.27.0 is patched to await this callback (both CJS and ESM).
    // Without that SDK fix a promise here would only hide an unbounded queue.
    await waitForCredit();
    if (killed) return;
    if (listeners.size === 0) {
      const owned = new Uint8Array(data);
      pending.push(owned);
      pendingBytes += owned.byteLength;
      while (pendingBytes > MAX_PRE_SUBSCRIPTION_BYTES && pending.length > 0) {
        pendingBytes -= pending.shift()!.byteLength;
      }
      return;
    }
    // Bound each delivery even when one SDK message exceeds the replay ring.
    for (let offset = 0; offset < data.byteLength; offset += 64 * 1024) {
      await waitForCredit();
      if (killed) return;
      const bytes = data.subarray(offset, offset + 64 * 1024);
      // Snapshot to tolerate listener churn (unsubscribe during iteration).
      for (const listener of Array.from(listeners)) {
        try {
          listener(bytes);
        } catch (err) {
          console.error(`${LOG_PREFIX} listener threw:`, err);
        }
      }
      await waitForCredit();
    }
  };

  const handle = await connect(onData);

  const pid = handle.pid;

  // Kick off wait() immediately so `exited` resolves exactly once and all
  // consumers share the same resolution. Any rejection is normalized to
  // {exitCode: null} with a structured log — the error is surfaced, not
  // swallowed silently.
  const waitResult = handle.wait({ timeoutMs: PTY_NO_TIMEOUT_MS });
  // The installed SDK's CommandHandle.wait throws this class only after a
  // received result with nonzero exitCode. Transport errors remain failures.
  const confirmedExited = waitResult
    .catch(async (error: unknown) => {
      if (error instanceof Error && error.name === "CommandExitError") {
        const { CommandExitError } = await import("@e2b/code-interpreter");
        if (
          error instanceof CommandExitError &&
          Number.isInteger(error.exitCode)
        )
          return { exitCode: error.exitCode };
      }
      throw error;
    })
    .then((result) => {
      if (!Number.isInteger(result?.exitCode))
        throw new Error(
          `${LOG_PREFIX} PTY exit code was not confirmed for pid=${pid}`,
        );
      return { exitCode: result.exitCode as number };
    });
  void confirmedExited.catch(() => {});
  // Preserve legacy UI normalization, but never let a transport failure serve
  // as the strict execution's process-exit acknowledgment.
  const exited: Promise<{ exitCode: number | null }> = waitResult
    .then((result) => ({
      exitCode: typeof result?.exitCode === "number" ? result.exitCode : null,
    }))
    .catch((err: unknown) => {
      if (!isExpectedPtyTerminationError(err)) {
        console.error(`${LOG_PREFIX} pty wait() rejected for pid=${pid}:`, err);
      }
      return { exitCode: null };
    });

  return {
    acquireOutputFlowControl,
    pid,
    sendInput(bytes: Uint8Array): Promise<void> {
      return pty.sendInput(pid, bytes);
    },
    async resize(cols: number, rows: number): Promise<void> {
      await pty.resize(pid, { cols, rows });
    },
    async kill(): Promise<void> {
      // E2B's `pty.kill` returns a boolean — `false` when the PTY was not
      // found (already exited, wrong pid, torn-down sandbox). Surface that
      // as an error so callers don't see a silent success.
      const wasKilled = await pty.kill(pid);
      // Kill uses an independent RPC. Release a waiting output callback after
      // the RPC returns, including "not found"; keep output alive if RPC fails.
      killed = true;
      wake?.();
      wake = undefined;
      if (!wasKilled) {
        throw new Error(`Failed to kill PTY process: pid=${pid}`);
      }
    },
    onData(cb: (bytes: Uint8Array) => void): () => void {
      const firstListener = listeners.size === 0;
      listeners.add(cb);
      // E2B can draw the initial prompt before the higher-level manager has
      // finished its post-create security checks. Replay that bounded prefix
      // exactly once to the first subscriber so the browser sees a complete
      // terminal without weakening the validation-before-exposure boundary.
      if (firstListener && pending.length > 0) {
        const backlog = pending.splice(0);
        pendingBytes = 0;
        for (const bytes of backlog) {
          try {
            cb(bytes);
          } catch (err) {
            console.error(`${LOG_PREFIX} listener threw:`, err);
          }
        }
      }
      return () => {
        listeners.delete(cb);
      };
    },
    get exited() {
      return exited;
    },
    get confirmedExited() {
      return confirmedExited;
    },
  };
}
