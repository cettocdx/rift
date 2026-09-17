import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { CommandExitError, type Sandbox } from "@e2b/code-interpreter";
import { isBinaryFileSync } from "isbinaryfile";
import { z } from "zod";
import { ChatSDKError } from "@/lib/errors";
import { getUserIDAndPro } from "@/lib/auth/get-user-id";
import { assertPremiumAccess } from "@/lib/auth/premium-access";
import { assertUserCanMakeCostIncurringRequest } from "@/lib/suspensions";
import { HybridSandboxManager } from "@/lib/ai/tools/utils/hybrid-sandbox-manager";
import { isE2BSandbox } from "@/lib/ai/tools/utils/sandbox-types";
import { getChatById } from "@/lib/db/actions";
import {
  resolveProjectRuntimeContext,
  type ProjectRuntimeContext,
} from "@/lib/projects/project-runtime";
import {
  MAX_EDITABLE_FILE_BYTES,
  WORKBENCH_ROOT,
  WorkbenchPathError,
  isWorkspaceEntryVisible,
  normalizeWorkspacePath,
  workspaceRevision,
} from "./path-policy";
import {
  ATOMIC_SAVE_COMMAND,
  LIST_DIRECTORY_COMMAND,
  PREPARE_WORKBENCH_STATE_COMMAND,
  READ_FILE_COMMAND,
  VERIFY_DIRECTORY_COMMAND,
  WORKBENCH_STATE_ROOT,
} from "./sandbox-fs-commands";
import { workbenchTerminalSandboxUserId } from "./terminal-contract";
import {
  WORKBENCH_CHAT_ID_HEADER,
  WORKBENCH_PROJECT_ID_HEADER,
} from "./project-context";
import { resolveLocalWorkspaceRoot } from "./local-pty-adapter";

const WORKBENCH_USER = "user" as const;
const WORKBENCH_REQUEST_HEADER = "x-rift-workbench";
const WORKBENCH_REQUEST_HEADER_VALUE = "1";
const MAX_DIRECTORY_ENTRIES = 500;
const MAX_SCANNED_DIRECTORY_ENTRIES = 2_000;
const MAX_CONCURRENT_WORKBENCH_REQUESTS = 4;
const MAX_WORKBENCH_REQUESTS_PER_WINDOW = 120;
const WORKBENCH_REQUEST_WINDOW_MS = 60_000;
const WORKBENCH_LIMITER_IDLE_TTL_MS = 5 * WORKBENCH_REQUEST_WINDOW_MS;
const WORKBENCH_TERMINAL_INPUT_BUCKET_CAPACITY = 64 * 1024;
const WORKBENCH_TERMINAL_INPUT_REFILL_PER_SECOND = 16 * 1024;
const WORKBENCH_TERMINAL_INPUT_MIN_REQUEST_COST = 512;
const WORKBENCH_SANDBOX_MANAGER_IDLE_TTL_MS = 10 * 60_000;
const MAX_WORKBENCH_CONTEXT_ID_LENGTH = 256;

type WorkbenchAccess = Awaited<ReturnType<typeof getUserIDAndPro>>;

type WarmWorkspaceSandboxManager = {
  manager: HybridSandboxManager;
  lastUsedAt: number;
};

const workspaceSandboxManagers = new Map<string, WarmWorkspaceSandboxManager>();
const manualTerminalSandboxConnectionPromises = new Map<
  string,
  Promise<Sandbox>
>();

type WorkbenchRequestLimitState = {
  activeRequests: number;
  requestCount: number;
  windowStartedAt: number;
  lastSeenAt: number;
};

const workbenchRequestLimits = new Map<string, WorkbenchRequestLimitState>();
type WorkbenchTerminalInputLimitState = {
  tokens: number;
  lastRefillAt: number;
  lastSeenAt: number;
};
const workbenchTerminalInputLimits = new Map<
  string,
  WorkbenchTerminalInputLimitState
>();
const activeManualTerminalUsers = new Set<string>();
let lastWorkbenchLimiterSweepAt = 0;
let lastWorkspaceSandboxManagerSweepAt = 0;

