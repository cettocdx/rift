import "server-only";

import { api } from "@/convex/_generated/api";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";

/**
 * Records what a run did, as it happens.
 *
 * A run used to leave behind nothing but the assistant message it produced, so
 * "what did that run actually do" had no answer, and a security finding had no
 * link to the command that proved it. This writes an ordered event log and the
 * evidence those events point at.
 *
 * Every method is best-effort and never throws into the agent's hot path: a run
 * is a record OF the work, not a precondition FOR it. Failures are logged and
 * swallowed, because losing a log line is not worth failing a user's request.
 */

export interface TerminalCommandRecord {
  toolCallId: string;
  command: string;
  exitCode?: number;
  durationMs?: number;
  output?: string;
}

/** One row of the run log. Numbers and names only; never tool text. */
export interface RunEventInput {
  type: string;
  at?: number;
  summary?: string;
  toolName?: string;
  toolCallId?: string;
  severity?: string;
  exitCode?: number;
  durationMs?: number;
  stepIndex?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  costDollars?: number;
  /** "ok" | "error" */
  status?: string;
  inputHash?: string;
  outputBytes?: number;
}

export interface RunRecorder {
  readonly runId: string;
  /** Notes a terminal command so a later finding can point at it. */
  recordTerminalCommand(record: TerminalCommandRecord): void;
  /** The most recent terminal command this run ran, if any. */
  lastTerminalCommand(): TerminalCommandRecord | undefined;
  /** Moves the run to a new in-flight status. Server authoritative. */
  markStatus(status: string, phase?: string): Promise<void>;
  /** Appends one event to the run log, immediately. */
  appendEvent(event: RunEventInput): Promise<void>;
  /**
   * Queues an event for a batched write. For high-volume rows (steps, tool
   * calls); flushed on count, on a short timer, and by `flush()`.
   */
  queueEvent(event: RunEventInput): void;
  /** Writes everything queued. Call before closing the run. */
  flush(): Promise<void>;
  /** Stores a finding and the evidence behind it as one durable record. */
  recordFinding(finding: {
    title: string;
    severity: string;
    target?: string;
    evidence?: string;
    recommendation?: string;
    cvss?: number;
    /** The command this finding was proven by, when one is known. */
    provenByToolCallId?: string;
    provenByCommand?: string;
  }): Promise<void>;
}

/** How many terminal commands to remember for finding attribution. */
const COMMAND_MEMORY = 20;
/** Queued event batching: flush on count or on a short timer. */
const FLUSH_EVENT_COUNT = 25;
const FLUSH_INTERVAL_MS = 2_000;
/** Bound on queued rows per run; a 100-step run is ~100 step + tool rows. */
const MAX_EVENTS_PER_RUN = 300;

