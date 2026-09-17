/** @jest-environment node */
jest.mock("@/lib/console/workspace-recovery", () => ({
  recoverWorkspaceOutcome: jest.fn(),
}));
jest.mock("server-only", () => ({}));
jest.mock("@/lib/auth/api-key", () => ({ resolveApiKeyAuth: jest.fn() }));
jest.mock("@/lib/db/actions", () => ({ getChatById: jest.fn() }));
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: () => ({
    query: mockQuery,
    mutation: mockMutation,
    action: mockAction,
  }),
  getConvexServiceKey: () => "service-test",
}));
jest.mock("@/lib/api/chat-handler", () => ({
  createChatHandler: jest.fn(() => mockStart),
}));
jest.mock("@/app/api/hack-chat/route", () => ({ POST: jest.fn() }));
jest.mock("@/app/api/hack-long/route", () => ({ POST: jest.fn() }));
jest.mock("@/app/api/hack-long/resume/route", () => ({ GET: jest.fn() }));
jest.mock("@/app/api/hack-chat/cancel/route", () => ({ POST: jest.fn() }));
jest.mock("@/app/api/hack-long/cancel/route", () => ({ POST: jest.fn() }));
jest.mock("@/app/api/chat/[id]/stream/route", () => ({ GET: jest.fn() }));
jest.mock("@/lib/hack/durable-run", () => ({
  assertDurableHackEnabled: jest.fn(() => {
    throw new Error("disabled");
  }),
}));
jest.mock("@/lib/chat/agent-long-transport", () => ({
  buildSSEResponseFromRun: jest.fn(),
}));
const mockQuery = jest.fn();
const mockMutation = jest.fn();
const mockAction = jest.fn();
const mockStart = jest.fn();
import { NextRequest } from "next/server";
import { resolveApiKeyAuth } from "@/lib/auth/api-key";
import { getChatById } from "@/lib/db/actions";
import { createChatHandler } from "@/lib/api/chat-handler";
import { GET as resumeChat } from "@/app/api/chat/[id]/stream/route";
import { GET as resumeHack } from "@/app/api/hack-long/resume/route";
import { buildSSEResponseFromRun } from "@/lib/chat/agent-long-transport";
import { POST as stopHttp } from "@/app/api/hack-chat/cancel/route";
import { POST as startHack } from "@/app/api/hack-chat/route";
import { POST as startDurableHack } from "@/app/api/hack-long/route";
import { assertDurableHackEnabled } from "@/lib/hack/durable-run";
import { GET as capabilities } from "../capabilities/route";
import { POST as cancel } from "../cancel/route";
import { POST, GET } from "../stream/route";
import { GET as history } from "../history/route";
import { POST as decide } from "../approvals/route";
import { GET as artifact } from "../artifacts/route";
const chatId = "00000000-0000-4000-8000-000000000000";
const operationId = "00000000-0000-4000-8000-000000000001";
const input = {
  workspace: "studio",
  chatId,
  operationId,
  prompt: "Fixture image",
  permission: "auto",
  model: "image-gpt",
  settings: { quality: "high" },
};
const request = (value: unknown, path = "stream") =>
  new NextRequest(`http://localhost/api/console/workspaces/v1/${path}`, {
    method: "POST",
    headers: {
      authorization: "Bearer rift_live_test",
      "content-type": "application/json",
    },
    body: JSON.stringify(value),
  });
