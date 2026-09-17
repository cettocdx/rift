/** @jest-environment node */
import { NextRequest } from "next/server";
const mockMutation = jest.fn();
const mockRetrieve = jest.fn();
const mockChat = jest.fn();
const mockFinish = jest.fn();
jest.mock("@/convex/_generated/api", () => ({
  api: {
    runs: {
      reconcileCompletedMessages: "saved",
      closeMissingWorker: "missing",
    },
  },
}));
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: () => ({ mutation: mockMutation }),
}));
jest.mock("@/lib/auth/get-user-id", () => ({ getUserID: async () => "owner" }));
jest.mock("@/lib/db/actions", () => ({
  getChatById: (...args: unknown[]) => mockChat(...args),
}));
jest.mock("@/lib/ai/runs/run-recorder", () => ({
  finishRunRecord: (...args: unknown[]) => mockFinish(...args),
}));
jest.mock("@trigger.dev/sdk", () => ({
  runs: { retrieve: (...args: unknown[]) => mockRetrieve(...args) },
}));
jest.mock("@/lib/api/agent-long-runs", () => ({
  TERMINAL_RUN_STATUSES: new Set(["COMPLETED", "CANCELED", "FAILED"]),
}));
import { POST } from "../route";
const request = () =>
  new NextRequest("http://localhost/api/runs/reconcile", {
    method: "POST",
    body: JSON.stringify({ runs: [{ id: "run_owned", chatId: "chat" }] }),
  });
beforeEach(() => {
  jest.clearAllMocks();
  mockMutation.mockResolvedValue(null);
  mockChat.mockResolvedValue({ user_id: "owner" });
});
it.each([404, 503])(
  "does not infer termination from provider HTTP %s",
  async (status) => {
    mockRetrieve.mockRejectedValue(
      Object.assign(new Error("provider observation failed"), { status }),
    );
    const response = await POST(request());
    expect(await response.json()).toEqual({ closed: 0 });
    expect(mockMutation).toHaveBeenCalledTimes(1);
    expect(mockMutation.mock.calls[0][0]).toBe("saved");
    expect(mockFinish).not.toHaveBeenCalled();
  },
);
it.each([
  { status: "EXECUTING", tags: ["user_owner", "chat_chat"] },
  { status: "COMPLETED", tags: ["user_foreign", "chat_chat"] },
  { status: "COMPLETED", tags: ["user_owner", "chat_other"] },
])("preserves active or unowned producer %j", async (record) => {
  mockRetrieve.mockResolvedValue({ id: "run_owned", ...record });
  expect(await (await POST(request())).json()).toEqual({ closed: 0 });
  expect(mockFinish).not.toHaveBeenCalled();
});
it("records an explicitly terminal owned producer", async () => {
  mockRetrieve.mockResolvedValue({
    id: "run_owned",
    status: "COMPLETED",
    tags: ["user_owner", "chat_chat"],
  });
  expect(await (await POST(request())).json()).toEqual({ closed: 1 });
  expect(mockFinish).toHaveBeenCalledWith({
    runId: "run_owned",
    status: "completed",
    stopReason: "worker_reconciled",
  });
});
