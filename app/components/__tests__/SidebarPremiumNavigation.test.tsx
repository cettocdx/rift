import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import userEvent from "@testing-library/user-event";
import SidebarHeaderContent from "../SidebarHeader";
import { SidebarProvider } from "@/components/ui/sidebar";
import { openCommandPalette } from "@/lib/utils/command-palette";

const mockRouterPush = jest.fn();
const mockRouterPrefetch = jest.fn();
const mockGoHome = jest.fn();
const mockGoPurpose = jest.fn();
const mockInitializeNewChat = jest.fn();
let mockPathname = "/";
let mockChatPurpose: "app" | "image" = "app";
let mockSubscription: "free" | "pro" | "ultra" = "free";
let mockIsSubscriptionReady = false;
let mockProShell = false;
let mockResolvedTheme = "dark";
const mockSetTheme = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush, prefetch: mockRouterPrefetch }),
  usePathname: () => mockPathname,
}));

jest.mock("next-themes", () => ({
  useTheme: () => ({
    theme: mockResolvedTheme,
    resolvedTheme: mockResolvedTheme,
    setTheme: mockSetTheme,
  }),
}));

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    setChatSidebarOpen: jest.fn(),
    closeSidebar: jest.fn(),
    initializeNewChat: mockInitializeNewChat,
    setTemporaryChatsEnabled: jest.fn(),
    chatPurpose: mockChatPurpose,
    subscription: mockSubscription,
    isSubscriptionReady: mockIsSubscriptionReady,
    toggleChatSidebar: jest.fn(),
  }),
}));

let mockIsMobile = false;
let mockIsDesktopShell = false;
jest.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mockIsMobile,
}));
jest.mock("@/app/hooks/useChats", () => ({
  useChats: () => ({ results: [] }),
}));
jest.mock("@/app/hooks/useTauri", () => ({
  isTauriEnvironment: () => false,
  useIsDesktopShell: () => mockIsDesktopShell,
}));
jest.mock("@/app/hooks/useChatNavigation", () => ({
  useChatNavigation: () => ({
    goHome: mockGoHome,
    goPurpose: mockGoPurpose,
  }),
  chatIdFromPathname: (pathname: string) =>
    pathname.match(/(?:^|\/)c\/([^/]+)(?:\/|$)/)?.[1] ?? null,
}));
jest.mock("@/app/components/pro/ProShellContext", () => ({
  useProShell: () => ({ enabled: mockProShell, basePath: "/" }),
}));
jest.mock("@/lib/utils/command-palette", () => ({
  openCommandPalette: jest.fn(),
}));
jest.mock("../MessageSearchDialog", () => ({
  MessageSearchDialog: () => null,
}));
jest.mock("../SidebarUserNav", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/icons/rift-pixel-mark", () => ({
  RiftPixelMark: () => <span aria-hidden>R</span>,
}));

function renderHeader({
  proShell = false,
  isMobileOverlay = true,
  handleCloseSidebar = jest.fn(),
}: {
  proShell?: boolean;
  isMobileOverlay?: boolean;
  handleCloseSidebar?: jest.Mock;
} = {}) {
  mockProShell = proShell;
  const header = (
    <SidebarHeaderContent
      handleCloseSidebar={handleCloseSidebar}
      isMobileOverlay={isMobileOverlay}
    />
  );
  return render(
    isMobileOverlay ? header : <SidebarProvider>{header}</SidebarProvider>,
  );
}

