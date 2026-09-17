import { settleWithJournal } from "@/lib/api/usage-settlement-journal";
import { persistProviderUsage } from "@/lib/api/provider-usage-journal";
import { createHttpToolExecutionDrain } from "@/lib/hack/http-tool-execution-drain";
import {
  admitHackHttpExecution,
  markHackHttpExecutionRunning,
  readHackHttpExecution,
  finishHackHttpExecution,
  isHackHttpExecutionId,
  type HackHttpExecutionBinding,
} from "@/lib/hack/http-execution";
import { runTrackedPreflight } from "@/lib/rate-limit/preflight";
import { resolveChatRunFinalization } from "./chat-run-finalization";
import { createChatStreamErrorHandler } from "./chat-stream-error";
import {
  parseWorkingFileContext,
  appendWorkingFileSystemContext,
} from "@/lib/desktop/working-file-context";
import { parseApprovalMode } from "@/lib/ai/approval/policy";
import { createToolApprovalGate } from "@/lib/ai/approval/server";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  UIMessage,
} from "ai";
import { systemPrompt } from "@/lib/system-prompt";
import { getLocalPlanPromptContext } from "@/lib/api/local-plan-prompt-context";
import { getResumeSection } from "@/lib/system-prompt/resume";
import { AGENT_MAX_STREAM_DURATION_MS } from "@/lib/chat/stop-conditions";
import { createTools } from "@/lib/ai/tools";
import { startRunRecord, finishRunRecord } from "@/lib/ai/runs/run-recorder";
import { extractLatestUserRequest } from "@/lib/ai/tools/find-skills";
import { loadUserMcpTools } from "@/lib/ai/mcp/load-user-mcp-tools";
import { loadUserGithubToken } from "@/lib/github/load-user-github-token";
import { prepareCloudProjectRepository } from "@/lib/github/prepare-project-repository";
import {
  injectSkillsIntoMessages,
  loadEnabledSkillsForRuntime,
} from "@/lib/ai/skills/inject-skills";
import { ptySessionManager } from "@/lib/ai/tools/utils/pty-session-manager";
import { generateTitleFromUserMessageWithWriter } from "@/lib/actions";
import { getUserIDAndPro } from "@/lib/auth/get-user-id";
import {
  assertHackWorkbenchAccess,
  assertHackWorkbenchPurposeRoute,
} from "@/lib/auth/premium-access";
import { assertUserCanMakeCostIncurringRequest } from "@/lib/suspensions";
import type {
  ChatMode,
  Todo,
  SandboxPreference,
  SelectedModel,
  RateLimitInfo,
} from "@/types";
import {
  coerceSelectedModel,
  coerceChatPurpose,
  resolveBuildReasoningEffort,
  resolveImageModel,
  resolveVideoModel,
} from "@/types";
import type { ChatPurpose } from "@/types";
import { getBaseTodosForRequest } from "@/lib/utils/todo-utils";
import {
  acquireFreeRunConcurrencyLock,
  checkFreeMonthlyCostLimit,
  checkRateLimit,
  deductUsage,
  deductBalanceUsage,
  recordFreeMonthlyCost,
  UsageRefundTracker,
} from "@/lib/rate-limit";
import { createRequestBudgetMonitor } from "@/lib/chat/budget-monitor";
import { UsageTracker } from "@/lib/usage-tracker";
import { getMaxTokensForSubscription } from "@/lib/token-utils";
import { countTokens } from "gpt-tokenizer";
import { ChatSDKError } from "@/lib/errors";
import PostHogClient from "@/app/posthog";
import {
  captureAgentCompletionAnalytics,
  captureToolCalls,
  captureUsageCost,
  createChatLogger,
  shutdownPostHog,
  type ChatLogger,
} from "@/lib/api/chat-logger";
import {
  countFileAttachments,
  sendRateLimitWarnings,
  isProviderApiError,
  computeContextUsage,
  writeContextUsage,
  isContextUsageEnabled,
  SummarizationTracker,
  appendSystemReminderToLastUserMessage,
  injectNotesIntoMessages,
  assertFreeAgentGates,
  buildExtraUsageConfig,
  estimatePreflightInputTokens,
  getRetryFallbackModel,
} from "@/lib/api/chat-stream-helpers";
import { getExtraUsageBalance } from "@/lib/extra-usage";
import { geolocation } from "@vercel/functions";
import { NextRequest } from "next/server";
import {
  handleInitialChatAndUserMessage,
  saveMessage,
  updateChat,
  getMessagesByChatId,
  getUserCustomization,
  prepareForNewStream,
  startStream,
  startTempStream,
  deleteTempStreamForBackend,
} from "@/lib/db/actions";
import {
  createCancellationSubscriber,
  createPreemptiveTimeout,
} from "@/lib/utils/stream-cancellation";
import { v4 as uuidv4 } from "uuid";
import {
  processChatMessages,
  selectModel,
  addAuthMessage,
} from "@/lib/chat/chat-processor";
import { getModerationResult } from "@/lib/moderation";
import { summarizeIncompleteToolParts } from "@/lib/chat/tool-abort-utils";
import { createTrackedProvider } from "@/lib/ai/providers";
import {
  uploadSandboxFiles,
  getUploadBasePath,
  rewriteSandboxFilePathsInMessages,
  stripLocalDesktopSourcePaths,
} from "@/lib/utils/sandbox-file-utils";
import { getEmptyProcessedMessagesCause } from "@/lib/utils/local-attachment-messages";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import {
  writeUploadStartStatus,
  writeUploadCompleteStatus,
  writeAutoContinue,
} from "@/lib/utils/stream-writer-utils";
import { Id } from "@/convex/_generated/dataModel";
import { getMaxStepsForUser } from "@/lib/chat/chat-processor";
import { phLogger } from "@/lib/posthog/server";
import {
  extractErrorDetails,
  getUserFriendlyProviderError,
} from "@/lib/utils/error-utils";
import { isAgentMode } from "@/lib/utils/mode-helpers";
import {
  createAgentStream,
  initAgentStreamState,
  resetAgentProviderAttempt,
  type AgentStreamContext,
} from "@/lib/api/agent-stream-runner";
import { resolveForcedFirstToolName } from "@/lib/api/agent-step-tool-choice";
import { FREE_RUN_LOCK_TTL_SECONDS } from "@/lib/rate-limit/free-config";
import {
  projectAgentAssignmentReminder,
  projectGithubRepositoryReminder,
  resolveProjectRuntimeContext,
  resolveChatSandboxNamespace,
} from "@/lib/projects/project-runtime";
import { appendActiveGoalSystemContext } from "@/lib/api/active-goal-context";
import { extractLatestUserImageReferenceUrls } from "@/lib/ai/media-references";
import { resolveMediaRequest } from "@/lib/ai/media-intent";
import { AGENT_LONG_HEARTBEAT_PART_TYPE } from "@/lib/chat/agent-long-heartbeat";
import { resolveAgentAutoContinueReason } from "@/lib/chat/auto-continue-policy";
import {
  extractAgentRuntimeRequest,
  renderActiveAgentWorkflowReminder,
  resolveAgentRuntimePolicy,
  resolveActiveAgentModelSelection,
} from "@/lib/ai/agents/runtime-policy";

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch (_) {
    return null;
  }
}

export { getStreamContext };

