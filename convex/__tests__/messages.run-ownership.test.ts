jest.mock("../_generated/server", () => ({
  mutation: (config: unknown) => config,
  query: (config: unknown) => config,
  internalQuery: (config: unknown) => config,
}));
jest.mock("../_generated/api", () => ({
  internal: { messages: { verifyChatOwnership: "verify-chat" } },
}));
jest.mock("../lib/utils", () => ({
  validateServiceKey: jest.fn(),
  copyChatSummary: jest.fn(),
}));
jest.mock("../fileAggregate", () => ({ fileCountAggregate: {} }));
jest.mock("../lib/logger", () => ({ convexLogger: { warn: jest.fn() } }));

const { saveMessage } = jest.requireActual("../messages");
const { validateServiceKey } = jest.requireMock("../lib/utils");
const args = {
  serviceKey: "test",
  id: "message",
  chatId: "chat",
  userId: "owner",
  role: "assistant",
  parts: [{ type: "text", text: "partial output" }],
  expectedTriggerRunId: "run-current",
};
function fixture(
  chat: Record<string, unknown> | null = {
    user_id: "owner",
    active_trigger_run_id: "run-current",
  },
  existing: Record<string, unknown> | null = null,
) {
  return {
    db: {
      query: jest.fn((table) => ({
        withIndex: () => ({
          take: async () => (chat ? [chat] : []),
          first: async () => (table === "chats" ? chat : existing),
        }),
      })),
      insert: jest.fn().mockResolvedValue("message-row"),
      patch: jest.fn(),
      get: jest.fn(),
    },
    runQuery: jest.fn().mockResolvedValue(true),
  };
}
beforeEach(() => jest.clearAllMocks());

describe("saveMessage active run fence", () => {
  it.each([
    ["replacement", { user_id: "owner", active_trigger_run_id: "run-newer" }],
    ["cleared mapping", { user_id: "owner" }],
    ["other owner", { user_id: "other", active_trigger_run_id: "run-current" }],
    ["deleted chat", null],
  ])(
    "rejects %s before touching message or attachment records",
    async (_label, chat) => {
      const ctx = fixture(chat as Record<string, unknown> | null);
      await expect(saveMessage.handler(ctx, args)).rejects.toMatchObject({
        data: { code: "AGENT_RUN_LOST" },
      });
      expect(ctx.db.insert).not.toHaveBeenCalled();
      expect(ctx.db.patch).not.toHaveBeenCalled();
      expect(ctx.db.get).not.toHaveBeenCalled();
      expect(ctx.runQuery).not.toHaveBeenCalled();
      expect(ctx.db.query).not.toHaveBeenCalledWith("messages");
    },
  );
  it("rejects stale update-only saves as errors too", async () => {
    const ctx = fixture(
      { user_id: "owner", active_trigger_run_id: "run-newer" },
      { _id: "message-row", chat_id: "chat", user_id: "owner" },
    );
    await expect(
      saveMessage.handler(ctx, {
        ...args,
        updateOnly: true,
        usage: { totalTokens: 10 },
      }),
    ).rejects.toMatchObject({ data: { code: "AGENT_RUN_LOST" } });
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
  it("allows the owning run to persist a plain Stop partial transcript", async () => {
    const ctx = fixture({
      user_id: "owner",
      active_trigger_run_id: "run-current",
      canceled_at: 100,
    });
    await expect(saveMessage.handler(ctx, args)).resolves.toBeNull();
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "messages",
      expect.objectContaining({
        parts: args.parts,
        chat_id: "chat",
        user_id: "owner",
      }),
    );
  });
  it("keeps unguarded callers on the existing ownership path", async () => {
    const ctx = fixture();
    const { expectedTriggerRunId: _guard, ...unguarded } = args;
    await expect(saveMessage.handler(ctx, unguarded)).resolves.toBeNull();
    expect(ctx.db.query).not.toHaveBeenCalledWith("chats");
    expect(ctx.runQuery).toHaveBeenCalledWith("verify-chat", {
      chatId: "chat",
      userId: "owner",
    });
  });
  it("validates service authority before reading run ownership", async () => {
    const ctx = fixture();
    validateServiceKey.mockImplementationOnce(() => {
      throw new Error("invalid service authority");
    });
    await expect(saveMessage.handler(ctx, args)).rejects.toThrow(
      "invalid service authority",
    );
    expect(ctx.db.query).not.toHaveBeenCalled();
  });
});
