import "server-only";

import { randomBytes } from "node:crypto";
import { WorkbenchRequestError } from "./workspace-server";

const TERMINAL_INPUT_LEASE_TTL_MS = 10 * 60_000;
const TERMINAL_INPUT_LEASE_RENEWAL_WINDOW_MS = 30_000;
const TERMINAL_INPUT_LEASE_SWEEP_INTERVAL_MS = 60_000;
const TERMINAL_INPUT_LEASE_BUCKET_CAPACITY = 64 * 1024;
const TERMINAL_INPUT_LEASE_REFILL_PER_SECOND = 16 * 1024;
const TERMINAL_INPUT_LEASE_MIN_REQUEST_COST = 512;
const MAX_TERMINAL_INPUT_LEASES = 4_096;

export type WorkbenchTerminalLeaseContext = Readonly<{
  chatId: string | null;
  projectId: string | null;
}>;

export type WorkbenchTerminalInputLeaseBinding = Readonly<{
  userId: string;
  workspaceKey: string;
  sessionId: string;
  context: WorkbenchTerminalLeaseContext;
}>;

export type WorkbenchTerminalInputSender = (bytes: Uint8Array) => Promise<void>;

export type WorkbenchTerminalInputLeaseGrant =
  WorkbenchTerminalInputLeaseBinding & {
    sendInput: WorkbenchTerminalInputSender;
  };

type TerminalInputLease = WorkbenchTerminalInputLeaseBinding & {
  token: string;
  issuedAt: number;
  expiresAt: number;
  tokens: number;
  lastRefillAt: number;
  sendInput: WorkbenchTerminalInputSender;
};

const leases = new Map<string, TerminalInputLease>();
const leaseTokenBySession = new Map<string, string>();
let lastSweepAt = 0;

function sessionKey(workspaceKey: string, sessionId: string) {
  return JSON.stringify([workspaceKey, sessionId]);
}

function removeLease(token: string, expected?: TerminalInputLease) {
  const lease = leases.get(token);
  if (!lease || (expected && lease !== expected)) return;
  leases.delete(token);
  const key = sessionKey(lease.workspaceKey, lease.sessionId);
  if (leaseTokenBySession.get(key) === token) {
    leaseTokenBySession.delete(key);
  }
}

function sweepLeases(now: number, force = false) {
  if (!force && now - lastSweepAt < TERMINAL_INPUT_LEASE_SWEEP_INTERVAL_MS) {
    return;
  }
  lastSweepAt = now;

  for (const [token, lease] of leases) {
    if (lease.expiresAt <= now) removeLease(token, lease);
  }

  if (leases.size <= MAX_TERMINAL_INPUT_LEASES) return;
  const oldest = Array.from(leases.values()).sort(
    (left, right) => left.issuedAt - right.issuedAt,
  );
  for (
    let index = 0;
    leases.size > MAX_TERMINAL_INPUT_LEASES && index < oldest.length;
    index += 1
  ) {
    removeLease(oldest[index].token, oldest[index]);
  }
}

function sameContext(
  left: WorkbenchTerminalLeaseContext,
  right: WorkbenchTerminalLeaseContext,
) {
  return left.chatId === right.chatId && left.projectId === right.projectId;
}

function invalidLease(status = 401) {
  return new WorkbenchRequestError(
    "The terminal input lease is no longer valid.",
    status,
    "terminal_input_lease_invalid",
  );
}

/**
 * Issues one opaque, process-local capability for an already authenticated
 * live PTY. Reusing the active capability avoids rotating it underneath an
 * in-flight keystroke while list/create/events refresh concurrently.
 */
