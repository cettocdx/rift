import type {
  AgentPrepareStepTelemetry,
  AgentStepTelemetry,
  AgentStreamTelemetry,
} from "@/lib/api/agent-stream-runner";
import type { ToolCallEvent } from "@/lib/ai/tools/utils/instrument-tools";

/**
 * Per-run measurement, in one place.
 *
 * Before this existed the richest record of a run was a console.log line
 * that knew tool NAMES and a total token count. "Which tool burned the
 * hour", "which step blew the context", "how long did the loop sit between
 * steps", "does this model ever hit the prompt cache" -- none of it could be
 * answered after the fact, so tuning the harness meant guessing.
 *
 * This accumulates what the runner's hooks report and fans it out twice: a
 * discrete event per step and per tool call (for dashboards that want
 * distributions), and one aggregate at the end (for the run's own record).
 * Everything here is a number, a name or a class. Never prompt text, never
 * tool input or output -- these events leave the box.
 */

export interface ToolStat {
  calls: number;
  errors: number;
  unconfirmed: number;
  /** Sorted lazily when a percentile is asked for. */
  durationsMs: number[];
}

export interface AgentRunMetrics {
  steps: number;
  tool_calls: number;
  tool_errors: number;
  /** Calls whose effects could not be confirmed; never counted as success or a known failure. */
  tool_unconfirmed?: number;
  loop_warnings: number;
  loop_halts: number;
  summarizations: number;
  first_chunk_ms?: number;
  prepare_p95_ms?: number;
  step_gap_p95_ms?: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  /** cache_read / input over steps >= 3, where caching can have kicked in. */
  cache_hit_ratio?: number;
  cost_dollars: number;
  max_context_pct: number;
  /** Per tool: calls, errors, p95 duration. Capped so the record stays small. */
  tools: Record<
    string,
    { calls: number; errors: number; unconfirmed?: number; p95_ms?: number }
  >;
}

export interface AgentRunTelemetryEmitter {
  /** A discrete analytics event. Wired to PostHog in production. */
  event: (name: string, fields: Record<string, unknown>) => void;
}

export interface AgentRunTelemetryOptions {
  runId: string;
  chatId: string;
  userId: string;
  model: string;
  endpoint: "/api/chat" | "/api/agent-long" | "/api/hack-long";
  emitter?: AgentRunTelemetryEmitter;
  /** How many distinct tools to keep in the aggregate. */
  maxTools?: number;
}

const DEFAULT_MAX_TOOLS = 30;

