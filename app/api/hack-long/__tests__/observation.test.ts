/** @jest-environment node */
import { NextRequest } from "next/server";
const mockStop = jest.fn();
jest.mock("@/lib/hack/durable-stop", () => ({
  readHackDispatchStop: (...args: unknown[]) => mockStop(...args),
}));
const mockAccess = jest.fn(),
  mockQuery = jest.fn(),
  mockChat = jest.fn(),
  mockClaim = jest.fn(),
  mockReceipt = jest.fn(),
  mockRetrieve = jest.fn(),
  mockToken = jest.fn(),
  mockRelease = jest.fn(),
  mockClear = jest.fn();
jest.mock("@/lib/auth/get-user-id", () => ({
  getUserIDAndPro: (...args: unknown[]) => mockAccess(...args),
}));
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: () => ({ query: mockQuery }),
  getConvexServiceKey: () => "fixture",
}));
jest.mock("@/lib/suspensions", () => ({
  assertUserCanMakeCostIncurringRequest: jest.fn(async () => {}),
}));
jest.mock("@/lib/db/actions", () => ({
  getChatById: (...args: unknown[]) => mockChat(...args),
  setActiveTriggerRun: (...args: unknown[]) => mockClear(...args),
}));
jest.mock("@/lib/api/agent-run-claims", () => ({
  getAgentRunClaim: (...args: unknown[]) => mockClaim(...args),
  releaseAgentRunClaim: (...args: unknown[]) => mockRelease(...args),
}));
jest.mock("@/lib/api/agent-dispatch-admission", () => ({
  agentDispatchAdmissionEnabled: () =>
    process.env.RIFT_DURABLE_DISPATCH_ADMISSION === "true",
  readAgentDispatchReceipt: (...args: unknown[]) => mockReceipt(...args),
  refreshAgentDispatchTerminal: jest.fn(async (_owner, receipt) => ({
    receipt,
    reconciliation: "active",
  })),
}));
jest.mock("@/lib/api/agent-run-read-token", () => ({
  createAgentRunReadToken: (...args: unknown[]) => mockToken(...args),
}));
jest.mock("@trigger.dev/sdk", () => ({
  runs: { retrieve: (...args: unknown[]) => mockRetrieve(...args) },
}));
import {
  createHackRunBinding,
  hashHackRunPayload,
} from "@/lib/hack/durable-run";
import { GET as RESUME } from "../resume/route";
import { GET as RECEIPT } from "../receipt/route";
const message = {
  id: "request-1",
  role: "user" as const,
  parts: [{ type: "text" as const, text: "Review saved evidence" }],
};
const payload = () => ({
  userId: "owner",
  chatId: "chat-1",
  purpose: "security",
  startClaimId: "claim-1",
  dispatchId: message.id,
  sandboxPreference: "e2b",
  approvalMode: "ask",
  convexUrl: "https://trusted.convex.cloud",
  hackRun: createHackRunBinding(message, "example.test"),
  messages: [],
});
const request = () =>
  new NextRequest(
    "http://localhost/api/hack-long/resume?chatId=chat-1&dispatchId=request-1&scope=edited.test",
  );
