import {
  normalizeProBasePath,
  proChatRoute,
} from "@/app/components/pro/ProShellContext";
import { chatIdFromPathname, chatPathFor } from "@/app/hooks/useChatNavigation";
import {
  isPurposeChatActive,
  purposeChatPath,
} from "@/lib/navigation/chat-routes";

describe("Pro shell route helpers", () => {
  it.each([
    ["", "/"],
    ["/", "/"],
    ["lab/app", "/lab/app"],
    ["/lab/app/", "/lab/app"],
    ["/workspace/", "/workspace"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeProBasePath(input)).toBe(expected);
  });

  it.each([
    ["", undefined, "/"],
    ["/", undefined, "/"],
    ["/", "chat-1", "/c/chat-1"],
    ["/lab/app", undefined, "/lab/app"],
    ["/lab/app/", "chat-1", "/lab/app/c/chat-1"],
    ["/workspace", undefined, "/workspace"],
    ["/workspace", "chat-1", "/workspace/c/chat-1"],
  ])("builds a route for %s and %s", (basePath, chatId, expected) => {
    expect(proChatRoute(basePath, chatId)).toBe(expected);
  });

  it("keeps standard and workbench chat routes equivalent at the root", () => {
    expect(chatPathFor("/", true, "chat-1")).toBe("/c/chat-1");
    expect(chatPathFor("/", false, "chat-1")).toBe("/c/chat-1");
  });

  it("keeps IDE chat navigation inside the dedicated workspace route", () => {
    expect(chatPathFor("/workspace", true, "chat-1")).toBe(
      "/workspace/c/chat-1",
    );
  });

  it.each([
    ["/", null],
    ["/c/chat-1", "chat-1"],
    ["/workspace/c/chat-2", "chat-2"],
    ["/studio/c/chat-3", "chat-3"],
  ])("reads the active chat id from %s", (pathname, expected) => {
    expect(chatIdFromPathname(pathname)).toBe(expected);
  });

  it.each([
    ["app", undefined, "/"],
    ["app", "chat-1", "/c/chat-1"],
    ["image", undefined, "/studio"],
    ["image", "chat-2", "/studio/c/chat-2"],
  ] as const)(
    "routes %s chats through their canonical surface",
    (purpose, id, expected) => {
      expect(purposeChatPath(purpose, id)).toBe(expected);
    },
  );

  it("keeps workspace selection stable on deep links", () => {
    expect(isPurposeChatActive("app", "/c/chat-1", "app")).toBe(true);
    expect(isPurposeChatActive("image", "/studio/c/chat-2", "app")).toBe(true);
    expect(isPurposeChatActive("app", "/studio/c/chat-2", "app")).toBe(false);
  });
});
