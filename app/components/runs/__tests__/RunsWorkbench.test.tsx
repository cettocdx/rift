import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockUseQuery = jest.fn();
jest.mock("convex/react", () => ({
  useQuery: (...a: unknown[]) => mockUseQuery(...a),
}));
jest.mock("@/convex/_generated/api", () => ({
  api: { runs: { listRuns: "runs.listRuns" } },
}));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

import { RunsWorkbench } from "../RunsWorkbench";

const run = (overrides: Record<string, unknown> = {}) => ({
  id: "run-1",
  chat_id: "chat-1",
  status: "completed",
  surface: "build",
  goal: "Add a settings page",
  model: "build-balanced",
  started_at: Date.now() - 120_000,
  ended_at: Date.now() - 60_000,
  ...overrides,
});

describe("Runs destination", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows a loading state rather than an empty one while runs load", () => {
    // An empty list and an unloaded list mean different things. Showing "no
    // runs yet" before the answer arrives tells the user something false.
    mockUseQuery.mockReturnValue(undefined);
    render(<RunsWorkbench />);

    expect(screen.getByLabelText("Loading runs")).toBeInTheDocument();
    expect(screen.queryByText("No runs yet")).not.toBeInTheDocument();
  });

  it("lists a run with its goal, surface and duration", () => {
    mockUseQuery.mockReturnValue([run()]);
    render(<RunsWorkbench />);

    // Scope to the list: the filter tabs use the same words as the badges.
    const card = screen.getByRole("link", { name: /Add a settings page/ });
    expect(within(card).getByText("Build")).toBeInTheDocument();
    expect(within(card).getByText("Completed")).toBeInTheDocument();
    expect(within(card).getByText(/took/)).toBeInTheDocument();
  });

  it("says a stopped run was stopped by the user, not that it failed", () => {
    mockUseQuery.mockReturnValue([
      run({ status: "cancelled", stop_reason: "user" }),
    ]);
    render(<RunsWorkbench />);

    const card = screen.getByRole("link", { name: /Add a settings page/ });
    expect(within(card).getByText("Cancelled")).toBeInTheDocument();
    expect(within(card).getByText("you stopped it")).toBeInTheDocument();
    expect(within(card).queryByText("Failed")).not.toBeInTheDocument();
  });

  it("filters by status and counts each filter", () => {
    mockUseQuery.mockReturnValue([
      run({ id: "a", status: "completed" }),
      run({ id: "b", status: "cancelled", goal: "Stopped one" }),
      run({ id: "c", status: "failed", goal: "Broken one" }),
    ]);
    render(<RunsWorkbench />);

    const cancelledTab = screen.getByRole("button", { name: /Cancelled/ });
    expect(within(cancelledTab).getByText("1")).toBeInTheDocument();

    fireEvent.click(cancelledTab);
    expect(screen.getByText("Stopped one")).toBeInTheDocument();
    expect(screen.queryByText("Broken one")).not.toBeInTheDocument();
  });

  it("explains an empty filter differently from an empty account", () => {
    mockUseQuery.mockReturnValue([run({ status: "completed" })]);
    render(<RunsWorkbench />);

    fireEvent.click(screen.getByRole("button", { name: /Failed/ }));
    expect(screen.getByText("Nothing in this filter")).toBeInTheDocument();
    expect(screen.queryByText("No runs yet")).not.toBeInTheDocument();
  });

  it("links each run to its own detail page", () => {
    mockUseQuery.mockReturnValue([run({ id: "run-xyz" })]);
    render(<RunsWorkbench />);

    expect(
      screen.getByRole("link", { name: /Add a settings page/ }),
    ).toHaveAttribute("href", "/runs/run-xyz");
  });

  it("hides a phase on a finished run", () => {
    // A phase is where the run currently is. On a finished run it is a
    // leftover, not information.
    mockUseQuery.mockReturnValue([
      run({ status: "completed", phase: "recon" }),
    ]);
    render(<RunsWorkbench />);
    expect(screen.queryByText("recon")).not.toBeInTheDocument();
  });

  it("exposes status filters as native pressed buttons usable with Tab and Space", async () => {
    const user = userEvent.setup();
    mockUseQuery.mockReturnValue([run()]);
    render(<RunsWorkbench />);
    const group = screen.getByRole("group", { name: "Filter runs by status" });
    const filters = within(group).getAllByRole("button");
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(filters[0]).toHaveAttribute("aria-pressed", "true");

    await user.tab();
    expect(filters[0]).toHaveFocus();
    await user.tab();
    expect(filters[1]).toHaveFocus();
    await user.keyboard(" ");
    expect(filters[1]).toHaveAttribute("aria-pressed", "true");
    expect(filters[0]).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Nothing in this filter")).toBeVisible();
  });
});

describe("Run timing claims", () => {
  const now = 1_800_000_000_000;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, "now").mockReturnValue(now);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(["disconnected", "unknown-provider-status"])(
    "shows elapsed time since start without claiming continuing work for %s",
    (status) => {
      mockUseQuery.mockReturnValue([
        run({ status, started_at: now - 38 * 3_600_000, ended_at: undefined }),
      ]);
      render(<RunsWorkbench />);
      const card = screen.getByRole("link", { name: /Add a settings page/ });
      expect(within(card).getByText("Disconnected")).toBeVisible();
      expect(within(card).getByText("started")).toBeVisible();
      expect(within(card).getByText("38h 0m ago")).toBeVisible();
      expect(within(card).queryByText("running for")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Running 0" })).toBeVisible();
    },
  );

  it("keeps the elapsed runtime for a running record", () => {
    mockUseQuery.mockReturnValue([
      run({
        status: "running",
        started_at: now - 125_000,
        ended_at: undefined,
      }),
    ]);
    render(<RunsWorkbench />);
    const card = screen.getByRole("link", { name: /Add a settings page/ });
    expect(within(card).getByText("running for")).toBeVisible();
    expect(within(card).getByText("2m 5s")).toBeVisible();
  });

  it("keeps a completed duration fixed to the recorded end", () => {
    mockUseQuery.mockReturnValue([
      run({ started_at: now - 3_600_000, ended_at: now - 3_535_000 }),
    ]);
    render(<RunsWorkbench />);
    const card = screen.getByRole("link", { name: /Add a settings page/ });
    expect(within(card).getByText("took")).toBeVisible();
    expect(within(card).getByText("1m 5s")).toBeVisible();
  });
});