function percentile(sorted: number[], p: number): number | undefined {
  if (sorted.length === 0) return undefined;
  // Nearest-rank: no interpolation, so a single sample is its own p95.
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

export interface AgentRunTelemetry {
  /** Hooks for AgentStreamContext.telemetry. */
  hooks: AgentStreamTelemetry;
  /** Reporter for instrumentToolSet. */
  onToolCall: (event: ToolCallEvent) => void;
  /** The aggregate so far. Safe to call at any time, including after abort. */
  snapshot: () => AgentRunMetrics;
}

export function createAgentRunTelemetry(
  options: AgentRunTelemetryOptions,
): AgentRunTelemetry {
  const maxTools = options.maxTools ?? DEFAULT_MAX_TOOLS;
  const base = {
    run_id: options.runId,
    chat_id: options.chatId,
    userId: options.userId,
    model: options.model,
    endpoint: options.endpoint,
  };
  const emit = (name: string, fields: Record<string, unknown>) => {
    // A broken emitter must never break the run it is measuring.
    try {
      options.emitter?.event(name, { ...base, ...fields });
    } catch {
      /* swallowed on purpose */
    }
  };

  let steps = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let toolUnconfirmed = 0;
  let loopWarnings = 0;
  let loopHalts = 0;
  let summarizations = 0;
  let firstChunkMs: number | undefined;
  const prepareDurations: number[] = [];
  const stepGaps: number[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cacheableInput = 0;
  let cacheableRead = 0;
  let costDollars = 0;
  let maxContextPct = 0;
  const tools = new Map<string, ToolStat>();
  // Loop severities are reported every prepareStep while they hold; count a
  // warning or halt once per episode, not once per step it persists.
  let lastLoopSeverity: AgentPrepareStepTelemetry["loopSeverity"] = "none";

  let providerRequestIndex = 0;
  const hooks: AgentStreamTelemetry = {
    onFirstChunk: ({ firstChunkMs: ms }) => {
      firstChunkMs = ms;
      emit("rift-agent_first_chunk", { first_chunk_ms: ms });
    },
    onPromptSize: (info) =>
      emit("rift-agent_prompt_size", {
        provider_request_index: ++providerRequestIndex,
        ...info,
        measurement: "serialized_characters_not_tokens",
      }),
    onPrepareStep: (info) => {
      prepareDurations.push(info.durationMs);
      if (info.summarized) {
        summarizations += 1;
        emit("rift-agent_summarization", {
          step_index: info.stepIndex,
          prepare_ms: info.durationMs,
        });
      }
      if (
        info.loopSeverity !== "none" &&
        info.loopSeverity !== lastLoopSeverity
      ) {
        if (info.loopSeverity === "warning") loopWarnings += 1;
        if (info.loopSeverity === "halt") loopHalts += 1;
        emit("rift-agent_loop", {
          step_index: info.stepIndex,
          severity: info.loopSeverity,
          tool_names: info.loopToolNames,
        });
      }
      lastLoopSeverity = info.loopSeverity;
    },
    onStepFinished: (info: AgentStepTelemetry) => {
      steps = info.stepIndex;
      inputTokens += info.inputTokens;
      outputTokens += info.outputTokens;
      reasoningTokens += info.reasoningTokens;
      cacheRead += info.cacheReadTokens;
      cacheWrite += info.cacheWriteTokens;
      if (info.stepIndex >= 3) {
        cacheableInput += info.inputTokens;
        cacheableRead += info.cacheReadTokens;
      }
      costDollars = info.costTotalDollars;
      maxContextPct = Math.max(maxContextPct, info.contextPct);
      stepGaps.push(info.stepGapMs);
      emit("rift-agent_step", {
        step_index: info.stepIndex,
        finish_reason: info.finishReason,
        input_tokens: info.inputTokens,
        output_tokens: info.outputTokens,
        reasoning_tokens: info.reasoningTokens,
        cache_read_tokens: info.cacheReadTokens,
        cache_write_tokens: info.cacheWriteTokens,
        cost_delta_dollars: info.costDeltaDollars,
        cost_total_dollars: info.costTotalDollars,
        tool_names: info.toolNames,
        step_gap_ms: info.stepGapMs,
        context_pct: info.contextPct,
      });
    },
  };

  const onToolCall = (event: ToolCallEvent) => {
    toolCalls += 1;
    const unconfirmed = event.errorClass === "unconfirmed";
    const failed = !event.ok && !unconfirmed;
    if (failed) toolErrors += 1;
    if (unconfirmed) toolUnconfirmed += 1;
    let stat = tools.get(event.toolName);
    if (!stat) {
      if (tools.size >= maxTools) {
        stat = tools.get("__other__") ?? {
          calls: 0,
          errors: 0,
          unconfirmed: 0,
          durationsMs: [],
        };
        tools.set("__other__", stat);
      } else {
        stat = { calls: 0, errors: 0, unconfirmed: 0, durationsMs: [] };
        tools.set(event.toolName, stat);
      }
    }
    stat.calls += 1;
    if (failed) stat.errors += 1;
    if (unconfirmed) stat.unconfirmed += 1;
    stat.durationsMs.push(event.durationMs);
    emit("rift-agent_tool_call", {
      tool_name: event.toolName,
      tool_call_id: event.toolCallId,
      duration_ms: event.durationMs,
      ok: event.ok,
      error_class: event.errorClass,
      output_bytes: event.outputBytes,
      truncated: event.truncated,
      input_hash: event.inputHash,
    });
  };

  const snapshot = (): AgentRunMetrics => {
    const toolsOut: AgentRunMetrics["tools"] = {};
    for (const [name, stat] of tools) {
      const sorted = [...stat.durationsMs].sort((a, b) => a - b);
      toolsOut[name] = {
        calls: stat.calls,
        errors: stat.errors,
        unconfirmed: stat.unconfirmed,
        p95_ms: percentile(sorted, 95),
      };
    }
    return {
      steps,
      tool_calls: toolCalls,
      tool_errors: toolErrors,
      tool_unconfirmed: toolUnconfirmed,
      loop_warnings: loopWarnings,
      loop_halts: loopHalts,
      summarizations,
      first_chunk_ms: firstChunkMs,
      prepare_p95_ms: percentile(
        [...prepareDurations].sort((a, b) => a - b),
        95,
      ),
      step_gap_p95_ms: percentile(
        [...stepGaps].sort((a, b) => a - b),
        95,
      ),
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      reasoning_tokens: reasoningTokens,
      cache_read_tokens: cacheRead,
      cache_write_tokens: cacheWrite,
      cache_hit_ratio:
        cacheableInput > 0 ? cacheableRead / cacheableInput : undefined,
      cost_dollars: costDollars,
      max_context_pct: maxContextPct,
      tools: toolsOut,
    };
  };

  return { hooks, onToolCall, snapshot };
}

/**
 * The aggregate as a plain record, for sinks typed on `Record<string, unknown>`
 * (the run row's `metrics`, the wide event). The interface has no index
 * signature on purpose -- it documents the fields -- so the widening lives in
 * exactly one place instead of as a cast at every call site.
 */
export function toMetricsRecord(
  metrics: AgentRunMetrics,
): Record<string, unknown> {
  return { ...metrics } as unknown as Record<string, unknown>;
}
