import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { ConversationRoute } from "@/app/(chat)/c/[id]/page";
import { StudioConversationRoute } from "@/app/(chat)/studio/c/[id]/page";

let mockAuthState: "loading" | "authenticated" | "unauthenticated" =
  "unauthenticated";

jest.mock("convex/react", () => ({
  AuthLoading: ({ children }: { children: ReactNode }) =>
    mockAuthState === "loading" ? children : null,
  Authenticated: ({ children }: { children: ReactNode }) =>
    mockAuthState === "authenticated" ? children : null,
  Unauthenticated: ({ children }: { children: ReactNode }) =>
    mockAuthState === "unauthenticated" ? children : null,
}));

jest.mock("@/app/components/chat", () => ({
  Chat: ({ autoResume }: { autoResume: boolean }) => (
    <div data-testid="chat" data-auto-resume={String(autoResume)} />
  ),
}));

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    chatPurpose: "image",
    setChatPurpose: jest.fn(),
  }),
}));

describe("conversation route authentication surfaces", () => {
  afterEach(() => cleanup());

  it.each([
    ["Build conversation", <ConversationRoute key="build" chatId="chat-1" />],
    [
      "Studio conversation",
      <StudioConversationRoute key="studio" chatId="chat-2" />,
    ],
  ])(
    "shows a finite sign-in surface for an unauthenticated %s",
    (_name, route) => {
      mockAuthState = "unauthenticated";
      render(route);

      expect(
        screen.getByRole("heading", { name: /Sign in to open/i }),
      ).toBeVisible();
      expect(screen.getByRole("link", { name: "Go to sign in" })).toBeVisible();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    },
  );

  it("renders the requested conversation after authentication", () => {
    mockAuthState = "authenticated";
    render(<ConversationRoute chatId="chat-1" />);

    expect(screen.getByTestId("chat")).toHaveAttribute(
      "data-auto-resume",
      "true",
    );
  });
});
