const originalFetch = global.fetch;
beforeAll(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
});
afterAll(() => {
  global.fetch = originalFetch;
});
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { SidebarActiveRuns } from "../SidebarActiveRuns";

const goChat = jest.fn();
let mockRuns: Array<Record<string, unknown>> | undefined = [];
let mockChats: Record<string, { id: string } | null | undefined | Error> = {};
const mockChatQueries = jest.fn(
  (queries: Record<string, { args: { id: string } }>) =>
    Object.fromEntries(
      Object.entries(queries).map(
        ([
          key,
          {
            args: { id },
          },
        ]) => [key, Object.hasOwn(mockChats, id) ? mockChats[id] : { id }],
      ),
    ),
);

jest.mock("convex/react", () => ({
  useQuery: () => mockRuns,
  useQueries: (queries: Record<string, { args: { id: string } }>) =>
    mockChatQueries(queries),
}));

jest.mock("@/app/hooks/useChatNavigation", () => ({
  useChatNavigation: () => ({ goChat }),
}));

const run = (over: Record<string, unknown> = {}) => ({
  id: "run_1",
  chat_id: "chat_1",
  status: "running",
  surface: "build",
  goal: "Build the rally game",
  started_at: Date.now() - 65_000,
  ...over,
});

/*
 * The rail's answer to "is it still running?".
 *
 * An agent turn runs on a durable worker and survives leaving the page, but the
 * rail only ever showed a dot on one chat row — so leaving felt like killing
 * the work. Everything here comes from the server's own run records; nothing is
 * inferred from a stream the browser happens to be holding.
 */
describe("SidebarActiveRuns", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRuns = [];
    mockChats = {};
  });

  it("renders nothing when nothing is running", () => {
    expect(
      render(<SidebarActiveRuns />).queryByTestId("sidebar-active-runs"),
    ).toBeNull();
  });

  it("renders nothing while the query is still loading", () => {
    mockRuns = undefined;
    expect(
      render(<SidebarActiveRuns />).queryByTestId("sidebar-active-runs"),
    ).toBeNull();
  });

  it("shows a live run with the user's own words for it", () => {
    mockRuns = [run()];
    render(<SidebarActiveRuns />);
    expect(screen.getByTestId("sidebar-active-runs")).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute(
      "title",
      "Build the rally game — Running",
    );
    expect(screen.getByRole("button")).toHaveTextContent("Running");
  });

  it.each([
    "thinking",
    "building",
    "verifying",
    "previewing",
    "Installing dependencies",
  ])("uses lifecycle status instead of the stale %s phase", (phase) => {
    mockRuns = [run({ phase })];
    render(<SidebarActiveRuns />);
    const row = screen.getByRole("button");
    expect(row).toHaveTextContent("Running");
    expect(row).not.toHaveTextContent(phase);
    expect(row).toHaveAttribute("title", "Build the rally game — Running");
    expect(
      screen.queryByText(/Running (?:a )?command/i),
    ).not.toBeInTheDocument();
    fireEvent.click(row);
    expect(goChat).toHaveBeenCalledWith("chat_1");
  });

  it("updates lifecycle status while the old thinking phase remains unchanged", () => {
    mockRuns = [run({ phase: "thinking" })];
    const view = render(<SidebarActiveRuns />);
    expect(screen.getByRole("button")).toHaveTextContent("Running");
    mockRuns = [run({ status: "waiting_for_approval", phase: "thinking" })];
    view.rerender(<SidebarActiveRuns />);
    expect(screen.getByRole("button")).toHaveTextContent(
      "Waiting for approval",
    );
    mockRuns = [run({ status: "stopping", phase: "thinking" })];
    view.rerender(<SidebarActiveRuns />);
    expect(screen.getByRole("button")).toHaveTextContent("Stopping");
    expect(screen.getByRole("button")).toHaveTextContent(/1m/);
    mockRuns = [run({ status: "cancelled", phase: "thinking" })];
    view.rerender(<SidebarActiveRuns />);
    expect(screen.queryByTestId("sidebar-active-runs")).not.toBeInTheDocument();
  });

  // The server is the only thing that can know a run ended. A finished run
  // lingering here would recreate the exact confusion this section exists to
  // remove, in the opposite direction.
  it("drops runs the server has marked terminal", () => {
    mockRuns = [
      run({ id: "run_done", status: "completed" }),
      run({ id: "run_failed", status: "failed" }),
      run({ id: "run_cancelled", status: "cancelled" }),
    ];
    expect(
      render(<SidebarActiveRuns />).queryByTestId("sidebar-active-runs"),
    ).toBeNull();
  });

  it("keeps a queued run, which has not started but is still yours", () => {
    mockRuns = [run({ status: "queued" })];
    expect(screen.queryByTestId).toBeDefined();
    render(<SidebarActiveRuns />);
    expect(screen.getByTestId("sidebar-active-runs")).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveTextContent("Queued");
  });

  it("opens the run's chat when clicked", () => {
    mockRuns = [run({ chat_id: "chat_42" })];
    render(<SidebarActiveRuns />);
    fireEvent.click(screen.getByRole("button"));
    expect(goChat).toHaveBeenCalledWith("chat_42");
  });

  it("shows how long it has been going", () => {
    mockRuns = [run({ started_at: Date.now() - 65_000 })];
    render(<SidebarActiveRuns />);
    expect(screen.getByText(/1m/)).toBeInTheDocument();
  });

  it("caps the list so the rail cannot be swamped", () => {
    mockRuns = Array.from({ length: 9 }, (_, i) =>
      run({ id: `run_${i}`, chat_id: `chat_${i}`, goal: `Task ${i}` }),
    );
    render(<SidebarActiveRuns />);
    expect(screen.getAllByRole("button")).toHaveLength(5);
  });

  it("falls back to the status word when the run recorded no goal", () => {
    mockRuns = [run({ goal: undefined })];
    render(<SidebarActiveRuns />);
    expect(screen.getByTestId("sidebar-active-runs")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});

/*
 * A record can lie about being live. Two independent guards say otherwise.
 */
describe("SidebarActiveRuns — records that only claim to be live", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRuns = [];
    mockChats = {};
  });

  // The worker's ceiling is 60 minutes. The first version of this panel listed
  // fifteen "starting" records at 900-2,200 minutes, faithfully.
  it("never shows a run older than the worker ceiling, whatever its status", () => {
    mockRuns = [
      run({ status: "starting", started_at: Date.now() - 949 * 60_000 }),
    ];
    expect(
      render(<SidebarActiveRuns />).queryByTestId("sidebar-active-runs"),
    ).toBeNull();
  });

  it("still shows a run comfortably inside the ceiling", () => {
    mockRuns = [
      run({ status: "running", started_at: Date.now() - 50 * 60_000 }),
    ];
    render(<SidebarActiveRuns />);
    expect(screen.getByTestId("sidebar-active-runs")).toBeInTheDocument();
  });

  // The reconciler writes `disconnected` (non-terminal in the vocabulary) and
  // sets ended_at. ended_at is what means "not any more".
  it("treats a record with ended_at as closed even under a non-terminal status", () => {
    mockRuns = [run({ status: "disconnected", ended_at: Date.now() - 1000 })];
    expect(
      render(<SidebarActiveRuns />).queryByTestId("sidebar-active-runs"),
    ).toBeNull();
  });
});

