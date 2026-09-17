import { act, renderHook } from "@testing-library/react";
import { useChatNavigation } from "../useChatNavigation";

const push = jest.fn();
const replace = jest.fn();
const setBuildPreviewOpen = jest.fn();
const setBuildPreviewUrl = jest.fn();
let proShell = { enabled: true, basePath: "/workspace" };
let chatPurpose = "app";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
}));

jest.mock("@/app/components/pro/ProShellContext", () => ({
  proChatRoute: (basePath: string, chatId?: string | null) =>
    chatId ? `${basePath}/c/${chatId}` : basePath,
  useProShell: () => proShell,
}));

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    chatPurpose,
    setBuildPreviewOpen,
    setBuildPreviewUrl,
  }),
}));

describe("useChatNavigation preview isolation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    proShell = { enabled: true, basePath: "/workspace" };
    chatPurpose = "app";
  });

  it("clears an exposed preview before navigating to another chat", () => {
    const { result } = renderHook(() => useChatNavigation());

    act(() => result.current.goChat("next-chat"));

    expect(setBuildPreviewOpen).toHaveBeenCalledWith(false);
    expect(setBuildPreviewUrl).toHaveBeenCalledWith(null);
    expect(push).toHaveBeenCalledWith("/workspace/c/next-chat");
  });

  it("loads the durable route when promoting a completed new chat", () => {
    const { result } = renderHook(() => useChatNavigation());

    act(() => result.current.replaceChatUrl("completed-chat"));

    expect(replace).toHaveBeenCalledWith("/workspace/c/completed-chat", {
      scroll: false,
    });
  });

  it("keeps a completed Media Studio run on its Studio conversation route", () => {
    proShell = { enabled: false, basePath: "/" };
    chatPurpose = "image";
    const { result } = renderHook(() => useChatNavigation());

    act(() => result.current.replaceChatUrl("completed-video"));

    expect(replace).toHaveBeenCalledWith("/studio/c/completed-video", {
      scroll: false,
    });
  });
});
