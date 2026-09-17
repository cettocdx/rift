"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { RotateCcw } from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  MAX_WORKBENCH_TERMINAL_COLS,
  MAX_WORKBENCH_TERMINAL_INPUT_BYTES,
  MAX_WORKBENCH_TERMINAL_ROWS,
  MIN_WORKBENCH_TERMINAL_COLS,
  MIN_WORKBENCH_TERMINAL_ROWS,
  WORKBENCH_TERMINAL_PROFILES,
  WORKBENCH_TERMINAL_SESSIONS_ENDPOINT,
  isWorkbenchClientTerminalId,
  isWorkbenchTerminalProfile,
  type WorkbenchAuthorizedTerminalSummary,
  type WorkbenchInteractiveTerminalSummary,
  type WorkbenchTerminalProfile,
  type WorkbenchTerminalStreamEvent,
  workbenchTerminalSessionEndpoint,
} from "@/lib/workbench/interactive-terminal-contract";
import { createJsonSseParser } from "./interactive-terminal-sse";
import { createTerminalOutputDrain } from "./interactive-terminal-output-drain";
import {
  createTerminalInputDrain,
  type TerminalInputDrain,
} from "./interactive-terminal-input-drain";
import {
  isRetryableTerminalStartupError,
  terminalStartupRetryDelayMs,
} from "./interactive-terminal-retry";
import {
  appendBoundedTerminalScrollbackChunks,
  clearWorkbenchTerminalScrollback,
  persistWorkbenchTerminalScrollback,
  readWorkbenchTerminalScrollbackSnapshot,
  workbenchTerminalReplayCursor,
  workbenchTerminalResetPolicy,
} from "./terminal-scrollback";
import {
  parseTerminalInputLease,
  requestTerminalInputWithLease,
  terminalInputHeaders,
  terminalInputLeaseFromResponse,
} from "./terminal-input-lease-client";
import {
  useOptionalWorkbenchActivityPublisher,
  type WorkbenchInteractiveTerminalConnection,
} from "./WorkbenchActivity";
import { useWorkbenchRequestHeaders } from "./WorkbenchProvider";
import { isTauriEnvironment } from "@/app/hooks/useTauri";
import {
  createDesktopProfileTerminal,
  createDesktopProfileTerminalSessionId,
  detachDesktopProfileTerminal,
  resizeDesktopProfileTerminal,
  sendDesktopProfileTerminalInput,
  type DesktopProfileTerminalHandle,
} from "@/app/services/desktop-profile-terminal";
import { DESKTOP_TERMINAL_OWNER_CHANGED_EVENT } from "@/app/services/desktop-terminal-owner";
import type { DesktopWorkspaceGrant } from "@/app/services/desktop-local-access";
import {
  WORKBENCH_TERMINAL_THEMES,
  resolveWorkbenchColorScheme,
} from "./workbench-theme";
import styles from "./WorkbenchInteractiveTerminal.module.css";

type ConnectionState = WorkbenchInteractiveTerminalConnection;

export type WorkbenchInteractiveTerminalProps = {
  clientTerminalId: string;
  label?: string;
  profile?: WorkbenchTerminalProfile;
  autoFocus?: boolean;
  /** Monotonic signal used when an already-mounted terminal must regain focus. */
  focusRequest?: number;
  publishActivity?: boolean;
  desktopWorkspaceGrant?: DesktopWorkspaceGrant | null;
  onSessionChange?: (
    clientTerminalId: string,
    session: WorkbenchInteractiveTerminalSummary | null,
  ) => void;
  onConnectionChange?: (
    clientTerminalId: string,
    connection: ConnectionState,
  ) => void;
};

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  starting: "Starting terminal",
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  restarting: "Restarting",
  exited: "Process exited",
  error: "Connection issue",
};

const TERMINAL_REQUEST_TIMEOUT_MS = 12_000;

class TerminalResponseError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "TerminalResponseError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isTerminalSummary(
  value: unknown,
): value is WorkbenchInteractiveTerminalSummary {
  const summary = asRecord(value);
  return Boolean(
    summary &&
    typeof summary.id === "string" &&
    (summary.clientTerminalId === null ||
      isWorkbenchClientTerminalId(summary.clientTerminalId)) &&
    typeof summary.pid === "number" &&
    typeof summary.cwd === "string" &&
    typeof summary.cols === "number" &&
    typeof summary.rows === "number" &&
    (summary.status === "running" || summary.status === "exited") &&
    (typeof summary.exitCode === "number" || summary.exitCode === null) &&
    typeof summary.createdAt === "number" &&
    typeof summary.lastActivityAt === "number" &&
    typeof summary.expiresAt === "number" &&
    (summary.profile === undefined ||
      isWorkbenchTerminalProfile(summary.profile)) &&
    (summary.profileAvailable === undefined ||
      typeof summary.profileAvailable === "boolean") &&
    (summary.backend === undefined ||
      summary.backend === "local" ||
      summary.backend === "remote"),
  );
}

type ParsedAuthorizedSession = {
  session: WorkbenchInteractiveTerminalSummary;
  inputLease: string | null;
};

function parseAuthorizedSession(value: unknown): ParsedAuthorizedSession {
  if (!isTerminalSummary(value)) {
    throw new Error("The terminal service returned an invalid session.");
  }
  const authorized = value as WorkbenchAuthorizedTerminalSummary;
  if (
    authorized.inputLease !== undefined &&
    !parseTerminalInputLease(authorized.inputLease)
  ) {
    throw new Error("The terminal service returned an invalid input lease.");
  }
  return {
    session: {
      id: authorized.id,
      clientTerminalId: authorized.clientTerminalId,
      pid: authorized.pid,
      cwd: authorized.cwd,
      cols: authorized.cols,
      rows: authorized.rows,
      status: authorized.status,
      exitCode: authorized.exitCode,
      createdAt: authorized.createdAt,
      lastActivityAt: authorized.lastActivityAt,
      expiresAt: authorized.expiresAt,
      profile: authorized.profile,
      profileAvailable: authorized.profileAvailable,
      backend: authorized.backend,
    },
    inputLease: parseTerminalInputLease(authorized.inputLease),
  };
}

