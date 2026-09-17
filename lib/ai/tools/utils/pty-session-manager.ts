/**
 * Per-chat PTY session store.
 *
 * The real source of truth lives inside the sandbox. Agent PTYs are normally
 * closed by `chat-handler.onFinish`; Workbench can also attach a persistent
 * browser stream to a sandbox PTY. This Node-side object is only a cache with
 * ring buffer, idle/lifetime timers and cursor bookkeeping. Its timers do not
 * survive a process move, so persistent callers must enforce their durable
 * hard lifetime inside the sandbox too.
 */

import { AsyncLocalStorage } from "node:async_hooks";
export { DEFAULT_PTY_COLS, DEFAULT_PTY_ROWS } from "./pty-constants";
import {
  isExpectedPtyTerminationError,
  type PtyHandle,
} from "./e2b-pty-adapter";

export const MAX_CONCURRENT_PTYS_PER_CHAT = 10;
export const SESSION_IDLE_TIMEOUT_MS = 10 * 60_000;
export const SESSION_MAX_LIFETIME_MS = 60 * 60_000;
export const MAX_BUFFER_BYTES = 256 * 1024;

const CLOSE_EXIT_FALLBACK_MS = 2_000;

export interface PtySession {
  readonly sessionId: string;
  readonly chatId: string;
  readonly pid: number;
  cols: number;
  rows: number;
  readonly createdAt: number;
  lastActivityAt: number;
  readonly handle: PtyHandle;
  /**
   * Appended raw bytes. Ring: when total size exceeds `MAX_BUFFER_BYTES`,
   * old chunks are dropped (FIFO).
   */
  buffer: Uint8Array[];
  /**
   * Byte offset of last model-visible read; used by wait/view to compute
   * deltas. Tracked relative to the *current* `buffer` contents — when the
   * ring drops bytes before the cursor, the cursor is clamped to `0` and
   * `bufferTruncated` is set to `true`.
   */
  readCursor: number;
  /** Flipped once when the ring first drops any bytes. Never reset. */
  bufferTruncated: boolean;
  /** Current unsubmitted shell input used to guardrail split `send` calls. */
  pendingGuardrailInput: string;
}

export interface CreateSessionOpts {
  /** Factory — called by the manager; allows tests to inject a fake handle. */
  createHandle: () => Promise<PtyHandle>;
  signal?: AbortSignal;
  cols: number;
  rows: number;
}

export interface AttachSessionOpts {
  /** Stable id persisted in the sandbox process metadata. */
  sessionId: string;
  handle: PtyHandle;
  cols: number;
  rows: number;
  createdAt?: number;
  lastActivityAt?: number;
  /** Absolute output bytes that existed before this process re-attached. */
  initialDroppedBytes?: number;
}

export interface PtyBufferRead {
  bytes: Uint8Array;
  /** Absolute byte cursor to send back on the next read. */
  nextCursor: number;
  /** True when the requested cursor was outside the retained ring. */
  reset: boolean;
  retainedFrom: number;
}

interface InternalSession extends PtySession {
  /** Cache identity includes the admitted run; public chatId stays unchanged. */
  scopeKey: string;
  /** Total bytes dropped from the front of the ring since session start. */
  droppedBytes: number;
  /** idle-timeout timer — reset on every input/output byte. */
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** hard cap timer — set at create, never reset. */
  lifetimeTimer: ReturnType<typeof setTimeout> | null;
  /** onData unsubscribe function. */
  unsubscribe: (() => void) | null;
  /** True once close() has been initiated — prevents re-entry. */
  closing: boolean;
  /** Shared bounded close lifecycle for concurrent callers. */
  closePromise: Promise<void> | null;
  /** Set when the process exits naturally — session stays around for view/wait. */
  exitedNaturally: { exitCode: number | null } | null;
}

type PendingCreate = { canceled: boolean; cancel: () => void };
type ConfirmationScope = { executionId: string; closed: boolean };
type RemoteExecution = Pick<PtyHandle, "pid" | "kill" | "confirmedExited">;
type ConfirmationLedger = {
  pending: Set<Promise<void>>;
  handles: Set<RemoteExecution>;
  closing: boolean;
  failure?: { error: unknown };
};

