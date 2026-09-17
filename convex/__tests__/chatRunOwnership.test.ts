import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("../_generated/server", () => ({
  mutation: (config: unknown) => config,
  internalMutation: (config: unknown) => config,
  query: (config: unknown) => config,
}));
jest.mock("../_generated/api", () => ({ internal: {} }));
jest.mock("../fileAggregate", () => ({ fileCountAggregate: {} }));
jest.mock("../lib/utils", () => ({ validateServiceKey: jest.fn() }));
jest.mock("../lib/logger", () => ({ convexLogger: { warn: jest.fn() } }));
jest.mock("convex/server", () => ({ paginationOptsValidator: "pagination" }));
jest.mock("convex/values", () => ({
  v: new Proxy({}, { get: () => jest.fn(() => "validator") }),
  ConvexError: class extends Error {},
}));

const { updateChat } =
  jest.requireActual<typeof import("../chats")>("../chats");
const { prepareForNewStream, startStream } =
  jest.requireActual<typeof import("../chatStreams")>("../chatStreams");
const { validateServiceKey } = jest.requireMock("../lib/utils") as {
  validateServiceKey: jest.Mock;
};

const owner = { serviceKey: "test-service-key", chatId: "chat-1" };
const newTodos = [
  { id: "new-todo", content: "New task", status: "in_progress" },
];
const oldTodos = [{ id: "old-todo", content: "Old task", status: "completed" }];

function fixture(
  runId: string | undefined = "run-current",
  exactActive = false,
) {
  const chat = {
    _id: "chat-row",
    id: "chat-1",
    user_id: "owner",
    active_trigger_run_id: runId,
    active_stream_id: "current-stream",
    canceled_at: 100,
    cancel_skip_save: true,
    finish_reason: "tool-calls",
    todos: newTodos,
    title: "Current chat",
  };
  const ctx = {
    db: {
      query: jest.fn((table: string) => ({
        withIndex: () => ({
          first: async () => chat,
          take: async () =>
            !exactActive
              ? []
              : table === "hack_http_execution_heads"
                ? [
                    {
                      user_id: "owner",
                      chat_id: "chat-1",
                      execution_id: "current-stream",
                    },
                  ]
                : table === "hack_http_executions"
                  ? [
                      {
                        user_id: "owner",
                        chat_id: "chat-1",
                        execution_id: "current-stream",
                        phase: "running",
                      },
                    ]
                  : [],
        }),
      })),
      patch: jest.fn(async (_id: string, patch: object) => {
        Object.assign(chat, patch);
      }),
    },
  };
  return { ctx, chat };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe.each([
  [
    "updateChat",
    updateChat,
    { finishReason: "stop", todos: oldTodos, title: "Old chat" },
  ],
  ["prepareForNewStream", prepareForNewStream, {}],
] as const)("%s Trigger run ownership", (_name, operation, changes) => {
  const invoke = (ctx: unknown, expected?: string) =>
    (operation as any).handler(ctx, {
      ...owner,
      ...changes,
      ...(expected !== undefined ? { expectedTriggerRunId: expected } : {}),
    });

  it("leaves newer run data and stream state intact when a stale worker finishes", async () => {
    const { ctx, chat } = fixture();
    const before = { ...chat };
    expect(await invoke(ctx, "run-old")).toBeNull();
    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(chat).toEqual(before);
  });

  it("does not revive cleanup after the owning run mapping has already been released", async () => {
    const { ctx, chat } = fixture();
    chat.active_trigger_run_id = undefined;
    expect(await invoke(ctx, "run-old")).toBeNull();
    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(chat.active_stream_id).toBe("current-stream");
  });

  it("applies cleanup while the same Trigger run still owns the chat", async () => {
    const { ctx, chat } = fixture();
    expect(await invoke(ctx, "run-current")).toBeNull();
    expect(ctx.db.patch).toHaveBeenCalledTimes(1);
    expect(chat.active_stream_id).toBeUndefined();
    expect(chat.canceled_at).toBeUndefined();
    expect(chat.active_trigger_run_id).toBe("run-current");
    if (_name === "updateChat") {
      expect(chat.finish_reason).toBe("stop");
      expect(chat.todos).toEqual(oldTodos);
    }
  });

  it("preserves existing callers without a Trigger run guard", async () => {
    const { ctx, chat } = fixture();
    expect(await invoke(ctx)).toBeNull();
    expect(ctx.db.patch).toHaveBeenCalledTimes(1);
    expect(chat.active_stream_id).toBeUndefined();
  });

  it("validates backend authority before accessing the chat", async () => {
    const { ctx } = fixture();
    validateServiceKey.mockImplementationOnce(() => {
      throw new Error("Unauthorized");
    });
    await expect(invoke(ctx, "run-current")).rejects.toThrow("Unauthorized");
    expect(ctx.db.query).not.toHaveBeenCalled();
  });
});

describe.each([
  ["updateChat", updateChat, { finishReason: "stop", todos: oldTodos }],
  ["prepareForNewStream", prepareForNewStream, {}],
] as const)("%s exact HTTP stream ownership", (_name, operation, changes) => {
  it("does not clear a newer HTTP stream or change its metadata", async () => {
    const { ctx, chat } = fixture(undefined);
    Object.assign(chat, { active_http_execution_id: "new-stream" });
    const before = { ...chat };
    await (operation as any).handler(ctx, {
      ...owner,
      ...changes,
      expectedStreamId: "old-stream",
    });
    expect(chat).toEqual(before);
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
  it("clears only its matching HTTP mappings while preserving unrelated cancellation flags", async () => {
    const { ctx, chat } = fixture(undefined);
    Object.assign(chat, { active_http_execution_id: "current-stream" });
    await (operation as any).handler(ctx, {
      ...owner,
      ...changes,
      expectedStreamId: "current-stream",
    });
    expect(chat.active_stream_id).toBeUndefined();
    expect((chat as any).active_http_execution_id).toBeUndefined();
    expect(chat.canceled_at).toBe(100);
    expect(chat.cancel_skip_save).toBe(true);
  });
});

it.each([
  ["startStream", startStream, { streamId: "old-delayed-stream" }],
  ["updateChat", updateChat, { finishReason: "stop", todos: oldTodos }],
  ["prepareForNewStream", prepareForNewStream, {}],
] as const)(
  "%s cannot overwrite an admitted exact HTTP head through its old unscoped API",
  async (_name, operation, args) => {
    const { ctx, chat } = fixture(undefined, true);
    const before = { ...chat };
    await (operation as any).handler(ctx, { ...owner, ...args });
    expect(chat).toEqual(before);
    expect(ctx.db.patch).not.toHaveBeenCalled();
  },
);
