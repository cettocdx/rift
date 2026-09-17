import { prepareJournaledCommand } from "@/lib/agent/remote-command-journal";
import { getSandboxContext } from "@/lib/ai/sandbox-context";
import { preservePtyModelContext } from "./utils/pty-model-context";
import { ptyModelOutput } from "./utils/pty-model-output";
import { tool } from "ai";
import { z } from "zod";
import { CommandExitError } from "@e2b/code-interpreter";
import { randomUUID } from "crypto";
import type { ToolContext, AnySandbox } from "@/types";
import { createTerminalHandler } from "@/lib/utils/terminal-executor";
import { TIMEOUT_MESSAGE } from "@/lib/token-utils";
import { saveTruncatedOutput } from "./utils/terminal-output-saver";
import { BackgroundProcessTracker } from "./utils/background-process-tracker";
import { waitForSandboxReady } from "./utils/sandbox-health";
import {
  isE2BPermanentError,
  getUserFacingE2BErrorMessage,
} from "./utils/e2b-errors";
import { isE2BSandbox, isCentrifugoSandbox } from "./utils/sandbox-types";
import {
  buildSandboxCommandOptions,
  augmentCommandPath,
  DEFAULT_COMMAND_EXECUTION_TIME,
  MAX_COMMAND_EXECUTION_TIME,
  COMMAND_EXIT_DELIVERY_GRACE_MS,
} from "./utils/sandbox-command-options";
import {
  parseGuardrailConfig,
  getEffectiveGuardrails,
  checkCommandGuardrails,
} from "./utils/guardrails";
import { getCaidoConfig, buildCaidoProxyEnvVars } from "./utils/caido-proxy";
import { ensureCaido } from "./utils/proxy-manager";
import { createE2BPtyHandle } from "./utils/e2b-pty-adapter";
import {
  DEFAULT_PTY_COLS,
  DEFAULT_PTY_ROWS,
  type PtySession,
} from "./utils/pty-session-manager";
import { getSessionSnapshots } from "./utils/pty-output-formatter";
import {
  waitForOutput,
  capOutput,
  stripAnsi,
  peekExited,
} from "./utils/pty-wait-utils";
import { configureSandboxGit } from "@/lib/github/configure-sandbox-git";

// Tracks E2B sandboxes whose git credentials have already been configured with
// the user's connected GitHub token, so we only write .git-credentials once per
// sandbox (the first terminal command). Keyed by the sandbox instance.
const gitConfiguredSandboxes = new WeakSet<object>();

/**
 * Lazily inject the user's connected GitHub token into the sandbox's git
 * credential store the first time a terminal command runs. Best-effort and
 * non-fatal — a failure here must never block the actual command.
 */
async function ensureGitCredentials(
  sandbox: AnySandbox,
  context: ToolContext,
): Promise<void> {
  const token = context.githubToken;
  if (!token) return;
  if (!isE2BSandbox(sandbox)) return;
  if (gitConfiguredSandboxes.has(sandbox)) return;
  gitConfiguredSandboxes.add(sandbox);
  try {
    await configureSandboxGit(sandbox, token, context.githubUsername);
  } catch (error) {
    // Non-fatal: the agent can still run commands; git pushes just won't be
    // pre-authenticated. Drop the flag so a later command can retry.
    gitConfiguredSandboxes.delete(sandbox);
    console.warn("[run_terminal_cmd] git credential setup failed:", error);
  }
}

const DEFAULT_STREAM_TIMEOUT_SECONDS = 60;
const MAX_TIMEOUT_SECONDS = MAX_COMMAND_EXECUTION_TIME / 1000;

class CommandOutcomeUnknownError extends Error {
  constructor() {
    super(
      "The command result could not be confirmed. It may already have started or completed in the selected environment. Do not automatically repeat this command. Reconnect and inspect the process or affected files before deciding what to do next.",
    );
    this.name = "CommandOutcomeUnknownError";
  }
}

// Weaker models (notably Grok 4.5) occasionally emit malformed tool calls: a flag
// sent as a string ("false"), or several params jammed into `interactive`, e.g.
//   interactive: "false is_background={false} timeout={30}"
// The schema accepts string forms (union with string); this repairs them so a
// valid command is never lost to a type-validation error.
const asBool = (v: unknown, fallback: boolean): boolean => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (/^\s*(true|1|yes)\b/i.test(v)) return true;
    if (/^\s*(false|0|no)\b/i.test(v)) return false;
  }
  return fallback;
};