function expectBefore(earlier: HTMLElement, later: HTMLElement) {
  expect(
    earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
}

function expectOrder(items: HTMLElement[]) {
  items.slice(0, -1).forEach((item, index) => {
    expectBefore(item, items[index + 1]);
  });
}

/**
 * Both shells keep secondary destinations in More. Open it before testing
 * their route actions.
 */
function openMoreFold() {
  const toggle = screen.queryByTestId("sidebar-more-toggle");
  if (toggle?.getAttribute("aria-expanded") === "false")
    fireEvent.click(toggle);
}

function expandedNavigationItems() {
  const pro = mockProShell;
  openMoreFold();
  const byName = (name: string) => screen.getByRole("button", { name });
  const tail = ["Runs", "Tasks", "Plugins", "Artifacts"].map(byName);
  // The two shells order their own nav; this is the order each one renders.
  return pro
    ? [
        byName("Start new chat"),
        byName("Build"),
        byName("Studio"),
        screen.getByTestId("sidebar-hack"),
        byName("Plugins"),
        byName("Agents"),
        byName("Runs"),
        byName("Tasks"),
        byName("Artifacts"),
      ]
    : [
        byName("Start new chat"),
        byName("Build"),
        byName("Studio"),
        screen.getByTestId("sidebar-hack"),
        byName("Agents"),
        ...tail,
      ];
}

describe("premium sidebar navigation readiness", () => {
  beforeEach(() => {
    sessionStorage.clear();
    // The fold is a stored preference, so it leaks between cases unless it is
    // cleared: one test's expanded tail is the next test's missing assertion.
    window.localStorage.clear();
    mockIsMobile = false;
    mockIsDesktopShell = false;
    document.documentElement.dataset.uiSkin = "hack-terminal";
    mockPathname = "/";
    mockChatPurpose = "app";
    mockSubscription = "free";
    mockIsSubscriptionReady = false;
    mockProShell = false;
    mockResolvedTheme = "dark";
    mockSetTheme.mockClear();
    mockRouterPush.mockClear();
    mockRouterPrefetch.mockClear();
    mockGoPurpose.mockClear();
    mockInitializeNewChat.mockClear();
  });

  afterEach(() => {
    cleanup();
    delete document.documentElement.dataset.uiSkin;
  });

  it("keeps expanded premium navigation disabled while access is loading", () => {
    renderHeader();

    const hack = screen.getByTestId("sidebar-hack");

    expect(hack).toBeDisabled();
    expect(hack).toHaveAttribute("aria-busy", "true");
    expect(hack).toHaveAccessibleName(
      "Checking plan access for Hack Workbench",
    );
    // CLI Workspace no longer appears in the sidebar at all.
    expect(screen.queryByTestId("sidebar-workspace")).not.toBeInTheDocument();
    expect(screen.queryByText("Premium")).not.toBeInTheDocument();

    fireEvent.click(hack);
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("prefetches the button-driven Studio route", () => {
    renderHeader();
    expect(mockRouterPrefetch).toHaveBeenCalledWith("/studio");
    expect(mockRouterPrefetch).toHaveBeenCalledWith("/");
  });

  it("navigates across Build and Studio before the destination-owned reset", () => {
    mockChatPurpose = "app";
    mockPathname = "/";
    const expanded = renderHeader();

    fireEvent.click(screen.getByRole("button", { name: "Studio" }));
    expect(mockGoPurpose).toHaveBeenCalledWith("image");
    expect(mockInitializeNewChat).not.toHaveBeenCalled();

    expanded.unmount();
    mockGoPurpose.mockClear();
    mockInitializeNewChat.mockClear();
    mockChatPurpose = "image";
    mockPathname = "/studio";
    renderHeader();

    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    expect(mockGoPurpose).toHaveBeenCalledWith("app");
    expect(mockInitializeNewChat).not.toHaveBeenCalled();
  });

  it("still resets when starting another chat in the active workspace", () => {
    mockChatPurpose = "app";
    mockPathname = "/";
    renderHeader();

    fireEvent.click(screen.getByRole("button", { name: "Start new chat" }));
    expect(mockInitializeNewChat).toHaveBeenCalledWith("app");
    expect(mockGoPurpose).toHaveBeenCalledWith("app");
  });

  it("preserves the conversation when opening the active Build workspace", () => {
    mockPathname = "/c/current-chat";
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    expect(mockInitializeNewChat).not.toHaveBeenCalled();
    expect(mockGoPurpose).not.toHaveBeenCalled();
  });

  it("keeps the RIFT brand at the top-left and routes it home", () => {
    renderHeader();

    const brand = screen.getByRole("button", { name: "RIFT home" });
    expectBefore(brand, screen.getByRole("button", { name: "Build" }));
    fireEvent.click(brand);

    expect(mockGoHome).toHaveBeenCalledTimes(1);
  });

  it("closes the mobile overlay for every standard route navigation", () => {
    mockSubscription = "pro";
    mockIsSubscriptionReady = true;
    const handleCloseSidebar = jest.fn();
    renderHeader({ handleCloseSidebar });

    fireEvent.click(screen.getByRole("button", { name: "RIFT home" }));
    const items = expandedNavigationItems();
    items.forEach((item) => fireEvent.click(item));

    // Derived, not hardcoded: the brand row plus every destination must close
    // the overlay, so a new destination that forgot to fails here rather than
    // shifting a magic number.
    expect(handleCloseSidebar).toHaveBeenCalledTimes(items.length + 1);
  });

  it("closes the mobile overlay for every ProShell route navigation", () => {
    mockSubscription = "pro";
    mockIsSubscriptionReady = true;
    const handleCloseSidebar = jest.fn();
    renderHeader({ proShell: true, handleCloseSidebar });

    // No brand row here: the window already says which app this is.
    expect(screen.queryByRole("button", { name: "RIFT home" })).toBeNull();
    const items = expandedNavigationItems();
    items.forEach((item) => fireEvent.click(item));

    // Derived, not hardcoded: every destination must close the overlay, so a
    // new one that forgot to would fail here rather than shifting a magic
    // number.
    expect(handleCloseSidebar).toHaveBeenCalledTimes(items.length);
  });

  it("does not close the desktop sidebar when its routes navigate", () => {
    mockSubscription = "pro";
    mockIsSubscriptionReady = true;
    const handleCloseSidebar = jest.fn();
    renderHeader({ isMobileOverlay: false, handleCloseSidebar });

    fireEvent.click(screen.getByRole("button", { name: "RIFT home" }));
    expandedNavigationItems().forEach((item) => fireEvent.click(item));

    expect(handleCloseSidebar).not.toHaveBeenCalled();
  });

  it("opens the More fold and highlights the destination when on a folded route", () => {
    // Agents/Tasks/Plugins/Artifacts live in the collapsed fold. A user landing
    // on /tasks used to see nothing selected in the sidebar because the fold
    // stayed shut. The fold must open itself for the active route.
    mockPathname = "/tasks";
    renderHeader({ proShell: true });

    const toggle = screen.getByTestId("sidebar-more-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const tasks = screen.getByRole("button", { name: "Tasks" });
    expect(tasks.getAttribute("aria-current")).toBe("page");
  });

  it("keeps the fold collapsed by default when off every folded route", () => {
    mockPathname = "/";
    renderHeader({ proShell: true });

    expect(
      screen.getByTestId("sidebar-more-toggle").getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.queryByRole("button", { name: "Tasks" })).toBeNull();
  });

  it.each([
    ["web", false],
    ["desktop", true],
  ] as const)(
    "omits Search from the %s More menu",
    (_shell, isDesktopShell) => {
      mockIsDesktopShell = isDesktopShell;
      renderHeader({ proShell: true, isMobileOverlay: false });
      openMoreFold();

      expect(screen.getByRole("button", { name: "Plugins" })).toBeVisible();
      expect(screen.queryByRole("button", { name: "Search chats" })).toBeNull();
    },
  );

  it("keeps mobile Search in More and closes the drawer before opening it", () => {
    mockIsMobile = true;
    const handleCloseSidebar = jest.fn();
    renderHeader({ proShell: true, handleCloseSidebar });
    openMoreFold();

    fireEvent.click(screen.getByRole("button", { name: "Search chats" }));

    expect(handleCloseSidebar).toHaveBeenCalledTimes(1);
    expect(openCommandPalette).toHaveBeenCalledTimes(1);
    expect(handleCloseSidebar.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(openCommandPalette).mock.invocationCallOrder[0],
    );
  });

  it.each([true, false])(
    "lets the current secondary route collapse and reopen More (pro=%s)",
    async (proShell) => {
      const user = userEvent.setup();
      mockPathname = "/plugins";
      renderHeader({ proShell });
      const toggle = screen.getByTestId("sidebar-more-toggle");
      await user.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("button", { name: "Plugins" })).toBeNull();
      expect(toggle).toHaveFocus();
      await user.keyboard("{Enter}");
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("button", { name: "Plugins" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await user.keyboard(" ");
      expect(toggle).toHaveAttribute("aria-expanded", "false");
    },
  );

  it("respects a route's explicit collapse until navigation reveals the next destination", () => {
    mockPathname = "/plugins";
    const { rerender } = renderHeader({ proShell: true });
    fireEvent.click(screen.getByTestId("sidebar-more-toggle"));
    const header = () => (
      <SidebarHeaderContent isMobileOverlay handleCloseSidebar={jest.fn()} />
    );
    rerender(header());
    expect(screen.getByTestId("sidebar-more-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    mockPathname = "/tasks";
    rerender(header());
    expect(screen.getByRole("button", { name: "Tasks" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    mockPathname = "/plugins";
    rerender(header());
    expect(screen.getByRole("button", { name: "Plugins" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("renders on the server without reading navigator", () => {
    const originalNavigator = global.navigator;
    Object.defineProperty(global, "navigator", {
      configurable: true,
      value: undefined,
    });

    try {
      expect(() =>
        renderToString(
          <SidebarHeaderContent
            handleCloseSidebar={jest.fn()}
            isMobileOverlay
          />,
        ),
      ).not.toThrow();
    } finally {
      Object.defineProperty(global, "navigator", {
        configurable: true,
        value: originalNavigator,
      });
    }
  });

  it("enables Hack Workbench for Max", () => {
    mockSubscription = "ultra";
    mockIsSubscriptionReady = true;
    renderHeader();

    const hack = screen.getByTestId("sidebar-hack");

    expect(hack).toBeEnabled();
    expect(hack).toHaveAccessibleName("Open Hack Workbench");

    fireEvent.click(hack);
    expect(mockRouterPush).toHaveBeenNthCalledWith(1, "/hack");
  });

  it("routes Hack Workbench to the Max upgrade for Pro", () => {
    mockSubscription = "pro";
    mockIsSubscriptionReady = true;
    renderHeader();

    const hack = screen.getByTestId("sidebar-hack");

    expect(hack).toHaveAccessibleName("Hack Workbench - Max plan required");

    fireEvent.click(hack);
    expect(mockRouterPush).toHaveBeenNthCalledWith(1, "/upgrade?feature=hack");
  });

  it("routes resolved free users to the matching upgrade flows", () => {
    mockIsSubscriptionReady = true;
    renderHeader();

    fireEvent.click(screen.getByTestId("sidebar-hack"));

    expect(mockRouterPush).toHaveBeenNthCalledWith(1, "/upgrade?feature=hack");
  });

  it("keeps only New chat, Build, Studio and Hack Workbench in the primary section", () => {
    mockIsSubscriptionReady = true;
    renderHeader();

    expect(screen.queryByRole("button", { name: /security chat/i })).toBeNull();
    expect(screen.queryByText("Premium")).not.toBeInTheDocument();
    const items = expandedNavigationItems();
    const primary = screen.getByRole("navigation", {
      name: "Primary workspaces",
    });

    expectOrder(items);
    items.slice(0, 4).forEach((item) => expect(primary).toContainElement(item));
    expect(primary).not.toContainElement(
      screen.getByRole("button", { name: "Agents" }),
    );
    expect(
      screen.getByRole("navigation", { name: "More workspaces" }),
    ).toContainElement(screen.getByRole("button", { name: "Agents" }));
  });

  it("keeps daily entry points visible and secondary workspaces in More", () => {
    mockIsSubscriptionReady = true;
    renderHeader({ proShell: true });

    const primary = screen.getByRole("navigation", {
      name: "Primary workspaces",
    });
    ["Start new chat", "Build", "Studio"].forEach((name) =>
      expect(primary).toContainElement(screen.getByRole("button", { name })),
    );
    expect(primary).toContainElement(screen.getByTestId("sidebar-hack"));
    expect(screen.queryByRole("button", { name: "Plugins" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tasks" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Agents" })).toBeNull();

    const items = expandedNavigationItems();
    expectOrder(items);
    expect(
      screen.getByRole("navigation", { name: "More workspaces" }),
    ).toContainElement(screen.getByRole("button", { name: "Tasks" }));
  });

  it("remembers the ProShell fold across renders", () => {
    mockIsSubscriptionReady = true;
    const first = renderHeader({ proShell: true });
    fireEvent.click(screen.getByTestId("sidebar-more-toggle"));
    expect(screen.getByRole("button", { name: "Tasks" })).toBeInTheDocument();
    first.unmount();

    renderHeader({ proShell: true });
    expect(screen.getByRole("button", { name: "Tasks" })).toBeInTheDocument();
  });

  it.each([
    ["standard", {}],
    ["ProShell", { proShell: true }],
  ] as const)(
    "keeps every %s navigation destination keyboard-focusable",
    (_label, options) => {
      mockIsSubscriptionReady = true;
      renderHeader(options);

      for (const item of expandedNavigationItems()) {
        item.focus();
        expect(item).toHaveFocus();
        expect(item.className).toMatch(/focus-visible:(?:ring|outline)/);
        expect(item).toHaveAttribute("type", "button");
      }

      expect(screen.queryByText("Workspaces")).not.toBeInTheDocument();
    },
  );

  it("marks only the home entry as current on a fresh build", () => {
    mockIsSubscriptionReady = true;
    renderHeader({ proShell: true });
    openMoreFold();

    expect(
      screen.getByRole("button", { name: "Start new chat" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Build" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("exposes the active destination with aria-current", () => {
    mockPathname = "/plugins";
    mockIsSubscriptionReady = true;
    renderHeader();

    const plugins = screen.getByRole("button", { name: "Plugins" });
    expect(plugins).toHaveAttribute("aria-current", "page");
    expect(plugins).not.toHaveAttribute("aria-pressed");
    expect(screen.getByRole("button", { name: "Tasks" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("provides an accessible hydration-safe theme toggle in standard mode", () => {
    renderHeader();

    const toggle = screen.getByRole("button", {
      name: "Switch to light theme",
    });
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    expect(mockSetTheme).toHaveBeenCalledWith("light");
  });

  it("leaves the theme control to the window strip in ProShell", () => {
    // It lives in the strip so it stays reachable with the sidebar shut, which
    // is where both reference windows keep their pair of controls.
    renderHeader({ proShell: true });

    expect(screen.queryByTestId("sidebar-theme-toggle")).toBeNull();
  });

  it("keeps a way out and a theme control in the ProShell mobile drawer", () => {
    // The strip that carries both is hidden at this width. Without them the
    // drawer's only exit is the scrim and the theme control has no home.
    mockIsMobile = true;
    const handleCloseSidebar = jest.fn();
    renderHeader({ proShell: true, handleCloseSidebar });

    expect(screen.getByTestId("sidebar-theme-toggle")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close navigation" }));
    expect(handleCloseSidebar).toHaveBeenCalledTimes(1);
  });
});
