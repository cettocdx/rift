/** @jest-environment node */
import { NextRequest } from "next/server";
import { getFunctionName } from "convex/server";
import { dispatchFixture } from "@/test-support/agent-dispatch-fixture";
const mockAuth = jest.fn(),
  mockMutation = jest.fn(),
  mockQuery = jest.fn();
jest.mock("@/convex/_generated/server", () => ({
  mutation: (c: unknown) => c,
  query: (c: unknown) => c,
}));
jest.mock("@/convex/_generated/api", () => ({
  internal: { redisPubsub: { publishCancellation: "publish" } },
}));
jest.mock("@/lib/auth/get-user-id", () => ({
  getUserIDAndPro: (...args: unknown[]) => mockAuth(...args),
}));
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: () => ({ query: mockQuery, mutation: mockMutation }),
  getConvexServiceKey: () => "http-test-key",
}));
import { POST } from "../cancel/route";
import {
  admitHackHttpExecution,
  markHackHttpExecutionRunning,
  readHackHttpExecution,
  finishHackHttpExecution,
} from "@/lib/hack/http-execution";
const binding = { userId: "owner", chatId: "chat", executionId: "execution-a" };
const req = (body: unknown = { chatId: "chat", executionId: "execution-a" }) =>
  new NextRequest("http://localhost/api/hack-chat/cancel", {
    method: "POST",
    body: JSON.stringify(body),
  });
const savedKey = process.env.CONVEX_SERVICE_ROLE_KEY;
let fixture: ReturnType<typeof dispatchFixture>;
let scheduled: jest.Mock;
beforeEach(async () => {
  jest.clearAllMocks();
  mockMutation.mockReset();
  mockQuery.mockReset();
  process.env.CONVEX_SERVICE_ROLE_KEY = "http-test-key";
  fixture = dispatchFixture();
  scheduled = jest.fn();
  const api: any = await import("@/convex/hackHttpExecutions");
  const call = (ref: any, args: any) => {
    const [mod, method] = getFunctionName(ref).split(":");
    if (mod !== "hackHttpExecutions") throw new Error("Unexpected backend API");
    return api[method].handler(
      { ...fixture.ctx, scheduler: { runAfter: scheduled } },
      args,
    );
  };
  mockMutation.mockImplementation(call);
  mockQuery.mockImplementation(call);
  mockAuth.mockResolvedValue({ userId: "owner", subscription: "free" });
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
  else process.env.CONVEX_SERVICE_ROLE_KEY = savedKey;
});
it("recovers a lost terminal acknowledgment response without repeating the task", async () => {
  await admitHackHttpExecution(binding);
  await markHackHttpExecutionRunning(binding);
  const persist = mockMutation.getMockImplementation()!;
  mockMutation.mockImplementationOnce(async (ref, args) => {
    await persist(ref, args);
    throw new TypeError("fetch failed");
  });
  mockMutation.mockClear();
  await expect(finishHackHttpExecution(binding)).resolves.toBe(true);
  expect(mockMutation).toHaveBeenCalledTimes(1);
  expect(getFunctionName(mockMutation.mock.calls[0][0])).toBe(
    "hackHttpExecutions:finish",
  );
  expect(fixture.tables.hack_http_executions[0].phase).toBe("terminal");
});

it("retries only the exact terminal acknowledgment after a transient pre-write failure", async () => {
  await admitHackHttpExecution(binding);
  await markHackHttpExecutionRunning(binding);
  mockMutation.mockClear();
  mockMutation.mockRejectedValueOnce(new TypeError("fetch failed"));
  await expect(finishHackHttpExecution(binding)).resolves.toBe(true);
  expect(mockMutation).toHaveBeenCalledTimes(2);
  for (const [ref, args] of mockMutation.mock.calls) {
    expect(getFunctionName(ref)).toBe("hackHttpExecutions:finish");
    expect(args).toEqual({ ...binding, serviceKey: "http-test-key" });
  }
});

it("a lost response from the old generation never clears a newly running generation", async () => {
  await admitHackHttpExecution(binding);
  await markHackHttpExecutionRunning(binding);
  const persist = mockMutation.getMockImplementation()!;
  const next = { ...binding, executionId: "execution-b" };
  mockMutation.mockImplementationOnce(async (ref, args) => {
    await persist(ref, args);
    await admitHackHttpExecution(next);
    await markHackHttpExecutionRunning(next);
    throw new TypeError("fetch failed");
  });
  await expect(finishHackHttpExecution(binding)).resolves.toBe(true);
  expect(await readHackHttpExecution(next)).toMatchObject({ phase: "running" });
  expect(fixture.tables.chats[0].active_http_execution_id).toBe(
    next.executionId,
  );
});

it("an unavailable confirmation read still permits an idempotent acknowledgment retry", async () => {
  await admitHackHttpExecution(binding);
  await markHackHttpExecutionRunning(binding);
  mockMutation.mockClear();
  mockMutation.mockRejectedValueOnce(new TypeError("fetch failed"));
  mockQuery.mockRejectedValueOnce(new TypeError("fetch failed"));
  await expect(finishHackHttpExecution(binding)).resolves.toBe(true);
  expect(mockMutation).toHaveBeenCalledTimes(2);
});