const directoryCommandSchema = z.object({
  entries: z
    .array(
      z.object({
        name: z
          .string()
          .min(1)
          .max(255)
          .refine(
            (name) =>
              name !== "." &&
              name !== ".." &&
              !name.includes("/") &&
              !name.includes("\\") &&
              !/[\u0000-\u001f\u007f]/.test(name),
          ),
        type: z.enum(["file", "directory"]),
        size: z.number().int().nonnegative(),
        modifiedAt: z.string(),
      }),
    )
    .max(MAX_SCANNED_DIRECTORY_ENTRIES),
  sourceTruncated: z.boolean(),
});

const readCommandSchema = z.object({
  data: z.string().max(Math.ceil((MAX_EDITABLE_FILE_BYTES * 4) / 3) + 8),
  size: z.number().int().nonnegative().max(MAX_EDITABLE_FILE_BYTES),
  modifiedAt: z.string(),
});

const saveCommandSchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().nonnegative().max(MAX_EDITABLE_FILE_BYTES),
  modifiedAt: z.string(),
});

export class WorkbenchRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "WorkbenchRequestError";
  }
}

export type WorkbenchFileEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  modifiedAt: string | null;
};

function assertWorkbenchRequestHeader(req: NextRequest) {
  if (
    req.headers.get(WORKBENCH_REQUEST_HEADER) !== WORKBENCH_REQUEST_HEADER_VALUE
  ) {
    throw new WorkbenchRequestError(
      "This request is not a Workbench client request.",
      403,
      "workbench_header_required",
    );
  }
}

function assertWorkbenchRequestOrigin(req: NextRequest) {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite.trim().toLowerCase() !== "same-origin") {
    throw new WorkbenchRequestError(
      "Cross-origin workspace requests are not allowed.",
      403,
      "cross_origin",
    );
  }

  const origin = req.headers.get("origin");
  if (!origin) return;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new WorkbenchRequestError(
      "Invalid request origin.",
      403,
      "invalid_origin",
    );
  }

  const requestUrl = new URL(req.url);
  if (originUrl.origin !== origin) {
    throw new WorkbenchRequestError(
      "Invalid request origin.",
      403,
      "invalid_origin",
    );
  }
  if (originUrl.origin !== requestUrl.origin) {
    throw new WorkbenchRequestError(
      "Cross-origin workspace requests are not allowed.",
      403,
      "cross_origin",
    );
  }
}

function assertWorkbenchRequest(req: NextRequest) {
  assertWorkbenchRequestHeader(req);
  assertWorkbenchRequestOrigin(req);
}

export function assertSameOriginMutation(req: NextRequest) {
  assertWorkbenchRequest(req);
}

export async function authorizePremiumWorkbench(
  req: NextRequest,
): Promise<WorkbenchAccess> {
  assertWorkbenchRequest(req);

  const authorization = req.headers.get("authorization")?.trim() ?? "";
  if (/^Bearer\s+rift_live_/i.test(authorization)) {
    throw new WorkbenchRequestError(
      "Personal API keys do not include raw Workbench file access.",
      403,
      "api_key_scope_required",
    );
  }

  const access = await getUserIDAndPro(req);
  assertPremiumAccess(access.subscription, "workbench");
  await assertUserCanMakeCostIncurringRequest(access.userId);
  return access;
}

export async function readWorkbenchRequestTextWithLimit(
  req: NextRequest,
  maxBytes: number,
) {
  const contentEncoding = req.headers.get("content-encoding");
  if (contentEncoding && contentEncoding !== "identity") {
    throw new WorkbenchRequestError(
      "Compressed Workbench requests are not supported.",
      415,
      "unsupported_content_encoding",
    );
  }

  const rawContentLength = req.headers.get("content-length");
  if (rawContentLength !== null) {
    const contentLength = Number(rawContentLength);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      throw new WorkbenchRequestError(
        "The request has an invalid content length.",
        400,
        "invalid_content_length",
      );
    }
    if (contentLength > maxBytes) {
      throw new WorkbenchRequestError(
        "The Workbench payload is too large.",
        413,
        "payload_too_large",
      );
    }
  }

  if (!req.body) return "";
  const reader = req.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new WorkbenchRequestError(
          "The Workbench payload is too large.",
          413,
          "payload_too_large",
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    if (error instanceof WorkbenchRequestError) throw error;
    throw new WorkbenchRequestError(
      "The request body must be valid UTF-8 JSON.",
      400,
      "invalid_payload",
    );
  } finally {
    reader.releaseLock();
  }
}

