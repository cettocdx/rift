import "server-only";
import { readHackDispatchStop } from "./durable-stop";
import { NextRequest, NextResponse } from "next/server";
import { runs } from "@trigger.dev/sdk";
import { getUserIDAndPro } from "@/lib/auth/get-user-id";
import { assertHackWorkbenchAccess } from "@/lib/auth/premium-access";
import { getChatById, setActiveTriggerRun } from "@/lib/db/actions";
import {
  getAgentRunClaim,
  releaseAgentRunClaim,
} from "@/lib/api/agent-run-claims";
import {
  readAgentDispatchReceipt,
  refreshAgentDispatchTerminal,
} from "@/lib/api/agent-dispatch-admission";
import { createAgentRunReadToken } from "@/lib/api/agent-run-read-token";
import { TERMINAL_RUN_STATUSES } from "@/lib/api/agent-long-runs";
import { getAgentResumeRequestContext } from "@/lib/api/agent-resume-context";
import {
  assertLiveHackAccess,
  authorizeHackRunObservation,
} from "./durable-run";
import { ChatSDKError } from "@/lib/errors";

const headers = { "Cache-Control": "private, no-store" };
const validId = (value: string | null): value is string =>
  !!value && value.length <= 200 && value.trim() === value;
const forbidden = () =>
  new ChatSDKError("forbidden:auth", "This assessment is not available.");

/** This endpoint observes one admitted producer. It never triggers or retries one. */
export function createHackObservationHandler(exactReceipt: boolean) {
  return async function GET(req: NextRequest) {
    try {
      const { userId, subscription } = await getUserIDAndPro(req);
      assertHackWorkbenchAccess(subscription);
      const chatId = req.nextUrl.searchParams.get("chatId");
      const dispatchId = req.nextUrl.searchParams.get("dispatchId");
      if (!validId(chatId) || (exactReceipt && !validId(dispatchId)))
        return NextResponse.json(
          { error: "invalid_request" },
          { status: 400, headers },
        );
      const chat = await getChatById({ id: chatId });
      if (chat && (chat.user_id !== userId || chat.purpose !== "security"))
        throw forbidden();
      // Disabling rollout stops new admissions, not observation of an owned run.
      await assertLiveHackAccess(userId, false);
      const unconfirmed = () =>
        NextResponse.json({ delivery: "unconfirmed", dispatchId }, { headers });
      if (exactReceipt) {
        const stop = await readHackDispatchStop({
          userId,
          chatId,
          dispatchId: dispatchId!,
        });
        if (stop)
          return NextResponse.json(
            {
              delivery: stop.canceled ? "canceled" : "unconfirmed",
              dispatchId,
              canceled: stop.canceled,
              ...(!stop.canceled ? { cancelRequested: true } : {}),
            },
            { headers },
          );
      }
      if (!chat)
        return exactReceipt
          ? unconfirmed()
          : new NextResponse(null, { status: 204, headers });
      const claim = exactReceipt
        ? null
        : await getAgentRunClaim({ userId, chatId });
      if (claim && (claim.userId !== userId || claim.chatId !== chatId))
        throw forbidden();
      const receipt = exactReceipt
        ? await readAgentDispatchReceipt({
            userId,
            chatId,
            dispatchId: dispatchId!,
          })
        : null;
      const runId = exactReceipt
        ? receipt?.runId
        : claim?.phase !== "released"
          ? claim?.runId
          : undefined;
      if (!runId)
        return exactReceipt
          ? unconfirmed()
          : new NextResponse(null, { status: 204, headers });
      const run = await runs.retrieve(runId);
      if (
        run.taskIdentifier !== "hack-long" ||
        !run.payload ||
        typeof run.payload !== "object" ||
        Array.isArray(run.payload)
      )
        throw forbidden();
      const payload = run.payload as Record<string, unknown>;
      if (
        payload.userId !== userId ||
        payload.chatId !== chatId ||
        (exactReceipt && payload.dispatchId !== dispatchId) ||
        (claim && payload.startClaimId !== claim.claimId)
      )
        throw forbidden();
      const binding = await authorizeHackRunObservation(payload, runId);
      const requestContext = {
        ...getAgentResumeRequestContext(payload),
        scope: binding.scope,
        dispatchId: binding.requestMessageId,
      };
      if (TERMINAL_RUN_STATUSES.has(run.status)) {
        const saved =
          receipt ??
          (await readAgentDispatchReceipt({
            userId,
            chatId,
            dispatchId: binding.requestMessageId,
          }));
        if (
          !saved ||
          saved.claimId !== payload.startClaimId ||
          saved.runId !== runId
        )
          throw forbidden();
        if (
          saved.requiresCleanup === true &&
          saved.cleanupConfirmedAt === undefined
        )
          return NextResponse.json(
            {
              error: "cleanup_pending",
              message:
                "The assessment stream ended, but command cleanup is not confirmed. Retry Stop before sending another request in this assessment.",
              delivery: "unconfirmed",
              canceled: false,
              dispatchId: binding.requestMessageId,
              requestContext,
            },
            { status: 409, headers },
          );
      }
      if (!exactReceipt && TERMINAL_RUN_STATUSES.has(run.status)) {
        await releaseAgentRunClaim({
          userId,
          chatId,
          claimId: claim!.claimId,
          runId,
        });
        await setActiveTriggerRun({
          chatId,
          triggerRunId: null,
          expectedRunId: runId,
        });
        return new NextResponse(null, { status: 204, headers });
      }
      const refreshed =
        exactReceipt && receipt
          ? await refreshAgentDispatchTerminal(
              { userId, chatId, dispatchId: dispatchId! },
              receipt,
            )
          : undefined;
      const publicAccessToken = await createAgentRunReadToken(runId);
      return NextResponse.json(
        {
          runId,
          publicAccessToken,
          requestContext,
          ...(exactReceipt
            ? {
                delivery: "accepted",
                dispatchId,
                statusFresh: refreshed?.reconciliation !== "unavailable",
                ...(refreshed?.receipt.state === "terminal"
                  ? { terminalStatus: refreshed.receipt.terminalStatus }
                  : {}),
              }
            : {}),
        },
        { headers },
      );
    } catch (error) {
      if (error instanceof ChatSDKError) return error.toResponse();
      return NextResponse.json(
        { error: "receipt_unavailable" },
        { status: 503, headers },
      );
    }
  };
}
