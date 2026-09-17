/** @jest-environment node */
const mockQuery = jest.fn();
const mockMutation = jest.fn();
jest.mock("@/convex/_generated/api", () => ({
  api: {
    agentCheckpoints: {
      beginRun: "begin",
      markStep: "mark",
      saveStep: "save",
      finishRun: "finish",
      disableRun: "disable",
      getForBackend: "get",
    },
  },
}));
jest.mock("@/lib/db/convex-client", () => ({
  ...jest.requireActual<typeof import("@/lib/db/convex-client")>(
    "@/lib/db/convex-client",
  ),
  getConvexClient: () => ({ query: mockQuery, mutation: mockMutation }),
}));
import {
  beginAgentCheckpointRun,
  markAgentCheckpointStep,
  saveAgentCheckpoint,
  finishAgentCheckpointRun,
  disableAgentCheckpointRun,
  getAgentCheckpoint,
} from "../agent-checkpoints";
const owner = {
  userId: "owner",
  chatId: "chat",
  claimId: "claim",
  runId: "run",
};
const checkpoint = {
  version: 1 as const,
  stepIndex: 1,
  finishReason: "stop",
  messagesJson: "[]",
};
const priorServiceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
beforeAll(() => {
  process.env.CONVEX_SERVICE_ROLE_KEY = "test-checkpoint-authority";
});
afterAll(() => {
  if (priorServiceKey === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
  else process.env.CONVEX_SERVICE_ROLE_KEY = priorServiceKey;
});
beforeEach(() => jest.resetAllMocks());
it("forwards exact request and claim fences with service authority", async () => {
  const args = {
    ...owner,
    requestMessageId: "message",
    requestHash: "a".repeat(64),
    model: "model",
  };
  mockMutation.mockResolvedValue({
    status: "resume",
    checkpoint,
    stepIndex: 1,
  });
  await expect(beginAgentCheckpointRun(args)).resolves.toMatchObject({
    status: "resume",
  });
  expect(mockMutation).toHaveBeenCalledWith("begin", {
    ...args,
    serviceKey: process.env.CONVEX_SERVICE_ROLE_KEY,
  });
});
it("keeps rejected writes and unavailable storage fail-closed", async () => {
  mockMutation.mockResolvedValue(false);
  await expect(
    markAgentCheckpointStep({ ...owner, stepIndex: 1 }),
  ).resolves.toBe(false);
  await expect(saveAgentCheckpoint({ ...owner, checkpoint })).resolves.toBe(
    false,
  );
  await expect(
    disableAgentCheckpointRun({ ...owner, reason: "model-changed" }),
  ).resolves.toBe(false);
  expect(mockMutation).toHaveBeenCalledWith(
    "disable",
    expect.objectContaining({ ...owner, reason: "model-changed" }),
  );
  await expect(
    finishAgentCheckpointRun({ ...owner, discard: true }),
  ).resolves.toBe(false);
  mockMutation.mockRejectedValue(new Error("offline"));
  await expect(saveAgentCheckpoint({ ...owner, checkpoint })).rejects.toThrow(
    "offline",
  );
  expect(mockMutation).toHaveBeenCalledWith(
    "finish",
    expect.objectContaining({ ...owner, discard: true }),
  );
});
it("reads only through the owner-scoped backend query", async () => {
  mockQuery.mockResolvedValue(null);
  await expect(
    getAgentCheckpoint({ userId: owner.userId, chatId: owner.chatId }),
  ).resolves.toBeNull();
  expect(mockQuery).toHaveBeenCalledWith(
    "get",
    expect.objectContaining({ userId: "owner", chatId: "chat" }),
  );
});

it("admits a step without queueing behind unrelated writes", async () => {
  mockMutation.mockResolvedValue(true);
  await expect(
    markAgentCheckpointStep({ ...owner, stepIndex: 1 }),
  ).resolves.toBe(true);
  expect(mockMutation).toHaveBeenCalledWith(
    "mark",
    {
      ...owner,
      stepIndex: 1,
      serviceKey: process.env.CONVEX_SERVICE_ROLE_KEY,
    },
    { skipQueue: true },
  );
});