function sweepWorkbenchRequestLimits(now: number) {
  if (now - lastWorkbenchLimiterSweepAt < WORKBENCH_REQUEST_WINDOW_MS) {
    return;
  }
  lastWorkbenchLimiterSweepAt = now;

  for (const [userId, state] of workbenchRequestLimits) {
    if (
      state.activeRequests === 0 &&
      now - state.lastSeenAt >= WORKBENCH_LIMITER_IDLE_TTL_MS
    ) {
      workbenchRequestLimits.delete(userId);
    }
  }

  for (const [userId, state] of workbenchTerminalInputLimits) {
    if (now - state.lastSeenAt >= WORKBENCH_LIMITER_IDLE_TTL_MS) {
      workbenchTerminalInputLimits.delete(userId);
    }
  }
}

function acquireWorkbenchRequestSlot(
  userId: string,
  countAgainstRequestWindow = true,
) {
  const now = Date.now();
  sweepWorkbenchRequestLimits(now);

  let state = workbenchRequestLimits.get(userId);
  if (!state) {
    state = {
      activeRequests: 0,
      requestCount: 0,
      windowStartedAt: now,
      lastSeenAt: now,
    };
    workbenchRequestLimits.set(userId, state);
  } else if (now - state.windowStartedAt >= WORKBENCH_REQUEST_WINDOW_MS) {
    state.requestCount = 0;
    state.windowStartedAt = now;
  }

  state.lastSeenAt = now;
  if (countAgainstRequestWindow) {
    if (state.requestCount >= MAX_WORKBENCH_REQUESTS_PER_WINDOW) {
      throw new WorkbenchRequestError(
        "Too many Workbench requests. Please wait a moment and try again.",
        429,
        "workbench_rate_limited",
        {
          retryAfterMs: Math.max(
            1,
            state.windowStartedAt + WORKBENCH_REQUEST_WINDOW_MS - now,
          ),
        },
      );
    }
    state.requestCount += 1;
  }

  if (state.activeRequests >= MAX_CONCURRENT_WORKBENCH_REQUESTS) {
    throw new WorkbenchRequestError(
      "Too many Workbench operations are already running.",
      429,
      "workbench_concurrency_limited",
      { maxConcurrent: MAX_CONCURRENT_WORKBENCH_REQUESTS },
    );
  }
  state.activeRequests += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.activeRequests = Math.max(0, state.activeRequests - 1);
    state.lastSeenAt = Date.now();
  };
}

function consumeWorkbenchTerminalInputTokens(
  userId: string,
  inputBytes: number,
) {
  if (!Number.isSafeInteger(inputBytes) || inputBytes <= 0) {
    throw new WorkbenchRequestError(
      "Terminal input size is invalid.",
      400,
      "invalid_terminal_input",
    );
  }
  const now = Date.now();
  sweepWorkbenchRequestLimits(now);

  let state = workbenchTerminalInputLimits.get(userId);
  if (!state) {
    state = {
      tokens: WORKBENCH_TERMINAL_INPUT_BUCKET_CAPACITY,
      lastRefillAt: now,
      lastSeenAt: now,
    };
    workbenchTerminalInputLimits.set(userId, state);
  } else {
    const elapsedMs = Math.max(0, now - state.lastRefillAt);
    state.tokens = Math.min(
      WORKBENCH_TERMINAL_INPUT_BUCKET_CAPACITY,
      state.tokens +
        (elapsedMs / 1000) * WORKBENCH_TERMINAL_INPUT_REFILL_PER_SECOND,
    );
    state.lastRefillAt = now;
    state.lastSeenAt = now;
  }

  const cost = Math.max(WORKBENCH_TERMINAL_INPUT_MIN_REQUEST_COST, inputBytes);
  if (state.tokens < cost) {
    const missing = cost - state.tokens;
    throw new WorkbenchRequestError(
      "Terminal input is arriving too quickly. Please wait a moment and retry.",
      429,
      "terminal_input_rate_limited",
      {
        retryAfterMs: Math.max(
          1,
          Math.ceil(
            (missing / WORKBENCH_TERMINAL_INPUT_REFILL_PER_SECOND) * 1000,
          ),
        ),
      },
    );
  }
  state.tokens -= cost;
}

function acquireManualTerminalSlot(userId: string) {
  if (activeManualTerminalUsers.has(userId)) {
    throw new WorkbenchRequestError(
      "Another terminal command is already running.",
      429,
      "terminal_busy",
    );
  }

  activeManualTerminalUsers.add(userId);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeManualTerminalUsers.delete(userId);
  };
}

