import { preservePtyModelContext } from "./utils/pty-model-context";
import { ptyModelOutput } from "./utils/pty-model-output";
import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "@/types";
import { looseEnum, looseInt, coerceEnum, coerceInt } from "./utils/loose-args";
import type { PtySession } from "./utils/pty-session-manager";
import { getSessionSnapshots } from "./utils/pty-output-formatter";
import {
  waitForOutput,
  capOutput,
  stripAnsi,
  peekExited,
} from "./utils/pty-wait-utils";
import { TMUX_SPECIAL_KEYS, translateInput } from "./utils/pty-keys";
import {
  parseGuardrailConfig,
  getEffectiveGuardrails,
  checkCommandGuardrails,
} from "./utils/guardrails";

// ─── Interactive PTY constants ──────────────────────────────────────────
const MAX_INPUT_BYTES_PER_SEND = 8 * 1024;
const DEFAULT_WAIT_TIMEOUT_SECONDS = 10;
const MAX_WAIT_TIMEOUT_SECONDS = 300;
// Brief window to capture the immediate response to a `send` (e.g. a prompt
// echoing "Hello, X!"). Too short and we miss instant CLI replies; too long
// and we block the agent on long-running processes that need explicit `wait`.
const SEND_IMMEDIATE_OUTPUT_WINDOW_MS = 500;
// For `wait`, treat `WAIT_QUIET_WINDOW_MS` of silence (after the first chunk)
// as "process settled" — typically a redrawn prompt or completed command.
// `timeout` remains the hard ceiling for processes that never settle.
const WAIT_QUIET_WINDOW_MS = 500;
const CLEAR_PENDING_INPUT_KEYS = new Set(["C-c", "C-u"]);
const BACKSPACE_KEYS = new Set(["BSpace", "Backspace", "C-h"]);
const SUBMIT_INPUT_KEYS = new Set(["Enter", "Return", "C-j"]);

const getGuardrailInputFragment = (input: string): string => {
  if (SUBMIT_INPUT_KEYS.has(input)) return "\n";
  if (input === "Space") return " ";
  if (input === "Tab" || input === "C-i") return "\t";
  if (
    TMUX_SPECIAL_KEYS.has(input) ||
    (input.startsWith("M-") && input.length === 3) ||
    (input.startsWith("C-S-") && input.length === 5)
  ) {
    return "";
  }
  return input;
};

const getGuardrailInputState = (
  pendingInput: string,
  input: string,
): { checkInput: string; nextPendingInput: string } => {
  if (CLEAR_PENDING_INPUT_KEYS.has(input)) {
    return { checkInput: pendingInput, nextPendingInput: "" };
  }
  if (BACKSPACE_KEYS.has(input)) {
    const nextPendingInput = pendingInput.slice(0, -1);
    return { checkInput: nextPendingInput, nextPendingInput };
  }

  const checkInput = (pendingInput + getGuardrailInputFragment(input))
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lastNewlineIndex = checkInput.lastIndexOf("\n");
  const nextPendingInput =
    lastNewlineIndex === -1
      ? checkInput
      : checkInput.slice(lastNewlineIndex + 1);

  return { checkInput, nextPendingInput };
};

