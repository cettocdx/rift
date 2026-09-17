import { withAgentLongStreamHeartbeat } from "@/lib/chat/agent-long-heartbeat";
import { NextRequest } from "next/server";
import { POST as start } from "@/app/api/agent-long/route";
import { GET as resume } from "@/app/api/agent-long/resume/route";
import { POST as startHackDirect } from "@/app/api/hack-chat/route";
import { POST as startHack } from "@/app/api/hack-long/route";
import { GET as resumeHack } from "@/app/api/hack-long/resume/route";
import { GET as resumeStudio } from "@/app/api/chat/[id]/stream/route";
import { POST as startStudio } from "@/app/api/chat/route";
import { buildSSEResponseFromRun } from "@/lib/chat/agent-long-transport";

export const maxDuration = 800;

// Match the web workbench's deployment capabilities before dispatch. Never
// retry a rejected durable dispatch on the direct path (it may already exist).
function durableHackEnabled() {
  return (
    process.env.RIFT_DURABLE_HACK_ENABLED === "true" &&
    process.env.RIFT_DURABLE_DISPATCH_ADMISSION === "true"
  );
}

// Delegate to the original handlers: ownership, entitlement and approval gates
// are enforced there. A reader disconnect never starts a second task.
async function stream(response: Response, signal: AbortSignal) {
  if (!response.ok || response.status === 204) return response;
  return buildSSEResponseFromRun(await response.json(), signal);
}
// Comments are invisible to the native SSE reducer. Only emit between complete
// frames: inserting a comment into a split JSON chunk would corrupt the event.
function keepNativeStreamAlive(
  response: Response,
  signal: AbortSignal,
): Response {
  if (
    !response.ok ||
    !response.body ||
    !response.headers.get("content-type")?.includes("text/event-stream")
  )
    return response;
  let tail = "";
  let boundary = true;
  const source = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        for (const byte of chunk.subarray(Math.max(0, chunk.length - 4)))
          tail = (tail + String.fromCharCode(byte)).slice(-4);
        if (chunk.length)
          boundary = tail.endsWith("\n\n") || tail.endsWith("\r\n\r\n");
        controller.enqueue(chunk);
      },
    }),
  );
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("X-Accel-Buffering", "no");
  return new Response(
    withAgentLongStreamHeartbeat({
      source,
      signal,
      heartbeat: () =>
        new TextEncoder().encode(boundary ? ": keep-alive\n\n" : ""),
    }),
    { status: response.status, statusText: response.statusText, headers },
  );
}
export async function POST(request: NextRequest) {
  const purpose = request.nextUrl.searchParams.get("purpose");
  if (purpose === "image")
    return keepNativeStreamAlive(await startStudio(request), request.signal);
  if (purpose === "security") {
    const durable = durableHackEnabled();
    const response = durable
      ? await stream(await startHack(request), request.signal)
      : await startHackDirect(request);
    response.headers.set("X-RIFT-Hack-Transport", durable ? "durable" : "http");
    return response;
  }
  return stream(await start(request), request.signal);
}
export async function GET(request: NextRequest) {
  if (
    request.nextUrl.searchParams.get("purpose") === "image" ||
    (request.nextUrl.searchParams.get("purpose") === "security" &&
      !durableHackEnabled())
  )
    return keepNativeStreamAlive(
      await resumeStudio(request, {
        params: Promise.resolve({
          id: request.nextUrl.searchParams.get("chatId") ?? "",
        }),
      }),
      request.signal,
    );
  const purpose = request.nextUrl.searchParams.get("purpose");
  return stream(
    await (purpose === "security" ? resumeHack : resume)(request),
    request.signal,
  );
}