/**
 * 8 hex chars = 32 bits of entropy. With MAX_CONCURRENT_PTYS_PER_CHAT
 * collisions are negligible (~10^-8 per chat at the cap), but we still
 * retry a handful of times on the off chance.
 *
 * Short ids matter because the agent has to copy this value into every
 * `interact_terminal_session` call — full UUIDs cost tokens and make
 * tool args more error-prone.
 */
function shortSessionId(
  taken: ReadonlyMap<string, unknown> | undefined,
): string {
  for (let i = 0; i < 5; i++) {
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    if (!taken || !taken.has(id)) return id;
  }
  throw new Error("Failed to generate unique session id after 5 attempts");
}

export class PtySessionManager {
  private chats = new Map<string, Map<string, InternalSession>>();
  private pendingCreates = new Map<string, Set<PendingCreate>>();
  private scope = new AsyncLocalStorage<string>();
  private confirmedScope = new AsyncLocalStorage<ConfirmationScope>();
  private confirmationScopes = new Map<string, ConfirmationScope>();
  private confirmationLedgers = new Map<string, ConfirmationLedger>();
  private confirmedKillRequested = new WeakSet<RemoteExecution>();

  /** Bind tool calls and their asynchronous cleanup to one admitted run. */
  withScope<T>(runId: string, callback: () => T): T {
    return this.scope.run(runId, callback);
  }

  /** Exact HTTP runs retain process-exit proof independently of cache cleanup. */
  withConfirmedScope<T>(executionId: string, callback: () => T): T {
    const inherited = this.confirmedScope.getStore();
    const scope =
      inherited?.executionId === executionId
        ? inherited
        : (this.confirmationScopes.get(executionId) ?? {
            executionId,
            closed: false,
          });
    if (!scope.closed || this.confirmationScopes.has(executionId))
      this.confirmationScopes.set(executionId, scope);
    return this.withScope(executionId, () =>
      this.confirmedScope.run(scope, callback),
    );
  }

  private isConfirmedScope(): boolean {
    const scope = this.confirmedScope.getStore();
    return scope !== undefined && scope.executionId === this.scope.getStore();
  }

  private confirmationLedger(key: string): ConfirmationLedger {
    if (this.confirmedScope.getStore()?.closed)
      throw new Error("PTY confirmation scope is closing");
    let ledger = this.confirmationLedgers.get(key);
    if (!ledger) {
      ledger = { pending: new Set(), handles: new Set(), closing: false };
      this.confirmationLedgers.set(key, ledger);
    }
    if (ledger.closing) throw new Error("PTY confirmation scope is closing");
    return ledger;
  }

  /** Check immediately before command submission, without an intervening await. */
  assertExecutionOpen(): void {
    if (this.confirmedScope.getStore()?.closed)
      throw new Error("Execution is closing. No command was started.");
  }

  /** Track foreground cloud commands without putting them in the interactive UI.
   * The receipt is registered before the start acknowledgment can arrive. */
  trackRemoteCommand(chatId: string, creation: Promise<RemoteExecution>): void {
    if (!this.isConfirmedScope()) {
      void creation.then((handle) => handle.confirmedExited).catch(() => {});
      return;
    }
    const key = this.chatKey(chatId);
    this.trackConfirmedCreation(key, this.confirmationLedger(key), creation);
  }

  private trackConfirmedCreation(
    key: string,
    ledger: ConfirmationLedger,
    creation: Promise<RemoteExecution>,
  ): void {
    // This proof outlives create()'s cancellation race and bounded cache cleanup.
    const proof = creation.then(async (handle) => {
      ledger.handles.add(handle);
      if (ledger.closing) this.requestHandleKill(handle);
      if (!handle.confirmedExited)
        throw new Error("PTY exit confirmation is unavailable");
      await handle.confirmedExited;
      ledger.handles.delete(handle);
    });
    ledger.pending.add(proof);
    void proof.then(
      () => {
        ledger.pending.delete(proof);
        if (
          !ledger.pending.size &&
          !ledger.closing &&
          !ledger.failure &&
          this.confirmationLedgers.get(key) === ledger
        )
          this.confirmationLedgers.delete(key);
      },
      (error) => {
        ledger.pending.delete(proof);
        // Keep one compact failure receipt; a retry must not mistake absence
        // of the failed promise for confirmed process termination.
        ledger.failure ??= { error };
      },
    );
  }