it("does not accept a different generation's terminal observation", async () => {
  await admitHackHttpExecution(binding);
  mockMutation.mockClear();
  mockMutation
    .mockRejectedValueOnce(new TypeError("fetch failed"))
    .mockRejectedValueOnce(new TypeError("fetch failed"))
    .mockRejectedValueOnce(new TypeError("fetch failed"));
  mockQuery.mockResolvedValue({ executionId: "other", phase: "terminal" });
  await expect(finishHackHttpExecution(binding)).rejects.toThrow(
    "fetch failed",
  );
  expect(mockMutation).toHaveBeenCalledTimes(3);
  expect(fixture.tables.hack_http_executions[0].phase).toBe("admitted");
});

it("leaves acknowledgment unconfirmed after bounded network failures", async () => {
  await admitHackHttpExecution(binding);
  await markHackHttpExecutionRunning(binding);
  mockMutation.mockClear();
  mockMutation
    .mockRejectedValueOnce(new TypeError("fetch failed"))
    .mockRejectedValueOnce(new TypeError("fetch failed"))
    .mockRejectedValueOnce(new TypeError("fetch failed"));
  await expect(finishHackHttpExecution(binding)).rejects.toThrow(
    "fetch failed",
  );
  expect(mockMutation).toHaveBeenCalledTimes(3);
  expect(fixture.tables.hack_http_executions[0].phase).toBe("running");
});

it("does not retry rejected authority or turn a false acknowledgment into success", async () => {
  mockMutation.mockRejectedValueOnce(
    new Error("Unauthorized: Invalid service key"),
  );
  await expect(finishHackHttpExecution(binding)).rejects.toThrow(
    "Unauthorized",
  );
  expect(mockMutation).toHaveBeenCalledTimes(1);
  expect(mockQuery).not.toHaveBeenCalled();
  mockMutation.mockResolvedValueOnce(false);
  await expect(finishHackHttpExecution(binding)).resolves.toBe(false);
});
it("persists a pre-admission Stop without a chat and rejects the resumed caller through the actual helper", async () => {
  fixture.tables.chats.length = 0;
  fixture.tables.agent_run_claims.length = 0;
  const response = await POST(req());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    executionId: "execution-a",
    canceled: true,
  });
  expect(await admitHackHttpExecution(binding)).toMatchObject({
    admitted: false,
    reason: "stopped",
  });
  expect(fixture.tables.hack_http_execution_heads).toHaveLength(0);
});
it("returns pending until the admitted producer acknowledges cleanup, including repeated/lost Stop responses", async () => {
  expect(await admitHackHttpExecution(binding)).toMatchObject({
    admitted: true,
  });
  expect(await markHackHttpExecutionRunning(binding)).toBe(true);
  for (let i = 0; i < 2; i++) {
    const response = await POST(req());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      executionId: "execution-a",
      canceled: false,
    });
  }
  expect(await readHackHttpExecution(binding)).toMatchObject({
    stopped: true,
    discard: false,
    phase: "running",
  });
  expect(await finishHackHttpExecution(binding)).toBe(true);
  for (let i = 0; i < 2; i++) {
    const response = await POST(req());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      executionId: "execution-a",
      canceled: true,
    });
  }
  expect(fixture.tables.hack_http_executions).toHaveLength(1);
});
it("preserves only this execution's discard intent for the producer", async () => {
  await admitHackHttpExecution(binding);
  expect(
    (
      await POST(
        req({ chatId: "chat", executionId: "execution-a", discard: true }),
      )
    ).status,
  ).toBe(202);
  await POST(req());
  expect(await readHackHttpExecution(binding)).toMatchObject({
    discard: true,
    stopped: true,
  });
  expect(scheduled).toHaveBeenLastCalledWith(0, "publish", {
    chatId: "chat",
    executionId: "execution-a",
    skipSave: true,
  });
});
it("rejects foreign ownership before publishing or creating a marker", async () => {
  fixture.tables.chats[0].user_id = "other";
  expect(
    (
      await POST(
        req({ chatId: "chat", executionId: "execution-a", userId: "other" }),
      )
    ).status,
  ).toBe(403);
  expect(fixture.tables.hack_http_executions).toHaveLength(0);
  expect(scheduled).not.toHaveBeenCalled();
});
it("does not parse an unauthenticated body", async () => {
  const { ChatSDKError } = await import("@/lib/errors");
  mockAuth.mockRejectedValueOnce(new ChatSDKError("unauthorized:auth"));
  const request = req();
  const reader = jest.spyOn(request.body!, "getReader");
  expect((await POST(request)).status).toBe(401);
  expect(reader).not.toHaveBeenCalled();
  expect(mockMutation).not.toHaveBeenCalled();
});
it("cannot confirm cancellation when the required durable write is unavailable", async () => {
  mockMutation.mockRejectedValueOnce(new Error("database unavailable"));
  const response = await POST(req());
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ canceled: false });
  expect(scheduled).not.toHaveBeenCalled();
});
it.each([
  {},
  { chatId: "chat" },
  { chatId: "chat", executionId: "" },
  { chatId: "chat", executionId: "a\r\nb" },
  { chatId: "chat", executionId: "x".repeat(201) },
  { chatId: "chat", executionId: "exec", discard: "false" },
])("requires valid bounded identity/intent (%j)", async (body) => {
  expect((await POST(req(body))).status).toBe(400);
  expect(mockMutation).not.toHaveBeenCalled();
});
it("bounds the cancellation body before database allocation", async () => {
  expect(
    (
      await POST(
        req({ chatId: "chat", executionId: "exec", padding: "x".repeat(5000) }),
      )
    ).status,
  ).toBe(413);
  expect(mockMutation).not.toHaveBeenCalled();
});
