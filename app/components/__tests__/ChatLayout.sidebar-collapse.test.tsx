import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChatLayout } from "../ChatLayout";

let mockIsMobile = false;
let mockSidebarOpen = false;
const mockSetChatSidebarOpen = jest.fn();
const mockToggleChatSidebar = jest.fn();

jest.mock("next/dynamic", () => ({
  __esModule: true,
  default: () => () => null,
}));

jest.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mockIsMobile,
}));

jest.mock("@/app/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" }, loading: false }),
}));

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    chatSidebarOpen: mockSidebarOpen,
    setChatSidebarOpen: mockSetChatSidebarOpen,
    toggleChatSidebar: mockToggleChatSidebar,
  }),
}));

jest.mock("@/app/hooks/useChats", () => ({
  useChats: () => ({ loadMore: jest.fn(), results: [], status: "Exhausted" }),
}));

jest.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("../Sidebar", () => ({
  __esModule: true,
  default: () => <div>Full sidebar</div>,
}));

jest.mock("../SidebarUserNav", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("../AppSidebarResizeHandle", () => ({
  AppSidebarResizeHandle: () => null,
}));

jest.mock("@/app/hooks/useResizableAppSidebar", () => ({
  useResizableAppSidebar: () => ({
    width: 272,
    isResizing: false,
    handleProps: {},
  }),
}));

describe("ChatLayout collapsed desktop sidebar", () => {
  beforeEach(() => {
    mockIsMobile = false;
    mockSidebarOpen = false;
    jest.clearAllMocks();
  });

  it("fully unmounts the rail and keeps one native reopen control", () => {
    const view = render(
      <ChatLayout>
        <div>Main content</div>
      </ChatLayout>,
    );

    expect(screen.queryByTestId("sidebar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-rail")).not.toBeInTheDocument();

    const workspace = document.querySelector("[data-rift-workspace]");
    const titlebar = screen.getByTestId("chat-titlebar");
    const reopen = screen.getByTestId("collapsed-sidebar-toggle");
    expect(workspace).toHaveAttribute("data-chat-sidebar-open", "false");
    expect(titlebar).toHaveAttribute("data-tauri-drag-region");
    expect(titlebar).toHaveClass(
      "absolute",
      "inset-x-0",
      "top-0",
      "h-9",
      "pl-[78px]",
      "max-md:pl-3",
      "pointer-events-none",
    );
    expect(titlebar).toContainElement(reopen);
    expect(reopen).toHaveAccessibleName("Open sidebar");
    expect(reopen).toHaveClass(
      "rift-collapsed-sidebar-toggle",
      "pointer-events-auto",
    );

    const mainPanel = document.querySelector("[data-rift-main-panel]");
    expect(mainPanel).not.toHaveClass("pt-9", "pt-[36px]");

    fireEvent.click(reopen);
    expect(mockToggleChatSidebar).toHaveBeenCalledTimes(1);

    mockSidebarOpen = true;
    view.rerender(
      <ChatLayout>
        <div>Main content</div>
      </ChatLayout>,
    );
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(workspace).toHaveAttribute("data-chat-sidebar-open", "true");
    expect(
      screen.queryByTestId("collapsed-sidebar-toggle"),
    ).not.toBeInTheDocument();
  });

  it("keeps the same reopen control available on mobile", () => {
    mockIsMobile = true;
    render(
      <ChatLayout>
        <div>Main content</div>
      </ChatLayout>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open sidebar" }));
    expect(mockToggleChatSidebar).toHaveBeenCalledTimes(1);
  });
});
