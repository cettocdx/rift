import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { LocalRunnerSettingsCard } from "../LocalRunnerSettingsCard";

const mockGetToken = jest.fn();
const mockDisconnect = jest.fn();
const mockSetPreference = jest.fn();
const mockWriteText = jest.fn();
const mockQuery = jest.fn();
let mockPreference = "e2b";
let mockAuthenticated = true;
let mockLoading = false;
let mockConnections: unknown[] | undefined = [];
jest.mock("@/convex/_generated/api", () => ({
  api: {
    localSandbox: {
      getToken: "getToken",
      disconnectDesktop: "disconnect",
      listConnections: "list",
    },
  },
}));
jest.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: mockAuthenticated,
    isLoading: mockLoading,
  }),
  useQuery: (...args: unknown[]) => {
    mockQuery(...args);
    return mockConnections;
  },
  useMutation: (name: string) =>
    name === "getToken" ? mockGetToken : mockDisconnect,
}));
jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    sandboxPreference: mockPreference,
    setSandboxPreference: mockSetPreference,
  }),
}));
const runner = {
  connectionId: "runner-1",
  name: "Work Mac",
  isDesktop: false,
  capabilities: { commands: true, pty: true },
  lastSeen: 1,
};
beforeEach(() => {
  jest.clearAllMocks();
  mockAuthenticated = true;
  mockLoading = false;
  mockPreference = "e2b";
  mockConnections = [];
  mockGetToken.mockResolvedValue({ token: "fixture_private_token" });
  mockWriteText.mockResolvedValue(undefined);
  mockDisconnect.mockResolvedValue({ success: true });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mockWriteText },
  });
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://fixture.convex.cloud";
});

it("gets the existing token only on explicit copy, and never renders it", async () => {
  const { container } = render(<LocalRunnerSettingsCard />);
  expect(mockGetToken).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Copy connect command" }));
  await waitFor(() => expect(mockWriteText).toHaveBeenCalledTimes(1));
  expect(mockGetToken).toHaveBeenCalledWith({});
  expect(mockWriteText.mock.calls[0][0]).toContain("/downloads/rift-cli.tgz");
  expect(mockWriteText.mock.calls[0][0]).toContain(
    "--convex-url 'https://fixture.convex.cloud'",
  );
  expect(mockWriteText.mock.calls[0][0]).toContain("fixture_private_token");
  expect(container.innerHTML).not.toContain("fixture_private_token");
  expect(screen.getByRole("status")).toHaveTextContent(/copied/i);
});

it("keeps auth failures recoverable without leaking the backend error", async () => {
  mockGetToken.mockRejectedValueOnce(new Error("private_auth_detail"));
  render(<LocalRunnerSettingsCard />);
  fireEvent.click(screen.getByRole("button", { name: "Copy connect command" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /could not prepare/i,
  );
  expect(document.body).not.toHaveTextContent("private_auth_detail");
  expect(mockWriteText).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Copy connect command" }));
  await waitFor(() => expect(mockWriteText).toHaveBeenCalledTimes(1));
});

it("retries a blocked clipboard from the next click without fetching or rotating the token again", async () => {
  mockWriteText.mockRejectedValueOnce(new Error("NotAllowedError"));
  render(<LocalRunnerSettingsCard />);
  fireEvent.click(screen.getByRole("button", { name: "Copy connect command" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/copy again/i);
  fireEvent.click(screen.getByRole("button", { name: "Copy connect command" }));
  await waitFor(() => expect(mockWriteText).toHaveBeenCalledTimes(2));
  expect(mockGetToken).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status")).toHaveTextContent(/copied/i);
});

it("offers only authenticated command runners and changes the actual execution selection", async () => {
  mockConnections = [
    runner,
    {
      ...runner,
      connectionId: "desktop-file",
      name: "File sharing",
      isDesktop: true,
      capabilities: { commands: false, pty: false },
    },
  ];
  const { rerender } = render(<LocalRunnerSettingsCard />);
  expect(screen.getByText("Work Mac")).toBeVisible();
  expect(screen.queryByText("File sharing")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Use Work Mac" }));
  expect(mockSetPreference).toHaveBeenCalledWith("runner-1");
  mockPreference = "runner-1";
  rerender(<LocalRunnerSettingsCard />);
  expect(screen.getByRole("button", { name: "Use Work Mac" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByText(/selected target: work mac/i)).toBeVisible();
});

it("disconnects only the chosen connection and does not silently move selected work to cloud", async () => {
  mockConnections = [runner];
  mockPreference = "runner-1";
  render(<LocalRunnerSettingsCard />);
  fireEvent.click(screen.getByRole("button", { name: "Disconnect Work Mac" }));
  await waitFor(() =>
    expect(mockDisconnect).toHaveBeenCalledWith({ connectionId: "runner-1" }),
  );
  expect(mockGetToken).not.toHaveBeenCalled();
  expect(mockSetPreference).not.toHaveBeenCalled();
});

it("does not claim a rejected disconnect succeeded", async () => {
  mockConnections = [runner];
  mockDisconnect.mockResolvedValue({ success: false });
  render(<LocalRunnerSettingsCard />);
  fireEvent.click(screen.getByRole("button", { name: "Disconnect Work Mac" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /could not disconnect/i,
  );
});

it("skips owner queries and disables token retrieval before authentication", () => {
  mockAuthenticated = false;
  render(<LocalRunnerSettingsCard />);
  expect(mockQuery).toHaveBeenCalledWith("list", "skip");
  expect(
    screen.getByRole("button", { name: "Copy connect command" }),
  ).toBeDisabled();
  expect(mockGetToken).not.toHaveBeenCalled();
});

it("keeps loading distinct from no registered runners and preserves an unavailable selection", () => {
  mockConnections = undefined;
  mockPreference = "missing-runner";
  const { rerender } = render(<LocalRunnerSettingsCard />);
  expect(screen.getByText("Loading runners…")).toBeVisible();
  expect(screen.queryByText("No runners connected")).not.toBeInTheDocument();
  mockConnections = [];
  rerender(<LocalRunnerSettingsCard />);
  expect(screen.getByText("No runners connected")).toBeVisible();
  expect(
    screen.getByText(/selected target: unavailable local runner/i),
  ).toBeVisible();
  expect(mockSetPreference).not.toHaveBeenCalled();
});

it("ignores an in-flight auth result after sign-out", async () => {
  let resolve!: (result: { token: string }) => void;
  mockGetToken.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { rerender } = render(<LocalRunnerSettingsCard />);
  fireEvent.click(screen.getByRole("button", { name: "Copy connect command" }));
  mockAuthenticated = false;
  rerender(<LocalRunnerSettingsCard />);
  await act(async () => resolve({ token: "obsolete_private_token" }));
  expect(mockWriteText).not.toHaveBeenCalled();
  expect(document.body.innerHTML).not.toContain("obsolete_private_token");
});

it("coalesces rapid clicks and retrieves a fresh existing token on a later successful copy", async () => {
  let resolve!: (result: { token: string }) => void;
  mockGetToken.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(<LocalRunnerSettingsCard />);
  const copy = screen.getByRole("button", { name: "Copy connect command" });
  fireEvent.click(copy);
  fireEvent.click(copy);
  expect(mockGetToken).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ token: "fixture_private_token" }));
  await waitFor(() => expect(copy).toBeEnabled());
  fireEvent.click(copy);
  await waitFor(() => expect(mockGetToken).toHaveBeenCalledTimes(2));
});
