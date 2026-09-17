import { render, screen, waitFor } from "@testing-library/react";

import BuildAppPage from "@/app/(chat)/page";

const mockInitializeNewChat = jest.fn();
let mockPurpose: "app" | "image" = "image";

jest.mock("convex/react", () => ({
  Authenticated: ({ children }: { children: React.ReactNode }) => children,
  Unauthenticated: () => null,
}));

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    chatPurpose: mockPurpose,
    initializeNewChat: mockInitializeNewChat,
  }),
}));

jest.mock("@/app/components/chat", () => ({
  Chat: () => <div data-testid="build-chat">Build chat</div>,
}));

jest.mock("@/app/components/landing/LandingPage", () => ({
  LandingPage: () => <div>Landing</div>,
}));

describe("Build deep link", () => {
  beforeEach(() => {
    mockPurpose = "image";
    mockInitializeNewChat.mockClear();
  });

  it("selects the Build purpose before mounting the chat surface", async () => {
    render(<BuildAppPage />);

    expect(screen.getByRole("status", { name: "Opening Build" })).toBeVisible();
    expect(screen.queryByTestId("build-chat")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(mockInitializeNewChat).toHaveBeenCalledWith("app"),
    );
  });

  it("renders Build immediately when the app purpose is already active", async () => {
    mockPurpose = "app";
    render(<BuildAppPage />);

    expect(await screen.findByTestId("build-chat")).toBeVisible();
    expect(mockInitializeNewChat).not.toHaveBeenCalled();
  });
});
