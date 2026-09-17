import { fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceHistoryNavigation } from "../WorkspaceHistoryNavigation";
let mockPathname = "/";
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: mockPush }),
}));
it("returns to an observed route even when a new chat replaced the browser entry", () => {
  const view = render(<WorkspaceHistoryNavigation />);
  expect(screen.getByRole("button", { name: "Go back" })).toBeDisabled();
  mockPathname = "/c/saved-chat";
  view.rerender(<WorkspaceHistoryNavigation />);
  fireEvent.click(screen.getByRole("button", { name: "Go back" }));
  expect(mockPush).toHaveBeenLastCalledWith("/");
  mockPathname = "/";
  view.rerender(<WorkspaceHistoryNavigation />);
  fireEvent.click(screen.getByRole("button", { name: "Go forward" }));
  expect(mockPush).toHaveBeenLastCalledWith("/c/saved-chat");
});
