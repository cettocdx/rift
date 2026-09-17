import {
  readHackDispatchStop,
  recordHackDispatchNotAttempted,
} from "@/lib/hack/durable-stop";
import { getAgentResumeRequestContext } from "@/lib/api/agent-resume-context";
import {
  agentDispatchAdmissionEnabled,
  beginAgentDispatch,
  lookupAgentDispatch,
  markAgentDispatching,
  recordAgentDispatchAccepted,
  type AgentDispatchHandle,
} from "@/lib/api/agent-dispatch-admission";
import {
  assertDurableHackEnabled,
  assertLiveHackAccess,
  createHackRunBinding,
  hashHackRunPayload,
} from "@/lib/hack/durable-run";
import { assertHackWorkbenchAccess } from "@/lib/auth/premium-access";
import { hashAgentDispatchPayload } from "@/lib/api/agent-dispatch-identity";
import { parseWorkingFileContext } from "@/lib/desktop/working-file-context";
import { parseApprovalMode } from "@/lib/ai/approval/policy";
import { NextRequest, NextResponse } from "next/server";
import { tasks } from "@trigger.dev/sdk";
import {
  createAgentRunReadToken,
  prepareAgentRunReadToken,
} from "@/lib/api/agent-run-read-token";
import type { agentLongTask } from "@/trigger/agent-long";
import type { hackLongTask } from "@/trigger/hack-long";
import { geolocation } from "@vercel/functions";
import type { UIMessage } from "ai";

import { getUserIDAndPro } from "@/lib/auth/get-user-id";
import { assertUserCanMakeCostIncurringRequest } from "@/lib/suspensions";
import { getAgentAdmissionSnapshot } from "@/lib/db/agent-admission-snapshot";
import { persistClaimedInitialTurn } from "@/lib/db/initial-turn";
import { assertFreeAgentGates } from "@/lib/api/free-agent-gates";
import {
  coerceSelectedModel,
  coerceChatPurpose,
  resolveBuildReasoningEffort,
} from "@/types";
import { ChatSDKError } from "@/lib/errors";
import { cancelRunAndConfirm, isRunActive } from "@/lib/api/agent-long-runs";
import { assertHackWorkbenchPurposeRoute } from "@/lib/auth/premium-access";
import type { Todo, SandboxPreference, SelectedModel } from "@/types";
import {
  getUploadBasePath,
  hasLocalDesktopSourcePaths,
  prepareLocalDesktopAttachmentsForTrigger,
  rewriteSandboxFilePathsInMessages,
  stripLocalDesktopSourcePaths,
  uploadSandboxFiles,
} from "@/lib/utils/sandbox-file-utils";
import { resolveProjectRuntimeContext } from "@/lib/projects/project-runtime";
import { getActiveGoalForModel } from "@/lib/api/active-goal-context";
import {
  readLimitedTextBody,
  RequestBodyTooLargeError,
} from "@/lib/api/read-limited-body";
import { finalizeAgentLongStartup } from "@/lib/api/agent-long-startup";
import {
  acquireAgentRunStart,
  assertAgentRunStartCurrent,
  registerAgentRun,
  releaseAgentRunClaim,
  releaseCanceledAgentRunClaim,
  AgentRunBusyError,
  AgentRunClaimLostError,
} from "@/lib/api/agent-run-claims";

export const maxDuration = 30;
const MAX_AGENT_LONG_BODY_BYTES = 5 * 1024 * 1024;

type AgentLongRequestBody = {
  messages?: UIMessage[];
  chatId?: string;
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
  /** Cancel the chat's active run and start this one in its place. */
  replaceActiveRun?: boolean;
  scope?: unknown;
  scheduledRun?: unknown;
};