  private chatKey(chatId: string): string {
    return JSON.stringify([this.scope.getStore() ?? null, chatId]);
  }

  async create(chatId: string, opts: CreateSessionOpts): Promise<PtySession> {
    opts.signal?.throwIfAborted();
    const key = this.chatKey(chatId);
    const confirmation = this.isConfirmedScope()
      ? this.confirmationLedger(key)
      : undefined;
    const pending = this.pendingCreates.get(key) ?? new Set<PendingCreate>();
    const count = (this.chats.get(key)?.size ?? 0) + pending.size;
    if (count >= MAX_CONCURRENT_PTYS_PER_CHAT) {
      throw new Error(
        `MAX_CONCURRENT_PTYS_PER_CHAT reached (limit=${MAX_CONCURRENT_PTYS_PER_CHAT}) for chatId=${chatId}`,
      );
    }

    // Reserve before the factory awaits. Cleanup invalidates these tickets,
    // while a subsequent create may start a fresh Workbench session.
    let rejectCancellation!: (reason: unknown) => void;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    const ticket: PendingCreate = {
      canceled: false,
      cancel: () => {
        if (ticket.canceled) return;
        ticket.canceled = true;
        releaseReservation();
        rejectCancellation(
          opts.signal?.reason ??
            new Error("PTY creation was canceled by cleanup"),
        );
      },
    };
    const releaseReservation = () => {
      pending.delete(ticket);
      if (pending.size === 0 && this.pendingCreates.get(key) === pending) {
        this.pendingCreates.delete(key);
      }
    };
    pending.add(ticket);
    this.pendingCreates.set(key, pending);
    const onAbort = () => ticket.cancel();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const creation = (async () => {
      let handleCreation: Promise<PtyHandle>;
      try {
        handleCreation = opts.createHandle();
      } catch (error) {
        handleCreation = Promise.reject(error);
      }
      if (confirmation)
        this.trackConfirmedCreation(key, confirmation, handleCreation);
      const handle = await handleCreation;
      try {
        opts.signal?.throwIfAborted();
        if (ticket.canceled)
          throw new Error("PTY creation was canceled by cleanup");
        const session = this.register(chatId, {
          sessionId: shortSessionId(this.chats.get(key)),
          handle,
          cols: opts.cols,
          rows: opts.rows,
        });
        releaseReservation();
        return session;
      } catch (error) {
        // A late or unwired handle must never become a live cached session.
        await this.stopHandle(handle);
        throw error;
      }
    })();
    try {
      // Settling cancellation does not abandon the SDK operation. The race
      // observes its rejection, and creation still kills any late handle.
      return await Promise.race([creation, cancellation]);
    } finally {
      opts.signal?.removeEventListener("abort", onAbort);
      releaseReservation();
    }
  }

  /**
   * Register a handle created by `sandbox.pty.connect()` under its stable id.
   * This supports a best-effort re-attach after a Next.js instance changes.
   * Output emitted before re-attach cannot be replayed by E2B and callers
   * should surface a reset event to clients.
   */
  attach(chatId: string, opts: AttachSessionOpts): PtySession {
    if (this.isConfirmedScope()) {
      const key = this.chatKey(chatId);
      this.trackConfirmedCreation(
        key,
        this.confirmationLedger(key),
        Promise.resolve(opts.handle),
      );
    }
    const chat = this.chats.get(this.chatKey(chatId));
    if (chat?.has(opts.sessionId)) {
      throw new Error(
        `PTY session already registered: chatId=${chatId} sessionId=${opts.sessionId}`,
      );
    }
    if (
      (chat?.size ?? 0) +
        (this.pendingCreates.get(this.chatKey(chatId))?.size ?? 0) >=
      MAX_CONCURRENT_PTYS_PER_CHAT
    ) {
      throw new Error(
        `MAX_CONCURRENT_PTYS_PER_CHAT reached (limit=${MAX_CONCURRENT_PTYS_PER_CHAT}) for chatId=${chatId}`,
      );
    }
    return this.register(chatId, opts);
  }

