import { StrictMode } from "react";
import { renderHook } from "@testing-library/react";
import {
  useDesktopLastChat,
  createDesktopChatNavigationSession,
} from "../useDesktopLastChat";

let mockPath = "/";
let mockNative = true;
const mockReplace = jest.fn();
const mockRouter = { replace: mockReplace };
jest.mock("next/navigation", () => ({
  usePathname: () => mockPath,
  useRouter: () => mockRouter,
}));
jest.mock("@/app/hooks/useTauri", () => ({
  isTauriEnvironment: () => mockNative,
}));
let session = createDesktopChatNavigationSession("/");
const key = (owner: string) => `rift:desktop:last-chat:${owner}`;
beforeEach(() => {
  session = createDesktopChatNavigationSession("/");
  mockPath = "/";
  mockNative = true;
  mockReplace.mockReset();
  localStorage.clear();
  history.replaceState(null, "", "/");
});

it("restores a native cold launch once, retaining its saved route during strict effects", () => {
  localStorage.setItem(key("alice"), "/c/chat-one");
  renderHook(() => useDesktopLastChat("alice", session), {
    wrapper: StrictMode,
  });
  expect(mockReplace).toHaveBeenCalledTimes(1);
  expect(mockReplace).toHaveBeenCalledWith("/c/chat-one");
  expect(localStorage.getItem(key("alice"))).toBe("/c/chat-one");
});

it("keeps explicit New chat after restoration", () => {
  localStorage.setItem(key("alice"), "/c/chat-one");
  const view = renderHook(() => useDesktopLastChat("alice", session));
  mockPath = "/c/chat-one";
  view.rerender();
  mockPath = "/";
  view.rerender();
  expect(localStorage.getItem(key("alice"))).toBe("/");
  expect(mockReplace).toHaveBeenCalledTimes(1);
});

it("never redirects a browser or explicit deep link", () => {
  localStorage.setItem(key("alice"), "/c/chat-one");
  mockNative = false;
  const view = renderHook(() => useDesktopLastChat("alice", session));
  mockNative = true;
  mockPath = "/c/explicit-link";
  view.rerender();
  expect(mockReplace).not.toHaveBeenCalled();
});

it("does not read another owner's route while auth is unresolved", () => {
  localStorage.setItem(key("alice"), "/c/alice-chat");
  const view = renderHook(({ owner }) => useDesktopLastChat(owner, session), {
    initialProps: { owner: undefined as string | undefined },
  });
  expect(mockReplace).not.toHaveBeenCalled();
  view.rerender({ owner: "bob" });
  expect(mockReplace).not.toHaveBeenCalled();
  expect(localStorage.getItem(key("alice"))).toBe("/c/alice-chat");
});

it.each([
  "https://evil.example",
  "//evil.example",
  "/c/one?token=secret",
  "/settings",
])("rejects unsafe or non-chat saved location %s", (saved) => {
  localStorage.setItem(key("alice"), saved);
  renderHook(() => useDesktopLastChat("alice", session));
  expect(mockReplace).not.toHaveBeenCalled();
});

it("honors an explicit search on the launch URL", () => {
  history.replaceState(null, "", "/?new=1");
  localStorage.setItem(key("alice"), "/c/chat-one");
  renderHook(() => useDesktopLastChat("alice", session));
  expect(mockReplace).not.toHaveBeenCalled();
});

it("does not copy the mounted old-account route into a new account", () => {
  mockPath = "/c/alice-chat";
  const view = renderHook(({ owner }) => useDesktopLastChat(owner, session), {
    initialProps: { owner: "alice" },
  });
  view.rerender({ owner: "bob" });
  expect(localStorage.getItem(key("bob"))).toBeNull();
});

it("keeps navigation usable when storage is unavailable", () => {
  const spy = jest
    .spyOn(Storage.prototype, "getItem")
    .mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
  expect(() =>
    renderHook(() => useDesktopLastChat("alice", session)),
  ).not.toThrow();
  expect(mockReplace).not.toHaveBeenCalled();
  spy.mockRestore();
});

it("does not mistake a route-group remount for another app launch", () => {
  mockPath = "/c/chat-one";
  const first = renderHook(() => useDesktopLastChat("alice", session));
  first.unmount();
  mockPath = "/";
  renderHook(() => useDesktopLastChat("alice", session));
  expect(mockReplace).not.toHaveBeenCalled();
  expect(localStorage.getItem(key("alice"))).toBe("/");
});

it("remembers an initial authenticated deep link for the next launch", () => {
  localStorage.setItem(key("alice"), "/c/older");
  mockPath = "/c/deep-link";
  renderHook(() => useDesktopLastChat("alice", session));
  expect(localStorage.getItem(key("alice"))).toBe("/c/deep-link");
  expect(mockReplace).not.toHaveBeenCalled();
});

it("does not restore when the document launched outside chat", () => {
  session = createDesktopChatNavigationSession("/workspace");
  localStorage.setItem(key("alice"), "/c/older");
  renderHook(() => useDesktopLastChat("alice", session));
  expect(mockReplace).not.toHaveBeenCalled();
  expect(localStorage.getItem(key("alice"))).toBe("/");
});
