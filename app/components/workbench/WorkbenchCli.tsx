"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  DEFAULT_WORKBENCH_TERMINAL_CWD,
  type WorkbenchTerminalResult,
} from "@/lib/workbench/terminal-contract";
import { useWorkbenchRequestHeaders } from "./WorkbenchProvider";

const MAX_HISTORY_ITEMS = 100;
const MAX_TRANSCRIPT_ITEMS = 50;

type CliEntryStatus = "running" | "complete" | "cancelled" | "error";

type CliEntry = {
  id: number;
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number | null;
  status: CliEntryStatus;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function responseError(payload: unknown): string {
  const body = asRecord(payload);
  if (typeof body?.error === "string") return body.error;
  if (typeof body?.message === "string") return body.message;
  return "The isolated CLI could not run this command.";
}

function parseRunResult(payload: unknown): WorkbenchTerminalResult {
  const body = asRecord(payload);
  if (
    !body ||
    typeof body.stdout !== "string" ||
    typeof body.stderr !== "string" ||
    typeof body.exitCode !== "number" ||
    typeof body.cwd !== "string" ||
    typeof body.timedOut !== "boolean" ||
    typeof body.truncated !== "boolean" ||
    typeof body.durationMs !== "number"
  ) {
    throw new Error("The isolated CLI returned an invalid response.");
  }

  return {
    stdout: body.stdout,
    stderr: body.stderr,
    exitCode: body.exitCode,
    cwd: body.cwd,
    timedOut: body.timedOut,
    truncated: body.truncated,
    durationMs: body.durationMs,
  };
}

function promptPath(cwd: string) {
  const normalized = cwd.trim().replace(/\/$/, "");
  if (
    !normalized ||
    normalized === "." ||
    normalized === DEFAULT_WORKBENCH_TERMINAL_CWD
  ) {
    return "~";
  }
  if (normalized.startsWith(`${DEFAULT_WORKBENCH_TERMINAL_CWD}/`)) {
    return `~/${normalized.slice(DEFAULT_WORKBENCH_TERMINAL_CWD.length + 1)}`;
  }
  return normalized;
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) return `${Math.max(0, Math.round(durationMs))}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function appendControlC(output: string) {
  return output ? `${output.replace(/\n$/, "")}\n^C` : "^C";
}

export function WorkbenchCli() {
  const requestHeaders = useWorkbenchRequestHeaders();
  const [cwd, setCwd] = useState(DEFAULT_WORKBENCH_TERMINAL_CWD);
  const [input, setInput] = useState("");
  const [entries, setEntries] = useState<CliEntry[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("CLI ready");
  const nextIdRef = useRef(0);
  const historyDraftRef = useRef("");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const scrollArea = scrollRef.current;
      if (scrollArea) scrollArea.scrollTop = scrollArea.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [entries]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const clearTranscript = () => {
    setEntries((current) =>
      current.filter((entry) => entry.status === "running"),
    );
    setAnnouncement("CLI transcript cleared");
  };

  const runCommand = async (command: string) => {
    if (runningId !== null) return;

    if (command === "clear") {
      clearTranscript();
      setInput("");
      setHistoryIndex(null);
      return;
    }

    const id = ++nextIdRef.current;
    const controller = new AbortController();
    const startedAt = Date.now();
    const entry: CliEntry = {
      id,
      command,
      cwd,
      stdout: "",
      stderr: "",
      exitCode: null,
      timedOut: false,
      truncated: false,
      durationMs: null,
      status: "running",
    };

    abortRef.current = controller;
    setEntries((current) => [...current, entry].slice(-MAX_TRANSCRIPT_ITEMS));
    setRunningId(id);
    setInput("");
    setHistoryIndex(null);
    setHistory((current) => {
      const last = current[current.length - 1];
      const next = last === command ? current : [...current, command];
      return next.slice(-MAX_HISTORY_ITEMS);
    });
    setAnnouncement(`Running ${command}`);

    try {
      const response = await fetch("/api/workbench/terminal", {
        method: "POST",
        cache: "no-store",
        headers: {
          ...requestHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ command, cwd }),
        signal: controller.signal,
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(responseError(payload));
      const result = parseRunResult(payload);

      setCwd(result.cwd);
      setEntries((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                ...result,
                status: "complete",
              }
            : item,
        ),
      );
      setAnnouncement(
        result.timedOut
          ? `${command} timed out`
          : `${command} finished with exit code ${result.exitCode}`,
      );
    } catch (error) {
      const cancelled = controller.signal.aborted;
      const message =
        error instanceof Error
          ? error.message
          : "The isolated CLI could not run this command.";
      setEntries((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                stderr: cancelled ? appendControlC(item.stderr) : message,
                exitCode: cancelled ? 130 : null,
                durationMs: Date.now() - startedAt,
                status: cancelled ? "cancelled" : "error",
              }
            : item,
        ),
      );
      setAnnouncement(cancelled ? `${command} cancelled` : message);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setRunningId((current) => (current === id ? null : current));
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const command = input.trim();
    if (!command) return;
    void runCommand(command);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (
      event.ctrlKey &&
      event.key.toLowerCase() === "c" &&
      runningId !== null
    ) {
      event.preventDefault();
      abortRef.current?.abort();
      return;
    }

    if (event.ctrlKey && event.key.toLowerCase() === "l") {
      event.preventDefault();
      clearTranscript();
      return;
    }

    if (event.key === "ArrowUp") {
      if (history.length === 0) return;
      event.preventDefault();
      const nextIndex =
        historyIndex === null
          ? history.length - 1
          : Math.max(0, historyIndex - 1);
      if (historyIndex === null) historyDraftRef.current = input;
      setHistoryIndex(nextIndex);
      setInput(history[nextIndex] ?? "");
      return;
    }

    if (event.key === "ArrowDown" && historyIndex !== null) {
      event.preventDefault();
      const nextIndex = historyIndex + 1;
      if (nextIndex >= history.length) {
        setHistoryIndex(null);
        setInput(historyDraftRef.current);
      } else {
        setHistoryIndex(nextIndex);
        setInput(history[nextIndex] ?? "");
      }
    }
  };

  const isRunning = runningId !== null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-workbench-terminal font-mono text-[12px] text-workbench-text">
      <div
        ref={scrollRef}
        aria-busy={isRunning}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5 [scrollbar-color:var(--scrollbar-thumb)_transparent]"
      >
        {entries.length === 0 ? (
          <div className="flex min-h-full flex-col justify-end pb-1 text-[11px] leading-5 text-[var(--pro-text-muted)]">
            <p>
              <span className="text-foreground">RIFT isolated CLI</span>
              <span aria-hidden className="text-workbench-faint">
                {" "}
                ·{" "}
              </span>
              commands run in a separate premium sandbox.
            </p>
            <p>Use ↑↓ for history, Ctrl+L to clear, and Ctrl+C to cancel.</p>
          </div>
        ) : (
          <ol aria-label="CLI transcript" className="space-y-2.5">
            {entries.map((entry) => (
              <li key={entry.id} className="min-w-0">
                <div className="flex min-w-0 items-start gap-2 leading-5">
                  <span className="shrink-0 select-none text-muted-foreground">
                    {promptPath(entry.cwd)} $
                  </span>
                  <code className="min-w-0 whitespace-pre-wrap break-words text-foreground">
                    {entry.command}
                  </code>
                </div>
                {entry.stdout ? (
                  <pre className="whitespace-pre-wrap break-words leading-5 text-[var(--pro-text-secondary)]">
                    {entry.stdout}
                  </pre>
                ) : null}
                {entry.stderr ? (
                  <pre className="whitespace-pre-wrap break-words leading-5 text-workbench-error">
                    {entry.stderr}
                  </pre>
                ) : null}
                <div className="flex min-h-4 items-center gap-2 text-[10.5px] text-[var(--pro-text-muted)]">
                  {entry.status === "running" ? (
                    <>
                      <span className="motion-safe:animate-pulse text-workbench-info">
                        running
                      </span>
                      <span
                        aria-hidden
                        className="h-3 w-1 bg-workbench-info/75"
                      />
                    </>
                  ) : (
                    <>
                      <span>
                        {entry.status === "cancelled"
                          ? "cancelled"
                          : entry.timedOut
                            ? "timed out"
                            : entry.exitCode === null
                              ? "failed"
                              : `exit ${entry.exitCode}`}
                      </span>
                      {entry.durationMs !== null ? (
                        <span>{formatDuration(entry.durationMs)}</span>
                      ) : null}
                      {entry.truncated ? <span>output truncated</span> : null}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        aria-label="Isolated CLI command"
        className="flex min-h-9 shrink-0 items-center gap-2 border-t border-workbench-border bg-workbench-panel px-3"
      >
        <label htmlFor="workbench-cli-input" className="sr-only">
          Command
        </label>
        <span className="shrink-0 select-none text-[var(--pro-text-secondary)]">
          {promptPath(cwd)} $
        </span>
        <input
          ref={inputRef}
          id="workbench-cli-input"
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            if (historyIndex !== null) setHistoryIndex(null);
          }}
          onKeyDown={handleKeyDown}
          readOnly={isRunning}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby="workbench-cli-hint"
          className="h-8 min-w-0 flex-1 bg-transparent p-0 text-[12px] text-workbench-text caret-workbench-info outline-none placeholder:text-[var(--pro-text-muted)] read-only:cursor-wait"
          placeholder={
            isRunning ? "Command running - Ctrl+C to cancel" : "Type a command…"
          }
        />
        <span
          id="workbench-cli-hint"
          className="hidden text-[10px] text-[var(--pro-text-muted)] sm:inline"
        >
          {isRunning ? "Ctrl+C cancel" : "Enter run"}
        </span>
      </form>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