  get(chatId: string, sessionId: string): PtySession | undefined {
    return this.chats.get(this.chatKey(chatId))?.get(sessionId);
  }

  list(chatId: string): PtySession[] {
    const chat = this.chats.get(this.chatKey(chatId));
    if (!chat) return [];
    return Array.from(chat.values());
  }

  /**
   * Returns bytes currently available starting at `session.readCursor`.
   * Does not advance the cursor.
   */
  peekBufferSize(session: PtySession): number {
    const total = this.totalBufferBytes(session);
    return Math.max(0, total - session.readCursor);
  }

  /**
   * Returns (and copies) bytes since `readCursor`, then advances the cursor.
   */
  consumeDelta(session: PtySession): Uint8Array {
    const total = this.totalBufferBytes(session);
    const start = Math.min(session.readCursor, total);
    const out = this.sliceBuffer(session, start, total);
    session.readCursor = total;
    return out;
  }

  /**
   * Returns the full accumulated buffer without advancing `readCursor`.
   * Intended for `action=view`.
   */
  snapshot(session: PtySession): Uint8Array {
    const total = this.totalBufferBytes(session);
    return this.sliceBuffer(session, 0, total);
  }

  /** Read by an absolute byte cursor, suitable for reconnectable stream APIs. */
  readFromCursor(
    session: PtySession,
    cursor: number,
    maxBytes?: number,
  ): PtyBufferRead {
    const internal = session as InternalSession;
    const retainedFrom = internal.droppedBytes;
    const total = this.totalBufferBytes(session);
    const end = retainedFrom + total;
    const reset = cursor < retainedFrom || cursor > end;
    const start = reset ? 0 : cursor - retainedFrom;
    const stop =
      maxBytes === undefined
        ? total
        : Math.min(total, start + Math.max(0, Math.floor(maxBytes)));
    return {
      bytes: this.sliceBuffer(session, start, stop),
      nextCursor: retainedFrom + stop,
      reset,
      retainedFrom,
    };
  }

  /** Refresh idle lifetime after client input or a resize operation. */
  touch(session: PtySession): void {
    const internal = session as InternalSession;
    if (internal.closing) return;
    internal.lastActivityAt = Date.now();
    this.armIdleTimer(internal);
  }

  getExitInfo(session: PtySession): { exitCode: number | null } | null {
    return (session as InternalSession).exitedNaturally;
  }

  async close(chatId: string, sessionId: string): Promise<void> {
    const chat = this.chats.get(this.chatKey(chatId));
    const session = chat?.get(sessionId);
    if (!session) return;
    await this.killAndRemove(session, "close");
  }

  async closeAll(chatId: string): Promise<void> {
    const key = this.chatKey(chatId);
    const pending = this.pendingCreates.get(key);
    if (pending) {
      for (const ticket of pending) ticket.cancel();
      this.pendingCreates.delete(key);
    }
    const chat = this.chats.get(key);
    if (!chat) return;
    const sessions = Array.from(chat.values());
    await Promise.all(sessions.map((s) => this.killAndRemove(s, "closeAll")));
  }