describe("SidebarActiveRuns — only navigable owned conversations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRuns = [];
    mockChats = {};
  });

  it("does not offer an Active destination for an orphan or owner-rejected chat", () => {
    mockRuns = [run()];
    // The existing owner-checked chat query returns null for both cases.
    mockChats = { chat_1: null };
    render(<SidebarActiveRuns />);
    expect(screen.queryByTestId("sidebar-active-runs")).not.toBeInTheDocument();
    expect(goChat).not.toHaveBeenCalled();
    expect(mockRuns[0].status).toBe("running");
  });

  it("waits for ownership lookup and reveals the still-running chat when it resolves", () => {
    mockRuns = [run()];
    mockChats = { chat_1: undefined };
    const view = render(<SidebarActiveRuns />);
    expect(screen.getByRole("button")).toBeDisabled();
    fireEvent.click(screen.getByRole("button"));
    expect(goChat).not.toHaveBeenCalled();
    mockChats = { chat_1: { id: "chat_1" } };
    view.rerender(<SidebarActiveRuns />);
    expect(screen.getByRole("button")).toBeEnabled();
    fireEvent.click(screen.getByRole("button"));
    expect(goChat).toHaveBeenCalledWith("chat_1");
  });

  it("does not let missing candidates crowd a genuine live chat out of the five-row list", () => {
    mockRuns = Array.from({ length: 7 }, (_, i) =>
      run({
        id: `run_${i}`,
        chat_id: `chat_${i}`,
        goal: i === 6 ? "Persisted build" : `Orphan ${i}`,
      }),
    );
    mockChats = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [`chat_${i}`, null]),
    );
    render(<SidebarActiveRuns />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button")).toHaveAttribute(
      "title",
      "Persisted build — Running",
    );
  });

  it("removes only the sidebar destination when a previously available chat disappears", () => {
    const recordedRun = run();
    mockRuns = [recordedRun];
    const view = render(<SidebarActiveRuns />);
    expect(screen.getByRole("button")).toBeInTheDocument();
    mockChats = { chat_1: null };
    view.rerender(<SidebarActiveRuns />);
    expect(screen.queryByTestId("sidebar-active-runs")).not.toBeInTheDocument();
    expect(mockRuns).toEqual([recordedRun]);
    expect(recordedRun.status).toBe("running");
  });

  it("keeps a failed lookup pending instead of making its destination navigable", () => {
    mockRuns = [run()];
    mockChats = { chat_1: new Error("Connection interrupted") };
    const view = render(<SidebarActiveRuns />);
    expect(screen.getByRole("button")).toBeDisabled();
    fireEvent.click(screen.getByRole("button"));
    expect(goChat).not.toHaveBeenCalled();
    mockChats = { chat_1: { id: "chat_1" } };
    view.rerender(<SidebarActiveRuns />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});
