import { after, NextRequest, NextResponse } from "next/server";
import { reconcileOwnedRemoteExitReceipts } from "@/lib/api/reconcile-remote-exit-receipts";
import { runs, auth, ApiError } from "@trigger.dev/sdk";

import { getUserIDAndPro } from "@/lib/auth/get-user-id";
import {
  getChatById,
  getActiveTriggerRun,
  setActiveTriggerRun,
} from "@/lib/db/actions";
import { ChatSDKError } from "@/lib/errors";
import { assertHackWorkbenchPurposeRoute } from "@/lib/auth/premium-access";
import { getOwnedTaggedRunIds } from "@/lib/api/agent-long-runs";
import { coerceChatPurpose } from "@/types";
import { getAgentResumeRequestContext } from "@/lib/api/agent-resume-context";
import {
  getAgentRunClaim,
  releaseAgentRunClaim,
} from "@/lib/api/agent-run-claims";

export const maxDuration = 30;

const TERMINAL_STATUSES = new Set([
  "COMPLETED",
  "CANCELED",
  "FAILED",
  "CRASHED",
  "SYSTEM_FAILURE",
  "EXPIRED",
  "TIMED_OUT",
]);

// Reconnect endpoint for agent-long. Given a chatId, resolve the in-flight
// trigger.dev runId from Convex, verify it's still executing, and mint a
// fresh public access token the client can use to subscribe to the stream.
// Returns 204 (which useChat's reconnectToStream treats as "nothing to
// resume") when there's no active run, or when the stored run has reached a
// terminal state — in which case we also clear the stale id.
export async function GET(req: NextRequest) {
  try {
    const { userId } = await getUserIDAndPro(req);

    const chatId = req.nextUrl.searchParams.get("chatId");
    if (!chatId) {
      return new NextResponse("chatId required", { status: 400 });
    }

    const chat = await getChatById({ id: chatId });

    // Every gate runs before any run is resolved, and the token is minted once
    // at the very bottom. Keep it that way: an early mint inside a branch is
    // how a reconnect endpoint quietly becomes a way to reach a run that one
    // of these checks would have refused.
    if (chat) {
      if (chat.user_id !== userId) {
        return new NextResponse("Forbidden", { status: 403 });
      }

      // Hack Workbench never resumes through the normal durable Build worker.
      // Reject legacy/forged security chats before minting a Trigger.dev public
      // token so the generic reconnect endpoint cannot become a second Hack UI.
      assertHackWorkbenchPurposeRoute(coerceChatPurpose(chat.purpose), false);
    }

    // A chat with no durable row is a temporary one: nowhere to store a run id,
    // which is why temporary agent turns were permanently unreconnectable --
    // the run executed and billed while the UI had no handle for it at all.
    // A persistent chat can ALSO be missing its stored id, because the write
    // that stores it races the request it lives in. Both fall back to the
    // server-written Trigger tags, which outlive that race and belong to no
    // browser: ownership is proved by the run carrying BOTH this user's tag
    // and this chat's, never by the caller's chat id alone.
    const [storedRunId, claim] = await Promise.all([
      chat ? getActiveTriggerRun({ chatId }) : Promise.resolve(null),
      getAgentRunClaim({ userId, chatId }),
    ]);
    if (claim && (claim.userId !== userId || claim.chatId !== chatId)) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    // Keep terminal evidence local to this request. A claim and chat pointer
    // usually name the same run, so reconciliation needs only one remote read.
    const observedRuns = new Map<
      string,
      { status: string; payload?: unknown }
    >();
    const retrieveObservedRun = async (id: string) => {
      const observed = observedRuns.get(id);
      if (observed) return observed;
      // A missing provider record is not an observed terminal run. Preserve
      // the original handle on 404 just as on a transport outage.
      const run = await runs.retrieve(id);
      const result = { status: run.status, payload: run.payload };
      observedRuns.set(id, result);
      return result;
    };

    // Worker cleanup may fail or never run. The claim survives independently
    // of the chat pointer, including temporary chats. Never expire it by age:
    // release only this observed owner/claim/run after definitive remote proof.
    if (claim?.runId && claim.phase !== "released") {
      const run = await retrieveObservedRun(claim.runId);
      if (TERMINAL_STATUSES.has(run.status)) {
        const binding = {
          userId,
          chatId,
          claimId: claim.claimId,
          runId: claim.runId,
        };
        const released = await releaseAgentRunClaim(binding);
        if (!released) {
          // Returning to a completed chat must also repair an interrupted
          // cleanup acknowledgement, without delaying stream attachment or
          // treating worker termination as remote command exit proof.
          after(async () => {
            await reconcileOwnedRemoteExitReceipts(binding);
          });
        }
      }
    }

    // A stored id still has to be proved alive, and a DEAD one does not mean
    // there is nothing to resume: a cancelled-and-resent turn can briefly
    // leave the previous run's id behind while the replacement is the run the
    // user is actually watching. So a terminal stored id is cleared and then
    // falls through to the tags rather than answering "nothing here" -- which
    // is the same mistake, one layer down, as the bug this endpoint is being
    // fixed for.
    let runId: string | null = null;
    let runPayload: unknown;
    if (storedRunId) {
      const run = await retrieveObservedRun(storedRunId);
      const runStatus = run.status;
      runPayload = run.payload;

      if (runStatus && TERMINAL_STATUSES.has(runStatus)) {
        await setActiveTriggerRun({
          chatId,
          triggerRunId: null,
          expectedRunId: storedRunId,
        });
      } else {
        runId = storedRunId;
      }
    }

    if (!runId) {
      // Retrieve the original request settings too. A run may finish between
      // the tag lookup and this read; never seed a replacement from a dead run.
      for (const taggedRunId of await getOwnedTaggedRunIds({
        chatId,
        userId,
      })) {
        const run = await retrieveObservedRun(taggedRunId);
        if (TERMINAL_STATUSES.has(run.status)) continue;
        runId = taggedRunId;
        runPayload = run.payload;
        break;
      }
      if (!runId) {
        return new NextResponse(null, { status: 204 });
      }

      // Deliberately NOT written back to the chat row. It looks like a free
      // repair -- next reconnect costs one read instead of a list -- and it is
      // a trap: a run clears its own mapping from inside its body and only
      // then returns, so between that clear and Trigger marking it terminal
      // the row reads null while the run still lists as ACTIVE. A write here
      // lands in that window and reinstates an id whose only clear has already
      // happened, leaving the chat permanently marked as running (and Stop
      // aiming at the wrong run). The list costs one call on a path that used
      // to be broken outright; that is the better trade.
    }

    // Defense in depth for a stale/incorrect stored mapping. A worker payload
    // belongs to this request only when both immutable ownership IDs match.
    // Older runs without a returned payload may still reconnect through the
    // existing row/tag proof; they cannot seed automatic continuation settings.
    let requestContext;
    if (
      runPayload &&
      typeof runPayload === "object" &&
      !Array.isArray(runPayload)
    ) {
      const payload = runPayload as Record<string, unknown>;
      if (payload.userId !== userId || payload.chatId !== chatId) {
        return new NextResponse("Forbidden", { status: 403 });
      }
      requestContext = getAgentResumeRequestContext(payload);
      assertHackWorkbenchPurposeRoute(requestContext.purpose, false);
    }

    const publicAccessToken = await auth.createPublicToken({
      scopes: { read: { runs: [runId] } },
      expirationTime: "6h",
    });

    return NextResponse.json(
      { runId, publicAccessToken, requestContext },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof ChatSDKError) return error.toResponse();
    if (error instanceof ApiError && error.status === 404) {
      return NextResponse.json(
        {
          error: "run_status_unavailable",
          message:
            "Reconnecting to your task. Its status could not be verified yet.",
        },
        {
          status: 503,
          headers: { "Retry-After": "3", "Cache-Control": "private, no-store" },
        },
      );
    }
    console.error("[/api/agent-long/resume] failed:", error);
    return new NextResponse("Failed to resume run", { status: 500 });
  }
}
