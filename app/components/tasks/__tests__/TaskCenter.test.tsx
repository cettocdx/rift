import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useMutation, useQuery } from "convex/react";
import { getFunctionName } from "convex/server";
import userEvent from "@testing-library/user-event";

import { TaskCenter } from "../TaskCenter";
import type { TaskListItem } from "../task-center-utils";

jest.mock("convex/react", () => ({
  useMutation: jest.fn(),
  useQuery: jest.fn(),
}));

let mockSubscription = "pro";

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({ subscription: mockSubscription }),
}));

const setTaskEnabled = jest.fn(async () => ({ success: true }));

function task(overrides: Partial<TaskListItem> = {}): TaskListItem {
  return {
    _id: "task-1",
    title: "Review dependencies",
    prompt: "Review dependency changes.",
    purpose: "app",
    status: "open",
    enabled: true,
    schedule_type: "manual",
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

function renderTasks(rows: TaskListItem[]) {
  jest.mocked(useQuery).mockImplementation((query) => {
    const name = getFunctionName(query as never);
    if (name === "tasks:listForUser") return rows;
    if (name === "tasks:listRecentRuns") return [];
    return undefined;
  });
  return render(<TaskCenter />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSubscription = "pro";
  jest
    .mocked(useMutation)
    .mockImplementation((mutation) =>
      getFunctionName(mutation as never) === "tasks:setTaskEnabled"
        ? (setTaskEnabled as never)
        : (jest.fn(async () => ({ success: true })) as never),
    );
});

describe("TaskCenter run toggle", () => {
  it("pauses a manual task, whose flag decides whether a later schedule runs", async () => {
    renderTasks([task()]);

    const toggle = screen.getByRole("switch", {
      name: "Pause Review dependencies",
    });
    expect(toggle).toBeEnabled();

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(setTaskEnabled).toHaveBeenCalledWith({
        id: "task-1",
        enabled: false,
      }),
    );
  });

  it("names the scheduled row's toggle after the runs it controls", () => {
    renderTasks([
      task({
        schedule_type: "recurring",
        schedule_expression: "0 9 * * 1-5",
      }),
    ]);

    expect(
      screen.getByRole("switch", {
        name: "Pause automatic runs for Review dependencies",
      }),
    ).toBeEnabled();
  });

  it("lets a free plan resume a paused manual task but not a scheduled one", () => {
    mockSubscription = "free";
    renderTasks([
      task({ _id: "manual", title: "Manual task", enabled: false }),
      task({
        _id: "scheduled",
        title: "Scheduled task",
        enabled: false,
        schedule_type: "recurring",
        schedule_expression: "0 9 * * 1-5",
      }),
    ]);

    // setTaskEnabled only demands a paid plan when the task has a schedule.
    expect(
      screen.getByRole("switch", { name: "Resume Manual task" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("switch", {
        name: "Resume automatic runs for Scheduled task",
      }),
    ).toBeDisabled();
  });

  it("drops the toggle on a completed row and announces the status instead", () => {
    renderTasks([
      task({ status: "completed", enabled: false, completed_at: 2 }),
    ]);

    expect(screen.queryByRole("switch")).toBeNull();
    // Scoped to the row: "Completed" is also the label of a view tab.
    const row = screen.getByRole("article");
    expect(within(row).getByText("Completed")).toBeInTheDocument();
  });
});

it("uses native keyboard filter buttons for task status instead of unpaired tabs", async () => {
  const user = userEvent.setup();
  renderTasks([
    task(),
    task({
      _id: "scheduled-task",
      title: "Scheduled review",
      schedule_type: "recurring",
      schedule_expression: "0 9 * * 1-5",
    }),
  ]);
  const group = screen.getByRole("group", { name: "Filter tasks" });
  const all = within(group).getByRole("button", { name: /All/ });
  const scheduled = within(group).getByRole("button", { name: /Scheduled/ });
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
  all.focus();
  await user.tab();
  expect(scheduled).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(scheduled).toHaveAttribute("aria-pressed", "true");
  expect(all).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByText("Scheduled review")).toBeVisible();
  expect(screen.queryByText("Review dependencies")).not.toBeInTheDocument();
  await user.tab({ shift: true });
  expect(all).toHaveFocus();
  await user.keyboard(" ");
  expect(all).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("Review dependencies")).toBeVisible();
});

const mockRouterPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

describe("manual task execution", () => {
  const mockFetch = jest.fn();
  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: jest.fn(() => "run-request-1"),
    });
  });

  async function startRun() {
    await userEvent.click(
      screen.getByRole("button", {
        name: "More actions for Review dependencies",
      }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Run now" }));
  }

  it("queues the real backend task and opens its saved conversation", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, state: "queued", chatId: "bot-chat" }),
    });
    renderTasks([task()]);
    await startRun();
    await waitFor(() =>
      expect(mockRouterPush).toHaveBeenCalledWith("/c/bot-chat"),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/tasks/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ taskId: "task-1", requestId: "run-request-1" }),
      }),
    );
  });

  it("disables actions until the enqueue response arrives", async () => {
    let resolve!: (value: unknown) => void;
    mockFetch.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    renderTasks([task()]);
    await startRun();
    expect(
      screen.getByRole("button", {
        name: "More actions for Review dependencies",
      }),
    ).toBeDisabled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    resolve({
      ok: true,
      json: async () => ({ ok: true, state: "queued", dispatchPending: true }),
    });
    await waitFor(() =>
      expect(
        screen.getByText(/Dispatch will retry automatically/),
      ).toBeInTheDocument(),
    );
  });

  it("preserves the request key after a network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network unavailable"));
    renderTasks([task()]);
    await startRun();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Network unavailable",
      ),
    );
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, state: "running", chatId: "same-chat" }),
    });
    await startRun();
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(mockFetch.mock.calls[0][1].body).toBe(
      mockFetch.mock.calls[1][1].body,
    );
    expect(mockRouterPush).toHaveBeenCalledWith("/c/same-chat");
  });

  it.each([
    { enabled: false },
    { status: "completed" as const },
    { purpose: "security" as const },
    { schedule_type: "recurring" as const, schedule_expression: "0 9 * * *" },
  ])("does not offer Run now for ineligible tasks %j", async (overrides) => {
    renderTasks([task(overrides)]);
    await userEvent.click(
      screen.getByRole("button", {
        name: "More actions for Review dependencies",
      }),
    );
    expect(
      screen.queryByRole("menuitem", { name: "Run now" }),
    ).not.toBeInTheDocument();
  });
});