  /** No clock or disconnect is process-exit proof. A failed/unknown receipt
   * rejects or remains pending, leaving the durable execution unconfirmed. */
  async closeAllConfirmed(chatId: string): Promise<void> {
    if (!this.isConfirmedScope())
      throw new Error("PTY confirmation requires an exact scope");
    this.confirmedScope.getStore()!.closed = true;
    const key = this.chatKey(chatId);
    const ledger = this.confirmationLedgers.get(key);
    if (ledger) {
      ledger.closing = true;
      for (const handle of ledger.handles) this.requestHandleKill(handle);
    }
    // Cancel queued registration and start the existing cache cleanup now.
    const cleanup = this.closeAll(chatId);
    void cleanup.catch(() => {});
    if (ledger) {
      await Promise.all([...ledger.pending]);
      if (ledger.failure) throw ledger.failure.error;
    }
    await cleanup;
    if (this.confirmationLedgers.get(key) === ledger)
      this.confirmationLedgers.delete(key);
  }

  /** Caller must first join both tool settlement and confirmed PTY cleanup.
   * Existing async callbacks retain the sealed ALS object after map removal. */
  releaseConfirmedScope(executionId: string): void {
    const scope = this.confirmationScopes.get(executionId);
    if (scope && !scope.closed)
      throw new Error("PTY confirmation scope is not closed");
    for (const key of this.confirmationLedgers.keys()) {
      if (JSON.parse(key)[0] === executionId)
        throw new Error(
          "PTY exit confirmation is still pending or unavailable",
        );
    }
    this.confirmationScopes.delete(executionId);
  }

  // ─── internals ──────────────────────────────────────────────────────────

  private register(chatId: string, opts: AttachSessionOpts): InternalSession {
    const now = Date.now();
    const session: InternalSession = {
      sessionId: opts.sessionId,
      chatId,
      scopeKey: this.chatKey(chatId),
      pid: opts.handle.pid,
      cols: opts.cols,
      rows: opts.rows,
      createdAt: opts.createdAt ?? now,
      lastActivityAt: opts.lastActivityAt ?? now,
      handle: opts.handle,
      buffer: [],
      readCursor: 0,
      bufferTruncated: (opts.initialDroppedBytes ?? 0) > 0,
      pendingGuardrailInput: "",
      droppedBytes: opts.initialDroppedBytes ?? 0,
      idleTimer: null,
      lifetimeTimer: null,
      unsubscribe: null,
      closing: false,
      closePromise: null,
      exitedNaturally: null,
    };

    session.unsubscribe = opts.handle.onData((bytes) => {
      this.onData(session, bytes);
    });
    this.armIdleTimer(session);
    const remainingLifetime = Math.max(
      1,
      SESSION_MAX_LIFETIME_MS - (now - session.createdAt),
    );
    session.lifetimeTimer = setTimeout(() => {
      void this.killAndRemove(session, "lifetime");
    }, remainingLifetime);

    opts.handle.exited
      .then(
        (info) => {
          session.exitedNaturally = { exitCode: info.exitCode };
        },
        () => {
          session.exitedNaturally = { exitCode: null };
        },
      )
      .catch((err) =>
        console.error("[pty-session-manager] exited handler failed:", err),
      );

    let chatMap = this.chats.get(session.scopeKey);
    if (!chatMap) {
      chatMap = new Map();
      this.chats.set(session.scopeKey, chatMap);
    }
    chatMap.set(opts.sessionId, session);
    return session;
  }

  private onData(session: InternalSession, bytes: Uint8Array): void {
    if (session.closing) return;
    // Copy into an owned Uint8Array so callers can recycle buffers
    const chunk = new Uint8Array(bytes);
    session.buffer.push(chunk);
    session.lastActivityAt = Date.now();
    this.enforceRing(session);
    this.armIdleTimer(session);
  }

