import type { AgentResumeRequestContext } from "@/lib/api/agent-resume-context";
import {
  fetchAgentLongStream,
  resumeAgentLongStream,
} from "./agent-long-transport";
import { LOST_AGENT_CONNECTION_MESSAGE } from "./interrupted-response";

type HackTransportOptions = {
  chatId: string;
  durableEnabled: boolean;
  hasDurableRun?: boolean;
  hasLegacyStream: boolean;
  onHttpExecution?: (executionId: string) => void;
  onReplay: (runId: string) => void;
  onRequestContext: (context: AgentResumeRequestContext) => void;
  registerResumeAbort: (abort: () => void) => () => void;
};

/** A reconnect observes existing work; it can never enter the POST path. */
export async function fetchHackChatStream(
  options: HackTransportOptions,
  init?: RequestInit,
): Promise<Response> {
  const observeHttp = (response: Response, expected?: string) => {
    if (
      init?.method?.toUpperCase() === "GET" &&
      response.status === 503 &&
      response.headers.get("x-rift-reconnect") === "replay-pending" &&
      response.headers.get("x-rift-chat-id") === options.chatId
    ) {
      void response.body?.cancel().catch(() => {});
      throw new TypeError(LOST_AGENT_CONNECTION_MESSAGE);
    }
    if (
      init?.method?.toUpperCase() === "GET" &&
      response.status === 503 &&
      response.headers.get("x-rift-reconnect") === "pending" &&
      /^[A-Za-z0-9._~-]{1,200}$/.test(
        response.headers.get("x-rift-execution-id") ?? "",
      )
    ) {
      // The producer is still owned; useAutoResume retries this GET with backoff.
      // Never send the original message again to recover its attachment.
      void response.body?.cancel().catch(() => {});
      throw new TypeError(LOST_AGENT_CONNECTION_MESSAGE);
    }
    if (!response.ok || response.status === 204) return response;
    const received = response.headers.get("x-rift-execution-id");
    if (
      (expected && received !== expected) ||
      (received && (received.length > 200 || received.trim() !== received))
    )
      throw new Error("Assessment execution identity could not be confirmed.");
    if (received) options.onHttpExecution?.(received);
    return response;
  };
  if (init?.method?.toUpperCase() !== "GET") {
    if (options.durableEnabled)
      return fetchAgentLongStream(
        init,
        undefined,
        "hack",
        options.onRequestContext,
      );
    let expected: string | undefined;
    try {
      expected =
        typeof init?.body === "string"
          ? JSON.parse(init.body).executionId
          : undefined;
    } catch {
      /* Let the server reject malformed legacy requests. */
    }
    return observeHttp(await fetch("/api/hack-chat", init), expected);
  }
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(init.signal?.reason);
  const unregister = options.registerResumeAbort(() => controller.abort());
  if (init.signal?.aborted) forwardAbort();
  else init.signal?.addEventListener("abort", forwardAbort, { once: true });
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    unregister();
    init.signal?.removeEventListener("abort", forwardAbort);
  };
  const request = { ...init, signal: controller.signal };
  try {
    controller.signal.throwIfAborted();
    const legacyUrl = `/api/chat/${encodeURIComponent(options.chatId)}/stream`;
    let response: Response;
    if (options.durableEnabled || options.hasDurableRun) {
      response = await resumeAgentLongStream(
        `/api/hack-long/resume?chatId=${encodeURIComponent(options.chatId)}`,
        request,
        options.onReplay,
        options.onRequestContext,
      );
      if (response.status === 204 && options.hasLegacyStream)
        response = observeHttp(await fetch(legacyUrl, request));
    } else response = observeHttp(await fetch(legacyUrl, request));
    if (!response.ok || !response.body || response.status === 204) {
      cleanup();
      return response;
    }
    // Keep pending reconnect cancellation registered until the actual reader
    // finishes. Do not leak registrations across repeated reconnects.
    const reader = response.body.getReader();
    return new Response(
      new ReadableStream<Uint8Array>({
        async pull(out) {
          try {
            const next = await reader.read();
            if (next.done) {
              cleanup();
              out.close();
            } else out.enqueue(next.value);
          } catch (error) {
            cleanup();
            out.error(error);
          }
        },
        async cancel(reason) {
          cleanup();
          controller.abort(reason);
          await reader.cancel(reason);
        },
      }),
      {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      },
    );
  } catch (error) {
    cleanup();
    throw error;
  }
}

/** HTTP success is not proof that the producer acknowledged Stop. */
export async function cancelHackRun(
  {
    chatId,
    dispatchId,
    executionId,
    transport,
    durable,
    cancelLegacy,
  }: {
    chatId: string;
    dispatchId?: string;
    executionId?: string;
    transport?: "durable" | "http" | "legacy";
    durable: boolean;
    cancelLegacy: () => Promise<unknown>;
  },
  timeoutMs = 35_000,
): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const notConfirmed = () =>
    new Error("Assessment cancellation was not confirmed. Try Stop again.");
  const waitForAcknowledgment = () =>
    new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(delay);
        controller.signal.removeEventListener("abort", onAbort);
        reject(notConfirmed());
      };
      const delay = setTimeout(() => {
        controller.signal.removeEventListener("abort", onAbort);
        resolve();
      }, 750);
      controller.signal.addEventListener("abort", onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
    });
  const exactHttp = transport === "http" || executionId !== undefined;
  const exactId = exactHttp ? executionId : dispatchId;
  if (
    (durable || exactHttp) &&
    (!exactId || exactId.length > 200 || exactId.trim() !== exactId)
  )
    throw notConfirmed();
  try {
    await Promise.race([
      (async () => {
        const pending: Promise<unknown>[] = [];
        if (durable || exactHttp)
          pending.push(
            (async () => {
              while (true) {
                controller.signal.throwIfAborted();
                const response = await fetch(
                  exactHttp ? "/api/hack-chat/cancel" : "/api/hack-long/cancel",
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      chatId,
                      ...(exactHttp ? { executionId } : { dispatchId }),
                    }),
                    signal: controller.signal,
                  },
                );
                if (!response.ok) throw notConfirmed();
                const result = await response.json();
                controller.signal.throwIfAborted();
                if (
                  !result ||
                  (exactHttp ? result.executionId : result.dispatchId) !==
                    exactId
                )
                  throw notConfirmed();
                if (response.status === 202) {
                  await waitForAcknowledgment();
                  continue;
                }
                if (result.canceled !== true) throw notConfirmed();
                return;
              }
            })(),
          );
        if (!durable && !exactHttp) pending.push(cancelLegacy());
        const results = await Promise.allSettled(pending);
        if (results.some((result) => result.status === "rejected"))
          throw notConfirmed();
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(notConfirmed());
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
