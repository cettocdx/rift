/** @jest-environment node */
import { NextRequest } from "next/server";
import { POST, GET } from "../route";
import { POST as build } from "@/app/api/agent-long/route";
import { POST as directHack } from "@/app/api/hack-chat/route";
import { POST as hack } from "@/app/api/hack-long/route";
import { POST as studio } from "@/app/api/chat/route";
import { GET as resumeStudio } from "@/app/api/chat/[id]/stream/route";
jest.mock("@/app/api/agent-long/route", () => ({ POST: jest.fn() }));
jest.mock("@/app/api/agent-long/resume/route", () => ({ GET: jest.fn() }));
jest.mock("@/app/api/hack-chat/route", () => ({ POST: jest.fn() }));
jest.mock("@/app/api/hack-long/route", () => ({ POST: jest.fn() }));
jest.mock("@/app/api/hack-long/resume/route", () => ({ GET: jest.fn() }));
jest.mock("@/app/api/chat/route", () => ({ POST: jest.fn() }));
jest.mock("@/app/api/chat/[id]/stream/route", () => ({ GET: jest.fn() }));
jest.mock("@/lib/chat/agent-long-transport", () => ({
  buildSSEResponseFromRun: jest.fn(),
}));
const oldHack = process.env.RIFT_DURABLE_HACK_ENABLED;
const oldAdmission = process.env.RIFT_DURABLE_DISPATCH_ADMISSION;
beforeEach(() => {
  jest.resetAllMocks();
  process.env.RIFT_DURABLE_HACK_ENABLED = "true";
  process.env.RIFT_DURABLE_DISPATCH_ADMISSION = "true";
});
afterAll(() => {
  if (oldHack === undefined) delete process.env.RIFT_DURABLE_HACK_ENABLED;
  else process.env.RIFT_DURABLE_HACK_ENABLED = oldHack;
  if (oldAdmission === undefined)
    delete process.env.RIFT_DURABLE_DISPATCH_ADMISSION;
  else process.env.RIFT_DURABLE_DISPATCH_ADMISSION = oldAdmission;
});
it.each([
  ["app", build],
  ["security", hack],
  ["image", studio],
] as const)(
  "preserves the original %s handler's authorization rejection",
  async (purpose, handler) => {
    const rejection = new Response("Denied", { status: 403 });
    jest.mocked(handler).mockResolvedValue(rejection);
    const request = new NextRequest(
      "https://riftsys.app/api/mobile/stream?purpose=" + purpose,
      { method: "POST" },
    );
    expect(await POST(request)).toBe(rejection);
    expect(handler).toHaveBeenCalledWith(request);
    expect(
      [build, hack, studio].filter((fn) => jest.mocked(fn).mock.calls.length),
    ).toHaveLength(1);
  },
);
it("uses the existing Studio replay handler without dispatching a new generation", async () => {
  jest
    .mocked(resumeStudio)
    .mockResolvedValue(new Response(null, { status: 204 }));
  const response = await GET(
    new NextRequest(
      "https://riftsys.app/api/mobile/stream?purpose=image&chatId=chat",
    ),
  );
  expect(response.status).toBe(204);
  expect(await jest.mocked(resumeStudio).mock.calls[0][1].params).toEqual({
    id: "chat",
  });
  expect(studio).not.toHaveBeenCalled();
});

it.each(["RIFT_DURABLE_HACK_ENABLED", "RIFT_DURABLE_DISPATCH_ADMISSION"])(
  "uses the web Hack handler when %s is disabled",
  async (flag) => {
    delete process.env[flag];
    const response = new Response("data: [DONE]\n\n");
    jest.mocked(directHack).mockResolvedValue(response);
    expect(
      await POST(
        new NextRequest(
          "https://riftsys.app/api/mobile/stream?purpose=security",
          { method: "POST" },
        ),
      ),
    ).toBe(response);
    expect(hack).not.toHaveBeenCalled();
  },
);
it("does not retry a rejected durable dispatch as a second direct task", async () => {
  jest.mocked(hack).mockResolvedValue(new Response("Denied", { status: 400 }));
  expect(
    (
      await POST(
        new NextRequest(
          "https://riftsys.app/api/mobile/stream?purpose=security",
          { method: "POST" },
        ),
      )
    ).status,
  ).toBe(400);
  expect(directHack).not.toHaveBeenCalled();
});
it("replays direct Hack without dispatching another assessment", async () => {
  delete process.env.RIFT_DURABLE_HACK_ENABLED;
  jest
    .mocked(resumeStudio)
    .mockResolvedValue(new Response(null, { status: 204 }));
  expect(
    (
      await GET(
        new NextRequest(
          "https://riftsys.app/api/mobile/stream?purpose=security&chatId=chat",
        ),
      )
    ).status,
  ).toBe(204);
  expect(await jest.mocked(resumeStudio).mock.calls[0][1].params).toEqual({
    id: "chat",
  });
  expect(directHack).not.toHaveBeenCalled();
  expect(hack).not.toHaveBeenCalled();
});

// Native URLSession has an idle timeout even when the tool is awaiting consent.
it("keeps an idle Studio approval stream alive without starting another task", async () => {
  jest.useFakeTimers();
  const source = new ReadableStream<Uint8Array>();
  jest.mocked(studio).mockResolvedValue(
    new Response(source, {
      headers: { "Content-Type": "text/event-stream" },
    }),
  );
  const response = await POST(
    new NextRequest("https://riftsys.app/api/mobile/stream?purpose=image", {
      method: "POST",
    }),
  );
  const reader = response.body!.getReader();
  try {
    const pending = reader.read();
    await jest.advanceTimersByTimeAsync(25_000);
    expect(new TextDecoder().decode((await pending).value)).toBe(
      ": keep-alive\n\n",
    );
    expect(studio).toHaveBeenCalledTimes(1);
  } finally {
    await reader.cancel();
    jest.useRealTimers();
  }
});
it("never inserts a heartbeat inside a fragmented SSE event", async () => {
  jest.useFakeTimers();
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const source = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  jest.mocked(resumeStudio).mockResolvedValue(
    new Response(source, {
      headers: { "Content-Type": "text/event-stream" },
    }),
  );
  const response = await GET(
    new NextRequest(
      "https://riftsys.app/api/mobile/stream?purpose=image&chatId=saved",
    ),
  );
  const reader = response.body!.getReader();
  try {
    controller.enqueue(encoder.encode('data: {"type":"text-'));
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      'data: {"type":"text-',
    );
    const idle = reader.read();
    await jest.advanceTimersByTimeAsync(25_000);
    expect((await idle).value?.length).toBe(0);
    controller.enqueue(encoder.encode('delta"}\n\n'));
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      'delta"}\n\n',
    );
    const pulse = reader.read();
    await jest.advanceTimersByTimeAsync(25_000);
    expect(new TextDecoder().decode((await pulse).value)).toBe(
      ": keep-alive\n\n",
    );
    controller.close();
    expect((await reader.read()).done).toBe(true);
    expect(studio).not.toHaveBeenCalled();
  } finally {
    await reader.cancel();
    jest.useRealTimers();
  }
});
