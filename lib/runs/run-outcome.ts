/**
 * How a finished run is classified, in one place.
 *
 * Why this exists: the worker decided a run's final status with an inline
 * ternary that only knew about "aborted" and "hit the time limit". Every other
 * way a run can stop (the doom-loop detector halting a repeating agent, the
 * usage budget running out, the context window filling) fell through to
 * `completed`, so a run that was cut off mid-task was recorded as a clean
 * success and the person who launched it saw nothing. On top of that, every UI
 * surface that showed a run wrote its own sentence for the same states, so one
 * row said "Finished", another said "Done", and neither said "stopped because
 * the budget ran out".
 *
 * `resolveRunOutcome` is the single classification, evaluated in priority
 * order (a person's Stop always wins; a provider error is never a success; a
 * halted loop is never "completed"). `describeRunOutcome` is the single
 * sentence a stored row gets, so the words match the status everywhere.
 *
 * Pure: no React, no I/O. The worker calls the first; UI rows call the second.
 */

import {
  BUDGET_EXHAUSTION_FINISH_REASON,
  DOOM_LOOP_FINISH_REASON,
  TOKEN_EXHAUSTION_FINISH_REASON,
} from "@/lib/chat/stop-conditions";
import { RUN_STATUS_META, toRunStatus, type RunStatus } from "./run-status";

export interface RunOutcomeInput {
  /** The stream's abort signal fired, for any reason. */
  isAborted: boolean;
  /** A person pressed Stop. Wins over everything else. */
  manuallyAborted: boolean;
  stoppedDueToElapsedTimeout: boolean;
  stoppedDueToDoomLoop: boolean;
  stoppedDueToBudgetExhaustion: boolean;
  stoppedDueToTokenExhaustion: boolean;
  /** The provider returned an error the run could not recover from. */
  terminalProviderError: boolean;
  /** The model's finish reason, when the flags above were not set explicitly. */
  finishReason?: string;
}

export type RunOutcomeStatus = Extract<
  RunStatus,
  "completed" | "completed_with_warnings" | "cancelled" | "failed"
>;

export type RunStopReason =
  | "user"
  | "time_limit"
  | "doom_loop"
  | "budget"
  | "context_limit"
  | "provider_error";

export interface RunOutcome {
  status: RunOutcomeStatus;
  stopReason?: RunStopReason;
  /** One human sentence, safe to show as-is. */
  reasonLine: string;
}

/** The sentence for every stop reason. Shared by both functions below. */
export const RUN_STOP_REASON_LINES: Record<RunStopReason, string> = {
  user: "Stopped by you.",
  provider_error: "The model provider returned an error.",
  doom_loop:
    "Stopped: the agent repeated the same action without making progress.",
  budget: "Stopped: the usage budget for this run was exhausted.",
  time_limit: "Stopped at the run's time limit.",
  context_limit: "Stopped at the context window limit.",
};

export const RUN_FINISHED_LINE = "Finished.";
export const RUN_FAILED_LINE = "Failed.";
export const RUN_RECONCILED_LINE =
  "The worker ended without reporting; closed by reconciliation.";

/** The `stop_reason` the reconciler writes when it closes an orphaned run. */
export const RECONCILED_STOP_REASON = "reconciled";

/** Longest error excerpt a UI row will carry. */
export const MAX_ERROR_LINE_LENGTH = 120;

function withWarnings(stopReason: RunStopReason): RunOutcome {
  return {
    status: "completed_with_warnings",
    stopReason,
    reasonLine: RUN_STOP_REASON_LINES[stopReason],
  };
}

/**
 * Classify a run that has just stopped. Priority order matters: the first
 * matching rule wins, so a person's Stop is never reported as a budget cutoff
 * and a provider error is never reported as a completion.
 */
export function resolveRunOutcome(input: RunOutcomeInput): RunOutcome {
  if (input.manuallyAborted) {
    return {
      status: "cancelled",
      stopReason: "user",
      reasonLine: RUN_STOP_REASON_LINES.user,
    };
  }

  if (input.terminalProviderError) {
    return {
      status: "failed",
      stopReason: "provider_error",
      reasonLine: RUN_STOP_REASON_LINES.provider_error,
    };
  }

  if (
    input.stoppedDueToDoomLoop ||
    input.finishReason === DOOM_LOOP_FINISH_REASON
  ) {
    return withWarnings("doom_loop");
  }

  if (
    input.stoppedDueToBudgetExhaustion ||
    input.finishReason === BUDGET_EXHAUSTION_FINISH_REASON
  ) {
    return withWarnings("budget");
  }

  if (input.stoppedDueToElapsedTimeout) {
    return withWarnings("time_limit");
  }

  if (
    input.stoppedDueToTokenExhaustion ||
    input.finishReason === TOKEN_EXHAUSTION_FINISH_REASON
  ) {
    return withWarnings("context_limit");
  }

  // `isAborted` on its own (no person, no known cause) carries no extra
  // meaning here: the caller derives `manuallyAborted` from it, and an abort
  // triggered by one of the stop conditions is already covered above.
  return { status: "completed", reasonLine: RUN_FINISHED_LINE };
}

function isRunStopReason(value: unknown): value is RunStopReason {
  return typeof value === "string" && value in RUN_STOP_REASON_LINES;
}

function truncateErrorLine(error: string): string {
  const trimmed = error.trim();
  if (trimmed.length <= MAX_ERROR_LINE_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_ERROR_LINE_LENGTH - 1).trimEnd()}…`;
}

/**
 * One human line for a stored run row. Derives everything from what the
 * server recorded; it never guesses at a reason the row does not carry.
 */
export function describeRunOutcome(run: {
  status: string;
  stop_reason?: string;
  finish_reason?: string;
  error?: string;
}): string {
  const status = toRunStatus(run.status);

  if (status === "disconnected" && run.stop_reason === RECONCILED_STOP_REASON) {
    return RUN_RECONCILED_LINE;
  }

  if (status === "cancelled") return RUN_STOP_REASON_LINES.user;

  if (status === "failed") {
    const error = run.error?.trim();
    return error ? truncateErrorLine(error) : RUN_FAILED_LINE;
  }

  if (status === "completed_with_warnings") {
    if (isRunStopReason(run.stop_reason)) {
      return RUN_STOP_REASON_LINES[run.stop_reason];
    }
    // Older rows carry only the finish reason; classify it the same way the
    // worker would have.
    const fromFinish = resolveRunOutcome({
      isAborted: false,
      manuallyAborted: false,
      stoppedDueToElapsedTimeout: false,
      stoppedDueToDoomLoop: false,
      stoppedDueToBudgetExhaustion: false,
      stoppedDueToTokenExhaustion: false,
      terminalProviderError: false,
      finishReason: run.finish_reason,
    });
    return fromFinish.stopReason
      ? fromFinish.reasonLine
      : RUN_STATUS_META[status].label;
  }

  if (status === "completed") return RUN_FINISHED_LINE;

  return RUN_STATUS_META[status].label;
}