const normalizeTerminalFlags = (a: {
  interactive: unknown;
  is_background: unknown;
  timeout: unknown;
}): {
  interactive: boolean;
  is_background: boolean;
  timeout: number | undefined;
} => {
  let { is_background, timeout } = a;
  const { interactive } = a;
  // Un-jam params the model crammed into the `interactive` string.
  if (typeof interactive === "string") {
    if (is_background === undefined) {
      const m = interactive.match(
        /is_background\s*=\s*\{?\s*(true|false)\s*\}?/i,
      );
      if (m) is_background = m[1];
    }
    if (timeout === undefined) {
      const m = interactive.match(/timeout\s*=\s*\{?\s*(\d+)\s*\}?/i);
      if (m) timeout = m[1];
    }
  }
  const timeoutNum =
    typeof timeout === "number"
      ? timeout
      : typeof timeout === "string" && /\d/.test(timeout)
        ? Number(timeout.match(/\d+/)![0])
        : undefined;
  return {
    interactive: asBool(interactive, false),
    is_background: asBool(is_background, false),
    timeout: timeoutNum,
  };
};

// Once an interactive PTY emits its first bytes, treat `quietMs` of silence
// as "settled" (prompt drew, REPL banner finished, etc.). Lets `bash`/`python3`
// return in ~half a second instead of blocking the user-supplied timeout
// ceiling. The agent can follow up with action=wait/send.
const INTERACTIVE_QUIET_WINDOW_MS = 500;