  private armIdleTimer(session: InternalSession): void {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      void this.killAndRemove(session, "idle");
    }, SESSION_IDLE_TIMEOUT_MS);
  }

  private enforceRing(session: InternalSession): void {
    let total = session.buffer.reduce((n, c) => n + c.byteLength, 0);
    while (total > MAX_BUFFER_BYTES && session.buffer.length > 0) {
      const dropped = session.buffer.shift()!;
      total -= dropped.byteLength;
      session.droppedBytes += dropped.byteLength;
      session.bufferTruncated = true;
      // Adjust readCursor — if bytes we had not yet shown were dropped,
      // clamp to 0 relative to the new buffer start.
      if (session.readCursor >= dropped.byteLength) {
        session.readCursor -= dropped.byteLength;
      } else {
        session.readCursor = 0;
      }
    }
  }

  private totalBufferBytes(session: PtySession): number {
    let n = 0;
    for (const chunk of session.buffer) n += chunk.byteLength;
    return n;
  }

  private sliceBuffer(
    session: PtySession,
    start: number,
    end: number,
  ): Uint8Array {
    if (end <= start) return new Uint8Array(0);
    const out = new Uint8Array(end - start);
    let outOffset = 0;
    let cursor = 0;
    for (const chunk of session.buffer) {
      const chunkStart = cursor;
      const chunkEnd = cursor + chunk.byteLength;
      if (chunkEnd <= start) {
        cursor = chunkEnd;
        continue;
      }
      if (chunkStart >= end) break;
      const sliceStart = Math.max(0, start - chunkStart);
      const sliceEnd = Math.min(chunk.byteLength, end - chunkStart);
      out.set(chunk.subarray(sliceStart, sliceEnd), outOffset);
      outOffset += sliceEnd - sliceStart;
      cursor = chunkEnd;
    }
    return out;
  }

  private killAndRemove(
    session: InternalSession,
    reason: "close" | "closeAll" | "idle" | "lifetime",
  ): Promise<void> {
    if (session.closePromise) return session.closePromise;
    session.closing = true;
    session.closePromise = this.finishClose(session, reason);
    return session.closePromise;
  }

  private async finishClose(
    session: InternalSession,
    _reason: "close" | "closeAll" | "idle" | "lifetime",
  ): Promise<void> {
    // Stop timers before kicking kill — avoids the timer re-entering kill.
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
    if (session.lifetimeTimer) {
      clearTimeout(session.lifetimeTimer);
      session.lifetimeTimer = null;
    }

    try {
      await this.stopHandle(session.handle);
    } finally {
      // Local state is a cache, not the sandbox source of truth. Guarantee it
      // is released even when both kill() and exited remain pending forever.
      this.removeSession(session);
    }
  }

  private requestHandleKill(handle: RemoteExecution): void {
    if (this.isConfirmedScope()) {
      if (this.confirmedKillRequested.has(handle)) return;
      this.confirmedKillRequested.add(handle);
    }
    // Never await kill() unbounded. E2B can leave the teardown RPC pending
    // even after the sandbox process is gone. Its catch remains attached so a
    // late rejection is still classified/logged without becoming unhandled.
    let killAttempt: Promise<void>;
    try {
      killAttempt = handle.kill();
    } catch (error) {
      killAttempt = Promise.reject(error);
    }
    void killAttempt.catch((err) => {
      if (isExpectedPtyTerminationError(err)) return;
      console.error(
        "[pty-session-manager] kill failed pid=" + handle.pid + ":",
        err,
      );
    });
  }

  private async stopHandle(handle: PtyHandle): Promise<void> {
    this.requestHandleKill(handle);
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        handle.exited.catch(() => undefined),
        new Promise<void>((resolve) => {
          fallbackTimer = setTimeout(resolve, CLOSE_EXIT_FALLBACK_MS);
        }),
      ]);
    } finally {
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
      }
    }
  }

  private removeSession(session: InternalSession): void {
    if (session.unsubscribe) {
      try {
        session.unsubscribe();
      } catch (err) {
        console.error("[pty-session-manager] unsubscribe failed:", err);
      }
      session.unsubscribe = null;
    }
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
    if (session.lifetimeTimer) {
      clearTimeout(session.lifetimeTimer);
      session.lifetimeTimer = null;
    }
    const chat = this.chats.get(session.scopeKey);
    if (chat) {
      chat.delete(session.sessionId);
      if (chat.size === 0) this.chats.delete(session.scopeKey);
    }
  }
}

/** Process-wide singleton used by `run_terminal_cmd` and `chat-handler`. */
export const ptySessionManager = new PtySessionManager();
