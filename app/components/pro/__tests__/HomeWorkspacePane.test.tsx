import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HomeWorkspacePane } from "../HomeWorkspacePane";

let mockProject: { id: string; name: string } | null = {
  id: "project-a",
  name: "Website",
};
const mockSetTerminalDockOpen = jest.fn();
const mockInputRef = { current: "Review this" };
const mockSetInput = jest.fn();
const mockFetch = jest.fn();

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    activeProject: mockProject,
    setTerminalDockOpen: mockSetTerminalDockOpen,
  }),
}));
jest.mock("@/app/contexts/InputContext", () => ({
  useInputApi: () => ({ inputRef: mockInputRef, setInput: mockSetInput }),
}));

const directory = {
  entries: [
    { name: "README.md", path: "README.md", type: "file" },
    { name: "src", path: "src", type: "directory" },
  ],
};
const response = (data: unknown, ok = true) =>
  Promise.resolve({ ok, json: async () => data });
const browse = () =>
  fireEvent.click(screen.getByRole("button", { name: "Browse workspace" }));
const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  mockProject = { id: "project-a", name: "Website" };
  mockInputRef.current = "Review this";
  global.fetch = mockFetch;
  mockFetch.mockImplementation(() => response(directory));
});
afterAll(() => {
  global.fetch = originalFetch;
});

it("waits for an explicit browse request before opening a workspace", async () => {
  render(<HomeWorkspacePane onClose={jest.fn()} />);
  expect(mockFetch).not.toHaveBeenCalled();
  expect(
    screen.getByRole("textbox", { name: "Search workspace files" }),
  ).toBeDisabled();
  browse();
  expect(
    await screen.findByRole("button", { name: "README.md" }),
  ).toBeVisible();
  expect(mockFetch).toHaveBeenCalledWith(
    "/api/workbench/tree?path=",
    expect.objectContaining({
      headers: expect.objectContaining({
        "X-RIFT-Workbench-Project-Id": "project-a",
      }),
      signal: expect.any(AbortSignal),
    }),
  );
});

it("filters real entries and navigates folders without losing the workspace scope", async () => {
  render(<HomeWorkspacePane onClose={jest.fn()} />);
  browse();
  await screen.findByRole("button", { name: "README.md" });
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search workspace files" }),
    { target: { value: "read" } },
  );
  expect(screen.queryByRole("button", { name: "src" })).not.toBeInTheDocument();
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search workspace files" }),
    { target: { value: "" } },
  );
  mockFetch.mockImplementationOnce(() =>
    response({
      entries: [{ name: "app.tsx", path: "src/app.tsx", type: "file" }],
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "src" }));
  expect(await screen.findByRole("button", { name: "app.tsx" })).toBeVisible();
  expect(mockFetch).toHaveBeenLastCalledWith(
    "/api/workbench/tree?path=src",
    expect.anything(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Back to parent folder" }),
  );
  expect(
    await screen.findByRole("button", { name: "README.md" }),
  ).toBeVisible();
});

it("previews a file and appends its context to the existing draft", async () => {
  render(
    <>
      <textarea data-testid="chat-input" />
      <HomeWorkspacePane onClose={jest.fn()} />
    </>,
  );
  browse();
  await screen.findByRole("button", { name: "README.md" });
  mockFetch.mockImplementationOnce(() =>
    response({ path: "README.md", content: "# Website" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "README.md" }));
  expect(await screen.findByText("# Website")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Add to message" }));
  expect(mockSetInput).toHaveBeenCalledWith("Review this @files README.md ");
  expect(screen.getByTestId("chat-input")).toHaveFocus();
});

it("offers retry after an unavailable workspace", async () => {
  mockFetch.mockImplementationOnce(() => response({}, false));
  render(<HomeWorkspacePane onClose={jest.fn()} />);
  browse();
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  expect(
    await screen.findByRole("button", { name: "README.md" }),
  ).toBeVisible();
});

it("clears old files and cancels pending requests when the project changes", async () => {
  const view = render(<HomeWorkspacePane onClose={jest.fn()} />);
  browse();
  await screen.findByRole("button", { name: "README.md" });
  mockFetch.mockImplementationOnce(() => new Promise(() => {}));
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh workspace files" }),
  );
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  const signal = mockFetch.mock.calls[1][1].signal as AbortSignal;
  mockProject = { id: "project-b", name: "Other project" };
  view.rerender(<HomeWorkspacePane onClose={jest.fn()} />);
  expect(signal.aborted).toBe(true);
  expect(
    screen.getByRole("button", { name: "Browse workspace" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "README.md" }),
  ).not.toBeInTheDocument();
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

it("connects the existing terminal control and close action", () => {
  const close = jest.fn();
  render(<HomeWorkspacePane onClose={close} />);
  fireEvent.click(screen.getByRole("button", { name: "Terminal" }));
  expect(mockSetTerminalDockOpen).toHaveBeenCalledWith(true);
  fireEvent.click(
    screen.getByRole("button", { name: "Close workspace files" }),
  );
  expect(close).toHaveBeenCalledTimes(1);
});
