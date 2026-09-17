/**
 * Per-tool-call instrumentation for the agent tool set.
 *
 * Why this exists: until now nothing in the pipeline accounted for individual
 * tool calls. The wide per-step event knew *which* tools were named by the
 * model, but not how long each one ran, whether it succeeded, or what kind of
 * failure it hit. When a run burned 58 minutes the question "which tool is
 * eating the time?" had no answer short of reading raw sandbox logs. This
 * module wraps every tool's `execute` so each invocation emits one small,
 * fully redacted event: name, duration, ok/error class, output size, and a
 * hash of the input so identical retries can be correlated without ever
 * storing what the model actually asked for.
 *
 * Design constraints that shaped the code below:
 * - The wrapper must be invisible to the tool. It returns exactly what the
 *   original returned (a chained promise for async tools so timing can be
 *   captured, the raw value for sync ones) and rethrows any error unchanged.
 * - The reporter is untrusted. A logging bug must never turn into a tool
 *   failure, so every report call is fenced in its own try/catch.
 * - Events carry no content. Inputs, outputs, and error messages are exactly
 *   the things that leak secrets and user data into telemetry, so the event
 *   only ever holds derived numbers, booleans, and a hash.
 * - Tools in this repo mostly report failure by *returning* an error-shaped
 *   object rather than throwing (see run-terminal-cmd's `{ exitCode, error }`),
 *   so "ok" has to be inferred from the result shape, not just from throws.
 */

import { createHash } from "node:crypto";
import {
  FILE_READ_TRUNCATION_MESSAGE,
  TRUNCATION_MESSAGE,
} from "@/lib/token-utils";

export type ToolErrorClass =
  | "timeout"
  | "exit_nonzero"
  | "not_found"
  | "validation"
  | "sandbox"
  | "aborted"
  | "unconfirmed"
  | "unknown";

export interface ToolCallEvent {
  toolName: string;
  toolCallId?: string;
  durationMs: number;
  ok: boolean;
  errorClass?: ToolErrorClass;
  /** Byte length of the output when it is a string; undefined otherwise. */
  outputBytes?: number;
  /** True when the output string contains the repo's truncation marker. */
  truncated: boolean;
  /** sha256 hex of canonical JSON (sorted keys) of the input; undefined if input is undefined. */
  inputHash?: string;
  startedAt: number;
}

export interface InstrumentToolSetOptions {
  /** Clock used for timing. Injected so tests can drive it deterministically. */
  now?: () => number;
}

/**
 * The subset of the AI SDK's execute options we care about. Kept structural
 * rather than importing the SDK type so this file has no dependency on the
 * `ai` package surface, which shifts between minor versions.
 */
interface ExecuteOptionsLike {
  toolCallId?: string;
  abortSignal?: { aborted?: boolean };
}

type ToolLike = {
  execute?: (input: unknown, options: ExecuteOptionsLike) => unknown;
};

// The markers are matched trimmed because downstream formatting sometimes
// collapses the surrounding blank lines; the bracketed sentence is what
// actually identifies a truncated payload.
const TRUNCATION_MARKERS = [
  TRUNCATION_MESSAGE.trim(),
  FILE_READ_TRUNCATION_MESSAGE.trim(),
].filter((marker) => marker.length > 0);

