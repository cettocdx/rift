/** @jest-environment node */
import { NextRequest } from "next/server";
import { getFunctionName } from "convex/server";
import { dispatchFixture } from "@/test-support/agent-dispatch-fixture";
const mockAuth = jest.fn(),
  mockMutation = jest.fn(),
  mockQuery = jest.fn(),
  mockRetrieve = jest.fn(),
  mockCancel = jest.fn();
jest.mock("@/convex/_generated/server", () => ({
  mutation: (c: unknown) => c,
  query: (c: unknown) => c,
}));
jest.mock("@/lib/auth/get-user-id", () => ({
  getUserIDAndPro: (...args: unknown[]) => mockAuth(...args),
}));
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: () => ({ query: mockQuery, mutation: mockMutation }),
  getConvexServiceKey: () => "isolated-test-key",
}));
jest.mock("@trigger.dev/sdk", () => ({
  runs: { retrieve: (...args: unknown[]) => mockRetrieve(...args) },
}));
jest.mock("@/lib/api/agent-long-runs", () => ({
  TERMINAL_RUN_STATUSES: new Set([
    "COMPLETED",
    "CANCELED",
    "FAILED",
    "CRASHED",
    "SYSTEM_FAILURE",
    "EXPIRED",
    "TIMED_OUT",
  ]),
  ACTIVE_RUN_STATUSES: ["QUEUED", "EXECUTING"],
  cancelClaimedRunAndConfirm: (...args: unknown[]) => mockCancel(...args),
}));
const owner = {
  serviceKey: "isolated-test-key",
  userId: "owner",
  chatId: "chat",
  dispatchId: "dispatch",
};
const token = { ...owner, attemptId: "attempt" };
const election = {
  ...token,
  nextClaimId: "next",
  requestMessageId: "dispatch",
  payloadHash: "a".repeat(64),
  fingerprintVersion: 1,
  replaceActiveRun: true,
};
const req = (body: unknown = { chatId: "chat", dispatchId: "dispatch" }) =>
  new NextRequest("http://localhost/api/hack-long/cancel", {
    method: "POST",
    body: JSON.stringify(body),
  });