function logFailure(event: string, error: unknown, runId: string): void {
  console.warn(
    JSON.stringify({
      level: "warn",
      event,
      service: "run-recorder",
      timestamp: new Date().toISOString(),
      run_id: runId,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

export function createRunRecorder({
  runId,
  chatId,
  userId,
}: {
  runId: string;
  chatId: string;
  userId: string;
}): RunRecorder {
  // The returned recorder may be invoked by lifecycle hooks outside its run.
  // Capture both deployment and authority now, including invalid configuration,
  // so best-effort logging never borrows the next run's connection.
  const serviceKey = getConvexServiceKey() ?? "";
  let client: ReturnType<typeof getConvexClient> | undefined;
  let clientError: unknown;
  try {
    client = getConvexClient();
  } catch (error) {
    clientError = error;
  }
  const getRunClient = () => {
    if (client) return client;
    throw clientError;
  };
  const commands: TerminalCommandRecord[] = [];
  const pending: RunEventInput[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let queuedTotal = 0;
  let capNoted = false;

  return {
    runId,

    recordTerminalCommand(record) {
      commands.push(record);
      if (commands.length > COMMAND_MEMORY) commands.shift();
    },

    lastTerminalCommand() {
      return commands[commands.length - 1];
    },

    async markStatus(status, phase) {
      try {
        await getRunClient().mutation(api.runs.markRunStatus, {
          serviceKey,
          runId,
          status,
          phase,
        });
      } catch (error) {
        logFailure("run_status_mark_failed", error, runId);
      }
    },

    async appendEvent(event) {
      try {
        await getRunClient().mutation(api.runs.appendRunEvent, {
          serviceKey,
          runId,
          chatId,
          userId,
          type: event.type,
          summary: event.summary,
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          severity: event.severity,
          exitCode: event.exitCode,
          durationMs: event.durationMs,
          stepIndex: event.stepIndex,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          reasoningTokens: event.reasoningTokens,
          cacheReadTokens: event.cacheReadTokens,
          costDollars: event.costDollars,
          status: event.status,
          inputHash: event.inputHash,
          outputBytes: event.outputBytes,
        });
      } catch (error) {
        logFailure("run_event_append_failed", error, runId);
      }
    },

    queueEvent(event) {
      // Per-step and per-tool telemetry would otherwise be one mutation per
      // row -- a hundred serial round trips on a long run, all on the hot
      // path. Buffer and batch; the cap keeps a runaway run from producing an
      // unbounded log. After the cap, one row says so and the rest is dropped.
      if (queuedTotal >= MAX_EVENTS_PER_RUN) {
        if (capNoted) return;
        // The marker takes the normal path below so it is flushed by the
        // timer like any other row; an early return here left it stranded in
        // the buffer whenever the cap landed exactly on a count flush.
        capNoted = true;
        pending.push({
          type: "events_capped",
          summary: `run_events capped at ${MAX_EVENTS_PER_RUN}`,
        });
      } else {
        queuedTotal += 1;
        pending.push(event);
      }
      if (pending.length >= FLUSH_EVENT_COUNT) {
        void this.flush();
      } else if (flushTimer === null) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          void this.flush();
        }, FLUSH_INTERVAL_MS);
      }
    },

    async flush() {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (pending.length === 0) return;
      const batch = pending.splice(0, pending.length);
      try {
        await getRunClient().mutation(api.runs.appendRunEvents, {
          serviceKey,
          runId,
          chatId,
          userId,
          events: batch.map((event) => ({
            type: event.type,
            at: event.at,
            summary: event.summary,
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            severity: event.severity,
            exitCode: event.exitCode,
            durationMs: event.durationMs,
            stepIndex: event.stepIndex,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            reasoningTokens: event.reasoningTokens,
            cacheReadTokens: event.cacheReadTokens,
            costDollars: event.costDollars,
            status: event.status,
            inputHash: event.inputHash,
            outputBytes: event.outputBytes,
          })),
        });
      } catch (error) {
        logFailure("run_events_flush_failed", error, runId);
      }
    },

    async recordFinding(finding) {
      // A finding's evidence is the point of the finding. Build it from what is
      // actually known rather than from the model's prose alone: the command
      // that ran, its exit code, and its output are facts the runtime holds.
      const proven = finding.provenByToolCallId
        ? commands.find(
            (entry) => entry.toolCallId === finding.provenByToolCallId,
          )
        : commands[commands.length - 1];

      const sections = [
        `title: ${finding.title}`,
        `severity: ${finding.severity}`,
        ...(finding.target ? [`target: ${finding.target}`] : []),
        ...(typeof finding.cvss === "number" ? [`cvss: ${finding.cvss}`] : []),
        ...(finding.evidence ? [`evidence: ${finding.evidence}`] : []),
        ...(finding.recommendation
          ? [`remediation: ${finding.recommendation}`]
          : []),
      ];

      if (proven) {
        sections.push(
          "",
          `proven-by-command: ${proven.command}`,
          ...(typeof proven.exitCode === "number"
            ? [`proven-by-exit-code: ${proven.exitCode}`]
            : []),
          ...(proven.output
            ? ["", "--- command output ---", proven.output]
            : []),
        );
      }

      try {
        await getRunClient().mutation(api.runs.recordEvidence, {
          serviceKey,
          chatId,
          userId,
          runId,
          toolCallId: proven?.toolCallId,
          kind: "finding",
          content: sections.join("\n"),
          command: proven?.command,
          exitCode: proven?.exitCode,
          durationMs: proven?.durationMs,
          event: {
            type: "finding",
            summary: `[${finding.severity}] ${finding.title}${
              finding.target ? ` @ ${finding.target}` : ""
            }`,
            toolName: "report_finding",
            severity: finding.severity,
          },
        });
      } catch (error) {
        logFailure("run_finding_record_failed", error, runId);
      }
    },
  };
}

/**
 * Opens a run record. Returns a recorder on success and `undefined` when the
 * run could not be opened, so callers stay explicit about the fact that
 * recording is optional.
 */
export async function startRunRecord({
  runId,
  chatId,
  userId,
  mode,
  purpose,
  surface,
  goal,
  model,
  messageId,
}: {
  runId: string;
  chatId: string;
  userId: string;
  mode?: string;
  purpose?: string;
  surface?: string;
  /** What the user asked for, in their words. */
  goal?: string;
  model?: string;
  messageId?: string;
}): Promise<RunRecorder | undefined> {
  try {
    await getConvexClient().mutation(api.runs.startRun, {
      serviceKey: getConvexServiceKey() ?? "",
      runId,
      chatId,
      userId,
      mode,
      purpose,
      surface,
      // A goal is a label, not a transcript. Cap it so a pasted essay cannot
      // bloat every row in the Runs list.
      goal: goal ? goal.slice(0, 300) : undefined,
      model,
      messageId,
    });
  } catch (error) {
    logFailure("run_start_failed", error, runId);
    return undefined;
  }

  return createRunRecorder({ runId, chatId, userId });
}

/** Closes a run record with its outcome. Never throws. */
export async function finishRunRecord({
  runId,
  status,
  stopReason,
  finishReason,
  error,
  messageId,
  costDollars,
  totalTokens,
  outputCount,
  model,
  metrics,
  promptHash,
}: {
  runId: string;
  status: "completed" | "completed_with_warnings" | "cancelled" | "failed";
  stopReason?: string;
  finishReason?: string;
  error?: string;
  messageId?: string;
  costDollars?: number;
  totalTokens?: number;
  outputCount?: number;
  /** The model that actually served the run (fallback legs differ). */
  model?: string;
  /** Aggregate measurements; see lib/telemetry/agent-run-telemetry. */
  metrics?: Record<string, unknown>;
  promptHash?: string;
}): Promise<void> {
  try {
    await getConvexClient().mutation(api.runs.finishRun, {
      serviceKey: getConvexServiceKey() ?? "",
      runId,
      status,
      stopReason,
      finishReason,
      error,
      messageId,
      costDollars,
      totalTokens,
      outputCount,
      model,
      metrics,
      promptHash,
    });
  } catch (caught) {
    logFailure("run_finish_failed", caught, runId);
  }
}