export function issueWorkbenchTerminalInputLease(
  binding: WorkbenchTerminalInputLeaseBinding,
  sendInput: WorkbenchTerminalInputSender,
) {
  const now = Date.now();
  sweepLeases(now);
  const key = sessionKey(binding.workspaceKey, binding.sessionId);
  const currentToken = leaseTokenBySession.get(key);
  const current = currentToken ? leases.get(currentToken) : undefined;
  if (
    current &&
    current.expiresAt - now > TERMINAL_INPUT_LEASE_RENEWAL_WINDOW_MS &&
    current.userId === binding.userId &&
    sameContext(current.context, binding.context)
  ) {
    current.sendInput = sendInput;
    return current.token;
  }
  if (currentToken) removeLease(currentToken, current);

  const token = randomBytes(32).toString("base64url");
  const lease: TerminalInputLease = {
    ...binding,
    context: { ...binding.context },
    token,
    issuedAt: now,
    expiresAt: now + TERMINAL_INPUT_LEASE_TTL_MS,
    tokens: TERMINAL_INPUT_LEASE_BUCKET_CAPACITY,
    lastRefillAt: now,
    sendInput,
  };
  leases.set(token, lease);
  leaseTokenBySession.set(key, token);
  sweepLeases(now, leases.size > MAX_TERMINAL_INPUT_LEASES);
  return token;
}

/**
 * Validates and charges a fast-path mutation. The capability itself is the
 * authorization for exactly one authenticated user/workspace/session tuple;
 * it never leaves process memory except in the authenticated response and the
 * caller's subsequent request header.
 */
export function consumeWorkbenchTerminalInputLease(args: {
  token: string;
  sessionId: string;
  context: WorkbenchTerminalLeaseContext;
  inputBytes: number;
}): WorkbenchTerminalInputLeaseGrant {
  const now = Date.now();
  sweepLeases(now);
  if (!/^[A-Za-z0-9_-]{43}$/.test(args.token)) throw invalidLease();

  const lease = leases.get(args.token);
  if (!lease) throw invalidLease();
  if (lease.expiresAt <= now) {
    removeLease(args.token, lease);
    throw invalidLease();
  }
  if (
    lease.sessionId !== args.sessionId ||
    !sameContext(lease.context, args.context)
  ) {
    throw invalidLease(403);
  }
  if (!Number.isSafeInteger(args.inputBytes) || args.inputBytes <= 0) {
    throw new WorkbenchRequestError(
      "Terminal input size is invalid.",
      400,
      "invalid_terminal_input",
    );
  }

  const elapsedMs = Math.max(0, now - lease.lastRefillAt);
  lease.tokens = Math.min(
    TERMINAL_INPUT_LEASE_BUCKET_CAPACITY,
    lease.tokens + (elapsedMs / 1000) * TERMINAL_INPUT_LEASE_REFILL_PER_SECOND,
  );
  lease.lastRefillAt = now;
  const cost = Math.max(TERMINAL_INPUT_LEASE_MIN_REQUEST_COST, args.inputBytes);
  if (lease.tokens < cost) {
    const missing = cost - lease.tokens;
    throw new WorkbenchRequestError(
      "Terminal input is arriving too quickly. Please wait a moment and retry.",
      429,
      "terminal_input_rate_limited",
      {
        retryAfterMs: Math.max(
          1,
          Math.ceil((missing / TERMINAL_INPUT_LEASE_REFILL_PER_SECOND) * 1000),
        ),
      },
    );
  }
  lease.tokens -= cost;

  return {
    userId: lease.userId,
    workspaceKey: lease.workspaceKey,
    sessionId: lease.sessionId,
    context: { ...lease.context },
    sendInput: lease.sendInput,
  };
}

export function revokeWorkbenchTerminalInputLease(token: string) {
  removeLease(token);
}

export function revokeWorkbenchTerminalInputLeases(
  workspaceKey: string,
  sessionId: string,
) {
  const token = leaseTokenBySession.get(sessionKey(workspaceKey, sessionId));
  if (token) removeLease(token);
}

export function resetWorkbenchTerminalInputLeasesForTests() {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Terminal input lease reset is test-only.");
  }
  leases.clear();
  leaseTokenBySession.clear();
  lastSweepAt = 0;
}

export const WORKBENCH_TERMINAL_INPUT_LEASE_TTL_MS =
  TERMINAL_INPUT_LEASE_TTL_MS;