describe("TaskCenter editor focus", () => {
  it("returns to Create task if a live update removes the edited row", async () => {
    const user = userEvent.setup();
    const view = renderTasks([task()]);
    const create = screen.getByRole("button", {
      name: "Create task",
      exact: true,
    });
    await user.click(
      screen.getByRole("button", {
        name: "More actions for Review dependencies",
      }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Edit", exact: true }),
    );
    const dialog = screen.getByRole("dialog", { name: "Edit task" });
    jest.mocked(useQuery).mockReturnValue([] as never);
    view.rerender(<TaskCenter />);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(create).toHaveFocus());
  });

  it.each(["Escape", "Cancel"])(
    "returns to Create task after %s",
    async (dismiss) => {
      const user = userEvent.setup();
      renderTasks([task()]);
      const opener = screen.getByRole("button", {
        name: "Create task",
        exact: true,
      });
      await user.click(opener);
      const dialog = screen.getByRole("dialog", { name: "Create task" });
      if (dismiss === "Escape") await user.keyboard("{Escape}");
      else
        await user.click(
          within(dialog).getByRole("button", { name: "Cancel" }),
        );
      await waitFor(() => expect(opener).toHaveFocus());
    },
  );

  it("returns to the row actions after editing", async () => {
    const user = userEvent.setup();
    renderTasks([task()]);
    const opener = screen.getByRole("button", {
      name: "More actions for Review dependencies",
    });
    await user.click(opener);
    await user.click(
      screen.getByRole("menuitem", { name: "Edit", exact: true }),
    );
    const dialog = screen.getByRole("dialog", { name: "Edit task" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