beforeEach(() => {
  mockStop.mockResolvedValue(null);
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://trusted.convex.cloud";
  process.env.RIFT_DURABLE_HACK_ENABLED = "true";
  process.env.RIFT_DURABLE_DISPATCH_ADMISSION = "true";
  mockAccess.mockResolvedValue({ userId: "owner", subscription: "ultra" });
  mockQuery.mockResolvedValue(["ultra-monthly-plan"]);
  mockChat.mockResolvedValue({
    id: "chat-1",
    user_id: "owner",
    purpose: "security",
  });
  mockClaim.mockResolvedValue({
    userId: "owner",
    chatId: "chat-1",
    claimId: "claim-1",
    runId: "run-1",
    phase: "active",
  });
  mockReceipt.mockImplementation(async () => ({
    dispatchId: message.id,
    requestMessageId: message.id,
    claimId: "claim-1",
    runId: "run-1",
    state: "accepted",
    fingerprintVersion: 1,
    payloadHash: hashHackRunPayload(payload()),
  }));
  mockRetrieve.mockResolvedValue({
    id: "run-1",
    taskIdentifier: "hack-long",
    status: "EXECUTING",
    payload: payload(),
  });
  mockToken.mockResolvedValue("read-token");
});
afterEach(() => {
  jest.clearAllMocks();
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  delete process.env.RIFT_DURABLE_HACK_ENABLED;
  delete process.env.RIFT_DURABLE_DISPATCH_ADMISSION;
});
it.each([RESUME, RECEIPT])(
  "observes the exact owned run with receipt-bound scope, never the edited UI target",
  async (handler) => {
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      runId: "run-1",
      publicAccessToken: "read-token",
      requestContext: {
        purpose: "security",
        dispatchId: "request-1",
        scope: "example.test",
        approvalMode: "ask",
      },
    });
    expect(mockToken).toHaveBeenCalledWith("run-1");
  },
);
it.each([RESUME, RECEIPT])(
  "retains read-only observation when rollout flags are switched off",
  async (handler) => {
    delete process.env.RIFT_DURABLE_HACK_ENABLED;
    delete process.env.RIFT_DURABLE_DISPATCH_ADMISSION;
    expect((await handler(request())).status).toBe(200);
  },
);
it.each(["owner", "tier", "receipt", "scope", "task", "origin"])(
  "does not mint a token for invalid %s authority",
  async (condition) => {
    if (condition === "owner")
      mockChat.mockResolvedValue({
        id: "chat-1",
        user_id: "other",
        purpose: "security",
      });
    if (condition === "tier") mockQuery.mockResolvedValue([]);
    if (condition === "receipt") mockReceipt.mockResolvedValue(null);
    if (condition === "scope")
      mockRetrieve.mockResolvedValue({
        taskIdentifier: "hack-long",
        status: "EXECUTING",
        payload: {
          ...payload(),
          hackRun: { ...payload().hackRun, scope: "changed.test" },
        },
      });
    if (condition === "task")
      mockRetrieve.mockResolvedValue({
        taskIdentifier: "agent-long",
        status: "EXECUTING",
        payload: payload(),
      });
    if (condition === "origin")
      mockRetrieve.mockResolvedValue({
        taskIdentifier: "hack-long",
        status: "EXECUTING",
        payload: { ...payload(), convexUrl: "https://other.convex.cloud" },
      });
    const response = await RESUME(request());
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mockToken).not.toHaveBeenCalled();
  },
);
it("returns 204 without a durable claim so callers may observe a legacy HTTP stream", async () => {
  mockClaim.mockResolvedValue(null);
  expect((await RESUME(request())).status).toBe(204);
  expect(mockRetrieve).not.toHaveBeenCalled();
  expect(mockToken).not.toHaveBeenCalled();
});
it("preserves unconfirmed exact delivery without granting permission to send a new run", async () => {
  mockReceipt.mockResolvedValue(null);
  const response = await RECEIPT(request());
  expect(await response.json()).toMatchObject({
    delivery: "unconfirmed",
    dispatchId: "request-1",
  });
  expect(mockToken).not.toHaveBeenCalled();
});
it("clears only the observed terminal owner and does not restart it", async () => {
  mockRetrieve.mockResolvedValue({
    taskIdentifier: "hack-long",
    status: "COMPLETED",
    payload: payload(),
  });
  expect((await RESUME(request())).status).toBe(204);
  expect(mockRelease).toHaveBeenCalledWith({
    userId: "owner",
    chatId: "chat-1",
    claimId: "claim-1",
    runId: "run-1",
  });
  expect(mockClear).toHaveBeenCalledWith({
    chatId: "chat-1",
    triggerRunId: null,
    expectedRunId: "run-1",
  });
  expect(mockToken).not.toHaveBeenCalled();
});

it.each([RESUME, RECEIPT])(
  "keeps terminal runs with pending cleanup explicitly unconfirmed without minting replay tokens",
  async (handler) => {
    const receipt = await mockReceipt();
    mockReceipt.mockResolvedValue({ ...receipt, requiresCleanup: true });
    mockRetrieve.mockResolvedValue({
      taskIdentifier: "hack-long",
      status: "COMPLETED",
      payload: payload(),
    });
    const response = await handler(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "cleanup_pending",
      delivery: "unconfirmed",
      canceled: false,
      dispatchId: "request-1",
      requestContext: { dispatchId: "request-1", scope: "example.test" },
    });
    expect(mockRelease).not.toHaveBeenCalled();
    expect(mockClear).not.toHaveBeenCalled();
    expect(mockToken).not.toHaveBeenCalled();
  },
);

it("allows normal terminal observation after the exact cleanup acknowledgment", async () => {
  const receipt = await mockReceipt();
  mockReceipt.mockResolvedValue({
    ...receipt,
    requiresCleanup: true,
    cleanupConfirmedAt: 1234,
  });
  mockRetrieve.mockResolvedValue({
    taskIdentifier: "hack-long",
    status: "COMPLETED",
    payload: payload(),
  });
  expect((await RESUME(request())).status).toBe(204);
  expect(mockRelease).toHaveBeenCalledTimes(1);
});

it.each([true, false])(
  "returns an exact saved Stop receipt before chat persistence (confirmed=%s)",
  async (canceled) => {
    mockChat.mockResolvedValue(null);
    mockStop.mockResolvedValue({ canceled, dispatchId: "request-1" });
    const response = await RECEIPT(request());
    expect(await response.json()).toMatchObject({
      delivery: canceled ? "canceled" : "unconfirmed",
      canceled,
      dispatchId: "request-1",
    });
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockToken).not.toHaveBeenCalled();
  },
);
