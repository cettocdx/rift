import { render, screen } from "@testing-library/react";
import { GithubConnectButton } from "../GithubConnectButton";
let connected = false;
jest.mock("convex/react", () => ({
  useQuery: () => ({ connected }),
  useMutation: () => jest.fn(),
}));
jest.mock("@/app/hooks/useTauri", () => ({
  isTauriEnvironment: () => false,
  openInBrowser: jest.fn(),
}));
it("renders a single compact Connect action without a repeated GitHub mark", () => {
  connected = false;
  render(<GithubConnectButton variant="sidebar" />);
  const button = screen.getByRole("button", { name: "Connect GitHub" });
  expect(button).toHaveTextContent(/^Connect$/);
  expect(button.querySelector("svg")).toBeNull();
});
it("keeps connection management available after linking", () => {
  connected = true;
  render(<GithubConnectButton variant="sidebar" />);
  expect(
    screen.getByRole("button", { name: "Manage GitHub connection" }),
  ).toHaveTextContent("Manage connection");
});