function optionalContextHeader(req: NextRequest, header: string) {
  const value = req.headers.get(header)?.trim();
  if (!value) return undefined;
  if (value.length > MAX_WORKBENCH_CONTEXT_ID_LENGTH) {
    throw new WorkbenchRequestError(
      "The Workbench project context is invalid.",
      400,
      "invalid_workspace_context",
    );
  }
  return value;
}

export function workbenchTerminalLeaseContext(req: NextRequest) {
  return {
    chatId: optionalContextHeader(req, WORKBENCH_CHAT_ID_HEADER) ?? null,
    projectId: optionalContextHeader(req, WORKBENCH_PROJECT_ID_HEADER) ?? null,
  } as const;
}

async function resolveWorkbenchProjectRuntime(
  req: NextRequest,
  access: WorkbenchAccess,
): Promise<ProjectRuntimeContext> {
  const context = workbenchTerminalLeaseContext(req);
  const chatId = context.chatId ?? undefined;
  const requestedProject = context.projectId ?? undefined;
  const chat = chatId ? await getChatById({ id: chatId }) : undefined;

  // A route-bound Workbench must never fall back to the account workspace.
  // Otherwise a stale/deleted chat URL could make Explorer or the terminal
  // operate on a different sandbox while the UI still displays that chat.
  if (chatId && !chat) {
    throw new ChatSDKError("not_found:chat");
  }

  return resolveProjectRuntimeContext({
    userId: access.userId,
    chat,
    requestedProject,
    requestedPurpose: "app",
  });
}

function sandboxConnectionKey(
  access: WorkbenchAccess,
  projectRuntime: ProjectRuntimeContext,
) {
  return `${access.userId}\0${projectRuntime.sandboxNamespace ?? "account"}`;
}

const LOCAL_TERMINAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * The host PTY is an intentionally explicit development capability. It is
 * never selected from a browser-controlled field and is unavailable on a
 * deployed/non-macOS runtime even if a caller forges Host or Origin headers.
 */
export function isLocalMacWorkbenchTerminalRequest(req: NextRequest) {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.RIFT_LOCAL_TERMINAL !== "1" ||
    process.platform !== "darwin"
  ) {
    return false;
  }
  return LOCAL_TERMINAL_HOSTNAMES.has(req.nextUrl.hostname.toLowerCase());
}

async function withPremiumLocalWorkbenchTerminalInternal<T>(
  req: NextRequest,
  action: (
    userId: string,
    workspaceKey: string,
    workspaceRoot: string,
  ) => Promise<T>,
  verifiedAccess: WorkbenchAccess | undefined,
  inputBytes: number | undefined,
) {
  if (!isLocalMacWorkbenchTerminalRequest(req)) {
    throw new WorkbenchRequestError(
      "The local terminal runtime is unavailable.",
      404,
      "local_terminal_unavailable",
    );
  }
  const access = verifiedAccess
    ? (assertWorkbenchRequest(req), verifiedAccess)
    : await authorizePremiumWorkbench(req);
  const releaseRequestSlot = acquireWorkbenchRequestSlot(
    access.userId,
    inputBytes === undefined,
  );

  try {
    if (inputBytes !== undefined) {
      consumeWorkbenchTerminalInputTokens(access.userId, inputBytes);
    }
    // This preserves the same chat/project ownership checks used before an
    // E2B connection. Only the backend changes; the authorization boundary
    // and per-context session namespace do not.
    const projectRuntime = await resolveWorkbenchProjectRuntime(req, access);
    const workspaceKey = `local\0${sandboxConnectionKey(
      access,
      projectRuntime,
    )}`;
    return await action(
      access.userId,
      workspaceKey,
      resolveLocalWorkspaceRoot(),
    );
  } finally {
    releaseRequestSlot();
  }
}

export function withPremiumLocalWorkbenchTerminal<T>(
  req: NextRequest,
  action: (
    userId: string,
    workspaceKey: string,
    workspaceRoot: string,
  ) => Promise<T>,
  verifiedAccess?: WorkbenchAccess,
) {
  return withPremiumLocalWorkbenchTerminalInternal(
    req,
    action,
    verifiedAccess,
    undefined,
  );
}

