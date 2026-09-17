import { withPlanProgressReminder } from "@/lib/chat/plan-progress-reminder";
import { getProviderContext } from "@/lib/ai/provider-context";
import {
  observeProviderUsage,
  type ProviderPromptSize,
} from "./provider-usage-observer";
import { aggregateStreamUsage } from "./aggregate-stream-usage";
import { activeDiscoveredTools } from "@/lib/ai/mcp/tool-discovery";
import {
  streamHarnessModel,
  prepareHarnessMessages,
} from "@/lib/ai/harness-model";
/**
 * Shared streamText factory for the agent loop.
 *
 * Both the Next.js chat handler and the trigger.dev agent-long task
 * run the same multi-step tool loop. This module owns the single canonical
 * implementation of that loop — prepareStep, stopWhen, onChunk, onStepFinish,
 * streamText.onFinish, onError, onAbort — so divergence is impossible.
 *
 * Callers supply:
 *  - AgentStreamState   a mutable object; the runner reads and writes it in
 *                       place so callers see every update (finalMessages,
 *                       ctxUsage, stop-flags, finish reason, …).
 *  - AgentStreamContext immutable config + stable dependency references.
 */

import {
  convertToModelMessages,
  stepCountIs,
  type LanguageModelUsage,
  type ModelMessage,
  type UIMessage,
  type UIMessageStreamWriter,
  type ToolSet,
} from "ai";
import {
  buildProviderOptions,
  buildSystemPrompt,
  addCacheBreakpointToLastUserMessage,
  applyPrepareStepReminders,
  runSummarizationStep,
  writeContextUsage,
  getFallbackSlugs,
  logOpenRouterFallbackIfFired,
  isXaiSafetyError,
} from "@/lib/api/chat-stream-helpers";
import {
  elapsedTimeExceeds,
  tokenExhaustedAfterSummarization,
  doomLoopDetected,
  PREEMPTIVE_TIMEOUT_FINISH_REASON,
  TOKEN_EXHAUSTION_FINISH_REASON,
  DOOM_LOOP_FINISH_REASON,
  BUDGET_EXHAUSTION_FINISH_REASON,
} from "@/lib/chat/stop-conditions";
import {
  detectDoomLoop,
  generateDoomLoopNudge,
} from "@/lib/chat/doom-loop-detection";
import {
  pruneToolOutputs,
  pruneModelMessages,
} from "@/lib/chat/compaction/prune-tool-outputs";
import { isAnthropicModel } from "@/lib/ai/providers";
import {
  FREE_MAX_OUTPUT_TOKENS,
  PAID_MAX_OUTPUT_TOKENS,
} from "@/lib/rate-limit/free-config";
import { ptySessionManager } from "@/lib/ai/tools/utils/pty-session-manager";
import {
  resolveAgentStepToolChoice,
  stepsRequestWebPreview,
} from "@/lib/api/agent-step-tool-choice";
import {
  getMaxTokensForSubscription,
  getContextCompactionThreshold,
  CONTEXT_INSTRUCTION_RESERVE,
} from "@/lib/token-limits";
import { countMessagesTokens } from "@/lib/token-utils";
import { getMaxStepsForUser } from "@/lib/chat/chat-processor";
import {
  extractOpenRouterMetadata,
  fetchOpenRouterGenerationMetadata,
  mergeOpenRouterMetadata,
} from "@/lib/api/openrouter-metadata";
import type { UsageTracker } from "@/lib/usage-tracker";
import type { BudgetMonitor } from "@/lib/chat/budget-monitor";
import type { UsageRefundTracker } from "@/lib/rate-limit";
import type { SummarizationTracker } from "@/lib/api/chat-stream-helpers";
import type { ChatLogger } from "@/lib/api/chat-logger";
import type { createTrackedProvider } from "@/lib/ai/providers";
import type { ChatMode, ReasoningEffort, SubscriptionTier } from "@/types";

// ---------------------------------------------------------------------------
// Mutable state — the runner updates these in place; callers read them back.
// ---------------------------------------------------------------------------

export type AgentStreamState = {
  /** Current UI messages fed into the model; updated each prepareStep. */
  finalMessages: UIMessage[];
  /** Context-window usage data; updated after summarization and each step. */
  ctxUsage: { usedTokens: number; maxTokens: number };
  lastStepInputTokens: number;
  /** Set in streamText.onFinish; read by the caller's toUIMessageStream.onFinish. */
  streamFinishReason: string | undefined;
  streamUsage: Record<string, unknown> | undefined;
  responseModel: string | undefined;
  /** Original provider/AI SDK error captured from streamText.onError. */
  providerError: unknown;
  /** Stop-condition flags set by the respective onFired callbacks. */
  stoppedDueToTokenExhaustion: boolean;
  /** Maps to stoppedDueToPreemptiveTimeout in chat-handler, stoppedDueToElapsedTimeout in agent-long. */
  stoppedDueToElapsedTimeout: boolean;
  stoppedDueToDoomLoop: boolean;
  stoppedDueToBudgetExhaustion: boolean;
};

