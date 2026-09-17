/** @jest-environment node */
import { NextRequest } from "next/server";
const mockAuth = jest.fn(),
  mockChat = jest.fn(),
  mockReceipt = jest.fn(),
  mockToken = jest.fn();
const mockRefresh = jest.fn();
const mockEnabled = jest.fn(() => true),
  mockPurpose = jest.fn();
jest.mock("@/lib/auth/get-user-id", () => ({
  getUserIDAndPro: () => mockAuth(),
}));
jest.mock("@/lib/db/actions", () => ({
  getChatById: (args: unknown) => mockChat(args),
}));
jest.mock("@/lib/api/agent-dispatch-admission", () => ({
  agentDispatchAdmissionEnabled: () => mockEnabled(),
  readAgentDispatchReceipt: (args: unknown) => mockReceipt(args),
  refreshAgentDispatchTerminal: (...args: unknown[]) => mockRefresh(...args),
}));
jest.mock("@/lib/api/agent-run-read-token", () => ({
  createAgentRunReadToken: (id: string) => mockToken(id),
}));
jest.mock("@/lib/auth/premium-access", () => ({
  assertHackWorkbenchPurposeRoute: (...args: unknown[]) => mockPurpose(...args),
}));
import { GET } from "../route";
const request = () =>
  new NextRequest(
    "http://localhost/api/agent-long/receipt?chatId=chat&dispatchId=message",
  );
beforeEach(() => {
  jest.resetAllMocks();
  mockEnabled.mockReturnValue(true);
  mockAuth.mockResolvedValue({ userId: "owner", subscription: "free" });
  mockChat.mockResolvedValue({
    user_id: "owner",
    purpose: "app",
    active_trigger_run_id: "newer-run",
  });
  mockReceipt.mockResolvedValue({ runId: "original-run", state: "accepted" });
  mockToken.mockResolvedValue("read-token");
  mockRefresh.mockImplementation(async (_owner, receipt) => ({
    receipt,
    reconciliation: "terminal",
  }));
});
it("returns the exact logical run, independent of the newer chat run", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    runId: "original-run",
    delivery: "accepted",
  });
  expect(mockReceipt).toHaveBeenCalledWith({
    userId: "owner",
    chatId: "chat",
    dispatchId: "message",
  });
  expect(mockToken).toHaveBeenCalledWith("original-run");
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("denies foreign chats before receipt lookup or token minting", async () => {
  mockChat.mockResolvedValue({ user_id: "another" });
  expect((await GET(request())).status).toBe(403);
  expect(mockReceipt).not.toHaveBeenCalled();
  expect(mockToken).not.toHaveBeenCalled();
});
it("missing receipt remains unconfirmed, never grants dispatch authority", async () => {
  mockReceipt.mockResolvedValue(null);
  expect(await (await GET(request())).json()).toEqual({
    delivery: "unconfirmed",
    dispatchId: "message",
  });
  expect(mockToken).not.toHaveBeenCalled();
});
it.each(["COMPLETED", "FAILED", "CANCELED"])(
  "preserves terminal receipt %s",
  async (terminalStatus) => {
    mockReceipt.mockResolvedValue({
      runId: "original-run",
      state: "terminal",
      terminalStatus,
    });
    expect(await (await GET(request())).json()).toMatchObject({
      runId: "original-run",
      terminalStatus,
    });
  },
);
it("failed ownership/receipt reads do not become missing-receipt responses", async () => {
  mockReceipt.mockRejectedValue(new Error("unavailable"));
  expect((await GET(request())).status).toBe(503);
  expect(mockToken).not.toHaveBeenCalled();
});
it("requires a stable request identity", async () => {
  expect(
    (
      await GET(
        new NextRequest("http://localhost/api/agent-long/receipt?chatId=chat"),
      )
    ).status,
  ).toBe(400);
  expect(mockReceipt).not.toHaveBeenCalled();
});
it("disabled rollout does not query a missing remote schema", async () => {
  mockEnabled.mockReturnValue(false);
  expect((await GET(request())).status).toBe(503);
  expect(mockReceipt).not.toHaveBeenCalled();
});

it("keeps accepted-run access when fresh status cannot be obtained", async () => {
  mockRefresh.mockImplementation(async (_owner, receipt) => ({
    receipt,
    reconciliation: "unavailable",
  }));
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    runId: "original-run",
    statusFresh: false,
  });
});