export function withPremiumLocalWorkbenchTerminalInput<T>(
  req: NextRequest,
  inputBytes: number,
  action: (
    userId: string,
    workspaceKey: string,
    workspaceRoot: string,
  ) => Promise<T>,
  verifiedAccess?: WorkbenchAccess,
) {
  return withPremiumLocalWorkbenchTerminalInternal(
    req,
    action,
    verifiedAccess,
    inputBytes,
  );
}

function sweepWorkspaceSandboxManagers(now: number) {
  if (
    now - lastWorkspaceSandboxManagerSweepAt <
    WORKBENCH_SANDBOX_MANAGER_IDLE_TTL_MS
  ) {
    return;
  }
  lastWorkspaceSandboxManagerSweepAt = now;
  for (const [key, entry] of workspaceSandboxManagers) {
    if (now - entry.lastUsedAt >= WORKBENCH_SANDBOX_MANAGER_IDLE_TTL_MS) {
      workspaceSandboxManagers.delete(key);
    }
  }
}

function staleSandboxConnectionError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  if (error.name === "SandboxNotFoundError") return true;
  return (
    message.includes("not running anymore") ||
    (message.includes("sandbox") &&
      (message.includes("not found") ||
        message.includes("not running") ||
        message.includes("expired") ||
        message.includes("deleted") ||
        message.includes("timeout")))
  );
}

function invalidateWorkspaceSandboxManager(
  connectionKey: string,
  expected: WarmWorkspaceSandboxManager,
) {
  if (workspaceSandboxManagers.get(connectionKey) === expected) {
    workspaceSandboxManagers.delete(connectionKey);
  }
}

export function resetWorkbenchWorkspaceSandboxCacheForTests() {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Workbench sandbox cache reset is test-only.");
  }
  workspaceSandboxManagers.clear();
  lastWorkspaceSandboxManagerSweepAt = 0;
}

// These Workspace endpoints use E2B-only filesystem and PTY APIs. Selected
// local Build runners are handled by the agent manager, never coerced here.
async function getCloudWorkspaceSandbox(manager: HybridSandboxManager) {
  const { sandbox } = await manager.getSandbox();
  if (!isE2BSandbox(sandbox)) {
    throw new Error("This Workspace requires a cloud sandbox.");
  }
  return sandbox;
}

async function connectWorkspaceSandbox(
  access: WorkbenchAccess,
  projectRuntime: ProjectRuntimeContext,
) {
  const connectionKey = sandboxConnectionKey(access, projectRuntime);
  const now = Date.now();
  sweepWorkspaceSandboxManagers(now);
  let entry = workspaceSandboxManagers.get(connectionKey);
  if (!entry) {
    entry = {
      manager: new HybridSandboxManager(
        access.userId,
        () => {},
        "e2b",
        process.env.CONVEX_SERVICE_ROLE_KEY ?? "",
        null,
        access.subscription,
        undefined,
        projectRuntime.sandboxNamespace,
      ),
      lastUsedAt: now,
    };
    workspaceSandboxManagers.set(connectionKey, entry);
  } else {
    entry.lastUsedAt = now;
  }

  try {
    const sandbox = await getCloudWorkspaceSandbox(entry.manager);
    entry.lastUsedAt = Date.now();
    return { sandbox, workspaceKey: connectionKey, cacheEntry: entry };
  } catch (error) {
    invalidateWorkspaceSandboxManager(connectionKey, entry);
    throw error;
  }
}

async function connectManualTerminalSandbox(
  access: WorkbenchAccess,
  projectRuntime: ProjectRuntimeContext,
) {
  // A project-bound runner must see exactly the files created by Build. The
  // namespace is opaque and ownership-checked above, so reuse that sandbox.
  // Standalone Workspace keeps its existing hardened, terminal-only sandbox.
  if (projectRuntime.sandboxNamespace) {
    return connectWorkspaceSandbox(access, projectRuntime);
  }

  // The browser-controlled shell must never share a sandbox with agent turns.
  // Agent commands may receive server-owned recon keys and configure Git
  // credentials. A separate E2B namespace keeps those secrets out of the
  // manual shell while preserving an isolated, persistent premium workspace.
  const terminalUserId = workbenchTerminalSandboxUserId(access.userId);
  const existing = manualTerminalSandboxConnectionPromises.get(terminalUserId);
  if (existing) return { sandbox: await existing };

  const manager = new HybridSandboxManager(
    terminalUserId,
    () => {},
    "e2b",
    process.env.CONVEX_SERVICE_ROLE_KEY ?? "",
    null,
    access.subscription,
  );
  const connection = getCloudWorkspaceSandbox(manager);
  manualTerminalSandboxConnectionPromises.set(terminalUserId, connection);

  try {
    return { sandbox: await connection };
  } finally {
    if (
      manualTerminalSandboxConnectionPromises.get(terminalUserId) === connection
    ) {
      manualTerminalSandboxConnectionPromises.delete(terminalUserId);
    }
  }
}

