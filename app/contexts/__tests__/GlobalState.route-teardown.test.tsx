import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

let mockPathname = "/chat/one";

jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

jest.mock("convex/react", () => ({
  useMutation: () => jest.fn(async () => undefined),
  useQuery: () => undefined,
}));

jest.mock("@/app/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    isAuthenticated: false,
    entitlements: [],
    entitlementsReady: true,
  }),
}));

jest.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

import {
  GlobalStateProvider,
  useGlobalState,
} from "@/app/contexts/GlobalState";

function wrapper({ children }: { children: ReactNode }) {
  return <GlobalStateProvider>{children}</GlobalStateProvider>;
}

describe("route change tears down per-conversation overlays", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockPathname = "/chat/one";
  });

  it("clears the inspector, the agent-activity pane and the terminal dock on navigation", () => {
    const { result, rerender } = renderHook(() => useGlobalState(), {
      wrapper,
    });

    act(() => {
      result.current.setSidebarOpen(true);
      result.current.setSidebarContent({
        type: "terminal",
      } as never);
      result.current.setActiveOperation({ id: "op-1" } as never);
      result.current.setTerminalDockOpen(true);
    });

    expect(result.current.sidebarOpen).toBe(true);
    expect(result.current.activeOperation).not.toBeNull();

    // Navigate to another conversation.
    act(() => {
      mockPathname = "/chat/two";
      rerender();
    });

    expect(result.current.sidebarOpen).toBe(false);
    expect(result.current.sidebarContent).toBeNull();
    expect(result.current.activeOperation).toBeNull();
    expect(result.current.terminalDockOpen).toBe(false);
  });

  it("does not tear down when the route is unchanged", () => {
    const { result, rerender } = renderHook(() => useGlobalState(), {
      wrapper,
    });

    act(() => {
      result.current.setActiveOperation({ id: "op-1" } as never);
    });
    act(() => rerender());

    expect(result.current.activeOperation).not.toBeNull();
  });

  it("does NOT tear down when a new chat is promoted to its durable URL", () => {
    // The killer regression: a new chat gets /c/<id> only after its first run
    // succeeds. That is the same conversation, and tearing it down wipes the
    // agent activity and preview the user just produced, right as the run ends.
    mockPathname = "/";
    const { result, rerender } = renderHook(() => useGlobalState(), { wrapper });

    act(() => {
      result.current.setActiveOperation({ id: "op-1" } as never);
      result.current.setBuildPreviewUrl("https://preview.example");
      result.current.setBuildPreviewOpen(true);
    });

    // Promotion: home -> the same conversation's durable route.
    act(() => {
      mockPathname = "/c/new-chat-id";
      rerender();
    });

    expect(result.current.activeOperation).not.toBeNull();
    expect(result.current.buildPreviewUrl).toBe("https://preview.example");
    expect(result.current.buildPreviewOpen).toBe(true);
  });

  it("tears down when switching between two existing chats", () => {
    mockPathname = "/c/chat-one";
    const { result, rerender } = renderHook(() => useGlobalState(), { wrapper });

    act(() => {
      result.current.setActiveOperation({ id: "op-1" } as never);
      result.current.setSidebarOpen(true);
    });

    act(() => {
      mockPathname = "/c/chat-two";
      rerender();
    });

    expect(result.current.activeOperation).toBeNull();
    expect(result.current.sidebarOpen).toBe(false);
  });

  it("leaves the build preview to initializeChat rather than clearing it on every route change", () => {
    // The preview is owned by initializeChat/initializeNewChat; the teardown
    // clearing it too is what wiped a just-built preview on promotion.
    mockPathname = "/c/chat-one";
    const { result, rerender } = renderHook(() => useGlobalState(), { wrapper });

    act(() => {
      result.current.setBuildPreviewUrl("https://preview.example");
      result.current.setBuildPreviewOpen(true);
    });

    act(() => {
      mockPathname = "/tasks";
      rerender();
    });

    // The teardown no longer touches the preview.
    expect(result.current.buildPreviewOpen).toBe(true);
  });

});
