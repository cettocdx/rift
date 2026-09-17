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

/** Explicitly resume the existing saved environment; never provision a replacement. */
export async function POST(req: NextRequest) {
  let chatId: string | null = null;
  try {
    const origin = req.headers.get("origin");
    const fetchSite = req.headers.get("sec-fetch-site");
    if (
      origin !== new URL(req.url).origin ||
      (fetchSite !== null && fetchSite !== "same-origin")
    )
      return NextResponse.json(
        { error: "cross_origin" },
        { status: 403, headers },
      );
    const { userId } = await getUserIDAndPro(req);
    const body = await req.json().catch(() => null);
    if (
      !body ||
      typeof body.chatId !== "string" ||
      !body.chatId ||
      body.chatId.length > 200 ||
      body.chatId.trim() !== body.chatId ||
      typeof body.previewUrl !== "string" ||
      !body.previewUrl ||
      body.previewUrl.length > 2048
    )
      return NextResponse.json(
        { error: "invalid_request" },
        { status: 400, headers },
      );
    chatId = body.chatId;
    const chat = await getChatById({ id: body.chatId });
    if (!chat || chat.user_id !== userId)
      return NextResponse.json(
        { error: "chat_unavailable" },
        { status: 404, headers },
      );
    const project = await resolveProjectRuntimeContext({ userId, chat });
    const namespace =
      resolveChatSandboxNamespace({
        userId,
        chatId: body.chatId,
        chat,
        projectNamespace: project.sandboxNamespace,
      }) ?? userId;
    const preview = await loadSavedPreview(body.chatId, userId);
    if (!preview || preview.url !== body.previewUrl)
      return NextResponse.json(
        {
          chatId,
          previewUrl: preview?.url ?? null,
          port: preview?.port,
          status: "stale",
        },
        { headers },
      );
    const health = await inspectSavedPreview(preview, namespace, {
      resumePaused: true,
    });
    const current = await loadSavedPreview(body.chatId, userId);
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
    return NextResponse.json(
      { chatId, previewUrl: preview.url, port: preview.port, ...health },
      { headers },
    );
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