export async function withPremiumWorkspaceSandbox<T>(
  req: NextRequest,
  action: (
    sandbox: Sandbox,
    userId: string,
    workspaceKey: string,
  ) => Promise<T>,
  verifiedAccess?: WorkbenchAccess,
) {
  const access = verifiedAccess
    ? (assertWorkbenchRequest(req), verifiedAccess)
    : await authorizePremiumWorkbench(req);
  const releaseRequestSlot = acquireWorkbenchRequestSlot(access.userId);

  try {
    const projectRuntime = await resolveWorkbenchProjectRuntime(req, access);
    const connected = await connectWorkspaceSandbox(access, projectRuntime);
    try {
      return await action(
        connected.sandbox,
        access.userId,
        connected.workspaceKey,
      );
    } catch (error) {
      if (staleSandboxConnectionError(error)) {
        invalidateWorkspaceSandboxManager(
          connected.workspaceKey,
          connected.cacheEntry,
        );
      }
      throw error;
    }
  } finally {
    releaseRequestSlot();
  }
}

/**
 * Terminal keystrokes use a byte-aware token bucket instead of the generic
 * 120-request Workbench window. They still share the per-user concurrency cap,
 * and every request is authenticated and resolved to an authoritative project
 * runtime before the callback runs.
 */
export async function withPremiumWorkspaceTerminalInputSandbox<T>(
  req: NextRequest,
  inputBytes: number,
  action: (
    sandbox: Sandbox,
    userId: string,
    workspaceKey: string,
  ) => Promise<T>,
  verifiedAccess?: WorkbenchAccess,
) {
  const access = verifiedAccess
    ? (assertWorkbenchRequest(req), verifiedAccess)
    : await authorizePremiumWorkbench(req);
  const releaseRequestSlot = acquireWorkbenchRequestSlot(access.userId, false);

  try {
    consumeWorkbenchTerminalInputTokens(access.userId, inputBytes);
    const projectRuntime = await resolveWorkbenchProjectRuntime(req, access);
    const connected = await connectWorkspaceSandbox(access, projectRuntime);
    try {
      return await action(
        connected.sandbox,
        access.userId,
        connected.workspaceKey,
      );
    } catch (error) {
      if (staleSandboxConnectionError(error)) {
        invalidateWorkspaceSandboxManager(
          connected.workspaceKey,
          connected.cacheEntry,
        );
      }
      throw error;
    }
  } finally {
    releaseRequestSlot();
  }
}

export async function withPremiumManualTerminalSandbox<T>(
  req: NextRequest,
  action: (sandbox: Sandbox, userId: string) => Promise<T>,
  verifiedAccess?: WorkbenchAccess,
) {
  const access = verifiedAccess
    ? (assertWorkbenchRequest(req), verifiedAccess)
    : await authorizePremiumWorkbench(req);
  const releaseRequestSlot = acquireWorkbenchRequestSlot(access.userId);
  let releaseTerminalSlot: (() => void) | undefined;

  try {
    releaseTerminalSlot = acquireManualTerminalSlot(access.userId);
    const projectRuntime = await resolveWorkbenchProjectRuntime(req, access);
    const connected = await connectManualTerminalSandbox(
      access,
      projectRuntime,
    );
    try {
      return await action(connected.sandbox, access.userId);
    } catch (error) {
      if (
        "workspaceKey" in connected &&
        "cacheEntry" in connected &&
        staleSandboxConnectionError(error)
      ) {
        invalidateWorkspaceSandboxManager(
          connected.workspaceKey,
          connected.cacheEntry,
        );
      }
      throw error;
    }
  } finally {
    releaseTerminalSlot?.();
    releaseRequestSlot();
  }
}

