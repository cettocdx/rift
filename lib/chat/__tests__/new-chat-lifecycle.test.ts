import { chatRouteKey, shouldPromoteNewChatRoute } from "../new-chat-lifecycle";

const successfulNewChat = {
  isExistingChat: false,
  isTemporaryChat: false,
  isAbort: false,
  isDisconnect: false,
  isError: false,
};

describe("chat route identity", () => {
  it("is stable while the URL does not change", () => {
    // The guard this backs is what keeps a re-run of the URL sync — StrictMode
    // or a suspend/resume during submit — from minting a new chat id and
    // dropping the message the user just sent.
    expect(chatRouteKey("/", undefined)).toBe(chatRouteKey("/", undefined));
    expect(chatRouteKey("/c/abc", "abc")).toBe(chatRouteKey("/c/abc", "abc"));
  });

  it("changes when the conversation changes", () => {
    expect(chatRouteKey("/", undefined)).not.toBe(chatRouteKey("/c/abc", "abc"));
    expect(chatRouteKey("/c/abc", "abc")).not.toBe(
      chatRouteKey("/c/def", "def"),
    );
  });

  it("separates a new chat from a conversation route on the same path", () => {
    // Studio and Build both mount Chat under a prefix; only the id decides
    // whether this is a fresh conversation or an existing one.
    expect(chatRouteKey("/studio", undefined)).not.toBe(
      chatRouteKey("/studio", "abc"),
    );
  });

  it("treats a missing id and an empty id alike", () => {
    expect(chatRouteKey("/", null)).toBe(chatRouteKey("/", undefined));
  });
});

describe("new chat route lifecycle", () => {
  it("promotes a durable new chat only after a successful response", () => {
    expect(shouldPromoteNewChatRoute(successfulNewChat)).toBe(true);
  });

  it.each([
    ["provider error", { isError: true }],
    ["disconnect", { isDisconnect: true }],
    ["user abort", { isAbort: true }],
    ["temporary chat", { isTemporaryChat: true }],
    ["existing chat", { isExistingChat: true }],
  ])("keeps the current page mounted after %s", (_label, patch) => {
    expect(shouldPromoteNewChatRoute({ ...successfulNewChat, ...patch })).toBe(
      false,
    );
  });
});
