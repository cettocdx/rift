import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentsWorkbench } from "../AgentsWorkbench";

jest.mock("convex/react", () => ({
  useMutation: () => jest.fn(),
  useQuery: () => [],
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({ initializeNewChat: jest.fn(), subscription: "pro" }),
}));
jest.mock("@/app/contexts/InputContext", () => ({
  useInputApi: () => ({ setInput: jest.fn() }),
}));
jest.mock("sonner", () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

beforeEach(() => window.localStorage.clear());

it("keeps one tab stop and switches labelled panels with arrows, Home and End", async () => {
  const user = userEvent.setup();
  render(<AgentsWorkbench />);
  const tablist = await screen.findByRole("tablist", { name: "Agent views" });
  const tabs = within(tablist).getAllByRole("tab");
  const [roster, catalog, teams] = tabs;

  const expectActive = (tab: HTMLElement) => {
    expect(tab).toHaveFocus();
    expect(tabs.filter((item) => item.tabIndex === 0)).toEqual([tab]);
    expect(tab).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel");
    expect(tab).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", tab.id);
  };

  catalog.focus();
  expectActive(catalog);
  await user.keyboard("{ArrowRight}");
  expectActive(teams);
  await user.keyboard("{ArrowRight}");
  expectActive(roster);
  await user.keyboard("{ArrowLeft}");
  expectActive(teams);
  await user.keyboard("{Home}");
  expectActive(roster);
  await user.keyboard("{End}");
  expectActive(teams);
  await user.tab();
  expect(screen.getByRole("tabpanel")).toHaveFocus();
  await user.tab({ shift: true });
  expectActive(teams);
});
