import {
  markWorkerModuleReady,
  readWorkerModuleTiming,
} from "@/lib/agent/worker-module-timing";
import { settleExecutionDrain } from "@/lib/agent/settle-execution-drain";
import { isStandaloneTextTurn } from "@/lib/api/standalone-text-turn";
import {
  withRemoteCommandJournal,
  bindRemoteCommandJournal,
} from "@/lib/agent/remote-command-journal";
import { settleWithJournal } from "@/lib/api/usage-settlement-journal";
import {
  requireRemoteRunCleanup,
  confirmRemoteRunCleanup,
} from "@/lib/api/agent-run-claims";
import { persistProviderUsage } from "@/lib/api/provider-usage-journal";
import {
  withHackWorkerEntry,
  type HackWorkerLifecycle,
} from "@/lib/hack/worker-entry";
import { createDurableHackExecutionDrain } from "@/lib/hack/durable-execution-drain";
import { recordHackRunCleanup } from "@/lib/hack/durable-cleanup";
import {
  resolveHackRunFinalization,
  readHackCancellationEvidence,
} from "@/lib/hack/durable-finalization";
import {
  authorizeHackWorkerRun,
  hashHackRunPayload,
  resolveHackWorkerConvexUrl,
} from "@/lib/hack/durable-run";
import {
  assertHackRunContext,
  appendHackRunSystemContext,
  assertHackExecutionAccess,
  createHackCheckpointBarrier,
} from "@/lib/hack/durable-execution";
import { api as billingApi } from "@/convex/_generated/api";
import { RETAIL_MARGIN } from "@/lib/billing/account-pricing";
import { recordAgentDispatchAccepted } from "@/lib/api/agent-dispatch-admission";
import {
  createStartupPhaseTimer,
  type StartupPhaseSpan,
} from "@/lib/agent/startup-phase-timer";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";
import {
  withConvexClientScope,
  bindConvexClientScope,
} from "@/lib/db/convex-client-scope";
import { watchClaimCancellation } from "@/lib/agent/cooperative-stop";
import { runTrackedPreflight } from "@/lib/rate-limit/preflight";
import { captureWorkerStartupTiming } from "@/lib/agent/worker-startup-timing";
import { withWorkerCrashMonitor } from "@/lib/agent/worker-crash-monitor";
import {
  AgentRunCanceledError,
  createWorkerClaimCancellation,
  createPreModelClaimStopFinalizer,
} from "@/lib/agent/claim-cancellation";
import { describeRunFailure } from "@/lib/chat/run-failure";
import { isStandaloneGreetingTurn } from "@/lib/api/standalone-greeting";
import { prepareTurnSandbox } from "@/lib/api/prepare-turn-sandbox";
import { getModerationResult } from "@/lib/moderation";
import {
  prepareWorkerUsage,
  prepareWorkerIntegrations,
} from "@/lib/api/agent-worker-preparation";
import {
  parseWorkingFileContext,
  appendWorkingFileSystemContext,
  serializeWorkingFileBoundRequest,
  type WorkingFileContext,
} from "@/lib/desktop/working-file-context";
import { projectCheckpointAssistantMessage } from "@/lib/agent/checkpoint-ui";
import { linkAgentAbortSignal } from "@/lib/agent/linked-abort";
import { createHash } from "node:crypto";
import {
  beginAgentCheckpointRun,
  markAgentCheckpointStep,
  markAgentCheckpointExecution,
  saveAgentCheckpoint,
  disableAgentCheckpointRun,
  finishAgentCheckpointRun,
} from "@/lib/api/agent-checkpoints";
import {
  createCompletedStepCheckpoint,
  restoreCompletedStepCheckpoint,
  AgentCheckpointTooLargeError,
} from "@/lib/agent/checkpoint";
import {
  getAgentRunClaim,
  startClaimedAgentRunForWorker,
  assertAgentRunExecutionCurrent,
  releaseAgentRunClaim,
} from "@/lib/api/agent-run-claims";
import { parseApprovalMode, type ApprovalMode } from "@/lib/ai/approval/policy";
import { createToolApprovalGate } from "@/lib/ai/approval/server";
import {
  task,
  timeout,
  tags,
  metadata,
  retry,
  logger as triggerLogger,
} from "@trigger.dev/sdk";
import type {
  TaskFailureHookParams,
  TaskRunContext,
} from "@trigger.dev/core/v3";
import { agentUiStream } from "./streams";
import { settleAgentUiStream } from "@/lib/chat/settle-agent-ui-stream";
import {
  createUIMessageStream,
  generateId,
  type UIMessageStreamWriter,
  UIMessage,
} from "ai";
import type { Geo } from "@vercel/functions";
import { countTokens } from "gpt-tokenizer";
import PostHogClient from "@/app/posthog";

import { systemPrompt } from "@/lib/system-prompt";
import { getResumeSection } from "@/lib/system-prompt/resume";
import { resolveAgentAutoContinueReason } from "@/lib/chat/auto-continue-policy";
import { createTools } from "@/lib/ai/tools";
import { extractLatestUserRequest } from "@/lib/ai/tools/find-skills";
import { loadUserMcpTools } from "@/lib/ai/mcp/load-user-mcp-tools";
import { agentWorkerIncomingMessages } from "@/lib/api/agent-worker-messages";
import { ensureRunTags } from "@/lib/agent/run-tags";
import { createCheckpointToolBarrier } from "@/lib/agent/checkpoint-tool-barrier";
import { loadUserGithubToken } from "@/lib/github/load-user-github-token";
import { prepareCloudProjectRepository } from "@/lib/github/prepare-project-repository";
import {
  injectSkillsIntoMessages,
  loadEnabledSkillsForRuntime,
} from "@/lib/ai/skills/inject-skills";
import { ptySessionManager } from "@/lib/ai/tools/utils/pty-session-manager";
import { generateTitleFromUserMessageWithWriter } from "@/lib/actions";
import { createTrackedProvider } from "@/lib/ai/providers";
import {
  processChatMessages,
  selectModel,
  getMaxStepsForUser,
} from "@/lib/chat/chat-processor";
import { summarizeIncompleteToolParts } from "@/lib/chat/tool-abort-utils";
import {
  sendRateLimitWarnings,
  SummarizationTracker,
  appendSystemReminderToLastUserMessage,
  estimatePreflightInputTokens,
  buildExtraUsageConfig,
  computeContextUsage,
  writeContextUsage,
  isContextUsageEnabled,
  isProviderApiError,
  injectNotesIntoMessages,
  getRetryFallbackModel,
} from "@/lib/api/chat-stream-helpers";
import {
  BudgetMonitor,
  captureBudgetSnapshot,
} from "@/lib/chat/budget-monitor";
import { UsageTracker } from "@/lib/usage-tracker";
import { getExtraUsageBalance } from "@/lib/extra-usage";
import {
  acquireFreeRunConcurrencyLock,
  checkFreeMonthlyCostLimit,
  checkRateLimit,
  deductUsage,
  deductBalanceUsage,
  recordFreeMonthlyCost,
  UsageRefundTracker,
} from "@/lib/rate-limit";
import { assertUserCanMakeCostIncurringRequest } from "@/lib/suspensions";
import {
  saveMessage,
  updateChat,
  getUserCustomization,
  setActiveTriggerRun,
  getMessagesByChatId,
  prepareForNewStream,
  getCancellationStatus,
} from "@/lib/db/actions";
import { getMaxTokensForSubscription } from "@/lib/token-utils";
import { getBaseTodosForRequest } from "@/lib/utils/todo-utils";
import {
  writeAutoContinue,
  writeUploadStartStatus,
  writeUploadCompleteStatus,
} from "@/lib/utils/stream-writer-utils";
import {
  uploadSandboxFiles,
  getUploadBasePath,
  rewriteSandboxFilePathsInMessages,
} from "@/lib/utils/sandbox-file-utils";
import { getEmptyProcessedMessagesCause } from "@/lib/utils/local-attachment-messages";
import { startRunRecord, finishRunRecord } from "@/lib/ai/runs/run-recorder";
import {
  captureAgentCompletionAnalytics,
  captureToolCalls,
  captureUsageCost,
  createChatLogger,
  type ChatLogger,
} from "@/lib/api/chat-logger";
import { phLogger } from "@/lib/posthog/server";
import {
  createAgentRunTelemetry,
  toMetricsRecord,
} from "@/lib/telemetry/agent-run-telemetry";
import { resolveRunOutcome } from "@/lib/runs/run-outcome";
import { resolveRunCostCeiling } from "@/lib/chat/run-cost-ceiling";
import {
  buildRunFailureAlert,
  postOpsAlert,
  shouldAlertOnFailure,
} from "@/lib/ops/alerts";
import {
  extractErrorDetails,
  getProviderErrorCategory,
  getUserFriendlyProviderError,
} from "@/lib/utils/error-utils";
import { ChatSDKError } from "@/lib/errors";
import { assertHackWorkbenchPurposeRoute } from "@/lib/auth/premium-access";
import {
  authorizeScheduledAgentRun,
  finishScheduledRun,
} from "@/lib/tasks/scheduled-task-backend";
import type { Id } from "@/convex/_generated/dataModel";
import type {
  SubscriptionTier,
  Todo,
  SandboxPreference,
  SelectedModel,
  ChatPurpose,
  RateLimitInfo,
  ReasoningEffort,
} from "@/types";
import {
  coerceSelectedModel,
  resolveBuildReasoningEffort,
  resolveImageModel,
  resolveVideoModel,
} from "@/types";
import {
  createAgentStream,
  initAgentStreamState,
  type AgentStreamContext,
  type AgentStreamState,
} from "@/lib/api/agent-stream-runner";
import { resolveForcedFirstToolName } from "@/lib/api/agent-step-tool-choice";
import {
  AGENT_LONG_HEARTBEAT_PART_TYPE,
  stripAgentLongHeartbeatParts,
  withAgentLongStreamHeartbeat,
} from "@/lib/chat/agent-long-heartbeat";
import { FREE_AGENT_LONG_RUN_LOCK_TTL_SECONDS } from "@/lib/rate-limit/free-config";
import { resolveChatSandboxNamespace } from "@/lib/projects/project-runtime";
import { isE2BSandbox } from "@/lib/ai/tools/utils/sandbox-types";
import {
  resolveProjectRuntimeContext,
  projectGithubRepositoryReminder,
} from "@/lib/projects/project-runtime";
import {
  appendActiveGoalSystemContext,
  type ModelActiveGoal,
} from "@/lib/api/active-goal-context";
import { extractLatestUserImageReferenceUrls } from "@/lib/ai/media-references";
import { resolveMediaRequest } from "@/lib/ai/media-intent";
import {
  extractAgentRuntimeRequest,
  renderActiveAgentWorkflowReminder,
  resolveAgentRuntimePolicy,
  resolveActiveAgentModelSelection,
} from "@/lib/ai/agents/runtime-policy";

// Durable runs outlive observers; user cancellation and budget checks still apply.
const AGENT_LONG_MAX_DURATION_MS = Number.POSITIVE_INFINITY;

type AgentLongUiStreamPart = Parameters<UIMessageStreamWriter["write"]>[0];

const drainPipedTriggerMirror = async (
  stream: ReadableStream<unknown>,
): Promise<void> => {
  const reader = stream.getReader();
  try {
    while (!(await reader.read()).done) {
      // Trigger.dev tees the source into its upload branch and this mirror.
      // Draining keeps the mirror alive and under backpressure until upload
      // completion instead of leaving its async controller orphaned.
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A terminal stream may already have released its reader.
    }
  }
};

const MAX_TRIGGER_ERROR_MESSAGE_LENGTH = 500;

const truncateForTriggerMetadata = (value: string) =>
  value.length > MAX_TRIGGER_ERROR_MESSAGE_LENGTH
    ? `${value.slice(0, MAX_TRIGGER_ERROR_MESSAGE_LENGTH)}...`
    : value;

const sanitizeTriggerTagValue = (value: string) =>
  value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);

const getStringMetadata = (
  metadata: Record<string, unknown> | undefined,
  key: string,
) => {
  const value = metadata?.[key];
  return typeof value === "string" ? value : undefined;
};

const getNumberMetadata = (
  metadata: Record<string, unknown> | undefined,
  key: string,
) => {
  const value = metadata?.[key];
  return typeof value === "number" ? value : undefined;
};

const OPERATIONAL_RATE_LIMIT_CAUSE_PATTERNS = [
  /rate limiting service .*not configured/i,
  /rate limiting service unavailable/i,
  /extra usage billing is temporarily unavailable/i,
];

type AgentLongErrorSummary = {
  category: string;
  code?: string;
  name: string;
  message: string;
  cause?: string;
  loginRequired: boolean;
  statusCode?: number;
  dbOperation?: string;
  dbErrorName?: string;
  dbErrorMessage?: string;
  partsSizeKb?: number;
  partCount?: number;
  largestPartType?: string;
  largestPartSizeKb?: number;
  toolPartCount?: number;
  dataPartCount?: number;
  reasoningChars?: number;
  emptyPrompt?: boolean;
  truncationDroppedAllMessages?: boolean;
  existingMessagesCount?: number;
  newMessagesCount?: number;
  allMessagesCount?: number;
  totalTokensBefore?: number;
  maxTokens?: number;
  fileIdsCount?: number;
  largestFileToken?: number;
};

const isHandledUserRateLimitError = (error: unknown): error is ChatSDKError => {
  if (!(error instanceof ChatSDKError)) return false;
  if (error.type !== "rate_limit" || error.surface !== "chat") return false;

  const cause = typeof error.cause === "string" ? error.cause : error.message;
  return !OPERATIONAL_RATE_LIMIT_CAUSE_PATTERNS.some((pattern) =>
    pattern.test(cause),
  );
};

const isChatNotFoundError = (error: ChatSDKError): boolean => {
  if (error.type === "not_found" && error.surface === "chat") return true;
  return (
    getStringMetadata(error.metadata, "db_error_code") === "CHAT_NOT_FOUND"
  );
};

const classifyProviderDashboardCategory = (
  error: unknown,
  details: Record<string, unknown>,
): string => {
  const category = getProviderErrorCategory(details);
  if (category === "provider_credits_exhausted") {
    return "provider_credits_exhausted";
  }
  if (category === "stream_terminated") return "provider_stream_terminated";
  if (category === "timeout") return "provider_timeout";
  if (category !== "unknown" || isProviderApiError(error)) {
    return "provider_error";
  }
  return "unexpected_error";
};