export function instrumentToolSet<T extends Record<string, any>>(
  tools: T,
  report: (event: ToolCallEvent) => void,
  options?: InstrumentToolSetOptions,
): T {
  const now = options?.now ?? Date.now;
  const instrumented: Record<string, unknown> = { ...tools };

  for (const toolName of Object.keys(tools)) {
    const tool = tools[toolName] as ToolLike | null | undefined;
    if (!tool || typeof tool !== "object") continue;
    const original = tool.execute;
    if (typeof original !== "function") continue;

    const safeReport = (event: ToolCallEvent) => {
      try {
        report(event);
      } catch {
        // A broken reporter is a telemetry problem, never a tool problem.
      }
    };

    const wrappedExecute = (
      input: unknown,
      executeOptions: ExecuteOptionsLike,
    ): unknown => {
      const startedAt = now();
      const inputHash = hashInput(input);
      const toolCallId =
        typeof executeOptions?.toolCallId === "string"
          ? executeOptions.toolCallId
          : undefined;
      const aborted = () => executeOptions?.abortSignal?.aborted === true;

      const finish = (thrown: unknown, output: unknown, threw: boolean) => {
        const durationMs = now() - startedAt;
        const errorShaped = threw || isErrorShapedOutput(output, toolName);
        const event: ToolCallEvent = {
          toolName,
          toolCallId,
          durationMs,
          ok: !errorShaped,
          truncated: threw ? false : isTruncatedOutput(output),
          inputHash,
          startedAt,
        };
        const outputBytes = threw ? undefined : measureOutputBytes(output);
        if (outputBytes !== undefined) event.outputBytes = outputBytes;
        if (errorShaped) {
          event.errorClass = aborted()
            ? "aborted"
            : (classifyToolError(
                threw ? thrown : undefined,
                output,
                toolName,
              ) ?? "unknown");
        }
        safeReport(event);
      };

      let result: unknown;
      try {
        // Call with the original tool as `this` so tools that reach for
        // sibling properties keep working after being spread into a copy.
        result = original.call(tool, input, executeOptions);
      } catch (thrown) {
        finish(thrown, undefined, true);
        throw thrown;
      }

      if (isPromiseLike(result)) {
        return result.then(
          (value) => {
            finish(undefined, value, false);
            return value;
          },
          (thrown: unknown) => {
            finish(thrown, undefined, true);
            throw thrown;
          },
        );
      }

      // Synchronous return (or a streaming async iterable, which we time to
      // its first yield rather than draining it on the tool's behalf).
      finish(undefined, result, false);
      return result;
    };

    instrumented[toolName] = { ...(tool as object), execute: wrappedExecute };
  }

  return instrumented as T;
}

/**
 * Derive a coarse failure class from whatever the tool threw and/or returned.
 * Returns undefined only when there is nothing to classify (no throw and an
 * output with no error signal), so callers can distinguish "not an error"
 * from "an error we could not name".
 *
 * Order matters: the checks run from most specific evidence (an explicit
 * abort) to least (a non-zero exit with no recognisable message), because a
 * timed-out sandbox command also mentions "sandbox" and would otherwise be
 * misfiled under the broader class.
 */
