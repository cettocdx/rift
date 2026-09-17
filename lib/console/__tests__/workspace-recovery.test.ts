/** @jest-environment node */
jest.mock("server-only", () => ({}));
jest.mock("@/lib/hack/http-execution", () => ({
  readHackHttpExecution: jest.fn(),
}));
jest.mock("@/lib/api/agent-dispatch-admission", () => ({
  readAgentDispatchReceipt: jest.fn(),
  refreshAgentDispatchTerminal: jest.fn(),
}));
import { readHackHttpExecution } from "@/lib/hack/http-execution";
import {
  readAgentDispatchReceipt,
  refreshAgentDispatchTerminal,
} from "@/lib/api/agent-dispatch-admission";
import { recoverWorkspaceOutcome } from "../workspace-recovery";
const identity = { userId: "owner", chatId: "chat", operationId: "exact-op" };
beforeEach(() => {
  jest.resetAllMocks();
  (readHackHttpExecution as jest.Mock).mockResolvedValue(undefined);
  (readAgentDispatchReceipt as jest.Mock).mockResolvedValue(undefined);
});
it("does not guess success from an HTTP producer's terminal acknowledgement", async () => {
  (readHackHttpExecution as jest.Mock).mockResolvedValue({
    phase: "terminal",
    canceled: false,
  });
  expect(await recoverWorkspaceOutcome(identity)).toBe("ended");
  expect(readHackHttpExecution).toHaveBeenCalledWith({
    userId: "owner",
    chatId: "chat",
    executionId: "exact-op",
  });
});
it("keeps an active producer unresolved", async () => {
  (readHackHttpExecution as jest.Mock).mockResolvedValue({ phase: "running" });
  expect(await recoverWorkspaceOutcome(identity)).toBeUndefined();
});
it("requires durable cleanup acknowledgement", async () => {
  (readAgentDispatchReceipt as jest.Mock).mockResolvedValue({
    dispatchId: "exact-op",
    state: "terminal",
  });
  (refreshAgentDispatchTerminal as jest.Mock).mockResolvedValue({
    receipt: {
      state: "terminal",
      terminalStatus: "COMPLETED",
      requiresCleanup: true,
    },
  });
  expect(await recoverWorkspaceOutcome(identity)).toBeUndefined();
  (refreshAgentDispatchTerminal as jest.Mock).mockResolvedValue({
    receipt: {
      state: "terminal",
      terminalStatus: "COMPLETED",
      requiresCleanup: true,
      cleanupConfirmedAt: 1,
    },
  });
  expect(await recoverWorkspaceOutcome(identity)).toBe("completed");
});