export function initAgentStreamState(
  finalMessages: UIMessage[],
  ctxUsage: { usedTokens: number; maxTokens: number },
): AgentStreamState {
  return {
    finalMessages,
    ctxUsage,
    lastStepInputTokens: 0,
    streamFinishReason: undefined,
    streamUsage: undefined,
    responseModel: undefined,
    providerError: undefined,
    stoppedDueToTokenExhaustion: false,
    stoppedDueToElapsedTimeout: false,
    stoppedDueToDoomLoop: false,
    stoppedDueToBudgetExhaustion: false,
  };
}

/** Reset only an admitted fallback's provider bookkeeping, never run stops. */
export function resetAgentProviderAttempt(
  state: AgentStreamState,
  signal: AbortSignal,
): void {
  // A cancellation or failed checkpoint must retain its original evidence.
  signal.throwIfAborted();
  state.providerError = undefined;
  state.lastStepInputTokens = 0;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isImageViewOutput = (output: unknown): boolean => {
  if (!isRecord(output)) return false;

  return (
    output.action === "view" &&
    output.kind === "image" &&
    typeof output.mediaType === "string" &&
    output.mediaType.startsWith("image/")
  );
};

const uiMessagesContainImageViewResult = (messages: UIMessage[]): boolean =>
  messages.some((message) =>
    message.parts?.some((part) => {
      if (!isRecord(part) || part.type !== "tool-file") return false;
      return isImageViewOutput(part.output);
    }),
  );

const toolResultsContainImageViewResult = (toolResults: unknown[]): boolean =>
  toolResults.some((toolResult) => {
    if (!isRecord(toolResult) || toolResult.toolName !== "file") return false;
    return isImageViewOutput(toolResult.output);
  });

// ---------------------------------------------------------------------------
// Immutable context — everything the runner needs besides mutable state.
// ---------------------------------------------------------------------------

export interface AgentStepTelemetry {
  /** 1-based index of the step that just finished. */
  stepIndex: number;
  finishReason: string | undefined;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Dollars this step added, per the usage tracker's own pricing. */
  costDeltaDollars: number;
  /** Cumulative run cost after this step. */
  costTotalDollars: number;
  toolNames: string[];
  /** ms since the previous step finished (prepareStep + network + model). */
  stepGapMs: number;
  /** Fraction of the working context window the last prompt used, 0..1. */
  contextPct: number;
}

export interface AgentPrepareStepTelemetry {
  stepIndex: number;
  /** Awaited durable ownership check, included in durationMs. */
  ownershipWaitMs?: number;
  durationMs: number;
  summarized: boolean;
  loopSeverity: "none" | "warning" | "halt";
  loopToolNames: string[];
}

export interface AgentStreamTelemetry {
  onModelPreparation?: (info: { stage: string; elapsedMs: number }) => void;
  onPromptSize?: (info: ProviderPromptSize) => void;
  /** First chunk of any kind, ms since `streamStartTime`. */
  onFirstChunk?: (info: { firstChunkMs: number }) => void;
  /** First nonempty visible text, distinct from reasoning/tool events. */
  onFirstText?: (info: { firstTextMs: number }) => void;
  onStepFinished?: (info: AgentStepTelemetry) => void;
  onPrepareStep?: (info: AgentPrepareStepTelemetry) => void;
}

export type AgentStreamContext = {
  /** Persist each observed model receipt before forwarding its finish frame. */
  onProviderUsage?: (usage: LanguageModelUsage, model: string) => Promise<void>;
  trackedProvider: ReturnType<typeof createTrackedProvider>;
  currentSystemPrompt: string;
  tools: ToolSet;
  /** Canonical completed history restored from an owner-bound checkpoint. */
  resumeMessages?: ModelMessage[];
  stepIndexOffset?: number;
  /** Awaited before the provider can request any tool side effects. */
  onStepStarted?: (stepIndex: number) => Promise<void>;
  /** Awaited before another provider step; errors stop the loop. */
  onStepCompleted?: (step: {
    initialMessages: ModelMessage[];
    responseMessages: ModelMessage[];
    stepIndex: number;
    finishReason: string;
    modelId?: string;
  }) => Promise<void>;

  /**
   * When set, the model is forced to call this tool on the FIRST step
   * (toolChoice), then released to "auto" for later steps. Used by image mode
   * to guarantee generate_image is actually called instead of the model just
   * describing the image in text.
   */
  forceFirstToolName?: string;
  /**
   * Web-preview lifecycle gate. Once verification/exposure is requested, the
   * agent must complete both. Generic terminal/file tasks do not opt in.
   */
  isAppBuildComplete?: () => boolean;
  /** A rejected/expired action ends the turn before another model request. */
  isApprovalStopped?: () => boolean;
  mode: ChatMode;
  userId: string;
  subscription: SubscriptionTier;
  chatId: string;
  temporary: boolean | undefined;
  fileTokens: Record<string, number>;
  noteInjectionOpts: {
    userId: string;
    subscription: SubscriptionTier;
    shouldIncludeNotes: boolean;
    isTemporary: boolean | undefined;
  };
  systemPromptTokens: number;
  ctxSystemTokens: number;
  ctxMaxTokens: number;
  /** Verified paid/PAYG context entitlement; never derived from request JSON. */
  hasPaidContext?: boolean;
  streamStartTime: number;
  contextUsageOn: boolean;
  isReasoningModel: boolean;
  /** Server-normalized workspace value or authoritative custom-profile value. */
  reasoningEffort?: ReasoningEffort;
  /** elapsedTimeExceeds threshold; callers supply their platform ceiling. */
  maxDurationMs: number;
  /** Absolute lifecycle deadline, including setup; does not change telemetry. */
  requestDeadlineMs?: number;
  /** Opt-in window for one tool-free report at a completed step boundary. */
  reportingReserveMs?: number;

  // Dependencies
  writer: UIMessageStreamWriter;
  abortController: AbortController;
  summarizationTracker: SummarizationTracker;
  usageTracker: UsageTracker;
  /**
   * Structural, not the class: the loop only ever asks one question of it, and
   * tying the type to `BudgetMonitor`'s private fields made it impossible to
   * hand the loop a fake in tests or a per-run ceiling in the eval harness.
   */
  budgetMonitor: Pick<BudgetMonitor, "checkAfterStep"> | null;
  /**
   * Cost accrued outside the model so far -- sandbox time, mostly. The budget
   * check used to see model tokens only, so a 58-minute sandbox bill was
   * invisible to it until the run was over.
   */
  getLiveNonModelCost?: () => number;
  /**
   * Per-step and per-run measurement hooks. Optional, so the two drivers and
   * the tests can opt in independently. Everything reported here is a number,
   * a name or a class -- never prompt text or tool output -- because it fans
   * out to analytics. Before these existed the richest per-run record knew
   * tool NAMES and nothing else: which tool burned the hour, which step blew
   * the context, how long the loop sat between steps -- all unanswerable.
   */
  telemetry?: AgentStreamTelemetry;
  sandboxManager: {
    getSandboxType(toolName: string): string | undefined;
    supportsInteractivePty?(): Promise<boolean>;
  };
  getTodoManager: () => { getAllTodos: () => import("@/types").Todo[] };
  ensureSandbox: import("@/lib/chat/summarization").EnsureSandbox;
  chatLogger: ChatLogger | undefined;
  usageRefundTracker: UsageRefundTracker;

  /**
   * Platform-specific: return a finish-reason string if a hard platform
   * timeout fired synchronously (Vercel: preemptiveTimeout.isPreemptive()),
   * or null when no hard timeout applies (trigger.dev: always null).
   */
  getHardTimeoutReason: () => string | null;
};

// ---------------------------------------------------------------------------
// The shared factory — returns a streamText result (not awaited).
// ---------------------------------------------------------------------------

export async function createAgentStream(
  modelName: string,
  ctx: AgentStreamContext,
  state: AgentStreamState,
) {
  const preparationStartedAt = performance.now();
  const reportPreparation = (stage: string) => {
    try {
      ctx.telemetry?.onModelPreparation?.({
        stage,
        elapsedMs: performance.now() - preparationStartedAt,
      });
    } catch {
      /* Diagnostic only. */
    }
  };
  // SDK finish callbacks may execute after another worker run has started.
  const providerContext = getProviderContext();
  let reportingStarted = false;
  const reportingEnabled =
    ctx.requestDeadlineMs !== undefined &&
    Number.isFinite(ctx.requestDeadlineMs) &&
    (ctx.reportingReserveMs ?? 0) > 0;
  // activeTools controls schemas, but the SDK executes against the full tool
  // set. Also guard executors if a provider ignores toolChoice: none. A proxy
  // preserves lazy MCP discovery adding tools to this request's live set.
  const guardedTools = new WeakMap<object, ToolSet[string]>();
  const streamTools = reportingEnabled
    ? new Proxy(ctx.tools, {
        get(target, key, receiver) {
          const candidate = Reflect.get(target, key, receiver);
          if (!candidate || typeof candidate.execute !== "function")
            return candidate;
          const cached = guardedTools.get(candidate);
          if (!cached) {
            const execute = candidate.execute;
            const guarded: ToolSet[string] = {
              ...candidate,
              execute(input, options) {
                options.abortSignal?.throwIfAborted();
                if (reportingStarted) {
                  throw new Error(
                    "The run is reporting at its time limit. No tool action was started.",
                  );
                }
                return execute.call(candidate, input, options);
              },
            };
            guardedTools.set(candidate, guarded);
            return guarded;
          }
          return cached;
        },
      })
    : ctx.tools;
  const getActiveTools = async (): Promise<
    Array<keyof typeof ctx.tools> | undefined
  > => {
    const discovered = activeDiscoveredTools(ctx.tools);
    // Local capability checks can open a runner connection. Only probe when
    // that capability could change the tools actually offered this step.
    if (
      !(discovered ?? Object.keys(ctx.tools)).includes(
        "interact_terminal_session",
      )
    ) {
      return discovered;
    }
    let supportsPty: boolean | undefined;
    try {
      supportsPty = await ctx.sandboxManager.supportsInteractivePty?.();
    } catch (error) {
      console.warn("[agent-stream] PTY capability probe failed:", error);
      return discovered;
    }
    if (supportsPty !== false) {
      return discovered;
    }

    return (discovered ?? Object.keys(ctx.tools)).filter(
      (toolName) => toolName !== "interact_terminal_session",
    ) as Array<keyof typeof ctx.tools>;
  };
  const initialActiveTools = await getActiveTools();
  reportPreparation("capabilities_ready");
  const requestedLanguageModel = ctx.trackedProvider.languageModel(modelName);
  const requestedSlug = requestedLanguageModel.modelId;
  reportPreparation("model_ready");
  const observedProviderSteps: Array<{ usage: LanguageModelUsage }> = [];
  const observedLanguageModel = observeProviderUsage(
    requestedLanguageModel,
    async (usage) => {
      observedProviderSteps.push({ usage });
      ctx.usageTracker.accumulateStep(usage, modelName);
      // The UI stream's abort callback can run without SDK onFinish. Keep the
      // receipt available before a long-running tool or cancellation can win.
      state.streamUsage = aggregateStreamUsage(observedProviderSteps);
      ctx.chatLogger?.setStreamResponse(undefined, state.streamUsage);
      try {
        await ctx.onProviderUsage?.(usage, modelName);
      } catch (error) {
        state.providerError = error;
        ctx.abortController.abort();
        throw error;
      }
    },
    ctx.telemetry?.onPromptSize,
  );
  const contextOptions = {
    model: modelName,
    mode: ctx.mode,
    hasPaidContext: ctx.hasPaidContext,
  };
  const contextThreshold = getContextCompactionThreshold(
    ctx.subscription,
    contextOptions,
  );
  // Capacity also feeds runtime telemetry when the visible indicator is off.
  ctx.ctxMaxTokens = getMaxTokensForSubscription(
    ctx.subscription,
    contextOptions,
  );
  state.ctxUsage = { ...state.ctxUsage, maxTokens: ctx.ctxMaxTokens };
  const maxOutputTokens =
    ctx.subscription === "free"
      ? FREE_MAX_OUTPUT_TOKENS
      : PAID_MAX_OUTPUT_TOKENS;
  let streamHasImageViewResults = uiMessagesContainImageViewResult(
    state.finalMessages,
  );

  /**
   * The summary that replaced the head of the conversation, and how many raw
   * messages it stood in for.
   *
   * Summarization can only fire once per run (`hasSummarized`), and its result
   * used to be returned for that ONE step: the SDK rebuilds `messages` from its
   * own accumulated history on every later step, so the next step got the full
   * transcript back and the saving evaporated. A 58-minute run therefore
   * summarised once, near the start, and then carried the whole uncompressed
   * history for the remaining fifty-odd steps -- while the flag guaranteed it
   * could never try again.
   *
   * Holding the prefix here keeps the substitution in force for the rest of the
   * run: later steps re-splice it in front of whatever happened since.
   */
  let summarizedPrefix: ModelMessage[] | null = null;
  let summarizedCutIndex = 0;

  // Telemetry bookkeeping. Cheap integers; the hooks receive derived numbers
  // and never the messages themselves.
  let firstChunkReported = false;
  let firstTextReported = false;
  let stepsFinished = 0;
  let lastStepFinishedAt = ctx.streamStartTime;
  let lastCostTotalDollars = 0;
  const reportTelemetry = (fn: () => void) => {
    // A reporter must never be able to break the loop it observes.
    try {
      fn();
    } catch {
      /* swallowed on purpose */
    }
  };
  const getStepProviderOptions = (reasoningEffort = ctx.reasoningEffort) =>
    buildProviderOptions(
      ctx.isReasoningModel,
      ctx.userId,
      modelName,
      ctx.mode,
      {
        hasMultimodalToolResults: streamHasImageViewResults,
        reasoningEffort,
        inputTokens: Math.max(
          state.lastStepInputTokens,
          countMessagesTokens(state.finalMessages, ctx.fileTokens) +
            ctx.systemPromptTokens +
            CONTEXT_INSTRUCTION_RESERVE,
        ),
        subscription: ctx.subscription,
        hasPaidContext: ctx.hasPaidContext,
      },
    );
  const injectedPlanReminders = new Set<string>();
  const prepareProviderMessages = (
    messages: ModelMessage[],
  ): ModelMessage[] => {
    return prepareHarnessMessages(
      ctx.tools.todo_write
        ? withPlanProgressReminder(
            messages,
            ctx.getTodoManager().getAllTodos(),
            injectedPlanReminders,
          )
        : messages,
      isAnthropicModel(modelName),
      (repair) => {
        ctx.chatLogger?.recordAnthropicPromptRepair({
          action: repair.action,
          reason: repair.reason,
          trailingAssistantContentTypes: repair.trailingAssistantContentTypes,
          model: modelName,
        });
      },
    );
  };
  const initialMessages =
    ctx.resumeMessages ?? (await convertToModelMessages(state.finalMessages));
  reportPreparation("messages_ready");
  const stepIndexOffset = ctx.stepIndexOffset ?? 0;
  const resumedTurn =
    ctx.resumeMessages?.slice(
      ctx.resumeMessages.findLastIndex((message) => message.role === "user") +
        1,
    ) ?? [];
  let webPreviewRequested = stepsRequestWebPreview(
    resumedTurn.map((message) => ({
      toolCalls: Array.isArray(message.content)
        ? message.content.filter((part) => part.type === "tool-call")
        : [],
    })),
  );
  const getStepToolChoice = (completedSteps: number) =>
    resolveAgentStepToolChoice({
      forceFirstToolName: ctx.forceFirstToolName,
      completedSteps,
      buildCompletionRequired:
        webPreviewRequested && ctx.isAppBuildComplete?.() === false,
    });
  const initialToolChoice = getStepToolChoice(stepIndexOffset);
  reportPreparation("sdk_entered");
  return streamHarnessModel({
    model: observedLanguageModel,
    maxOutputTokens,
    // The AI SDK default is 2 retries; on top of OpenRouter's own models[]
    // fallback chain that triples tail latency on transient errors. One retry
    // is enough — the provider-level fallback already covers hard failures.
    maxRetries: 1,
    system: buildSystemPrompt(ctx.currentSystemPrompt, modelName),
    // Cache breakpoint on the last user message of the INITIAL step too (not
    // just from prepareStep / step 2 onward). Without it, the first step of
    // turn N re-reads the entire accumulated history (turns 1..N-1) at full
    // price; with it, that history is a ~0.1x cache read. system(1)+tail(1)
    // breakpoints stay within Anthropic's limit of 4.
    messages: prepareProviderMessages(
      addCacheBreakpointToLastUserMessage(
        initialMessages,
        modelName,
      ) as ModelMessage[],
    ),
    tools: streamTools,
    activeTools: initialActiveTools,
    // Force the first tool (e.g. generate_image for image mode) so the model
    // can't just describe the result in text. Released to "auto" after step 1
    // via prepareStep below.
    ...(initialToolChoice ? { toolChoice: initialToolChoice } : {}),
    abortSignal: ctx.abortController.signal,
    providerOptions: getStepProviderOptions(),

    prepareStep: async ({ steps, messages }) => {
      if (steps.length === 0) reportPreparation("first_prepare_entered");
      const prepareStartedAt = Date.now();
      ctx.abortController.signal.throwIfAborted();
      // Outside prepareStep's best-effort context repair: losing durability or
      // ownership must prevent the next request, not silently permit tools.
      await ctx.onStepStarted?.(stepIndexOffset + steps.length + 1);

      const ownershipWaitMs = Date.now() - prepareStartedAt;
      let prepareSummarized = false;
      let prepareLoop: {
        severity: "none" | "warning" | "halt";
        toolNames: string[];
      } = { severity: "none", toolNames: [] };
      const reportPrepare = () =>
        reportTelemetry(() =>
          ctx.telemetry?.onPrepareStep?.({
            stepIndex: steps.length + 1,
            durationMs: Date.now() - prepareStartedAt,
            ownershipWaitMs,
            summarized: prepareSummarized,
            loopSeverity: prepareLoop.severity,
            loopToolNames: prepareLoop.toolNames,
          }),
        );
      webPreviewRequested ||= stepsRequestWebPreview(steps);
      const nextToolChoice = getStepToolChoice(stepIndexOffset + steps.length);
      const toolChoicePatch = nextToolChoice
        ? { toolChoice: nextToolChoice }
        : {};
      const prepareReportingStep = () => {
        ctx.abortController.signal.throwIfAborted();
        // The wall-clock timer may still be queued after slow setup/repair.
        // Do not admit a provider request after the same absolute deadline.
        if (
          ctx.requestDeadlineMs !== undefined &&
          Date.now() >= ctx.requestDeadlineMs
        ) {
          state.stoppedDueToElapsedTimeout = true;
          state.streamFinishReason = "timeout";
          ctx.abortController.abort(
            new DOMException(
              "Request lifecycle budget exceeded",
              "TimeoutError",
            ),
          );
          ctx.abortController.signal.throwIfAborted();
        }
        if (
          !reportingEnabled ||
          ctx.isApprovalStopped?.() ||
          Date.now() < ctx.requestDeadlineMs! - ctx.reportingReserveMs!
        )
          return undefined;

        reportingStarted = true;
        state.stoppedDueToElapsedTimeout = true;
        state.streamFinishReason = PREEMPTIVE_TIMEOUT_FINISH_REASON;
        // Reuse completed evidence and any already-committed summary. Do not
        // spend the reporting window on another compaction or tool discovery.
        const reportingMessages =
          summarizedPrefix && messages.length >= summarizedCutIndex
            ? [...summarizedPrefix, ...messages.slice(summarizedCutIndex)]
            : messages;
        return {
          activeTools: [],
          toolChoice: "none" as const,
          system: buildSystemPrompt(
            `${ctx.currentSystemPrompt}\n<time_limit_reporting>\nThis assessment is stopping at its execution time limit and remains incomplete. Write a concise progress report now, using only evidence already in the conversation. State verified findings, failures, saved artifact paths, and unfinished work. Distinguish observed results from uncertainty, including commands whose completion was not confirmed. Do not call tools, repeat commands, claim all work is complete, or promise that work will continue automatically.\n</time_limit_reporting>`,
            modelName,
          ),
          providerOptions: getStepProviderOptions("low"),
          messages: prepareProviderMessages(reportingMessages),
        };
      };
      const reportingStep = prepareReportingStep();
      if (reportingStep) {
        reportPrepare();
        return reportingStep;
      }
      const prepareWorkStep = async () => {
        try {
          const threshold = contextThreshold;

          const pruneResult = pruneToolOutputs(state.finalMessages);
          if (pruneResult.prunedCount > 0) {
            state.finalMessages = pruneResult.messages;
          }

          const lastStep = Array.isArray(steps) ? steps.at(-1) : undefined;
          const toolResults =
            (lastStep &&
              (lastStep as { toolResults?: unknown[] }).toolResults) ||
            [];
          if (toolResultsContainImageViewResult(toolResults)) {
            streamHasImageViewResults = true;
          }

          if (!ctx.temporary && !ctx.summarizationTracker.hasSummarized) {
            const result = await runSummarizationStep({
              messages: state.finalMessages,
              modelMessages: messages,
              subscription: ctx.subscription,
              languageModel: ctx.trackedProvider.languageModel(modelName),
              mode: ctx.mode,
              writer: ctx.writer,
              chatId: ctx.chatId,
              fileTokens: ctx.fileTokens,
              todos: ctx.getTodoManager().getAllTodos(),
              abortSignal: ctx.abortController.signal,
              ensureSandbox: ctx.ensureSandbox,
              systemPromptTokens: ctx.systemPromptTokens,
              ctxSystemTokens: ctx.ctxSystemTokens,
              ctxMaxTokens: ctx.ctxMaxTokens,
              context: contextOptions,
              providerInputTokens: state.lastStepInputTokens,
              chatSystemPrompt: ctx.currentSystemPrompt,
              tools: ctx.tools,
              providerOptions: getStepProviderOptions(),
            });

            if (result.needsSummarization && result.summarizedMessages) {
              ctx.summarizationTracker.recordSummarization(
                steps.length,
                result.summarizationUsage,
                ctx.usageTracker,
                modelName,
              );
              if (result.contextUsage) {
                state.ctxUsage = result.contextUsage;
              }
              const summarized = await convertToModelMessages(
                result.summarizedMessages,
              );
              // Remember what this replaced, so every later step can replace it
              // again. Without this the reduction lasted exactly one step.
              summarizedPrefix = summarized;
              summarizedCutIndex = messages.length;
              prepareSummarized = true;
              return {
                ...toolChoicePatch,
                activeTools: await getActiveTools(),
                providerOptions: getStepProviderOptions(),
                messages: prepareProviderMessages(
                  addCacheBreakpointToLastUserMessage(
                    summarized,
                    modelName,
                  ) as ModelMessage[],
                ),
              };
            }
          }

          let currentMessages = messages as Array<Record<string, unknown>>;

          // Keep an earlier summary in force. The SDK hands us the full history
          // every step, so without re-splicing, the one summarization a run is
          // allowed would be undone by the very next step.
          //
          // The guard matters: only splice when the incoming history is at least
          // as long as what the summary replaced. A shorter array means this is
          // not the conversation the cut index was measured against, and slicing
          // it would drop real turns.
          if (
            summarizedPrefix &&
            currentMessages.length >= summarizedCutIndex
          ) {
            currentMessages = [
              ...(summarizedPrefix as unknown as Array<
                Record<string, unknown>
              >),
              ...currentMessages.slice(summarizedCutIndex),
            ];
          }

          const modelPrune = pruneModelMessages(currentMessages);
          if (modelPrune.prunedCount > 0) {
            currentMessages = modelPrune.messages;
          }

          let updatedMessages = await applyPrepareStepReminders(
            currentMessages,
            {
              toolResults,
              noteInjectionOpts: ctx.noteInjectionOpts,
            },
          );

          // The SDK's step objects already carry `toolResults`; this cast used to
          // throw them away, which left the detector fingerprinting only the
          // arguments and therefore blind to an agent repeating the same FAILURE
          // with slightly different input every time.
          const loopCheck = detectDoomLoop(
            steps as unknown as Parameters<typeof detectDoomLoop>[0],
          );
          prepareLoop = {
            severity: loopCheck.severity,
            toolNames: loopCheck.toolNames,
          };
          if (loopCheck.severity !== "none") {
            console.log(
              `[doom-loop] severity=${loopCheck.severity} tools=${loopCheck.toolNames.join(",")} count=${loopCheck.consecutiveCount} step=${steps.length}`,
            );
            if (loopCheck.severity === "warning") {
              const nudge = generateDoomLoopNudge(loopCheck);
              console.log("[doom-loop] Injecting nudge as last user message");
              updatedMessages = [
                ...updatedMessages,
                { role: "user", content: nudge },
              ] as typeof updatedMessages;
            }
          }

          return {
            ...toolChoicePatch,
            activeTools: await getActiveTools(),
            providerOptions: getStepProviderOptions(),
            messages: prepareProviderMessages(
              addCacheBreakpointToLastUserMessage(
                updatedMessages,
                modelName,
              ) as ModelMessage[],
            ) as typeof messages,
          };
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            // Expected on user stop
          } else {
            console.error("[agent-stream] prepareStep error:", error);
          }
          return ctx.currentSystemPrompt
            ? {
                ...toolChoicePatch,
                providerOptions: getStepProviderOptions(),
                system: ctx.currentSystemPrompt,
              }
            : toolChoicePatch;
        }
      };
      const prepared = await prepareWorkStep();
      // Every return path (including summary success and repair failure) must
      // recheck after awaits, which may have consumed the remaining work time.
      const finalPrepared = prepareReportingStep() ?? prepared;
      reportPrepare();
      return finalPrepared;
    },

    stopWhen: [
      () => ctx.isApprovalStopped?.() ?? false,
      () => reportingStarted,
      stepCountIs(getMaxStepsForUser(ctx.mode, ctx.subscription)),
      tokenExhaustedAfterSummarization({
        threshold: contextThreshold,
        getLastStepInputTokens: () => state.lastStepInputTokens,
        getHasSummarized: () => ctx.summarizationTracker.hasSummarized,
        onFired: () => {
          state.stoppedDueToTokenExhaustion = true;
        },
      }),
      elapsedTimeExceeds({
        maxDurationMs:
          ctx.requestDeadlineMs !== undefined
            ? ctx.requestDeadlineMs - ctx.streamStartTime
            : ctx.maxDurationMs,
        getStartTime: () => ctx.streamStartTime,
        onFired: () => {
          state.stoppedDueToElapsedTimeout = true;
        },
      }),
      doomLoopDetected({
        onFired: () => {
          state.stoppedDueToDoomLoop = true;
        },
      }),
    ],

    onChunk: async (chunk) => {
      if (!firstChunkReported) {
        firstChunkReported = true;
        reportTelemetry(() =>
          ctx.telemetry?.onFirstChunk?.({
            firstChunkMs: Date.now() - ctx.streamStartTime,
          }),
        );
      }
      if (
        !firstTextReported &&
        chunk.chunk.type === "text-delta" &&
        chunk.chunk.text.trim()
      ) {
        firstTextReported = true;
        reportTelemetry(() =>
          ctx.telemetry?.onFirstText?.({
            firstTextMs: Date.now() - ctx.streamStartTime,
          }),
        );
      }
      if (chunk.chunk.type === "tool-call") {
        ctx.chatLogger?.recordToolCall(
          chunk.chunk.toolName,
          ctx.sandboxManager.getSandboxType(chunk.chunk.toolName),
        );
      }
    },

    onStepFinish: async ({ usage, finishReason, toolCalls, response }) => {
      if (usage) {
        state.lastStepInputTokens = usage.inputTokens || 0;
      }

      stepsFinished += 1;
      try {
        await ctx.onStepCompleted?.({
          initialMessages,
          responseMessages: response.messages,
          stepIndex: stepIndexOffset + stepsFinished,
          finishReason: ctx.isApprovalStopped?.() ? "stop" : finishReason,
          modelId: response.modelId,
        });
      } catch (error) {
        // The SDK treats callback failures as observer errors; an explicit
        // abort is necessary to prevent another tool step after a lost save.
        state.providerError = error;
        ctx.abortController.abort();
        throw error;
      }
      const now = Date.now();
      const costTotal =
        ctx.usageTracker.computeCostDollars(modelName) +
        (ctx.getLiveNonModelCost?.() ?? 0);
      const u = (usage ?? {}) as {
        inputTokens?: number;
        outputTokens?: number;
        inputTokenDetails?: {
          cacheReadTokens?: number;
          cacheWriteTokens?: number;
        };
        outputTokenDetails?: { reasoningTokens?: number };
        reasoningTokens?: number;
        cachedInputTokens?: number;
      };
      reportTelemetry(() =>
        ctx.telemetry?.onStepFinished?.({
          stepIndex: stepsFinished,
          finishReason,
          inputTokens: u.inputTokens ?? 0,
          outputTokens: u.outputTokens ?? 0,
          reasoningTokens:
            u.outputTokenDetails?.reasoningTokens ?? u.reasoningTokens ?? 0,
          cacheReadTokens:
            u.inputTokenDetails?.cacheReadTokens ?? u.cachedInputTokens ?? 0,
          cacheWriteTokens: u.inputTokenDetails?.cacheWriteTokens ?? 0,
          costDeltaDollars: Math.max(0, costTotal - lastCostTotalDollars),
          costTotalDollars: costTotal,
          toolNames: (toolCalls ?? []).map((call) => call.toolName),
          stepGapMs: now - lastStepFinishedAt,
          contextPct:
            ctx.ctxMaxTokens > 0
              ? Math.min(1, (u.inputTokens ?? 0) / ctx.ctxMaxTokens)
              : 0,
        }),
      );
      lastStepFinishedAt = now;
      lastCostTotalDollars = costTotal;

      if (usage) {
        if (ctx.contextUsageOn) {
          writeContextUsage(ctx.writer, {
            usedTokens:
              state.ctxUsage.usedTokens + ctx.usageTracker.streamOutputTokens,
            maxTokens: state.ctxUsage.maxTokens,
          });
        }
      }

      if (ctx.budgetMonitor?.checkAfterStep(costTotal) === "abort") {
        state.stoppedDueToBudgetExhaustion = true;
        ctx.abortController.abort();
      }
    },

    onFinish: async (finishResult) => {
      const { finishReason, response, steps } = finishResult;
      const hardReason = ctx.getHardTimeoutReason();
      if (ctx.isApprovalStopped?.()) {
        // A decision is terminal. Persisting tool-calls would cause the client
        // to start a fresh run, losing the approval latch and retrying it.
        state.streamFinishReason = "stop";
      } else if (hardReason !== null) {
        state.streamFinishReason = hardReason;
      } else if (state.stoppedDueToElapsedTimeout) {
        state.streamFinishReason = PREEMPTIVE_TIMEOUT_FINISH_REASON;
      } else if (state.stoppedDueToTokenExhaustion) {
        state.streamFinishReason = TOKEN_EXHAUSTION_FINISH_REASON;
      } else if (state.stoppedDueToDoomLoop) {
        state.streamFinishReason = DOOM_LOOP_FINISH_REASON;
      } else if (state.stoppedDueToBudgetExhaustion) {
        state.streamFinishReason = BUDGET_EXHAUSTION_FINISH_REASON;
      } else {
        state.streamFinishReason = finishReason;
      }
      // Provider receipts also include a finished response whose tool was
      // interrupted. Completed SDK steps alone omit that real model spend.
      state.streamUsage = aggregateStreamUsage(
        observedProviderSteps.length ? observedProviderSteps : steps,
      );
      state.responseModel = response?.modelId;

      const finishMetadata = finishResult as {
        providerMetadata?: unknown;
        steps?: Array<{ providerMetadata?: unknown }>;
      };
      const stepProviderMetadata = Array.isArray(finishMetadata.steps)
        ? finishMetadata.steps.at(-1)?.providerMetadata
        : undefined;
      const finishOpenRouterMetadata = extractOpenRouterMetadata({
        response,
        providerMetadata: finishMetadata.providerMetadata,
      });
      const stepOpenRouterMetadata = extractOpenRouterMetadata({
        providerMetadata: stepProviderMetadata,
      });
      let openRouterMetadata = mergeOpenRouterMetadata(
        finishOpenRouterMetadata,
        stepOpenRouterMetadata,
      );
      if (
        ctx.chatLogger &&
        !openRouterMetadata.provider_name &&
        openRouterMetadata.openrouter_generation_id
      ) {
        openRouterMetadata = mergeOpenRouterMetadata(
          openRouterMetadata,
          await fetchOpenRouterGenerationMetadata(
            openRouterMetadata.openrouter_generation_id,
            { apiKey: providerContext.openrouterApiKey ?? "" },
          ),
        );
      }

      const fallbackSlugs = getFallbackSlugs(modelName, ctx.mode, {
        hasMultimodalToolResults: streamHasImageViewResults,
        reasoningEffort: ctx.reasoningEffort,
      });
      logOpenRouterFallbackIfFired({
        fallbackSlugs,
        requestedSlug,
        responseModel: state.responseModel,
        chatId: ctx.chatId,
      });
      if (state.responseModel && fallbackSlugs.includes(state.responseModel)) {
        ctx.chatLogger?.recordModelFallback({
          requested: requestedSlug,
          served: state.responseModel,
          chain: fallbackSlugs,
          model: modelName,
        });
      }
      ctx.chatLogger?.setStreamResponse(
        state.responseModel,
        state.streamUsage,
        openRouterMetadata,
      );

      await ptySessionManager
        .closeAll(ctx.chatId)
        .catch((err) =>
          console.error("[agent-stream] PTY closeAll (onFinish) failed:", err),
        );
    },

    onError: async ({ error }) => {
      state.providerError = error;
      if (!isXaiSafetyError(error)) {
        const fallbackSlugs = getFallbackSlugs(modelName, ctx.mode, {
          hasMultimodalToolResults: streamHasImageViewResults,
          reasoningEffort: ctx.reasoningEffort,
        });
        ctx.chatLogger?.recordProviderError(error, {
          mode: ctx.mode,
          model: modelName,
          requestedModelSlug: requestedSlug,
          fallbackModelSlugs:
            fallbackSlugs.length > 0 ? fallbackSlugs : undefined,
          userId: ctx.userId,
          subscription: ctx.subscription,
          isTemporary: ctx.temporary,
        });
      }
      if (!ctx.usageTracker.hasUsage) {
        await ctx.usageRefundTracker.refund();
      }
      await ptySessionManager
        .closeAll(ctx.chatId)
        .catch((err) =>
          console.error("[agent-stream] PTY closeAll (onError) failed:", err),
        );
    },

    onAbort: async () => {
      await ptySessionManager
        .closeAll(ctx.chatId)
        .catch((err) =>
          console.error("[agent-stream] PTY closeAll (onAbort) failed:", err),
        );
    },
  });
}
