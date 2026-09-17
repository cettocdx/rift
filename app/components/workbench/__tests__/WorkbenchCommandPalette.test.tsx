import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

let mockOpenPaletteListener: ((detail: { query?: string }) => void) | undefined;
import { WorkbenchCommandPalette } from "../WorkbenchCommandPalette";

const mockGoChat = jest.fn();
let mockChats: Array<{ id: string; title: string }> = [];
let mockIndexedChats: Array<{ id: string; title: string }> = [];

Object.defineProperty(global, "ResizeObserver", {
  writable: true,
  value: class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});

Object.defineProperty(Element.prototype, "scrollIntoView", {
  writable: true,
  value: jest.fn(),
});

jest.mock("@/app/hooks/useChats", () => ({
  useChats: () => ({ results: mockChats }),
  useChatTitleSearch: () => mockIndexedChats,
}));

jest.mock("@/app/hooks/useChatNavigation", () => ({
  useChatNavigation: () => ({
    goHome: jest.fn(),
    goChat: mockGoChat,
  }),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    initializeNewChat: jest.fn(),
    closeSidebar: jest.fn(),
  }),
}));

jest.mock("../WorkbenchProvider", () => ({
  useWorkbench: () => ({
    state: {
      activePath: null,
      documents: {},
      sidebarView: "explorer",
    },
    actions: {
      toggleSidebar: jest.fn(),
      toggleAgentPane: jest.fn(),
      toggleBottomPanel: jest.fn(),
      saveActiveDocument: jest.fn(),
      selectSidebarView: jest.fn(),
      refreshGit: jest.fn(),
      loadDirectory: jest.fn(),
      confirmNavigation: () => true,
    },
  }),
}));

jest.mock("@/lib/utils/command-palette", () => ({
  // The palette no longer listens for chords of its own — the workspace's
  // keyboard hook owns them and dispatches through this event, so opening it
  // in a test goes through the same door the shortcut uses.
  onOpenCommandPalette: (callback: (detail: { query?: string }) => void) => {
    mockOpenPaletteListener = callback;
    return () => {
      mockOpenPaletteListener = undefined;
    };
  },
}));

jest.mock("@/app/components/pro/ProShortcutsDialog", () => ({
  openShortcutsDialog: jest.fn(),
}));

describe("WorkbenchCommandPalette", () => {
  beforeEach(() => {
    mockChats = Array.from({ length: 12 }, (_, index) => ({
      id: `chat-${index + 1}`,
      title: index === 10 ? "Needle assessment" : `Session ${index + 1}`,
    }));
    mockIndexedChats = [];
  });

  it("keeps idle history compact but searches every loaded session", async () => {
    render(<WorkbenchCommandPalette />);

    act(() => mockOpenPaletteListener?.({}));

    expect(await screen.findByText("Session 8")).toBeInTheDocument();
    expect(screen.queryByText("Needle assessment")).not.toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText("Search workbench actions and chats…"),
      { target: { value: "Needle" } },
    );

    expect(await screen.findByText("Needle assessment")).toBeInTheDocument();
    expect(screen.getByText("Agent sessions")).toBeInTheDocument();
  });

  it("opens a matching session beyond the recent eight", async () => {
    render(<WorkbenchCommandPalette />);

    act(() => mockOpenPaletteListener?.({}));
    fireEvent.change(
      await screen.findByPlaceholderText("Search workbench actions and chats…"),
      { target: { value: "Needle" } },
    );
    fireEvent.click(await screen.findByText("Needle assessment"));

    await waitFor(() => expect(mockGoChat).toHaveBeenCalledWith("chat-11"));
  });

  it("finds a server-indexed session outside loaded sidebar pages", async () => {
    mockIndexedChats = [
      { id: "chat-archive", title: "Deep archive assessment" },
    ];
    render(<WorkbenchCommandPalette />);

    act(() => mockOpenPaletteListener?.({}));
    fireEvent.change(
      await screen.findByPlaceholderText("Search workbench actions and chats…"),
      { target: { value: "Deep archive" } },
    );
    fireEvent.click(await screen.findByText("Deep archive assessment"));

    await waitFor(() =>
      expect(mockGoChat).toHaveBeenCalledWith("chat-archive"),
    );
  });
});
