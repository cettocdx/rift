import { NextRequest, NextResponse } from "next/server";
import { getUserID } from "@/lib/auth/get-user-id";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import {
  summarizeWorkspaceUsage,
  validWorkspaceIdentity,
} from "@/lib/console/workspace-usage";
export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  let userId: string;
  try {
    userId = await getUserID(req);
  } catch {
    return new Response("Sign in to RIFT.", { status: 401 });
  }
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  const chatId = req.nextUrl.searchParams.get("chatId");
  if (!!sessionId === !!chatId || !validWorkspaceIdentity(sessionId ?? chatId))
    return new Response("Choose a valid session or chat.", { status: 400 });
  try {
    const receipts = await getConvexClient().query(
      api.extraUsage.getConsoleUsageReceipts,
      {
        serviceKey: getConvexServiceKey()!,
        userId,
        ...(sessionId ? { sessionId } : { chatId: chatId! }),
      },
    );
    return NextResponse.json(
      summarizeWorkspaceUsage(sessionId ?? chatId!, receipts),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { version: 1, status: "unknown", credits: null, usd: null },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
