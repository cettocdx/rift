/** @jest-environment node */
import { NextRequest } from "next/server";
import { POST } from "../route";
import { getUserID } from "@/lib/auth/get-user-id";
import { tasks } from "@trigger.dev/sdk";
import { api } from "@/convex/_generated/api";
import { ChatSDKError } from "@/lib/errors";
const mockMutation = jest.fn();
jest.mock("@/lib/auth/get-user-id", () => ({ getUserID: jest.fn() }));
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: () => ({ mutation: mockMutation }),
}));
jest.mock("@trigger.dev/sdk", () => ({ tasks: { trigger: jest.fn() } }));
const originalKey = process.env.CONVEX_SERVICE_ROLE_KEY;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.CONVEX_SERVICE_ROLE_KEY = "service-test";
  (getUserID as jest.Mock).mockResolvedValue("u1");
  (tasks.trigger as jest.Mock).mockResolvedValue({ id: "worker-1" });
  mockMutation.mockResolvedValue({ success: true });
  mockMutation.mockResolvedValueOnce({
    state: "queued",
    executionKey: "manual:task:1:request",
    dispatchAttempt: 1,
    shouldDispatch: true,
    chatId: "bot-chat",
  });
});
afterAll(() => {
  if (originalKey === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
  else process.env.CONVEX_SERVICE_ROLE_KEY = originalKey;
});
function request(
  body: unknown = { taskId: "task-1", requestId: "manual-request-123" },
  headers: Record<string, string> = {},
) {
  return new NextRequest("http://localhost:3020/api/tasks/run", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3020",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("authenticated Run now dispatches the existing durable worker and ignores claimed user ids", async () => {
  const response = await POST(
    request({
      taskId: "task-1",
      requestId: "manual-request-123",
      userId: "victim",
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    ok: true,
    state: "queued",
    chatId: "bot-chat",
  });
  expect(mockMutation).toHaveBeenNthCalledWith(
    1,
    api.tasks.requestManualRunForBackend,
    expect.objectContaining({ userId: "u1", taskId: "task-1" }),
  );
  expect(tasks.trigger).toHaveBeenCalledWith(
    "scheduled-task-worker",
    expect.objectContaining({ executionKey: "manual:task:1:request" }),
    expect.objectContaining({
      idempotencyKey: "scheduled-worker:manual:task:1:request:1",
    }),
  );
  expect(mockMutation).toHaveBeenLastCalledWith(
    api.tasks.markRunDispatchedForBackend,
    expect.objectContaining({ workerRunId: "worker-1" }),
  );
});

test("an already pending occurrence does not dispatch another worker", async () => {
  mockMutation.mockReset();
  mockMutation.mockResolvedValue({
    state: "running",
    executionKey: "existing",
    dispatchAttempt: 1,
    shouldDispatch: false,
    chatId: "bot-chat",
  });
  expect(await (await POST(request())).json()).toEqual({
    ok: true,
    state: "running",
    chatId: "bot-chat",
  });
  expect(tasks.trigger).not.toHaveBeenCalled();
});

test("dispatch failure leaves the saved occurrence queued for automatic recovery", async () => {
  (tasks.trigger as jest.Mock).mockRejectedValue(
    new Error("transport disconnected"),
  );
  expect(await (await POST(request())).json()).toEqual({
    ok: true,
    state: "queued",
    chatId: "bot-chat",
    dispatchPending: true,
  });
  expect(mockMutation).toHaveBeenLastCalledWith(
    api.tasks.releaseRunDispatchForBackend,
    expect.objectContaining({ executionKey: "manual:task:1:request" }),
  );
});

test("rejects cross-origin and unauthenticated callers before any writes", async () => {
  expect(
    (await POST(request(undefined, { origin: "https://other.example" })))
      .status,
  ).toBe(403);
  expect(mockMutation).not.toHaveBeenCalled();
  (getUserID as jest.Mock).mockRejectedValue(
    new ChatSDKError("unauthorized:auth"),
  );
  expect((await POST(request())).status).toBe(401);
  expect(mockMutation).not.toHaveBeenCalled();
});

test("rejects malformed request ids and oversized bodies", async () => {
  expect(
    (await POST(request({ taskId: "task-1", requestId: "bad" }))).status,
  ).toBe(400);
  expect(
    (
      await POST(
        request({
          taskId: "task-1",
          requestId: "manual-request-123",
          padding: "x".repeat(3000),
        }),
      )
    ).status,
  ).toBe(413);
  expect(mockMutation).not.toHaveBeenCalled();
});
