import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const VALID_SHARE_ID = "123e4567-e89b-12d3-a456-426614174000";
const mockFork = jest.fn();
const mockPush = jest.fn();
const mockToastError = jest.fn();
const mockSetChatSidebarOpen = jest.fn();
let mockIsMobile = false;
let mockChatSidebarOpen = false;

const chat = {
  _id: "convex-chat-id",
  id: "chat-1",
  title: "Shared accessibility review",
  share_id: VALID_SHARE_ID,
  share_date: 1_700_000_000_000,
  update_time: 1_700_000_000_000,
};

jest.mock("convex/react", () => ({
  useMutation: jest.fn(),
  useQuery: jest.fn(),
}));

jest.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mockIsMobile,
}));

jest.mock("@/app/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" }, loading: false }),
}));

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    chatSidebarOpen: mockChatSidebarOpen,
    setChatSidebarOpen: mockSetChatSidebarOpen,
  }),
}));

jest.mock("@/app/contexts/InputContext", () => ({
  useInputValue: () => "Continue from here",
}));

jest.mock("@/app/components/ChatInput", () => ({
  ChatInput: ({ onSubmit }: { onSubmit: (event: React.FormEvent) => void }) => (
    <form onSubmit={onSubmit}>
      <button type="submit">Continue shared chat</button>
    </form>
  ),
}));

jest.mock("../SharedMessages", () => ({
  SharedMessages: () => <div>Shared messages</div>,
}));

jest.mock("@/app/components/ComputerSidebar", () => ({
  ComputerSidebarBase: () => <div>Shared details</div>,
}));

jest.mock("@/app/components/Header", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/app/components/ChatHeader", () => ({
  __esModule: true,
  default: () => <div>Chat header</div>,
}));

jest.mock("@/app/components/Sidebar", () => ({
  __esModule: true,
  default: () => <div>Chat navigation content</div>,
}));

jest.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@/lib/utils/client-storage", () => ({
  upsertDraft: jest.fn(),
}));

const { useMutation, useQuery } = jest.requireMock<{
  useMutation: ReturnType<typeof jest.fn>;
  useQuery: ReturnType<typeof jest.fn>;
}>("convex/react");
const { SharedChatView } =
  jest.requireActual<typeof import("../SharedChatView")>("../SharedChatView");

describe("SharedChatView accessibility", () => {
  beforeEach(() => {
    mockFork.mockReset();
    mockPush.mockReset();
    mockToastError.mockReset();
    mockSetChatSidebarOpen.mockReset();
    mockIsMobile = false;
    mockChatSidebarOpen = false;
    useMutation.mockReturnValue(mockFork);
    useQuery.mockImplementation((_query: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "shareId" in args) return chat;
      if (args && typeof args === "object" && "chatId" in args) {
        return [{ id: "message-1", role: "user", parts: [] }];
      }
      return undefined;
    });
  });

  it("gives invalid links clear recovery navigation", () => {
    render(<SharedChatView shareId="invalid" />);

    expect(
      screen.getByRole("heading", { name: "Invalid share link" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open RIFT" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("surfaces fork failures both inline and through the app toast", async () => {
    mockFork.mockRejectedValueOnce(new Error("offline"));
    render(<SharedChatView shareId={VALID_SHARE_ID} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Continue shared chat" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "RIFT could not create an editable copy",
    );
    expect(mockToastError).toHaveBeenCalledWith(
      "Could not continue this chat",
      expect.objectContaining({
        description: expect.stringContaining("Check your connection"),
      }),
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("exposes exactly one main landmark for a valid shared chat", () => {
    render(<SharedChatView shareId={VALID_SHARE_ID} />);

    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("main")).toHaveTextContent("Shared messages");
  });

  it("renders the mobile chat overlay as a labeled focus-managed dialog", () => {
    mockIsMobile = true;
    mockChatSidebarOpen = true;
    render(<SharedChatView shareId={VALID_SHARE_ID} />);

    const dialog = screen.getByRole("dialog", { name: "Chat navigation" });
    expect(dialog).toHaveAttribute("aria-modal", "true");

    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
    return waitFor(() =>
      expect(mockSetChatSidebarOpen).toHaveBeenCalledWith(false),
    );
  });
});
