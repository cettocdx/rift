import { NextRequest, NextResponse } from "next/server";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchMutation } from "convex/nextjs";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import {
  readLimitedTextBody,
  RequestBodyTooLargeError,
} from "@/lib/api/read-limited-body";
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: NextRequest) {
  try {
    const token = await convexAuthNextjsToken();
    if (!token) return new Response(null, { status: 401, headers });
    let body: unknown;
    try {
      body = JSON.parse(await readLimitedTextBody(request, 4096));
    } catch (error) {
      return new Response(null, {
        status: error instanceof RequestBodyTooLargeError ? 413 : 400,
        headers,
      });
    }
    if (
      !body ||
      typeof body !== "object" ||
      !("chatId" in body) ||
      typeof body.chatId !== "string" ||
      !body.chatId ||
      body.chatId.length > 200 ||
      body.chatId.trim() !== body.chatId
    )
      return new Response(null, { status: 400, headers });
    await fetchMutation(
      api.chatStreams.cancelStreamFromClient,
      { chatId: body.chatId },
      { token },
    );
    return NextResponse.json({ canceled: true }, { headers });
  } catch (error) {
    const code =
      error instanceof ConvexError &&
      error.data &&
      typeof error.data === "object" &&
      "code" in error.data
        ? error.data.code
        : undefined;
    const status =
      code === "UNAUTHORIZED"
        ? 401
        : code === "ACCESS_DENIED" || code === "FORBIDDEN"
          ? 403
          : 503;
    return NextResponse.json({ canceled: false }, { status, headers });
  }
}