export const createChatHandler = ({
  grok45Canary = false,
  hackWorkbenchOnly = false,
  forcedPurpose,
  studioSettings,
  onProducerFinished,
  agentPreemptiveTimeoutMs,
  agentReportingReserveMs,
  preemptiveTimeoutEndpoint = "/api/chat",
}: {
  grok45Canary?: boolean;
  hackWorkbenchOnly?: boolean;
  forcedPurpose?: ChatPurpose;
  studioSettings?: import("@/lib/console/workspaces-contract").StudioSettings;
  /** Trusted workspace hook, called after producer persistence and cleanup. */
  onProducerFinished?: (status: "completed" | "failed") => Promise<void>;
  /**
   * Optional wall-clock lifecycle for agent requests. This is intentionally
   * shorter than the route's platform ceiling so the normal abort/onFinish
   * pipeline has time to persist output and reconcile credits.
   */
  agentPreemptiveTimeoutMs?: number;
  /** Hack-only reporting time within the existing lifecycle deadline. */
  agentReportingReserveMs?: number;
  preemptiveTimeoutEndpoint?: "/api/chat" | "/api/hack-chat";
} = {}) => {
  return async (req: NextRequest) => {
    const endpoint = "/api/chat" as const;
    const requestStartedAt = Date.now();
    let preemptiveTimeout:
      | ReturnType<typeof createPreemptiveTimeout>
      | undefined;
    let detachRequestAbort: (() => void) | undefined;
    const userStopSignal = new AbortController();
    let httpExecution: HackHttpExecutionBinding | undefined;
    let initialPersistence: Promise<unknown> | undefined;
    let earlyCancellation:
      | Awaited<ReturnType<typeof createCancellationSubscriber>>
      | undefined;
    let subscriberStopped = false;
    let executionFinished = false;
    const httpPtyScope = (binding: HackHttpExecutionBinding) =>
      JSON.stringify([binding.userId, binding.chatId, binding.executionId]);
    const httpToolDrain = createHttpToolExecutionDrain({
      runInScope: (callback) =>
        httpExecution
          ? ptySessionManager.withConfirmedScope(
              httpPtyScope(httpExecution),
              callback,
            )
          : callback(),
    });
    let httpDrainPromise: Promise<void> | undefined;
    const drainHttpExecution = () => {
      if (!httpExecution) return Promise.resolve();
      const binding = httpExecution;
      // SDK stream abort does not await every tool callback. Seal against new
      // calls and join existing tools before saving results or acknowledging Stop.
      return (httpDrainPromise ??= (async () => {
        // A tool can be waiting for terminal exit. Initiate terminal shutdown
        // while joining tools rather than deadlocking behind that tool promise.
        const results = await Promise.allSettled([
          httpToolDrain.closeAndWait(),
          ptySessionManager.withConfirmedScope(httpPtyScope(binding), () =>
            ptySessionManager.closeAllConfirmed(binding.chatId),
          ),
        ]);
        const failed = results.find((result) => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
        ptySessionManager.releaseConfirmedScope(httpPtyScope(binding));
      })());
    };
    const assertHttpExecutionActive = async () => {
      if (!httpExecution) return;
      const status = await readHackHttpExecution(httpExecution);
      if (
        !status ||
        status.stopped ||
        (status.phase !== "admitted" && status.phase !== "running")
      ) {
        userStopSignal.abort();
        throw new DOMException(
          "The Hack execution is no longer active",
          "AbortError",
        );
      }
      userStopSignal.signal.throwIfAborted();
    };
    const finishHttpExecutionOnce = async () => {
      if (!httpExecution || executionFinished) return;
      // Initial message persistence may still be in flight after a preflight
      // failure. Never release the execution head ahead of that write.
      await drainHttpExecution();
      await initialPersistence?.catch(() => {});
      await earlyCancellation?.stop();
      executionFinished = await finishHackHttpExecution(httpExecution);
    };
    const stoppedHttpResponse = (executionId: string) =>
      createUIMessageStreamResponse({
        stream: createUIMessageStream({
          execute: ({ writer }) => {
            writer.write({ type: "abort" });
          },
        }),
        headers: { "x-rift-execution-id": executionId },
      });

    const clearLifecycleGuards = () => {
      preemptiveTimeout?.clear();
      detachRequestAbort?.();
      detachRequestAbort = undefined;
    };

    // Track usage deductions for refund on error
    const usageRefundTracker = new UsageRefundTracker();

    // Wide event logger for structured logging
    let chatLogger: ChatLogger | undefined;
    let outerChatId: string | undefined;
    let releaseFreeRunLock: (() => Promise<void>) | undefined;
    // MCP connector teardown. Assigned once the user's MCP servers connect
    // inside execute(); closed at the same terminal points as the free-run lock
    // so transports survive provider-fallback retry legs but are always torn
    // down when the run truly ends. Idempotent + best-effort.
    let closeMcpToolsOnce: () => Promise<void> = async () => {};
    let verifiedAccess: Awaited<ReturnType<typeof getUserIDAndPro>> | undefined;
    const releaseFreeRunLockOnce = async () => {
      const release = releaseFreeRunLock;
      if (!release) return;
      releaseFreeRunLock = undefined;
      await release();
    };

    try {
      // Restricted routes authenticate and authorize before parsing the body or
      // touching persistence, limits, tools, or model providers. The API
      // repeats this check on every request so a direct POST or mid-session
      // downgrade cannot bypass the page gate.
      if (hackWorkbenchOnly) {
        verifiedAccess = await getUserIDAndPro(req);
        assertHackWorkbenchAccess(verifiedAccess.subscription);
      }

      const {
        messages,
        mode,
        todos,
        chatId,
        regenerate,
        temporary,
        sandboxPreference,
        selectedModel: rawSelectedModel,
        reasoningEffort: rawReasoningEffort,
        approvalMode: rawApprovalMode,
        purpose: rawPurpose,
        projectId: rawProjectId,
        activeGoal: rawActiveGoal,
        workingFile: rawWorkingFile,
        isAutoContinue,
        useClientMessagesForRegenerate,
        executionId: rawExecutionId,
      }: {
        messages: UIMessage[];
        mode: ChatMode;
        chatId: string;
        todos?: Todo[];
        regenerate?: boolean;
        temporary?: boolean;
        sandboxPreference?: SandboxPreference;
        selectedModel?: string;
        reasoningEffort?: unknown;
        approvalMode?: unknown;
        purpose?: string;
        projectId?: unknown;
        activeGoal?: unknown;
        workingFile?: unknown;
        isAutoContinue?: boolean;
        useClientMessagesForRegenerate?: boolean;
        executionId?: unknown;
      } = await req.json();
      let approvalMode;
      try {
        approvalMode = parseApprovalMode(rawApprovalMode);
      } catch {
        return new Response("Invalid approval mode", { status: 400 });
      }
      let workingFile;
      try {
        workingFile = parseWorkingFileContext(rawWorkingFile);
      } catch {
        return new Response("Invalid working file selection", { status: 400 });
      }
      outerChatId = chatId;

      const selectedModelOverride: SelectedModel | undefined =
        coerceSelectedModel(rawSelectedModel ?? null) ?? undefined;
      const requestedPurpose: ChatPurpose =
        forcedPurpose ?? coerceChatPurpose(rawPurpose ?? "app");

      chatLogger = createChatLogger({ chatId, endpoint });
      chatLogger.setRequestDetails({
        mode,
        isTemporary: !!temporary,
        isRegenerate: !!regenerate,
      });

      const { userId, subscription, organizationId, pricingMargin } =
        verifiedAccess ?? (await getUserIDAndPro(req));

      if (hackWorkbenchOnly && !temporary) {
        if (!isHackHttpExecutionId(rawExecutionId)) {
          return new Response("Invalid execution identity", { status: 400 });
        }
        if (workingFile)
          return new Response("Working files require Build mode", {
            status: 400,
          });
        const binding = { userId, chatId, executionId: rawExecutionId };
        const admission = await admitHackHttpExecution(binding);
        if (!admission.admitted) {
          if (admission.reason === "stopped" && admission.status?.canceled) {
            return stoppedHttpResponse(binding.executionId);
          }
          return Response.json(
            {
              error: "A Hack execution is already active",
              executionId: rawExecutionId,
            },
            { status: 409 },
          );
        }
        httpExecution = binding;
        earlyCancellation = await createCancellationSubscriber({
          chatId,
          execution: binding,
          isTemporary: false,
          abortController: userStopSignal,
          onStop: () => {
            subscriberStopped = true;
          },
        });
        await assertHttpExecutionActive();
      }

      // Parallelize the independent preflight reads — none depends on another's
      // result, yet they used to run serially (~30-80ms each) on the
      // first-token critical path. The suspension assert still throws first if
      // it rejects (Promise.all rejects fast); the two reads are cheap and
      // discarded if it does.
      const contextBalancePromise =
        subscription === "free"
          ? getExtraUsageBalance(userId)
          : Promise.resolve(null);
      const [, userCustomization, fetched, extraUsageBalance] =
        await Promise.all([
          assertUserCanMakeCostIncurringRequest(userId),
          getUserCustomization({ userId }),
          contextBalancePromise.then((balance) =>
            getMessagesByChatId({
              chatId,
              userId,
              subscription,
              newMessages: messages,
              regenerate,
              isTemporary: temporary,
              mode,
              useClientMessagesForRegenerate,
              context: {
                model: selectedModelOverride,
                purpose: requestedPurpose,
                hasPaidContext: (balance?.balancePoints ?? 0) > 0,
              },
            }),
          ),
          // Used only to decide whether the free-run concurrency lock applies.
          contextBalancePromise,
        ]);

      usageRefundTracker.setUser(userId, subscription, organizationId);
      // The free-run concurrency lock exists to cap concurrent free-allowance
      // runs. Everyone is subscription "free" now, so gate it on actually
      // relying on the free allowance: a user with a usable token balance is a
      // paying user and must never hit "you already have a free request running".
      // A positive token balance = a paying user. Do NOT also require the
      // legacy extra_usage_enabled toggle — buying tokens never sets it, so
      // requiring it would hard-lock paying users out of their own usage.
      const hasUsableBalance =
        !!extraUsageBalance && extraUsageBalance.balancePoints > 0;
      if (subscription === "free" && !hasUsableBalance) {
        const lock = await acquireFreeRunConcurrencyLock(
          userId,
          FREE_RUN_LOCK_TTL_SECONDS,
        );
        releaseFreeRunLock = lock.release;
      }
      const userLocation = geolocation(req);

      // Add user context to logger (only region, not full location for privacy)
      chatLogger.setUser({
        id: userId,
        subscription,
        region: userLocation?.region,
      });

      assertFreeAgentGates({
        mode,
        subscription,
        sandboxPreference,
        rawSelectedModel,
      });

      // Pre-emptive abort fires before Vercel's hard request timeout so we
      // can flush logs, persist output, and reconcile usage. Most agent routes
      // use elapsedTimeExceeds at step boundaries; routes that pass an explicit
      // budget also get this wall-clock guard for a step/tool that never settles.
      if (isAgentMode(mode) && agentPreemptiveTimeoutMs !== undefined) {
        preemptiveTimeout = createPreemptiveTimeout({
          chatId,
          endpoint: preemptiveTimeoutEndpoint,
          abortController: userStopSignal,
          maxStreamTimeMs: agentPreemptiveTimeoutMs,
          startTime: requestStartedAt,
        });
      } else if (!isAgentMode(mode)) {
        preemptiveTimeout = createPreemptiveTimeout({
          chatId,
          endpoint: preemptiveTimeoutEndpoint,
          abortController: userStopSignal,
          startTime: requestStartedAt,
        });
      }

      // Persistent chats deliberately survive a disconnected HTTP request so
      // resumable streams can reconnect. Temporary chats cannot resume, so it
      // is safe (and cheaper) to forward their request cancellation.
      if (temporary) {
        const abortFromRequest = () => {
          if (!userStopSignal.signal.aborted) {
            userStopSignal.abort(req.signal.reason);
          }
        };
        req.signal.addEventListener("abort", abortFromRequest, { once: true });
        detachRequestAbort = () =>
          req.signal.removeEventListener("abort", abortFromRequest);
        if (req.signal.aborted) {
          abortFromRequest();
        }
      }

      const { chat, isNewChat } = fetched;
      let { fileTokens } = fetched;
      const projectRuntime = await resolveProjectRuntimeContext({
        userId,
        chat,
        requestedProject: rawProjectId,
        requestedPurpose,
      });
      if (forcedPurpose && projectRuntime.purpose !== forcedPurpose) {
        throw new ChatSDKError(
          "forbidden:chat",
          "The selected project is not available in this mode.",
        );
      }
      const purpose: ChatPurpose = forcedPurpose ?? projectRuntime.purpose;
      if (workingFile && purpose !== "app") {
        return new Response("Working files require Build mode", {
          status: 400,
        });
      }
      assertHackWorkbenchPurposeRoute(
        purpose,
        hackWorkbenchOnly && forcedPurpose === "security",
      );
      // Image attachments are available to every signed-in user (the composer's
      // attach button advertises this — no plan gate), matching the upload flow.
      // Previously stripped for `subscription === "free"`, but since the
      // subscription tier collapsed to "free" for everyone that stripped images
      // for paying members too — the model then received the "attachment hidden"
      // placeholder and replied "it's behind a paywall".
      let truncatedMessages = fetched.truncatedMessages;

      const baseTodos: Todo[] = getBaseTodosForRequest(
        (chat?.todos as unknown as Todo[]) || [],
        Array.isArray(todos) ? todos : [],
        { isTemporary: !!temporary, regenerate },
      );

      const extraUsageConfigPromise = buildExtraUsageConfig({
        userId,
        subscription,
        userCustomization,
        organizationId,
      });
      // Observe failure while model/profile preparation is still in flight.
      void extraUsageConfigPromise.catch(() => {});

      // PAYG: the daily-free vs prepaid-balance routing needs the input-token
      // estimate + extra-usage config, so the rate-limit check runs once below
      // (after token counting) for every tier — no separate free-ask pre-flight.
      const uploadBasePath = isAgentMode(mode)
        ? getUploadBasePath(sandboxPreference)
        : undefined;
      const requestTextForAgentPolicy = [
        projectRuntime.agentMention,
        extractAgentRuntimeRequest(truncatedMessages, isAutoContinue),
      ]
        .filter((value): value is string => Boolean(value))
        .join(" ");
      const enabledSkillsRuntimeLoad =
        isAgentMode(mode) && purpose === "app"
          ? await loadEnabledSkillsForRuntime(userId)
          : undefined;
      const enabledSkillsForAgentRuntime = enabledSkillsRuntimeLoad?.skills;
      const agentRuntimePolicy = isAgentMode(mode)
        ? resolveAgentRuntimePolicy(
            enabledSkillsForAgentRuntime ?? [],
            requestTextForAgentPolicy,
            {
              rosterAvailable:
                enabledSkillsRuntimeLoad?.status !== "unavailable",
              boundProfile: projectRuntime.botProfile,
              boundSkills: projectRuntime.botSkills,
              boundMeeting: projectRuntime.botMeeting,
            },
          )
        : undefined;
      const runtimeModelOverride = agentRuntimePolicy
        ? resolveActiveAgentModelSelection(
            agentRuntimePolicy,
            selectedModelOverride,
          )
        : selectedModelOverride;

      const contextModel = selectModel(
        mode,
        subscription,
        runtimeModelOverride,
        undefined,
        purpose,
        grok45Canary,
      );
      const resolvedContext = {
        mode,
        model: contextModel,
        hasPaidContext: hasUsableBalance,
      };
      const fetchedContext = {
        mode,
        model: selectedModelOverride,
        purpose,
        hasPaidContext: hasUsableBalance,
      };
      if (
        getMaxTokensForSubscription(subscription, resolvedContext) !==
        getMaxTokensForSubscription(subscription, fetchedContext)
      ) {
        const retargeted = await getMessagesByChatId({
          chatId,
          userId,
          subscription,
          newMessages: messages,
          regenerate,
          isTemporary: temporary,
          mode,
          useClientMessagesForRegenerate,
          context: resolvedContext,
        });
        truncatedMessages = retargeted.truncatedMessages;
        fileTokens = retargeted.fileTokens;
      }

      // Persistence (saveChat + saveMessage) and the extra-usage config read
      // are independent of model selection / token counting, so kick them off
      // now and let them overlap the message processing + rate-limit work below
      // instead of stacking their round-trips serially before the first token.
      await assertHttpExecutionActive();
      const persistencePromise: Promise<unknown> = temporary
        ? Promise.resolve(undefined)
        : handleInitialChatAndUserMessage({
            chatId,
            userId,
            messages: stripLocalDesktopSourcePaths(truncatedMessages),
            regenerate,
            chat,
            isHidden: isAutoContinue ? true : undefined,
            purpose,
            projectId: projectRuntime.projectId,
          });
      // Always observe the rejection at creation so that if an earlier preflight
      // await (rate-limit exhaustion, ownership throw, token estimation, …)
      // throws before we reach the real `await persistencePromise` below, the
      // orphaned promise can't surface as an UnhandledPromiseRejection and take
      // down the serverless function. The real await still re-throws on the
      // happy path, so error surfacing + ordering are preserved.
      initialPersistence = persistencePromise;
      void persistencePromise.catch(() => {});

      let { processedMessages, selectedModel, sandboxFiles } =
        await processChatMessages({
          messages: truncatedMessages,
          mode,
          userId,
          subscription,
          uploadBasePath,
          modelOverride: runtimeModelOverride,
          purpose,
          grok45Canary,
          allowLocalDesktopFiles:
            isAgentMode(mode) && sandboxPreference === "desktop",
          // Run moderation concurrently with estimation + rate-limit below.
          deferModeration: true,
        });
      const reasoningEffort =
        purpose === "app"
          ? resolveBuildReasoningEffort(
              selectedModel,
              agentRuntimePolicy?.activeProfile?.reasoningEffort ??
                rawReasoningEffort,
            )
          : undefined;

      // Empty after processing → Gemini rejects with "must include at least one parts field".
      if (!processedMessages || processedMessages.length === 0) {
        throw new ChatSDKError(
          "bad_request:api",
          getEmptyProcessedMessagesCause(truncatedMessages),
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

      // Capture the moderation input synchronously now (single-threaded JS reads
      // the messages before the first await), then let the HTTPS round-trip
      // resolve in parallel with token estimation and the rate-limit check.
      const moderationPromise = getModerationResult(
        processedMessages,
        subscription !== "free",
        { signal: userStopSignal.signal },
      );

      // Attach immediately: Stop may reject before preflight joins this promise.
      void moderationPromise.catch(() => undefined);

      const memoryEnabled =
        (subscription !== "free" || isAgentMode(mode)) &&
        (userCustomization?.include_memory_entries ?? true);

      const estimatedInputTokens = await estimatePreflightInputTokens({
        mode,
        purpose,
        subscription,
        userId,
        selectedModel,
        userCustomization,
        temporary,
        truncatedMessages,
      });

      const fileCounts = countFileAttachments(truncatedMessages);
      chatLogger.setChat(
        {
          messageCount: truncatedMessages.length,
          estimatedInputTokens,
          isNewChat,
          fileCount: fileCounts.totalFiles,
          imageCount: fileCounts.imageCount,
          memoryEnabled,
        },
        selectedModel,
      );

      const extraUsageConfig = await extraUsageConfigPromise;

      // All setup branches settle before errors reach the refund handler.
      // A slower reservation must not charge after a parallel failure escaped.
      await assertHttpExecutionActive();
      const [rateLimitInfo, freeMonthlyBudgetSnapshot, moderationResult] =
        await runTrackedPreflight({
          reserve: () =>
            checkRateLimit(
              userId,
              mode,
              subscription,
              estimatedInputTokens,
              extraUsageConfig,
              selectedModel,
              organizationId,
              undefined,
              undefined,
              pricingMargin,
            ),
          snapshot: () =>
            subscription === "free"
              ? checkFreeMonthlyCostLimit(userId, { throwOnExhaustion: false })
              : Promise.resolve(null),
          moderation: moderationPromise,
          tracker: usageRefundTracker,
          agentMode: isAgentMode(mode),
        });

      // Apply the moderation-gated authorization message before streaming so the
      // model sees it on the very first step (uncensor path must not race).
      // ONLY for the security purpose — the uncensor/authorization preamble is
      // offensive-security framing. Injecting it into image/app modes confuses
      // the model (it starts talking about "pentest authorization" and skips the
      // generate_image / build tools), so those benign purposes never get it.
      if (purpose === "security" && moderationResult?.shouldUncensorResponse) {
        addAuthMessage(processedMessages, moderationResult.moderationText);
      }

      chatLogger.setRateLimit(
        {
          pointsDeducted: rateLimitInfo.pointsDeducted,
          extraUsagePointsDeducted: rateLimitInfo.extraUsagePointsDeducted,
          monthly: rateLimitInfo.monthly,
          remaining: rateLimitInfo.remaining,
          subscription,
        },
        extraUsageConfig,
      );

      // PostHog client for analytics (initialized once, used at end of request)
      const posthog = PostHogClient();

      const assistantMessageId = uuidv4();
      chatLogger.getBuilder().setAssistantId(assistantMessageId);

      if (temporary) {
        try {
          await startTempStream({ chatId, userId });
        } catch {
          // Best-effort; temp coordination must not block the request.
        }
      }

      // Start cancellation subscriber (Redis pub/sub with fallback to polling)
      const cancellationSubscriber =
        earlyCancellation ??
        (await createCancellationSubscriber({
          chatId,
          isTemporary: !!temporary,
          abortController: userStopSignal,
          onStop: () => {
            subscriberStopped = true;
          },
        }));

      const summarizationTracker = new SummarizationTracker();

      // Ensure the chat row + user message are durably saved before streaming —
      // the assistant-message save in onFinish depends on them. This was kicked
      // off near the top and has overlapped all the preflight work above, so by
      // now it is almost always already settled (near-zero added latency).
      await persistencePromise;
      await assertHttpExecutionActive();
      if (
        httpExecution &&
        !(await markHackHttpExecutionRunning(httpExecution))
      ) {
        await assertHttpExecutionActive();
        throw new Error(
          "Hack execution stream binding could not be established",
        );
      }

      chatLogger.startStream();

      const stream = createUIMessageStream({
        onError: createChatStreamErrorHandler(chatLogger),
        execute: async ({ writer }) => {
          try {
            await assertHttpExecutionActive();
            // Prove the bounded request is alive before database/MCP/provider
            // preflight. This moves useChat from "submitted" to "streaming"
            // immediately and gives the user a real reasoning indicator even
            // when provider setup is slow. The client already strips these
            // transient heartbeat parts before the next model request.
            writer.write({
              type: AGENT_LONG_HEARTBEAT_PART_TYPE,
              data: { at: Date.now() },
            });

            sendRateLimitWarnings(writer, {
              subscription,
              mode,
              rateLimitInfo,
            });

            // MCP registry only at startup; integrations connect during discovery.
            // Fetch independent Git credentials concurrently for sandbox git.
            const [mcpLoaded, githubConn] = await Promise.all([
              loadUserMcpTools(
                userId,
                agentRuntimePolicy?.activeProfile?.mcpServerIds,
                { lazy: true },
              ),
              loadUserGithubToken(userId),
            ]);
            let mcpClosed = false;
            closeMcpToolsOnce = async () => {
              if (mcpClosed) return;
              mcpClosed = true;
              await mcpLoaded.close();
            };

            // Opens the durable record of this run. Best-effort: if it cannot
            // be opened the request runs exactly as before, just unrecorded.
            const runRecorder = temporary
              ? undefined
              : await startRunRecord({
                  runId: assistantMessageId,
                  chatId,
                  userId,
                  mode,
                  purpose,
                  surface:
                    purpose === "security"
                      ? "hack"
                      : purpose === "image"
                        ? "studio"
                        : "build",
                  goal: authoritativeUserRequest,
                  // The concrete model is resolved later; the run record is
                  // updated with the outcome when it closes.
                  messageId: assistantMessageId,
                });

            const approvalGate = createToolApprovalGate({
              userId,
              chatId,
              runId: assistantMessageId,
              mode: approvalMode,
            });
            const {
              tools,
              getSandbox,
              ensureSandbox,
              getTodoManager,
              getFileAccumulator,
              sandboxManager,
              getSandboxSessionCost,
              setCurrentModelName,
              setProjectWorkingDirectory,
              getToolsForModel,
              isAppBuildComplete,
            } = createTools(
              userId,
              chatId,
              writer,
              mode,
              userLocation,
              baseTodos,
              memoryEnabled,
              temporary,
              assistantMessageId,
              sandboxPreference,
              process.env.CONVEX_SERVICE_ROLE_KEY,
              userCustomization?.guardrails_config,
              // Caido proxy temporarily disabled for all users.
              // Was: subscription !== "free" && (userCustomization?.caido_enabled ?? false)
              false,
              undefined, // caido_port (disabled)
              undefined, // appendMetadataStream
              (costDollars: number) => {
                usageTracker.providerCost += costDollars;
                usageTracker.nonModelCost += costDollars;
                chatLogger?.getBuilder().addToolCost(costDollars);
              },
              subscription,
              (info) => chatLogger?.setSandboxBoot(info),
              (info) => chatLogger?.setCaidoReady(info),
              selectedModel,
              {
                discover: mcpLoaded.discover,
                all: mcpLoaded.tools,
                planReadOnly: mcpLoaded.planReadOnlyTools,
                byServerId: mcpLoaded.toolsByServerId,
                planReadOnlyByServerId: mcpLoaded.planReadOnlyToolsByServerId,
              },
              // Media Studio picker selections are resolved against the
              // product allowlist before entering either generation tool.
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
              undefined,
              approvalGate,
              workingFile,
              httpExecution ? assertHttpExecutionActive : undefined,
              agentRuntimePolicy?.profileSkills
                ? []
                : enabledSkillsForAgentRuntime,
              httpExecution ? httpToolDrain.wrap : undefined,
              studioSettings,
            );

            await assertHttpExecutionActive();
            let preparedRepository;
            if (isAgentMode(mode) && projectRuntime.githubRepository) {
              try {
                preparedRepository = await prepareCloudProjectRepository({
                  repository: projectRuntime.githubRepository,
                  sandboxNamespace: projectRuntime.sandboxNamespace,
                  executionPreference: sandboxPreference,
                  connection: githubConn,
                  ensureSandbox,
                  signal: userStopSignal.signal,
                });
                setProjectWorkingDirectory(preparedRepository?.path);
              } catch (error) {
                clearLifecycleGuards();
                await usageRefundTracker.refund();
                if (runRecorder) {
                  await finishRunRecord({
                    runId: runRecorder.runId,
                    status: "failed",
                    error:
                      "The selected GitHub repository could not be prepared.",
                    messageId: assistantMessageId,
                    totalTokens: 0,
                  });
                }
                if (error instanceof ChatSDKError) {
                  chatLogger?.emitChatError(error);
                } else {
                  chatLogger?.emitUnexpectedError(error);
                }
                throw error;
              }
            }

            // Helper to send file metadata via stream for resumable stream clients
            // Uses accumulated metadata directly - no DB query needed!
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

            // Local Plan needs the selected computer's OS facts, but never
            // Agent command instructions. This validates the existing runner;
            // it does not execute tools or boot a Cloud sandbox for Plan.
            let sandboxContext = await getLocalPlanPromptContext({
              mode,
              purpose,
              preference: sandboxPreference,
              manager: sandboxManager,
              onUnavailable: async (error) => {
                if (!(await usageRefundTracker.refund())) {
                  phLogger.error(
                    "Credit refund failed after local Plan connection error — credits not yet restored",
                    usageRefundTracker.getDeductionSummary(),
                  );
                }
                if (runRecorder) {
                  await finishRunRecord({
                    runId: runRecorder.runId,
                    status: "failed",
                    error: "The selected local runner is unavailable.",
                    messageId: assistantMessageId,
                    totalTokens: 0,
                  });
                }
                chatLogger?.emitChatError(error);
              },
            });
            if (
              isAgentMode(mode) &&
              "getSandboxContextForPrompt" in sandboxManager
            ) {
              try {
                sandboxContext = await (
                  sandboxManager as {
                    getSandboxContextForPrompt: () => Promise<string | null>;
                  }
                ).getSandboxContextForPrompt();
              } catch (error) {
                console.warn(
                  "Failed to get sandbox context for prompt:",
                  error,
                );
              }
            }

            if (isAgentMode(mode) && sandboxFiles && sandboxFiles.length > 0) {
              writeUploadStartStatus(
                writer,
                sandboxFiles.every((file) => file.kind === "localPath")
                  ? "Preparing local attachments on your computer"
                  : "Uploading attachments to the computer",
              );
              let uploadResult: Awaited<ReturnType<typeof uploadSandboxFiles>> =
                {
                  failedCount: 0,
                  pathRewrites: [],
                };
              try {
                await assertHttpExecutionActive();
                uploadResult = await uploadSandboxFiles(
                  sandboxFiles,
                  ensureSandbox,
                );
              } finally {
                writeUploadCompleteStatus(writer);
              }
              if (uploadResult.failedCount > 0) {
                const noun =
                  uploadResult.failedCount === 1 ? "attachment" : "attachments";
                const uploadError = new ChatSDKError(
                  "bad_request:stream",
                  `Failed to upload ${uploadResult.failedCount} ${noun} to the computer. Please try again.`,
                );
                // Errors thrown from execute are caught by createUIMessageStream's
                // onError and never reach the outer catch, so refund / timeout
                // clear / error logging must happen here. refund() is idempotent.
                clearLifecycleGuards();
                if (!(await usageRefundTracker.refund())) {
                  phLogger.error(
                    "Credit refund failed after upload error — credits not yet restored",
                    usageRefundTracker.getDeductionSummary(),
                  );
                }
                chatLogger?.emitChatError(uploadError);
                throw uploadError;
              }
              processedMessages = rewriteSandboxFilePathsInMessages(
                processedMessages,
                uploadResult.pathRewrites,
              );
            }

            // Generate title in parallel only for non-temporary new chats
            await assertHttpExecutionActive();
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

            let currentSystemPrompt = await systemPrompt(
              userId,
              mode,
              subscription,
              selectedModel,
              userCustomization,
              temporary,
              sandboxContext,
              purpose,
            );
            currentSystemPrompt = appendActiveGoalSystemContext(
              currentSystemPrompt,
              rawActiveGoal,
            );

            currentSystemPrompt = appendWorkingFileSystemContext(
              currentSystemPrompt,
              workingFile,
            );

            const systemPromptTokens = countTokens(currentSystemPrompt);

            const contextUsageOn = isContextUsageEnabled(subscription, mode);
            const ctxSystemTokens = contextUsageOn ? systemPromptTokens : 0;
            const ctxMaxTokens = contextUsageOn
              ? getMaxTokensForSubscription(subscription, {
                  mode,
                  model: selectedModel,
                  hasPaidContext: hasUsableBalance,
                })
              : 0;
            // finalMessages will be set in prepareStep if summarization is needed
            let finalMessages = processedMessages;

            // Inject resume context into messages instead of system prompt
            // to keep the system prompt stable for caching
            const resumeContext = getResumeSection(chat?.finish_reason);
            if (resumeContext) {
              finalMessages = appendSystemReminderToLastUserMessage(
                finalMessages,
                resumeContext,
              );
            }

            // Inject notes into messages instead of system prompt
            // to keep the system prompt stable for prompt caching.
            // SECURITY-ONLY: notes are pentest/OSINT findings — irrelevant to
            // Build (app) & Image modes, and injecting that offensive-security
            // content trips Anthropic's real-time content-filter on Claude
            // upstreams (Bedrock/Vertex), which EMPTIES the response
            // (finish_reason:"content-filter", 0 output tokens). That's exactly
            // why Build-mode Claude Fable 5 returned blank. Keep notes to
            // Security mode so Build stays clean and unfiltered.
            const shouldIncludeNotes =
              purpose === "security" &&
              (userCustomization?.include_memory_entries ?? true);
            const noteInjectionOpts = {
              userId,
              subscription,
              shouldIncludeNotes,
              isTemporary: temporary,
            };
            finalMessages = await injectNotesIntoMessages(
              finalMessages,
              noteInjectionOpts,
            );

            // Inject the user's enabled skills (loadable instruction packs) as a
            // <system-reminder>, scoped to the current purpose. Non-fatal.
            finalMessages = await injectSkillsIntoMessages(finalMessages, {
              userId,
              purpose,
              requestText: authoritativeUserRequest,
              enabledSkills: agentRuntimePolicy?.profileSkills
                ? []
                : enabledSkillsForAgentRuntime,
            });
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
            const activeWorkflow = agentRuntimePolicy
              ? renderActiveAgentWorkflowReminder(agentRuntimePolicy, {
                  persistentMention: projectRuntime.agentMention,
                })
              : projectAgentAssignmentReminder(projectRuntime.agentMention);
            if (activeWorkflow) {
              finalMessages = appendSystemReminderToLastUserMessage(
                finalMessages,
                activeWorkflow,
              );
            }

            // Mutable stream state — updated in-place by the shared runner.
            const state = initAgentStreamState(
              finalMessages,
              contextUsageOn
                ? computeContextUsage(
                    truncatedMessages,
                    fileTokens,
                    ctxSystemTokens,
                    ctxMaxTokens,
                  )
                : { usedTokens: 0, maxTokens: 0 },
            );

            // Enforce actual funding even when this request has no monthly bucket.
            const budgetMonitor = createRequestBudgetMonitor({
              rateLimitInfo,
              extraUsageConfig,
              subscription,
              freeMonthlyBudgetSnapshot,
              writer,
            });
            // Build exposes reasoning strength in both Plan/Ask and Agent.
            // Other product surfaces preserve their prior Agent-only policy.
            const isReasoningModel = purpose === "app" || isAgentMode(mode);

            const streamStartTime = Date.now();
            const configuredModelId =
              trackedProvider.languageModel(selectedModel).modelId;

            let isRetryWithFallback = false;
            const isAutoModel = [
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
            let usageSettlementPromise: Promise<void> | undefined;
            // The run's cost/tokens, captured at the moment they are computed
            // authoritatively for billing, so the Run record shows the same
            // figure the usage log does rather than a second, drifting estimate.
            let recordedRunCostDollars: number | undefined;
            let recordedRunTotalTokens: number | undefined;
            // Snapshot cache tokens before fallback retry so we can isolate fallback-only metrics
            let preFallbackCacheRead = 0;
            let preFallbackCacheWrite = 0;

            const deductAccumulatedUsage = (): Promise<void> => {
              if (usageSettlementPromise) return usageSettlementPromise;
              // Share the outcome, including rejection. A missing receipt does not
              // prove that an unkeyed debit failed; replay could charge twice.
              usageSettlementPromise = Promise.resolve().then(async () => {
                try {
                  // Add E2B sandbox session cost (duration-based)
                  const sandboxCost = getSandboxSessionCost();
                  if (sandboxCost > 0) {
                    usageTracker.providerCost += sandboxCost;
                    usageTracker.nonModelCost += sandboxCost;
                    chatLogger?.getBuilder().addToolCost(sandboxCost);
                  }

                  if (!usageTracker.hasUsage) {
                    // No usage data reported — skip deduction
                    return;
                  }
                  const usageCostRecord = usageTracker.createUsageCostRecord({
                    selectedModel,
                    selectedModelOverride,
                    responseModel: state.responseModel,
                    configuredModelId,
                    rateLimitInfo,
                  });
                  recordedRunCostDollars = usageCostRecord.costDollars;
                  recordedRunTotalTokens = usageCostRecord.totalTokens;

                  // Settle the same resolved total that is logged: preserve reported
                  // receipts and estimate only unpriced steps, with margin applied once.
                  const resolvedCost = usageCostRecord.costDollars;
                  await settleWithJournal(
                    {
                      userId,
                      runId: usageJournalRunId,
                      evidence: {
                        version: 1,
                        chatId,
                        operationId: rawExecutionId,
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
                      } else if (rateLimitInfo.servedFrom === "balance") {
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
                          endpoint,
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
                          endpoint,
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
                    endpoint,
                    mode,
                    usage: usageCostRecord,
                  });
                } finally {
                  await releaseFreeRunLockOnce();
                }
              });
              return usageSettlementPromise;
            };

            const requestedForcedToolName = resolveForcedFirstToolName({
              purpose,
              mediaKind: purpose === "image" ? mediaRequest.kind : undefined,
            });
            const forcedToolName =
              requestedForcedToolName && requestedForcedToolName in tools
                ? requestedForcedToolName
                : undefined;
            const hasCompleteBuildLifecycle =
              "verify_app" in tools && "expose_preview" in tools;
            const hasLifecycleTimedOut = () =>
              (preemptiveTimeout?.isPreemptive() ?? false) ||
              (state.stoppedDueToElapsedTimeout &&
                state.streamFinishReason === "timeout");
            const getRunFinalization = (isAborted: boolean) =>
              resolveChatRunFinalization({
                isAborted,
                hardTimedOut: hasLifecycleTimedOut(),
                approvalStopped: approvalGate.isStopped?.() ?? false,
                stoppedDueToElapsedTimeout: state.stoppedDueToElapsedTimeout,
                hasProviderError: state.providerError !== undefined,
                finishReason: state.streamFinishReason,
              });
            // Both the original stream and an earlier-admitted fallback must
            // close the same run with the outcome of their final generation.
            const finishRecordedRun = async (isAborted: boolean) => {
              if (!runRecorder) return;
              const { status, stopReason, finishReason } =
                getRunFinalization(isAborted);
              await finishRunRecord({
                runId: runRecorder.runId,
                status,
                stopReason,
                finishReason,
                messageId: assistantMessageId,
                costDollars: recordedRunCostDollars,
                totalTokens: recordedRunTotalTokens,
              });
            };

            // Shared runner context.
            const usageJournalRunId = runRecorder?.runId ?? generateId();
            const streamCtx: AgentStreamContext = {
              onProviderUsage: (usage, model) =>
                persistProviderUsage({
                  userId,
                  chatId: temporary ? undefined : chatId,
                  runId: usageJournalRunId,
                  model,
                  usage,
                }),
              isApprovalStopped: approvalGate.isStopped,
              trackedProvider,
              currentSystemPrompt,
              tools,
              // Media Studio forces its selected output modality. Build forces
              // read-only skill discovery when that tool remains inside an
              // exact custom-profile allowlist.
              forceFirstToolName: forcedToolName,
              isAppBuildComplete:
                purpose === "app" &&
                mode === "agent" &&
                hasCompleteBuildLifecycle
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
              hasPaidContext: hasUsableBalance,
              streamStartTime,
              contextUsageOn,
              isReasoningModel,
              reasoningEffort,
              maxDurationMs:
                agentPreemptiveTimeoutMs ?? AGENT_MAX_STREAM_DURATION_MS,
              requestDeadlineMs:
                agentPreemptiveTimeoutMs !== undefined
                  ? requestStartedAt + agentPreemptiveTimeoutMs
                  : undefined,
              reportingReserveMs:
                hackWorkbenchOnly && purpose === "security"
                  ? agentReportingReserveMs
                  : undefined,
              writer,
              abortController: userStopSignal,
              onStepStarted: httpExecution
                ? assertHttpExecutionActive
                : undefined,
              summarizationTracker,
              usageTracker,
              budgetMonitor,
              sandboxManager,
              getTodoManager,
              ensureSandbox,
              chatLogger,
              usageRefundTracker,
              getHardTimeoutReason: () =>
                hasLifecycleTimedOut() ? "timeout" : null,
            };

            const createStream = async (modelName: string) => {
              await assertHttpExecutionActive();
              streamCtx.tools = getToolsForModel(modelName);
              setCurrentModelName(modelName);
              return createAgentStream(modelName, streamCtx, state);
            };

            let result;
            try {
              result = await createStream(selectedModel);
            } catch (error) {
              // If provider returns error (e.g., INVALID_ARGUMENT from Gemini), retry with fallback.
              if (
                isProviderApiError(error) &&
                !state.stoppedDueToElapsedTimeout &&
                !isRetryWithFallback &&
                isAutoModel
              ) {
                phLogger.error("Provider API error, retrying with fallback", {
                  error,
                  chatId,
                  endpoint,
                  mode,
                  originalModel: selectedModel,
                  requestedModelSlug: configuredModelId,
                  fallbackModel,
                  fallbackModelSlug: fallbackModelId,
                  userId,
                  subscription,
                  isTemporary: temporary,
                  preFallbackCacheReadTokens: usageTracker.cacheReadTokens,
                  preFallbackCacheWriteTokens: usageTracker.cacheWriteTokens,
                  ...extractErrorDetails(error),
                });

                isRetryWithFallback = true;
                resetAgentProviderAttempt(state, userStopSignal.signal);
                preFallbackCacheRead = usageTracker.cacheReadTokens;
                preFallbackCacheWrite = usageTracker.cacheWriteTokens;
                // Discard the failed primary leg's model usage so the user is
                // only billed for the fallback. Non-model spend (sandbox/tools)
                // is preserved.
                usageTracker.resetModelLeg();
                result = await createStream(fallbackModel);
              } else {
                throw error;
              }
            }

            writer.merge(
              result.toUIMessageStream({
                generateMessageId: () => assistantMessageId,
                messageMetadata: ({ part }) => {
                  if (part.type === "start") {
                    return {
                      mode,
                      createdAt: streamStartTime,
                      generationStartedAt: streamStartTime,
                    };
                  }

                  if (part.type === "finish") {
                    // The tracker accumulates per step, so by the finish part it
                    // holds the run's totals. Surfacing them here is what lets
                    // the client show what the run actually cost instead of
                    // sending the user to the usage page to find out.
                    const runUsage = usageTracker.hasUsage
                      ? usageTracker.createUsageCostRecord({
                          selectedModel,
                          selectedModelOverride,
                          responseModel: state.responseModel,
                          configuredModelId,
                          rateLimitInfo,
                        })
                      : null;

                    return {
                      mode,
                      createdAt: streamStartTime,
                      generationStartedAt: streamStartTime,
                      generationTimeMs: Date.now() - streamStartTime,
                      totalTokens: runUsage?.totalTokens,
                      costDollars: runUsage?.costDollars,
                      // What was actually sent to the model this turn — the
                      // context window's fill, which cumulative burn is not.
                      inputTokens: runUsage?.inputTokens,
                    };
                  }
                },
                onFinish: async ({ messages, isAborted }) => {
                  let retryScheduled = false;
                  let producerSaved = false;
                  try {
                    // Check if stream finished with only step-start (indicates incomplete response)
                    const lastAssistantMessage = messages
                      .slice()
                      .reverse()
                      .find((m) => m.role === "assistant");
                    const hasOnlyStepStart =
                      lastAssistantMessage?.parts?.length === 1 &&
                      lastAssistantMessage.parts[0]?.type === "step-start";

                    if (hasOnlyStepStart) {
                      phLogger.warn(
                        "Stream finished incomplete - triggering fallback",
                        {
                          chatId,
                          endpoint,
                          mode,
                          model: selectedModel,
                          userId,
                          subscription,
                          isTemporary: temporary,
                          messageCount: messages.length,
                          parts: lastAssistantMessage?.parts,
                          isRetryWithFallback,
                          assistantMessageId,
                        },
                      );

                      // Retry with fallback model if not already retrying (only for auto models)
                      if (
                        !isRetryWithFallback &&
                        !isAborted &&
                        !state.stoppedDueToElapsedTimeout &&
                        isAutoModel
                      ) {
                        isRetryWithFallback = true;
                        resetAgentProviderAttempt(state, userStopSignal.signal);
                        const fallbackStartTime = Date.now();
                        preFallbackCacheRead = usageTracker.cacheReadTokens;
                        preFallbackCacheWrite = usageTracker.cacheWriteTokens;

                        // Discard the failed primary leg's model usage so the
                        // user is only billed for the fallback. Non-model spend
                        // (sandbox/tools) is preserved.
                        usageTracker.resetModelLeg();

                        const retryResult = await createStream(fallbackModel);
                        // Reuse the FIRST leg's message id, not a fresh one. The
                        // client builds a single streaming message; if the retry
                        // flips the id mid-stream, the empty first bubble (only a
                        // step-start part) is orphaned next to the fallback —
                        // showing two assistant messages. Sharing the id keeps it
                        // one message: the step-start + fallback content coalesce.
                        const retryMessageId = assistantMessageId;

                        writer.merge(
                          retryResult.toUIMessageStream({
                            generateMessageId: () => retryMessageId,
                            messageMetadata: ({ part }) => {
                              if (part.type === "start") {
                                return {
                                  mode,
                                  createdAt: fallbackStartTime,
                                  generationStartedAt: fallbackStartTime,
                                };
                              }

                              if (part.type === "finish") {
                                return {
                                  mode,
                                  createdAt: fallbackStartTime,
                                  generationStartedAt: fallbackStartTime,
                                  generationTimeMs:
                                    Date.now() - fallbackStartTime,
                                };
                              }
                            },
                            onFinish: async ({
                              messages: retryMessages,
                              isAborted: retryAborted,
                            }) => {
                              let producerSaved = false;
                              const finalization =
                                getRunFinalization(retryAborted);
                              const isPreemptiveAbort =
                                finalization.wasPreemptiveTimeout;
                              state.streamFinishReason =
                                finalization.finishReason;
                              try {
                                await drainHttpExecution();
                                // Cleanup for retry
                                clearLifecycleGuards();
                                if (!subscriberStopped) {
                                  await cancellationSubscriber.stop();
                                  subscriberStopped = true;
                                }

                                const sandboxInfo =
                                  sandboxManager.getSandboxInfo();
                                chatLogger!.setSandbox(sandboxInfo);
                                // resetModelLeg already removed the waived primary leg.
                                // Subtracting its snapshot again makes cache counts negative.
                                chatLogger!.setCacheMetrics({
                                  cacheHitRate: usageTracker.cacheHitRate,
                                  cacheReadTokens: usageTracker.cacheReadTokens,
                                  cacheWriteTokens:
                                    usageTracker.cacheWriteTokens,
                                });
                                captureToolCalls({
                                  posthog,
                                  chatLogger,
                                  userId,
                                  mode,
                                });
                                const outcome = retryAborted
                                  ? "aborted"
                                  : "success";
                                captureAgentCompletionAnalytics({
                                  posthog,
                                  userId,
                                  chatId,
                                  endpoint,
                                  mode,
                                  subscription,
                                  sandboxInfo,
                                  outcome,
                                  chatLogger,
                                });
                                shutdownPostHog(posthog);
                                chatLogger!.emitSuccess({
                                  finishReason: state.streamFinishReason,
                                  wasAborted: retryAborted,
                                  wasPreemptiveTimeout: isPreemptiveAbort,
                                  hadSummarization:
                                    summarizationTracker.hasSummarized,
                                });

                                const generatedTitle = await titlePromise;

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
                                      expectedStreamId:
                                        httpExecution?.executionId,
                                      title: generatedTitle,
                                      finishReason: state.streamFinishReason,
                                      todos: mergedTodos,
                                      defaultModelSlug: mode,
                                      sandboxType:
                                        sandboxManager.getEffectivePreference(),
                                      selectedModel: selectedModelOverride,
                                    });
                                  } else {
                                    await prepareForNewStream({
                                      chatId,
                                      expectedStreamId:
                                        httpExecution?.executionId,
                                    });
                                  }

                                  const accumulatedFiles =
                                    getFileAccumulator().getAll();
                                  const newFileIds = accumulatedFiles.map(
                                    (f) => f.fileId,
                                  );

                                  // Only save NEW assistant messages from retry (skip already-saved user messages)
                                  for (const msg of retryMessages) {
                                    if (msg.role !== "assistant") continue;

                                    const processed =
                                      summarizationTracker.processMessageForSave(
                                        msg,
                                      );

                                    await saveMessage({
                                      chatId,
                                      userId,
                                      message: processed,
                                      extraFileIds: newFileIds,
                                      usage: state.streamUsage,
                                      model: state.responseModel,
                                      mode,
                                      generationStartedAt: fallbackStartTime,
                                      generationTimeMs:
                                        Date.now() - fallbackStartTime,
                                      finishReason: state.streamFinishReason,
                                    });
                                  }

                                  // Send file metadata via stream for resumable stream clients
                                  sendFileMetadataToStream(accumulatedFiles);
                                } else {
                                  // For temporary chats, send file metadata via stream before cleanup
                                  const tempFiles =
                                    getFileAccumulator().getAll();
                                  sendFileMetadataToStream(tempFiles);

                                  // Ensure temp stream row is removed backend-side
                                  await deleteTempStreamForBackend({ chatId });
                                }

                                const retryAutoContinueReason =
                                  resolveAgentAutoContinueReason({
                                    approvalStopped:
                                      approvalGate.isStopped?.() ?? false,
                                    purpose,
                                    temporary: Boolean(temporary),
                                    finishReason: state.streamFinishReason,
                                    stoppedDueToTokenExhaustion:
                                      state.stoppedDueToTokenExhaustion,
                                    stoppedDueToElapsedTimeout:
                                      state.stoppedDueToElapsedTimeout,
                                    hardTimedOut: isPreemptiveAbort,
                                    manuallyAborted:
                                      retryAborted && !isPreemptiveAbort,
                                    terminalError:
                                      state.providerError !== undefined ||
                                      state.streamFinishReason === "error",
                                  });
                                if (retryAutoContinueReason) {
                                  writeAutoContinue(writer, {
                                    continuationId: retryMessageId,
                                    reason: retryAutoContinueReason,
                                  });
                                }

                                // Verify fallback produced valid content
                                const fallbackAssistantMessage = retryMessages
                                  .slice()
                                  .reverse()
                                  .find((m) => m.role === "assistant");
                                const fallbackHasContent =
                                  fallbackAssistantMessage?.parts?.some(
                                    (p) =>
                                      p.type === "text" ||
                                      p.type?.startsWith("tool-") ||
                                      p.type === "reasoning",
                                  ) ?? false;
                                const fallbackPartTypes =
                                  fallbackAssistantMessage?.parts?.map(
                                    (p) => p.type,
                                  ) ?? [];

                                phLogger.info("Fallback completed", {
                                  chatId,
                                  endpoint,
                                  mode,
                                  originalModel: selectedModel,
                                  originalAssistantMessageId:
                                    assistantMessageId,
                                  fallbackModel,
                                  fallbackAssistantMessageId: retryMessageId,
                                  fallbackDurationMs:
                                    Date.now() - fallbackStartTime,
                                  fallbackSuccess: fallbackHasContent,
                                  fallbackWasAborted: retryAborted,
                                  fallbackMessageCount: retryMessages.length,
                                  fallbackPartTypes,
                                  preFallbackCacheReadTokens:
                                    preFallbackCacheRead,
                                  preFallbackCacheWriteTokens:
                                    preFallbackCacheWrite,
                                  fallbackCacheReadTokens:
                                    usageTracker.cacheReadTokens,
                                  fallbackCacheWriteTokens:
                                    usageTracker.cacheWriteTokens,
                                  fallbackCacheHitRate:
                                    usageTracker.cacheHitRate,
                                  userId,
                                  subscription,
                                  isTemporary: temporary,
                                  paidAskMode:
                                    mode === "ask" && subscription !== "free",
                                });

                                // Deduct accumulated usage (includes both original + retry streams)
                                await deductAccumulatedUsage();
                                producerSaved = true;
                              } finally {
                                try {
                                  await finishRecordedRun(retryAborted);
                                } finally {
                                  clearLifecycleGuards();
                                  await releaseFreeRunLockOnce();
                                  await closeMcpToolsOnce();
                                  await finishHttpExecutionOnce();
                                  await onProducerFinished?.(
                                    producerSaved &&
                                      getRunFinalization(retryAborted)
                                        .status === "completed" &&
                                      state.streamFinishReason !== "error"
                                      ? "completed"
                                      : "failed",
                                  );
                                }
                              }
                            },
                            sendReasoning: true,
                          }),
                        );

                        retryScheduled = true;
                        return; // Skip normal cleanup - retry handles it
                      }
                    }

                    await drainHttpExecution();
                    const isPreemptiveAbort = hasLifecycleTimedOut();
                    const onFinishStartTime = Date.now();
                    const triggerTime = preemptiveTimeout?.getTriggerTime();

                    // Helper to log step timing during preemptive timeout
                    const logStep = (step: string, stepStartTime: number) => {
                      if (isPreemptiveAbort) {
                        const stepDuration = Date.now() - stepStartTime;
                        const totalElapsed =
                          Date.now() - (triggerTime || onFinishStartTime);
                        phLogger.info("Preemptive timeout cleanup step", {
                          chatId,
                          step,
                          stepDurationMs: stepDuration,
                          totalElapsedSinceTriggerMs: totalElapsed,
                          endpoint,
                        });
                      }
                    };

                    if (isPreemptiveAbort) {
                      phLogger.info("Preemptive timeout onFinish started", {
                        chatId,
                        endpoint,
                        timeSinceTriggerMs: triggerTime
                          ? onFinishStartTime - triggerTime
                          : null,
                        messageCount: messages.length,
                        isTemporary: temporary,
                      });
                    }

                    // Clear pre-emptive timeout
                    let stepStart = Date.now();
                    clearLifecycleGuards();
                    logStep("clear_timeout", stepStart);

                    // Stop cancellation subscriber
                    stepStart = Date.now();
                    await cancellationSubscriber.stop();
                    subscriberStopped = true;
                    logStep("stop_cancellation_subscriber", stepStart);

                    // Clear finish reason for user-initiated aborts (not pre-emptive timeouts)
                    // This prevents showing "going off course" message when user clicks stop
                    state.streamFinishReason =
                      getRunFinalization(isAborted).finishReason;

                    // Emit wide event
                    stepStart = Date.now();
                    const sandboxInfo = sandboxManager.getSandboxInfo();
                    chatLogger!.setSandbox(sandboxInfo);
                    chatLogger!.setCacheMetrics({
                      cacheHitRate: usageTracker.cacheHitRate,
                      cacheReadTokens: usageTracker.cacheReadTokens,
                      cacheWriteTokens: usageTracker.cacheWriteTokens,
                    });
                    captureToolCalls({ posthog, chatLogger, userId, mode });
                    const outcome = isAborted ? "aborted" : "success";
                    captureAgentCompletionAnalytics({
                      posthog,
                      userId,
                      chatId,
                      endpoint,
                      mode,
                      subscription,
                      sandboxInfo,
                      outcome,
                      chatLogger,
                    });
                    shutdownPostHog(posthog);
                    chatLogger!.emitSuccess({
                      finishReason: state.streamFinishReason,
                      wasAborted: isAborted,
                      wasPreemptiveTimeout: isPreemptiveAbort,
                      hadSummarization: summarizationTracker.hasSummarized,
                    });
                    logStep("emit_success_event", stepStart);

                    // Sandbox cleanup is automatic with auto-pause
                    // The sandbox will auto-pause after inactivity timeout (7 minutes)
                    // No manual pause needed

                    // Always wait for title generation to complete
                    stepStart = Date.now();
                    const generatedTitle = await titlePromise;
                    logStep("wait_title_generation", stepStart);

                    if (!temporary) {
                      stepStart = Date.now();
                      const mergedTodos = getTodoManager().mergeWith(
                        baseTodos,
                        assistantMessageId,
                      );
                      logStep("merge_todos", stepStart);

                      const shouldPersist = regenerate
                        ? true
                        : Boolean(
                            generatedTitle ||
                            state.streamFinishReason ||
                            mergedTodos.length > 0,
                          );

                      if (shouldPersist) {
                        // updateChat automatically clears stream state (active_stream_id and canceled_at)
                        stepStart = Date.now();
                        await updateChat({
                          chatId,
                          expectedStreamId: httpExecution?.executionId,
                          title: generatedTitle,
                          finishReason: state.streamFinishReason,
                          todos: mergedTodos,
                          defaultModelSlug: mode,
                          sandboxType: sandboxManager.getEffectivePreference(),
                          selectedModel: selectedModelOverride,
                        });
                        logStep("update_chat", stepStart);
                      } else {
                        // If not persisting, still need to clear stream state
                        stepStart = Date.now();
                        await prepareForNewStream({
                          chatId,
                          expectedStreamId: httpExecution?.executionId,
                        });
                        logStep("prepare_for_new_stream", stepStart);
                      }

                      stepStart = Date.now();
                      const accumulatedFiles = getFileAccumulator().getAll();
                      const newFileIds = accumulatedFiles.map((f) => f.fileId);
                      logStep("get_accumulated_files", stepStart);

                      // Check if any messages have incomplete tool calls that need completion
                      const hasIncompleteToolCalls = messages.some(
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
                        ? summarizeIncompleteToolParts(messages)
                        : [];
                      if (incompleteToolSummaries.length > 0) {
                        console.info(
                          JSON.stringify({
                            level: "info",
                            event: "abort_incomplete_tool_calls_detected",
                            service: "chat-handler",
                            timestamp: new Date().toISOString(),
                            chat_id: chatId,
                            user_id: userId,
                            mode,
                            finish_reason: state.streamFinishReason,
                            is_preemptive_abort: isPreemptiveAbort,
                            incomplete_tool_count:
                              incompleteToolSummaries.length,
                            incomplete_tools: incompleteToolSummaries,
                          }),
                        );
                      }

                      // On abort, streamText.onFinish may not have fired yet, so state.streamUsage
                      // could be undefined. Await usage from result to ensure we capture it.
                      // This must happen BEFORE we decide whether to skip saving.
                      let resolvedUsage: Record<string, unknown> | undefined =
                        state.streamUsage;
                      if (!resolvedUsage && isAborted) {
                        try {
                          resolvedUsage = (await result.usage) as Record<
                            string,
                            unknown
                          >;
                        } catch {
                          // Usage unavailable on abort - continue without it
                        }
                      }

                      const hasUsageToRecord = Boolean(resolvedUsage);
                      // Reads the durable discard intent when no Redis message
                      // arrived, so a dropped signal can no longer be mistaken
                      // for "discard this run's output".
                      const shouldSkipSaveSignal = isAborted
                        ? await cancellationSubscriber.resolveSkipSave()
                        : cancellationSubscriber.shouldSkipSave();

                      // If user aborted (not pre-emptive), skip message save when:
                      // 1. skipSave signal received via Redis (edit/regenerate/retry — message will be discarded)
                      // 2. No files, tools, or usage to record (frontend already saved the message)
                      if (
                        isAborted &&
                        !isPreemptiveAbort &&
                        (shouldSkipSaveSignal ||
                          (newFileIds.length === 0 &&
                            !hasIncompleteToolCalls &&
                            !hasUsageToRecord))
                      ) {
                        console.info(
                          JSON.stringify({
                            level: "info",
                            event: "abort_message_save_skipped",
                            service: "chat-handler",
                            timestamp: new Date().toISOString(),
                            chat_id: chatId,
                            user_id: userId,
                            mode,
                            finish_reason: state.streamFinishReason,
                            skip_save_signal: shouldSkipSaveSignal,
                            new_file_count: newFileIds.length,
                            has_incomplete_tool_calls: hasIncompleteToolCalls,
                            has_usage_to_record: hasUsageToRecord,
                          }),
                        );
                        await deductAccumulatedUsage();
                        return;
                      }

                      // Save messages (either full save or just append extraFileIds)
                      stepStart = Date.now();
                      for (const message of messages) {
                        let processedMessage =
                          summarizationTracker.processMessageForSave(message);

                        // Skip saving messages with no parts or files
                        // This prevents saving empty messages on error that would accumulate on retry
                        if (
                          (!processedMessage.parts ||
                            processedMessage.parts.length === 0) &&
                          newFileIds.length === 0
                        ) {
                          continue;
                        }

                        // Use resolvedUsage which was already awaited above on abort
                        // Falls back to state.streamUsage for non-abort cases
                        // On user-initiated abort, use updateOnly as safety net:
                        // only patch existing messages (add files/usage), don't create new ones.
                        // This prevents orphan messages when Redis skipSave signal was missed.
                        try {
                          await saveMessage({
                            chatId,
                            userId,
                            message: processedMessage,
                            extraFileIds: newFileIds,
                            model: state.responseModel || configuredModelId,
                            mode,
                            generationStartedAt:
                              processedMessage.role === "assistant"
                                ? streamStartTime
                                : undefined,
                            generationTimeMs: Date.now() - streamStartTime,
                            finishReason: state.streamFinishReason,
                            usage: resolvedUsage ?? state.streamUsage,
                            // updateOnly exists to stop a discarded turn from
                            // being re-created as an orphan. It must not apply
                            // to a plain Stop: there, the client's save is
                            // fire-and-forget, so refusing to insert meant the
                            // partial output vanished whenever that request did
                            // not land. The discard intent is durable now, so
                            // this can be narrowed to the case it was for.
                            updateOnly:
                              isAborted &&
                              !isPreemptiveAbort &&
                              shouldSkipSaveSignal
                                ? true
                                : undefined,
                            isHidden:
                              isAutoContinue && processedMessage.role === "user"
                                ? true
                                : undefined,
                            wasAborted: isAborted,
                            wasPreemptiveTimeout: isPreemptiveAbort,
                          });
                        } catch (error) {
                          if (isPreemptiveAbort) {
                            console.error(
                              JSON.stringify({
                                level: "error",
                                event: "preemptive_timeout_message_save_failed",
                                service: "chat-handler",
                                timestamp: new Date().toISOString(),
                                chat_id: chatId,
                                user_id: userId,
                                message_id: processedMessage.id,
                                message_role: processedMessage.role,
                                mode,
                                model: state.responseModel || configuredModelId,
                                finish_reason: state.streamFinishReason,
                                time_since_timeout_trigger_ms: triggerTime
                                  ? Date.now() - triggerTime
                                  : null,
                                stream_duration_ms:
                                  Date.now() - streamStartTime,
                                error_name:
                                  error instanceof Error
                                    ? error.name
                                    : typeof error,
                                error_message:
                                  error instanceof Error
                                    ? error.message
                                    : String(error),
                                error_metadata:
                                  error &&
                                  typeof error === "object" &&
                                  "metadata" in error
                                    ? (error as { metadata?: unknown }).metadata
                                    : undefined,
                              }),
                            );
                          }
                          throw error;
                        }
                      }
                      logStep("save_messages", stepStart);

                      // Send file metadata via stream for resumable stream clients
                      // Uses accumulated metadata directly - no DB query needed!
                      stepStart = Date.now();
                      sendFileMetadataToStream(accumulatedFiles);
                      logStep("send_file_metadata", stepStart);
                    } else {
                      // For temporary chats, send file metadata via stream before cleanup
                      stepStart = Date.now();
                      const tempFiles = getFileAccumulator().getAll();
                      sendFileMetadataToStream(tempFiles);
                      logStep("send_temp_file_metadata", stepStart);

                      // Ensure temp stream row is removed backend-side
                      stepStart = Date.now();
                      await deleteTempStreamForBackend({ chatId });
                      logStep("delete_temp_stream", stepStart);
                    }

                    if (isPreemptiveAbort) {
                      const totalDuration = Date.now() - onFinishStartTime;
                      phLogger.info("Preemptive timeout onFinish completed", {
                        chatId,
                        endpoint,
                        totalOnFinishDurationMs: totalDuration,
                        totalSinceTriggerMs: triggerTime
                          ? Date.now() - triggerTime
                          : null,
                      });
                      await phLogger.flush();
                    }

                    // Send updated context usage with output tokens included
                    if (contextUsageOn) {
                      writeContextUsage(writer, {
                        usedTokens:
                          state.ctxUsage.usedTokens +
                          usageTracker.streamOutputTokens,
                        maxTokens: state.ctxUsage.maxTokens,
                      });
                    }

                    const autoContinueReason = isAgentMode(mode)
                      ? resolveAgentAutoContinueReason({
                          approvalStopped: approvalGate.isStopped?.() ?? false,
                          purpose,
                          temporary: Boolean(temporary),
                          finishReason: state.streamFinishReason,
                          stoppedDueToTokenExhaustion:
                            state.stoppedDueToTokenExhaustion,
                          stoppedDueToElapsedTimeout:
                            state.stoppedDueToElapsedTimeout,
                          hardTimedOut: isPreemptiveAbort,
                          manuallyAborted: isAborted && !isPreemptiveAbort,
                          terminalError:
                            state.providerError !== undefined ||
                            state.streamFinishReason === "error",
                        })
                      : null;
                    if (autoContinueReason) {
                      writeAutoContinue(writer, {
                        continuationId: assistantMessageId,
                        reason: autoContinueReason,
                      });
                    }

                    await deductAccumulatedUsage();
                    producerSaved = true;
                  } finally {
                    if (!retryScheduled) {
                      try {
                        await finishRecordedRun(isAborted);
                      } finally {
                        clearLifecycleGuards();
                        await releaseFreeRunLockOnce();
                        await closeMcpToolsOnce();
                        await finishHttpExecutionOnce();
                        await onProducerFinished?.(
                          producerSaved &&
                            getRunFinalization(isAborted).status ===
                              "completed" &&
                            state.streamFinishReason !== "error"
                            ? "completed"
                            : "failed",
                        );
                      }
                    }
                  }
                },
                sendReasoning: true,
              }),
            );
          } catch (error) {
            await drainHttpExecution();
            clearLifecycleGuards();
            await releaseFreeRunLockOnce();
            await closeMcpToolsOnce();
            if (httpExecution) {
              await usageRefundTracker.refund();
              await finishHttpExecutionOnce();
              if ((await readHackHttpExecution(httpExecution))?.canceled) {
                writer.write({ type: "abort" });
                return;
              }
            }
            throw error;
          }
        },
      });

      return createUIMessageStreamResponse({
        stream,
        headers: {
          "Transfer-Encoding": "chunked",
          ...(httpExecution
            ? { "x-rift-execution-id": httpExecution.executionId }
            : {}),
        },
        async consumeSseStream({ stream: sseStream }) {
          // Temporary chats do not support resumption
          if (temporary) {
            return;
          }

          try {
            const streamContext = getStreamContext();
            if (streamContext) {
              const streamId = httpExecution?.executionId ?? generateId();
              if (!httpExecution) await startStream({ chatId, streamId });
              await streamContext.createNewResumableStream(
                streamId,
                () => sseStream,
              );
            }
          } catch (error) {
            // Non-fatal: stream still works without resumability
            phLogger.warn("Stream resumption setup failed", {
              chatId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        },
      });
    } catch (error) {
      // Clear timeout if error occurs before onFinish
      await drainHttpExecution();
      clearLifecycleGuards();
      await releaseFreeRunLockOnce();
      await closeMcpToolsOnce();

      // Best-effort PTY cleanup — the stream may never have reached onFinish.
      if (outerChatId && !hackWorkbenchOnly) {
        await ptySessionManager
          .closeAll(outerChatId)
          .catch((err) =>
            console.error(
              "[chat-handler] PTY closeAll (outer catch) failed:",
              err,
            ),
          );
      }

      // Refund the upfront deduction when the request fails before any tokens
      // were consumed. refund() is idempotent and only fires if deductions were
      // recorded and nothing has been refunded yet. A false return means the
      // refund itself failed (Convex hiccup) — surface it so the burn is
      // visible and reconcilable instead of silently dropped.
      if (!(await usageRefundTracker.refund())) {
        phLogger.error(
          "Credit refund failed after request error — credits not yet restored",
          usageRefundTracker.getDeductionSummary(),
        );
      }

      if (httpExecution) {
        await finishHttpExecutionOnce();
        const status = await readHackHttpExecution(httpExecution);
        if (status?.canceled)
          return stoppedHttpResponse(httpExecution.executionId);
      }

      // Handle ChatSDKErrors (including authentication errors)
      if (error instanceof ChatSDKError) {
        chatLogger?.emitChatError(error);
        return error.toResponse();
      }

      // Handle unexpected errors (provider failures, etc.)
      chatLogger?.emitUnexpectedError(error);

      const unexpectedError = new ChatSDKError(
        "bad_request:stream",
        getUserFriendlyProviderError(error),
      );
      return unexpectedError.toResponse();
    }
  };
};
