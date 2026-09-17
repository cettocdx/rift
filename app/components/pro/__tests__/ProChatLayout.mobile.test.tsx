import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { getProMobilePage, ProChatLayout } from "../ProChatLayout";

let mockPathname = "/plugins";
let mockQuery = "";
let mockSidebarOpen = false;
let mockIsMobile = true;
const mockSetChatSidebarOpen = jest.fn((open: boolean) => {
  mockSidebarOpen = open;
});
const mockInitializeNewChat = jest.fn();
const mockSetTemporaryChatsEnabled = jest.fn();
const mockGoPurpose = jest.fn();

jest.mock("next/dynamic", () => ({
  __esModule: true,
  default: () =>
    function SettingsDialogStub() {
      return null;
    },
}));

jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(mockQuery),
  // The shell now mounts the settings navigation bridge, which routes rather
  // than opening a dialog.
  useRouter: () => ({ push: jest.fn(), prefetch: jest.fn() }),
}));

jest.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mockIsMobile,
}));

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    chatPurpose: "app",
    chatSidebarOpen: mockSidebarOpen,
    initializeNewChat: mockInitializeNewChat,
    setChatSidebarOpen: mockSetChatSidebarOpen,
    setTemporaryChatsEnabled: mockSetTemporaryChatsEnabled,
  }),
}));

jest.mock("@/app/hooks/useChatNavigation", () => ({
  useChatNavigation: () => ({ goPurpose: mockGoPurpose }),
}));

jest.mock("@/app/hooks/useChats", () => ({
  useChats: () => ({
    loadMore: jest.fn(),
    results: [],
    status: "Exhausted",
  }),
}));

jest.mock("../../Sidebar", () => ({
  __esModule: true,
  default: () => <button type="button">Drawer destination</button>,
}));

jest.mock("../../SidebarUserNav", () => ({
  __esModule: true,
  default: () => null,
}));

// The persistent terminal host has its own observer/lifetime tests. These
// tests exercise the shell's navigation and mobile drawer boundaries.
jest.mock("../../terminal/TerminalDock", () => ({ TerminalDock: () => null }));

jest.mock("../ProCommandPalette", () => ({
  ProCommandPalette: () => null,
}));

jest.mock("../ProShortcutsDialog", () => ({
  ProShortcutsDialog: () => null,
}));

jest.mock("../useProKeyboardShortcuts", () => ({
  useProKeyboardShortcuts: () => undefined,
}));

