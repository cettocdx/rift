import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { GithubConnectButton } from "../GithubConnectButton";

let mockStatus = {
  connected: false,
  username: undefined as string | undefined,
};
let mockDesktop = false;
const mockConnect = jest.fn();
const mockDisconnect = jest.fn();
const mockOpenBrowser = jest.fn();
const mockInvoke = jest.fn();
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
jest.mock("convex/react", () => ({
  useQuery: () => mockStatus,
  useMutation: (query: unknown) =>
    require("convex/server").getFunctionName(query) === "github:connect"
      ? mockConnect
      : mockDisconnect,
}));
jest.mock("@/app/hooks/useTauri", () => ({
  isTauriEnvironment: () => mockDesktop,
  openInBrowser: (...args: unknown[]) => mockOpenBrowser(...args),
}));
jest.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));
jest.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));
const response = (value: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => value,
});
const authorizationUrl =
  "https://github.com/login/oauth/authorize?client_id=test&state=signed-state";
function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Connect GitHub" }));
  return screen.getByRole("button", { name: "Continue with GitHub" });
}
function openManualToken() {
  openDialog();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Advanced: use a personal access token",
    }),
  );
  const token = screen.getByLabelText("Personal access token");
  fireEvent.change(token, { target: { value: "  ghp_example  " } });
  return token;
}
beforeEach(() => {
  jest.clearAllMocks();
  mockStatus = { connected: false, username: undefined };
  mockDesktop = false;
  mockOpenBrowser.mockResolvedValue(true);
  mockInvoke.mockImplementation(async (command: string) =>
    command === "prepare_desktop_auth_state" ? "a".repeat(64) : "rift-preview",
  );
  mockConnect.mockResolvedValue({ success: true });
  global.fetch = jest.fn();
  window.history.replaceState({}, "", "/c/current?view=build");
});
afterEach(() => jest.useRealTimers());

it("shows recoverable server configuration errors for web without leaving the dialog", async () => {
  (fetch as jest.Mock).mockResolvedValue(
    response(
      { error: "GitHub connection is not configured.", code: "not_configured" },
      503,
    ),
  );
  render(<GithubConnectButton variant="sidebar" />);
  fireEvent.click(openDialog());
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "GitHub connection is not configured.",
  );
  expect(fetch).toHaveBeenCalledWith(
    "/api/github/authorize",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ return_to: "/c/current?view=build" }),
      signal: expect.any(AbortSignal),
    }),
  );
  expect(
    screen.getByRole("button", { name: "Continue with GitHub" }),
  ).toBeEnabled();
  expect(
    screen.getByRole("button", {
      name: "Advanced: use a personal access token",
    }),
  ).toBeVisible();
  expect(mockOpenBrowser).not.toHaveBeenCalled();
  expect(window.location.pathname).toBe("/c/current");
});

it("shows provider initiation errors and permits retry", async () => {
  (fetch as jest.Mock)
    .mockResolvedValueOnce(
      response(
        {
          error: "GitHub is temporarily unavailable.",
          code: "provider_unavailable",
        },
        502,
      ),
    )
    .mockResolvedValueOnce(response({ url: authorizationUrl }));
  mockDesktop = true;
  render(<GithubConnectButton variant="sidebar" />);
  fireEvent.click(openDialog());
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "GitHub is temporarily unavailable.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue with GitHub" }));
  await waitFor(() =>
    expect(mockOpenBrowser).toHaveBeenCalledWith(authorizationUrl),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("aborts a slow authorization request at 15 seconds and allows another attempt", async () => {
  jest.useFakeTimers();
  (fetch as jest.Mock).mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) =>
        options.signal.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        ),
      ),
  );
  render(<GithubConnectButton variant="sidebar" />);
  fireEvent.click(openDialog());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(15_000);
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "GitHub connection timed out. Try again.",
  );
  expect((fetch as jest.Mock).mock.calls[0][1].signal.aborted).toBe(true);
  expect(
    screen.getByRole("button", { name: "Continue with GitHub" }),
  ).toBeEnabled();
});

it.each([
  "https://evil.example/login/oauth/authorize",
  "https://github.com/elsewhere",
  "https://user:password@github.com/login/oauth/authorize",
])("rejects an invalid desktop authorization URL: %s", async (url) => {
  mockDesktop = true;
  (fetch as jest.Mock).mockResolvedValue(response({ url }));
  render(<GithubConnectButton variant="sidebar" />);
  fireEvent.click(openDialog());
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Invalid GitHub authorization address.",
  );
  expect(mockOpenBrowser).not.toHaveBeenCalled();
});

it("opens one desktop authorization request and closes after the connection is observed", async () => {
  mockDesktop = true;
  let resolve!: (value: unknown) => void;
  (fetch as jest.Mock).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const { rerender } = render(<GithubConnectButton variant="sidebar" />);
  const start = openDialog();
  fireEvent.click(start);
  fireEvent.click(start);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(start).toBeDisabled();
  expect(JSON.parse((fetch as jest.Mock).mock.calls[0][1].body)).toEqual({
    return_to: "/c/current?view=build",
    desktop_state: "a".repeat(64),
    desktop_scheme: "rift-preview",
  });
  await act(async () => resolve(response({ url: authorizationUrl })));
  expect(mockOpenBrowser).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Finish connecting in your browser.",
  );
  expect(screen.getByRole("dialog")).toBeVisible();
  mockStatus = { connected: true, username: "octo" };
  rerender(<GithubConnectButton variant="sidebar" />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Manage GitHub connection" }),
  ).toBeVisible();
});

