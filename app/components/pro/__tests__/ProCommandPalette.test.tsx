import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ProCommandPalette } from "../ProCommandPalette";

const goChat = jest.fn();
const routerPush = jest.fn();
const mockToggleTerminalDock = jest.fn();
let mockChats: Array<{ id: string; title: string }> = [];
let mockIndexedChats: Array<{ id: string; title: string }> = [];
let mockOpenPaletteListener: ((detail: { query?: string }) => void) | undefined;

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
    goPurpose: jest.fn(),
    goChat,
  }),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
  usePathname: () => "/",
}));

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    chatPurpose: "app",
    toggleChatSidebar: jest.fn(),
    initializeNewChat: jest.fn(),
    closeSidebar: jest.fn(),
    sidebarOpen: false,
    setSidebarOpen: jest.fn(),
    sidebarContent: null,
    setChatSidebarOpen: jest.fn(),
    toggleTerminalDock: mockToggleTerminalDock,
  }),
}));

jest.mock("@/lib/utils/command-palette", () => ({
  onOpenCommandPalette: (callback: (detail: { query?: string }) => void) => {
    mockOpenPaletteListener = callback;
    return () => {
      mockOpenPaletteListener = undefined;
    };
  },
}));

jest.mock("../ProShortcutsDialog", () => ({
  openShortcutsDialog: jest.fn(),
}));

// The palette no longer listens for chords of its own — the shell's keyboard
// hook owns them and dispatches through this event, so opening it in a test
// goes through the same door the shortcut uses.
describe("ProCommandPalette", () => {
  beforeEach(() => {
    mockOpenPaletteListener = undefined;
    mockChats = Array.from({ length: 12 }, (_, index) => ({
      id: `chat-${index + 1}`,
      title: index === 10 ? "Needle assessment" : `Session ${index + 1}`,
    }));
    mockIndexedChats = [];
    mockToggleTerminalDock.mockClear();
  });

  it("starts with the /resume query supplied by the slash runtime", async () => {
    render(<ProCommandPalette />);

    act(() => mockOpenPaletteListener?.({ query: "Needle" }));

    expect(
      await screen.findByPlaceholderText("Search chats, actions, navigation…"),
    ).toHaveValue("Needle");
    expect(await screen.findByText("Needle assessment")).toBeInTheDocument();
  });

  it("keeps the idle history compact but searches every loaded chat", async () => {
    render(<ProCommandPalette />);

    act(() => mockOpenPaletteListener?.({}));

    expect(await screen.findByText("Session 8")).toBeInTheDocument();
    expect(screen.queryByText("Needle assessment")).not.toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText("Search chats, actions, navigation…"),
      { target: { value: "Needle" } },
    );

    expect(await screen.findByText("Needle assessment")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Chats" })).toBeInTheDocument();
  });

  it("opens a matching chat beyond the recent eight", async () => {
    render(<ProCommandPalette />);

    act(() => mockOpenPaletteListener?.({}));
    fireEvent.change(
      await screen.findByPlaceholderText("Search chats, actions, navigation…"),
      { target: { value: "Needle" } },
    );
    fireEvent.click(await screen.findByText("Needle assessment"));

    await waitFor(() => expect(goChat).toHaveBeenCalledWith("chat-11"));
  });

  it("opens the terminal dock in place rather than navigating away", async () => {
    render(<ProCommandPalette />);

    act(() => mockOpenPaletteListener?.({}));
    fireEvent.click(await screen.findByText("Open terminal"));

    // Same behaviour as ⌘J: the shell arrives without losing the page the
    // operator opened it from.
    await waitFor(() =>
      expect(mockToggleTerminalDock).toHaveBeenCalledTimes(1),
    );
    expect(routerPush).not.toHaveBeenCalledWith("/workspace?terminal=focus");
  });

  it("finds a server-indexed chat that is not in loaded sidebar pages", async () => {
    mockIndexedChats = [
      { id: "chat-archived-page", title: "Deep archive assessment" },
    ];
    render(<ProCommandPalette />);

    act(() => mockOpenPaletteListener?.({}));
    fireEvent.change(
      await screen.findByPlaceholderText("Search chats, actions, navigation…"),
      { target: { value: "Deep archive" } },
    );
    fireEvent.click(await screen.findByText("Deep archive assessment"));

    await waitFor(() =>
      expect(goChat).toHaveBeenCalledWith("chat-archived-page"),
    );
  });
});
