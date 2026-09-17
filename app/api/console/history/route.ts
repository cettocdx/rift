import { NextRequest, NextResponse } from "next/server";
import { getUserID } from "@/lib/auth/get-user-id";
import { getChatById } from "@/lib/db/actions";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import { consoleEntries } from "@/lib/console/presentation";
import type { UIMessage } from "ai";
export async function GET(req:NextRequest) {
  try {
    const userId = await getUserID(req);
    const chatId = req.nextUrl.searchParams.get("chatId");
    if (!chatId || chatId.length > 200) return new Response(null,{status:400});
    const chat = await getChatById({id:chatId});
    if (!chat) return NextResponse.json({entries:[]});
    if (chat.user_id !== userId || !chat.console_session) return new Response(null,{status:403});
    const result = await getConvexClient().query(api.messages.getMessagesPageForBackend,{serviceKey:process.env.CONVEX_SERVICE_ROLE_KEY!, userId,chatId,paginationOpts:{numItems:60,cursor:null}});
    return NextResponse.json({entries:consoleEntries(result.page.reverse() as UIMessage[],"ready")},{headers:{"Cache-Control":"no-store"}});
  } catch { return new Response(null,{status:401}); }
}
