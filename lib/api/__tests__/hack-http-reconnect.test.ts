/** @jest-environment node */
import { NextRequest } from "next/server";
const mockQuery = jest.fn(),
  mockMutation = jest.fn(),
  mockRead = jest.fn(),
  mockResume = jest.fn(),
  mockContext = jest.fn();
const mockStop = jest.fn(async () => {});
const mockSubscriber = jest.fn(async (_options: any) => ({ stop: mockStop }));
jest.mock("@/lib/api/chat-handler", () => ({
  getStreamContext: () => mockContext(),
}));
jest.mock("@/lib/auth/get-user-id", () => ({
  getUserIDAndPro: async () => ({ userId: "owner", subscription: "max" }),
}));
jest.mock("@/lib/auth/premium-access", () => ({
  assertHackWorkbenchAccess() {},
}));
jest.mock("@/lib/hack/http-execution", () => ({
  readHackHttpExecution: (...args: unknown[]) => mockRead(...args),
}));
jest.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = mockQuery;
    mutation = mockMutation;
  },
}));
jest.mock("@/convex/_generated/api", () => ({
  api: {
    chats: { getChatById: "chat" },
    chatStreams: { prepareForNewStream: "clear" },
    messages: { getLastAssistantMessage: "message" },
  },
}));
jest.mock("@/lib/utils/stream-cancellation", () => ({
  createCancellationSubscriber: (options: unknown) => mockSubscriber(options),
  createPreemptiveTimeout: () => ({
    clear() {},
    isPreemptive: () => false,
    getTriggerTime: () => null,
  }),
}));
import { GET } from "@/app/api/chat/[id]/stream/route";
const chat = {
  user_id: "owner",
  purpose: "security",
  active_stream_id: "exec-a",
  active_http_execution_id: "exec-a",
};
const request = () =>
  GET(new NextRequest("http://localhost/api/chat/chat/stream"), {
    params: Promise.resolve({ id: "chat" }),
  });
beforeEach(() => {
  jest.clearAllMocks();
  mockContext.mockReturnValue({ resumableStream: mockResume });
  mockQuery.mockImplementation(async (ref) =>
    ref === "chat" ? { ...chat } : null,
  );
  mockRead.mockResolvedValue({
    executionId: "exec-a",
    phase: "running",
    stopped: false,
  });
  mockResume.mockRejectedValue(new Error("ack timeout"));
});
it("does not erase an exact running identity on missing Redis acknowledgment", async () => {
  const response = await request();
  expect(response.status).toBe(503);
  expect(response.headers.get("x-rift-execution-id")).toBe("exec-a");
  expect(response.headers.get("x-rift-reconnect")).toBe("pending");
  expect(mockQuery.mock.calls.some(([ref]) => ref === "message")).toBe(false);
  expect(mockMutation).not.toHaveBeenCalled();
});
it("does not replay an older answer while the current producer has an empty attachment", async () => {
  mockQuery.mockImplementation(async (ref) =>
    ref === "chat"
      ? { ...chat }
      : {
          id: "old-answer",
          role: "assistant",
          parts: [{ type: "text", text: "Earlier result" }],
        },
  );
  mockResume.mockResolvedValue(
    new ReadableStream({
      start(out) {
        out.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        out.close();
      },
    }),
  );
  const response = await request();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("Earlier result");
  expect(mockMutation).not.toHaveBeenCalled();
});
it("preserves a whole response delivered in one chunk including its DONE terminator", async () => {
  const body =
    'data: {"type":"start"}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n';
  mockResume.mockResolvedValue(
    new ReadableStream({
      start(out) {
        out.enqueue(new TextEncoder().encode(body));
        out.close();
      },
    }),
  );
  const response = await request();
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(body);
  expect(mockMutation).not.toHaveBeenCalled();
});
it("does not reinterpret unavailable exact state as a legacy stream", async () => {
  mockRead.mockRejectedValue(new Error("offline"));
  expect((await request()).status).toBe(503);
  expect(mockResume).not.toHaveBeenCalled();
  expect(mockSubscriber).not.toHaveBeenCalled();
  expect(mockMutation).not.toHaveBeenCalled();
});
it("clears a confirmed terminal mapping only with the observed stream identity", async () => {
  mockRead.mockResolvedValue({
    executionId: "exec-a",
    phase: "terminal",
    stopped: false,
  });
  await request();
  expect(mockMutation).toHaveBeenCalledWith(
    "clear",
    expect.objectContaining({ chatId: "chat", expectedStreamId: "exec-a" }),
  );
});
it("reconnect subscribes to the exact execution and closes only its reader on EOF", async () => {
  mockResume.mockResolvedValue(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('data: {"type":"start"}\n\n'),
        );
        controller.close();
      },
    }),
  );
  const response = await request();
  await response.text();
  expect(response.headers.get("x-rift-execution-id")).toBe("exec-a");
  expect(mockSubscriber).toHaveBeenCalledWith(
    expect.objectContaining({
      execution: { userId: "owner", chatId: "chat", executionId: "exec-a" },
    }),
  );
  expect(mockStop).toHaveBeenCalledTimes(1);
  expect(mockMutation).not.toHaveBeenCalled();
});
it("owner validation happens before reading the private execution record", async () => {
  mockQuery.mockResolvedValue({ ...chat, user_id: "other" });
  expect((await request()).status).toBe(403);
  expect(mockRead).not.toHaveBeenCalled();
});

