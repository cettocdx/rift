import { NextRequest, NextResponse } from "next/server";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

/** Native client projection. Convex verifies the session and ownership on every query. */
export async function GET(request: NextRequest) {
  const token = await convexAuthNextjsToken();
  if (!token) return json({ error: "Sign in to RIFT." }, 401);
  const options = { token };
  const chatId = request.nextUrl.searchParams.get("chatId");
  const cursor = request.nextUrl.searchParams.get("cursor");
  if ((chatId && chatId.length > 200) || (cursor && cursor.length > 4096)) {
    return json({ error: "Invalid page." }, 400);
  }
  try {
    const user = await fetchQuery(api.users.viewer, {}, options);
    if (!user) return json({ error: "Sign in to RIFT." }, 401);
    if (chatId) {
      const chat = await fetchQuery(
        api.chats.getChatByIdFromClient,
        { id: chatId },
        options,
      );
      if (!chat) return json({ error: "Conversation unavailable." }, 404);
      const messages = await fetchQuery(
        api.messages.getMessagesByChatId,
        {
          chatId,
          paginationOpts: { numItems: 40, cursor },
        },
        options,
      );
      return json({
        ...messages,
        purpose: chat.purpose ?? "security",
        page: messages.page.map((message) => ({
          id: message.id,
          role: message.role,
          parts: message.parts,
          fileDetails: message.fileDetails?.map(
            ({ fileId, name, mediaType }) => ({ fileId, name, mediaType }),
          ),
        })),
      });
    }
    const chats = await fetchQuery(
      api.chats.getUserChats,
      {
        paginationOpts: { numItems: 40, cursor },
      },
      options,
    );
    return json({
      user: {
        name: user.name ?? user.email ?? "RIFT",
        image: user.image ?? null,
      },
      page: chats.page.map((chat) => ({
        id: chat.id,
        title: chat.title,
        updatedAt: chat.update_time,
        purpose: chat.purpose ?? "security",
      })),
      isDone: chats.isDone,
      continueCursor: chats.continueCursor,
    });
  } catch {
    return json(
      { error: "RIFT is temporarily unavailable. Your session is preserved." },
      503,
    );
  }
}
