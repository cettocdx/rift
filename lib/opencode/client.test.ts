/**
 * @jest-environment node
 */
import { createOpenCodeClient, OpenCodeHttpError } from "@/lib/opencode/client";

function mockFetch(handler: (url: string, init: any) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: any }> = [];
  const f = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  }) as unknown as typeof fetch;
  return { f, calls };
}

const base = { baseUrl: "https://4096-sbx.e2b.app", authHeader: "Basic abc", directory: "/home/user/workspace" };
const dir = encodeURIComponent("/home/user/workspace");

describe("createOpenCodeClient", () => {
  it("GET carries auth + directory as a query param", async () => {
    const { f, calls } = mockFetch(() => new Response(JSON.stringify({ healthy: true, version: "1.18.26" })));
    const c = createOpenCodeClient({ ...base, fetchImpl: f });
    expect(await c.health()).toEqual({ healthy: true, version: "1.18.26" });
    expect(calls[0].url).toBe(`${base.baseUrl}/global/health?directory=${dir}`);
    expect(calls[0].init.headers.Authorization).toBe("Basic abc");
  });

  it("POST sends JSON with the directory header; 204 resolves undefined", async () => {
    const { f, calls } = mockFetch(() => new Response(null, { status: 204 }));
    const c = createOpenCodeClient({ ...base, fetchImpl: f });
    await expect(
      c.promptAsync("ses_1", { parts: [{ type: "text", text: "hi" }], model: { providerID: "gateway", modelID: "m" } }),
    ).resolves.toBeUndefined();
    expect(calls[0].url).toBe(`${base.baseUrl}/session/ses_1/prompt_async`);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers["x-opencode-directory"]).toBe(dir);
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ model: { providerID: "gateway", modelID: "m" } });
  });

  it("throws OpenCodeHttpError with status on non-2xx", async () => {
    const { f } = mockFetch(() => new Response("nope", { status: 404 }));
    const c = createOpenCodeClient({ ...base, fetchImpl: f });
    await expect(c.getSession("x")).rejects.toBeInstanceOf(OpenCodeHttpError);
    await expect(c.getSession("x")).rejects.toMatchObject({ status: 404, path: "/session/x" });
  });

  it("permission reply body uses {reply, message?}", async () => {
    const { f, calls } = mockFetch(() => new Response(null, { status: 204 }));
    const c = createOpenCodeClient({ ...base, fetchImpl: f });
    await c.replyPermission("perm_1", "reject", "stop looping");
    expect(JSON.parse(calls[0].init.body)).toEqual({ reply: "reject", message: "stop looping" });
  });

  it("events() parses SSE frames, including frames split across chunks", async () => {
    const frames = [
      'data: {"type":"server.connected","properties":{}}\n\n',
      'data: {"type":"message.part.delta","properties":{"field":"text","delta":"O"}}\n\n',
      'data: {"type":"session.idle","properties":{"sessionID":"s"}}\n\n',
    ];
    const whole = frames.join("");
    const enc = new TextEncoder();
    const { f } = mockFetch(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(ctrl) {
              // split at awkward boundaries
              for (let i = 0; i < whole.length; i += 13) ctrl.enqueue(enc.encode(whole.slice(i, i + 13)));
              ctrl.close();
            },
          }),
          { status: 200 },
        ),
    );
    const c = createOpenCodeClient({ ...base, fetchImpl: f });
    const seen: string[] = [];
    for await (const ev of c.events()) seen.push(ev.type);
    expect(seen).toEqual(["server.connected", "message.part.delta", "session.idle"]);
  });
});
