import {
  readHackHttpExecution,
  type HackHttpExecutionBinding,
} from "@/lib/hack/http-execution";
import type { NextRequest } from "next/server";
import {
  createUIMessageStream,
  JsonToSseTransformStream,
  UI_MESSAGE_STREAM_HEADERS,
} from "ai";
import { ChatSDKError } from "@/lib/errors";
import type { ChatMessage } from "@/types/chat";
import { coerceChatPurpose } from "@/types/chat";
import { getStreamContext } from "@/lib/api/chat-handler";
import { getUserIDAndPro } from "@/lib/auth/get-user-id";
import { assertHackWorkbenchAccess } from "@/lib/auth/premium-access";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import {
  createCancellationSubscriber,
  createPreemptiveTimeout,
} from "@/lib/utils/stream-cancellation";
import { phLogger } from "@/lib/posthog/server";
import { readStreamChunkWithAbort } from "@/lib/api/read-stream-chunk-with-abort";

export const maxDuration = 800;

function pendingExecution(execution: HackHttpExecutionBinding) {
  return new Response(
    "Assessment stream attachment is temporarily unavailable",
    {
      status: 503,
      headers: {
        "x-rift-execution-id": execution.executionId,
        "x-rift-reconnect": "pending",
        "Retry-After": "1",
      },
    },
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: chatId } = await params;

  const streamContext = getStreamContext();

  if (!chatId) {
    return new ChatSDKError("bad_request:api").toResponse();
  }

  // Authenticate user
  let userId: string;
  let subscription: Awaited<ReturnType<typeof getUserIDAndPro>>["subscription"];
  try {
    const access = await getUserIDAndPro(req);
    userId = access.userId;
    subscription = access.subscription;
  } catch (error) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY!;

  // Load chat and enforce ownership
  let chat: any | null = null;
  try {
    chat = await convex.query(api.chats.getChatById, {
      serviceKey,
      id: chatId,
    });
  } catch {
    return new ChatSDKError("not_found:chat").toResponse();
  }

  if (!chat) {
    return new ChatSDKError("not_found:chat").toResponse();
  }

  if (chat.user_id !== userId) {
    return new ChatSDKError("forbidden:chat").toResponse();
  }

  // Reconnect/replay is part of Hack Workbench access, not a generic chat
  // read path. Re-check the current Max entitlement here so a copied stream
  // URL or a subscription downgrade cannot bypass the Max page and POST
  // gates. Legacy chats without a purpose intentionally coerce to security.
  if (coerceChatPurpose(chat.purpose) === "security") {
    try {
      assertHackWorkbenchAccess(subscription);
    } catch (error) {
      if (error instanceof ChatSDKError) return error.toResponse();
      throw error;
    }
  }

  const recentStreamId: string | undefined = chat.active_stream_id;
  const isTemporary = chat.temporary === true;
  let execution: HackHttpExecutionBinding | undefined;
  if (recentStreamId && chat.active_http_execution_id === recentStreamId) {
    const binding = { userId, chatId, executionId: recentStreamId };
    try {
      if (!(await readHackHttpExecution(binding))) {
        return pendingExecution(binding);
      }
      execution = binding;
    } catch {
      return pendingExecution(binding);
    }
  }
  if (!streamContext && execution) return pendingExecution(execution);
  // Legacy active producers have no exact terminal proof for safe replay.
  if (!streamContext && recentStreamId)
    return new Response(null, { status: 204 });
  const executionHeaders = execution
    ? { "x-rift-execution-id": execution.executionId }
    : undefined;

  const streamHeaders = {
    ...UI_MESSAGE_STREAM_HEADERS,
    "cache-control": "private, no-store",
    ...executionHeaders,
  };

  const emptyDataStream = createUIMessageStream<ChatMessage>({
    execute: () => {},
  });

  // Best-effort cleanup of a stale `active_stream_id`. Called whenever we
  // detect the producer is dead so subsequent reconnects skip straight to
  // replay instead of hitting the ack-timeout (~5s) again.
  const clearStaleActiveStream = async () => {
    try {
      // A missing Redis acknowledgment is not evidence that the producer died.
      // Keep its exact mapping so Stop still targets the admitted execution.
      if (execution) {
        const status = await readHackHttpExecution(execution);
        if (
          !status ||
          status.phase === "admitted" ||
          status.phase === "running"
        )
          return;
      }
      if (!recentStreamId) return;
      await convex.mutation(api.chatStreams.prepareForNewStream, {
        serviceKey,
        chatId,
        expectedStreamId: recentStreamId,
      });
    } catch {
      // Best-effort — the next reconnect will re-attempt cleanup.
    }
  };

  if (recentStreamId && streamContext) {
    let stream: ReadableStream | null = null;
    let resumableThrew = false;
    try {
      stream = await streamContext.resumableStream(recentStreamId, () =>
        emptyDataStream.pipeThrough(new JsonToSseTransformStream()),
      );
    } catch {
      // Producer is gone (ack timeout) — fall through to replay fallback
      resumableThrew = true;
    }

    if (resumableThrew) {
      await clearStaleActiveStream();
    }

    if (stream) {
      const reader = stream.getReader();

      // Peek the first chunk. When `active_stream_id` is still set in DB but
      // the resumable buffer is empty (producer finished and the buffer
      // expired), `resumableStream` invokes the no-op fallback, which emits
      // only the SSE `[DONE]` terminator. Returning that to the client renders
      // an empty assistant message — fall through to the replay branch instead.
      let first: ReadableStreamReadResult<unknown>;
      try {
        first = await readStreamChunkWithAbort(reader, req.signal);
      } catch (error) {
        await reader.cancel().catch(() => {});
        if (error instanceof DOMException && error.name === "AbortError") {
          return new Response(null, { status: 204 });
        }
        throw error;
      }
      const firstText = first.done
        ? ""
        : typeof first.value === "string"
          ? first.value
          : new TextDecoder().decode(first.value as Uint8Array);
      const isNoopStream =
        first.done || /^\s*data:\s*\[DONE\]\s*$/.test(firstText.trim());

      if (isNoopStream) {
        reader.releaseLock();
        try {
          await stream.cancel();
        } catch {
          // ignore — falling through to replay
        }
        await clearStaleActiveStream();
      } else {
        const abortController = new AbortController();

        // Set up pre-emptive timeout before Vercel's hard 800s limit
        const preemptiveTimeout = createPreemptiveTimeout({
          chatId,
          endpoint: "/api/chat/[id]/stream",
          abortController,
        });

        // Abort on client disconnect (tab close, network error, etc.)
        const abortOnClientDisconnect = () => abortController.abort();
        if (req.signal.aborted) {
          abortOnClientDisconnect();
        } else {
          req.signal.addEventListener("abort", abortOnClientDisconnect, {
            once: true,
          });
        }

        // Abort on explicit stop button click (via Redis pub/sub or polling)
        const cancellationSubscriber = await createCancellationSubscriber({
          chatId,
          isTemporary,
          execution,
          abortController,
          onStop: () => {},
        });

        let pendingFirstDelivered = false;
        /**
         * A stream can only be settled once.
         *
         * `pull` runs again after a failure, and the transport can abort while
         * an error is already in flight — so `close()` was reachable on a
         * controller that `error()` had already terminated. The browser turns
         * that into "Cannot close an errored readable stream", which surfaces
         * to the operator as the agent connection dropping mid-run.
         */
        let settled = false;
        let cleanupPromise: Promise<void> | undefined;
        const cleanup = (cancelReader: boolean) => {
          if (cleanupPromise) return cleanupPromise;

          cleanupPromise = (async () => {
            preemptiveTimeout.clear();
            req.signal.removeEventListener("abort", abortOnClientDisconnect);
            await cancellationSubscriber.stop().catch(() => {});
            if (cancelReader) {
              await reader.cancel().catch(() => {});
            }
          })();
          return cleanupPromise;
        };

        // The request can disconnect between the first-chunk peek and
        // subscriber setup. Do not return a live body with no consumer.
        if (abortController.signal.aborted) {
          await cleanup(true);
          return new Response(null, { status: 204 });
        }

        const abortableStream = new ReadableStream({
          async pull(controller) {
            const settleClosed = () => {
              if (settled) return;
              settled = true;
              try {
                controller.close();
              } catch {
                // Already errored or cancelled by the consumer.
              }
            };
            const settleErrored = (error: unknown) => {
              if (settled) return;
              settled = true;
              try {
                controller.error(error);
              } catch {
                // Already settled by the consumer cancelling the body.
              }
            };
            if (settled) return;
            try {
              if (!pendingFirstDelivered) {
                pendingFirstDelivered = true;
                controller.enqueue(first.value);
                return;
              }

              const { done, value } = await readStreamChunkWithAbort(
                reader,
                abortController.signal,
              );

              if (done) {
                await cleanup(false);
                settleClosed();
              } else {
                controller.enqueue(value);
              }
            } catch (error) {
              const isPreemptive = preemptiveTimeout.isPreemptive();
              const triggerTime = preemptiveTimeout.getTriggerTime();
              const cleanupStart = Date.now();

              if (isPreemptive) {
                phLogger.info("Stream route preemptive abort caught", {
                  userId,
                  chatId,
                  timeSinceTriggerMs: triggerTime
                    ? cleanupStart - triggerTime
                    : null,
                });
              }

              if (
                error instanceof DOMException &&
                error.name === "AbortError"
              ) {
                await cleanup(true);
                if (isPreemptive) {
                  phLogger.info("Stream route closing controller after abort", {
                    userId,
                    chatId,
                    cleanupDurationMs: Date.now() - cleanupStart,
                  });
                  await phLogger.flush();
                }
                settleClosed();
              } else {
                await cleanup(true);
                settleErrored(error);
              }
            }
          },
          async cancel() {
            const isPreemptive = preemptiveTimeout.isPreemptive();
            if (isPreemptive) {
              phLogger.info("Stream route cancel called", { userId, chatId });
            }
            await cleanup(true);
            if (isPreemptive) {
              // Await so the serverless runtime doesn't tear down before flush.
              await phLogger.flush();
            }
          },
        });

        return new Response(abortableStream, {
          status: 200,
          headers: streamHeaders,
        });
      }
    }
  }

  // A missing subscriber attachment does not complete its producer. Replaying
  // the previous turn here would make recovery settle with the wrong answer.
  if (execution) {
    try {
      const status = await readHackHttpExecution(execution);
      if (
        !status ||
        status.phase === "admitted" ||
        status.phase === "running"
      ) {
        return pendingExecution(execution);
      }
    } catch {
      return pendingExecution(execution);
    }
  }

  // Fallback: only a settled producer may replay its most recent assistant message.
  try {
    const mostRecentMessage = await convex.query(
      api.messages.getLastAssistantMessage,
      {
        serviceKey,
        chatId,
        userId,
      },
    );

    if (!mostRecentMessage) {
      // Producer is dead and there's nothing to replay — clear the stale
      // active_stream_id so the chat isn't stuck in a "resuming" state on
      // every page load.
      if (recentStreamId) {
        await clearStaleActiveStream();
      }
      return new Response(
        emptyDataStream
          .pipeThrough(new JsonToSseTransformStream())
          .pipeThrough(new TextEncoderStream()),
        { status: 200, headers: streamHeaders },
      );
    }

    const restoredStream = createUIMessageStream<ChatMessage>({
      execute: ({ writer }) => {
        writer.write({
          type: "data-appendMessage",
          data: JSON.stringify(mostRecentMessage),
          transient: true,
        });
      },
    });

    return new Response(
      restoredStream
        .pipeThrough(new JsonToSseTransformStream())
        .pipeThrough(new TextEncoderStream()),
      { status: 200, headers: streamHeaders },
    );
  } catch {
    // An unavailable saved answer is not an empty successful completion.
    // Bind the retry to this authenticated chat, without inventing an active
    // execution identity or submitting the user's task again.
    return new Response("Saved response is temporarily unavailable", {
      status: 503,
      headers: {
        "cache-control": "private, no-store",
        "x-rift-reconnect": "replay-pending",
        "x-rift-chat-id": chatId,
        "Retry-After": "1",
      },
    });
  }
}