beforeEach(() => {
  jest.clearAllMocks();
  (resolveApiKeyAuth as jest.Mock).mockResolvedValue({
    userId: "owner",
    subscription: "ultra",
  });
  (getChatById as jest.Mock).mockResolvedValue({
    id: chatId,
    user_id: "owner",
    purpose: "image",
  });
  mockQuery.mockResolvedValue([]);
  mockAction.mockResolvedValue([]);
  mockMutation.mockResolvedValue({ admitted: true });
  mockStart.mockResolvedValue(
    new Response('data: {"type":"finish"}\n\n', {
      headers: { "content-type": "text/event-stream" },
    }),
  );
});
it("requires native authentication before any provider call", async () => {
  (resolveApiKeyAuth as jest.Mock).mockResolvedValue(null);
  expect((await POST(request(input))).status).toBe(401);
  expect(mockStart).not.toHaveBeenCalled();
  expect(mockMutation).not.toHaveBeenCalled();
});
it("enforces selected controls and maps Auto to actual full execution", async () => {
  const response = await POST(request(input));
  expect(response.status).toBe(200);
  await response.text();
  expect(createChatHandler).toHaveBeenCalledWith(
    expect.objectContaining({
      forcedPurpose: "image",
      studioSettings: { quality: "high" },
    }),
  );
  const passed = await mockStart.mock.calls[0][0].json();
  expect(passed.approvalMode).toBe("full");
  expect(passed.purpose).toBe("image");
  expect(passed.messages[0].id).toBe(operationId);
});
it("never resubmits a duplicated operation", async () => {
  mockMutation.mockResolvedValue({ admitted: false, status: "running" });
  expect((await POST(request(input))).status).toBe(409);
  expect(mockStart).not.toHaveBeenCalled();
});
it("rejects unknown controls before admission", async () => {
  expect(
    (await POST(request({ ...input, settings: { duration: 10 } }))).status,
  ).toBe(400);
  expect(mockMutation).not.toHaveBeenCalled();
  expect(mockStart).not.toHaveBeenCalled();
});
it("rejects another owner's history and approvals", async () => {
  (getChatById as jest.Mock).mockResolvedValue({
    user_id: "other",
    purpose: "image",
  });
  expect(
    (
      await history(
        new NextRequest(
          `http://localhost/history?workspace=studio&chatId=${chatId}`,
        ),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await decide(
        request(
          { workspace: "studio", chatId, id: "approval", approve: true },
          "approvals",
        ),
      )
    ).status,
  ).toBe(403);
  expect(mockQuery).not.toHaveBeenCalled();
  expect(mockMutation).not.toHaveBeenCalled();
});
it("rejects cross-surface continuation without a producer call", async () => {
  (getChatById as jest.Mock).mockResolvedValue({
    user_id: "owner",
    purpose: "security",
  });
  expect(
    (
      await GET(
        new NextRequest(
          `http://localhost/stream?workspace=studio&chatId=${chatId}`,
        ),
      )
    ).status,
  ).toBe(403);
  expect(mockStart).not.toHaveBeenCalled();
});
it("a missing owned artifact is not a usable URL", async () => {
  mockQuery.mockResolvedValue([null]);
  mockAction.mockResolvedValue([null]);
  expect(
    (
      await artifact(
        new NextRequest("http://localhost/artifacts?fileId=other-file"),
      )
    ).status,
  ).toBe(404);
});

it("finishes a durable operation when its reconnect stream completes", async () => {
  (getChatById as jest.Mock).mockResolvedValue({
    user_id: "owner",
    purpose: "security",
    active_trigger_run_id: "run_fixture",
  });
  mockQuery.mockResolvedValue([{ operationId, status: "uncertain" }]);
  (resumeHack as jest.Mock).mockResolvedValue(
    Response.json({ runId: "run_fixture", publicAccessToken: "fixture" }),
  );
  (buildSSEResponseFromRun as jest.Mock).mockResolvedValue(
    new Response('data: {"type":"finish"}\n\n'),
  );
  const response = await GET(
    new NextRequest(`http://localhost/stream?workspace=hack&chatId=${chatId}`),
  );
  await response.text();
  expect(response.headers.get("x-rift-operation-id")).toBe(operationId);
  expect(response.headers.get("x-rift-transport")).toBe("durable");
  expect(mockMutation).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ chatId, operationId, status: "completed" }),
  );
});

it("does not mark a stream with an error followed by finish as completed", async () => {
  mockStart.mockResolvedValue(
    new Response(
      'data: {"type":"error","errorText":"Failed"}\n\ndata: {"type":"finish"}\n\n',
    ),
  );
  await (await POST(request(input))).text();
  expect(mockMutation).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ operationId, status: "failed" }),
  );
});

