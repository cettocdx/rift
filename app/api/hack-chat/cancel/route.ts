import { NextRequest, NextResponse } from "next/server";
import { ConvexError } from "convex/values";
import { getUserIDAndPro } from "@/lib/auth/get-user-id";
import { ChatSDKError } from "@/lib/errors";
import {
  cancelHackHttpExecution,
  isHackHttpExecutionId,
} from "@/lib/hack/http-execution";
import {
  readLimitedTextBody,
  RequestBodyTooLargeError,
} from "@/lib/api/read-limited-body";

export const maxDuration = 30;
const headers = { "Cache-Control": "private, no-store" };
const validChatId = (value: unknown): value is string =>
  typeof value === "string" &&
  !!value &&
  value.length <= 200 &&
  value.trim() === value;
export async function POST(req: NextRequest) {
  try {
    // Authenticated Stop remains available after entitlement or rollout changes.
    const { userId } = await getUserIDAndPro(req);
    let body: unknown;
    try {
      body = JSON.parse(await readLimitedTextBody(req, 4096));
    } catch (error) {
      return NextResponse.json(
        { error: "invalid_request" },
        {
          status: error instanceof RequestBodyTooLargeError ? 413 : 400,
          headers,
        },
      );
    }
    if (
      !body ||
      typeof body !== "object" ||
      !("chatId" in body) ||
      !("executionId" in body) ||
      !validChatId(body.chatId) ||
      !isHackHttpExecutionId(body.executionId) ||
      ("discard" in body && typeof body.discard !== "boolean")
    )
      return NextResponse.json(
        { error: "invalid_request" },
        { status: 400, headers },
      );
    const result = await cancelHackHttpExecution(
      { userId, chatId: body.chatId, executionId: body.executionId },
      "discard" in body && body.discard === true,
    );
    return NextResponse.json(result, {
      status: result.canceled ? 200 : 202,
      headers,
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
      return NextResponse.json(
        { error: "forbidden" },
        { status: 403, headers },
      );
    return NextResponse.json(
      { error: "stop_unavailable", canceled: false },
      { status: 503, headers },
    );
  }
}
