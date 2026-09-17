import { fireEvent, render, screen } from "@testing-library/react";
import { MessageSearchDialog } from "../MessageSearchDialog";
jest.mock("convex/react", () => {
  const result = { results: [], status: "Exhausted", loadMore: jest.fn() };
  return { usePaginatedQuery: () => result };
});
jest.mock("@/app/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    setChatSidebarOpen: jest.fn(),
    closeSidebar: jest.fn(),
  }),
}));
jest.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => true }));
jest.mock("@/app/hooks/useChats", () => ({
  useChats: () => ({ results: [], status: "Exhausted" }),
}));
jest.mock("@/app/hooks/useChatNavigation", () => ({
  useChatNavigation: () => ({ goChat: jest.fn() }),
}));
it("lets assistive technology find and dismiss message search", () => {
  const close = jest.fn();
  render(<MessageSearchDialog isOpen onClose={close} />);
  fireEvent.click(screen.getByRole("button", { name: "Close search" }));
  expect(close).toHaveBeenCalledTimes(1);
});