it.each([true, false])(
  "records confirmed cancellation separately from a pending request (%s)",
  async (canceled) => {
    (getChatById as jest.Mock).mockResolvedValue({
      user_id: "owner",
      purpose: "security",
    });
    (stopHttp as jest.Mock).mockResolvedValue(
      Response.json({ canceled }, { status: canceled ? 200 : 202 }),
    );
    const response = await cancel(
      request({ workspace: "hack", chatId, operationId }, "cancel"),
    );
    expect(await response.json()).toEqual({ canceled });
    expect(mockMutation).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        operationId,
        status: canceled ? "failed" : "cancel_requested",
      }),
    );
  },
);

const localRunner = {
  connectionId: "local-fixture",
  name: "Fixture runner",
  lastSeen: Date.now(),
  isDesktop: false,
  capabilities: { commands: true, pty: true },
};
it("advertises only fresh owned command runners for Hack", async () => {
  mockQuery.mockResolvedValue([
    localRunner,
    { ...localRunner, connectionId: "desktop", isDesktop: true },
    { ...localRunner, connectionId: "stale", lastSeen: 0 },
    {
      ...localRunner,
      connectionId: "no-command",
      capabilities: { commands: false, pty: false },
    },
  ]);
  const response = await capabilities(
    new NextRequest("http://localhost/capabilities"),
  );
  const value = await response.json();
  expect(value.hack.targets).toEqual([
    { value: "e2b", label: "Cloud" },
    { value: "local-fixture", label: "Fixture runner" },
  ]);
  expect(value.studio.targets).toEqual([{ value: "e2b", label: "Cloud" }]);
  expect(mockQuery).toHaveBeenCalledWith(expect.anything(), {
    serviceKey: "service-test",
    userId: "owner",
  });
});
it("uses authenticated HTTP Hack for an owned local runner when durable Cloud is enabled", async () => {
  (assertDurableHackEnabled as jest.Mock).mockImplementation(() => {});
  mockQuery.mockResolvedValueOnce([localRunner]);
  (startHack as jest.Mock).mockResolvedValue(
    new Response('data: {"type":"finish"}\n\n'),
  );
  const response = await POST(
    request({
      ...input,
      workspace: "hack",
      model: "build-grok",
      settings: undefined,
      sandboxPreference: localRunner.connectionId,
    }),
  );
  expect(response.status).toBe(200);
  await response.text();
  expect(startDurableHack).not.toHaveBeenCalled();
  expect(
    (await (startHack as jest.Mock).mock.calls[0][0].json()).sandboxPreference,
  ).toBe(localRunner.connectionId);
});
it("rejects an unavailable local runner before admission or producer calls", async () => {
  const response = await POST(
    request({
      ...input,
      workspace: "hack",
      model: "build-grok",
      settings: undefined,
      sandboxPreference: "other-owner-runner",
    }),
  );
  expect(response.status).toBe(400);
  expect(mockMutation).not.toHaveBeenCalled();
  expect(startHack).not.toHaveBeenCalled();
  expect(startDurableHack).not.toHaveBeenCalled();
});

it("captures Studio producer completion independently from its subscriber", async () => {
  await POST(request(input));
  const options = (createChatHandler as jest.Mock).mock.calls[0][0];
  expect(options.onProducerFinished).toEqual(expect.any(Function));
  await options.onProducerFinished("completed");
  expect(mockMutation).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ chatId, operationId, status: "completed" }),
  );
});

it("Studio reconnect cannot finalize before the producer saves and settles", async () => {
  mockQuery.mockResolvedValue([{ operationId, status: "running" }]);
  (resumeChat as jest.Mock).mockResolvedValue(
    new Response('data: {"type":"finish"}\n\n'),
  );
  const response = await GET(
    new NextRequest(
      `http://localhost/stream?workspace=studio&chatId=${chatId}`,
    ),
  );
  await response.text();
  expect(response.headers.get("x-rift-operation-id")).toBe(operationId);
  expect(mockMutation).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ status: "completed" }),
  );
});