const classifyAgentLongError = (error: unknown): AgentLongErrorSummary => {
  const details = extractErrorDetails(error);
  const errorMessage = truncateForTriggerMetadata(
    typeof details.errorMessage === "string"
      ? details.errorMessage
      : "Unknown error occurred",
  );

  if (error instanceof ChatSDKError) {
    const code = `${error.type}:${error.surface}`;
    const cause =
      typeof error.cause === "string"
        ? truncateForTriggerMetadata(error.cause)
        : undefined;
    const errorMetadata = error.metadata;
    return {
      category:
        error.type === "unauthorized"
          ? "login_required"
          : isChatNotFoundError(error)
            ? "chat_not_found"
            : errorMetadata?.empty_prompt === true
              ? "empty_prompt"
              : errorMetadata?.truncation_dropped_all_messages === true
                ? "input_too_large"
                : "chat_error",
      code,
      name: "ChatSDKError",
      message: errorMessage,
      cause,
      loginRequired: error.type === "unauthorized",
      statusCode: error.statusCode,
      dbOperation: getStringMetadata(errorMetadata, "db_operation"),
      dbErrorName: getStringMetadata(errorMetadata, "db_error_name"),
      dbErrorMessage: getStringMetadata(errorMetadata, "db_error_message"),
      partsSizeKb: getNumberMetadata(errorMetadata, "parts_size_kb"),
      partCount: getNumberMetadata(errorMetadata, "part_count"),
      largestPartType: getStringMetadata(errorMetadata, "largest_part_type"),
      largestPartSizeKb: getNumberMetadata(
        errorMetadata,
        "largest_part_size_kb",
      ),
      toolPartCount: getNumberMetadata(errorMetadata, "tool_part_count"),
      dataPartCount: getNumberMetadata(errorMetadata, "data_part_count"),
      reasoningChars: getNumberMetadata(errorMetadata, "reasoning_chars"),
      emptyPrompt: errorMetadata?.empty_prompt === true,
      truncationDroppedAllMessages:
        errorMetadata?.truncation_dropped_all_messages === true,
      existingMessagesCount: getNumberMetadata(
        errorMetadata,
        "existing_messages_count",
      ),
      newMessagesCount: getNumberMetadata(errorMetadata, "new_messages_count"),
      allMessagesCount: getNumberMetadata(errorMetadata, "all_messages_count"),
      totalTokensBefore: getNumberMetadata(
        errorMetadata,
        "total_tokens_before",
      ),
      maxTokens: getNumberMetadata(errorMetadata, "max_tokens"),
      fileIdsCount: getNumberMetadata(errorMetadata, "file_ids_count"),
      largestFileToken: getNumberMetadata(errorMetadata, "largest_file_token"),
    };
  }

  return {
    category: classifyProviderDashboardCategory(error, details),
    code: typeof details.errorCode === "string" ? details.errorCode : undefined,
    name:
      typeof details.errorName === "string"
        ? details.errorName
        : "UnknownError",
    message: errorMessage,
    loginRequired: false,
    statusCode:
      typeof details.statusCode === "number" ? details.statusCode : undefined,
  };
};

const getTerminalProviderStreamError = (
  state:
    | Pick<AgentStreamState, "streamFinishReason" | "providerError">
    | undefined,
): unknown | undefined => {
  if (!state) return undefined;
  if (state.streamFinishReason !== "error") return undefined;
  if (state.providerError) return state.providerError;

  return Object.assign(
    new Error("Provider stream finished with error finish reason"),
    {
      name: "ProviderStreamError",
      finishReason: state.streamFinishReason,
    },
  );
};

const isTerminalProviderStreamError = (
  state:
    | Pick<AgentStreamState, "streamFinishReason" | "providerError">
    | undefined,
): boolean => state?.streamFinishReason === "error";

const recordAgentLongFailureForDashboard = async (
  error: unknown,
  context: {
    chatId: string;
    userId: string;
    runId: string;
    phase: "setup" | "streaming";
  },
) => {
  const summary = classifyAgentLongError(error);
  const runStatus =
    summary.category === "chat_not_found" ? "chat_not_found" : "failed";
  metadata
    .set("status", runStatus)
    .set("errorCategory", summary.category)
    .set("errorName", summary.name)
    .set("errorMessage", summary.message)
    .set("loginRequired", summary.loginRequired)
    .set("failedPhase", context.phase)
    .set("failedAt", new Date().toISOString());

  if (summary.code) metadata.set("errorCode", summary.code);
  if (summary.statusCode) metadata.set("errorStatusCode", summary.statusCode);
  if (summary.cause) metadata.set("errorCause", summary.cause);
  if (summary.dbOperation) metadata.set("dbOperation", summary.dbOperation);
  if (summary.dbErrorName) metadata.set("dbErrorName", summary.dbErrorName);
  if (summary.dbErrorMessage)
    metadata.set("dbErrorMessage", summary.dbErrorMessage);
  if (summary.partsSizeKb != null)
    metadata.set("messagePartsSizeKb", summary.partsSizeKb);
  if (summary.partCount != null)
    metadata.set("messagePartCount", summary.partCount);
  if (summary.largestPartType)
    metadata.set("largestPartType", summary.largestPartType);
  if (summary.largestPartSizeKb != null)
    metadata.set("largestPartSizeKb", summary.largestPartSizeKb);
  if (summary.toolPartCount != null)
    metadata.set("toolPartCount", summary.toolPartCount);
  if (summary.dataPartCount != null)
    metadata.set("dataPartCount", summary.dataPartCount);
  if (summary.reasoningChars != null)
    metadata.set("reasoningChars", summary.reasoningChars);
  if (summary.emptyPrompt) metadata.set("emptyPrompt", true);
  if (summary.truncationDroppedAllMessages) {
    metadata.set("truncationDroppedAllMessages", true);
  }
  if (summary.existingMessagesCount != null)
    metadata.set("existingMessagesCount", summary.existingMessagesCount);
  if (summary.newMessagesCount != null)
    metadata.set("newMessagesCount", summary.newMessagesCount);
  if (summary.allMessagesCount != null)
    metadata.set("allMessagesCount", summary.allMessagesCount);
  if (summary.totalTokensBefore != null)
    metadata.set("totalTokensBefore", summary.totalTokensBefore);
  if (summary.maxTokens != null) metadata.set("maxTokens", summary.maxTokens);
  if (summary.fileIdsCount != null)
    metadata.set("fileIdsCount", summary.fileIdsCount);
  if (summary.largestFileToken != null)
    metadata.set("largestFileToken", summary.largestFileToken);

  const errorTags = [`error_${summary.category}`];
  if (summary.code) {
    errorTags.push(`error_code_${sanitizeTriggerTagValue(summary.code)}`);
  }
  await tags.add(errorTags);

  const logFields = {
    chatId: context.chatId,
    userId: context.userId,
    runId: context.runId,
    phase: context.phase,
    ...summary,
  };
  if (summary.category === "chat_not_found") {
    triggerLogger.warn("[agent-long] run ended because chat is missing", {
      ...logFields,
      status: runStatus,
    });
  } else {
    triggerLogger.error("[agent-long] run failed", logFields);
  }

  await metadata.flush();
};

const recordAgentLongHandledRateLimitForDashboard = async (
  error: ChatSDKError,
  context: {
    chatId: string;
    userId: string;
    runId: string;
  },
) => {
  const summary = classifyAgentLongError(error);
  metadata
    .set("status", "rate_limited")
    .set("blockedCategory", "rate_limit")
    .set("blockedCode", summary.code ?? "rate_limit:chat")
    .set("blockedMessage", summary.message)
    .set("blockedAt", new Date().toISOString());

  if (summary.statusCode) metadata.set("blockedStatusCode", summary.statusCode);

  await tags.add([
    "rate_limited",
    `blocked_code_${sanitizeTriggerTagValue(summary.code ?? "rate_limit_chat")}`,
  ]);

  triggerLogger.info("[agent-long] run rate limited", {
    chatId: context.chatId,
    userId: context.userId,
    runId: context.runId,
    ...summary,
  });

  await metadata.flush();
};

// Shared between run() and onCancel() since onCancel is defined at task scope.
type RunCleanupState = { cancel: () => Promise<void> };
const runCleanupMap = new Map<string, RunCleanupState>();

function withRunPtyScope<T>(
  handler: (
    payload: AgentLongPayload,
    context: {
      ctx: Pick<TaskRunContext, "run" | "attempt" | "environment">;
      signal: AbortSignal;
      hackLifecycle?: HackWorkerLifecycle;
    },
  ) => Promise<T>,
  hackWorkbenchOnly = false,
) {
  return (
    payload: AgentLongPayload,
    context: {
      ctx: Pick<TaskRunContext, "run" | "attempt" | "environment">;
      signal: AbortSignal;
    },
  ) =>
    withRemoteCommandJournal(() =>
      withConvexClientScope(
        hackWorkbenchOnly
          ? resolveHackWorkerConvexUrl(payload.convexUrl)
          : payload.convexUrl,
        () =>
          hackWorkbenchOnly
            ? ptySessionManager.withConfirmedScope(context.ctx.run.id, () =>
                withHackWorkerEntry(
                  payload,
                  context.ctx.run.id,
                  (hackLifecycle) =>
                    handler(payload, { ...context, hackLifecycle }),
                  () => {
                    metadata.set("cleanupStatus", "unconfirmed");
                  },
                ),
              )
            : ptySessionManager.withConfirmedScope(context.ctx.run.id, () =>
                handler(payload, context),
              ),
      ),
    );
}

export type AgentLongPayload = {
  chatId: string;
  userId: string;
  subscription: SubscriptionTier;
  organizationId?: string;
  messages: UIMessage[];
  localDesktopAttachmentsPrepared?: boolean;
  baseTodos: Todo[];
  sandboxPreference?: SandboxPreference;
  selectedModel?: SelectedModel;
  reasoningEffort?: ReasoningEffort;
  approvalMode?: ApprovalMode;
  purpose?: ChatPurpose;
  projectId?: Id<"projects">;
  activeGoal?: ModelActiveGoal;
  workingFile?: WorkingFileContext;
  userLocation: Geo;
  temporary?: boolean;
  isAutoContinue?: boolean;
  regenerate?: boolean;
  isNewChat?: boolean;
  convexUrl?: string;
  requestTiming?: {
    routeStartedAt: number;
    triggerRequestedAt: number;
  };
  startClaimId?: string;
  /** Stable logical request receipt; distinct from worker fencing. */
  dispatchId?: string;
  hackRun?: import("@/lib/hack/durable-run").HackRunBinding;
  scheduledRun?: {
    executionKey: string;
  };
};