function commandError(
  error: unknown,
  expectedType: "file" | "directory",
): never {
  if (!(error instanceof CommandExitError)) throw error;

  if (error.exitCode === 41) {
    throw new WorkbenchRequestError(
      "Symbolic links are not opened by Workbench.",
      400,
      "symlink_not_allowed",
    );
  }
  if (error.exitCode === 44) {
    throw new WorkbenchRequestError(
      "Workspace item not found.",
      404,
      "not_found",
    );
  }
  if (error.exitCode === 45) {
    throw new WorkbenchRequestError(
      "This file is too large for the Workbench editor.",
      413,
      "file_too_large",
      { maxBytes: MAX_EDITABLE_FILE_BYTES },
    );
  }
  if (error.exitCode === 46) {
    throw new WorkbenchRequestError(
      expectedType === "directory"
        ? "The workspace path is not a directory."
        : "The workspace path is not a file.",
      400,
      expectedType === "directory" ? "not_directory" : "not_file",
    );
  }
  if (error.exitCode === 47) {
    throw new WorkbenchRequestError(
      "The file changed while Workbench was reading it. Please retry.",
      409,
      "unstable_file_snapshot",
      { retryable: true },
    );
  }

  throw error;
}

function parseCommandResult<T>(stdout: string, schema: z.ZodType<T>): T {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new WorkbenchRequestError(
      "The sandbox returned an invalid workspace response.",
      502,
      "invalid_sandbox_response",
    );
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new WorkbenchRequestError(
      "The sandbox returned an invalid workspace response.",
      502,
      "invalid_sandbox_response",
    );
  }
  return parsed.data;
}

async function runWorkspaceCommand(
  sandbox: Sandbox,
  command: string,
  relativePath: string,
  extraEnvs?: Record<string, string>,
) {
  return sandbox.commands.run(command, {
    cwd: WORKBENCH_ROOT,
    user: WORKBENCH_USER,
    timeoutMs: 10_000,
    envs: {
      RIFT_ROOT: WORKBENCH_ROOT,
      RIFT_RELATIVE: relativePath,
      ...extraEnvs,
    },
  });
}

export async function assertWorkspaceDirectoryAccess(
  sandbox: Sandbox,
  path: string,
) {
  const relativePath = normalizeWorkspacePath(path);
  try {
    await runWorkspaceCommand(sandbox, VERIFY_DIRECTORY_COMMAND, relativePath);
  } catch (error) {
    commandError(error, "directory");
  }
  return relativePath;
}