it("does not open a late authorization response after the dialog is dismissed", async () => {
  mockDesktop = true;
  let resolve!: (value: unknown) => void;
  (fetch as jest.Mock).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  render(<GithubConnectButton variant="sidebar" />);
  fireEvent.click(openDialog());
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Close", exact: true }));
  await act(async () => resolve(response({ url: authorizationUrl })));
  expect(mockOpenBrowser).not.toHaveBeenCalled();
});

it.each([401, 403, 500])(
  "does not save a manual token rejected with HTTP %s",
  async (status) => {
    (fetch as jest.Mock).mockResolvedValue(
      response({ message: "Rejected" }, status),
    );
    render(<GithubConnectButton variant="sidebar" />);
    const token = openManualToken();
    fireEvent.click(
      screen.getByRole("button", { name: "Connect", exact: true }),
    );
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(token).toHaveValue("  ghp_example  ");
    expect(mockConnect).not.toHaveBeenCalled();
  },
);

it("does not save a manual token when verification fails over the network", async () => {
  (fetch as jest.Mock).mockRejectedValue(new TypeError("Failed to fetch"));
  render(<GithubConnectButton variant="sidebar" />);
  const token = openManualToken();
  fireEvent.click(screen.getByRole("button", { name: "Connect", exact: true }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not verify your token with GitHub. Try again.",
  );
  expect(token).toHaveValue("  ghp_example  ");
  expect(mockConnect).not.toHaveBeenCalled();
});

it("requires a verified username before saving a manual token", async () => {
  (fetch as jest.Mock).mockResolvedValue(response({}));
  render(<GithubConnectButton variant="sidebar" />);
  openManualToken();
  fireEvent.click(screen.getByRole("button", { name: "Connect", exact: true }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "GitHub did not return an account for this token.",
  );
  expect(mockConnect).not.toHaveBeenCalled();
});

it("saves one successfully verified manual token and closes the dialog", async () => {
  (fetch as jest.Mock).mockResolvedValue(response({ login: "octo" }));
  render(<GithubConnectButton variant="sidebar" />);
  openManualToken();
  const connect = screen.getByRole("button", { name: "Connect", exact: true });
  fireEvent.click(connect);
  fireEvent.click(connect);
  await waitFor(() =>
    expect(mockConnect).toHaveBeenCalledWith({
      token: "ghp_example",
      username: "octo",
    }),
  );
  expect(mockConnect).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(
    "https://api.github.com/user",
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer ghp_example" }),
      signal: expect.any(AbortSignal),
    }),
  );
  expect(mockToastSuccess).toHaveBeenCalledWith("Connected as octo");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("consumes each OAuth return once across mounted controls and preserves navigation state", () => {
  const navigationState = { __NA: true, tree: ["current"] };
  window.history.replaceState(
    navigationState,
    "",
    "/c/current?view=build&github=configuration_error#files",
  );
  render(
    <>
      <GithubConnectButton variant="sidebar" />
      <GithubConnectButton />
    </>,
  );
  expect(mockToastError).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "GitHub rejected RIFT’s app configuration.",
  );
  expect(window.location.search).toBe("?view=build");
  expect(window.location.hash).toBe("#files");
  expect(window.history.state).toEqual(navigationState);
  window.history.replaceState(
    navigationState,
    "",
    "/c/current?github=provider_unavailable",
  );
  act(() => window.dispatchEvent(new PopStateEvent("popstate")));
  expect(mockToastError).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "GitHub could not be reached.",
  );
});

it("offers reconnect for existing credentials and posts through the same server check", async () => {
  mockStatus = { connected: true, username: "octo" };
  (fetch as jest.Mock).mockResolvedValue(
    response(
      { error: "GitHub connection is not configured.", code: "not_configured" },
      503,
    ),
  );
  render(<GithubConnectButton variant="sidebar" />);
  fireEvent.click(
    screen.getByRole("button", { name: "Manage GitHub connection" }),
  );
  expect(screen.getByRole("button", { name: "Disconnect" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Reconnect GitHub" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "GitHub connection is not configured.",
  );
  expect(fetch).toHaveBeenCalledWith(
    "/api/github/authorize",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ return_to: "/c/current?view=build" }),
    }),
  );
  expect(mockToastSuccess).not.toHaveBeenCalled();
});

it("waits for an authoritative desktop reconnect return despite already-connected status", async () => {
  mockStatus = { connected: true, username: "octo" };
  mockDesktop = true;
  (fetch as jest.Mock).mockResolvedValue(response({ url: authorizationUrl }));
  const { rerender } = render(<GithubConnectButton variant="sidebar" />);
  fireEvent.click(
    screen.getByRole("button", { name: "Manage GitHub connection" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Reconnect GitHub" }));
  await waitFor(() =>
    expect(mockOpenBrowser).toHaveBeenCalledWith(authorizationUrl),
  );
  rerender(<GithubConnectButton variant="sidebar" />);
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Finish connecting in your browser.",
  );
  expect(mockToastSuccess).not.toHaveBeenCalled();
  window.history.replaceState({}, "", "/c/current?github=connected");
  act(() => window.dispatchEvent(new PopStateEvent("popstate")));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(mockToastSuccess).toHaveBeenCalledTimes(1);
});
