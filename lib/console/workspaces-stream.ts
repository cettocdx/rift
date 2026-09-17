import { makeFunctionReference } from "convex/server";
import { getConvexClient } from "@/lib/db/convex-client";
import { authority } from "./workspaces-server";

/** Observe completion without ever replaying the request. Keep only one bounded
 * SSE frame, even when an artifact is much larger than the observation buffer. */
export function observeWorkspaceStream(
  response: Response,
  userId: string,
  chatId: string,
  operationId: string,
  transport = "http",
  producerFinalizes = false,
) {
  if (!response.body) return response;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let terminal: "completed" | "failed" | undefined;
  let settled = false;
  const finish = async (status: "completed" | "failed" | "uncertain") => {
    if (settled) return;
    if (producerFinalizes && status === "completed") return;
    settled = true;
    await getConvexClient()
      .mutation(makeFunctionReference<"mutation">("consoleWorkspaces:finish"), {
        ...authority(userId),
        chatId,
        operationId,
        status,
      })
      .catch(() => {});
  };
  const headers = new Headers(response.headers);
  headers.set("x-rift-transport", transport);
  headers.set("x-rift-operation-id", operationId);
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            await finish(terminal ?? "uncertain");
            controller.close();
            return;
          }
          pending += decoder.decode(chunk.value, { stream: true });
          const frames = pending.split(/\r?\n\r?\n/);
          pending = frames.pop() ?? "";
          for (const frame of frames)
            for (const line of frame.split(/\r?\n/))
              if (line.startsWith("data: ")) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.type === "finish" && terminal !== "failed")
                    terminal =
                      data.finishReason === "error" ? "failed" : "completed";
                  if (data.type === "error" || data.type === "abort")
                    terminal = "failed";
                } catch {}
              }
          if (pending.length > 2 * 1024 * 1024) pending = "";
          controller.enqueue(chunk.value);
        } catch (error) {
          await finish("uncertain");
          controller.error(error);
        }
      },
      async cancel(reason) {
        await finish("uncertain");
        await reader.cancel(reason);
      },
    }),
    { status: response.status, headers },
  );
}
