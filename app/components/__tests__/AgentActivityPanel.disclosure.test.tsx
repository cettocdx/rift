import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentActivityPanel } from "../AgentActivityPanel";
import { ChatApprovalContext } from "@/app/contexts/ChatApprovalContext";
import type { AgentActivitySubagent } from "../agent-activity";
import type { BuildDesktopGrant } from "../BuildAccessSettings";

const mockAccess = {
  desktopState: "ready",
  grants: [] as BuildDesktopGrant[],
  error: null,
};
jest.mock("@/app/hooks/useDesktopWorkspaceAccess", () => ({
  useDesktopWorkspaceAccess: () => mockAccess,
}));

const agent: AgentActivitySubagent = {
  id: "review",
  toolCallId: "review-call",
  name: "Ada",
  role: "reviewer",
  task: "Review the changed files",
  status: "completed",
  durationMs: 2400,
  summary: "The change preserves keyboard navigation.",
  model: "Review model",
  execution: { mode: "read-only-tools", steps: 2, toolCalls: 3 },
};

describe("Activity progressive disclosure", () => {
  it("shows the exact pending command as awaiting approval and returns to its review", async () => {
    const review = jest.fn();
    const execution = {
      command: "python3 check.py",
      output: "",
      isExecuting: true,
      toolCallId: "pending-call",
    };
    const { rerender } = render(
      <ChatApprovalContext.Provider
        value={{ toolCallIds: ["pending-call"], onReview: review }}
      >
        <AgentActivityPanel
          todos={[]}
          toolExecutions={[execution]}
          status="streaming"
          onSelectExecution={jest.fn()}
        />
      </ChatApprovalContext.Provider>,
    );
    expect(
      screen.getByRole("button", { name: /Awaiting approval.*python3/ }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Executing/ })).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Review in chat" }),
    );
    expect(review).toHaveBeenCalledTimes(1);
    rerender(
      <ChatApprovalContext.Provider
        value={{ toolCallIds: [], onReview: review }}
      >
        <AgentActivityPanel
          todos={[]}
          toolExecutions={[execution]}
          status="streaming"
          onSelectExecution={jest.fn()}
        />
      </ChatApprovalContext.Provider>,
    );
    expect(
      screen.getByRole("button", { name: /^Executing.*python3/ }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Review in chat" })).toBeNull();
  });
  beforeEach(() => {
    mockAccess.grants = [];
  });

  it("retains a subagent draft when queue admission is rejected", async () => {
    const user = userEvent.setup();
    const create = jest.fn(() => false);
    render(
      <AgentActivityPanel
        todos={[]}
        toolExecutions={[]}
        onCreateSubagent={create}
      />,
    );
    await user.click(screen.getByRole("button", { name: "New subagent" }));
    await user.type(screen.getByLabelText("Name"), "Review bot");
    await user.type(
      screen.getByLabelText("Task"),
      "Review the keyboard behavior",
    );
    await user.click(screen.getByRole("button", { name: "Create subagent" }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Task")).toHaveValue(
      "Review the keyboard behavior",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("not added");
  });

  it("has one quiet empty state without empty sections or technical counters", () => {
    render(<AgentActivityPanel todos={[]} toolExecutions={[]} />);

    expect(screen.getByText("No activity yet")).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: /Plan|Agents|Operations/ }),
    ).toBeNull();
    expect(screen.queryByText("Run details")).toBeNull();
    expect(screen.queryByText(/No plan|No subagents|0\/0/)).toBeNull();
    expect(screen.queryByText(/^(Web|Sandbox|Computer)$/)).toBeNull();
  });

  it("lets users inspect earlier turn commands without mixing them into the latest run", async () => {
    const user = userEvent.setup();
    const onSelectExecution = jest.fn();
    render(
      <AgentActivityPanel
        todos={[]}
        toolExecutions={[]}
        status="submitted"
        onSelectExecution={onSelectExecution}
        historyTodos={[
          {
            id: "old-plan",
            content: "Verify game",
            status: "completed",
            sourceMessageId: "answer",
          },
          {
            id: "new-plan",
            content: "New work",
            status: "pending",
            sourceMessageId: "other",
          },
        ]}
        messages={[
          {
            id: "first",
            role: "user",
            parts: [{ type: "text", text: "Test the game" }],
          },
          {
            id: "answer",
            role: "assistant",
            parts: [
              {
                type: "tool-run_terminal_cmd",
                toolCallId: "old-command",
                state: "output-available",
                input: { command: "pnpm test" },
                output: { result: { output: "passed", exitCode: 0 } },
              },
            ],
          },
          {
            id: "latest",
            role: "user",
            parts: [{ type: "text", text: "Continue" }],
          },
        ]}
      />,
    );
    expect(screen.queryByRole("button", { name: /pnpm test/ })).toBeNull();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Activity for message" }),
      "first",
    );
    expect(screen.getByText("Verify game")).toBeVisible();
    expect(screen.queryByText("New work")).toBeNull();
    await user.click(screen.getByRole("button", { name: /pnpm test/ }));
    expect(onSelectExecution).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: "old-command" }),
    );
    expect(document.querySelector('[data-ui="activity-live-row"]')).toBeNull();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Activity for message" }),
      "",
    );
    expect(screen.queryByRole("button", { name: /pnpm test/ })).toBeNull();
    expect(
      document.querySelector('[data-ui="activity-live-row"]'),
    ).toBeVisible();
  });

  it("shows the live phase before the first tool and removes it when the run stops", () => {
    const { rerender } = render(
      <AgentActivityPanel todos={[]} toolExecutions={[]} status="submitted" />,
    );
    expect(
      document.querySelector('[data-ui="activity-live-row"]'),
    ).toBeVisible();
    expect(screen.queryByText("No activity yet")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Operations" })).toBeNull();

    rerender(
      <AgentActivityPanel todos={[]} toolExecutions={[]} status="ready" />,
    );
    expect(document.querySelector('[data-ui="activity-live-row"]')).toBeNull();
    expect(screen.getByText("No activity yet")).toBeVisible();
  });

  it("keeps actual operation access direct and makes usage and shared-item facts optional", async () => {
    const user = userEvent.setup();
    const onSelectExecution = jest.fn();
    const execution = {
      command: "pnpm test",
      output: "passed",
      isExecuting: false,
      toolCallId: "test-call",
    };
    mockAccess.grants = [
      {
        grantId: "file-grant",
        name: "notes.txt",
        kind: "file",
        writable: true,
        grantedAt: 1,
      },
    ];
    render(
      <AgentActivityPanel
        todos={[]}
        toolExecutions={[execution]}
        onSelectExecution={onSelectExecution}
        messages={[
          {
            role: "assistant",
            parts: [],
            metadata: { totalTokens: 1200, costDollars: 0.012 },
          },
        ]}
      />,
    );
    const runDetails = screen.getByText("Run details").closest("details")!;
    expect(runDetails).not.toHaveAttribute("open");
    expect(screen.getByText("1.2k")).not.toBeVisible();
    expect(screen.getByText("notes.txt")).not.toBeVisible();
    expect(screen.queryByRole("heading", { name: "Plan" })).toBeNull();
    await user.click(screen.getByRole("button", { name: /pnpm test/ }));
    expect(onSelectExecution).toHaveBeenCalledWith(execution);

    const summary = screen.getByText("Run details").closest("summary")!;
    // jsdom does not implement the native summary's Enter default action.
    await user.click(summary);
    summary.focus();
    expect(screen.getByText("1.2k")).toBeVisible();
    expect(screen.getByText("$0.01")).toBeVisible();
    expect(screen.getByText("notes.txt")).toBeVisible();
    expect(screen.getByText("Can edit")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(runDetails).not.toHaveAttribute("open");
    expect(summary).toHaveFocus();
  });

  it("prioritizes the result and closes execution details before returning to the exact row", async () => {
    const user = userEvent.setup();
    const parentEscape = jest.fn();
    render(
      <div onKeyDown={parentEscape}>
        <AgentActivityPanel
          todos={[]}
          toolExecutions={[]}
          subagents={[agent]}
        />
      </div>,
    );
    const row = screen.getByRole("button", { name: "Show details for Ada" });
    row.focus();
    await user.keyboard("{Enter}");
    const detail = within(
      screen.getByRole("region", { name: "Agent task details" }),
    );
    expect(detail.getByText(agent.summary!)).toBeVisible();
    expect(detail.getByText("2.4s")).toBeVisible();
    expect(detail.getByText("Review model")).not.toBeVisible();
    const summary = detail.getByText("Execution details").closest("summary")!;
    await user.click(summary);
    summary.focus();
    expect(detail.getByText("Review model")).toBeVisible();
    parentEscape.mockClear();
    await user.keyboard("{Escape}");
    expect(detail.getByText("Review model")).not.toBeVisible();
    expect(summary).toHaveFocus();
    expect(parentEscape).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("region", { name: "Agent task details" }),
    ).toBeNull();
    expect(row).toHaveFocus();
    expect(parentEscape).not.toHaveBeenCalled();
  });

  it("preserves draft creation and restores focus on Escape without invoking the callback", async () => {
    const user = userEvent.setup();
    const onCreateSubagent = jest.fn();
    render(
      <AgentActivityPanel
        todos={[]}
        toolExecutions={[]}
        onCreateSubagent={onCreateSubagent}
      />,
    );
    const trigger = screen.getByRole("button", { name: "New subagent" });
    await user.click(trigger);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
    const catalog = screen.getByRole("group", { name: "Agent catalog" });
    const choice = within(catalog).getAllByRole("button")[0];
    await user.click(choice);
    expect(choice).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "Name" })).not.toHaveValue("");
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("form", { name: "Create a subagent" }),
    ).toBeNull();
    expect(trigger).toHaveFocus();
    expect(onCreateSubagent).not.toHaveBeenCalled();
  });

  it("renders only the current run's sourced plan rows", () => {
    render(
      <AgentActivityPanel
        todos={[
          {
            id: "old",
            content: "Earlier task",
            status: "completed",
            sourceMessageId: "old-reply",
          },
          {
            id: "current",
            content: "Current task",
            status: "in_progress",
            sourceMessageId: "current-reply",
          },
        ]}
        toolExecutions={[]}
        messages={[
          { id: "old-reply", role: "assistant", parts: [] },
          { id: "new-turn", role: "user", parts: [] },
          { id: "current-reply", role: "assistant", parts: [] },
        ]}
      />,
    );
    expect(screen.getByText("Current task")).toBeVisible();
    expect(screen.queryByText("Earlier task")).toBeNull();
    expect(screen.getByText("0 / 1")).toBeVisible();
  });

  it("returns from the creation form when Escape reaches its closed role select", async () => {
    const user = userEvent.setup();
    const onCreateSubagent = jest.fn();
    render(
      <AgentActivityPanel
        todos={[]}
        toolExecutions={[]}
        onCreateSubagent={onCreateSubagent}
      />,
    );
    const trigger = screen.getByRole("button", { name: "New subagent" });
    await user.click(trigger);
    screen.getByRole("combobox", { name: "Role" }).focus();
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("form", { name: "Create a subagent" }),
    ).toBeNull();
    expect(trigger).toHaveFocus();
    expect(onCreateSubagent).not.toHaveBeenCalled();
  });

  it("retains supplied plan rows when the caller has no conversation context", () => {
    render(
      <AgentActivityPanel
        todos={[
          {
            id: "current",
            content: "Current task",
            status: "in_progress",
            sourceMessageId: "reply",
          },
        ]}
        toolExecutions={[]}
      />,
    );
    expect(screen.getByText("Current task")).toBeVisible();
    expect(screen.getByText("0 / 1")).toBeVisible();
  });

  it("keeps an awaiting-approval agent visible and selectable", () => {
    render(
      <AgentActivityPanel
        todos={[]}
        toolExecutions={[]}
        subagents={[
          { ...agent, status: "awaiting-approval", summary: undefined },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: /Active/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("Awaiting approval")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Show details for Ada" }),
    );
    expect(
      within(
        screen.getByRole("region", { name: "Agent task details" }),
      ).getByText("Awaiting approval"),
    ).toBeVisible();
  });
});
