import { createToolApprovalGate } from "../server";
import { getConvexClient } from "@/lib/db/convex-client";
import { setTimeout as delay } from "node:timers/promises";
jest.mock("@/lib/db/convex-client", () => ({
  ...jest.requireActual<typeof import("@/lib/db/convex-client")>(
    "@/lib/db/convex-client",
  ),
  getConvexClient: jest.fn(),
}));
jest.mock("node:timers/promises", () => ({
  setTimeout: jest.fn(async () => undefined),
}));
const mutation = jest.fn();
const context = {
  userId: "owner",
  chatId: "chat",
  runId: "run",
  mode: "ask" as const,
};
const prompt = {
  toolName: "run_terminal_cmd",
  input: { command: "npm test" },
  toolCallId: "call",
};
const previousKey = process.env.CONVEX_SERVICE_ROLE_KEY;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.CONVEX_SERVICE_ROLE_KEY = "test-service";
  jest.mocked(getConvexClient).mockReturnValue({ mutation } as never);
});
afterAll(() => {
  if (previousKey === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
  else process.env.CONVEX_SERVICE_ROLE_KEY = previousKey;
});
it("waits for the owner-bound approval and consumes it before returning", async () => {
  mutation
    .mockResolvedValueOnce("approval")
    .mockResolvedValueOnce("pending")
    .mockResolvedValueOnce("approved")
    .mockResolvedValueOnce(undefined);
  await createToolApprovalGate(context)(prompt);
  expect(delay).toHaveBeenCalledTimes(1);
  expect(mutation.mock.calls[0][1]).toMatchObject({
    userId: "owner",
    chatId: "chat",
    runId: "run",
    toolCallId: "call",
    toolName: "run_terminal_cmd",
  });
});
it.each(["denied", "expired", "canceled", "consumed"])(
  "fails closed for %s decisions and closes the request",
  async (status) => {
    mutation
      .mockResolvedValueOnce("approval")
      .mockResolvedValueOnce(status)
      .mockResolvedValueOnce(undefined);
    await expect(createToolApprovalGate(context)(prompt)).rejects.toThrow(
      `Action ${status}`,
    );
    expect(mutation).toHaveBeenLastCalledWith(expect.anything(), {
      serviceKey: "test-service",
      id: "approval",
      userId: "owner",
      runId: "run",
    });
  },
);
it("does not proceed if the decision backend is unavailable", async () => {
  mutation
    .mockResolvedValueOnce("approval")
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce(undefined);
  await expect(createToolApprovalGate(context)(prompt)).rejects.toThrow(
    "Offline",
  );
});
it("requires no approval service for explicitly selected full access", async () => {
  delete process.env.CONVEX_SERVICE_ROLE_KEY;
  await createToolApprovalGate({ ...context, mode: "full" })(prompt);
  expect(mutation).not.toHaveBeenCalled();
});
it("fails closed when approval service credentials are missing", async () => {
  delete process.env.CONVEX_SERVICE_ROLE_KEY;
  await expect(createToolApprovalGate(context)(prompt)).rejects.toThrow(
    "No action was executed",
  );
  expect(mutation).not.toHaveBeenCalled();
});

it("latches a denial so further tools cannot restart the same run", async () => {
  mutation
    .mockResolvedValueOnce("approval")
    .mockResolvedValueOnce("denied")
    .mockResolvedValueOnce(undefined);
  const gate = createToolApprovalGate(context);
  await expect(gate(prompt)).rejects.toThrow("Action denied");
  expect(gate.isStopped?.()).toBe(true);
  mutation.mockClear();
  await expect(
    gate({ ...prompt, toolName: "file", input: { action: "read" } }),
  ).rejects.toThrow("stopped this run");
  expect(mutation).not.toHaveBeenCalled();
});
