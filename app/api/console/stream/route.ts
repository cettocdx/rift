import { NextRequest } from "next/server";
import { POST as start } from "@/app/api/agent-long/route";
import { GET as resume } from "@/app/api/agent-long/resume/route";
import { buildSSEResponseFromRun } from "@/lib/chat/agent-long-transport";
import { getUserID } from "@/lib/auth/get-user-id";
import { getChatById } from "@/lib/db/actions";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
export const maxDuration = 800;
// Same authenticated Build worker; disconnecting its reader does not cancel it.
async function stream(response: Response, signal: AbortSignal) {
  if (!response.ok || response.status === 204) return response;
  return buildSSEResponseFromRun(await response.json(), signal);
}
export async function POST(req: NextRequest) {
  let userId: string;
  try { userId = await getUserID(req); } catch { return new Response(null, {status:401}); }
  const body = await req.clone().json().catch(() => null);
  if (!body || typeof body.chatId !== "string" || !/^[\da-f-]{36}$/i.test(body.chatId)) return new Response(null, {status:400});
  const chat = await getChatById({id:body.chatId});
  if (chat && (chat.user_id !== userId || !chat.console_session)) return new Response(null, {status:403});
  await getConvexClient().mutation(api.chats.ensureConsoleChat, {serviceKey:process.env.CONVEX_SERVICE_ROLE_KEY!, userId, chatId:body.chatId});
  return stream(await start(req), req.signal);
}
export async function GET(req: NextRequest) {
  let userId: string;
  try { userId = await getUserID(req); } catch { return new Response(null, {status:401}); }
  const chatId = req.nextUrl.searchParams.get("chatId");
  if (!chatId || chatId.length > 200) return new Response(null, {status:400});
  const chat = await getChatById({id:chatId});
  if (!chat) return new Response(null, {status:204});
  if (chat.user_id !== userId || !chat.console_session) return new Response(null, {status:403});
  return stream(await resume(req), req.signal);
}
