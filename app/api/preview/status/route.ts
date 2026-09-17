import { NextRequest, NextResponse } from "next/server";
import { getUserIDAndPro } from "@/lib/auth/get-user-id";
import { getChatById } from "@/lib/db/actions";
import { ChatSDKError } from "@/lib/errors";
import {
  resolveChatSandboxNamespace,
  resolveProjectRuntimeContext,
} from "@/lib/projects/project-runtime";
import { loadSavedPreview } from "@/lib/preview/saved-preview";
import { inspectSavedPreview } from "@/lib/preview/status";

export const runtime = "nodejs";
export const maxDuration = 30;
const headers = { "Cache-Control": "private, no-store" };

export async function GET(req: NextRequest) {
  let chatId: string | null = null;
  try {
    const { userId } = await getUserIDAndPro(req);
    chatId = req.nextUrl.searchParams.get("chatId");
    if (!chatId || chatId.length > 200 || chatId.trim() !== chatId)
      return NextResponse.json(
        { error: "invalid_request" },
        { status: 400, headers },
      );
    const chat = await getChatById({ id: chatId });
    if (!chat || chat.user_id !== userId)
      return NextResponse.json(
        { error: "chat_unavailable" },
        { status: 404, headers },
      );
    const project = await resolveProjectRuntimeContext({ userId, chat });
    const namespace =
      resolveChatSandboxNamespace({
        userId,
        chatId,
        chat,
        projectNamespace: project.sandboxNamespace,
      }) ?? userId;
    const preview = await loadSavedPreview(chatId, userId);
    if (!preview)
      return NextResponse.json(
        { chatId, previewUrl: null, status: "unavailable" },
        { headers },
      );
    const identity = { chatId, previewUrl: preview.url, port: preview.port };
    const expected = req.nextUrl.searchParams.get("previewUrl");
    if (expected !== null && expected !== preview.url)
      return NextResponse.json({ ...identity, status: "stale" }, { headers });
    const health = await inspectSavedPreview(preview, namespace);
    // Do not return a running proof for evidence superseded while E2B was checked.
    const current = await loadSavedPreview(chatId, userId);
    if (current?.url !== preview.url || current?.port !== preview.port)
      return NextResponse.json(
        {
          chatId,
          previewUrl: current?.url ?? null,
          port: current?.port,
          status: "stale",
        },
        { headers },
      );
    return NextResponse.json({ ...identity, ...health }, { headers });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      const response = error.toResponse();
      response.headers.set("Cache-Control", headers["Cache-Control"]);
      return response;
    }
    return NextResponse.json(
      { chatId, status: "transient" },
      { status: 503, headers },
    );
  }
}
