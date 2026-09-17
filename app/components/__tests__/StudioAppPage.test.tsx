import { render, screen, waitFor } from "@testing-library/react";

import StudioAppPage from "@/app/(chat)/studio/page";

const mockInitializeNewChat = jest.fn();
let mockPurpose: "app" | "image" = "app";
let mockAuthenticated = true;
let mockChatBundleLoading = false;

jest.mock("next/dynamic", () => ({
  __esModule: true,
  default: (_loader: unknown, options: { loading: () => React.ReactNode }) =>
    function LazyStudioChat() {
      return mockChatBundleLoading ? (
        options.loading()
      ) : (
        <div data-testid="studio-chat">Studio chat</div>
      );
    },
}));

jest.mock("convex/react", () => ({
  Authenticated: ({ children }: { children: React.ReactNode }) =>
    mockAuthenticated ? children : null,
  Unauthenticated: ({ children }: { children: React.ReactNode }) =>
    mockAuthenticated ? null : children,
}));

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    chatPurpose: mockPurpose,
    initializeNewChat: mockInitializeNewChat,
  }),
}));

jest.mock("@/app/components/chat", () => ({
  Chat: () => <div data-testid="studio-chat">Studio chat</div>,
}));

jest.mock("@/app/components/landing/LandingPage", () => ({
  LandingPage: ({ authReturnPath }: { authReturnPath?: string }) => (
    <div data-testid="signed-out-studio" data-auth-return-path={authReturnPath}>
      Landing
    </div>
  ),
}));

describe("Studio deep link", () => {
  beforeEach(() => {
    mockPurpose = "app";
    mockAuthenticated = true;
    mockChatBundleLoading = false;
    mockInitializeNewChat.mockClear();
  });

  it("selects the image purpose before mounting the chat surface", async () => {
    render(<StudioAppPage />);

    expect(
      screen.getByRole("status", { name: "Opening Studio" }),
    ).toBeVisible();
    expect(screen.queryByTestId("studio-chat")).not.toBeInTheDocument();
    expect(screen.getByTestId("studio-loading")).toBeVisible();
    await waitFor(() =>
      expect(mockInitializeNewChat).toHaveBeenCalledWith("image"),
    );
  });

  it("renders Studio immediately when the image purpose is already active", async () => {
    mockPurpose = "image";
    render(<StudioAppPage />);

    expect(await screen.findByTestId("studio-chat")).toBeVisible();
    expect(mockInitializeNewChat).not.toHaveBeenCalled();
  });

  it("keeps the same Studio layout while the chat bundle is loading", () => {
    mockPurpose = "image";
    mockChatBundleLoading = true;
    render(<StudioAppPage />);

    expect(screen.getByTestId("studio-loading")).toBeVisible();
    expect(
      screen.getByRole("status", { name: "Opening Studio" }),
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByRole("button")).toBeNull();
    expect(mockInitializeNewChat).not.toHaveBeenCalled();
  });

  it("preserves the Studio destination through its signed-out landing", () => {
    mockAuthenticated = false;
    render(<StudioAppPage />);

    expect(screen.getByTestId("signed-out-studio")).toHaveAttribute(
      "data-auth-return-path",
      "/studio",
    );
    expect(mockInitializeNewChat).not.toHaveBeenCalled();
  });
});