export function createAgentLongHandler(hackWorkbenchOnly = false) {
  return async function POST(req: NextRequest) {
    const routeStartedAt = Date.now();
    const routeTimings: Record<string, number> = {};
    const timed = async <T>(
      name: string,
      action: () => Promise<T>,
    ): Promise<T> => {
      const started = Date.now();
      try {
        return await action();
      } finally {
        routeTimings[name] = (routeTimings[name] ?? 0) + Date.now() - started;
      }
    };
    let startReservation:
      | { userId: string; chatId: string; claimId: string }
      | undefined;
    let dispatchAttempted = false;
    let durableHandle: AgentDispatchHandle | undefined;
    let hackDispatchOwner:
      | { userId: string; chatId: string; dispatchId: string }
      | undefined;
    const stoppedDispatchResponse = (stop: {
      canceled: boolean;
      dispatchId: string;
    }) =>
      NextResponse.json(
        {
          delivery: stop.canceled ? "canceled" : "unconfirmed",
          canceled: stop.canceled,
          dispatchId: stop.dispatchId,
          ...(!stop.canceled ? { cancelRequested: true } : {}),
        },
        { status: stop.canceled ? 409 : 202 },
      );
    try {
      // Authenticate before allocating a potentially large message payload. This
      // keeps anonymous requests from using JSON parsing as a memory-pressure
      // primitive while preserving the full Agent request shape for real users.
      const { userId, subscription, organizationId } = await timed(
        "auth",
        async () => await getUserIDAndPro(req),
      );

      if (hackWorkbenchOnly) {
        assertDurableHackEnabled();
        assertHackWorkbenchAccess(subscription);
        await assertLiveHackAccess(userId);
        req.signal.throwIfAborted();
      }

      let requestBody: unknown;
      try {
        const rawBody = await readLimitedTextBody(
          req,
          MAX_AGENT_LONG_BODY_BYTES,
        );
        requestBody = JSON.parse(rawBody);
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return new NextResponse("Request body is too large", { status: 413 });
        }
        return new NextResponse("Invalid JSON body", { status: 400 });
      }

      if (
        !requestBody ||
        typeof requestBody !== "object" ||
        Array.isArray(requestBody)
      ) {
        return new NextResponse("Invalid JSON body", { status: 400 });
      }

      const {
        messages,
        chatId,
        todos,
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
        replaceActiveRun,
        scope,
        scheduledRun,
      } = requestBody as AgentLongRequestBody;

      if (
        hackWorkbenchOnly &&
        (temporary ||
          regenerate ||
          isAutoContinue ||
          scheduledRun !== undefined ||
          rawWorkingFile !== undefined ||
          (sandboxPreference !== undefined && sandboxPreference !== "e2b") ||
          (rawPurpose !== undefined && rawPurpose !== "security") ||
          !Array.isArray(messages) ||
          messages.length !== 1 ||
          messages[0]?.role !== "user")
      ) {
        throw new ChatSDKError(
          "bad_request:api",
          "Durable Hack requires one explicit persistent Cloud assessment.",
        );
      }

      if (
        typeof chatId !== "string" ||
        chatId.length === 0 ||
        chatId.length > 200 ||
        chatId.trim() !== chatId
      ) {
        return new NextResponse("Invalid chat id", { status: 400 });
      }

      let approvalMode;
      try {
        approvalMode = parseApprovalMode(rawApprovalMode);
      } catch {
        return new NextResponse("Invalid approval mode", { status: 400 });
      }

      let workingFile;
      try {
        workingFile = parseWorkingFileContext(rawWorkingFile);
      } catch {
        return new NextResponse("Invalid working file selection", {
          status: 400,
        });
      }

      const selectedModelOverride: SelectedModel | undefined =
        coerceSelectedModel(rawSelectedModel ?? null) ?? undefined;
      if (
        hackWorkbenchOnly &&
        rawSelectedModel !== undefined &&
        !selectedModelOverride
      )
        throw new ChatSDKError("bad_request:api", "Invalid assessment model.");
      const requestedPurpose = hackWorkbenchOnly
        ? "security"
        : coerceChatPurpose(rawPurpose ?? "app");
      const activeGoal = getActiveGoalForModel(rawActiveGoal) ?? undefined;

      const userLocation = geolocation(req);

      assertFreeAgentGates({
        mode: "agent",
        subscription,
        sandboxPreference,
        rawSelectedModel,
      });

      const requestMessages = Array.isArray(messages) ? messages : [];
      if (!regenerate && !isAutoContinue && requestMessages.length === 0) {
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "agent_long_empty_message_payload_rejected",
            service: "chat-handler",
            timestamp: new Date().toISOString(),
            chat_id: chatId,
            user_id: userId,
            temporary: !!temporary,
            subscription,
          }),
        );
        throw new ChatSDKError(
          "bad_request:api",
          "No message content was found for this request. Please send a new message and try again.",
          {
            empty_prompt: true,
            new_messages_count: 0,
          },
        );
      }

      // Fetch existing chat to: (a) detect isNewChat for title generation,
      // (b) prevent atomic persistence from recreating a deleted existing chat.
      // Both are read-only and independent after authentication. No claim,
      // cancellation, persistence or billing can proceed until BOTH succeed.
      const [, admissionSnapshot] = await Promise.all([
        timed("entitlement", () =>
          assertUserCanMakeCostIncurringRequest(userId),
        ),
        temporary
          ? Promise.resolve(null)
          : timed("chat", () => getAgentAdmissionSnapshot({ userId, chatId })),
      ]);

      const existingChat =
        admissionSnapshot?.read({ userId, chatId }).chat ?? null;

      // The owned snapshot uses a service key. Validate the caller's ownership and the
      // bound project before revealing or canceling any run on that chat.
      const projectRuntime = await timed("project", () =>
        resolveProjectRuntimeContext({
          userId,
          chat: existingChat,
          requestedProject: rawProjectId,
          requestedPurpose,
        }),
      );
      // Overlap environment discovery with admission. Token creation remains
      // after dispatch; a failed prefetch is retried by the existing token path.
      void prepareAgentRunReadToken().catch(() => {});
      const purpose = projectRuntime.purpose;
      if (workingFile && purpose !== "app") {
        return new NextResponse("Working files require Build mode", {
          status: 400,
        });
      }
      const reasoningEffort =
        purpose === "app"
          ? resolveBuildReasoningEffort(
              selectedModelOverride,
              rawReasoningEffort,
            )
          : undefined;
      if (hackWorkbenchOnly) {
        if (purpose !== "security")
          throw new ChatSDKError(
            "forbidden:auth",
            "This chat is not a Hack assessment.",
          );
      } else {
        assertHackWorkbenchPurposeRoute(purpose, false);
      }
      const hackRun = hackWorkbenchOnly
        ? createHackRunBinding(
            requestMessages[0],
            scope,
            replaceActiveRun === true,
          )
        : undefined;
      const hackBoundSettings = {
        hackRun,
        selectedModel: selectedModelOverride,
        reasoningEffort,
        approvalMode,
        projectId: projectRuntime.projectId,
        activeGoal,
        baseTodos: Array.isArray(todos) ? todos : [],
        userLocation,
        organizationId,
      };

      // Ordinary persisted turns already carry a stable client message UUID.
      // Regenerate, auto-continue and temporary migration need separate identities
      // and lifecycle coverage before joining this rollout.
      const durableEligible =
        agentDispatchAdmissionEnabled() &&
        !temporary &&
        !regenerate &&
        !isAutoContinue;
      const requestMessageId = requestMessages.findLast(
        (message) => message.role === "user",
      )?.id;
      if (
        durableEligible &&
        (typeof requestMessageId !== "string" ||
          !requestMessageId.trim() ||
          requestMessageId.trim() !== requestMessageId ||
          requestMessageId.length > 200)
      ) {
        return new NextResponse("A stable user message id is required", {
          status: 400,
        });
      }
      const hackRequestContext = hackRun
        ? {
            ...getAgentResumeRequestContext({
              ...hackBoundSettings,
              purpose: "security",
              temporary: false,
              sandboxPreference: "e2b",
            }),
            scope: hackRun.scope,
            dispatchId: hackRun.requestMessageId,
          }
        : undefined;
      const dispatchRequest = durableEligible
        ? {
            userId,
            chatId,
            dispatchId: requestMessageId!,
            requestMessageId: requestMessageId!,
            payloadHash: hackRun
              ? hashHackRunPayload(hackBoundSettings)
              : hashAgentDispatchPayload({
                  messages: stripLocalDesktopSourcePaths(requestMessages),
                  todos: Array.isArray(todos) ? todos : [],
                  sandboxPreference: sandboxPreference ?? "e2b",
                  selectedModel: selectedModelOverride,
                  reasoningEffort,
                  approvalMode,
                  purpose,
                  projectId: projectRuntime.projectId,
                  activeGoal,
                  workingFile,
                  replaceActiveRun: replaceActiveRun === true,
                }),
            replaceActiveRun: replaceActiveRun === true,
            ...(hackWorkbenchOnly ? { requiresCleanup: true } : {}),
          }
        : undefined;
      const duplicateResponse = async (
        result: NonNullable<Awaited<ReturnType<typeof lookupAgentDispatch>>>,
      ) => {
        if (result.receipt?.runId) {
          // Reconnection is read-only. Token failure must not cancel the original
          // run via the startup finalizer's cleanup callbacks.
          return NextResponse.json({
            runId: result.receipt.runId,
            publicAccessToken: await createAgentRunReadToken(
              result.receipt.runId,
            ),
            ...(hackRequestContext
              ? { requestContext: hackRequestContext }
              : {}),
            delivery: "duplicate",
            dispatchId: dispatchRequest!.dispatchId,
            ...(result.receipt.state === "terminal"
              ? { terminalStatus: result.receipt.terminalStatus }
              : {}),
          });
        }
        const revoked = result.intent?.phase === "revoked";
        return NextResponse.json(
          {
            error: revoked ? "dispatch_not_started" : "dispatch_pending",
            message: revoked
              ? "This request was stopped before dispatch. Send a new message to continue."
              : "This request is already being prepared. Its acceptance has not yet been confirmed.",
            dispatchId: dispatchRequest!.dispatchId,
          },
          { status: 409 },
        );
      };
      if (hackRun && dispatchRequest) {
        hackDispatchOwner = {
          userId,
          chatId,
          dispatchId: dispatchRequest.dispatchId,
        };
        const stop = await readHackDispatchStop(hackDispatchOwner);
        if (stop) return stoppedDispatchResponse(stop);
      }
      if (dispatchRequest) {
        const previousDispatch = await lookupAgentDispatch(dispatchRequest);
        if (previousDispatch) return await duplicateResponse(previousDispatch);
      }

      // Preserve the quick read-only busy response. Replacement cancellation
      // belongs to acquireAgentRunStart after local target validation, where the
      // observed claim is fenced before any remote cancellation.
      const activeRunId = existingChat?.active_trigger_run_id;
      if (
        !dispatchRequest &&
        activeRunId &&
        replaceActiveRun !== true &&
        (await isRunActive(activeRunId))
      ) {
        return NextResponse.json(
          {
            error: "run_active",
            message: "A run is already active in this chat.",
            runId: activeRunId,
          },
          { status: 409 },
        );
      }
      // Reject a disconnected local target before saving a new turn or billing.
      // This probes presence only; the worker independently rechecks it before use.
      if (
        purpose === "app" &&
        sandboxPreference &&
        sandboxPreference !== "e2b" &&
        sandboxPreference !== "desktop"
      ) {
        const { HybridSandboxManager } =
          await import("@/lib/ai/tools/utils/hybrid-sandbox-manager");
        const target = new HybridSandboxManager(
          userId,
          () => {},
          sandboxPreference,
          process.env.CONVEX_SERVICE_ROLE_KEY!,
        );
        let localSandbox;
        try {
          localSandbox = (
            await timed("localAdmission", () => target.getSandbox())
          ).sandbox;
        } catch (error) {
          throw new ChatSDKError(
            "bad_request:api",
            "RIFT could not reach the selected local computer. Open RIFT Desktop on that computer and sign in with the same account to reconnect automatically, then retry. No task or cloud fallback was started.",
          );
        } finally {
          if (localSandbox && "close" in localSandbox)
            await localSandbox.close().catch(() => {});
        }
      }

      let startClaimId: string;
      if (dispatchRequest) {
        const result = await timed("claim", () =>
          beginAgentDispatch(dispatchRequest),
        );
        if (result.kind === "duplicate") return await duplicateResponse(result);
        if (result.kind === "busy") throw new AgentRunBusyError();
        durableHandle = result;
        startClaimId = result.claimId;
      } else {
        startClaimId = await timed("claim", () =>
          acquireAgentRunStart({
            userId,
            chatId,
            activeRunId,
            temporary,
            replaceActiveRun,
            ...(admissionSnapshot ? { admissionSnapshot } : {}),
          }),
        );
      }
      startReservation = { userId, chatId, claimId: startClaimId };

      const isNewChat =
        !temporary && !existingChat && !regenerate && !isAutoContinue;

      let messagesForPersistence =
        stripLocalDesktopSourcePaths(requestMessages);
      let messagesForTrigger = messagesForPersistence;
      let localDesktopAttachmentsPrepared = false;

      if (hasLocalDesktopSourcePaths(requestMessages)) {
        if (sandboxPreference !== "desktop") {
          throw new ChatSDKError(
            "bad_request:api",
            "Desktop-local attachments can only be used with the desktop sandbox.",
          );
        }

        let { messages: preparedMessages, sandboxFiles } =
          prepareLocalDesktopAttachmentsForTrigger(
            requestMessages,
            getUploadBasePath("desktop"),
          );
        if (sandboxFiles.length > 0) {
          const { HybridSandboxManager } =
            await import("@/lib/ai/tools/utils/hybrid-sandbox-manager");
          const sandboxManager = new HybridSandboxManager(
            userId,
            () => {},
            "desktop",
            process.env.CONVEX_SERVICE_ROLE_KEY!,
            null,
            subscription,
            undefined,
            projectRuntime.sandboxNamespace,
          );
          let stagedSandbox: any = null;
          let uploadResult: Awaited<ReturnType<typeof uploadSandboxFiles>>;
          try {
            uploadResult = await uploadSandboxFiles(sandboxFiles, async () => {
              const { sandbox } = await sandboxManager.getSandbox();
              stagedSandbox = sandbox;
              return sandbox;
            });
          } finally {
            await stagedSandbox?.close?.().catch(() => {});
          }
          if (uploadResult.failedCount > 0) {
            const noun =
              uploadResult.failedCount === 1 ? "attachment" : "attachments";
            throw new ChatSDKError(
              "bad_request:api",
              `Failed to prepare ${uploadResult.failedCount} local ${noun}. Please reattach and try again.`,
            );
          }
          preparedMessages = rewriteSandboxFilePathsInMessages(
            preparedMessages,
            uploadResult.pathRewrites,
          );
        }
        messagesForTrigger = preparedMessages;
        localDesktopAttachmentsPrepared = true;
      }

      if (!temporary) {
        // The mutation checks the current startup claim and saves the turn in
        // one transaction. Keep the independent pre-dispatch check below.
        await timed("persistMessage", () =>
          persistClaimedInitialTurn(
            {
              chatId,
              userId,
              claimId: startClaimId,
              messages: messagesForPersistence,
              regenerate,
              chat: existingChat ?? null,
              isHidden: isAutoContinue ? true : undefined,
              purpose,
              projectId: projectRuntime.projectId,
            },
            req.signal,
          ),
        );
      }

      const triggerTags = [`user_${userId}`, `chat_${chatId}`];
      if (subscription !== "free") triggerTags.push(`sub_${subscription}`);

      // Persisted chats are rehydrated from Convex inside the task after the
      // route saves the latest user message. Avoid sending the same history
      // through Trigger unless the task cannot rehydrate it, or the route has
      // prepared desktop-local attachment tags that only exist in this payload.
      const messagesForPayload =
        temporary || localDesktopAttachmentsPrepared ? messagesForTrigger : [];

      await timed("claimRecheck", () =>
        assertAgentRunStartCurrent(startReservation!, req.signal),
      );
      if (durableHandle) {
        const permission = await markAgentDispatching(durableHandle, {
          userId,
          chatId,
        });
        if (!permission) throw new AgentRunClaimLostError();
      }
      if (hackWorkbenchOnly) {
        await assertLiveHackAccess(userId);
        await assertAgentRunStartCurrent(startReservation!, req.signal);
      }
      const triggerRequestedAt = Date.now();
      // A failed network response does not prove Trigger rejected the request.
      // Keep the claim until the worker binds it or the startup lease expires.
      dispatchAttempted = true;
      const handle = await tasks.trigger<
        typeof agentLongTask | typeof hackLongTask
      >(
        hackWorkbenchOnly ? "hack-long" : "agent-long",
        {
          chatId,
          startClaimId,
          ...(durableHandle ? { dispatchId: durableHandle.dispatchId } : {}),
          userId,
          subscription,
          organizationId,
          messages: messagesForPayload,
          localDesktopAttachmentsPrepared,
          baseTodos: Array.isArray(todos) ? todos : [],
          ...(hackRun ? { hackRun } : {}),
          sandboxPreference: hackWorkbenchOnly ? "e2b" : sandboxPreference,
          selectedModel: selectedModelOverride,
          reasoningEffort,
          approvalMode,
          purpose,
          projectId: projectRuntime.projectId,
          activeGoal,
          workingFile,
          userLocation,
          temporary,
          isAutoContinue,
          regenerate,
          isNewChat,
          convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL,
          requestTiming: {
            routeStartedAt,
            triggerRequestedAt,
          },
        },
        {
          tags: triggerTags,
          concurrencyKey: userId,
          idempotencyKey:
            durableHandle?.idempotencyKey ?? `agent-start:${startClaimId}`,
          idempotencyKeyTTL: "24h",
          metadata: {
            status: "queued",
            chatId,
            userId,
            subscription,
            loginRequired: false,
            routeStartedAt,
            triggerRequestedAt,
            triggerPayloadMessageCount: messagesForPayload.length,
          },
        },
      );

      if (durableHandle) {
        await recordAgentDispatchAccepted(
          { ...durableHandle, userId, chatId },
          handle.id,
        );
      }
      const triggerCompletedAt = Date.now();
      routeTimings.dispatch = triggerCompletedAt - triggerRequestedAt;
      const finalizeStartedAt = Date.now();

      // Public access token scoped to this run only — the client uses it to
      // subscribe to the realtime stream without ever seeing TRIGGER_SECRET_KEY.
      // Sign a fresh read-only token for this run. Only environment discovery
      // is cached; user authorization and durable ownership remain live.
      let claimRejected = false;
      const publicAccessToken = await finalizeAgentLongStartup({
        createPublicToken: () => createAgentRunReadToken(handle.id),
        persistActiveRun: async () => {
          try {
            await registerAgentRun({
              userId,
              chatId,
              claimId: startClaimId,
              runId: handle.id,
              sandboxPreference:
                purpose === "app" ? (sandboxPreference ?? "e2b") : "e2b",
            });
          } catch (error) {
            if (error instanceof AgentRunClaimLostError) claimRejected = true;
            throw error;
          }
        },
        cancelTriggeredRun: () => cancelRunAndConfirm(handle.id),
        clearActiveRun: () =>
          releaseCanceledAgentRunClaim({
            userId,
            chatId,
            claimId: startClaimId,
            runId: handle.id,
          }),
        onCleanupError: (stage) => {
          console.error({
            event: "agent_long_startup_cleanup_failed",
            stage,
          });
        },
      });

      if (claimRejected) {
        await cancelRunAndConfirm(handle.id);
        throw new AgentRunBusyError();
      }

      console.info("[/api/agent-long] started trigger run", {
        chatId,
        runId: handle.id,
        routeDurationMs: Date.now() - routeStartedAt,
        triggerDurationMs: triggerCompletedAt - triggerRequestedAt,
        triggerPayloadMessageCount: messagesForPayload.length,
        persistedMessageCount: messagesForPersistence.length,
        temporary: !!temporary,
        localDesktopAttachmentsPrepared,
      });

      routeTimings.finalize = Date.now() - finalizeStartedAt;
      return NextResponse.json(
        {
          runId: handle.id,
          publicAccessToken,
          ...(hackRequestContext ? { requestContext: hackRequestContext } : {}),
        },
        {
          headers: {
            "Server-Timing": Object.entries(routeTimings)
              .map(([name, ms]) => `${name};dur=${ms}`)
              .join(", "),
          },
        },
      );
    } catch (error) {
      if (startReservation && !dispatchAttempted) {
        if (hackWorkbenchOnly && durableHandle) {
          // Only this original request knows Trigger was never invoked. Once
          // dispatchAttempted is set, even a synchronous throw is ambiguous.
          await recordHackDispatchNotAttempted(
            startReservation,
            durableHandle,
          ).catch(() => {});
        }
        await releaseAgentRunClaim(startReservation).catch(() => {
          console.error({ event: "agent_long_reservation_release_failed" });
        });
      }
      if (hackDispatchOwner) {
        const stop = await readHackDispatchStop(hackDispatchOwner).catch(
          () => null,
        );
        if (stop) return stoppedDispatchResponse(stop);
      }
      if (error instanceof AgentRunClaimLostError) {
        return NextResponse.json(
          {
            error: "start_superseded",
            message: "This run was canceled or replaced before it started.",
          },
          { status: 409 },
        );
      }
      if (error instanceof AgentRunBusyError) {
        return NextResponse.json(
          {
            error: "run_active",
            message: error.message,
            ...(error.runId ? { runId: error.runId } : {}),
          },
          { status: 409 },
        );
      }
      if (error instanceof ChatSDKError) {
        return error.toResponse();
      }
      console.error("[/api/agent-long] failed to trigger task:", error);
      return new NextResponse("Failed to start agent-long run", {
        status: 500,
      });
    }
  };
}