export const createInteractTerminalSession = (context: ToolContext) => {
  const { writer, chatId, ptySessionManager, guardrailsConfig } = context;
  const userGuardrailConfig = parseGuardrailConfig(guardrailsConfig);
  const effectiveGuardrails = getEffectiveGuardrails(userGuardrailConfig);

  return tool({
    description: `Continue a persistent shell session returned by run_terminal_cmd with interactive=true.
- view reads retained scrollback; send writes stdin and captures the immediate reply; wait observes a running process; kill terminates it. Inspect completion status before treating output as final.
- Routine send/wait return new output and the current screen. For large scrollback, scrollback.path preserves the retained snapshot for file reads, including line ranges. Paths last only as long as the sandbox; bufferTruncated means older bytes were evicted.
- A timeout only ends observation: it NEVER kills the process. Wait only after send or an unfinished command when prior output warrants more time. Use short waits (e.g. 5 seconds); do not wait for persistent daemons. Kill unused or unresponsive sessions when appropriate.
- Input is verbatim: include a trailing \\n or Enter to submit; otherwise a later send appends to the same line. Do not escape ordinary text. Use tmux key names: C-c interrupts, C-d sends EOF, C-z suspends; Enter, Tab, Space, Escape, BSpace, DC, arrows, Home/End, PageUp/PageDown and F1-F12. Modifiers use M-key or C-S-key.
- Input, including text accumulated across sends, is checked against command guardrails. Never forward untrusted content.`,
    inputSchema: z.object({
      action: looseEnum(["view", "wait", "send", "kill"]).describe(
        "The action to perform. One of: view, wait, send, kill.",
      ),
      brief: z
        .string()
        .describe(
          "A one-sentence preamble describing the purpose of this operation",
        ),
      input: z
        .string()
        .optional()
        .describe(
          'Input text to send to the interactive session. Required for `send`. Sent verbatim — without a trailing \\n (or `Enter`) the line is typed but NOT submitted, and a subsequent `send` will append to the same line. To submit just Enter, pass `"Enter"` or `"\\n"`.',
        ),
      session: z
        .string()
        .describe(
          "The unique identifier of the target shell session (returned by `run_terminal_cmd` with `interactive=true`)",
        ),
      timeout: looseInt
        .optional()
        .describe(
          `Timeout in seconds to wait for output. Only used for \`wait\` action. Defaults to ${DEFAULT_WAIT_TIMEOUT_SECONDS} seconds. Max ${MAX_WAIT_TIMEOUT_SECONDS} seconds.`,
        ),
    }),
    execute: async (
      {
        session: sessionId,
        action: action_raw,
        input,
        timeout: timeout_raw,
      }: {
        session: string;
        action: "send" | "wait" | "view" | "kill" | string;
        input?: string;
        timeout?: number | string;
      },
      { toolCallId, abortSignal },
    ) => {
      // Repair possibly-stringy args from weaker models before use.
      const action = coerceEnum(
        action_raw,
        ["view", "wait", "send", "kill"] as const,
        "view",
      )!;
      // Preserve a finite numeric value verbatim. Tests and programmatic
      // callers use sub-second waits, while malformed model-emitted strings
      // still take the forgiving integer coercion path.
      const timeout =
        typeof timeout_raw === "number" && Number.isFinite(timeout_raw)
          ? timeout_raw
          : coerceInt(timeout_raw, DEFAULT_WAIT_TIMEOUT_SECONDS);
      const timeoutMs =
        Math.max(
          0,
          Math.min(
            timeout ?? DEFAULT_WAIT_TIMEOUT_SECONDS,
            MAX_WAIT_TIMEOUT_SECONDS,
          ),
        ) * 1000;

      // Emit raw bytes to UI terminal stream - no cleaning during streaming.
      // The sessionSnapshot in the final result is properly cleaned via xterm
      // headless, and the UI prefers it once the tool completes.
      let emitQueue: Promise<void> = Promise.resolve();
      const emitTerminal = (bytes: Uint8Array): void => {
        emitQueue = emitQueue
          .then(() => {
            // Send raw text - UI will show progress, then switch to clean
            // sessionSnapshot when tool completes
            const text = new TextDecoder().decode(bytes);
            writer.write({
              type: "data-terminal",
              id: `pty-${toolCallId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              data: {
                terminal: text,
                toolCallId,
                action,
                session: sessionId,
              } as unknown as { terminal: string; toolCallId: string },
            });
          })
          .catch((err) =>
            console.error(
              "[interact-terminal-session] emitTerminal failed:",
              err,
            ),
          );
      };
      const drainEmitQueue = () => emitQueue;
      const modelContextFor = (
        session: PtySession,
        snapshots: Awaited<ReturnType<typeof getSessionSnapshots>>,
      ) =>
        preservePtyModelContext(
          session,
          snapshots,
          async () => (await context.sandboxManager.getSandbox()).sandbox,
        );

      // ─── Action result type ────────────────────────────────────────────────
      type ActionResult = { result: Record<string, unknown> };

      const errorResult = (error: string): ActionResult => ({
        result: { output: "", error },
      });

      const getSessionOrError = (
        actionName: string,
        sid: string | undefined,
      ): { session: PtySession } | { error: ActionResult } => {
        if (!sid) {
          return {
            error: errorResult(`action=${actionName} requires \`session\`.`),
          };
        }
        const found = ptySessionManager.get(chatId, sid);
        if (!found) {
          return { error: errorResult(`Session ${sid} not found.`) };
        }
        return { session: found };
      };

      const emitPriorContext = (session: PtySession) => {
        // Send raw snapshot bytes to preserve ANSI colors for xterm.js rendering
        const prior = ptySessionManager.snapshot(session);
        if (prior.byteLength > 0) emitTerminal(prior);
        // UI already received these bytes in its snapshot. Keep unread bytes
        // for the model delta: they may have arrived between tool calls.
        return ptySessionManager.consumeDelta(session);
      };

      // Reads the (internal) `exitedNaturally` field. The session stays
      // around after natural exit so `view`/`wait` can read final output,
      // but `send` has no live process to write to.
      const peekSessionExit = (
        s: PtySession,
      ): { exitCode: number | null } | null => {
        const internal = s as {
          exitedNaturally?: { exitCode: number | null } | null;
        };
        return internal.exitedNaturally ?? null;
      };

      const exitedSendError = (
        sid: string,
        exited: { exitCode: number | null },
        during: boolean,
      ): ActionResult => ({
        result: {
          output: "",
          error: `Session ${sid} ${during ? "exited during send" : "has exited"} (exitCode=${exited.exitCode}). Use action=view to read final output, or start a new session via run_terminal_cmd.`,
          exited,
        },
      });

      const modelDelta = (prior: Uint8Array, current: Uint8Array) => {
        const decoder = new TextDecoder();
        return capOutput(
          stripAnsi(
            decoder.decode(prior, { stream: true }) + decoder.decode(current),
          ),
        );
      };

      // ─── Handler: send ─────────────────────────────────────────────────────
      const handleSend = async (): Promise<ActionResult> => {
        if (input === undefined || input.length === 0) {
          return errorResult(
            'action=send requires `input`. To submit just Enter (e.g. to terminate a Python multi-line block or accept a default prompt), pass input="Enter" or input="\\n".',
          );
        }
        const lookup = getSessionOrError("send", sessionId);
        if ("error" in lookup) return lookup.error;
        const { session } = lookup;

        // Fast-fail if the PTY already exited — otherwise sendInput on E2B
        // rejects with an opaque `[not_found] process with pid N not found`
        // that doesn't tell the model the session is dead.
        const priorExit = peekSessionExit(session);
        if (priorExit) return exitedSendError(sessionId, priorExit, false);

        // Translate tmux key names (C-c, Up, Enter, ...) to escape sequences;
        // raw text passes through unchanged with trailing newline normalized
        // to CR so "echo hi\n" submits the line as a real Enter.
        const { checkInput, nextPendingInput } = getGuardrailInputState(
          session.pendingGuardrailInput,
          input,
        );
        const guardrailResult = checkCommandGuardrails(
          checkInput,
          effectiveGuardrails,
        );
        if (!guardrailResult.allowed) {
          return errorResult(
            `Input blocked by security guardrail "${guardrailResult.policyName}": ${guardrailResult.message}. This input pattern has been blocked for safety.`,
          );
        }
        const bytes = translateInput(input);
        if (bytes.byteLength > MAX_INPUT_BYTES_PER_SEND) {
          return errorResult(
            `Input exceeds MAX_INPUT_BYTES_PER_SEND=${MAX_INPUT_BYTES_PER_SEND} (got ${bytes.byteLength}).`,
          );
        }
        try {
          await session.handle.sendInput(bytes);
        } catch (err) {
          // sendInput may have raced with a natural exit between the
          // pre-check and now — surface that explicitly when it's the cause.
          const raceExit = peekSessionExit(session);
          if (raceExit) return exitedSendError(sessionId, raceExit, true);
          return errorResult(
            `Failed to send input: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        // Validate and send before consuming unread bytes. A blocked or raced
        // failed send must leave them available to the next model poll.
        const priorDelta = emitPriorContext(session);
        session.pendingGuardrailInput = nextPendingInput;
        session.lastActivityAt = Date.now();
        // Capture the immediate response chunk — prompts that echo a reply
        // ("Hello, X!") show up here. Use action=wait for processes that
        // take longer to respond.
        const delta = await waitForOutput(
          session,
          SEND_IMMEDIATE_OUTPUT_WINDOW_MS,
          abortSignal,
          emitTerminal,
          (s) => ptySessionManager.consumeDelta(s),
        );
        await drainEmitQueue();
        const snapshots = await getSessionSnapshots(ptySessionManager, session);
        return {
          result: {
            output: modelDelta(priorDelta, delta),
            modelContext: await modelContextFor(session, snapshots),
            sessionSnapshot: snapshots.cleaned,
            rawSnapshot: snapshots.raw,
            ...(session.bufferTruncated ? { bufferTruncated: true } : {}),
          },
        };
      };

      // ─── Handler: wait ─────────────────────────────────────────────────────
      const handleWait = async (): Promise<ActionResult> => {
        const lookup = getSessionOrError("wait", sessionId);
        if ("error" in lookup) return lookup.error;
        const { session } = lookup;

        const priorDelta = emitPriorContext(session);

        const alreadyExited = await peekExited(session);
        const delta = await waitForOutput(
          session,
          timeoutMs,
          abortSignal,
          emitTerminal,
          (s) => ptySessionManager.consumeDelta(s),
          { quietMs: WAIT_QUIET_WINDOW_MS },
        );
        await drainEmitQueue();
        const snapshots = await getSessionSnapshots(ptySessionManager, session);
        const out: Record<string, unknown> = {
          output: modelDelta(priorDelta, delta),
          modelContext: await modelContextFor(session, snapshots),
          sessionSnapshot: snapshots.cleaned,
          rawSnapshot: snapshots.raw,
        };
        if (session.bufferTruncated) out.bufferTruncated = true;
        if (alreadyExited) out.exited = { exitCode: alreadyExited.exitCode };
        return { result: out };
      };

      // ─── Handler: view ─────────────────────────────────────────────────────
      const handleView = async (): Promise<ActionResult> => {
        const lookup = getSessionOrError("view", sessionId);
        if ("error" in lookup) return lookup.error;
        const { session } = lookup;

        const snapshot = ptySessionManager.snapshot(session);
        if (snapshot.byteLength > 0) emitTerminal(snapshot);
        await drainEmitQueue();
        const snapshots = await getSessionSnapshots(ptySessionManager, session);
        const rawText = snapshots.raw;
        const internal = session as {
          exitedNaturally?: { exitCode: number | null } | null;
        };
        return {
          result: {
            output: capOutput(stripAnsi(rawText)),
            modelContext: await modelContextFor(session, snapshots),
            sessionSnapshot: snapshots.cleaned,
            rawSnapshot: rawText,
            ...(session.bufferTruncated ? { bufferTruncated: true } : {}),
            ...(internal.exitedNaturally
              ? { exited: internal.exitedNaturally }
              : {}),
          },
        };
      };

      // ─── Handler: kill ─────────────────────────────────────────────────────
      const handleKill = async (): Promise<ActionResult> => {
        const lookup = getSessionOrError("kill", sessionId);
        if ("error" in lookup) return lookup.error;
        const { session } = lookup;

        // Skip the snapshot dump — the user already saw the final state via
        // prior view/wait/send blocks; a one-line confirmation reads cleaner
        // in both the agent transcript and the sidebar.
        const exitPromise = session.handle.exited;
        await ptySessionManager.close(chatId, session.sessionId);
        const exit = await exitPromise.catch(() => ({ exitCode: null }));
        return {
          result: {
            output: "Successfully killed interactive shell.",
            exitCode: exit.exitCode,
          },
        };
      };

      // ─── Dispatch ──────────────────────────────────────────────────────────
      const handlers: Record<string, () => Promise<ActionResult>> = {
        send: handleSend,
        wait: handleWait,
        view: handleView,
        kill: handleKill,
      };

      const handler = handlers[action];
      if (handler) return handler();

      return errorResult(`Unknown action: ${action}`);
    },
    toModelOutput({ input, output }) {
      return ptyModelOutput(output, input.action === "view");
    },
  });
};
