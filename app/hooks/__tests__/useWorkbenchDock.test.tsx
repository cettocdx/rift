import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  GlobalStateProvider,
  useGlobalState,
} from "@/app/contexts/GlobalState";
import { openAgentActivity, openWorkbench } from "@/lib/workbench/events";
import type { SidebarFile } from "@/types/chat";
import { useWorkbenchDock } from "../useWorkbenchDock";

let mockPathname = "/c/chat-one";
jest.mock("next/navigation", () => ({ usePathname: () => mockPathname }));
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

// Keep the real reactive provider and setters: openSidebar dispatches an
// explicit-open event, while streamed updates intentionally do not.
function wrapper({ children }: { children: ReactNode }) {
  return <GlobalStateProvider>{children}</GlobalStateProvider>;
}
function setup(chatId = "chat-one", enabled = true) {
  return renderHook(
    ({ chatId, enabled }) => ({
      dock: useWorkbenchDock(chatId, enabled),
      global: useGlobalState(),
    }),
    { wrapper, initialProps: { chatId, enabled } },
  );
}
const file: SidebarFile = {
  path: "/app/Sidebar.tsx",
  content: "first",
  toolCallId: "file-call",
  action: "reading",
};

describe("workbench dock entry points and conversation ownership", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockPathname = "/c/chat-one";
  });

  it("activates a file explicitly opened while preview is visible", () => {
    const { result } = setup();
    act(() => {
      result.current.global.setBuildPreviewUrl("https://preview.example");
      result.current.global.setBuildPreviewOpen(true);
    });
    expect(result.current.dock.state.activeTabId).toBe("preview");
    act(() => result.current.global.openSidebar(file));
    expect(result.current.dock.state.activeTabId).toBe("content:file-call");
    expect(result.current.dock.state.tabs.map((tab) => tab.kind)).toEqual([
      "preview",
      "content",
    ]);
    expect(result.current.global.buildPreviewOpen).toBe(false);
    expect(result.current.global.sidebarOpen).toBe(true);
  });

  it("refreshes an already-open file snapshot without stealing browser focus", () => {
    const { result } = setup();
    act(() => result.current.global.openSidebar(file));
    act(() => result.current.dock.openKind("browser"));
    const browserId = result.current.dock.state.activeTabId;
    act(() =>
      result.current.global.updateSidebarContent({
        content: "streamed update",
        isExecuting: false,
      }),
    );
    expect(result.current.dock.state.activeTabId).toBe(browserId);
    expect(
      result.current.dock.state.tabs.find(
        (tab) => tab.id === "content:file-call",
      )?.content,
    ).toMatchObject({ content: "streamed update" });
    expect(result.current.global.sidebarOpen).toBe(false);
  });

  it("reopens the same file after browsing when the user explicitly clicks it again", () => {
    const { result } = setup();
    act(() => result.current.global.openSidebar(file));
    act(() => result.current.dock.openKind("browser"));
    act(() =>
      result.current.global.openSidebar({ ...file, content: "new result" }),
    );
    expect(result.current.dock.state.activeTabId).toBe("content:file-call");
    expect(
      result.current.dock.state.tabs.filter(
        (tab) => tab.id === "content:file-call",
      ),
    ).toHaveLength(1);
  });

  it("hides and restores the selected tab without discarding open tabs", () => {
    const { result } = setup();
    act(() => result.current.dock.openKind("activity"));
    act(() => result.current.dock.openKind("browser"));
    const before = result.current.dock.state;
    act(() => result.current.dock.hide());
    expect(result.current.dock.state.visible).toBe(false);
    expect(result.current.dock.state.tabs).toEqual(before.tabs);
    expect(result.current.dock.state.activeTabId).toBe(before.activeTabId);
    act(() => result.current.dock.toggle());
    expect(result.current.dock.state).toMatchObject({
      visible: true,
      tabs: before.tabs,
      activeTabId: before.activeTabId,
    });
  });

  it("selects the right neighbor then the left neighbor when closing active tabs", () => {
    const { result } = setup();
    act(() => result.current.dock.openKind("activity"));
    act(() => result.current.dock.openKind("browser"));
    const browserId = result.current.dock.state.activeTabId!;
    act(() => result.current.dock.openKind("terminal"));
    act(() => result.current.dock.select(browserId));
    act(() => result.current.dock.close(browserId));
    expect(result.current.dock.state.activeTabId).toBe("terminal");
    expect(result.current.global.terminalDockOpen).toBe(true);
    act(() => result.current.dock.close("terminal"));
    expect(result.current.dock.state.activeTabId).toBe("activity");
    expect(result.current.global.terminalDockOpen).toBe(false);
    act(() => result.current.dock.close("activity"));
    expect(result.current.dock.state).toMatchObject({
      visible: false,
      activeTabId: null,
      tabs: [],
    });
  });

  it("does not change selection when closing an inactive tab", () => {
    const { result } = setup();
    act(() => result.current.dock.openKind("activity"));
    act(() => result.current.dock.openKind("browser"));
    const browserId = result.current.dock.state.activeTabId;
    act(() => result.current.dock.close("activity"));
    expect(result.current.dock.state.activeTabId).toBe(browserId);
    expect(result.current.dock.state.visible).toBe(true);
  });

  it("clears snapshots and selected agent when the actual chat identity changes", () => {
    const { result, rerender } = setup();
    act(() => result.current.global.openSidebar(file));
    act(() => openAgentActivity({ toolCallId: "old-agent-call" }));
    act(() =>
      result.current.dock.dispatch({ type: "placement", placement: "bottom" }),
    );
    act(() => rerender({ chatId: "chat-two", enabled: true }));
    expect(result.current.dock.state).toMatchObject({
      tabs: [],
      visible: false,
      activeTabId: null,
      placement: "bottom",
    });
    expect(result.current.dock.selectedAgent).toBeNull();
  });

  it("preserves the dock when a new chat receives its durable URL with the same identity", () => {
    mockPathname = "/";
    const { result, rerender } = setup("new-chat-id");
    act(() => result.current.global.openSidebar(file));
    act(() => openAgentActivity({ toolCallId: "agent-new-chat" }));
    const before = result.current.dock.state;
    act(() => {
      mockPathname = "/c/new-chat-id";
      rerender({ chatId: "new-chat-id", enabled: true });
    });
    expect(result.current.dock.state).toEqual(before);
    expect(result.current.dock.selectedAgent).toBe("agent-new-chat");
  });

  it("selects the exact historical agent tool requested by a transcript click", () => {
    const { result } = setup();
    act(() => openAgentActivity({ toolCallId: "latest-agent-call" }));
    act(() => result.current.dock.openKind("browser"));
    act(() => openAgentActivity({ toolCallId: "older-agent-call" }));
    expect(result.current.dock.state).toMatchObject({
      visible: true,
      activeTabId: "activity",
    });
    expect(result.current.dock.selectedAgent).toBe("older-agent-call");
  });

  it("opens the terminal from the external workbench event", () => {
    const { result } = setup();
    act(() => result.current.dock.openKind("browser"));
    act(() => openWorkbench({ kind: "terminal" }));
    expect(result.current.dock.state).toMatchObject({
      visible: true,
      activeTabId: "terminal",
    });
    expect(result.current.global.terminalDockOpen).toBe(true);
  });

  it("accepts the legacy terminal-open setter while preview is active", () => {
    const { result } = setup();
    act(() => {
      result.current.global.setBuildPreviewUrl("https://preview.example");
      result.current.global.setBuildPreviewOpen(true);
    });
    act(() => result.current.global.setTerminalDockOpen(true));
    expect(result.current.dock.state.activeTabId).toBe("terminal");
    expect(result.current.global.buildPreviewOpen).toBe(false);
  });

  it("does not handle desktop events after disabling the hook", () => {
    const { result, rerender } = setup();
    act(() => rerender({ chatId: "chat-one", enabled: false }));
    act(() => openAgentActivity({ toolCallId: "not-for-desktop" }));
    expect(result.current.dock.state.tabs).toEqual([]);
    expect(result.current.dock.selectedAgent).toBeNull();
  });

  it("opens the terminal on the right even if other tools were docked below", () => {
    const { result } = setup();
    act(() => result.current.dock.openKind("browser"));
    act(() =>
      result.current.dock.dispatch({ type: "placement", placement: "bottom" }),
    );
    act(() => result.current.dock.openKind("terminal"));
    expect(result.current.dock.state).toMatchObject({
      placement: "right",
      visible: true,
      activeTabId: "terminal",
    });
    act(() => result.current.dock.hide());
    act(() =>
      result.current.dock.dispatch({ type: "placement", placement: "bottom" }),
    );
    act(() => result.current.global.setTerminalDockOpen(true));
    expect(result.current.dock.state).toMatchObject({
      placement: "right",
      visible: true,
      activeTabId: "terminal",
    });
  });

  it("hides and restores the active terminal through the global keyboard toggle without discarding tabs", () => {
    const { result } = setup();
    act(() => result.current.dock.openKind("terminal"));
    const tabs = result.current.dock.state.tabs;
    act(() => result.current.global.toggleTerminalDock());
    expect(result.current.dock.state).toMatchObject({
      visible: false,
      activeTabId: "terminal",
      tabs,
    });
    act(() => result.current.global.toggleTerminalDock());
    expect(result.current.dock.state).toMatchObject({
      visible: true,
      activeTabId: "terminal",
      tabs,
    });
  });

  it("keeps the current non-terminal pane and placement when selecting it from terminal", () => {
    const { result } = setup();
    act(() => result.current.dock.openKind("browser"));
    const browserId = result.current.dock.state.activeTabId!;
    act(() => result.current.dock.openKind("terminal"));
    act(() =>
      result.current.dock.dispatch({ type: "placement", placement: "bottom" }),
    );
    act(() => result.current.dock.select(browserId));
    expect(result.current.global.terminalDockOpen).toBe(false);
    expect(result.current.dock.state).toMatchObject({
      visible: true,
      activeTabId: browserId,
      placement: "bottom",
    });
  });
});
