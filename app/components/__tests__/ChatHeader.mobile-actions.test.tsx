import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, jest } from "@jest/globals";

const mockSetShareOpen = jest.fn();

jest.mock("@/app/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" }, loading: false }),
}));

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    toggleChatSidebar: jest.fn(),
    initializeNewChat: jest.fn(),
    closeSidebar: jest.fn(),
    setChatSidebarOpen: jest.fn(),
    temporaryChatsEnabled: false,
    setTemporaryChatsEnabled: jest.fn(),
  }),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => true,
}));

jest.mock("@/app/hooks/useChatNavigation", () => ({
  useChatNavigation: () => ({ goHome: jest.fn() }),
}));

jest.mock("@/app/hooks/useTauri", () => ({
  navigateToAuth: jest.fn(),
}));

jest.mock("../ShareDialog", () => ({
  ShareDialog: ({ open }: { open: boolean }) => {
    mockSetShareOpen(open);
    return open ? <div>Share dialog open</div> : null;
  },
}));

const ChatHeader =
  jest.requireActual<typeof import("../ChatHeader")>("../ChatHeader").default;

describe("ChatHeader mobile actions", () => {
  it("keeps Share visible and theme-aware in the mobile header", () => {
    render(
      <ChatHeader
        hasMessages
        hasActiveChat
        id="chat-1"
        chatTitle="Release audit"
        isExistingChat
      />,
    );

    const share = screen.getByRole("button", { name: "Share" });
    expect(share).toHaveClass("hover:bg-accent", "text-foreground");
    expect(share.className).not.toMatch(/max-md:hidden|hover:bg-\[#/);

    fireEvent.click(share);
    expect(screen.getByText("Share dialog open")).toBeInTheDocument();
  });
});