function parseSessionList(value: unknown) {
  const body = asRecord(value);
  if (!body || !Array.isArray(body.sessions)) {
    throw new Error("The terminal service returned an invalid session list.");
  }
  return body.sessions.map(parseAuthorizedSession);
}

function parseStreamEvent(value: unknown): WorkbenchTerminalStreamEvent {
  const event = asRecord(value);
  if (!event || typeof event.type !== "string") {
    throw new Error("The terminal stream returned an invalid event.");
  }

  if (
    event.type === "ready" &&
    isTerminalSummary(event.session) &&
    typeof event.cursor === "number" &&
    typeof event.reconnected === "boolean"
  ) {
    return {
      type: "ready",
      session: event.session,
      cursor: event.cursor,
      reconnected: event.reconnected,
    };
  }

  if (
    event.type === "output" &&
    event.encoding === "base64" &&
    typeof event.data === "string" &&
    typeof event.cursor === "number"
  ) {
    return {
      type: "output",
      encoding: "base64",
      data: event.data,
      cursor: event.cursor,
    };
  }

  if (
    event.type === "reset" &&
    (event.reason === "buffer_truncated" ||
      event.reason === "stream_reconnected" ||
      event.reason === "invalid_cursor") &&
    typeof event.cursor === "number"
  ) {
    return {
      type: "reset",
      reason: event.reason,
      cursor: event.cursor,
    };
  }

  if (event.type === "rotate" && typeof event.cursor === "number") {
    return {
      type: "rotate",
      cursor: event.cursor,
    };
  }

  if (
    event.type === "exit" &&
    (typeof event.exitCode === "number" || event.exitCode === null) &&
    typeof event.cursor === "number"
  ) {
    return {
      type: "exit",
      exitCode: event.exitCode,
      cursor: event.cursor,
    };
  }

  throw new Error("The terminal stream returned an invalid event.");
}

function clampDimension(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function decodeBase64(value: string) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  const blockSize = 8192;
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + blockSize),
    );
  }
  return window.btoa(binary);
}

function encodeInputChunks(value: string) {
  const bytes = new TextEncoder().encode(value);
  const chunks: string[] = [];
  for (
    let offset = 0;
    offset < bytes.length;
    offset += MAX_WORKBENCH_TERMINAL_INPUT_BYTES
  ) {
    chunks.push(
      encodeBase64(
        bytes.subarray(offset, offset + MAX_WORKBENCH_TERMINAL_INPUT_BYTES),
      ),
    );
  }
  return chunks;
}

async function readResponsePayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function payloadMessage(payload: unknown, fallback: string) {
  const body = asRecord(payload);
  if (typeof body?.error === "string") return body.error;
  if (typeof body?.message === "string") return body.message;
  return fallback;
}

async function assertResponse(
  response: Response,
  fallback: string,
  knownPayload?: unknown,
) {
  if (response.ok) return;
  const payload =
    knownPayload === undefined
      ? await readResponsePayload(response)
      : knownPayload;
  throw new TerminalResponseError(
    payloadMessage(payload, fallback),
    response.status === 408 ||
      response.status === 425 ||
      response.status === 429 ||
      response.status >= 500,
  );
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  parentSignal: AbortSignal,
) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal.reason);
  if (parentSignal.aborted) {
    abortFromParent();
  } else {
    parentSignal.addEventListener("abort", abortFromParent, { once: true });
  }
  const timeout = window.setTimeout(
    () =>
      controller.abort(
        new DOMException("The terminal request timed out.", "TimeoutError"),
      ),
    TERMINAL_REQUEST_TIMEOUT_MS,
  );

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
    parentSignal.removeEventListener("abort", abortFromParent);
  }
}

function waitForRetry(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }

    const handleAbort = () => {
      window.clearTimeout(timeout);
      reject(signal.reason);
    };
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

function displayCwd(cwd: string) {
  if (cwd === "/home/user") return "~";
  if (cwd.startsWith("/home/user/")) return `~/${cwd.slice(11)}`;
  return cwd;
}