const originalKey = process.env.CONVEX_SERVICE_ROLE_KEY;
let fixture: ReturnType<typeof dispatchFixture>;
let admission: any, receipts: any, stops: any;
beforeEach(async () => {
  jest.clearAllMocks();
  process.env.CONVEX_SERVICE_ROLE_KEY = owner.serviceKey;
  process.env.RIFT_DURABLE_DISPATCH_ADMISSION = "true";
  fixture = dispatchFixture();
  admission = await import("@/convex/agentDispatchAdmission");
  receipts = await import("@/convex/agentDispatchRequests");
  stops = await import("@/convex/agentDispatchStops");
  const modules: Record<string, any> = {
    agentDispatchAdmission: admission,
    agentDispatchRequests: receipts,
    agentDispatchStops: stops,
  };
  const call = (ref: any, args: any) => {
    const [mod, method] = getFunctionName(ref).split(":");
    return modules[mod][method].handler(fixture.ctx, args);
  };
  mockMutation.mockImplementation(call);
  mockQuery.mockImplementation(call);
  mockAuth.mockResolvedValue({ userId: "owner", subscription: "free" });
  mockRetrieve.mockResolvedValue({
    id: "run",
    status: "EXECUTING",
    taskIdentifier: "hack-long",
    payload: {
      userId: "owner",
      chatId: "chat",
      dispatchId: "dispatch",
      startClaimId: "next",
    },
  });
  mockCancel.mockImplementation(async () => {
    mockRetrieve.mockResolvedValue({ status: "CANCELED" });
  });
});
afterEach(() => {
  if (originalKey === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
  else process.env.CONVEX_SERVICE_ROLE_KEY = originalKey;
  delete process.env.RIFT_DURABLE_DISPATCH_ADMISSION;
});
async function accepted(requiresCleanup = false) {
  await admission.elect.handler(fixture.ctx, { ...election, requiresCleanup });
  await admission.attachClaim.handler(fixture.ctx, token);
  await admission.markDispatching.handler(fixture.ctx, token);
  await receipts.recordAccepted.handler(fixture.ctx, {
    ...owner,
    claimId: "next",
    runId: "run",
  });
  if (requiresCleanup) {
    const entry = {
      ...owner,
      claimId: "next",
      runId: "run",
      workerEntryId: "entry",
      payloadHash: election.payloadHash,
    };
    await receipts.enterWorker.handler(fixture.ctx, entry);
    await receipts.markWorkerEffectsStarted.handler(fixture.ctx, entry);
  }
}
async function post(body?: unknown) {
  return (await import("../cancel/route")).POST(req(body));
}
it("authenticates before body parsing, rejects foreign chats, and never trusts client owner", async () => {
  fixture.tables.chats[0].user_id = "foreign";
  const response = await post({
    chatId: "chat",
    dispatchId: "dispatch",
    userId: "foreign",
  });
  expect(response.status).toBe(403);
  expect(fixture.tables.agent_dispatch_stops).toHaveLength(0);
  expect(mockCancel).not.toHaveBeenCalled();
});
it("fences an absent chat before admission and confirms lost-response retries without current Max or rollout", async () => {
  delete process.env.RIFT_DURABLE_DISPATCH_ADMISSION;
  fixture.tables.chats.length = 0;
  fixture.tables.agent_run_claims.length = 0;
  for (let i = 0; i < 2; i++) {
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      dispatchId: "dispatch",
      canceled: true,
    });
  }
  expect(fixture.tables.agent_dispatch_stops).toHaveLength(1);
  expect(mockRetrieve).not.toHaveBeenCalled();
  expect(mockCancel).not.toHaveBeenCalled();
});
it("never confirms unknown Trigger acceptance after dispatch permission escaped", async () => {
  await admission.elect.handler(fixture.ctx, election);
  await admission.attachClaim.handler(fixture.ctx, token);
  await admission.markDispatching.handler(fixture.ctx, token);
  const response = await post();
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({
    canceled: false,
    dispatchId: "dispatch",
  });
  expect(mockRetrieve).not.toHaveBeenCalled();
  expect(mockCancel).not.toHaveBeenCalled();
  await receipts.recordAccepted.handler(fixture.ctx, {
    ...owner,
    claimId: "next",
    runId: "run",
  });
  const retry = await post();
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual({
    canceled: true,
    dispatchId: "dispatch",
  });
  expect(mockCancel).toHaveBeenCalledWith("run");
});
it("does not equate cancellation HTTP acceptance with a terminal producer", async () => {
  await accepted();
  mockCancel.mockResolvedValue(undefined);
  const response = await post();
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({ canceled: false });
  expect(fixture.tables.agent_dispatch_requests[0].state).toBe("accepted");
});
it("keeps forced Trigger cancellation pending until the worker's exact cleanup receipt, including lost acknowledgment", async () => {
  await accepted(true);
  const first = await post();
  expect(first.status).toBe(202);
  expect(await first.json()).toMatchObject({ canceled: false });
  expect(fixture.tables.agent_dispatch_requests[0]).toMatchObject({
    state: "terminal",
    cleanup_pending: true,
  });
  const { recordHackRunCleanup } = await import("@/lib/hack/durable-cleanup");
  const binding = {
    ...owner,
    claimId: "next",
    runId: "run",
    workerEntryId: "entry",
  };
  const invoke = mockMutation.getMockImplementation()!;
  mockMutation.mockImplementationOnce(async (ref, args) => {
    await invoke(ref, args);
    throw new Error("cleanup acknowledgment response lost after commit");
  });
  await expect(recordHackRunCleanup(binding)).rejects.toThrow("response lost");
  const timestamp =
    fixture.tables.agent_dispatch_requests[0].cleanup_confirmed_at;
  expect(await recordHackRunCleanup(binding)).toBe(true);
  expect(fixture.tables.agent_dispatch_requests[0].cleanup_confirmed_at).toBe(
    timestamp,
  );
  const second = await post();
  expect(second.status).toBe(200);
  expect(await second.json()).toEqual({
    canceled: true,
    dispatchId: "dispatch",
  });
  expect(mockCancel).toHaveBeenCalledTimes(1);
});
it("keeps cleanup pending when its required durable write fails before commit", async () => {
  await accepted(true);
  await post();
  const { recordHackRunCleanup } = await import("@/lib/hack/durable-cleanup");
  mockMutation.mockRejectedValueOnce(new Error("cleanup database outage"));
  await expect(
    recordHackRunCleanup({ ...owner, claimId: "next", runId: "run" }),
  ).rejects.toThrow("database outage");
  expect(await stops.getForBackend.handler(fixture.ctx, owner)).toMatchObject({
    canceled: false,
  });
  expect(fixture.tables.agent_dispatch_requests[0].cleanup_pending).toBe(true);
});
it.each(["task", "owner", "dispatch", "claim"])(
  "never cancels mismatched remote %s binding",
  async (mismatch) => {
    await accepted();
    const run = await mockRetrieve();
    if (mismatch === "task") run.taskIdentifier = "agent-long";
    else
      run.payload[
        mismatch === "owner"
          ? "userId"
          : mismatch === "dispatch"
            ? "dispatchId"
            : "startClaimId"
      ] = "foreign";
    mockRetrieve.mockResolvedValue(run);
    const response = await post();
    expect(response.status).toBe(202);
    expect(mockCancel).not.toHaveBeenCalled();
  },
);
it("keeps cancellation pending when confirmation cannot be persisted and succeeds on exact retry", async () => {
  await accepted();
  const invoke = mockMutation.getMockImplementation()!;
  mockMutation.mockImplementation((ref, args) =>
    getFunctionName(ref) === "agentDispatchRequests:recordTerminal"
      ? Promise.reject(new Error("database temporarily unavailable"))
      : invoke(ref, args),
  );
  const first = await post();
  expect(first.status).toBe(202);
  expect(await first.json()).toMatchObject({ canceled: false });
  mockMutation.mockImplementation(invoke);
  mockRetrieve.mockResolvedValue({
    status: "CANCELED",
    taskIdentifier: "hack-long",
    payload: {
      userId: "owner",
      chatId: "chat",
      dispatchId: "dispatch",
      startClaimId: "next",
    },
  });
  const second = await post();
  expect(second.status).toBe(200);
  expect(fixture.tables.agent_dispatch_requests[0].state).toBe("terminal");
});
it("bounds unavailable remote status without claiming Stop succeeded", async () => {
  await accepted();
  jest.useFakeTimers();
  mockRetrieve.mockReturnValue(new Promise(() => {}));
  const pending = post();
  await jest.advanceTimersByTimeAsync(20_000);
  const response = await pending;
  expect(response.status).toBe(202);
  expect(mockCancel).not.toHaveBeenCalled();
  jest.useRealTimers();
});
it.each([
  {},
  { chatId: "chat" },
  { chatId: "chat", dispatchId: " " },
  { chatId: "chat", dispatchId: 42 },
])("requires the exact dispatch identity (%j)", async (body) => {
  expect((await post(body)).status).toBe(400);
  expect(mockMutation).not.toHaveBeenCalled();
});
it("does not parse an unauthenticated request body", async () => {
  const { ChatSDKError } = await import("@/lib/errors");
  mockAuth.mockRejectedValueOnce(new ChatSDKError("unauthorized:auth"));
  const request = req();
  const reader = jest.spyOn(request.body!, "getReader");
  const response = await (await import("../cancel/route")).POST(request);
  expect(response.status).toBe(401);
  expect(reader).not.toHaveBeenCalled();
  expect(mockMutation).not.toHaveBeenCalled();
});
it("does not claim a fence if the required Stop write is unavailable", async () => {
  mockMutation.mockRejectedValueOnce(new Error("database unavailable"));
  const response = await post();
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ canceled: false });
  expect(mockRetrieve).not.toHaveBeenCalled();
  expect(mockCancel).not.toHaveBeenCalled();
});
it("rejects an oversized Stop body before a database write", async () => {
  expect(
    (
      await post({
        chatId: "chat",
        dispatchId: "dispatch",
        padding: "x".repeat(5000),
      })
    ).status,
  ).toBe(413);
  expect(mockMutation).not.toHaveBeenCalled();
});
