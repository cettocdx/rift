import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import type { Id } from "../_generated/dataModel";

jest.mock("../_generated/server", () => ({
  mutation: jest.fn((config: any) => config),
  internalMutation: jest.fn((config: any) => config),
  query: jest.fn((config: any) => config),
  internalQuery: jest.fn((config: any) => config),
}));
jest.mock("convex/values", () => ({
  v: new Proxy({}, { get: () => jest.fn(() => "v") }),
  ConvexError: class ConvexError extends Error {
    data: any;
    constructor(data: any) {
      super(typeof data === "string" ? data : data.message);
      this.data = data;
      this.name = "ConvexError";
    }
  },
}));
jest.mock("../_generated/api", () => ({
  internal: {
    messages: { verifyChatOwnership: "internal.messages.verifyChatOwnership" },
  },
}));
jest.mock("../lib/utils", () => ({
  validateServiceKey: jest.fn(),
  copyChatSummary: jest.fn(),
}));
jest.mock("../lib/projectOwnership", () => ({ getOwnedProject: jest.fn() }));
jest.mock("../fileAggregate", () => ({
  fileCountAggregate: {
    deleteIfExists: jest.fn<any>().mockResolvedValue(undefined),
  },
}));
jest.mock("convex/server", () => ({
  paginationOptsValidator: "paginationOptsValidator",
}));

const CHAT_ID = "chat-1";
const USER_ID = "user-1";

function makeCtx(existing: Record<string, any> | null) {
  const withIndexMock = jest.fn().mockReturnValue({
    first: jest.fn<any>().mockResolvedValue(existing),
  });
  return {
    auth: {
      getUserIdentity: jest
        .fn<any>()
        .mockResolvedValue({ subject: `${USER_ID}|session` }),
    },
    db: {
      query: jest.fn().mockReturnValue({ withIndex: withIndexMock }),
      get: jest.fn<any>().mockResolvedValue(null),
      insert: jest.fn<any>().mockResolvedValue("new-id" as Id<"messages">),
      patch: jest.fn<any>().mockResolvedValue(undefined),
    },
    runQuery: jest.fn<any>().mockResolvedValue(true),
  } as any;
}

const stopArgs = {
  id: "asst-1",
  chatId: CHAT_ID,
  role: "assistant" as const,
  parts: [{ type: "text", text: "partial output" }],
  generationTimeMs: 1234,
  stopReason: "user" as const,
};

describe("saveAssistantMessage — durable stop persistence (E2/A7)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("inserts a stopped turn with its marker when no row exists", async () => {
    const ctx = makeCtx(null);
    const { saveAssistantMessage } = await import("../messages");
    await saveAssistantMessage.handler(ctx, stopArgs);

    expect(ctx.db.insert).toHaveBeenCalledWith(
      "messages",
      expect.objectContaining({ stop_reason: "user" }),
    );
  });

  it("updates an incomplete existing row with the partial output and marker", async () => {
    const ctx = makeCtx({
      _id: "doc-1" as Id<"messages">,
      id: "asst-1",
      chat_id: CHAT_ID,
      user_id: USER_ID,
      role: "assistant",
      parts: [],
      finish_reason: undefined,
    });
    const { saveAssistantMessage } = await import("../messages");
    await saveAssistantMessage.handler(ctx, stopArgs);

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "doc-1",
      expect.objectContaining({
        stop_reason: "user",
        parts: stopArgs.parts,
      }),
    );
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("never clobbers a server-completed message with a partial stop save", async () => {
    const ctx = makeCtx({
      _id: "doc-1" as Id<"messages">,
      id: "asst-1",
      chat_id: CHAT_ID,
      user_id: USER_ID,
      role: "assistant",
      parts: [{ type: "text", text: "the complete answer" }],
      finish_reason: "stop",
    });
    const { saveAssistantMessage } = await import("../messages");
    await saveAssistantMessage.handler(ctx, stopArgs);

    // No parts overwrite: the finished message is authoritative.
    const partsWrites = ctx.db.patch.mock.calls.filter(
      ([, patch]: any) => patch && "parts" in patch,
    );
    expect(partsWrites).toHaveLength(0);
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });
});