it("keeps an owned active execution recoverable when the stream context is unavailable", async () => {
  mockContext.mockReturnValue(null);
  const response = await request();
  expect(response.status).toBe(503);
  expect(response.headers.get("x-rift-execution-id")).toBe("exec-a");
  expect(response.headers.get("x-rift-reconnect")).toBe("pending");
  expect(mockMutation).not.toHaveBeenCalled();
});
it("authenticates unavailable-context reconnects before exposing an execution", async () => {
  mockContext.mockReturnValue(null);
  mockQuery.mockResolvedValue({ ...chat, user_id: "other" });
  const response = await request();
  expect(response.status).toBe(403);
  expect(response.headers.get("x-rift-execution-id")).toBeNull();
});
it("keeps a transient execution-store failure eligible for GET-only reconnect", async () => {
  mockRead.mockRejectedValue(new Error("offline"));
  const response = await request();
  expect(response.status).toBe(503);
  expect(response.headers.get("x-rift-reconnect")).toBe("pending");
  expect(response.headers.get("x-rift-execution-id")).toBe("exec-a");
  expect(mockResume).not.toHaveBeenCalled();
});

it("replays the saved completed answer even without a stream transport", async () => {
  mockContext.mockReturnValue(null);
  mockQuery.mockImplementation(async (ref) =>
    ref === "chat"
      ? { user_id: "owner", purpose: "security" }
      : {
          id: "finished-answer",
          role: "assistant",
          parts: [{ type: "text", text: "RIFT completed" }],
        },
  );
  const response = await request();
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(body).toContain("finished-answer");
  expect(body).toContain("RIFT completed");
  expect(mockResume).not.toHaveBeenCalled();
  expect(mockMutation).not.toHaveBeenCalled();
});
it("encodes a persisted fallback replay as valid response bytes", async () => {
  mockQuery.mockImplementation(async (ref) =>
    ref === "chat"
      ? { user_id: "owner", purpose: "security" }
      : {
          id: "saved",
          role: "assistant",
          parts: [{ type: "text", text: "Saved result" }],
        },
  );
  const response = await request();
  expect(await response.text()).toContain("Saved result");
});

it.each(["live", "saved", "empty"])(
  "returns explicit private unbuffered SSE headers for %s reconnect",
  async (mode) => {
    if (mode === "live") {
      mockResume.mockResolvedValue(
        new ReadableStream({
          start(out) {
            out.enqueue(
              new TextEncoder().encode(
                'data: {"type":"finish"}\n\ndata: [DONE]\n\n',
              ),
            );
            out.close();
          },
        }),
      );
    } else {
      mockContext.mockReturnValue(null);
      mockQuery.mockImplementation(async (ref) => {
        if (ref === "chat") return { user_id: "owner", purpose: "security" };
        return mode === "empty"
          ? null
          : {
              id: "saved",
              role: "assistant",
              parts: [{ type: "text", text: "Saved result" }],
            };
      });
    }
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(response.headers.get("x-rift-execution-id")).toBe(
      mode === "live" ? "exec-a" : null,
    );
    await response.text();
  },
);

it("does not turn a saved-answer read failure into a successful empty stream", async () => {
  mockContext.mockReturnValue(null);
  mockQuery.mockImplementation(async (ref) => {
    if (ref === "chat") return { user_id: "owner", purpose: "security" };
    throw new Error("Database temporarily unavailable");
  });
  const response = await request();
  expect(response.status).toBe(503);
  expect(response.headers.get("x-rift-reconnect")).toBe("replay-pending");
  expect(response.headers.get("x-rift-chat-id")).toBe("chat");
  expect(response.headers.get("x-rift-execution-id")).toBeNull();
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(await response.text()).not.toContain("[DONE]");
  expect(mockMutation).not.toHaveBeenCalled();
});