export async function listWorkspaceDirectory(sandbox: Sandbox, path: string) {
  const relativePath = normalizeWorkspacePath(path);
  let stdout: string;
  try {
    ({ stdout } = await runWorkspaceCommand(
      sandbox,
      LIST_DIRECTORY_COMMAND,
      relativePath,
      { RIFT_SCAN_LIMIT: String(MAX_SCANNED_DIRECTORY_ENTRIES) },
    ));
  } catch (error) {
    commandError(error, "directory");
  }

  const result = parseCommandResult(stdout, directoryCommandSchema);
  const visibleEntries = result.entries
    .flatMap<WorkbenchFileEntry>((entry) => {
      if (!isWorkspaceEntryVisible(relativePath, entry.name)) return [];
      const entryPath = normalizeWorkspacePath(
        relativePath ? `${relativePath}/${entry.name}` : entry.name,
      );
      return [
        {
          name: entry.name,
          path: entryPath,
          type: entry.type,
          size: entry.size,
          modifiedAt: entry.modifiedAt,
        },
      ];
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

  return {
    path: relativePath,
    entries: visibleEntries.slice(0, MAX_DIRECTORY_ENTRIES),
    truncated:
      result.sourceTruncated || visibleEntries.length > MAX_DIRECTORY_ENTRIES,
  };
}

export async function readWorkspaceFile(sandbox: Sandbox, path: string) {
  const relativePath = normalizeWorkspacePath(path);
  if (!relativePath) {
    throw new WorkbenchRequestError(
      "Select a file to open.",
      400,
      "file_required",
    );
  }

  let stdout: string;
  try {
    ({ stdout } = await runWorkspaceCommand(
      sandbox,
      READ_FILE_COMMAND,
      relativePath,
      { RIFT_MAX_BYTES: String(MAX_EDITABLE_FILE_BYTES) },
    ));
  } catch (error) {
    commandError(error, "file");
  }

  const result = parseCommandResult(stdout, readCommandSchema);
  const buffer = Buffer.from(result.data, "base64");
  if (
    buffer.byteLength !== result.size ||
    buffer.toString("base64") !== result.data
  ) {
    throw new WorkbenchRequestError(
      "The sandbox returned an invalid file payload.",
      502,
      "invalid_sandbox_response",
    );
  }
  if (isBinaryFileSync(buffer)) {
    throw new WorkbenchRequestError(
      "Binary files cannot be edited in Workbench yet.",
      415,
      "binary_file",
    );
  }

  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new WorkbenchRequestError(
      "This file is not valid UTF-8 text.",
      415,
      "unsupported_encoding",
    );
  }

  return {
    path: relativePath,
    content,
    revision: workspaceRevision(buffer),
    size: buffer.byteLength,
    modifiedAt: result.modifiedAt,
  };
}

async function prepareWorkbenchState(sandbox: Sandbox) {
  try {
    await sandbox.commands.run(PREPARE_WORKBENCH_STATE_COMMAND, {
      cwd: WORKBENCH_ROOT,
      user: WORKBENCH_USER,
      timeoutMs: 5_000,
      envs: { RIFT_HOME: WORKBENCH_ROOT },
    });
  } catch (error) {
    commandError(error, "directory");
  }
}

export async function writeWorkspaceFile(
  sandbox: Sandbox,
  args: { path: string; content: string; expectedRevision: string },
) {
  const relativePath = normalizeWorkspacePath(args.path);
  if (!relativePath) {
    throw new WorkbenchRequestError(
      "Select a file to save.",
      400,
      "file_required",
    );
  }

  const contentBytes = Buffer.from(args.content, "utf8");
  if (contentBytes.byteLength > MAX_EDITABLE_FILE_BYTES) {
    throw new WorkbenchRequestError(
      "This file is too large for the Workbench editor.",
      413,
      "file_too_large",
      { maxBytes: MAX_EDITABLE_FILE_BYTES, size: contentBytes.byteLength },
    );
  }

  await prepareWorkbenchState(sandbox);
  const nextRevision = workspaceRevision(contentBytes);
  const tempName = randomUUID();
  const tempPath = `${WORKBENCH_STATE_ROOT}/tmp/${tempName}`;

  try {
    await sandbox.files.write(tempPath, args.content, {
      user: WORKBENCH_USER,
    });

    let commandResult;
    try {
      commandResult = await runWorkspaceCommand(
        sandbox,
        ATOMIC_SAVE_COMMAND,
        relativePath,
        {
          RIFT_STATE_ROOT: WORKBENCH_STATE_ROOT,
          RIFT_TEMP_NAME: tempName,
          RIFT_EXPECTED_REVISION: args.expectedRevision,
          RIFT_NEXT_REVISION: nextRevision,
          RIFT_MAX_BYTES: String(MAX_EDITABLE_FILE_BYTES),
        },
      );
    } catch (error) {
      if (error instanceof CommandExitError && error.exitCode === 42) {
        throw new WorkbenchRequestError(
          "The file changed in the sandbox after it was opened.",
          409,
          "revision_conflict",
          { currentRevision: error.stdout.trim() || undefined },
        );
      }
      if (error instanceof CommandExitError && error.exitCode === 43) {
        throw new WorkbenchRequestError(
          "The staged file could not be verified before saving.",
          500,
          "staged_file_invalid",
        );
      }
      commandError(error, "file");
    }

    const saved = parseCommandResult(commandResult.stdout, saveCommandSchema);
    if (
      saved.revision !== nextRevision ||
      saved.size !== contentBytes.byteLength
    ) {
      throw new WorkbenchRequestError(
        "The sandbox returned an invalid save result.",
        502,
        "invalid_sandbox_response",
      );
    }

    return {
      path: relativePath,
      revision: saved.revision,
      size: saved.size,
      modifiedAt: saved.modifiedAt,
    };
  } finally {
    await sandbox.files
      .remove(tempPath, { user: WORKBENCH_USER })
      .catch(() => {});
  }
}

export function workbenchErrorResponse(error: unknown) {
  if (error instanceof ChatSDKError) {
    const response = error.toResponse();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  if (error instanceof WorkbenchPathError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (error instanceof WorkbenchRequestError) {
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.details },
      {
        status: error.status,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }

  console.error("[workbench] request failed", error);
  return NextResponse.json(
    {
      error: "The sandbox workspace could not be reached.",
      code: "workspace_unavailable",
    },
    { status: 500, headers: { "Cache-Control": "private, no-store" } },
  );
}