export const createRunTerminalCmd = (
  context: ToolContext,
  origin = getSandboxContext(),
) => {
  // Preserve existing extra-environment precedence without reading later credentials.
  const mergeEnvs = (
    extra?: Record<string, string>,
  ): Record<string, string> | undefined => {
    const merged = { ...origin.recon, ...(extra ?? {}) };
    return Object.keys(merged).length ? merged : undefined;
  };
  const {
    sandboxManager,
    writer,
    backgroundProcessTracker,
    guardrailsConfig,
    caidoEnabled,
    caidoPort,
    ptySessionManager,
    chatId,
    runRecorder,
  } = context;

  // Parse user guardrail configuration and get effective guardrails
  const userGuardrailConfig = parseGuardrailConfig(guardrailsConfig);
  const effectiveGuardrails = getEffectiveGuardrails(userGuardrailConfig);

  // Caido proxy is set up eagerly only on E2B sandboxes (controlled image where
  // capturing all agent HTTP traffic is the point). On local sandboxes the proxy
  // is lazy: it spins up only when the agent reaches for a proxy tool, so plain
  // terminal commands don't pay the install/start cost or route through Caido.
  // Permanently disabled on first setup failure to avoid retrying every command.
  const caidoConfig = getCaidoConfig(caidoPort);
  let caidoSetupDisabled = false;

  return tool({
    description: `Execute a shell command on the selected execution target, subject to runtime approvals and guardrails.
- Chain dependent commands with && so failures stop dependent work. Probe optional tools independently: one missing command must not skip other checks. Install needed prerequisites and verify them; never suppress build, test, or generation failures. Use pipes for processing output.
- Save code to a file before executing it; do not use inline interpreter code (python3 -c, node -e). Keep commands on one line. Pass non-interactive flags to installers and disable pagers or pipe through cat.
- Use is_background for long-running jobs and servers, not shell background syntax. Do not background a command whose output file you need immediately. Use interactive=true for prompts/REPLs and continue the returned session with interact_terminal_session.
- Redirect large outputs to files and inspect relevant excerpts to avoid context overflow. Share user deliverables with get_terminal_files.
- Prefer rg for text searches and rg --files for filename discovery; fall back to grep/find if unavailable. Prefer the file tool for reading and editing content.
${context.purpose === "security" ? "For security assessments, use targeted ports, small wordlists, specific templates and efficient flags. Keep checks short, respect the remaining request budget and leave time to report verified results and unfinished work. Save scan results using output flags or redirection. A command whose observation ends in a timeout may still be running; verify its state before retrying or splitting work. Start vague requests with lightweight checks; expand only when requested or warranted by findings. Install missing container tools with apt/pip as needed (no sudo needed in the container)." : "Stay within the requested project and use its existing build and verification commands."}`,
    inputSchema: z.object({
      command: z.string().describe("The shell command to execute"),
      cwd: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Optional verified absolute directory. Omit to use the configured project checkout or default directory (/home/user in Cloud). Never guess a workspace path.",
        ),
      brief: z.string().describe("One sentence explaining this operation."),
      is_background: z
        .union([z.boolean(), z.string()])
        .optional()
        .describe(
          "Default false. True backgrounds long-running jobs; ignored for interactive=true. Keep false when output files are needed immediately via get_terminal_files.",
        ),
      timeout: z
        .union([z.number(), z.string()])
        .optional()
        .describe(
          `For interactive=false, an explicit timeout sets the command wait budget, capped at ${MAX_TIMEOUT_SECONDS} seconds, plus up to 30 seconds for exit delivery. Local commands are terminated at this budget; cloud commands may continue if observation ends. When omitted, observe for ${DEFAULT_STREAM_TIMEOUT_SECONDS} seconds with a 10-minute backend budget. For interactive=true, this is only the initial observation time. An unconfirmed result must never be automatically repeated.`,
        ),
      interactive: z
        .union([z.boolean(), z.string()])
        .optional()
        .describe(
          "Default false. True opens a PTY for prompts, REPLs, SSH, sudo or installers. Continue its session ID with interact_terminal_session (send/wait/view/kill). Supported on E2B and local Centrifugo.",
        ),
    }),
    execute: async (
      {
        command,
        cwd,
        is_background: is_background_raw,
        timeout: timeout_raw,
        interactive: interactive_raw,
      }: {
        command: string;
        cwd?: string;
        is_background?: boolean | string;
        timeout?: number | string;
        interactive?: boolean | string;
      },
      { toolCallId, abortSignal },
    ) => {
      // Repair possibly-string or jammed flags from weaker models before use, so
      // a valid command isn't dropped over a malformed `interactive`/`timeout`.
      const { interactive, is_background, timeout } = normalizeTerminalFlags({
        interactive: interactive_raw,
        is_background: is_background_raw,
        timeout: timeout_raw,
      });
      // Evidence timing: when the command started, so its result can carry how
      // long it actually took. Persisted in the tool result (the message part),
      // so it survives on the trace rather than being lost the moment the row
      // is read back.
      const startedAt = Date.now();
      const withTiming = <T extends Record<string, unknown>>(result: T): T => {
        const endedAt = Date.now();
        const durationMs = endedAt - startedAt;
        // Note the command on the run so a later finding can point at it and
        // the run log records what was executed. Purely a record: never awaited
        // and never able to fail the command it describes.
        runRecorder?.recordTerminalCommand({
          toolCallId,
          command,
          exitCode:
            typeof result.exitCode === "number" ? result.exitCode : undefined,
          durationMs,
          output: typeof result.output === "string" ? result.output : undefined,
        });
        void runRecorder?.appendEvent({
          type: "terminal_command",
          toolName: "run_terminal_cmd",
          toolCallId,
          summary:
            command.length > 160 ? `${command.slice(0, 157)}...` : command,
          exitCode:
            typeof result.exitCode === "number" ? result.exitCode : undefined,
          durationMs,
        });
        return { ...result, startedAt, endedAt, durationMs };
      };
      // PTY geometry is fixed server-side (DEFAULT_PTY_COLS / DEFAULT_PTY_ROWS).
      // The model intentionally has no knob for this — a terminal size should
      // match a real display, not a model-chosen value. UIs that render the
      // PTY can call `PtyHandle.resize()` directly.
      const cols = DEFAULT_PTY_COLS;
      const rows = DEFAULT_PTY_ROWS;

      // Helper: emit a raw-byte chunk to the UI terminal stream.
      // The `data-terminal` part shape in `UIMessageStreamWriter` only types
      // the minimal `{terminal, toolCallId}` fields, but the frontend
      // (`TerminalToolHandler`/`ComputerSidebar`) reads the extra `action`
      // and `session` fields at runtime. This cast is intentional — keep
      // the minimal typed surface while carrying the extra metadata.
      //
      // To keep emitTerminal fire-and-forget from sync onData callbacks while
      // preserving FIFO order of writer.write, we chain the write calls
      // through a per-invocation promise queue. Raw bytes are sent during
      // streaming; sessionSnapshot in the result is cleaned via xterm headless.
      //
      // `activePtySessionId` tracks the session id that should be attached
      // to data-terminal events. For interactive exec the id is only known
      // AFTER create, so the exec branch updates it before emitting anything.
      // Send raw bytes during streaming - sessionSnapshot in result is cleaned
      let activePtySessionId: string | undefined;
      let emitQueue: Promise<void> = Promise.resolve();
      const emitTerminal = (bytes: Uint8Array): void => {
        const emitSessionId = activePtySessionId;
        emitQueue = emitQueue
          .then(() => {
            const text = new TextDecoder().decode(bytes);
            writer.write({
              type: "data-terminal",
              id: `pty-${toolCallId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              data: {
                terminal: text,
                toolCallId,
                action: "exec",
                session: emitSessionId,
              } as unknown as { terminal: string; toolCallId: string },
            });
          })
          .catch((err) =>
            console.error("[run-terminal-cmd] emitTerminal failed:", err),
          );
      };
      const drainEmitQueue = () => emitQueue;

      // Emit a boot-progress line into the LiveTerminalTail so the user sees
      // feedback during E2B cold start (3-8 min) instead of a blank chip.
      // Only fires when the sandbox hasn't been provisioned yet this session.
      let bootProgressCounter = 0;
      const emitBootProgress = (text: string) => {
        writer.write({
          type: "data-terminal",
          id: `boot-progress-${toolCallId}-${++bootProgressCounter}`,
          data: {
            terminal: text,
            toolCallId,
            action: "exec",
          } as unknown as { terminal: string; toolCallId: string },
        });
      };

      // Preserve the omitted-timeout observation default. Explicit budgets
      // extend execution/SDK observation separately from final exit delivery.
      const explicitTimeout =
        typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0;
      const effectiveStreamTimeout = Math.min(
        explicitTimeout ? timeout : DEFAULT_STREAM_TIMEOUT_SECONDS,
        MAX_TIMEOUT_SECONDS,
      );
      const executionTimeoutMs = explicitTimeout
        ? effectiveStreamTimeout * 1000
        : DEFAULT_COMMAND_EXECUTION_TIME;
      const observationTimeoutSeconds = explicitTimeout
        ? effectiveStreamTimeout + (2 * COMMAND_EXIT_DELIVERY_GRACE_MS) / 1000
        : effectiveStreamTimeout;
      // Check guardrails before executing the command
      const guardrailResult = checkCommandGuardrails(
        command,
        effectiveGuardrails,
      );
      if (!guardrailResult.allowed) {
        return {
          result: {
            output: "",
            exitCode: 1,
            error: `Command blocked by security guardrail "${guardrailResult.policyName}": ${guardrailResult.message}. This command pattern has been blocked for safety. If you believe this is a false positive, the user can adjust guardrail settings.`,
          },
        };
      }

      // ─── Interactive PTY exec branch ─────────────────────────────────
      if (interactive) {
        try {
          abortSignal?.throwIfAborted();
          if (!sandboxManager.isE2BSandboxBooted?.()) {
            emitBootProgress(
              "\x1b[33m⟳ Starting secure environment...\x1b[0m\r\n",
            );
          }
          const { sandbox } = await sandboxManager.getSandbox();
          abortSignal?.throwIfAborted();
          await ensureGitCredentials(sandbox, context);
          abortSignal?.throwIfAborted();
          const isCentrifugo = isCentrifugoSandbox(sandbox);
          const isE2B = isE2BSandbox(sandbox);

          if (!isE2B && !isCentrifugo) {
            return {
              result: {
                output: "",
                exitCode: 1,
                error:
                  "Interactive PTY requires E2B or local (Centrifugo) sandbox.",
              },
            };
          }

          const supportsCentrifugoPty =
            !isCentrifugo ||
            typeof sandbox.supportsPty !== "function" ||
            sandbox.supportsPty();

          if (!supportsCentrifugoPty) {
            return {
              result: {
                output: "",
                exitCode: 1,
                error:
                  "Interactive terminal sessions are unavailable on this local connection. Use non-interactive terminal commands instead.",
              },
            };
          }

          // Set up Caido proxy env vars before spawning the PTY so the session
          // launches with proxy env pointing at a running Caido. Mirrors the
          // non-interactive `executeCommand` flow: only eager on E2B; on
          // failure, permanently disable for the rest of this tool instance.
          let caidoEnvVars: Record<string, string> | undefined;
          if (caidoEnabled && isE2B && !caidoSetupDisabled) {
            try {
              await ensureCaido(context);
              caidoEnvVars = buildCaidoProxyEnvVars(caidoConfig);
            } catch (e) {
              console.warn(
                "[Terminal Command] Caido setup failed, disabling proxy env vars:",
                e instanceof Error ? e.message : e,
              );
              caidoSetupDisabled = true;
            }
          }

          // Factory is invoked BY `ptySessionManager.create` — this ensures
          // that if the concurrency cap is hit, the factory is never called
          // and no PTY is spawned (see FIX 4).
          const session = await ptySessionManager.create(chatId, {
            cols,
            rows,
            signal: abortSignal,
            createHandle: async () => {
              if (isCentrifugo) {
                const { createCentrifugoPtyHandle } =
                  await import("./utils/centrifugo-pty-adapter");
                abortSignal?.throwIfAborted();
                return createCentrifugoPtyHandle(sandbox, {
                  command,
                  cols,
                  rows,
                  envs: mergeEnvs(caidoEnvVars),
                  ...(cwd ? { cwd } : {}),
                });
              }
              return createE2BPtyHandle(sandbox, {
                cols,
                rows,
                user: "root",
                cwd: cwd ?? context.projectWorkingDirectory ?? "/home/user",
                // mergeEnvs injects the recon/OSINT keys (VirusTotal, Shodan…)
                // alongside the Caido proxy vars — without this, cf-origin and
                // other API-backed tools run key-blind in the interactive PTY.
                // HOME is fixed after the merge because the project directory
                // is browser-writable in Workbench and must never supply a
                // login profile to a privileged agent shell.
                envs: {
                  ...mergeEnvs(caidoEnvVars),
                  HOME: "/root",
                  USER: "root",
                  LOGNAME: "root",
                },
              });
            },
          });

          // Cancellation can arrive after registration but before this caller
          // resumes. Close that session before sending any initial command.
          if (abortSignal?.aborted) {
            await ptySessionManager.close(chatId, session.sessionId);
            abortSignal.throwIfAborted();
          }

          // Now that the session exists, tag subsequent data-terminal events
          // with its sessionId (was undefined at emitTerminal definition time).
          activePtySessionId = session.sessionId;

          // For E2B, the PTY starts a bare shell — fire the command + Enter
          // so the shell actually runs it. For Centrifugo, the command is
          // passed in pty_create and the local runner spawns it directly.
          if (!isCentrifugo) {
            await session.handle.sendInput(
              new TextEncoder().encode(command + "\n"),
            );
          }
          session.lastActivityAt = Date.now();

          // Stream output chunks as they arrive. Resolve early on a brief
          // quiet window so launching a REPL/shell returns when its prompt
          // finishes drawing rather than blocking the full timeout ceiling.
          const delta = await waitForOutput(
            session,
            effectiveStreamTimeout * 1000,
            abortSignal,
            emitTerminal,
            (s) => ptySessionManager.consumeDelta(s),
            { quietMs: INTERACTIVE_QUIET_WINDOW_MS },
          );
          await drainEmitQueue();
          const snapshots = await getSessionSnapshots(
            ptySessionManager,
            session,
          );
          // If the command finished during the quiet window (e.g. a one-shot
          // `echo … && whoami`), surface that so the agent doesn't try to
          // `interact_terminal_session send` against a dead session.
          const exited = await peekExited(session);
          return {
            result: {
              session: session.sessionId,
              pid: session.pid,
              output: capOutput(stripAnsi(new TextDecoder().decode(delta))),
              modelContext: await preservePtyModelContext(
                session,
                snapshots,
                async () => sandbox,
              ),
              sessionSnapshot: snapshots.cleaned,
              rawSnapshot: snapshots.raw,
              ...(session.bufferTruncated ? { bufferTruncated: true } : {}),
              ...(exited ? { exited: { exitCode: exited.exitCode } } : {}),
            },
          };
        } catch (err) {
          return {
            result: {
              output: "",
              exitCode: 1,
              error:
                err instanceof Error
                  ? err.message
                  : "Failed to create interactive PTY session.",
            },
          };
        }
      }

      try {
        if (!sandboxManager.isE2BSandboxBooted?.()) {
          emitBootProgress(
            "\x1b[33m⟳ Starting secure environment...\x1b[0m\r\n",
          );
        }
        // Get fresh sandbox and verify it's ready
        const { sandbox } = await sandboxManager.getSandbox();
        await ensureGitCredentials(sandbox, context);

        // Check for sandbox fallback and notify frontend
        const fallbackInfo = sandboxManager.consumeFallbackInfo?.();
        if (fallbackInfo?.occurred) {
          writer.write({
            type: "data-sandbox-fallback",
            id: `sandbox-fallback-${toolCallId}`,
            data: fallbackInfo,
          });
        }

        // Bail early if sandbox was already marked unavailable by any tool
        if (sandboxManager.isSandboxUnavailable()) {
          return {
            result: {
              output: "",
              exitCode: null,
              outcome: "not_started",
              retryable: false,
              error:
                "The workspace is marked unavailable after repeated health check failures. This command was not started. Preserve the existing workspace and report the connectivity issue; do not repeat commands until workspace recovery is confirmed.",
            },
          };
        }

        // Only health-check E2B sandboxes — local sandboxes don't need it
        // (they relay commands through Convex and have their own connectivity)
        if (isE2BSandbox(sandbox)) {
          try {
            await waitForSandboxReady(sandbox, 5, abortSignal);
            sandboxManager.resetHealthFailures();
          } catch (healthError) {
            // If aborted, don't retry - propagate the abort
            if (
              (healthError instanceof DOMException ||
                healthError instanceof Error) &&
              healthError.name === "AbortError"
            ) {
              throw healthError;
            }

            // A failed readiness probe does not establish workspace loss.
            // Killing/replacing this instance can erase files and other agents'
            // running processes. The requested command has not been dispatched.
            const retryable = !isE2BPermanentError(healthError);
            return {
              result: {
                output: "",
                exitCode: null,
                outcome: "not_started",
                retryable,
                error: retryable
                  ? "The existing workspace is temporarily unreachable. This command was not started and the workspace was not deleted or replaced. Retry readiness against this same workspace; do not create an empty replacement or repeat earlier commands whose outcomes are unknown."
                  : `${getUserFacingE2BErrorMessage(healthError) ?? "Workspace readiness requires attention before commands can continue."} This command was not started. Do not retry unchanged, replace the workspace, or repeat earlier commands whose outcomes are unknown.`,
              },
            };
          }
        }

        return await executeCommand(sandbox);

        async function executeCommand(sandboxInstance: typeof sandbox) {
          // Ensure Caido proxy is running + authenticated before commands route through it.
          // Only eager on E2B; local sandboxes defer setup to proxy tool invocations.
          // This is a no-op after the first successful call (cached per session).
          // If setup fails, permanently disable proxy env vars for all future commands.
          let caidoEnvVars: Record<string, string> | undefined;
          if (
            caidoEnabled &&
            isE2BSandbox(sandboxInstance) &&
            !caidoSetupDisabled
          ) {
            try {
              await ensureCaido(context);
              caidoEnvVars = buildCaidoProxyEnvVars(caidoConfig);
            } catch (e) {
              console.warn(
                "[Terminal Command] Caido setup failed, disabling proxy env vars:",
                e instanceof Error ? e.message : e,
              );
              caidoSetupDisabled = true;
            }
          }

          const terminalSessionId = `terminal-${randomUUID()}`;
          let outputCounter = 0;

          const createTerminalWriter = async (output: string) => {
            const part = {
              type: "data-terminal" as const,
              id: `${terminalSessionId}-${++outputCounter}`,
              data: { terminal: output, toolCallId },
            };
            // Only use writer: it already appends to the metadata stream. Calling appendMetadataStream
            // as well was causing every line to be sent twice and duplicated in the UI.
            writer.write(part);
          };

          return new Promise((resolve, reject) => {
            let resolved = false;
            let execution: any = null;
            let handler: ReturnType<typeof createTerminalHandler> | null = null;
            let processId: number | null = null; // Store PID for all processes

            // Handle abort signal
            const onAbort = async () => {
              if (resolved) {
                return;
              }

              // Set resolved IMMEDIATELY to prevent race with retry logic
              // This must happen before we kill the process, otherwise the error
              // from the killed process might trigger retries
              resolved = true;

              if (isCentrifugoSandbox(sandboxInstance)) {
                const result = handler ? handler.getResult() : { output: "" };
                if (handler) {
                  handler.cleanup();
                }
                resolve({
                  result: {
                    output: result.output,
                    exitCode: 130,
                    error: "Command execution aborted by user",
                  },
                });
                return;
              }

              // Try to get PID from execution object first (cheap, no shell call)
              if (!processId && execution && (execution as any)?.pid) {
                processId = (execution as any).pid;
              }

              // Kill only the handle returned by this one start. If the
              // acknowledgement arrives after abort, runCommand kills it then.
              try {
                await execution?.kill?.();
              } catch (error) {
                console.error(
                  "[Terminal Command] Error during abort termination:",
                  error,
                );
              }

              // Clean up and resolve
              const result = handler
                ? handler.getResult(processId ?? undefined)
                : { output: "" };
              if (handler) {
                handler.cleanup();
              }

              resolve({
                result: {
                  output: result.output,
                  exitCode: 130, // Standard SIGINT exit code
                  error: "Command execution aborted by user",
                },
              });
            };

            // Check if already aborted before starting
            if (abortSignal?.aborted) {
              return resolve({
                result: {
                  output: "",
                  exitCode: 130,
                  error: "Command execution aborted by user",
                },
              });
            }

            handler = createTerminalHandler(
              (output: string) => createTerminalWriter(output),
              {
                timeoutSeconds: observationTimeoutSeconds,
                onTimeout: async () => {
                  if (resolved) {
                    return;
                  }

                  // Try to get PID from execution object first (if available)
                  if (!processId && execution && (execution as any)?.pid) {
                    processId = (execution as any).pid;
                  }

                  // Observation ending does not prove the cloud process stopped.
                  // Preserve its known handle/PID without killing ongoing work.
                  // Local execution separately enforces the requested budget.
                  // A missing start acknowledgement is not permission to run
                  // a diagnostic command or guess which process to terminate.

                  await createTerminalWriter(
                    TIMEOUT_MESSAGE(
                      observationTimeoutSeconds,
                      processId ?? undefined,
                    ),
                  );

                  if (resolved) return;
                  resolved = true;
                  abortSignal?.removeEventListener("abort", onAbort);
                  const result = handler
                    ? handler.getResult(processId ?? undefined)
                    : { output: "" };
                  if (handler) {
                    handler.cleanup();
                  }
                  resolve({
                    result: {
                      output: result.output,
                      exitCode: null,
                      pid: processId ?? undefined,
                      outcome: "unknown",
                      error: new CommandOutcomeUnknownError().message,
                    },
                  });
                },
              },
            );

            // Register abort listener
            abortSignal?.addEventListener("abort", onAbort, { once: true });

            const commonOptions = buildSandboxCommandOptions(
              sandboxInstance,
              is_background
                ? undefined
                : {
                    onStdout: handler!.stdout,
                    onStderr: handler!.stderr,
                  },
              mergeEnvs(caidoEnvVars),
              executionTimeoutMs,
            );
            const runOptions = {
              ...commonOptions,
              ...(cwd
                ? { cwd }
                : isE2BSandbox(sandboxInstance) &&
                    context.projectWorkingDirectory
                  ? { cwd: context.projectWorkingDirectory }
                  : {}),
              // Cloud Stop uses the exact handle kill listener above. Aborting
              // its transport would destroy the exit receipt we must still join.
              signal: isE2BSandbox(sandboxInstance) ? undefined : abortSignal,
              // E2B timeoutMs ends the SDK stream, not the process itself.
              // Keep it open long enough to receive an exit at the budget.
              ...(isE2BSandbox(sandboxInstance) && {
                timeoutMs: executionTimeoutMs + COMMAND_EXIT_DELIVERY_GRACE_MS,
              }),
            };

            // Augment PATH for local sandboxes so user-installed tools
            // (e.g. ~/go/bin/waybackurls) are found without full paths.
            // The original command is never resubmitted after a start attempt.
            const effectiveCommand = augmentCommandPath(
              command,
              sandboxInstance,
            );

            const runCommand = async () => {
              ptySessionManager.assertExecutionOpen();
              const journal =
                isE2BSandbox(sandboxInstance) && !is_background
                  ? await prepareJournaledCommand(
                      // Resolve cwd inside the supervised child. A nonexistent
                      // directory must produce an exit receipt, not reject the
                      // supervisor launch and strand a reserved resource.
                      runOptions.cwd
                        ? `cd -- '${runOptions.cwd.replace(/'/g, `'"'"'`)}' || exit $?\n${effectiveCommand}`
                        : effectiveCommand,
                      sandboxInstance,
                      undefined,
                      executionTimeoutMs,
                    )
                  : undefined;
              try {
                ptySessionManager.assertExecutionOpen();
                abortSignal?.throwIfAborted();
              } catch (error) {
                // No SDK call has been made. This is explicit unsent evidence,
                // unlike a rejected/lost response after submission.
                await journal?.notStarted();
                throw error;
              }
              const launchOptions = journal
                ? { ...runOptions, cwd: undefined }
                : runOptions;
              const rawStarting = sandboxInstance.commands.run(
                journal?.command ?? effectiveCommand,
                is_background || isE2BSandbox(sandboxInstance)
                  ? { ...launchOptions, background: true }
                  : launchOptions,
              );
              const starting = rawStarting.then((handle) =>
                journal
                  ? new Proxy(handle, {
                      get(target, property) {
                        if (property === "kill")
                          return () =>
                            journal.stop((handle as { pid: number }).pid);
                        const value = Reflect.get(target, property, target);
                        return typeof value === "function"
                          ? value.bind(target)
                          : value;
                      },
                    })
                  : handle,
              );
              const observed = starting.then((started) => {
                if (journal)
                  void journal
                    .started((started as { pid: number }).pid)
                    .catch(() => {});
                return {
                  started,
                  completion:
                    isE2BSandbox(sandboxInstance) && !is_background
                      ? Promise.resolve().then(() =>
                          (
                            started as unknown as {
                              wait: () => Promise<typeof started>;
                            }
                          ).wait(),
                        )
                      : Promise.resolve(started),
                };
              });
              // A returned tool result or a kill acknowledgment is not process
              // exit. Keep one exact wait receipt even after abort/timeout.
              // Explicit background servers belong to the preview lifecycle.
              if (isE2BSandbox(sandboxInstance) && !is_background) {
                ptySessionManager.trackRemoteCommand(
                  chatId,
                  observed.then(({ started, completion }) => ({
                    pid: (started as { pid: number }).pid,
                    kill: async () => {
                      await (
                        started as unknown as { kill: () => Promise<unknown> }
                      ).kill();
                    },
                    confirmedExited: completion.then(
                      async (result) => {
                        if (typeof result.exitCode !== "number")
                          throw new CommandOutcomeUnknownError();
                        await journal?.exited((started as { pid: number }).pid);
                        return { exitCode: result.exitCode };
                      },
                      async (error: unknown) => {
                        if (error instanceof CommandExitError) {
                          await journal?.exited(
                            (started as { pid: number }).pid,
                          );
                          return { exitCode: error.exitCode };
                        }
                        throw error;
                      },
                    ),
                  })),
                );
              }
              const { started, completion } = await observed;
              // The receipt above observes completion even if abort won the race.
              void completion.catch(() => {});
              let result = started;
              if (isE2BSandbox(sandboxInstance)) {
                // Acquire one handle and wait on that exact process. Never
                // turn a lost stream into another process start.
                execution = started;
                processId = (started as { pid?: number }).pid ?? null;
                if (abortSignal?.aborted) {
                  await (started as { kill?: () => Promise<unknown> }).kill?.();
                  throw new DOMException("Command aborted", "AbortError");
                }
                if (!is_background) {
                  result = await completion;
                }
              }
              return {
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode ?? (is_background ? 0 : null),
                pid: (started as { pid?: number }).pid,
              };
            };

            // A start or wait failure can follow real host side effects on
            // either backend. Only the original handle may be observed;
            // ambiguous failures must never resubmit the command.
            const runPromise = runCommand().catch((error: unknown) => {
              if (error instanceof CommandExitError) throw error;
              throw new CommandOutcomeUnknownError();
            });

            runPromise
              .then(async (exec) => {
                // Retain the E2B handle (including kill), not its result snapshot.
                if (!execution) execution = exec;

                if (is_background && exec.exitCode !== 0) {
                  if (handler) handler.cleanup();
                  if (!resolved) {
                    resolved = true;
                    abortSignal?.removeEventListener("abort", onAbort);
                    resolve({
                      result: withTiming({
                        exitCode: exec.exitCode,
                        output: [exec.stdout, exec.stderr]
                          .filter(Boolean)
                          .join("\n"),
                        error:
                          exec.stderr ||
                          `Background command failed with exit code ${exec.exitCode}.`,
                      }),
                    });
                  }
                  return;
                }

                // Capture PID for background processes
                if (is_background && exec?.pid) {
                  processId = exec.pid;
                }

                if (handler) {
                  handler.cleanup();
                }

                if (!resolved) {
                  resolved = true;
                  abortSignal?.removeEventListener("abort", onAbort);
                  const finalResult = handler
                    ? handler.getResult(processId ?? undefined)
                    : { output: "" };
                  const sandboxOutput = [exec.stdout, exec.stderr]
                    .filter(Boolean)
                    .join("\n");

                  // Track background processes with their output files
                  if (is_background && processId) {
                    const backgroundOutput = `Background process started with PID: ${processId}\n`;
                    await createTerminalWriter(backgroundOutput);

                    const outputFiles =
                      BackgroundProcessTracker.extractOutputFiles(command);
                    backgroundProcessTracker.addProcess(
                      processId,
                      command,
                      outputFiles,
                    );
                  }

                  // Save full output to file when truncated (show path at top so AI sees it first)
                  let outputWithSaveInfo =
                    finalResult.output || sandboxOutput || "";
                  if (!is_background && handler) {
                    const saveMsg = await saveTruncatedOutput({
                      handler,
                      sandbox: sandboxInstance,
                      terminalWriter: createTerminalWriter,
                    });
                    if (saveMsg) {
                      outputWithSaveInfo = saveMsg + "\n" + outputWithSaveInfo;
                    }
                  }

                  resolve({
                    result: is_background
                      ? {
                          pid: processId,
                          output: `Background process started with PID: ${processId ?? "unknown"}\n`,
                        }
                      : withTiming({
                          exitCode: exec.exitCode,
                          ...(exec.exitCode === null
                            ? {
                                outcome: "unknown",
                                error: new CommandOutcomeUnknownError().message,
                              }
                            : {}),
                          output: outputWithSaveInfo,
                          error:
                            exec.exitCode === null
                              ? new CommandOutcomeUnknownError().message
                              : exec.exitCode === -1 && exec.stderr
                                ? exec.stderr
                                : undefined,
                        }),
                  });
                }
              })
              .catch(async (error) => {
                if (handler) {
                  handler.cleanup();
                }
                if (!resolved) {
                  resolved = true;
                  abortSignal?.removeEventListener("abort", onAbort);
                  // Handle CommandExitError as a valid result (non-zero exit code)
                  if (error instanceof CommandExitError) {
                    const finalResult = handler
                      ? handler.getResult(processId ?? undefined)
                      : { output: "" };

                    // Save full output to file when truncated (show path at top so AI sees it first)
                    let outputWithSaveInfo = finalResult.output || "";
                    if (handler) {
                      const saveMsg = await saveTruncatedOutput({
                        handler,
                        sandbox: sandboxInstance,
                        terminalWriter: createTerminalWriter,
                      });
                      if (saveMsg) {
                        outputWithSaveInfo =
                          saveMsg + "\n" + outputWithSaveInfo;
                      }
                    }

                    resolve({
                      result: withTiming({
                        exitCode: error.exitCode,
                        output: outputWithSaveInfo,
                        error: error.message,
                      }),
                    });
                  } else if (error instanceof CommandOutcomeUnknownError) {
                    resolve({
                      result: withTiming({
                        output: handler?.getResult().output ?? "",
                        exitCode: null,
                        pid: processId ?? undefined,
                        outcome: "unknown",
                        error: error.message,
                      }),
                    });
                  } else {
                    reject(error);
                  }
                }
              });
          });
        } // end of executeCommand
      } catch (error) {
        return {
          result: {
            exitCode:
              error instanceof CommandOutcomeUnknownError
                ? null
                : error instanceof CommandExitError
                  ? error.exitCode
                  : 1,
            ...(error instanceof CommandOutcomeUnknownError
              ? { outcome: "unknown" as const }
              : {}),
            output: "",
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
    // UI/persistence retain raw scrollback; only the model receives the projection.
    toModelOutput({ output }) {
      return ptyModelOutput(output);
    },
  });
};
