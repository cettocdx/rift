import { NextResponse, type NextRequest } from "next/server";
import { tasks } from "@trigger.dev/sdk";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getUserID } from "@/lib/auth/get-user-id";
import { getConvexClient } from "@/lib/db/convex-client";
import { ChatSDKError } from "@/lib/errors";
import {
  readLimitedTextBody,
  RequestBodyTooLargeError,
} from "@/lib/api/read-limited-body";
import {
  assertSameOriginMcpMutation,
  McpRequestPolicyError,
} from "@/lib/ai/mcp/mcp-request-policy";

export const runtime = "nodejs";
export const maxDuration = 30;
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

/** Authenticated user intent -> durable occurrence -> existing worker, never a second harness. */
export async function POST(request: NextRequest) {
  try {
    assertSameOriginMcpMutation(request);
    const userId = await getUserID(request);
    const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
    if (!serviceKey)
      return json(
        { ok: false, error: "Task execution is temporarily unavailable." },
        503,
      );
    if (
      request.headers.get("content-type")?.split(";", 1)[0] !==
      "application/json"
    )
      return json({ ok: false, error: "Send task details as JSON." }, 415);
    let body;
    try {
      body = JSON.parse(await readLimitedTextBody(request, 2048));
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) throw error;
      return json({ ok: false, error: "Invalid task run request." }, 400);
    }
    if (
      !body ||
      typeof body.taskId !== "string" ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(body.taskId) ||
      typeof body.requestId !== "string" ||
      !/^[a-zA-Z0-9-]{8,80}$/.test(body.requestId)
    )
      return json({ ok: false, error: "Invalid task run request." }, 400);
    const client = getConvexClient();
    const leaseOwner = `manual-request:${body.requestId}`;
    const run = await client.mutation(api.tasks.requestManualRunForBackend, {
      serviceKey,
      userId,
      taskId: body.taskId as Id<"tasks">,
      requestId: body.requestId,
      leaseOwner,
      now: Date.now(),
    });
    if (run.shouldDispatch) {
      try {
        const handle = await tasks.trigger(
          "scheduled-task-worker",
          {
            executionKey: run.executionKey,
            convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL,
          },
          {
            idempotencyKey: `scheduled-worker:${run.executionKey}:${run.dispatchAttempt}`,
            idempotencyKeyTTL: "30d",
            tags: ["manual-task"],
          },
        );
        await client.mutation(api.tasks.markRunDispatchedForBackend, {
          serviceKey,
          executionKey: run.executionKey,
          leaseOwner,
          workerRunId: handle.id,
        });
      } catch {
        // The occurrence is already durable. Let the same dispatcher recover it;
        // reporting failure here would encourage a duplicate user request.
        await client
          .mutation(api.tasks.releaseRunDispatchForBackend, {
            serviceKey,
            executionKey: run.executionKey,
            leaseOwner,
            retryAt: Date.now() + 30_000,
          })
          .catch(() => undefined);
        return json({
          ok: true,
          state: "queued",
          chatId: run.chatId,
          dispatchPending: true,
        });
      }
    }
    return json({ ok: true, state: run.state, chatId: run.chatId });
  } catch (error) {
    if (error instanceof ChatSDKError) return error.toResponse();
    if (error instanceof McpRequestPolicyError)
      return json(
        { ok: false, error: "Cross-origin task requests are not allowed." },
        403,
      );
    if (error instanceof RequestBodyTooLargeError)
      return json({ ok: false, error: "Task request is too large." }, 413);
    if (error instanceof ConvexError)
      return json(
        {
          ok: false,
          error:
            typeof error.data === "string"
              ? error.data
              : "This task cannot be started.",
        },
        400,
      );
    return json(
      {
        ok: false,
        error: "Task execution is temporarily unavailable. Try again.",
      },
      503,
    );
  }
}