export function createAgentLongTask<T extends "agent-long" | "hack-long">(
  taskId: T,
) {
  const hackWorkbenchOnly = taskId === "hack-long";
  return task({
    id: taskId,
    maxDuration: timeout.None,
    // Streaming tasks must not retry: a retry emits new chunks into the same
    // "ui" stream the client already subscribed to, producing duplicate output.
    // Provider errors are handled internally via the fallback-model path.
    retry: { maxAttempts: 1 },
    // At most 3 concurrent Build/agent runs per user (concurrencyKey: userId at
    // trigger time); one chat is further limited to one active run by the route.
    queue: { name: "agent-long", concurrencyLimit: 3 },
    // Right-sized from observed production CPU/memory usage.
    machine: { preset: "medium-1x" },
    // Failures used to be discoverable only by opening the Trigger dashboard
    // and filtering on tags; eleven runs and two dollars of work died over a
    // week before anyone looked. This posts to the ops channel, with the
    // classification the dashboard tags already use, and stays quiet for the
    // failures that are not incidents (cancels, chat-not-found, rate limits).
    onFailure: async ({
      payload,
      error,
      ctx,
    }: TaskFailureHookParams<AgentLongPayload>) => {
      try {
        const summary = classifyAgentLongError(error);
        const phase =
          (ctx.run as { metadata?: { failedPhase?: string } }).metadata
            ?.failedPhase === "setup"
            ? "setup"
            : "streaming";
        if (!shouldAlertOnFailure({ category: summary.category, phase }))
          return;
        const alert = buildRunFailureAlert({
          runId: ctx.run.id,
          chatId: payload.chatId,
          category: summary.category,
          code: summary.code,
          phase,
          model: payload.selectedModel,
          subscription: payload.subscription,
          elapsedMs: ctx.run.startedAt
            ? Date.now() - new Date(ctx.run.startedAt).getTime()
            : undefined,
          triggerProjectId:
            process.env.TRIGGER_PROJECT_REF ?? "proj_tzdasuzvmzpcjmlcafvs",
          triggerOrgSlug: process.env.TRIGGER_ORG_SLUG ?? "rift-8a1b",
        });
        if (alert) await postOpsAlert(alert);
      } catch {
        // Alerting must never turn a failed run into a second failure.
      }
    },

    onCancel: async ({
      ctx,
      runPromise,
    }: {
      ctx: { run: { id: string } };
      runPromise: Promise<unknown>;
    }) => {
      const cleanup = runCleanupMap.get(ctx.run.id);
      if (!cleanup) return;
      await Promise.race([
        runPromise.catch(() => undefined),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
      // The body may have finished while we waited. Its cleanup and claim
      // release can already have handed the chat to a replacement run.
      if (runCleanupMap.get(ctx.run.id) !== cleanup) return;
      await cleanup.cancel();
      runCleanupMap.delete(ctx.run.id);
    },

    run: withRunPtyScope(
      async (
        payload: AgentLongPayload,
        { ctx, signal: triggerSignal, hackLifecycle },
      ) =>
        withWorkerCrashMonitor(ctx.run.id, async () => {
          // Handler entry is after worker/module initialization; these clocks do
          // not isolate queue wait or cold-start duration.
          const startupTiming = captureWorkerStartupTiming({
            handlerEnteredAt: Date.now(),
            attemptStartedAt: ctx.attempt.startedAt,
            environmentType: ctx.environment.type,
            processUptimeSeconds: process.uptime(),
            moduleEvaluation: readWorkerModuleTiming(),
          });
          const {
            chatId,
            userId,
            subscription: payloadSubscription,
            organizationId,
            messages,
            localDesktopAttachmentsPrepared,
            sandboxPreference: requestedSandboxPreference,
            selectedModel: rawSelectedModelOverride,
            reasoningEffort: rawReasoningEffort,
            purpose: requestedPurpose = "app",
            projectId: requestedProjectId,
            userLocation,
            temporary,
            isAutoContinue,
            regenerate,
            isNewChat,
          } = payload;
          const subscription = hackWorkbenchOnly
            ? "ultra"
            : payloadSubscription;
          // Trigger payload types are compile-time only. Re-validate the model at
          // the worker boundary so a stale scheduled payload or a direct task
          // trigger cannot introduce an unregistered provider key.
          const selectedModelOverride =
            coerceSelectedModel(rawSelectedModelOverride ?? null) ?? undefined;

          // Stable across retries so a failed-then-retried run upserts the same
          // message record rather than creating a duplicate.
          const workingFile = parseWorkingFileContext(payload.workingFile);
          const assistantMessageId = ctx.run.id;
          const mode = "agent" as const;

          // Capture task start time here, before any async setup, so the
          // elapsedTimeExceeds stop condition counts from task launch rather
          // than stream launch. Without this, slow setup (>2 min) would cause
          // the 58-min stop to fire after trigger.dev's 60-min hard SIGKILL.
          const taskStartTime = Date.now();
          triggerSignal.throwIfAborted();
          const hackBinding = hackWorkbenchOnly
            ? await authorizeHackWorkerRun(payload, ctx.run.id)
            : undefined;
          triggerSignal.throwIfAborted();
          const hackExecutionDrain = createDurableHackExecutionDrain({
            runId: ctx.run.id,
            chatId,
          });
          // Start terminal shutdown while joining tools before final persistence.
          // Remote exit proof is awaited separately before cleanup acknowledgment,
          // so an unavailable exit receipt cannot block known usage persistence.
          const drainHackTools = async () => {
            try {
              await hackExecutionDrain?.drainTools();
            } catch {
              metadata.set("cleanupStatus", "unconfirmed");
            }
          };
          const setupTimingsMs: Record<string, number> = {};
          const setupSpansMs: Record<string, StartupPhaseSpan> = {};
          const phaseTimer = createStartupPhaseTimer((name, span) => {
            setupTimingsMs[name] = span.durationMs;
            setupSpansMs[name] = span;
            metadata.set("setupTimingsMs", { ...setupTimingsMs });
            metadata.set("setupSpansMs", { ...setupSpansMs });
          });
          const measureSetup = phaseTimer.measure;

          // Tag for dashboard filtering; add subscription tier for paid-only queries.
          await measureSetup("tags", () =>
            ensureRunTags(
              [
                `user_${userId}`,
                `chat_${chatId}`,
                ...(subscription !== "free" ? [`sub_${subscription}`] : []),
              ],
              ctx.run.tags,
              (missing) => tags.add(missing),
            ),
          );

          // Lifecycle metadata so the dashboard shows progress for long runs.
          metadata
            .set("status", "setup")
            .set("startupTiming", startupTiming)
            .set("chatId", chatId)
            .set("triggerPayloadMessageCount", messages.length);
          if (payload.requestTiming) {
            metadata
              .set("routeStartedAt", payload.requestTiming.routeStartedAt)
              .set(
                "triggerRequestedAt",
                payload.requestTiming.triggerRequestedAt,
              )
              .set(
                "taskStartLatencyMs",
                taskStartTime - payload.requestTiming.triggerRequestedAt,
              );
          }

          const usageRefundTracker = new UsageRefundTracker();
          usageRefundTracker.setUser(userId, subscription, organizationId);
          let releaseFreeRunLock: (() => Promise<void>) | undefined;
          let lockRefreshTimer: ReturnType<typeof setInterval> | undefined;
          const releaseFreeRunLockOnce = async () => {
            if (lockRefreshTimer) {
              clearInterval(lockRefreshTimer);
              lockRefreshTimer = undefined;
            }
            const release = releaseFreeRunLock;
            if (!release) return;
            releaseFreeRunLock = undefined;
            await release();
          };

          // MCP connector teardown — see chat-handler.ts for the rationale. Assigned
          // once the user's MCP servers connect (inside execute); closed at the same
          // terminal points as the free-run lock so transports survive fallback retry
          // legs but are always cleaned up when the run ends. Idempotent.
          let closeMcpToolsOnce: () => Promise<void> = async () => {};

          let chatLogger: ChatLogger | undefined = createChatLogger({
            chatId,
            endpoint: hackWorkbenchOnly ? "/api/hack-long" : "/api/agent-long",
          });
          chatLogger.setRequestDetails({
            mode,
            isTemporary: !!temporary,
            isRegenerate: !!regenerate,
          });
          chatLogger.setUser({
            id: userId,
            subscription,
            region: userLocation?.region,
          });

          // Set to true once the real UI stream is piped to agentUiStream. If a
          // pre-stream setup step throws before this, the outer catch emits a
          // synthetic error stream so the frontend receives a proper error chunk
          // instead of a silent abort.
          let workerClaimId: string | undefined;
          let failureMessage: string | undefined;
          let streamPiped = false;
          const claimCancellation = createWorkerClaimCancellation();
          const preModelStopFinalizer = createPreModelClaimStopFinalizer();
          // A rejected re-entry may already own a checkpoint from this same run.
          // Later checkpoint admission replaces this fallback with its shared finisher.
          preModelStopFinalizer.trackCheckpoint(async () => {
            const owned = workerClaimId
              ? { userId, chatId, claimId: workerClaimId, runId: ctx.run.id }
              : claimCancellation.releaseBinding;
            if (temporary || !owned?.runId) return undefined;
            return finishAgentCheckpointRun({ ...owned, runId: owned.runId });
          });
          let runRecorder: Awaited<ReturnType<typeof startRunRecord>>;
          let runRecorderPreparation:
            | ReturnType<typeof startRunRecord>
            | undefined;
          // Bind the task ID before activation/setup: a stopped retry or a lost start
          // acknowledgement can already have a durable record. Never invent usage.
          preModelStopFinalizer.trackRunRecord(async () => {
            await runRecorderPreparation;
            await runRecorder?.flush();
            await finishRunRecord({
              runId: ctx.run.id,
              status: "cancelled",
              stopReason: "user",
              messageId: assistantMessageId,
            });
          });
          let stopClaimWatcher: (() => void) | undefined;
          let observedUsageTracker: UsageTracker | undefined;
          let scheduledRunOutcome: "succeeded" | "failed" | "canceled" =
            "failed";
          let scheduledRunErrorMessage =
            "The scheduled agent run did not complete";
          const hasObservedUsage = () => !!observedUsageTracker?.hasUsage;
          const { controller: userStopSignal, dispose: detachTriggerAbort } =
            linkAgentAbortSignal(triggerSignal);
          hackLifecycle?.handoff();
          try {
            userStopSignal.signal.throwIfAborted();
            await hackLifecycle?.beforeEffects();
            if (payload.scheduledRun) {
              await retry.onThrow(
                async () => {
                  const authorization = await authorizeScheduledAgentRun({
                    executionKey: payload.scheduledRun!.executionKey,
                    agentRunId: ctx.run.id,
                    userId,
                    chatId,
                  });
                  if (!authorization.authorized) {
                    throw new ChatSDKError(
                      "forbidden:chat",
                      "This scheduled run is no longer authorized.",
                    );
                  }
                },
                {
                  maxAttempts: 3,
                  factor: 2,
                  minTimeoutInMs: 500,
                  maxTimeoutInMs: 3_000,
                  randomize: true,
                },
              );
            }

            // The route may lose Trigger's response. Record actual acceptance
            // from this worker before claim activation, even if Stop already won.
            const { dispatchId, startClaimId } = payload;
            if (dispatchId) {
              if (!startClaimId) throw new Error("Missing dispatch claim");
              await measureSetup("dispatchReceipt", () =>
                recordAgentDispatchAccepted(
                  {
                    userId,
                    chatId,
                    dispatchId,
                    claimId: startClaimId,
                  },
                  ctx.run.id,
                ),
              );
            }
            // Claim activation is transactional and owner-bound. A stale queued
            // worker cannot overwrite a newer run or begin side effects.
            const workerStart = await measureSetup("claim", () =>
              startClaimedAgentRunForWorker({
                userId,
                chatId,
                runId: ctx.run.id,
                startClaimId: payload.startClaimId,
                ...(hackLifecycle
                  ? { workerEntryId: hackLifecycle.binding.workerEntryId }
                  : {}),
                temporary,
                sandboxPreference:
                  requestedPurpose === "app"
                    ? (requestedSandboxPreference ?? "e2b")
                    : "e2b",
              }),
            );
            workerClaimId = workerStart.claimId;
            // Current backend fences cleanup atomically with activation. Retain
            // the explicit acknowledgment path for an older response contract.
            if (
              !workerStart.remoteCleanupRequired &&
              !(await requireRemoteRunCleanup({
                userId,
                chatId,
                claimId: workerClaimId,
                runId: ctx.run.id,
              }))
            ) {
              throw new Error("Worker cleanup registration was not confirmed");
            }
            const stopBinding = {
              userId,
              chatId,
              claimId: workerClaimId,
              runId: ctx.run.id,
            };
            bindRemoteCommandJournal(stopBinding);
            stopClaimWatcher = watchClaimCancellation({
              binding: stopBinding,
              read: () => getAgentRunClaim({ userId, chatId }),
              onCancel: (reason) => {
                claimCancellation.handle(reason);
                userStopSignal.abort(reason);
              },
            });
            metadata.set("cooperativeStopReady", true);
            userStopSignal.signal.throwIfAborted();
            runCleanupMap.set(ctx.run.id, {
              cancel: bindConvexClientScope(async () => {
                if (hackExecutionDrain) await drainHackTools();
                else
                  await ptySessionManager.withScope(ctx.run.id, () =>
                    ptySessionManager.closeAll(chatId).catch(() => {}),
                  );
                if (!hasObservedUsage()) {
                  await usageRefundTracker.refund().catch(() => {});
                }
                await phLogger.flush().catch(() => {});
              }),
            });

            // Re-fetch from DB so we have fileTokens for summarization.
            // Persistent input was saved by the route; ephemeral input exists only in the payload.
            const billingBalancePromise =
              subscription !== "team"
                ? measureSetup("balance", () => getExtraUsageBalance(userId))
                : Promise.resolve(null);
            const contextBalancePromise =
              subscription === "free"
                ? billingBalancePromise
                : Promise.resolve(null);
            const customizationPromise = getUserCustomization({ userId });
            // Claim ownership has already been established. These reads do not
            // depend on history, project resolution, moderation or checkpoint I/O.
            let pricingMargin = RETAIL_MARGIN;
            const usagePreparation = prepareWorkerUsage({
              check: () =>
                measureSetup("entitlement", async () => {
                  const [, resolvedMargin] = await Promise.all([
                    assertUserCanMakeCostIncurringRequest(userId),
                    getConvexClient().query(
                      billingApi.users.pricingForBackend,
                      {
                        userId,
                        serviceKey: getConvexServiceKey() ?? "",
                      },
                    ),
                  ]);
                  pricingMargin = resolvedMargin;
                }),
              customization: customizationPromise,
              balance: billingBalancePromise,
              build: (customization, balance) =>
                measureSetup("billingConfig", () =>
                  buildExtraUsageConfig({
                    userId,
                    subscription,
                    userCustomization: customization,
                    organizationId,
                    requestBalance:
                      subscription !== "team" ? balance : undefined,
                  }),
                ),
            });
            // A context failure can exit before we await preparation. Observe the
            // rejection now; awaiting the original promise below still propagates it.
            void usagePreparation.catch(() => {});
            const [
              userCustomization,
              fetched,
              contextBalance,
              enabledSkillsRuntimeLoad,
              billingBalance,
              projectRuntime,
            ] = await Promise.all([
              customizationPromise,
              // History starts its first authorized page while capacity resolves.
              measureSetup("historyFetch", () =>
                getMessagesByChatId({
                  workerChatSnapshot: workerStart.chatSnapshot,
                  workerRunId: ctx.run.id,
                  chatId,
                  userId,
                  subscription,
                  newMessages: agentWorkerIncomingMessages(
                    temporary,
                    payload.messages,
                  ),
                  regenerate,
                  isTemporary: temporary,
                  mode,
                  context: {
                    model: selectedModelOverride,
                    purpose: requestedPurpose,
                  },
                  hasPaidContextPromise: contextBalancePromise.then(
                    (balance) => (balance?.balancePoints ?? 0) > 0,
                  ),
                }),
              ),
              contextBalancePromise,
              requestedPurpose === "app"
                ? measureSetup("skills", () =>
                    loadEnabledSkillsForRuntime(userId),
                  )
                : Promise.resolve(undefined),
              billingBalancePromise,
              // Activation supplied the same owned chat snapshot used by the
              // history reader. Project authorization remains a fresh read,
              // but need not wait for history, skills or billing reads.
              measureSetup("project", () =>
                resolveProjectRuntimeContext({
                  userId,
                  chat: workerStart.chatSnapshot.read({
                    userId,
                    chatId,
                    runId: ctx.run.id,
                  }),
                  requestedProject: requestedProjectId,
                  requestedPurpose,
                }),
              ),
            ]);
            const hasPaidContext = (contextBalance?.balancePoints ?? 0) > 0;
            const { chat } = fetched;
            let { fileTokens } = fetched;
            const purpose = projectRuntime.purpose;
            const executionPreference =
              purpose === "app" ? (requestedSandboxPreference ?? "e2b") : "e2b";
            if (
              typeof executionPreference !== "string" ||
              !executionPreference.trim() ||
              executionPreference.length > 200
            ) {
              throw new ChatSDKError(
                "bad_request:chat",
                "The selected execution environment is invalid.",
              );
            }
            if (workingFile && purpose !== "app") {
              throw new ChatSDKError(
                "bad_request:api",
                "Working files require Build mode",
              );
            }
            const approvalMode = parseApprovalMode(payload.approvalMode);
            metadata.set("engine", "rift");
            // Trigger payloads are not an authorization boundary. Security execution
            // belongs exclusively to the premium /api/hack-chat transport, so repeat
            // the invariant in the worker before prompts, tools, or sandboxes exist.
            if (hackBinding) {
              assertHackRunContext(payload, hackBinding, {
                chat,
                purpose,
                projectId: projectRuntime.projectId,
                messages: fetched.truncatedMessages,
              });
            } else {
              assertHackWorkbenchPurposeRoute(purpose, false);
            }
            const truncatedMessages = fetched.truncatedMessages;

            const baseTodos: Todo[] = getBaseTodosForRequest(
              (chat?.todos as unknown as Todo[]) || [],
              Array.isArray(payload.baseTodos) ? payload.baseTodos : [],
              { isTemporary: !!temporary, regenerate },
            );

            const uploadBasePath = getUploadBasePath("e2b");
            let messagesForProcessing =
              localDesktopAttachmentsPrepared && messages.length > 0
                ? messages
                : truncatedMessages.length
                  ? truncatedMessages
                  : messages;
            const requestTextForAgentPolicy = [
              projectRuntime.agentMention,
              extractAgentRuntimeRequest(messagesForProcessing, isAutoContinue),
            ]
              .filter((value): value is string => Boolean(value))
              .join(" ");
            const enabledSkillsForAgentRuntime =
              enabledSkillsRuntimeLoad?.skills;
            const agentRuntimePolicy = resolveAgentRuntimePolicy(
              enabledSkillsForAgentRuntime ?? [],
              requestTextForAgentPolicy,
              {
                rosterAvailable:
                  enabledSkillsRuntimeLoad?.status !== "unavailable",
                boundProfile: projectRuntime.botProfile,
                boundSkills: projectRuntime.botSkills,
                boundMeeting: projectRuntime.botMeeting,
              },
            );
            const runtimeModelOverride = resolveActiveAgentModelSelection(
              agentRuntimePolicy,
              selectedModelOverride,
            );

            const contextModel = selectModel(
              mode,
              subscription,
              runtimeModelOverride,
              undefined,
              purpose,
            );
            const resolvedContext = {
              mode,
              model: contextModel,
              hasPaidContext,
            };
            const fetchedContext = {
              mode,
              model: selectedModelOverride,
              purpose,
              hasPaidContext,
            };
            if (
              !localDesktopAttachmentsPrepared &&
              getMaxTokensForSubscription(subscription, resolvedContext) !==
                getMaxTokensForSubscription(subscription, fetchedContext)
            ) {
              const retargeted = await measureSetup("historyRetarget", () =>
                getMessagesByChatId({
                  workerChatSnapshot: workerStart.chatSnapshot,
                  workerRunId: ctx.run.id,
                  chatId,
                  userId,
                  subscription,
                  newMessages: agentWorkerIncomingMessages(
                    temporary,
                    payload.messages,
                  ),
                  regenerate,
                  isTemporary: temporary,
                  mode,
                  context: resolvedContext,
                }),
              );
              messagesForProcessing = retargeted.truncatedMessages;
              fileTokens = retargeted.fileTokens;
            }
            const messagesForAccounting = messagesForProcessing;

            let { processedMessages, selectedModel, sandboxFiles } =
              await measureSetup("messages", () =>
                processChatMessages({
                  messages: messagesForProcessing,
                  mode,
                  userId,
                  subscription,
                  uploadBasePath,
                  modelOverride: runtimeModelOverride,
                  purpose,
                  allowLocalDesktopFiles: false,
                  deferModeration: true,
                }),
              );
            // Re-validate at the worker boundary and after any server-owned custom
            // profile model override. Direct Trigger invocations are not trusted.
            const reasoningEffort =
              purpose === "app"
                ? resolveBuildReasoningEffort(
                    selectedModel,
                    agentRuntimePolicy.activeProfile?.reasoningEffort ??
                      rawReasoningEffort,
                  )
                : undefined;

            if (!processedMessages.length) {
              throw new ChatSDKError(
                "bad_request:api",
                getEmptyProcessedMessagesCause(messagesForProcessing),
              );
            }
            const authoritativeUserRequest =
              extractLatestUserRequest(processedMessages);
            const mediaRequest = resolveMediaRequest({
              purpose,
              prompt: authoritativeUserRequest,
              selectedModel: selectedModelOverride,
            });
            const mediaReferenceUrls =
              extractLatestUserImageReferenceUrls(processedMessages);

            const standaloneTurnContext = {
              purpose,
              hasWorkContext: !!(
                projectRuntime.projectId ||
                workingFile ||
                payload.activeGoal ||
                agentRuntimePolicy.activeProfile
              ),
              continuation: !!(regenerate || isAutoContinue),
            };
            const standaloneGreeting = isStandaloneGreetingTurn(
              messagesForProcessing,
              standaloneTurnContext,
            );
            const standaloneText = isStandaloneTextTurn(
              messagesForProcessing,
              standaloneTurnContext,
            );
            const toolFreeTurn = standaloneGreeting || standaloneText;
            metadata.set("standaloneText", standaloneText);
            metadata.set("standaloneGreeting", standaloneGreeting);
            // Preserve moderation before model execution, overlapping it with
            // checkpoint admission and billing instead of serializing their RTTs.
            const moderationPromise = measureSetup("moderation", () =>
              getModerationResult(processedMessages, subscription !== "free", {
                signal: userStopSignal.signal,
                standaloneGreeting,
              }),
            );
            void moderationPromise.catch(() => {});
            const memoryEnabled =
              userCustomization?.include_memory_entries ?? true;

            const estimatedInputTokens = await measureSetup("estimate", () =>
              estimatePreflightInputTokens({
                mode,
                purpose,
                subscription,
                userId,
                selectedModel,
                userCustomization,
                temporary,
                truncatedMessages: messagesForAccounting,
              }),
            );

            chatLogger.setChat(
              {
                messageCount: messagesForAccounting.length,
                estimatedInputTokens,
                isNewChat: !!isNewChat,
                fileCount: 0,
                imageCount: 0,
                memoryEnabled,
              },
              selectedModel,
            );

            const posthog = PostHogClient();
            chatLogger.getBuilder().setAssistantId(assistantMessageId);

            // Setup may have awaited remote data while the run was canceled.
            userStopSignal.signal.throwIfAborted();

            const summarizationTracker = new SummarizationTracker();
            chatLogger.startStream();
            let terminalAgentState: AgentStreamState | undefined;

            // Rate limit check happens inside execute so a thrown ChatSDKError
            // (e.g. "exceeded daily messages") flows through createUIMessageStream's
            // onError → an error chunk on the UI stream → useChat renders the
            // friendly message. If we checked it outside, the task would throw
            // before agentUiStream.pipe() registered the stream, and the frontend
            // transport would only see a FAILED status with no error message.
            let rateLimitInfo: RateLimitInfo;
            let extraUsageConfig: Awaited<
              ReturnType<typeof buildExtraUsageConfig>
            >;

            let streamError: unknown;
            const uiStream = createUIMessageStream({
              onError: (error) => {
                streamError ??= error;
                if (error instanceof ChatSDKError) {
                  return typeof error.cause === "string"
                    ? error.cause
                    : error.message;
                }
                return getUserFriendlyProviderError(error);
              },
              execute: async ({ writer }) => {
                // Emit an early heartbeat before any await so the frontend's
                // 5-minute idle timeout is cleared immediately. Without this,
                // slow setup (E2B sandbox cold-start, LLM queue) can exceed
                // 5 minutes before writer.merge() fires its first heartbeat.
                writer.write({
                  type: AGENT_LONG_HEARTBEAT_PART_TYPE,
                  data: { at: Date.now() },
                } as AgentLongUiStreamPart);

                try {
                  userStopSignal.signal.throwIfAborted();
                  const requestMessage = [...messagesForProcessing]
                    .reverse()
                    .find((message) => message.role === "user");
                  if (
                    !temporary &&
                    (purpose === "app" || hackBinding) &&
                    !requestMessage
                  ) {
                    throw new ChatSDKError(
                      "bad_request:chat",
                      "The request could not be restored from conversation history.",
                    );
                  }
                  const checkpointOwner =
                    !temporary &&
                    (purpose === "app" || hackBinding) &&
                    requestMessage &&
                    workerClaimId
                      ? {
                          userId,
                          chatId,
                          claimId: workerClaimId,
                          runId: ctx.run.id,
                        }
                      : undefined;
                  let checkpointFinished = false;
                  const finishCheckpointAfterTranscript = async () => {
                    if (!checkpointOwner || checkpointFinished) return true;
                    const confirmed =
                      await finishAgentCheckpointRun(checkpointOwner);
                    if (confirmed) checkpointFinished = true;
                    return confirmed;
                  };
                  if (checkpointOwner)
                    preModelStopFinalizer.trackCheckpoint(
                      finishCheckpointAfterTranscript,
                    );
                  const checkpointStart =
                    checkpointOwner && requestMessage
                      ? await measureSetup("checkpoint", () =>
                          beginAgentCheckpointRun({
                            ...checkpointOwner,
                            requestMessageId: requestMessage.id,
                            requestHash: hackBinding
                              ? hashHackRunPayload(payload)
                              : createHash("sha256")
                                  .update(
                                    serializeWorkingFileBoundRequest(
                                      {
                                        id: requestMessage.id,
                                        parts: requestMessage.parts,
                                        purpose,
                                        projectId: projectRuntime.projectId,
                                        approvalMode,
                                        sandboxPreference: executionPreference,
                                        regenerate: Boolean(regenerate),
                                      },
                                      workingFile,
                                    ),
                                  )
                                  .digest("hex"),
                            model: selectedModel,
                            executionTracking: 1,
                          }),
                        )
                      : undefined;
                  if (checkpointStart?.status === "blocked") {
                    if (checkpointStart.reason === "canceled")
                      throw new AgentRunCanceledError();
                    throw new ChatSDKError(
                      "bad_request:chat",
                      checkpointStart.reason === "claim-lost" ||
                        checkpointStart.reason === "run-already-started"
                        ? "Another run already owns this request. Reopen the conversation to follow its progress."
                        : checkpointStart.reason === "already-finished"
                          ? "This request has already finished. Send a new message to start another action."
                          : "The previous action cannot be safely replayed automatically. Send a new message asking RIFT to inspect the current files and continue.",
                      {
                        checkpoint_blocked: true,
                        reason: checkpointStart.reason,
                      },
                    );
                  }
                  const resumedCheckpoint = checkpointStart?.checkpoint
                    ? restoreCompletedStepCheckpoint(checkpointStart.checkpoint)
                    : undefined;
                  let completedCheckpointStep = checkpointStart?.stepIndex ?? 0;
                  let checkpointDisabled = false;
                  let executingCheckpointStep = completedCheckpointStep;
                  // These checks only read server state. Await both before taking
                  // the free-run lock or reserving any usage.
                  extraUsageConfig = await usagePreparation;
                  // Only cap concurrency for genuinely-free runs. Everyone is
                  // subscription "free" now, so a paying user (usable balance) must
                  // never be blocked by the free-run lock.
                  // Reuse this run's server-loaded snapshot; checkRateLimit still
                  // performs the authoritative atomic reservation below.
                  const balance = contextBalance;
                  // A positive token balance = a paying user; don't also require the
                  // legacy extra_usage_enabled toggle (purchases never set it).
                  const hasUsableBalance =
                    !!balance && balance.balancePoints > 0;
                  if (subscription === "free" && !hasUsableBalance) {
                    const lock = await acquireFreeRunConcurrencyLock(
                      userId,
                      FREE_AGENT_LONG_RUN_LOCK_TTL_SECONDS,
                    );
                    releaseFreeRunLock = lock.release;
                    // Keep the short-TTL lock alive while the run is active; if the
                    // task dies the refresh stops and the lock expires within one TTL
                    // (≈3 min) instead of stranding the user for over an hour.
                    lockRefreshTimer = setInterval(() => {
                      void lock
                        .refresh(FREE_AGENT_LONG_RUN_LOCK_TTL_SECONDS)
                        .catch(() => {});
                    }, 60 * 1000);
                  }

                  userStopSignal.signal.throwIfAborted();
                  // Admission, entitlement and the free-run lock have passed.
                  // Only database reads overlap preflight; MCP transports remain
                  // lazy until discovery, after all model/execution gates pass.
                  const integrationPreparation = prepareWorkerIntegrations({
                    signal: userStopSignal.signal,
                    loadMcp: () =>
                      measureSetup("mcp", () =>
                        loadUserMcpTools(
                          userId,
                          toolFreeTurn
                            ? []
                            : agentRuntimePolicy?.activeProfile?.mcpServerIds,
                          { lazy: true },
                        ),
                      ),
                    loadGithub: () =>
                      toolFreeTurn
                        ? Promise.resolve(null)
                        : measureSetup("github", () =>
                            loadUserGithubToken(userId),
                          ),
                  });
                  // Install cleanup before the next await, including late reads
                  // when reservation/moderation fails or the user cancels.
                  closeMcpToolsOnce = integrationPreparation.close;
                  // Persist the audit row alongside preflight. No model/tool work
                  // starts until both finish; pre-model cleanup joins late creation.
                  runRecorderPreparation = measureSetup("runRecord", () =>
                    startRunRecord({
                      runId: ctx.run.id,
                      chatId,
                      userId,
                      mode,
                      purpose,
                      // The surface is what the user was looking at, which is what the
                      // Runs list groups and filters by.
                      surface:
                        purpose === "security"
                          ? "hack"
                          : purpose === "image"
                            ? "studio"
                            : "build",
                      goal: authoritativeUserRequest,
                      // The selection is known here; the concrete served model can
                      // still differ (fallback legs) and overrides at close.
                      model: selectedModel,
                      messageId: assistantMessageId,
                    }),
                  ).then((recorder) => {
                    runRecorder = recorder;
                    return recorder;
                  });
                  void runRecorderPreparation.catch(() => {});
                  const [reservedUsage, freeMonthlyBudgetSnapshot] =
                    await runTrackedPreflight({
                      reserve: () =>
                        measureSetup("billingReserve", () =>
                          checkRateLimit(
                            userId,
                            mode,
                            subscription,
                            estimatedInputTokens,
                            extraUsageConfig,
                            selectedModel,
                            organizationId,
                            { userId, state: billingBalance },
                            (event) => {
                              if (event.type === "stage") {
                                setupTimingsMs[event.stage] = event.durationMs;
                                metadata.set("setupTimingsMs", {
                                  ...setupTimingsMs,
                                });
                              } else {
                                metadata.set("billingReservation", {
                                  strategy: event.strategy,
                                  ...(event.strategy === "account_credits"
                                    ? {
                                        autoReloadAllowed:
                                          event.autoReloadAllowed,
                                      }
                                    : {}),
                                });
                              }
                            },
                            pricingMargin,
                          ),
                        ),
                      snapshot: () =>
                        subscription === "free"
                          ? measureSetup("monthlySnapshot", () =>
                              checkFreeMonthlyCostLimit(userId, {
                                throwOnExhaustion: false,
                              }),
                            )
                          : Promise.resolve(null),
                      moderation: moderationPromise,
                      tracker: usageRefundTracker,
                      agentMode: true,
                    });
                  rateLimitInfo = reservedUsage;

                  chatLogger?.setRateLimit(
                    {
                      pointsDeducted: rateLimitInfo.pointsDeducted,
                      extraUsagePointsDeducted:
                        rateLimitInfo.extraUsagePointsDeducted,
                      monthly: rateLimitInfo.monthly,
                      remaining: rateLimitInfo.remaining,
                      subscription,
                    },
                    extraUsageConfig,
                  );

                  sendRateLimitWarnings(writer, {
                    subscription,
                    mode,
                    rateLimitInfo,
                  });

                  await moderationPromise;
                  userStopSignal.signal.throwIfAborted();

                  const { mcp: mcpLoaded, github: githubConn } =
                    await integrationPreparation.ready;

                  // Opens the durable record of this run. Best-effort: if it cannot
                  // be opened the agent runs exactly as before, just unrecorded.
                  runRecorder = await runRecorderPreparation;

                  // One measurement sink for the whole run: the loop's step hooks,
                  // every tool call, and the aggregate written to the run record.
                  const runTelemetry = createAgentRunTelemetry({
                    runId: ctx.run.id,
                    chatId,
                    userId,
                    model: selectedModel,
                    endpoint: hackWorkbenchOnly
                      ? "/api/hack-long"
                      : "/api/agent-long",
                    emitter: {
                      event: (name, fields) => phLogger.event(name, fields),
                    },
                  });
                  // Step rows go to the run log too, so /runs can show cost and
                  // duration per step without a PostHog account.
                  let firstModelTextReported = false;
                  const telemetryHooks = {
                    ...runTelemetry.hooks,
                    onModelPreparation: (info: {
                      stage: string;
                      elapsedMs: number;
                    }) => {
                      metadata.set(
                        `modelPreparation_${info.stage}`,
                        Math.round(info.elapsedMs),
                      );
                    },
                    onPromptSize: (
                      info: Parameters<
                        NonNullable<typeof runTelemetry.hooks.onPromptSize>
                      >[0],
                    ) => {
                      runTelemetry.hooks.onPromptSize?.(info);
                      // Latest size-only snapshot is available even without an analytics query key.
                      metadata.set("providerPromptSize", { ...info });
                    },
                    onPrepareStep: (
                      info: Parameters<
                        NonNullable<typeof runTelemetry.hooks.onPrepareStep>
                      >[0],
                    ) => {
                      runTelemetry.hooks.onPrepareStep?.(info);
                      if (info.stepIndex === 1) {
                        metadata.set("firstPrepareStepMs", info.durationMs);
                        if (info.ownershipWaitMs !== undefined)
                          metadata.set(
                            "firstOwnershipWaitMs",
                            info.ownershipWaitMs,
                          );
                        metadata.set(
                          "firstPrepareFinishedMs",
                          Date.now() - taskStartTime,
                        );
                      }
                    },
                    onFirstChunk: (info: { firstChunkMs: number }) => {
                      runTelemetry.hooks.onFirstChunk?.(info);
                      metadata.set(
                        "firstModelChunkMs",
                        Date.now() - taskStartTime,
                      );
                    },
                    onFirstText: () => {
                      if (firstModelTextReported) return;
                      firstModelTextReported = true;
                      metadata.set(
                        "firstModelTextMs",
                        Date.now() - taskStartTime,
                      );
                      metadata.set("firstModelTextAt", Date.now());
                    },
                    onStepFinished: (
                      info: Parameters<
                        NonNullable<typeof runTelemetry.hooks.onStepFinished>
                      >[0],
                    ) => {
                      runTelemetry.hooks.onStepFinished?.(info);
                      runRecorder?.queueEvent({
                        type: "step",
                        stepIndex: info.stepIndex,
                        toolName: info.toolNames[0],
                        summary: info.toolNames.length
                          ? info.toolNames.join(", ")
                          : "text",
                        durationMs: info.stepGapMs,
                        inputTokens: info.inputTokens,
                        outputTokens: info.outputTokens,
                        reasoningTokens: info.reasoningTokens,
                        cacheReadTokens: info.cacheReadTokens,
                        costDollars: info.costDeltaDollars,
                        status: info.finishReason === "error" ? "error" : "ok",
                      });
                    },
                  };
                  let lastPhase: string | undefined;
                  let lastPhaseAt = 0;
                  const noteToolPhase = (toolName: string) => {
                    const phase =
                      toolName === "verify_app" || toolName === "verify_code"
                        ? "verifying"
                        : toolName === "expose_preview"
                          ? "previewing"
                          : toolName === "file" ||
                              toolName === "run_terminal_cmd"
                            ? "building"
                            : undefined;
                    const now = Date.now();
                    if (
                      !phase ||
                      phase === lastPhase ||
                      now - lastPhaseAt < 5_000
                    )
                      return;
                    lastPhase = phase;
                    lastPhaseAt = now;
                    void runRecorder?.markStatus("running", phase);
                  };

                  const approvalGate = createToolApprovalGate({
                    userId,
                    chatId,
                    runId: ctx.run.id,
                    mode: approvalMode,
                  });
                  const {
                    tools,
                    ensureSandbox,
                    getTodoManager,
                    getFileAccumulator,
                    sandboxManager,
                    getSandboxSessionCost,
                    setCurrentModelName,
                    setProjectWorkingDirectory,
                    getToolsForModel,
                    isAppBuildComplete,
                  } = phaseTimer.measureSync("tools", () =>
                    createTools(
                      userId,
                      chatId,
                      writer,
                      mode,
                      userLocation,
                      baseTodos,
                      memoryEnabled,
                      !!temporary,
                      assistantMessageId,
                      executionPreference,
                      getConvexServiceKey(),
                      userCustomization?.guardrails_config,
                      false,
                      undefined,
                      undefined,
                      (costDollars: number) => {
                        usageTracker.providerCost += costDollars;
                        usageTracker.nonModelCost += costDollars;
                        chatLogger?.getBuilder().addToolCost(costDollars);
                      },
                      subscription,
                      (info) => chatLogger?.setSandboxBoot(info),
                      undefined,
                      selectedModel,
                      {
                        discover: mcpLoaded.discover,
                        all: mcpLoaded.tools,
                        planReadOnly: mcpLoaded.planReadOnlyTools,
                        byServerId: mcpLoaded.toolsByServerId,
                        planReadOnlyByServerId:
                          mcpLoaded.planReadOnlyToolsByServerId,
                      },
                      resolveImageModel(mediaRequest.selectedModel)?.model,
                      resolveVideoModel(mediaRequest.selectedModel)?.model,
                      githubConn?.token,
                      githubConn?.username,
                      resolveChatSandboxNamespace({
                        userId,
                        chatId,
                        chat,
                        projectNamespace: projectRuntime.sandboxNamespace,
                      }),
                      purpose,
                      authoritativeUserRequest,
                      mediaReferenceUrls,
                      agentRuntimePolicy,
                      runRecorder,
                      (event) => {
                        runTelemetry.onToolCall(event);
                        noteToolPhase(event.toolName);
                        // The terminal tool writes its own richer event; for the rest,
                        // only failures and slow calls earn a row in the run log.
                        if (
                          event.toolName !== "run_terminal_cmd" &&
                          (!event.ok || event.durationMs > 15_000)
                        ) {
                          runRecorder?.queueEvent({
                            type: "tool_call",
                            toolName: event.toolName,
                            toolCallId: event.toolCallId,
                            durationMs: event.durationMs,
                            status: event.ok ? "ok" : "error",
                            severity: event.ok ? undefined : event.errorClass,
                            inputHash: event.inputHash,
                            outputBytes: event.outputBytes,
                            summary: event.ok
                              ? `${event.toolName} took ${Math.round(event.durationMs / 1000)}s`
                              : `${event.toolName} failed (${event.errorClass ?? "unknown"})`,
                          });
                        }
                      },
                      approvalGate,
                      workingFile,
                      checkpointOwner
                        ? (hackBinding
                            ? createHackCheckpointBarrier
                            : createCheckpointToolBarrier)({
                            userId,
                            signal: userStopSignal.signal,
                            isDisabled: () => checkpointDisabled,
                            assertRead: () =>
                              markAgentCheckpointStep({
                                ...checkpointOwner,
                                stepIndex: executingCheckpointStep,
                              }),
                            markEffect: () =>
                              markAgentCheckpointExecution({
                                ...checkpointOwner,
                                stepIndex: executingCheckpointStep,
                              }),
                          })
                        : undefined,
                      agentRuntimePolicy?.profileSkills
                        ? []
                        : enabledSkillsForAgentRuntime,
                      hackExecutionDrain?.wrap,
                    ),
                  );

                  // Eagerly start the sandbox NOW so its cold-start (E2B create or
                  // resume-from-pause, 1-3s+) overlaps title generation and the first
                  // LLM round-trip instead of blocking the first tool call. getSandbox
                  // caches, so the later upload/tool paths reuse this same boot.
                  // Errors are intentionally swallowed here — the real tool call will
                  // surface them properly; this is only a prewarm.
                  userStopSignal.signal.throwIfAborted();
                  // Registry reads/tool construction above are lazy; the first
                  // sandbox/title/generative model side effect starts here. Check every claimed
                  // purpose, including temporary runs, immediately before that work.
                  await measureSetup("executionFence", () =>
                    assertAgentRunExecutionCurrent(
                      {
                        userId,
                        chatId,
                        claimId: workerClaimId!,
                        runId: ctx.run.id,
                        temporary,
                      },
                      userStopSignal.signal,
                    ),
                  );

                  if (hackBinding)
                    await assertHackExecutionAccess(
                      userId,
                      userStopSignal.signal,
                    );
                  const preparedRepository = !toolFreeTurn
                    ? await prepareCloudProjectRepository({
                        repository: projectRuntime.githubRepository,
                        sandboxNamespace: projectRuntime.sandboxNamespace,
                        executionPreference,
                        connection: githubConn,
                        ensureSandbox,
                        signal: userStopSignal.signal,
                      })
                    : undefined;

                  setProjectWorkingDirectory(preparedRepository?.path);

                  // A text-only fresh greeting has no tools and needs no cloud
                  // allocation. Real work still warms in parallel; selected local
                  // access remains mandatory before any model step.
                  await measureSetup("turnSandbox", () =>
                    prepareTurnSandbox({
                      executionPreference,
                      standaloneGreeting: toolFreeTurn,
                      ensureSandbox,
                      signal: userStopSignal.signal,
                    }),
                  );

                  const sendFileMetadataToStream = (
                    fileMetadata: Array<{
                      fileId: Id<"files">;
                      name: string;
                      mediaType: string;
                      s3Key?: string;
                      storageId?: Id<"_storage">;
                    }>,
                  ) => {
                    if (!fileMetadata || fileMetadata.length === 0) return;
                    writer.write({
                      type: "data-file-metadata",
                      data: {
                        messageId: assistantMessageId,
                        fileDetails: fileMetadata,
                      },
                    });
                  };

                  let sandboxContext: string | null = null;
                  if (
                    !toolFreeTurn &&
                    "getSandboxContextForPrompt" in sandboxManager
                  ) {
                    try {
                      sandboxContext = await (
                        sandboxManager as {
                          getSandboxContextForPrompt: () => Promise<
                            string | null
                          >;
                        }
                      ).getSandboxContextForPrompt();
                    } catch (err) {
                      if (executionPreference !== "e2b") throw err;
                      console.warn(
                        "[agent-long] Failed to get sandbox context:",
                        err,
                      );
                    }
                  }

                  if (sandboxFiles && sandboxFiles.length > 0) {
                    writeUploadStartStatus(
                      writer,
                      sandboxFiles.every((file) => file.kind === "localPath")
                        ? "Preparing local attachments on your computer"
                        : "Uploading attachments to the computer",
                    );
                    let uploadResult: Awaited<
                      ReturnType<typeof uploadSandboxFiles>
                    > = {
                      failedCount: 0,
                      pathRewrites: [],
                    };
                    try {
                      uploadResult = await uploadSandboxFiles(
                        sandboxFiles,
                        ensureSandbox,
                      );
                    } finally {
                      writeUploadCompleteStatus(writer);
                    }
                    if (uploadResult.failedCount > 0) {
                      const noun =
                        uploadResult.failedCount === 1
                          ? "attachment"
                          : "attachments";
                      const uploadError = new ChatSDKError(
                        "bad_request:stream",
                        `Failed to upload ${uploadResult.failedCount} ${noun} to the computer. Please try again.`,
                      );
                      await usageRefundTracker.refund();
                      chatLogger?.emitChatError(uploadError);
                      throw uploadError;
                    }
                    processedMessages = rewriteSandboxFilePathsInMessages(
                      processedMessages,
                      uploadResult.pathRewrites,
                    );
                  }

                  const titlePromise =
                    isNewChat && !temporary
                      ? generateTitleFromUserMessageWithWriter(
                          processedMessages,
                          writer,
                          { abortSignal: userStopSignal.signal },
                        )
                      : Promise.resolve(undefined);

                  let capacityPartId = "";
                  const trackedProvider = createTrackedProvider((progress) => {
                    if (progress.status === "waiting")
                      capacityPartId = `provider-capacity-${crypto.randomUUID()}`;
                    writer.write({
                      type: "data-provider-capacity",
                      id: capacityPartId,
                      data: progress,
                    });
                  });
                  let currentSystemPrompt = await measureSetup(
                    "systemPrompt",
                    () =>
                      systemPrompt(
                        userId,
                        mode,
                        subscription,
                        selectedModel,
                        userCustomization,
                        temporary,
                        sandboxContext,
                        purpose,
                        { standaloneGreeting, standaloneText },
                      ),
                  );
                  currentSystemPrompt = appendActiveGoalSystemContext(
                    currentSystemPrompt,
                    payload.activeGoal,
                  );
                  currentSystemPrompt = appendWorkingFileSystemContext(
                    currentSystemPrompt,
                    workingFile,
                  );
                  if (hackBinding)
                    currentSystemPrompt = appendHackRunSystemContext(
                      currentSystemPrompt,
                      hackBinding,
                    );
                  const systemPromptTokens = countTokens(currentSystemPrompt);
                  metadata.set("systemPromptTokens", systemPromptTokens);

                  const contextUsageOn = isContextUsageEnabled(
                    subscription,
                    mode,
                  );
                  const ctxSystemTokens = contextUsageOn
                    ? systemPromptTokens
                    : 0;
                  const ctxMaxTokens = contextUsageOn
                    ? getMaxTokensForSubscription(subscription, {
                        mode,
                        model: selectedModel,
                        hasPaidContext,
                      })
                    : 0;
                  const initialCtxUsage = contextUsageOn
                    ? computeContextUsage(
                        messagesForAccounting,
                        fileTokens,
                        ctxSystemTokens,
                        ctxMaxTokens,
                      )
                    : { usedTokens: 0, maxTokens: 0 };

                  let finalMessages = processedMessages;

                  const resumeContext = getResumeSection(chat?.finish_reason);
                  if (resumeContext) {
                    finalMessages = appendSystemReminderToLastUserMessage(
                      finalMessages,
                      resumeContext,
                    );
                  }

                  const noteInjectionOpts = {
                    userId,
                    subscription,
                    // SECURITY-ONLY: pentest/OSINT notes are irrelevant to Build (app)
                    // & Image modes, and injecting that offensive-security content
                    // trips Anthropic's real-time content-filter on Claude upstreams
                    // (Bedrock/Vertex), which EMPTIES the response
                    // (finish_reason:"content-filter", 0 output tokens) — that's why
                    // Build-mode Claude Fable 5 came back blank. Mirror of the same
                    // gate in chat-handler.ts (this Trigger path duplicates it).
                    shouldIncludeNotes:
                      purpose === "security" &&
                      (userCustomization?.include_memory_entries ?? true),
                    isTemporary: !!temporary as boolean | undefined,
                  };
                  finalMessages = await injectNotesIntoMessages(
                    finalMessages,
                    noteInjectionOpts,
                  );

                  // Inject the user's enabled skills scoped to the current purpose.
                  finalMessages = await injectSkillsIntoMessages(
                    finalMessages,
                    {
                      userId,
                      purpose,
                      standaloneGreeting: toolFreeTurn,
                      requestText: authoritativeUserRequest,
                      enabledSkills: agentRuntimePolicy?.profileSkills
                        ? []
                        : enabledSkillsForAgentRuntime,
                    },
                  );
                  const repositoryReminder = projectGithubRepositoryReminder(
                    projectRuntime.githubRepository,
                    preparedRepository?.path,
                  );
                  if (repositoryReminder) {
                    finalMessages = appendSystemReminderToLastUserMessage(
                      finalMessages,
                      repositoryReminder,
                    );
                  }
                  const activeWorkflow = renderActiveAgentWorkflowReminder(
                    agentRuntimePolicy,
                    { persistentMention: projectRuntime.agentMention },
                  );
                  if (activeWorkflow) {
                    finalMessages = appendSystemReminderToLastUserMessage(
                      finalMessages,
                      activeWorkflow,
                    );
                  }

                  // Mutable stream state — updated in-place by the shared runner and
                  // read back here in toUIMessageStream.onFinish.
                  const state = initAgentStreamState(
                    finalMessages,
                    initialCtxUsage,
                  );
                  terminalAgentState = state;

                  const budgetSnapshot = captureBudgetSnapshot({
                    rateLimitInfo,
                    extraUsageConfig,
                    subscription,
                  });
                  const effectiveBudgetSnapshot =
                    budgetSnapshot ??
                    // When served from balance the monthly snapshot is exhausted
                    // (remaining 0, no cushion) — building a BudgetMonitor from it
                    // would spuriously abort a request the user is paying for.
                    (rateLimitInfo.servedFrom === "balance" ||
                    freeMonthlyBudgetSnapshot?.rateLimitSkipped
                      ? null
                      : freeMonthlyBudgetSnapshot);
                  // Always built now. The monthly snapshot may be absent (balance-
                  // funded, free, or rate limiting skipped), but the per-run ceiling
                  // applies to every run: it is the guard against one runaway leg,
                  // and for a PAYG run it is the only mid-stream guard there is.
                  const runCeiling = resolveRunCostCeiling({
                    subscription,
                    servedFrom: rateLimitInfo.servedFrom,
                    balanceDollars: extraUsageConfig?.balanceDollars,
                  });
                  const budgetMonitor = new BudgetMonitor(
                    effectiveBudgetSnapshot,
                    writer,
                    subscription,
                    { runCeilingDollars: runCeiling.ceilingDollars },
                  );

                  // Use task start time (not stream start time) so the 58-min stop
                  // condition always fires 2 min before the 60-min hard SIGKILL.
                  const streamStartTime = taskStartTime;
                  const configuredModelId =
                    trackedProvider.languageModel(selectedModel).modelId;

                  let isRetryWithFallback = false;
                  const isAutoModel =
                    !hackBinding &&
                    [
                      "ask-model",
                      "ask-model-free",
                      "agent-model",
                      "agent-model-free",
                    ].includes(selectedModel);
                  const fallbackModel = getRetryFallbackModel(
                    selectedModel,
                    mode,
                    reasoningEffort,
                  );
                  const fallbackModelId =
                    trackedProvider.languageModel(fallbackModel).modelId;

                  const usageTracker = new UsageTracker();
                  observedUsageTracker = usageTracker;
                  let usageSettlementPromise: Promise<void> | undefined;
                  // The run's cost/tokens, captured where they are computed for
                  // billing, so the Run record matches the usage log rather than a
                  // second estimate.
                  let recordedRunCostDollars: number | undefined;
                  let recordedRunTotalTokens: number | undefined;
                  let preFallbackCacheRead = 0;
                  let preFallbackCacheWrite = 0;

                  const deductAccumulatedUsage = (): Promise<void> => {
                    if (usageSettlementPromise) return usageSettlementPromise;
                    // Share the outcome, including rejection. A missing receipt does not
                    // prove that an unkeyed debit failed; replay could charge twice.
                    usageSettlementPromise = Promise.resolve().then(
                      async () => {
                        try {
                          const sandboxCost = getSandboxSessionCost();
                          if (sandboxCost > 0) {
                            usageTracker.providerCost += sandboxCost;
                            usageTracker.nonModelCost += sandboxCost;
                            chatLogger?.getBuilder().addToolCost(sandboxCost);
                          }
                          if (!usageTracker.hasUsage) return;
                          const usageCostRecord =
                            usageTracker.createUsageCostRecord({
                              selectedModel,
                              selectedModelOverride,
                              responseModel: state.responseModel,
                              configuredModelId,
                              rateLimitInfo,
                            });
                          recordedRunCostDollars = usageCostRecord.costDollars;
                          recordedRunTotalTokens = usageCostRecord.totalTokens;
                          const resolvedCost = usageCostRecord.costDollars;
                          await settleWithJournal(
                            {
                              userId,
                              runId: ctx.run.id,
                              evidence: {
                                version: 1,
                                chatId,
                                operationId: payload.dispatchId,
                                organizationId,
                                subscription,
                                usage: usageCostRecord,
                                selectedModel,
                                estimatedInputTokens,
                                servedFrom: rateLimitInfo.servedFrom,
                                pointsDeducted: rateLimitInfo.pointsDeducted,
                                extraUsagePointsDeducted:
                                  rateLimitInfo.extraUsagePointsDeducted,
                                pricingMargin:
                                  rateLimitInfo.pricingMargin ?? pricingMargin,
                                extraUsageConfig,
                              },
                            },
                            async () => {
                              if (
                                subscription === "free" &&
                                rateLimitInfo.servedFrom !== "balance"
                              ) {
                                // Served within the daily free allowance — only track the
                                // free monthly cost cap; no balance charge.
                                await recordFreeMonthlyCost(
                                  userId,
                                  usageCostRecord.costDollars,
                                );
                              } else if (
                                rateLimitInfo.servedFrom === "balance"
                              ) {
                                // PAYG free user past the daily allowance: reconcile the
                                // actual cost against the prepaid balance (input pre-charged).
                                await deductBalanceUsage(
                                  userId,
                                  estimatedInputTokens,
                                  usageTracker.inputTokens,
                                  usageTracker.outputTokens,
                                  resolvedCost,
                                  selectedModel,
                                  usageTracker.nonModelCost,
                                  pricingMargin,
                                );
                                usageTracker.log({
                                  userId,
                                  organizationId,
                                  chatId,
                                  endpoint: hackWorkbenchOnly
                                    ? "/api/hack-long"
                                    : "/api/agent-long",
                                  mode,
                                  subscription,
                                  selectedModel,
                                  selectedModelOverride,
                                  responseModel: state.responseModel,
                                  configuredModelId,
                                  rateLimitInfo,
                                });
                              } else {
                                await deductUsage(
                                  userId,
                                  subscription,
                                  estimatedInputTokens,
                                  usageTracker.inputTokens,
                                  usageTracker.outputTokens,
                                  extraUsageConfig,
                                  resolvedCost,
                                  selectedModel,
                                  usageTracker.nonModelCost,
                                  organizationId,
                                  rateLimitInfo,
                                );
                                usageTracker.log({
                                  userId,
                                  organizationId,
                                  chatId,
                                  endpoint: hackWorkbenchOnly
                                    ? "/api/hack-long"
                                    : "/api/agent-long",
                                  mode,
                                  subscription,
                                  selectedModel,
                                  selectedModelOverride,
                                  responseModel: state.responseModel,
                                  configuredModelId,
                                  rateLimitInfo,
                                });
                              }
                            },
                          );
                          captureUsageCost({
                            posthog,
                            userId,
                            subscription,
                            organizationId,
                            chatId,
                            endpoint: hackWorkbenchOnly
                              ? "/api/hack-long"
                              : "/api/agent-long",
                            mode,
                            usage: usageCostRecord,
                          });
                        } finally {
                          await releaseFreeRunLockOnce();
                        }
                      },
                    );
                    return usageSettlementPromise;
                  };

                  const requestedForcedToolName = resolveForcedFirstToolName({
                    purpose,
                    mediaKind:
                      purpose === "image" ? mediaRequest.kind : undefined,
                  });
                  const forcedToolName =
                    requestedForcedToolName && requestedForcedToolName in tools
                      ? requestedForcedToolName
                      : undefined;
                  const hasCompleteBuildLifecycle =
                    "verify_app" in tools && "expose_preview" in tools;

                  if (resumedCheckpoint && checkpointOwner && requestMessage) {
                    const recoveredMessage = projectCheckpointAssistantMessage({
                      messages: resumedCheckpoint.messages,
                      // Stable across repeated recovery attempts: upsert the same
                      // cumulative prefix instead of duplicating completed tools.
                      messageId: `recovered-${createHash("sha256")
                        .update(
                          JSON.stringify({
                            chatId,
                            requestId: requestMessage.id,
                            parts: requestMessage.parts,
                          }),
                        )
                        .digest("hex")}`,
                    });
                    if (!recoveredMessage) {
                      throw new ChatSDKError(
                        "bad_request:chat",
                        "This interrupted response contains evidence that cannot be safely restored to chat. Send a new message asking RIFT to inspect the current work before continuing.",
                      );
                    }
                    // Save before new side effects, with a transactional run fence.
                    // Future turns then retain the recovered tool history after the
                    // single current checkpoint is replaced by a new request.
                    await saveMessage({
                      chatId,
                      userId,
                      expectedTriggerRunId: ctx.run.id,
                      message: recoveredMessage,
                      model: selectedModel,
                      mode,
                      finishReason: "checkpoint",
                    });
                  }

                  // Shared runner context — immutable deps + platform hook.
                  const streamCtx: AgentStreamContext = {
                    onProviderUsage: (usage, model) =>
                      persistProviderUsage({
                        userId,
                        chatId: temporary ? undefined : chatId,
                        runId: ctx.run.id,
                        model,
                        usage,
                      }),
                    resumeMessages: resumedCheckpoint?.messages,
                    stepIndexOffset: completedCheckpointStep,
                    onStepStarted: checkpointOwner
                      ? async (stepIndex) => {
                          if (hackBinding)
                            await assertHackExecutionAccess(
                              userId,
                              userStopSignal.signal,
                            );
                          if (checkpointDisabled) return;
                          if (
                            !(await markAgentCheckpointStep({
                              ...checkpointOwner,
                              stepIndex,
                            }))
                          ) {
                            throw new ChatSDKError(
                              "bad_request:chat",
                              "This run no longer owns its work. Refresh the conversation before continuing.",
                            );
                          }
                          executingCheckpointStep = stepIndex;
                        }
                      : undefined,
                    onStepCompleted: checkpointOwner
                      ? async (step) => {
                          if (checkpointDisabled) return;
                          // Hack binds the configured model selection in its receipt
                          // and checkpoint hash. Provider response aliases are
                          // telemetry; they cannot authorize a new model selection.
                          if (
                            !hackBinding &&
                            step.modelId &&
                            step.modelId !== configuredModelId
                          ) {
                            if (
                              !(await disableAgentCheckpointRun({
                                ...checkpointOwner,
                                reason: "model-changed",
                              }))
                            ) {
                              throw new ChatSDKError(
                                "bad_request:chat",
                                "The served model could not be recorded safely.",
                              );
                            }
                            checkpointDisabled = true;
                            metadata.set(
                              "checkpoint",
                              "unavailable-served-model-change",
                            );
                            return;
                          }
                          let checkpoint;
                          try {
                            checkpoint = createCompletedStepCheckpoint(step);
                          } catch (error) {
                            if (
                              !(error instanceof AgentCheckpointTooLargeError)
                            )
                              throw error;
                            // Large attachments/history must not break an otherwise
                            // valid run. Durably disable automatic crash replay first.
                            if (
                              !(await disableAgentCheckpointRun(
                                checkpointOwner,
                              ))
                            )
                              throw error;
                            checkpointDisabled = true;
                            metadata.set(
                              "checkpoint",
                              "unavailable-large-context",
                            );
                            if (hackBinding)
                              throw new Error(
                                "The assessment stopped because its completed step could not be checkpointed safely.",
                              );
                            return;
                          }
                          if (
                            !(await saveAgentCheckpoint({
                              ...checkpointOwner,
                              checkpoint,
                            }))
                          ) {
                            throw new ChatSDKError(
                              "bad_request:chat",
                              "The completed step could not be saved safely. The run has stopped.",
                            );
                          }
                          completedCheckpointStep = step.stepIndex;
                          streamCtx.resumeMessages =
                            restoreCompletedStepCheckpoint(checkpoint).messages;
                        }
                      : undefined,
                    isApprovalStopped: approvalGate.isStopped,
                    trackedProvider,
                    currentSystemPrompt,
                    tools,
                    forceFirstToolName: forcedToolName,
                    isAppBuildComplete:
                      purpose === "app" && hasCompleteBuildLifecycle
                        ? isAppBuildComplete
                        : undefined,
                    mode,
                    userId,
                    subscription,
                    chatId,
                    temporary,
                    fileTokens,
                    noteInjectionOpts,
                    systemPromptTokens,
                    ctxSystemTokens,
                    ctxMaxTokens,
                    hasPaidContext,
                    streamStartTime,
                    contextUsageOn,
                    isReasoningModel: true, // long mode is always agent mode
                    reasoningEffort,
                    maxDurationMs: AGENT_LONG_MAX_DURATION_MS,
                    writer,
                    abortController: userStopSignal,
                    summarizationTracker,
                    usageTracker,
                    budgetMonitor,
                    telemetry: telemetryHooks,
                    getLiveNonModelCost: getSandboxSessionCost,
                    sandboxManager,
                    getTodoManager,
                    ensureSandbox,
                    chatLogger,
                    usageRefundTracker,
                    // trigger.dev has no Vercel-style hard preemptive timeout
                    getHardTimeoutReason: () => null,
                  };

                  // The record said "starting" for the whole hour before this; the
                  // rail could not tell a cold start from an agent at work.
                  void runRecorder?.markStatus("running", "thinking");

                  const createStream = async (modelName: string) => {
                    if (hackBinding && modelName !== selectedModel)
                      throw new Error(
                        "The assessment model is bound to its authorized request. Start a new request to change models.",
                      );
                    if (
                      checkpointOwner &&
                      !checkpointDisabled &&
                      modelName !== selectedModel
                    ) {
                      if (
                        !(await disableAgentCheckpointRun({
                          ...checkpointOwner,
                          reason: "model-changed",
                        }))
                      ) {
                        throw new ChatSDKError(
                          "bad_request:chat",
                          "The model fallback could not be recorded safely.",
                        );
                      }
                      checkpointDisabled = true;
                      metadata.set("checkpoint", "unavailable-model-fallback");
                    }
                    streamCtx.stepIndexOffset = completedCheckpointStep;
                    streamCtx.tools = toolFreeTurn
                      ? {}
                      : getToolsForModel(modelName);
                    setCurrentModelName(modelName);
                    metadata.set(
                      "providerRequestedMs",
                      Date.now() - taskStartTime,
                    );
                    preModelStopFinalizer.markModelStarted();
                    return createAgentStream(modelName, streamCtx, state);
                  };

                  let result;
                  try {
                    result = await createStream(selectedModel);
                  } catch (error) {
                    if (
                      isProviderApiError(error) &&
                      !isRetryWithFallback &&
                      isAutoModel
                    ) {
                      phLogger.error(
                        "[agent-long] Provider API error, retrying with fallback",
                        {
                          error,
                          chatId,
                          originalModel: selectedModel,
                          requestedModelSlug: configuredModelId,
                          fallbackModel,
                          fallbackModelSlug: fallbackModelId,
                          userId,
                          subscription,
                          preFallbackCacheReadTokens:
                            usageTracker.cacheReadTokens,
                          preFallbackCacheWriteTokens:
                            usageTracker.cacheWriteTokens,
                          ...extractErrorDetails(error),
                        },
                      );
                      isRetryWithFallback = true;
                      state.lastStepInputTokens = 0;
                      state.stoppedDueToTokenExhaustion = false;
                      state.stoppedDueToElapsedTimeout = false;
                      state.stoppedDueToDoomLoop = false;
                      state.stoppedDueToBudgetExhaustion = false;
                      preFallbackCacheRead = usageTracker.cacheReadTokens;
                      preFallbackCacheWrite = usageTracker.cacheWriteTokens;
                      usageTracker.resetModelLeg();
                      result = await createStream(fallbackModel);
                    } else {
                      throw error;
                    }
                  }

                  writer.merge(
                    withAgentLongStreamHeartbeat({
                      source: result.toUIMessageStream({
                        generateMessageId: () => assistantMessageId,
                        sendReasoning: true,
                        messageMetadata: ({ part }) => {
                          if (part.type === "start") {
                            return {
                              mode,
                              createdAt: streamStartTime,
                              generationStartedAt: streamStartTime,
                            };
                          }

                          if (part.type === "finish") {
                            // The tracker holds the run's totals by the finish part.
                            // Long Build runs were the one path that did not surface
                            // them, so the activity panel fell back to a text-length
                            // estimate — tiny fake numbers instead of real spend.
                            return {
                              mode,
                              createdAt: streamStartTime,
                              generationStartedAt: streamStartTime,
                              generationTimeMs: Date.now() - streamStartTime,
                              ...(usageTracker.hasUsage && {
                                totalTokens: usageTracker.totalTokens,
                                costDollars:
                                  usageTracker.computeCostDollars(
                                    selectedModel,
                                  ),
                                inputTokens: usageTracker.inputTokens,
                                contextInputTokens:
                                  usageTracker.lastStepInputTokens,
                              }),
                            };
                          }
                        },
                        onFinish: async ({
                          messages: finishedMessages,
                          isAborted,
                        }) => {
                          if (isAborted) await drainHackTools();
                          let retryScheduled = false;
                          const hackStopObserved = Boolean(
                            hackBinding &&
                            isAborted &&
                            (claimCancellation.stopped ||
                              (await readHackCancellationEvidence(
                                {
                                  userId,
                                  chatId,
                                  claimId: workerClaimId!,
                                  runId: ctx.run.id,
                                },
                                () => getAgentRunClaim({ userId, chatId }),
                              ))),
                          );
                          if (hackStopObserved && !claimCancellation.stopped) {
                            claimCancellation.handle(
                              new AgentRunCanceledError({
                                userId,
                                chatId,
                                claimId: workerClaimId!,
                                runId: ctx.run.id,
                              }),
                            );
                          }
                          const hackFinalization = hackBinding
                            ? resolveHackRunFinalization({
                                state,
                                isAborted,
                                manualStop: hackStopObserved,
                              })
                            : undefined;
                          if (hackFinalization)
                            state.streamFinishReason =
                              hackFinalization.finishReason;
                          try {
                            // Retry with fallback if stream only produced step-start (incomplete response)
                            const lastAssistantMessage = finishedMessages
                              .slice()
                              .reverse()
                              .find((m) => m.role === "assistant");
                            const lastAssistantMessageParts =
                              stripAgentLongHeartbeatParts(
                                lastAssistantMessage ?? { parts: [] },
                              ).parts ?? [];
                            const hasOnlyStepStart =
                              lastAssistantMessageParts.length === 1 &&
                              (
                                lastAssistantMessageParts[0] as {
                                  type?: string;
                                }
                              )?.type === "step-start";

                            if (
                              hasOnlyStepStart &&
                              !isRetryWithFallback &&
                              !isAborted &&
                              isAutoModel
                            ) {
                              isRetryWithFallback = true;
                              state.lastStepInputTokens = 0;
                              state.stoppedDueToTokenExhaustion = false;
                              state.stoppedDueToElapsedTimeout = false;
                              state.stoppedDueToDoomLoop = false;
                              state.stoppedDueToBudgetExhaustion = false;
                              const fallbackStartTime = Date.now();
                              preFallbackCacheRead =
                                usageTracker.cacheReadTokens;
                              preFallbackCacheWrite =
                                usageTracker.cacheWriteTokens;
                              usageTracker.resetModelLeg();
                              const retryResult =
                                await createStream(fallbackModel);
                              const retryMessageId = generateId();

                              writer.merge(
                                withAgentLongStreamHeartbeat({
                                  source: retryResult.toUIMessageStream({
                                    generateMessageId: () => retryMessageId,
                                    sendReasoning: true,
                                    messageMetadata: ({ part }) => {
                                      if (part.type === "start") {
                                        return {
                                          mode,
                                          createdAt: fallbackStartTime,
                                          generationStartedAt:
                                            fallbackStartTime,
                                        };
                                      }

                                      if (part.type === "finish") {
                                        return {
                                          mode,
                                          createdAt: fallbackStartTime,
                                          generationStartedAt:
                                            fallbackStartTime,
                                          generationTimeMs:
                                            Date.now() - fallbackStartTime,
                                          ...(usageTracker.hasUsage && {
                                            totalTokens:
                                              usageTracker.totalTokens,
                                            costDollars:
                                              usageTracker.computeCostDollars(
                                                fallbackModel,
                                              ),
                                            inputTokens:
                                              usageTracker.inputTokens,
                                            contextInputTokens:
                                              usageTracker.lastStepInputTokens,
                                          }),
                                        };
                                      }
                                    },
                                    onFinish: async ({
                                      messages: retryMessages,
                                      isAborted: retryAborted,
                                    }) => {
                                      if (retryAborted) await drainHackTools();
                                      try {
                                        const fallbackCacheRead =
                                          usageTracker.cacheReadTokens -
                                          preFallbackCacheRead;
                                        const fallbackCacheWrite =
                                          usageTracker.cacheWriteTokens -
                                          preFallbackCacheWrite;
                                        const fallbackCacheTotal =
                                          fallbackCacheRead +
                                          fallbackCacheWrite;
                                        const sandboxInfo =
                                          sandboxManager.getSandboxInfo();
                                        chatLogger?.setSandbox(sandboxInfo);
                                        chatLogger?.setCacheMetrics({
                                          cacheHitRate:
                                            fallbackCacheTotal > 0
                                              ? fallbackCacheRead /
                                                fallbackCacheTotal
                                              : null,
                                          cacheReadTokens: fallbackCacheRead,
                                          cacheWriteTokens: fallbackCacheWrite,
                                        });
                                        captureToolCalls({
                                          posthog,
                                          chatLogger,
                                          userId,
                                          mode,
                                        });
                                        const outcome = retryAborted
                                          ? "aborted"
                                          : isTerminalProviderStreamError(state)
                                            ? "error"
                                            : "success";
                                        captureAgentCompletionAnalytics({
                                          posthog,
                                          userId,
                                          chatId,
                                          endpoint: hackWorkbenchOnly
                                            ? "/api/hack-long"
                                            : "/api/agent-long",
                                          mode,
                                          subscription,
                                          sandboxInfo,
                                          outcome,
                                          chatLogger,
                                        });
                                        if (
                                          !isTerminalProviderStreamError(state)
                                        ) {
                                          chatLogger
                                            ?.getBuilder()
                                            .setRunMetrics(
                                              toMetricsRecord(
                                                runTelemetry.snapshot(),
                                              ),
                                            );
                                          chatLogger?.emitSuccess({
                                            finishReason:
                                              state.streamFinishReason,
                                            wasAborted: retryAborted,
                                            wasPreemptiveTimeout: false,
                                            hadSummarization:
                                              summarizationTracker.hasSummarized,
                                          });
                                        }

                                        const generatedTitle =
                                          await titlePromise;
                                        if (!temporary) {
                                          const mergedTodos =
                                            getTodoManager().mergeWith(
                                              baseTodos,
                                              retryMessageId,
                                            );
                                          if (
                                            generatedTitle ||
                                            state.streamFinishReason ||
                                            mergedTodos.length > 0
                                          ) {
                                            await updateChat({
                                              chatId,
                                              expectedTriggerRunId: ctx.run.id,
                                              title: generatedTitle,
                                              finishReason:
                                                state.streamFinishReason,
                                              todos: mergedTodos,
                                              defaultModelSlug: "agent",
                                              sandboxType:
                                                sandboxManager.getEffectivePreference(),
                                              selectedModel:
                                                selectedModelOverride,
                                            });
                                          } else {
                                            await prepareForNewStream({
                                              chatId,
                                              expectedTriggerRunId: ctx.run.id,
                                            });
                                          }
                                          const accumulatedFiles =
                                            getFileAccumulator().getAll();
                                          const newFileIds =
                                            accumulatedFiles.map(
                                              (f) => f.fileId,
                                            );
                                          const fallbackGenerationTimeMs =
                                            Date.now() - fallbackStartTime;
                                          for (const msg of retryMessages) {
                                            if (msg.role !== "assistant")
                                              continue;
                                            const processed =
                                              stripAgentLongHeartbeatParts(
                                                summarizationTracker.processMessageForSave(
                                                  msg,
                                                ),
                                              );
                                            await saveMessage({
                                              expectedTriggerRunId: ctx.run.id,
                                              chatId,
                                              userId,
                                              message: processed,
                                              extraFileIds: newFileIds,
                                              usage: state.streamUsage,
                                              model: state.responseModel,
                                              mode,
                                              generationStartedAt:
                                                fallbackStartTime,
                                              generationTimeMs:
                                                fallbackGenerationTimeMs,
                                              finishReason:
                                                state.streamFinishReason,
                                            });
                                          }
                                          if (
                                            retryMessages.some(
                                              (message) =>
                                                message.role === "assistant",
                                            )
                                          ) {
                                            await finishCheckpointAfterTranscript();
                                          }
                                          writer.write({
                                            type: "message-metadata",
                                            messageMetadata: {
                                              mode,
                                              createdAt: fallbackStartTime,
                                              generationStartedAt:
                                                fallbackStartTime,
                                              generationTimeMs:
                                                fallbackGenerationTimeMs,
                                            },
                                          });
                                          sendFileMetadataToStream(
                                            accumulatedFiles,
                                          );
                                        }
                                        const retryAutoContinueReason =
                                          hackBinding
                                            ? null
                                            : resolveAgentAutoContinueReason({
                                                approvalStopped:
                                                  approvalGate.isStopped?.() ??
                                                  false,
                                                purpose,
                                                temporary: Boolean(temporary),
                                                finishReason:
                                                  state.streamFinishReason,
                                                stoppedDueToTokenExhaustion:
                                                  state.stoppedDueToTokenExhaustion,
                                                stoppedDueToElapsedTimeout:
                                                  state.stoppedDueToElapsedTimeout,
                                                manuallyAborted:
                                                  retryAborted &&
                                                  triggerSignal.aborted &&
                                                  !state.stoppedDueToElapsedTimeout,
                                                terminalError:
                                                  state.providerError !==
                                                    undefined ||
                                                  isTerminalProviderStreamError(
                                                    state,
                                                  ),
                                              });
                                        if (retryAutoContinueReason) {
                                          writeAutoContinue(writer, {
                                            continuationId: retryMessageId,
                                            reason: retryAutoContinueReason,
                                          });
                                        }
                                        await deductAccumulatedUsage();
                                        posthog?.shutdown();
                                      } finally {
                                        await releaseFreeRunLockOnce();
                                      }
                                    },
                                  }),
                                  signal: userStopSignal.signal,
                                  drainOnAbort: true,
                                  heartbeat: () => ({
                                    type: AGENT_LONG_HEARTBEAT_PART_TYPE,
                                    data: { at: Date.now() },
                                  }),
                                }),
                              );
                              retryScheduled = true;
                              return;
                            }

                            // User-initiated cancel via trigger.dev: clear finish reason
                            // so the client doesn't show spurious "going off course" messages.
                            if (
                              !hackBinding &&
                              isAborted &&
                              triggerSignal.aborted &&
                              !state.stoppedDueToBudgetExhaustion &&
                              !state.stoppedDueToElapsedTimeout
                            ) {
                              state.streamFinishReason = undefined;
                            }

                            const sandboxInfo = sandboxManager.getSandboxInfo();
                            chatLogger?.setSandbox(sandboxInfo);
                            chatLogger?.setCacheMetrics({
                              cacheHitRate: usageTracker.cacheHitRate,
                              cacheReadTokens: usageTracker.cacheReadTokens,
                              cacheWriteTokens: usageTracker.cacheWriteTokens,
                            });
                            captureToolCalls({
                              posthog,
                              chatLogger,
                              userId,
                              mode,
                            });
                            const outcome =
                              hackFinalization?.outcome.status === "failed"
                                ? "error"
                                : isAborted
                                  ? "aborted"
                                  : isTerminalProviderStreamError(state)
                                    ? "error"
                                    : "success";
                            captureAgentCompletionAnalytics({
                              posthog,
                              userId,
                              chatId,
                              endpoint: hackWorkbenchOnly
                                ? "/api/hack-long"
                                : "/api/agent-long",
                              mode,
                              subscription,
                              sandboxInfo,
                              outcome,
                              chatLogger,
                            });
                            if (!isTerminalProviderStreamError(state)) {
                              chatLogger?.emitSuccess({
                                finishReason: state.streamFinishReason,
                                wasAborted: isAborted,
                                wasPreemptiveTimeout:
                                  state.stoppedDueToElapsedTimeout,
                                hadSummarization:
                                  summarizationTracker.hasSummarized,
                              });
                            }

                            const generatedTitle = await titlePromise;

                            if (!temporary) {
                              const mergedTodos = getTodoManager().mergeWith(
                                baseTodos,
                                assistantMessageId,
                              );
                              const shouldPersist = regenerate
                                ? true
                                : Boolean(
                                    generatedTitle ||
                                    state.streamFinishReason ||
                                    mergedTodos.length > 0,
                                  );

                              if (shouldPersist) {
                                await updateChat({
                                  chatId,
                                  expectedTriggerRunId: ctx.run.id,
                                  title: generatedTitle,
                                  finishReason: state.streamFinishReason,
                                  todos: mergedTodos,
                                  defaultModelSlug: "agent",
                                  sandboxType:
                                    sandboxManager.getEffectivePreference(),
                                  selectedModel: selectedModelOverride,
                                });
                              } else {
                                await prepareForNewStream({
                                  chatId,
                                  expectedTriggerRunId: ctx.run.id,
                                });
                              }

                              const accumulatedFiles =
                                getFileAccumulator().getAll();
                              const newFileIds = accumulatedFiles.map(
                                (f) => f.fileId,
                              );

                              let resolvedUsage:
                                | Record<string, unknown>
                                | undefined = state.streamUsage;
                              if (!resolvedUsage && isAborted) {
                                try {
                                  resolvedUsage =
                                    (await result.usage) as Record<
                                      string,
                                      unknown
                                    >;
                                } catch {
                                  // Usage unavailable on abort
                                }
                              }

                              const hasIncompleteToolCalls =
                                finishedMessages.some(
                                  (msg) =>
                                    msg.role === "assistant" &&
                                    msg.parts?.some(
                                      (p: {
                                        type?: string;
                                        state?: string;
                                        toolCallId?: string;
                                      }) =>
                                        p.type?.startsWith("tool-") &&
                                        p.state !== "output-available" &&
                                        p.toolCallId,
                                    ),
                                );
                              const incompleteToolSummaries = isAborted
                                ? summarizeIncompleteToolParts(finishedMessages)
                                : [];
                              if (incompleteToolSummaries.length > 0) {
                                console.info(
                                  JSON.stringify({
                                    level: "info",
                                    event:
                                      "agent_long_abort_incomplete_tool_calls_detected",
                                    service: "agent-long",
                                    timestamp: new Date().toISOString(),
                                    chat_id: chatId,
                                    user_id: userId,
                                    mode: "agent",
                                    finish_reason: state.streamFinishReason,
                                    trigger_signal_aborted:
                                      triggerSignal.aborted,
                                    incomplete_tool_count:
                                      incompleteToolSummaries.length,
                                    incomplete_tools: incompleteToolSummaries,
                                  }),
                                );
                              }
                              if (
                                isAborted &&
                                !triggerSignal.aborted &&
                                newFileIds.length === 0 &&
                                !hasIncompleteToolCalls &&
                                !resolvedUsage
                              ) {
                                console.info(
                                  JSON.stringify({
                                    level: "info",
                                    event:
                                      "agent_long_abort_message_save_skipped",
                                    service: "agent-long",
                                    timestamp: new Date().toISOString(),
                                    chat_id: chatId,
                                    user_id: userId,
                                    mode: "agent",
                                    finish_reason: state.streamFinishReason,
                                    new_file_count: newFileIds.length,
                                    has_incomplete_tool_calls:
                                      hasIncompleteToolCalls,
                                    has_usage_to_record: Boolean(resolvedUsage),
                                  }),
                                );
                                await deductAccumulatedUsage();
                                posthog?.shutdown();
                                return;
                              }

                              const finalGenerationTimeMs =
                                Date.now() - streamStartTime;
                              // Whether this cancellation means "throw the partial
                              // output away" (regenerate / edit / retry) or "keep what
                              // you have" (a plain Stop). Recorded durably by the
                              // cancel mutation, so it survives a dropped signal.
                              // Defaults to keep: an extra partial message is
                              // recoverable, a lost one is not.
                              const cancelDiscardsOutput =
                                isAborted && !temporary
                                  ? (await getCancellationStatus({ chatId }))
                                      ?.cancel_skip_save === true
                                  : false;
                              let savedAssistantMessage = false;
                              for (const message of finishedMessages) {
                                const processed = stripAgentLongHeartbeatParts(
                                  summarizationTracker.processMessageForSave(
                                    message,
                                  ),
                                );
                                if (
                                  (!processed.parts ||
                                    processed.parts.length === 0) &&
                                  newFileIds.length === 0
                                ) {
                                  continue;
                                }
                                // Final UI persistence upserts the stable message
                                // ID; completed model/tool steps also have a separate
                                // owner-bound checkpoint for interrupted-run recovery.
                                await retry.onThrow(
                                  async () =>
                                    saveMessage({
                                      expectedTriggerRunId: ctx.run.id,
                                      chatId,
                                      userId,
                                      message: processed,
                                      extraFileIds: newFileIds,
                                      model:
                                        state.responseModel ||
                                        configuredModelId,
                                      mode,
                                      generationStartedAt:
                                        processed.role === "assistant"
                                          ? streamStartTime
                                          : undefined,
                                      generationTimeMs: finalGenerationTimeMs,
                                      finishReason: state.streamFinishReason,
                                      usage: resolvedUsage ?? state.streamUsage,
                                      // updateOnly refuses to insert, which is right
                                      // for a turn the user is discarding and wrong
                                      // for one they stopped: the client's save is
                                      // fire-and-forget, so refusing to insert lost
                                      // the partial output whenever that request did
                                      // not land.
                                      updateOnly:
                                        isAborted &&
                                        !state.stoppedDueToElapsedTimeout &&
                                        cancelDiscardsOutput
                                          ? true
                                          : undefined,
                                      isHidden:
                                        isAutoContinue &&
                                        processed.role === "user"
                                          ? true
                                          : undefined,
                                    }),
                                  {
                                    maxAttempts: 3,
                                    factor: 2,
                                    minTimeoutInMs: 500,
                                    maxTimeoutInMs: 4_000,
                                    randomize: true,
                                  },
                                );
                                if (processed.role === "assistant") {
                                  savedAssistantMessage = true;
                                }
                              }

                              if (savedAssistantMessage) {
                                await finishCheckpointAfterTranscript();
                                writer.write({
                                  type: "message-metadata",
                                  messageMetadata: {
                                    mode,
                                    createdAt: streamStartTime,
                                    generationStartedAt: streamStartTime,
                                    generationTimeMs: finalGenerationTimeMs,
                                  },
                                });
                              }

                              sendFileMetadataToStream(accumulatedFiles);
                            }

                            if (contextUsageOn) {
                              writeContextUsage(writer, {
                                usedTokens:
                                  state.ctxUsage.usedTokens +
                                  usageTracker.streamOutputTokens,
                                maxTokens: state.ctxUsage.maxTokens,
                              });
                            }

                            const autoContinueReason = hackBinding
                              ? null
                              : resolveAgentAutoContinueReason({
                                  approvalStopped:
                                    approvalGate.isStopped?.() ?? false,
                                  purpose,
                                  temporary: Boolean(temporary),
                                  finishReason: state.streamFinishReason,
                                  stoppedDueToTokenExhaustion:
                                    state.stoppedDueToTokenExhaustion,
                                  stoppedDueToElapsedTimeout:
                                    state.stoppedDueToElapsedTimeout,
                                  manuallyAborted:
                                    isAborted &&
                                    triggerSignal.aborted &&
                                    !state.stoppedDueToElapsedTimeout,
                                  terminalError:
                                    state.providerError !== undefined ||
                                    isTerminalProviderStreamError(state),
                                });
                            if (autoContinueReason) {
                              writeAutoContinue(writer, {
                                continuationId: assistantMessageId,
                                reason: autoContinueReason,
                              });
                            }

                            posthog?.shutdown();
                          } finally {
                            if (!retryScheduled) {
                              await drainHackTools();
                              // Deduct in the `finally`, not the `try`.
                              //
                              // The model spend is already real by this point -- the
                              // tokens were bought the moment the provider streamed
                              // them. Sitting after the message save meant a save
                              // that threw skipped the deduction entirely, so the run
                              // billed nothing while the user's included allowance
                              // stayed untouched: a silent leak, in the user's favour
                              // here but wrong in either direction, and invisible
                              // because the run was already failing for another
                              // reason.
                              //
                              // Concurrent finalizers share one settlement promise, which is
                              // ordered before finishRunRecord so the run record
                              // still sees the recorded cost. Its own failure must
                              // never replace the error that actually ended the run,
                              // hence the catch.
                              await deductAccumulatedUsage().catch((error) => {
                                console.error({
                                  event: "agent_long_usage_deduction_failed",
                                  chatId,
                                  runId: ctx.run.id,
                                  error:
                                    error instanceof Error
                                      ? error.message
                                      : String(error),
                                });
                              });
                              // Close the run record with what actually happened, so
                              // a stopped run stays distinguishable from a finished
                              // one after the fact.
                              if (runRecorder) {
                                // A run that hit the elapsed-time ceiling produced
                                // real output but did not finish the job -- that is
                                // "completed with warnings", not a clean completion
                                // and not a failure.
                                const outcome =
                                  hackFinalization?.outcome ??
                                  resolveRunOutcome({
                                    isAborted,
                                    manuallyAborted:
                                      isAborted &&
                                      !state.stoppedDueToElapsedTimeout,
                                    stoppedDueToElapsedTimeout:
                                      state.stoppedDueToElapsedTimeout,
                                    stoppedDueToDoomLoop:
                                      state.stoppedDueToDoomLoop,
                                    stoppedDueToBudgetExhaustion:
                                      state.stoppedDueToBudgetExhaustion,
                                    stoppedDueToTokenExhaustion:
                                      state.stoppedDueToTokenExhaustion,
                                    terminalProviderError:
                                      isTerminalProviderStreamError(state),
                                    finishReason: state.streamFinishReason,
                                  });
                                await runRecorder.flush();
                                await finishRunRecord({
                                  runId: runRecorder.runId,
                                  status: outcome.status,
                                  stopReason: outcome.stopReason,
                                  model: state.responseModel ?? selectedModel,
                                  metrics: toMetricsRecord(
                                    runTelemetry.snapshot(),
                                  ),
                                  finishReason: state.streamFinishReason,
                                  error: state.providerError
                                    ? String(state.providerError).slice(0, 300)
                                    : undefined,
                                  messageId: assistantMessageId,
                                  costDollars: recordedRunCostDollars,
                                  totalTokens:
                                    recordedRunTotalTokens ??
                                    (usageTracker.streamOutputTokens ||
                                      undefined),
                                });
                              }
                              await releaseFreeRunLockOnce();
                              await closeMcpToolsOnce();
                            }
                          }
                        },
                      }),
                      signal: userStopSignal.signal,
                      drainOnAbort: true,
                      heartbeat: () => ({
                        type: AGENT_LONG_HEARTBEAT_PART_TYPE,
                        data: { at: Date.now() },
                      }),
                    }),
                  );
                } catch (error) {
                  await drainHackTools();
                  await releaseFreeRunLockOnce();
                  await closeMcpToolsOnce();
                  if (
                    claimCancellation.handle(
                      error,
                      writer,
                      preModelStopFinalizer.modelStarted
                        ? undefined
                        : triggerSignal,
                    )
                  )
                    return;
                  throw error;
                }
              },
            });

            metadata
              .set("status", "streaming")
              .set("model", selectedModel)
              .set("setupBeforeStreamMs", Date.now() - taskStartTime);
            const { stream: triggerMirror, waitUntilComplete } =
              agentUiStream.pipe(uiStream);
            streamPiped = true;
            const delivery = await settleAgentUiStream(
              waitUntilComplete(),
              drainPipedTriggerMirror(triggerMirror),
            );
            if (delivery.deliveryInterrupted) {
              metadata.set("uiDeliveryStatus", "interrupted");
            }

            const terminalStreamError =
              hackBinding && claimCancellation.stopped
                ? undefined
                : (streamError ??
                  getTerminalProviderStreamError(terminalAgentState));
            if (terminalStreamError) {
              if (isHandledUserRateLimitError(terminalStreamError)) {
                scheduledRunErrorMessage =
                  "The scheduled run was blocked by the current usage limit";
                await recordAgentLongHandledRateLimitForDashboard(
                  terminalStreamError,
                  {
                    chatId,
                    userId,
                    runId: ctx.run.id,
                  },
                ).catch((metadataError) => {
                  metadata.set("status", "rate_limited");
                  console.error(
                    "[agent-long] failed to record rate limit metadata:",
                    metadataError,
                  );
                });
                await usageRefundTracker.refund().catch(() => {});
                chatLogger?.emitChatError(terminalStreamError);
                await phLogger.flush().catch(() => {});
                return { chatId, assistantMessageId };
              }
              throw terminalStreamError;
            }

            scheduledRunOutcome = claimCancellation.terminalStatus(
              triggerSignal.aborted,
              "succeeded",
            );
            if (claimCancellation.stopped) {
              if (!hasObservedUsage())
                await usageRefundTracker.refund().catch(() => {});
              if (workerClaimId && !hackExecutionDrain)
                await ptySessionManager.closeAll(chatId).catch(() => {});
            }
            if (scheduledRunOutcome === "canceled") {
              scheduledRunErrorMessage = "The scheduled run was canceled";
            }
            metadata.set(
              "status",
              scheduledRunOutcome === "canceled" ? "canceled" : "done",
            );
            await phLogger.flush().catch(() => {});
          } catch (error) {
            await drainHackTools();
            if (
              claimCancellation.handle(
                error,
                undefined,
                preModelStopFinalizer.modelStarted ? undefined : triggerSignal,
              )
            ) {
              scheduledRunOutcome = "canceled";
              scheduledRunErrorMessage = "The scheduled run was canceled";
              metadata.set("status", "canceled");
              await releaseFreeRunLockOnce();
              await closeMcpToolsOnce();
              if (!hasObservedUsage())
                await usageRefundTracker.refund().catch(() => {});
              if (workerClaimId && !hackExecutionDrain)
                await ptySessionManager.closeAll(chatId).catch(() => {});
              if (!streamPiped) {
                const abortedStream = createUIMessageStream({
                  execute: ({ writer }) => {
                    writer.write({ type: "abort" });
                  },
                });
                const { stream: abortedMirror, waitUntilComplete } =
                  agentUiStream.pipe(abortedStream);
                await Promise.all([
                  waitUntilComplete(),
                  drainPipedTriggerMirror(abortedMirror),
                ]);
              }
              await phLogger.flush().catch(() => {});
              return { chatId, assistantMessageId };
            }
            failureMessage = triggerSignal.aborted
              ? undefined
              : describeRunFailure(error);
            scheduledRunErrorMessage = triggerSignal.aborted
              ? "The scheduled run was canceled"
              : "The scheduled agent run failed";
            await releaseFreeRunLockOnce();
            await closeMcpToolsOnce();
            const chatMissingAfterStream =
              streamPiped &&
              error instanceof ChatSDKError &&
              isChatNotFoundError(error);
            await recordAgentLongFailureForDashboard(error, {
              chatId,
              userId,
              runId: ctx.run.id,
              phase: streamPiped ? "streaming" : "setup",
            }).catch((metadataError) => {
              metadata.set("status", "failed");
              console.error(
                "[agent-long] failed to record run error metadata:",
                metadataError,
              );
            });
            if (!hasObservedUsage()) {
              await usageRefundTracker.refund().catch(() => {});
            }
            if (error instanceof ChatSDKError) {
              chatLogger?.emitChatError(error);
            } else {
              chatLogger?.emitUnexpectedError(error);
            }
            if (workerClaimId && !hackExecutionDrain) {
              await ptySessionManager
                .closeAll(chatId)
                .catch((err) =>
                  console.error(
                    "[agent-long] PTY closeAll (outer catch) failed:",
                    err,
                  ),
                );
            }

            if (chatMissingAfterStream) {
              await phLogger.flush().catch(() => {});
              return { chatId, assistantMessageId };
            }

            // Pre-stream setup failed (DB fetch, message processing, etc.). Emit a
            // one-shot UI stream whose onError converts the caught error into the
            // same friendly error chunk format useChat expects. Without this, the
            // frontend transport only sees the run go to FAILED and emits a silent
            // abort, leaving the user stuck on a Stop button with no message.
            if (!streamPiped) {
              try {
                const errorStream = createUIMessageStream({
                  onError: (err) => {
                    if (err instanceof ChatSDKError) {
                      return typeof err.cause === "string"
                        ? err.cause
                        : err.message;
                    }
                    return failureMessage ?? getUserFriendlyProviderError(err);
                  },
                  execute: async () => {
                    throw error;
                  },
                });
                const {
                  stream: errorTriggerMirror,
                  waitUntilComplete: waitForErrorStream,
                } = agentUiStream.pipe(errorStream);
                await Promise.all([
                  waitForErrorStream(),
                  drainPipedTriggerMirror(errorTriggerMirror),
                ]);
              } catch (pipeErr) {
                console.error(
                  "[agent-long] Failed to emit synthetic error stream:",
                  pipeErr,
                );
              }
            }

            await phLogger.flush().catch(() => {});
            throw error;
          } finally {
            await drainHackTools();
            if (claimCancellation.stopped) {
              metadata.set(
                "claimStopFinalization",
                await preModelStopFinalizer.finish(),
              );
            }
            stopClaimWatcher?.();
            detachTriggerAbort();
            runCleanupMap.delete(ctx.run.id);
            const terminalClaim = workerClaimId
              ? { userId, chatId, claimId: workerClaimId, runId: ctx.run.id }
              : (claimCancellation.releaseBinding ??
                (hackLifecycle
                  ? {
                      userId,
                      chatId,
                      claimId: hackLifecycle.binding.claimId,
                      runId: ctx.run.id,
                    }
                  : undefined));
            let hackCleanupConfirmed = false;
            if (hackExecutionDrain) {
              let cleanupStage = "remote_exit";
              try {
                await settleExecutionDrain({
                  drain: hackExecutionDrain,
                  closeIntegrations: closeMcpToolsOnce,
                  recordLocalDrain: () => {
                    metadata.set("cleanupDrained", true);
                  },
                  stage: (stage) => {
                    cleanupStage = stage;
                  },
                });
                cleanupStage = "claim_receipt";
                if (terminalClaim?.runId) {
                  hackCleanupConfirmed = await confirmRemoteRunCleanup({
                    ...terminalClaim,
                    runId: terminalClaim.runId,
                  });
                }
                if (
                  hackCleanupConfirmed &&
                  hackBinding &&
                  terminalClaim &&
                  payload.dispatchId
                ) {
                  cleanupStage = "hack_receipt";
                  hackCleanupConfirmed = await recordHackRunCleanup({
                    ...terminalClaim,
                    dispatchId: payload.dispatchId,
                    runId: ctx.run.id,
                    ...(hackLifecycle
                      ? { workerEntryId: hackLifecycle.binding.workerEntryId }
                      : {}),
                  });
                }
              } catch (cleanupError) {
                const failure = {
                  stage: cleanupStage,
                  errorName:
                    cleanupError instanceof Error
                      ? cleanupError.name.slice(0, 80)
                      : "UnknownError",
                };
                metadata.set("cleanupFailure", failure);
                console.warn(
                  JSON.stringify({
                    timestamp: new Date().toISOString(),
                    level: "warn",
                    event: "agent_cleanup_unconfirmed",
                    service: "agent-long",
                    environment: ctx.environment.type,
                    trace_id: ctx.run.id,
                    ...failure,
                  }),
                );
                // A worker deadline or unavailable exit/ack is not remote Stop proof.
                // Retain the exact execution fence for authoritative reconciliation.
                metadata.set("cleanupStatus", "unconfirmed");
              }
              metadata.set("cleanupConfirmed", hackCleanupConfirmed);
            }
            if (terminalClaim && hackCleanupConfirmed) {
              await releaseAgentRunClaim({
                ...terminalClaim,
                ...(failureMessage ? { failureMessage } : {}),
              }).catch(() => {
                console.error({ event: "agent_long_claim_release_failed" });
              });
            }
            if (
              terminalClaim?.runId &&
              !payload.temporary &&
              hackCleanupConfirmed
            ) {
              try {
                await setActiveTriggerRun({
                  chatId,
                  triggerRunId: null,
                  expectedRunId: terminalClaim.runId,
                });
              } catch (error) {
                console.error(
                  "[agent-long] failed to clear active_trigger_run_id:",
                  error,
                );
              }
            }
            if (payload.scheduledRun) {
              const finalStatus = claimCancellation.terminalStatus(
                triggerSignal.aborted,
                scheduledRunOutcome,
              );
              await retry
                .onThrow(
                  () =>
                    finishScheduledRun({
                      executionKey: payload.scheduledRun!.executionKey,
                      status: finalStatus,
                      finishedAt: Date.now(),
                      agentRunId: ctx.run.id,
                      chatId,
                      errorMessage:
                        finalStatus === "succeeded"
                          ? undefined
                          : scheduledRunErrorMessage,
                    }),
                  {
                    maxAttempts: 3,
                    factor: 2,
                    minTimeoutInMs: 500,
                    maxTimeoutInMs: 3_000,
                    randomize: true,
                  },
                )
                .catch((error) => {
                  console.error(
                    "[agent-long] failed to persist scheduled run completion:",
                    error,
                  );
                });
            }
          }

          return { chatId, assistantMessageId };
        }),
      hackWorkbenchOnly,
    ),
  });
}

export const agentLongTask = createAgentLongTask("agent-long");
markWorkerModuleReady();