export function WorkbenchInteractiveTerminal({
  clientTerminalId,
  label = "Terminal",
  profile = "shell",
  autoFocus = false,
  focusRequest = 0,
  publishActivity = false,
  desktopWorkspaceGrant = null,
  onSessionChange,
  onConnectionChange,
  compact = false,
}: WorkbenchInteractiveTerminalProps & { compact?: boolean }) {
  const isDesktopTerminal = isTauriEnvironment();
  const { resolvedTheme } = useTheme();
  const terminalTheme =
    WORKBENCH_TERMINAL_THEMES[resolveWorkbenchColorScheme(resolvedTheme)];
  const requestHeaders = useWorkbenchRequestHeaders();
  const jsonRequestHeaders = useMemo(
    () => ({ ...requestHeaders, "Content-Type": "application/json" }),
    [requestHeaders],
  );
  const activityPublisher = useOptionalWorkbenchActivityPublisher();
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const terminalThemeRef = useRef(terminalTheme);
  terminalThemeRef.current = terminalTheme;
  // A tab owns its initial launch directory. Refreshing or changing the folder
  // picker affects new tabs, never the process already attached to this tab.
  const desktopLaunchGrantRef = useRef<
    DesktopWorkspaceGrant | null | undefined
  >(undefined);
  if (
    desktopLaunchGrantRef.current === undefined &&
    (profile === "shell" ||
      (desktopWorkspaceGrant?.writable &&
        desktopWorkspaceGrant.kind !== "file" &&
        desktopWorkspaceGrant.rootPath))
  ) {
    desktopLaunchGrantRef.current = desktopWorkspaceGrant ?? null;
  }
  const desktopLaunchGrant = desktopLaunchGrantRef.current;
  const sessionRef = useRef<WorkbenchInteractiveTerminalSummary | null>(null);
  const inputLeaseRef = useRef<string | null>(null);
  const desktopTerminalHandleRef = useRef<DesktopProfileTerminalHandle | null>(
    null,
  );
  const mutationAbortRef = useRef<AbortController | null>(null);
  const sessionGenerationRef = useRef(0);
  const restartRequestedRef = useRef(false);
  const inputDrainRef = useRef<TerminalInputDrain | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const pendingResizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const resizeChainRef = useRef<Promise<void>>(Promise.resolve());
  const outputChainRef = useRef<Promise<void>>(Promise.resolve());
  const scrollbackRef = useRef<Uint8Array<ArrayBufferLike>>(new Uint8Array());
  const pendingScrollbackRef = useRef<Uint8Array[]>([]);
  const scrollbackSessionIdRef = useRef<string | null>(null);
  const scrollbackCursorRef = useRef(0);
  const scrollbackHydratedRef = useRef(false);
  const scrollbackPersistTimerRef = useRef<number | null>(null);
  const [terminalReady, setTerminalReady] = useState(false);
  const [restartVersion, setRestartVersion] = useState(0);
  // Replacing the renderer discards any already-submitted xterm write on restart.
  const desktopRendererVersion = isDesktopTerminal ? restartVersion : 0;
  const [desktopOwnerVersion, setDesktopOwnerVersion] = useState(0);
  useEffect(() => {
    if (!isDesktopTerminal) return;
    const changed = () => {
      mutationAbortRef.current?.abort();
      inputDrainRef.current?.stop();
      terminalRef.current?.reset();
      sessionRef.current = null;
      desktopLaunchGrantRef.current = undefined;
      setSession(null);
      setDesktopOwnerVersion((version) => version + 1);
    };
    window.addEventListener(DESKTOP_TERMINAL_OWNER_CHANGED_EVENT, changed);
    return () =>
      window.removeEventListener(DESKTOP_TERMINAL_OWNER_CHANGED_EVENT, changed);
  }, [isDesktopTerminal]);
  const [connection, setConnection] = useState<ConnectionState>("starting");
  const [session, setSession] =
    useState<WorkbenchInteractiveTerminalSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [streamNotice, setStreamNotice] = useState<string | null>(null);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.theme = terminalTheme;
  }, [terminalTheme]);

  useEffect(() => {
    if (publishActivity) {
      activityPublisher?.publishInteractiveTerminalConnection(connection);
    }
    onConnectionChange?.(clientTerminalId, connection);
  }, [
    activityPublisher,
    clientTerminalId,
    connection,
    onConnectionChange,
    publishActivity,
  ]);

  useEffect(() => {
    onSessionChange?.(clientTerminalId, session);
  }, [clientTerminalId, onSessionChange, session]);

  useEffect(
    () => () => {
      if (publishActivity) {
        activityPublisher?.publishInteractiveTerminalConnection("starting");
      }
    },
    [activityPublisher, publishActivity],
  );

  const reportNetworkError = useCallback(
    (error: unknown, sessionId: string, controller: AbortController) => {
      if (
        mutationAbortRef.current !== controller ||
        controller.signal.aborted ||
        sessionRef.current?.id !== sessionId
      ) {
        return;
      }
      setConnection("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "The terminal could not send this request.",
      );
    },
    [],
  );

  const flushScrollback = useCallback(() => {
    if (scrollbackPersistTimerRef.current !== null) {
      window.clearTimeout(scrollbackPersistTimerRef.current);
      scrollbackPersistTimerRef.current = null;
    }
    if (pendingScrollbackRef.current.length > 0) {
      scrollbackRef.current = appendBoundedTerminalScrollbackChunks(
        scrollbackRef.current,
        pendingScrollbackRef.current,
      );
      pendingScrollbackRef.current = [];
    }
    persistWorkbenchTerminalScrollback(clientTerminalId, {
      bytes: scrollbackRef.current,
      sessionId: scrollbackSessionIdRef.current,
      cursor: scrollbackCursorRef.current,
    });
  }, [clientTerminalId]);

  const scheduleScrollbackPersist = useCallback(() => {
    if (scrollbackPersistTimerRef.current !== null) return;
    scrollbackPersistTimerRef.current = window.setTimeout(flushScrollback, 120);
  }, [flushScrollback]);

  const rememberOutput = useCallback(
    (bytes: Uint8Array) => {
      pendingScrollbackRef.current.push(bytes);
      scheduleScrollbackPersist();
    },
    [scheduleScrollbackPersist],
  );

  const clearScrollback = useCallback(() => {
    if (scrollbackPersistTimerRef.current !== null) {
      window.clearTimeout(scrollbackPersistTimerRef.current);
      scrollbackPersistTimerRef.current = null;
    }
    scrollbackRef.current = new Uint8Array();
    pendingScrollbackRef.current = [];
    scrollbackSessionIdRef.current = null;
    scrollbackCursorRef.current = 0;
    scrollbackHydratedRef.current = true;
    clearWorkbenchTerminalScrollback(clientTerminalId);
  }, [clientTerminalId]);

  const queueInput = useCallback((data: string) => {
    inputDrainRef.current?.push(data);
  }, []);

  const flushResize = useCallback(() => {
    resizeTimerRef.current = null;
    const dimensions = pendingResizeRef.current;
    pendingResizeRef.current = null;
    const currentSession = sessionRef.current;
    const controller = mutationAbortRef.current;
    if (
      !dimensions ||
      !currentSession ||
      currentSession.status !== "running" ||
      !controller
    ) {
      return;
    }

    const sessionId = currentSession.id;
    const signal = controller.signal;
    resizeChainRef.current = resizeChainRef.current
      .catch(() => undefined)
      .then(async () => {
        if (isDesktopTerminal) {
          await resizeDesktopProfileTerminal(
            sessionId,
            dimensions.cols,
            dimensions.rows,
          );
          return;
        }
        const response = await fetchWithTimeout(
          `${workbenchTerminalSessionEndpoint(sessionId)}/resize`,
          {
            method: "POST",
            cache: "no-store",
            headers: jsonRequestHeaders,
            body: JSON.stringify(dimensions),
          },
          signal,
        );
        await assertResponse(response, "The terminal could not resize.");
      })
      .catch((error: unknown) =>
        reportNetworkError(error, sessionId, controller),
      );
  }, [isDesktopTerminal, jsonRequestHeaders, reportNetworkError]);

  const queueResize = useCallback(
    (cols: number, rows: number) => {
      pendingResizeRef.current = {
        cols: clampDimension(
          cols,
          MIN_WORKBENCH_TERMINAL_COLS,
          MAX_WORKBENCH_TERMINAL_COLS,
        ),
        rows: clampDimension(
          rows,
          MIN_WORKBENCH_TERMINAL_ROWS,
          MAX_WORKBENCH_TERMINAL_ROWS,
        ),
      };
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
      }
      resizeTimerRef.current = window.setTimeout(flushResize, 120);
    },
    [flushResize],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      allowTransparency: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily: '"SFMono-Regular", Menlo, Monaco, Consolas, monospace',
      fontSize: 12,
      fontWeight: "400",
      letterSpacing: 0,
      lineHeight: 1.5,
      macOptionIsMeta: true,
      rightClickSelectsWord: true,
      screenReaderMode: true,
      scrollback: 5000,
      theme: terminalThemeRef.current,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    terminal.textarea?.setAttribute(
      "aria-label",
      `${label} interactive workspace terminal`,
    );
    terminalRef.current = terminal;
    const restoredScrollback =
      readWorkbenchTerminalScrollbackSnapshot(clientTerminalId);
    scrollbackRef.current = restoredScrollback.bytes;
    pendingScrollbackRef.current = [];
    scrollbackSessionIdRef.current = restoredScrollback.sessionId;
    scrollbackCursorRef.current = restoredScrollback.cursor;
    // Wait until the server identifies the live PTY before painting restored
    // bytes. Writing here races a later reset and can briefly resurrect output
    // from a replaced backend (for example a previous remote Kali session).
    scrollbackHydratedRef.current = restoredScrollback.bytes.byteLength === 0;

    let animationFrame: number | null = null;
    const fit = () => {
      if (host.clientWidth < 1 || host.clientHeight < 1) {
        // Geometry controls fitting, not the lifetime of a running PTY.
        // Switching to the console hides this host; keep the shell and its
        // input drain alive until the terminal is explicitly closed.
        return;
      }
      try {
        fitAddon.fit();
        setTerminalReady(true);
      } catch {
        // A hidden tab has no measurable terminal geometry yet.
      }
    };
    const scheduleFit = () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        fit();
      });
    };

    const resizeObserver = new ResizeObserver(scheduleFit);
    resizeObserver.observe(host);
    const inputDisposable = terminal.onData(queueInput);
    const resizeDisposable = terminal.onResize(({ cols, rows }) =>
      queueResize(cols, rows),
    );
    scheduleFit();

    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      resizeObserver.disconnect();
      inputDisposable.dispose();
      resizeDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      flushScrollback();
      setTerminalReady(false);
    };
  }, [
    clientTerminalId,
    desktopOwnerVersion,
    desktopRendererVersion,
    flushScrollback,
    label,
    queueInput,
    queueResize,
  ]);

  useEffect(() => {
    if (autoFocus && terminalReady) terminalRef.current?.focus();
  }, [autoFocus, focusRequest, terminalReady]);

  useEffect(() => {
    if (!terminalReady || isDesktopTerminal) return;

    const generation = sessionGenerationRef.current + 1;
    sessionGenerationRef.current = generation;
    const streamController = new AbortController();
    const mutationController = new AbortController();
    mutationAbortRef.current?.abort();
    mutationAbortRef.current = mutationController;
    inputDrainRef.current?.stop();
    inputDrainRef.current = null;
    if (resizeTimerRef.current !== null) {
      window.clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = null;
    }
    pendingResizeRef.current = null;
    resizeChainRef.current = Promise.resolve();
    outputChainRef.current = Promise.resolve();
    const forceNewSession = restartRequestedRef.current;
    restartRequestedRef.current = false;
    let streamExited = false;
    let activeInputDrain: TerminalInputDrain | null = null;

    const ownsGeneration = () =>
      sessionGenerationRef.current === generation &&
      !streamController.signal.aborted;

    const findRunningSession = async () => {
      const response = await fetch(WORKBENCH_TERMINAL_SESSIONS_ENDPOINT, {
        method: "GET",
        cache: "no-store",
        headers: requestHeaders,
        signal: streamController.signal,
      });
      await assertResponse(response, "Terminal sessions could not be loaded.");
      const sessions = parseSessionList(await readResponsePayload(response));
      const active =
        sessions.find(
          (candidate) =>
            candidate.session.status === "running" &&
            candidate.session.clientTerminalId === clientTerminalId &&
            (candidate.session.profile ?? "shell") === profile &&
            candidate.session.profileAvailable !== false,
        ) ?? null;
      inputLeaseRef.current = active?.inputLease ?? null;
      return active?.session ?? null;
    };

    const createSession = async () => {
      const terminal = terminalRef.current;
      const response = await fetch(WORKBENCH_TERMINAL_SESSIONS_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        headers: jsonRequestHeaders,
        body: JSON.stringify({
          cols: clampDimension(
            terminal?.cols ?? 100,
            MIN_WORKBENCH_TERMINAL_COLS,
            MAX_WORKBENCH_TERMINAL_COLS,
          ),
          rows: clampDimension(
            terminal?.rows ?? 24,
            MIN_WORKBENCH_TERMINAL_ROWS,
            MAX_WORKBENCH_TERMINAL_ROWS,
          ),
          clientTerminalId,
          profile,
        }),
        signal: streamController.signal,
      });
      if (response.status === 409) {
        const payload = await readResponsePayload(response);
        const activeSession = await findRunningSession();
        if (activeSession) return activeSession;
        const code = asRecord(payload)?.code;
        throw new TerminalResponseError(
          payloadMessage(payload, "The terminal session could not start."),
          code === "terminal_create_busy" ||
            code === "terminal_already_running",
        );
      }
      await assertResponse(response, "The terminal session could not start.");
      const authorizedSession = parseAuthorizedSession(
        await readResponsePayload(response),
      );
      inputLeaseRef.current = authorizedSession.inputLease;
      if (response.status === 201) {
        clearScrollback();
        terminalRef.current?.reset();
      }
      return authorizedSession.session;
    };

    const deleteCurrentSession = async () => {
      const current = sessionRef.current ?? (await findRunningSession());
      if (!current) return;

      const response = await fetch(
        workbenchTerminalSessionEndpoint(current.id),
        {
          method: "DELETE",
          cache: "no-store",
          headers: requestHeaders,
          signal: streamController.signal,
        },
      );
      if (response.status !== 404) {
        await assertResponse(
          response,
          "The previous terminal could not close.",
        );
      }
      if (!ownsGeneration()) return;
      inputLeaseRef.current = null;
      if (sessionRef.current?.id === current.id) sessionRef.current = null;
      setSession((value) => (value?.id === current.id ? null : value));
    };

    const failTerminalRendering = () => {
      if (!ownsGeneration()) return;
      // Renderer failure is terminal for this connection, even when an exit
      // was already parsed. Abort ownership before later queued writes or exit
      // callbacks can overwrite the error with a successful state.
      streamController.abort();
      mutationController.abort();
      activeInputDrain?.stop();
      if (inputDrainRef.current === activeInputDrain) {
        inputDrainRef.current = null;
      }
      setConnection("error");
      setErrorMessage("Terminal output could not be rendered.");
    };

    const enqueueTerminalWrite = (data: string | Uint8Array) => {
      const bytes =
        typeof data === "string" ? new TextEncoder().encode(data) : data;
      rememberOutput(bytes);
      outputChainRef.current = outputChainRef.current
        .then(
          () =>
            new Promise<void>((resolve) => {
              const terminal = terminalRef.current;
              if (!terminal || !ownsGeneration()) {
                resolve();
                return;
              }
              terminal.write(data, resolve);
            }),
        )
        .catch(failTerminalRendering);
    };

    const enqueueTerminalReset = () => {
      outputChainRef.current = outputChainRef.current
        .then(() => {
          const terminal = terminalRef.current;
          if (!terminal || !ownsGeneration()) return;
          terminal.reset();
        })
        .catch(failTerminalRendering);
    };

    const streamSession = async (
      terminalSession: WorkbenchInteractiveTerminalSummary,
    ) => {
      let cursor = workbenchTerminalReplayCursor(
        {
          bytes: scrollbackRef.current,
          sessionId: scrollbackSessionIdRef.current,
          cursor: scrollbackCursorRef.current,
        },
        terminalSession.id,
      );
      let retryCount = 0;

      while (!streamController.signal.aborted && !streamExited) {
        try {
          let rotateRequested = false;
          if (retryCount > 0) setConnection("reconnecting");
          const response = await fetch(
            `${workbenchTerminalSessionEndpoint(terminalSession.id)}/events?cursor=${cursor}`,
            {
              method: "GET",
              cache: "no-store",
              headers: {
                ...requestHeaders,
                Accept: "text/event-stream",
              },
              signal: streamController.signal,
            },
          );
          await assertResponse(
            response,
            "The terminal stream could not connect.",
          );
          if (!response.body) {
            throw new TerminalResponseError(
              "The terminal stream did not return a body.",
              true,
            );
          }
          const refreshedInputLease = terminalInputLeaseFromResponse(response);
          if (refreshedInputLease) {
            inputLeaseRef.current = refreshedInputLease;
          }

          const parser = createJsonSseParser<unknown>((value) => {
            if (!ownsGeneration()) return;
            const event = parseStreamEvent(value);
            cursor = event.cursor;

            if (event.type === "ready") {
              scrollbackSessionIdRef.current = terminalSession.id;
              scrollbackCursorRef.current = event.cursor;
              scheduleScrollbackPersist();
              retryCount = 0;
              sessionRef.current = event.session;
              setSession(event.session);
              setConnection("connected");
              setErrorMessage(null);
              const terminal = terminalRef.current;
              if (terminal) queueResize(terminal.cols, terminal.rows);
              return;
            }

            if (event.type === "output") {
              scrollbackSessionIdRef.current = terminalSession.id;
              scrollbackCursorRef.current = event.cursor;
              enqueueTerminalWrite(decodeBase64(event.data));
              return;
            }

            if (event.type === "reset") {
              const resetPolicy = workbenchTerminalResetPolicy(
                event.reason,
                scrollbackRef.current.byteLength > 0 ||
                  pendingScrollbackRef.current.length > 0,
              );
              setStreamNotice(resetPolicy.notice);
              if (!resetPolicy.preserveScrollback) {
                clearScrollback();
                enqueueTerminalReset();
              }
              scrollbackSessionIdRef.current = terminalSession.id;
              scrollbackCursorRef.current = event.cursor;
              scheduleScrollbackPersist();
              return;
            }

            if (event.type === "rotate") {
              scrollbackSessionIdRef.current = terminalSession.id;
              scrollbackCursorRef.current = event.cursor;
              scheduleScrollbackPersist();
              rotateRequested = true;
              retryCount = 0;
              setConnection("connected");
              setErrorMessage(null);
              return;
            }

            scrollbackSessionIdRef.current = terminalSession.id;
            scrollbackCursorRef.current = event.cursor;
            scheduleScrollbackPersist();
            streamExited = true;
            activeInputDrain?.stop();
            if (inputDrainRef.current === activeInputDrain) {
              inputDrainRef.current = null;
            }
            // A single network read can contain both final output and exit.
            // Stop input immediately, but publish completion only after every
            // preceding xterm write callback, just like the native drain.
            outputChainRef.current = outputChainRef.current.then(() => {
              if (!ownsGeneration()) return;
              setConnection("exited");
              setErrorMessage(null);
              setSession((current) =>
                current
                  ? {
                      ...current,
                      status: "exited",
                      exitCode: event.exitCode,
                    }
                  : current,
              );
              if (sessionRef.current) {
                sessionRef.current = {
                  ...sessionRef.current,
                  status: "exited",
                  exitCode: event.exitCode,
                };
              }
            });
          });
          const reader = response.body.getReader();
          try {
            while (!streamController.signal.aborted && !streamExited) {
              const result = await reader.read();
              if (!ownsGeneration() || result.done) break;
              parser.push(result.value);
              await outputChainRef.current;
              if (!ownsGeneration()) break;
            }
            if (ownsGeneration()) {
              parser.finish();
              await outputChainRef.current;
            }
          } finally {
            if (!streamController.signal.aborted) {
              try {
                await reader.cancel();
              } catch {
                // The response may already be closed by the exit event.
              }
            }
            reader.releaseLock();
          }
          if (streamExited || streamController.signal.aborted) return;
          if (rotateRequested) {
            // Planned server rotation: reconnect immediately from the emitted
            // cursor, without an error/reconnecting flash or retry backoff.
            retryCount = 0;
            continue;
          }
          throw new TerminalResponseError(
            "The terminal stream disconnected.",
            true,
          );
        } catch (error) {
          if (streamController.signal.aborted || streamExited) return;
          if (error instanceof TerminalResponseError && !error.retryable) {
            throw error;
          }

          retryCount += 1;
          setConnection(retryCount >= 4 ? "error" : "reconnecting");
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "The terminal connection was interrupted.",
          );
          await waitForRetry(
            Math.min(350 * 2 ** Math.min(retryCount - 1, 3), 3000),
            streamController.signal,
          );
        }
      }
    };

    const start = async () => {
      setConnection(forceNewSession ? "restarting" : "connecting");
      setErrorMessage(null);
      setStreamNotice(null);
      if (forceNewSession) {
        clearScrollback();
        terminalRef.current?.reset();
      }

      let deleteBeforeStart = forceNewSession;
      let startupAttempt = 0;
      while (ownsGeneration()) {
        try {
          if (deleteBeforeStart) {
            await deleteCurrentSession();
            deleteBeforeStart = false;
          }

          const terminalSession =
            (deleteBeforeStart ? null : await findRunningSession()) ??
            (await createSession());
          if (!ownsGeneration()) return;

          const restoredSessionMatches =
            scrollbackSessionIdRef.current === terminalSession.id;
          if (!scrollbackHydratedRef.current) {
            if (
              restoredSessionMatches &&
              scrollbackRef.current.byteLength > 0
            ) {
              await new Promise<void>((resolve) => {
                const terminal = terminalRef.current;
                if (!terminal) {
                  resolve();
                  return;
                }
                terminal.write(scrollbackRef.current, resolve);
              });
              if (!ownsGeneration()) return;
              scrollbackHydratedRef.current = true;
            } else {
              clearScrollback();
              terminalRef.current?.reset();
            }
          }
          if (
            !restoredSessionMatches &&
            (scrollbackRef.current.byteLength > 0 ||
              pendingScrollbackRef.current.length > 0)
          ) {
            clearScrollback();
            terminalRef.current?.reset();
          }
          if (!restoredSessionMatches) {
            scrollbackSessionIdRef.current = terminalSession.id;
            scrollbackCursorRef.current = 0;
            scheduleScrollbackPersist();
          }

          sessionRef.current = terminalSession;
          setSession(terminalSession);
          activeInputDrain?.stop();
          activeInputDrain = createTerminalInputDrain(
            async (value) => {
              for (const data of encodeInputChunks(value)) {
                const inputLease = inputLeaseRef.current;
                const result = await requestTerminalInputWithLease({
                  inputLease,
                  send: (lease) =>
                    fetchWithTimeout(
                      `${workbenchTerminalSessionEndpoint(terminalSession.id)}/input`,
                      {
                        method: "POST",
                        cache: "no-store",
                        headers: terminalInputHeaders(
                          jsonRequestHeaders,
                          lease,
                        ),
                        body: JSON.stringify({ data }),
                      },
                      mutationController.signal,
                    ),
                  readErrorPayload: readResponsePayload,
                });
                const response = result.response;
                if (result.retriedWithAuthentication) {
                  inputLeaseRef.current = null;
                }
                await assertResponse(
                  response,
                  "The terminal could not receive input.",
                  result.errorPayload,
                );
                const refreshedInputLease =
                  terminalInputLeaseFromResponse(response);
                if (refreshedInputLease) {
                  inputLeaseRef.current = refreshedInputLease;
                }
              }
            },
            (error) =>
              reportNetworkError(error, terminalSession.id, mutationController),
          );
          inputDrainRef.current?.stop();
          inputDrainRef.current = activeInputDrain;
          await streamSession(terminalSession);
          return;
        } catch (error) {
          if (!ownsGeneration()) return;
          if (!isRetryableTerminalStartupError(error)) throw error;

          startupAttempt += 1;
          setConnection("reconnecting");
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "The terminal connection was interrupted.",
          );
          await waitForRetry(
            terminalStartupRetryDelayMs(startupAttempt),
            streamController.signal,
          );
        }
      }
    };

    void start().catch((error: unknown) => {
      if (streamController.signal.aborted) return;
      setConnection("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "The terminal could not start.",
      );
    });

    return () => {
      streamController.abort();
      mutationController.abort();
      if (mutationAbortRef.current === mutationController) {
        mutationAbortRef.current = null;
      }
      activeInputDrain?.stop();
      if (inputDrainRef.current === activeInputDrain) {
        inputDrainRef.current = null;
      }
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
      pendingResizeRef.current = null;
    };
  }, [
    jsonRequestHeaders,
    clearScrollback,
    clientTerminalId,
    profile,
    queueResize,
    reportNetworkError,
    rememberOutput,
    requestHeaders,
    restartVersion,
    scheduleScrollbackPersist,
    terminalReady,
    isDesktopTerminal,
  ]);

  useEffect(() => {
    if (!terminalReady || !isDesktopTerminal) return;

    const generation = sessionGenerationRef.current + 1;
    sessionGenerationRef.current = generation;
    const mutationController = new AbortController();
    mutationAbortRef.current?.abort();
    mutationAbortRef.current = mutationController;
    inputDrainRef.current?.stop();
    inputDrainRef.current = null;
    if (resizeTimerRef.current !== null) {
      window.clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = null;
    }
    pendingResizeRef.current = null;
    resizeChainRef.current = Promise.resolve();
    outputChainRef.current = Promise.resolve();

    if (
      profile !== "shell" &&
      (!desktopLaunchGrant?.writable ||
        desktopLaunchGrant.kind === "file" ||
        !desktopLaunchGrant.rootPath)
    ) {
      sessionRef.current = null;
      setSession(null);
      setConnection("error");
      setErrorMessage(
        "Choose a writable workspace folder to start a local terminal.",
      );
      return () => mutationController.abort();
    }

    const forceNewSession = restartRequestedRef.current;
    restartRequestedRef.current = false;
    const desktopRootPath = desktopLaunchGrant?.rootPath ?? "~";
    let sessionId = createDesktopProfileTerminalSessionId(clientTerminalId);
    let attachedHandle: DesktopProfileTerminalHandle | null = null;
    let exited = false;
    let latestExitCode: number | null = null;

    const ownsGeneration = () =>
      sessionGenerationRef.current === generation &&
      !mutationController.signal.aborted;

    let exitRendered = false;
    const outputTerminal = terminalRef.current;
    const outputDrain = createTerminalOutputDrain(
      (bytes, complete) => {
        if (!ownsGeneration() || !outputTerminal) {
          outputDrain.stop();
          return;
        }
        outputTerminal.write(bytes, complete);
      },
      (error) => {
        if (!ownsGeneration()) return;
        mutationController.abort();
        inputDrainRef.current?.stop();
        inputDrainRef.current = null;
        if (attachedHandle)
          void detachDesktopProfileTerminal(attachedHandle).catch(
            () => undefined,
          );
        setConnection("error");
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Terminal output could not be rendered.",
        );
      },
    );

    const start = async () => {
      setConnection(forceNewSession ? "restarting" : "connecting");
      setErrorMessage(null);
      setStreamNotice(null);
      clearScrollback();
      terminalRef.current?.reset();

      const terminal = terminalRef.current;
      const handle = await createDesktopProfileTerminal({
        sessionId,
        clientTerminalId,
        restart: forceNewSession,
        profile,
        grantId: desktopLaunchGrant?.grantId,
        relativeCwd: "",
        cols: clampDimension(
          terminal?.cols ?? 100,
          MIN_WORKBENCH_TERMINAL_COLS,
          MAX_WORKBENCH_TERMINAL_COLS,
        ),
        rows: clampDimension(
          terminal?.rows ?? 24,
          MIN_WORKBENCH_TERMINAL_ROWS,
          MAX_WORKBENCH_TERMINAL_ROWS,
        ),
        callbacks: {
          onTruncated: () => {
            if (ownsGeneration())
              setStreamNotice(
                "Earlier terminal output was trimmed while this session continued running.",
              );
          },
          onOutput: (chunk, rendered) => {
            if (ownsGeneration()) outputDrain.push(chunk, rendered);
          },
          onError: (error) => {
            if (!ownsGeneration()) return;
            mutationController.abort();
            inputDrainRef.current?.stop();
            inputDrainRef.current = null;
            outputDrain.stop();
            setConnection("error");
            setErrorMessage(
              error instanceof Error
                ? error.message
                : "Desktop terminal output failed.",
            );
          },
          onClosed: () => {
            exited = true;
            latestExitCode = -1;
            if (!ownsGeneration()) return;
            mutationController.abort();
            outputDrain.stop();
            inputDrainRef.current?.stop();
            inputDrainRef.current = null;
            exitRendered = true;
            setConnection("exited");
            setStreamNotice(
              "This terminal was closed or its local access was revoked.",
            );
            setSession((current) =>
              current
                ? { ...current, status: "exited", exitCode: -1 }
                : current,
            );
            if (sessionRef.current)
              sessionRef.current = {
                ...sessionRef.current,
                status: "exited",
                exitCode: -1,
              };
          },
          onExit: (exitCode) => {
            exited = true;
            latestExitCode = exitCode;
            if (!ownsGeneration()) return;
            inputDrainRef.current?.stop();
            inputDrainRef.current = null;
            outputDrain.finish(() => {
              if (!ownsGeneration()) return;
              exitRendered = true;
              setConnection("exited");
              setErrorMessage(null);
              setSession((current) =>
                current ? { ...current, status: "exited", exitCode } : current,
              );
              if (sessionRef.current) {
                sessionRef.current = {
                  ...sessionRef.current,
                  status: "exited",
                  exitCode,
                };
              }
            });
          },
        },
      });
      attachedHandle = handle;
      sessionId = handle.session.sessionId;
      if (!ownsGeneration()) {
        await detachDesktopProfileTerminal(handle).catch(() => undefined);
        return;
      }
      desktopTerminalHandleRef.current = handle;

      const now = Date.now();
      const summary: WorkbenchInteractiveTerminalSummary = {
        id: handle.session.sessionId,
        clientTerminalId,
        pid: handle.session.pid ?? 0,
        cwd: handle.session.cwd ?? desktopRootPath,
        cols: terminal?.cols ?? 100,
        rows: terminal?.rows ?? 24,
        status: exited ? "exited" : "running",
        exitCode: latestExitCode,
        createdAt: now,
        lastActivityAt: now,
        expiresAt: Number.MAX_SAFE_INTEGER,
        profile: handle.session.profile,
        profileAvailable: true,
        backend: "local",
      };
      sessionRef.current = summary;
      setSession(summary);
      if (exited) {
        if (exitRendered) setConnection("exited");
        return;
      }

      inputDrainRef.current = createTerminalInputDrain(
        (value) => sendDesktopProfileTerminalInput(sessionId, value),
        (error) => {
          if (!ownsGeneration()) return;
          setConnection("error");
          setErrorMessage(
            typeof error === "string"
              ? error
              : error instanceof Error
                ? error.message
                : "The desktop terminal could not receive input.",
          );
        },
      );
      setConnection("connected");
      setErrorMessage(null);
      queueResize(summary.cols, summary.rows);
    };

    void start().catch((error: unknown) => {
      if (!ownsGeneration()) return;
      setConnection("error");
      setErrorMessage(
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "The desktop terminal could not start.",
      );
    });

    return () => {
      mutationController.abort();
      outputDrain.stop();
      inputDrainRef.current?.stop();
      inputDrainRef.current = null;
      if (mutationAbortRef.current === mutationController) {
        mutationAbortRef.current = null;
      }
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
      pendingResizeRef.current = null;
      if (attachedHandle) {
        void detachDesktopProfileTerminal(attachedHandle).catch(
          () => undefined,
        );
      }
      if (desktopTerminalHandleRef.current === attachedHandle) {
        desktopTerminalHandleRef.current = null;
      }
    };
  }, [
    clearScrollback,
    clientTerminalId,
    desktopLaunchGrant,
    desktopOwnerVersion,
    isDesktopTerminal,
    profile,
    queueResize,
    restartVersion,
    terminalReady,
  ]);

  const statusLabel =
    connection === "exited" && typeof session?.exitCode === "number"
      ? `Exited ${session.exitCode}`
      : CONNECTION_LABEL[connection];
  const requestedProfileLabel =
    WORKBENCH_TERMINAL_PROFILES.find(({ id }) => id === profile)?.shortLabel ??
    "Shell";
  const activeProfileLabel = session
    ? session.profileAvailable === false
      ? "Shell fallback"
      : (WORKBENCH_TERMINAL_PROFILES.find(
          ({ id }) => id === (session.profile ?? "shell"),
        )?.shortLabel ?? "Shell")
    : requestedProfileLabel;
  const runtimeLabel = session?.backend
    ? `${activeProfileLabel} · ${session.backend === "local" ? "local" : "sandbox"}`
    : null;

  const restart = () => {
    restartRequestedRef.current = true;
    setRestartVersion((version) => version + 1);
  };

  return (
    <div
      data-workbench-interactive-terminal
      data-terminal-client-id={clientTerminalId}
      data-terminal-profile={profile}
      data-color-scheme={resolveWorkbenchColorScheme(resolvedTheme)}
      data-compact={compact || undefined}
      className={styles.terminal}
    >
      <div className={styles.context}>
        <span className={styles.directory} title={session?.cwd}>
          {session?.cwd ? displayCwd(session.cwd) : label}
        </span>
        {runtimeLabel ? (
          <span className={styles.runtime}>{runtimeLabel}</span>
        ) : null}
      </div>

      <div className={styles.viewport}>
        <div ref={hostRef} className={styles.host} />
      </div>

      {streamNotice ? (
        <div role="status" aria-live="polite" className={styles.notice}>
          {streamNotice}
        </div>
      ) : null}

      {errorMessage ? (
        <div role="alert" className={styles.error}>
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={restart}
            className={styles.freshButton}
          >
            Start fresh
          </button>
        </div>
      ) : null}

      <div className={styles.statusBar}>
        <span
          role="status"
          aria-live="polite"
          data-terminal-connection-label
          data-state={connection}
          className={styles.connection}
        >
          {statusLabel}
        </span>
        <button
          type="button"
          onClick={restart}
          disabled={connection === "restarting"}
          aria-label="Restart terminal session"
          title="Close this PTY and start a fresh terminal"
          className={styles.restartButton}
        >
          <RotateCcw
            aria-hidden
            data-restarting={connection === "restarting" || undefined}
          />
        </button>
      </div>
    </div>
  );
}
