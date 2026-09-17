import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

const mockMutation = jest.fn();
jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/convex/_generated/api", () => ({
  api: {
    chats: { updateChat: "chats:updateChat" },
    chatStreams: { prepareForNewStream: "chatStreams:prepareForNewStream" },
  },
}));
jest.mock("../convex-client", () => ({
  ...jest.requireActual<typeof import("../convex-client")>("../convex-client"),
  getConvexClient: () => ({ mutation: mockMutation }),
  setConvexUrl: jest.fn(),
}));

let updateChat: typeof import("../actions").updateChat;
let prepareForNewStream: typeof import("../actions").prepareForNewStream;
beforeAll(async () => {
  ({ updateChat, prepareForNewStream } = await import("../actions"));
});
beforeEach(() => {
  mockMutation.mockReset().mockResolvedValue(null as never);
});

describe("Trigger run guard forwarding", () => {
  it.each(["updateChat", "prepareForNewStream"])(
    "forwards the expected run for %s",
    async (name) => {
      const action = name === "updateChat" ? updateChat : prepareForNewStream;
      await action({ chatId: "chat-1", expectedTriggerRunId: "run-current" });
      expect(mockMutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          chatId: "chat-1",
          expectedTriggerRunId: "run-current",
        }),
      );
    },
  );

  it.each(["updateChat", "prepareForNewStream"])(
    "keeps %s callable without a run guard",
    async (name) => {
      const action = name === "updateChat" ? updateChat : prepareForNewStream;
      await expect(action({ chatId: "chat-1" })).resolves.not.toThrow();
      expect(mockMutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ chatId: "chat-1" }),
      );
      expect(mockMutation.mock.calls[0]?.[1]).not.toHaveProperty(
        "expectedTriggerRunId",
        expect.any(String),
      );
    },
  );
});