export function classifyToolError(
  thrown: unknown,
  output?: unknown,
  toolName?: string,
): ToolErrorClass | undefined {
  if (thrown === undefined && isUnconfirmedOutput(output, toolName)) {
    return "unconfirmed";
  }
  const thrownName = errorName(thrown);
  const text = [
    thrownName,
    errorMessage(thrown),
    outputErrorText(output, toolName),
  ]
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(" ");
  const exitCode = outputExitCode(output, toolName);
  const hasSignal =
    thrown !== undefined ||
    text !== "" ||
    (exitCode !== undefined && exitCode !== 0) ||
    isErrorShapedOutput(output, toolName);
  if (!hasSignal) return undefined;

  if (thrownName === "AbortError") return "aborted";
  if (
    toolName === "run_terminal_cmd" &&
    (exitCode === 130 || exitCode === 143)
  ) {
    return "aborted";
  }
  if (/timed? ?out|ETIMEDOUT/i.test(text) || thrownName === "TimeoutError") {
    return "timeout";
  }
  if (/ENOENT|not found|no such file/i.test(text)) return "not_found";
  if (
    thrownName === "ZodError" ||
    /invalid|expected|required|validation/i.test(text)
  ) {
    return "validation";
  }
  if (/sandbox|E2B|not running/i.test(text)) return "sandbox";
  if (exitCode !== undefined && exitCode !== 0) return "exit_nonzero";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Inspect only known execution envelopes. Never recursively walk tool content:
// a file or MCP document can itself contain example errors or exit codes.
// ---------------------------------------------------------------------------

function outcomeRecords(
  output: unknown,
  toolName?: string,
): Record<string, unknown>[] {
  if (!isRecord(output)) return [];
  const records = [output];
  if (toolName === "run_terminal_cmd" && isRecord(output.result)) {
    records.push(output.result);
    if (isRecord(output.result.exited)) records.push(output.result.exited);
  }
  return records;
}

function isErrorString(output: string, toolName?: string): boolean {
  return (
    /^error\b/i.test(output) ||
    (toolName?.startsWith("mcp_") === true && /^Tool error:/i.test(output))
  );
}

function isUnconfirmedOutput(output: unknown, toolName?: string): boolean {
  if (!isRecord(output)) return false;
  if (
    toolName?.startsWith("mcp_") &&
    output.code === "mcp_call_unconfirmed" &&
    output.executionStatus === "unconfirmed"
  )
    return true;
  return (
    toolName === "run_terminal_cmd" &&
    isRecord(output.result) &&
    output.result.outcome === "unknown" &&
    output.result.exitCode === null
  );
}

function isErrorShapedOutput(output: unknown, toolName?: string): boolean {
  if (typeof output === "string") return isErrorString(output, toolName);
  if (isUnconfirmedOutput(output, toolName)) return true;
  for (const record of outcomeRecords(output, toolName)) {
    if (typeof record.error === "string" && record.error.length > 0)
      return true;
    if (record.success === false || record.ok === false) return true;
    if (toolName?.startsWith("mcp_") && record.isError === true) return true;
  }
  const exitCode = outputExitCode(output, toolName);
  return exitCode !== undefined && exitCode !== 0;
}

function isTruncatedOutput(output: unknown): boolean {
  if (typeof output === "string") return containsTruncationMarker(output);
  if (!isRecord(output)) return false;
  for (const key of ["output", "result"] as const) {
    const value = output[key];
    if (typeof value === "string" && containsTruncationMarker(value)) {
      return true;
    }
  }
  return false;
}

function containsTruncationMarker(text: string): boolean {
  return TRUNCATION_MARKERS.some((marker) => text.includes(marker));
}

function measureOutputBytes(output: unknown): number | undefined {
  if (typeof output === "string") return Buffer.byteLength(output, "utf8");
  if (!isRecord(output)) return undefined;
  for (const key of ["output", "result", "content"] as const) {
    const value = output[key];
    if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  }
  return undefined;
}

function outputExitCode(
  output: unknown,
  toolName?: string,
): number | undefined {
  for (const record of outcomeRecords(output, toolName)) {
    const code = record.exitCode;
    if (typeof code === "number" && Number.isFinite(code)) return code;
  }
  return undefined;
}

function outputErrorText(
  output: unknown,
  toolName?: string,
): string | undefined {
  if (typeof output === "string") {
    return isErrorString(output, toolName) ? output : undefined;
  }
  for (const record of outcomeRecords(output, toolName)) {
    if (typeof record.error === "string" && record.error.length > 0)
      return record.error;
  }
  return undefined;
}

function errorName(thrown: unknown): string | undefined {
  if (!isRecord(thrown)) return undefined;
  return typeof thrown.name === "string" ? thrown.name : undefined;
}

function errorMessage(thrown: unknown): string | undefined {
  if (typeof thrown === "string") return thrown;
  if (!isRecord(thrown)) return undefined;
  return typeof thrown.message === "string" ? thrown.message : undefined;
}

// ---------------------------------------------------------------------------
// Input hashing. Sorted keys so `{a,b}` and `{b,a}` correlate as the same
// call; any failure (cycles, BigInt, exotic objects) yields undefined rather
// than an exception, because a hash is a nice-to-have and the tool call is not.
// ---------------------------------------------------------------------------

function hashInput(input: unknown): string | undefined {
  if (input === undefined) return undefined;
  try {
    const canonical = JSON.stringify(canonicalize(input, new WeakSet()));
    if (canonical === undefined) return undefined;
    return createHash("sha256").update(canonical, "utf8").digest("hex");
  } catch {
    return undefined;
  }
}

function canonicalize(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) throw new Error("circular");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => canonicalize(item, seen));
    }
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = canonicalize(record[key], seen);
    }
    return sorted;
  } finally {
    // Siblings may legitimately share a reference; only a path back to an
    // ancestor is a cycle, so the entry is removed on the way out.
    seen.delete(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    isRecord(value) && typeof (value as { then?: unknown }).then === "function"
  );
}
