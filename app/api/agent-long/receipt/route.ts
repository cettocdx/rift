import { NextRequest, NextResponse } from "next/server";
import { getUserIDAndPro } from "@/lib/auth/get-user-id";
import { getChatById } from "@/lib/db/actions";
import { ChatSDKError } from "@/lib/errors";
import { assertHackWorkbenchPurposeRoute } from "@/lib/auth/premium-access";
import { coerceChatPurpose } from "@/types";
import {
  agentDispatchAdmissionEnabled,
  readAgentDispatchReceipt,
  refreshAgentDispatchTerminal,
} from "@/lib/api/agent-dispatch-admission";
import { createAgentRunReadToken } from "@/lib/api/agent-run-read-token";

export const maxDuration = 30;
const headers = { "Cache-Control": "no-store" };
const validId = (value: string | null): value is string =>
  !!value && value.length <= 200 && value.trim() === value;

/** Read one logical request, never whichever run currently occupies the chat.
 * Missing receipt is uncertainty, not permission to submit another task. */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await getUserIDAndPro(req);
    if (!agentDispatchAdmissionEnabled())
      return NextResponse.json(
        { error: "receipt_unavailable" },
        { status: 503, headers },
      );
    const chatId = req.nextUrl.searchParams.get("chatId");
    const dispatchId = req.nextUrl.searchParams.get("dispatchId");
    if (!validId(chatId) || !validId(dispatchId))
      return NextResponse.json(
        { error: "invalid_request" },
        { status: 400, headers },
      );
    const chat = await getChatById({ id: chatId });
    if (chat && chat.user_id !== userId)
      return NextResponse.json(
        { error: "forbidden" },
        { status: 403, headers },
      );
    if (chat)
      assertHackWorkbenchPurposeRoute(coerceChatPurpose(chat.purpose), false);
    // The backend independently validates chat/claim ownership and the exact
    // owner/chat/request tuple. This performs no reservation or billing.
    const receipt = await readAgentDispatchReceipt({
      userId,
      chatId,
      dispatchId,
    });
    if (!receipt?.runId)
      return NextResponse.json(
        { delivery: "unconfirmed", dispatchId },
        { headers },
      );
    const [refreshed, publicAccessToken] = await Promise.all([
      refreshAgentDispatchTerminal({ userId, chatId, dispatchId }, receipt),
      createAgentRunReadToken(receipt.runId),
    ]);
    return NextResponse.json(
      {
        delivery: "accepted",
        dispatchId,
        runId: receipt.runId,
        publicAccessToken,
        statusFresh: refreshed.reconciliation !== "unavailable",
        ...(refreshed.receipt.state === "terminal"
          ? { terminalStatus: refreshed.receipt.terminalStatus }
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
}
