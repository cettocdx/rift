import { AgentRunClaimLostError } from "@/lib/api/agent-run-claims";
const mockMutation = jest.fn();
jest.mock("server-only", () => ({}));
jest.mock("../convex-client", () => ({
  ...jest.requireActual<typeof import("../convex-client")>("../convex-client"),
  getConvexClient: () => ({ mutation: mockMutation }),
}));
jest.mock("@/lib/api/agent-run-claims", () => ({
  AgentRunClaimLostError: class extends Error {},
}));
const load = () => import("../initial-turn");
const args = {
  chatId: "chat",
  userId: "owner",
  claimId: "claim",
  chat: null,
  messages: [
    { id: "message", parts: [{ type: "text" as const, text: "hello" }] },
  ],
};
beforeEach(() => {
  mockMutation.mockReset().mockResolvedValue(null);
  process.env.CONVEX_SERVICE_ROLE_KEY = "test-service";
});
it("makes one guarded RPC for a new chat and sanitized user turn", async () => {
  const { persistClaimedInitialTurn } = await load();
  await persistClaimedInitialTurn({ ...args, purpose: "app", isHidden: true });
  expect(mockMutation).toHaveBeenCalledTimes(1);
  expect(mockMutation.mock.calls[0][1]).toEqual({
    serviceKey: "test-service",
    userId: "owner",
    chatId: "chat",
    claimId: "claim",
    allowCreate: true,
    title: "hello",
    purpose: "app",
    projectId: undefined,
    message: {
      id: "message",
      parts: args.messages[0].parts,
      fileIds: undefined,
      isHidden: true,
    },
  });
});
it("uses the server-read existence snapshot and omits messages for regeneration", async () => {
  const { persistClaimedInitialTurn } = await load();
  await persistClaimedInitialTurn({
    ...args,
    chat: { user_id: "owner" },
    regenerate: true,
  });
  expect(mockMutation.mock.calls[0][1]).toMatchObject({ allowCreate: false });
  expect(mockMutation.mock.calls[0][1].message).toBeUndefined();
});
it("does not persist an empty auto-continuation message", async () => {
  const { persistClaimedInitialTurn } = await load();
  await persistClaimedInitialTurn({ ...args, messages: [] });
  expect(mockMutation.mock.calls[0][1]).toMatchObject({ title: "New Chat" });
  expect(mockMutation.mock.calls[0][1].message).toBeUndefined();
});
it("checks ownership before the service RPC", async () => {
  const { persistClaimedInitialTurn } = await load();
  await expect(
    persistClaimedInitialTurn({ ...args, chat: { user_id: "foreign" } }),
  ).rejects.toThrow();
  expect(mockMutation).not.toHaveBeenCalled();
});
it("sanitizes non-Convex values and deduplicates user file references", async () => {
  const { persistClaimedInitialTurn } = await load();
  await persistClaimedInitialTurn({
    ...args,
    messages: [
      {
        id: "message",
        parts: [
          { type: "text", text: "x".repeat(120), optional: undefined },
          { type: "file", fileId: "file" },
          { type: "file", fileId: "file" },
        ] as any,
      },
    ],
  });
  const payload = mockMutation.mock.calls[0][1];
  expect(payload.title).toHaveLength(100);
  expect(payload.message.fileIds).toEqual(["file"]);
  expect(payload.message.parts[0]).not.toHaveProperty("optional");
});
it("does not make an RPC after cancellation", async () => {
  const { persistClaimedInitialTurn } = await load();
  const controller = new AbortController();
  controller.abort();
  await expect(
    persistClaimedInitialTurn(args, controller.signal),
  ).rejects.toBeInstanceOf(AgentRunClaimLostError);
  expect(mockMutation).not.toHaveBeenCalled();
});
it("propagates loss of the atomic startup fence as the route's typed conflict", async () => {
  const { persistClaimedInitialTurn } = await load();
  mockMutation.mockRejectedValue({ data: { code: "AGENT_RUN_LOST" } });
  await expect(persistClaimedInitialTurn(args)).rejects.toBeInstanceOf(
    AgentRunClaimLostError,
  );
});
it("rejects a request aborted while persistence is in flight", async () => {
  const { persistClaimedInitialTurn } = await load();
  const controller = new AbortController();
  mockMutation.mockImplementation(async () => {
    controller.abort();
  });
  await expect(
    persistClaimedInitialTurn(args, controller.signal),
  ).rejects.toBeInstanceOf(AgentRunClaimLostError);
});