describe("ProChatLayout mobile shell", () => {
  beforeEach(() => {
    mockPathname = "/plugins";
    mockQuery = "";
    mockSidebarOpen = false;
    mockIsMobile = true;
    jest.clearAllMocks();
  });

  it("remembers query-only navigation when returning from settings", () => {
    const view = render(<ProChatLayout>Page</ProChatLayout>);
    mockQuery = "tab=skills";
    view.rerender(<ProChatLayout>Page</ProChatLayout>);
    mockPathname = "/settings";
    mockQuery = "";
    view.rerender(<ProChatLayout>Settings</ProChatLayout>);
    expect(sessionStorage.getItem("rift:settings-return")).toBe(
      "/plugins?tab=skills",
    );
  });

  it.each([true, false])(
    "closes a route-changing drawer only on mobile (%s)",
    (mobile) => {
      mockIsMobile = mobile;
      mockSidebarOpen = true;
      const view = render(<ProChatLayout>Plugins</ProChatLayout>);
      mockSetChatSidebarOpen.mockClear();
      mockPathname = "/settings";
      view.rerender(<ProChatLayout>Settings</ProChatLayout>);
      if (mobile) expect(mockSetChatSidebarOpen).toHaveBeenCalledWith(false);
      else expect(mockSetChatSidebarOpen).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["/", "Build", "app"],
    ["/c/chat-1", "Build", "app"],
    ["/studio", "Studio", "image"],
    ["/studio/c/chat-2", "Studio", "image"],
    ["/agents", "Agents", undefined],
    ["/settings/appearance", "Settings", undefined],
    ["/artifacts", "Artifacts", undefined],
    ["/plugins", "Plugins", undefined],
    ["/tasks", "Tasks", undefined],
    ["/notebook", "Notebook", undefined],
  ])("maps %s to its mobile page title", (pathname, title, purpose) => {
    expect(getProMobilePage(pathname)).toEqual({
      title,
      ...(purpose ? { primaryPurpose: purpose } : {}),
    });
  });

  it("renders a 52px safe-area app bar with a 44px navigation trigger", () => {
    render(
      <ProChatLayout>
        <div>Page content</div>
      </ProChatLayout>,
    );

    const appBar = document.querySelector("[data-pro-mobile-app-bar]");
    const menu = screen.getByRole("button", { name: "Open navigation" });

    expect(appBar).toHaveClass("pt-[env(safe-area-inset-top)]");
    expect(appBar?.firstElementChild).toHaveClass("h-[52px]");
    expect(menu).toHaveClass("size-11");
    expect(screen.getByTestId("pro-mobile-page-title")).toHaveTextContent(
      "Plugins",
    );
  });

  it("opens the existing navigation in an accessible drawer with safe-area spacing", () => {
    const view = render(
      <ProChatLayout>
        <div>Page content</div>
      </ProChatLayout>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(mockSetChatSidebarOpen).toHaveBeenCalledWith(true);

    view.rerender(
      <ProChatLayout>
        <div>Page content</div>
      </ProChatLayout>,
    );

    const drawer = screen.getByRole("dialog", { name: "Navigation" });
    expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(drawer).toHaveAttribute("data-mobile-navigation-drawer");
    expect(drawer).toHaveClass("h-full", "pb-[env(safe-area-inset-bottom)]");
    expect(
      screen.getByRole("button", { name: "Drawer destination" }),
    ).toBeVisible();
  });

  it("starts a fresh Studio creation from the route-aware primary action", () => {
    mockPathname = "/studio";
    render(
      <ProChatLayout>
        <div>Studio content</div>
      </ProChatLayout>,
    );

    expect(screen.getByTestId("pro-mobile-page-title")).toHaveTextContent(
      "Studio",
    );
    const primary = screen.getByRole("button", {
      name: "Start a new Studio creation",
    });
    expect(primary).toHaveClass("size-11");

    fireEvent.click(primary);
    expect(mockInitializeNewChat).toHaveBeenCalledWith("image");
    expect(mockSetTemporaryChatsEnabled).toHaveBeenCalledWith(false);
    expect(mockGoPurpose).toHaveBeenCalledWith("image");
  });

  it("fully closes the desktop sidebar and keeps one native reopen control", () => {
    mockIsMobile = false;
    const view = render(
      <ProChatLayout>
        <div>Desktop content</div>
      </ProChatLayout>,
    );

    expect(screen.queryByTestId("sidebar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-rail")).not.toBeInTheDocument();

    const dragStrip = document.querySelector(
      '[data-rift-native-titlebar="window"]',
    );
    expect(dragStrip).toHaveAttribute("data-tauri-drag-region");
    expect(dragStrip).toBeInTheDocument();

    const openSidebar = screen.getByTestId("collapsed-sidebar-toggle");
    expect(dragStrip).toContainElement(openSidebar);
    expect(openSidebar).toHaveClass("rift-collapsed-sidebar-toggle");
    expect(document.querySelector("[data-pro-workbench]")).toHaveAttribute(
      "data-chat-sidebar-open",
      "false",
    );

    fireEvent.click(openSidebar);
    expect(mockSetChatSidebarOpen).toHaveBeenCalledWith(true);

    view.rerender(
      <ProChatLayout>
        <div>Desktop content</div>
      </ProChatLayout>,
    );
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open sidebar" }),
    ).not.toBeInTheDocument();
  });
});

it("uses the settings rail without duplicating workspace navigation", () => {
  mockIsMobile = false;
  mockSidebarOpen = true;
  mockPathname = "/settings/appearance";
  render(
    <ProChatLayout>
      <div>Settings content</div>
    </ProChatLayout>,
  );
  expect(screen.queryByTestId("sidebar")).not.toBeInTheDocument();
  expect(screen.getByText("Settings content")).toBeVisible();
});

it("makes the closing drawer inert and removes it after its exit transition", () => {
  jest.useFakeTimers();
  mockIsMobile = true;
  mockSidebarOpen = true;
  mockPathname = "/";
  try {
    const view = render(<ProChatLayout>Chat</ProChatLayout>);
    expect(
      screen.getByRole("dialog", { name: "Navigation" }),
    ).toBeInTheDocument();
    mockSidebarOpen = false;
    view.rerender(<ProChatLayout>Chat</ProChatLayout>);
    const overlay = document.querySelector("[data-mobile-navigation-overlay]");
    expect(overlay).toHaveAttribute("data-state", "closed");
    expect(overlay).toHaveAttribute("inert");
    expect(
      screen.queryByRole("dialog", { name: "Navigation" }),
    ).not.toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(
      document.querySelector("[data-mobile-navigation-overlay]"),
    ).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});
