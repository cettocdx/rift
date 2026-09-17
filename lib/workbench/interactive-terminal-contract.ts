/** Shared browser/server contract for the persistent Workbench PTY. */

export const WORKBENCH_TERMINAL_SESSIONS_ENDPOINT =
  "/api/workbench/terminal/sessions";
export const WORKBENCH_TERMINAL_PROFILES_ENDPOINT = `${WORKBENCH_TERMINAL_SESSIONS_ENDPOINT}/profiles`;
export const WORKBENCH_TERMINAL_REQUEST_HEADER = "X-RIFT-Workbench";
export const WORKBENCH_TERMINAL_REQUEST_HEADER_VALUE = "1";
export const WORKBENCH_TERMINAL_INPUT_LEASE_HEADER =
  "X-RIFT-Terminal-Input-Lease";

export const MIN_WORKBENCH_TERMINAL_COLS = 20;
export const MAX_WORKBENCH_TERMINAL_COLS = 300;
export const MIN_WORKBENCH_TERMINAL_ROWS = 5;
export const MAX_WORKBENCH_TERMINAL_ROWS = 120;
export const MAX_WORKBENCH_TERMINAL_INPUT_BYTES = 16 * 1024;
export const MAX_WORKBENCH_TERMINALS_PER_WORKSPACE = 6;

export const WORKBENCH_TERMINAL_PROFILES = [
  { id: "shell", label: "Shell", shortLabel: "Shell" },
  { id: "claude", label: "Claude Code", shortLabel: "Claude" },
  { id: "codex", label: "Codex", shortLabel: "Codex" },
  { id: "grok", label: "Grok", shortLabel: "Grok" },
] as const;

export type WorkbenchTerminalProfile =
  (typeof WORKBENCH_TERMINAL_PROFILES)[number]["id"];

export function isWorkbenchTerminalProfile(
  value: unknown,
): value is WorkbenchTerminalProfile {
  return WORKBENCH_TERMINAL_PROFILES.some((profile) => profile.id === value);
}

export type WorkbenchTerminalProfileCapability = {
  profile: WorkbenchTerminalProfile;
  /** True when the fixed executable can be launched; the CLI owns sign-in. */
  available: boolean;
  /** The executable/runtime the server will actually start. */
  runtimeLabel: string;
  /** Human-readable explanation when the profile cannot be launched. */
  unavailableReason: string | null;
};

export type WorkbenchTerminalProfileCapabilities = {
  backend: "local" | "remote";
  profiles: WorkbenchTerminalProfileCapability[];
};

/**
 * Stable browser-owned identity for a terminal tab. The server still creates
 * an opaque PTY session id; this id only lets one tab find its own PTY after a
 * reload or a transient stream reconnect.
 */
export const WORKBENCH_CLIENT_TERMINAL_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;

export function isWorkbenchClientTerminalId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    WORKBENCH_CLIENT_TERMINAL_ID_PATTERN.test(value)
  );
}

export type WorkbenchInteractiveTerminalStatus = "running" | "exited";

export type WorkbenchInteractiveTerminalSummary = {
  id: string;
  clientTerminalId: string | null;
  pid: number;
  cwd: string;
  cols: number;
  rows: number;
  status: WorkbenchInteractiveTerminalStatus;
  exitCode: number | null;
  createdAt: number;
  lastActivityAt: number;
  expiresAt: number;
  /** Local profile requested for this PTY. Older remote sessions omit it. */
  profile?: WorkbenchTerminalProfile;
  /** True when the requested CLI existed; false means zsh fallback. */
  profileAvailable?: boolean;
  /** `local` is only issued by the explicitly enabled loopback macOS runtime. */
  backend?: "local" | "remote";
};

/** Only included in authenticated list/create payloads, never persisted. */
export type WorkbenchAuthorizedTerminalSummary =
  WorkbenchInteractiveTerminalSummary & {
    inputLease?: string;
  };

export type WorkbenchCreateTerminalRequest = {
  cols?: number;
  rows?: number;
  /** Relative to /home/user. Empty means the workspace root. */
  cwd?: string;
  /** Stable id persisted by the browser for one terminal tab. */
  clientTerminalId?: string;
  /** Fixed allowlisted launch preset; arbitrary executable names are rejected. */
  profile?: WorkbenchTerminalProfile;
};

export type WorkbenchTerminalInputRequest = {
  /** Raw terminal bytes encoded as canonical base64. */
  data: string;
};

export type WorkbenchTerminalResizeRequest = {
  cols: number;
  rows: number;
};

export type WorkbenchTerminalReadyEvent = {
  type: "ready";
  session: WorkbenchInteractiveTerminalSummary;
  cursor: number;
  reconnected: boolean;
};

export type WorkbenchTerminalOutputEvent = {
  type: "output";
  encoding: "base64";
  data: string;
  cursor: number;
};

export type WorkbenchTerminalResetEvent = {
  type: "reset";
  reason: "buffer_truncated" | "stream_reconnected" | "invalid_cursor";
  cursor: number;
};

/**
 * Planned SSE connection rotation. The PTY remains alive and the browser
 * immediately reconnects from this cursor without surfacing an error state.
 */
export type WorkbenchTerminalRotateEvent = {
  type: "rotate";
  cursor: number;
};

export type WorkbenchTerminalExitEvent = {
  type: "exit";
  exitCode: number | null;
  cursor: number;
};

export type WorkbenchTerminalStreamEvent =
  | WorkbenchTerminalReadyEvent
  | WorkbenchTerminalOutputEvent
  | WorkbenchTerminalResetEvent
  | WorkbenchTerminalRotateEvent
  | WorkbenchTerminalExitEvent;

export function workbenchTerminalSessionEndpoint(sessionId: string) {
  return `${WORKBENCH_TERMINAL_SESSIONS_ENDPOINT}/${encodeURIComponent(sessionId)}`;
}
