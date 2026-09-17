import { reconcileOwnedRemoteExitReceipts } from "@/lib/api/reconcile-remote-exit-receipts";
import { after, NextRequest, NextResponse } from "next/server";
import { ConvexError } from "convex/values";

import { getUserIDAndPro } from "@/lib/auth/get-user-id";
import {
  getChatById,
  getActiveTriggerRun,
  setActiveTriggerRun,
} from "@/lib/db/actions";
import { ChatSDKError } from "@/lib/errors";
import {
  getOwnedTaggedRunIds,
  cancelRunAndConfirm,
  cancelClaimedRunAndConfirm,
} from "@/lib/api/agent-long-runs";
import {
  getAgentRunClaim,
  requestAgentRunCancellation,
  releaseAgentRunClaim,
  releaseCanceledAgentRunClaim,
} from "@/lib/api/agent-run-claims";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    // Authenticate before parsing or acting on user-controlled identifiers.
    const { userId } = await getUserIDAndPro(req);

    let body: {
      chatId?: string;
      temporary?: boolean;
      allowMissingChat?: boolean;
    };
    try {
      body = await req.json();
    } catch {
      return new NextResponse("Invalid JSON body", { status: 400 });
    }

    const { chatId, temporary, allowMissingChat } = body;
    if (
      !chatId ||
      typeof chatId !== "string" ||
      chatId.length > 200 ||
      chatId.trim() !== chatId
    ) {
      return new NextResponse("chatId required", { status: 400 });
    }

    const owner = { userId, chatId };
    // Claims exist before chat persistence and Trigger dispatch. Stop must
    // fence that startup too, rather than mistake a missing run id for idle.
    const claim = await getAgentRunClaim(owner);
    if (claim && claim.phase !== "released") {
      let runId = claim.runId;
      if (!runId) {
        // Preserve intent through startup release so an already-dispatched
        // worker recognizes this exact private generation as stopped.
        const markedStartup = await requestAgentRunCancellation({
          ...owner,
          claimId: claim.claimId,
        });
        if (markedStartup) {
          const released = await releaseAgentRunClaim({
            ...owner,
            claimId: claim.claimId,
          });
          if (released) return NextResponse.json({ canceled: true });
        }

        // Activation can win the unbound marker CAS. Follow only this generation;
        // an intervening replacement belongs to a later user action.
        const current = await getAgentRunClaim(owner);
        if (current?.claimId !== claim.claimId || current.phase === "released")
          return NextResponse.json({ canceled: true });
        runId = current.runId;
        if (!runId) throw new Error("Startup cancellation was not confirmed");
      }

      const marked = await requestAgentRunCancellation({
        ...owner,
        claimId: claim.claimId,
        runId,
      });
      // A replaced/released generation no longer belongs to this Stop request.
      if (!marked) return NextResponse.json({ canceled: true });
      await cancelClaimedRunAndConfirm(runId);
      const released = await releaseCanceledAgentRunClaim({
        ...owner,
        claimId: claim.claimId,
        runId,
      });
      if (!released) {
        const current = await getAgentRunClaim(owner);
        if (
          current &&
          (current.claimId !== claim.claimId || current.phase === "released")
        )
          return NextResponse.json({ canceled: true });
        // Reconcile saved remote exits after responding, independently of the
        // dead worker. This cannot certify untracked PTY/integration cleanup.
        after(async () => {
          try {
            await reconcileOwnedRemoteExitReceipts({
              ...owner,
              claimId: claim.claimId,
              runId,
            });
          } catch (error) {
            console.warn(
              JSON.stringify({
                timestamp: new Date().toISOString(),
                level: "warn",
                event: "remote_exit_reconciliation_failed",
                service: "rift-web",
                environment: process.env.NODE_ENV,
                trace_id: runId,
                errorName: error instanceof Error ? error.name : "UnknownError",
              }),
            );
          }
        });
        return NextResponse.json(
          { canceled: false, reason: "cleanup_pending" },
          { status: 202 },
        );
      }
      return NextResponse.json({ canceled: true });
    }

    if (temporary === true) {
      // Temporary mode can be enabled while viewing an existing persisted
      // chat, so it must use the tag path even when a durable row shares the
      // same chat id.
      const runIds = await getOwnedTaggedRunIds({ chatId, userId });
      if (runIds.length === 0) {
        return NextResponse.json({
          canceled: false,
          reason: "no_active_run",
        });
      }

      // Cancel every matching active run. This also cleans up rare retry races
      // where two temporary runs were started for the same chat id.
      await Promise.all(runIds.map((runId) => cancelRunAndConfirm(runId)));
      return NextResponse.json({ canceled: true });
    }

    const chat = await getChatById({ id: chatId });
    if (chat?.user_id === userId) {
      const runId = await getActiveTriggerRun({ chatId });
      if (runId) {
        await cancelRunAndConfirm(runId);
        await setActiveTriggerRun({
          chatId,
          triggerRunId: null,
          expectedRunId: runId,
        });
        return NextResponse.json({ canceled: true });
      }
    }

    // The temporary toggle can change while a turn is streaming. If the
    // caller now says "persistent" but no stored run exists, fall back to the
    // same authenticated tags so the in-flight temporary run is not orphaned.
    const fallbackRunIds = await getOwnedTaggedRunIds({ chatId, userId });
    if (fallbackRunIds.length > 0) {
      await Promise.all(
        fallbackRunIds.map((runId) => cancelRunAndConfirm(runId)),
      );
      return NextResponse.json({ canceled: true });
    }

    // A first request can fail before chat persistence. The ownership-checked
    // claim and tag lookup above still retire any startup that actually exists.
    // Only a genuinely absent row is eligible; a foreign row remains forbidden.
    if (!chat && (allowMissingChat === true || claim?.phase === "released")) {
      return NextResponse.json({
        canceled: false,
        reason: "no_active_run",
        chatMissing: true,
      });
    }

    if (!chat || chat.user_id !== userId) {
      // Unknown persistent ids remain indistinguishable from chats owned by
      // another user.
      return new NextResponse("Forbidden", { status: 403 });
    }

    return NextResponse.json({
      canceled: false,
      reason: "no_active_run",
    });
  } catch (error) {
    if (error instanceof ChatSDKError) return error.toResponse();
    if (
      error instanceof ConvexError &&
      typeof error.data === "object" &&
      error.data !== null &&
      "code" in error.data &&
      error.data.code === "FORBIDDEN"
    )
      return new NextResponse("Forbidden", { status: 403 });
    // Do not include chat/run identifiers or provider error messages in logs.
    console.error({ event: "agent_long_cancel_failed" });
    return new NextResponse("Failed to cancel run", { status: 500 });
  }
}
