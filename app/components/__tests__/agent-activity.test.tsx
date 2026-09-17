import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AgentActivityPanel } from "../AgentActivityPanel";
import { AgentRunSummaryBar } from "../AgentRunSummaryBar";
import {
  buildAgentActivitySnapshot,
  buildSubagentPrompt,
  canCreateSubagentInMode,
  extractSubagentsFromMessages,
  getChangedFilePaths,
  getCurrentRunMessages,
  getCurrentRunTodos,
} from "../agent-activity";
import type { SidebarContent, Todo } from "@/types/chat";

const todos: Todo[] = [
  { id: "plan", content: "Plan the change", status: "completed" },
  { id: "build", content: "Build the interface", status: "in_progress" },
  { id: "verify", content: "Verify the result", status: "pending" },
];

const executions: SidebarContent[] = [
  {
    path: "/app/page.tsx",
    content: "first",
    action: "editing",
    toolCallId: "file-1",
  },
  {
    path: "/app/page.tsx",
    content: "second",
    action: "writing",
    toolCallId: "file-2",
  },
  {
    path: "/app/readme.md",
    content: "read only",
    action: "reading",
    toolCallId: "file-3",
  },
  {
    command: "pnpm test",
    output: "ok",
    isExecuting: false,
    toolCallId: "terminal-1",
  },
];

const delegateMessages = [
  {
    role: "assistant",
    parts: [
      {
        type: "tool-delegate_task",
        toolCallId: "delegate-1",
        state: "output-available",
        input: {
          name: "Ada",
          role: "reviewer",
          task: "Review the interface",
        },
        output: {
          ok: true,
          agent: {
            id: "agent-1",
            name: "Ada",
            role: "reviewer",
            status: "completed",
            durationMs: 2400,
          },
          summary: "The interaction is coherent.",
          findings: [{ title: "Focus states are visible" }],
          nextActions: ["Run the browser check"],
          confidence: "high",
        },
      },
    ],
  },
];

describe("agent activity data", () => {
  it("counts distinct changed files and ignores read-only file activity", () => {
    expect(getChangedFilePaths(executions)).toEqual(["/app/page.tsx"]);

    const snapshot = buildAgentActivitySnapshot({
      todos,
      toolExecutions: executions,
      messages: delegateMessages,
      status: "streaming",
    });

    expect(snapshot.completedSteps).toBe(1);
    expect(snapshot.totalSteps).toBe(3);
    expect(snapshot.runningTasks).toBe(1);
    expect(snapshot.activeStep?.content).toBe("Build the interface");
    expect(snapshot.changedFiles).toBe(1);
    expect(snapshot.toolOperations).toBe(4);
    expect(snapshot.terminalOperations).toBe(1);
    expect(snapshot.subagents).toHaveLength(1);
    expect(snapshot.activeAgents).toBe(1);
    expect(snapshot.totalAgents).toBe(2);
  });

  it("reads real delegate_task results without inventing subagents", () => {
    expect(extractSubagentsFromMessages([])).toEqual([]);

    const [agent] = extractSubagentsFromMessages(delegateMessages);
    expect(agent).toMatchObject({
      id: "delegate-1",
      name: "Ada",
      role: "reviewer",
      status: "completed",
      summary: "The interaction is coherent.",
      confidence: "high",
      nextActions: ["Run the browser check"],
    });
    expect(agent.findings).toHaveLength(1);
  });

  it("keeps fallback delegate identities unique across persisted messages", () => {
    const messages = ["Ada", "Lin"].map((name, messageIndex) => ({
      id: `assistant-${messageIndex}`,
      role: "assistant",
      parts: [
        {
          type: "tool-delegate_task",
          state: "input-available",
          input: { name, role: "reviewer", task: `Review ${name}` },
        },
      ],
    }));

    expect(
      extractSubagentsFromMessages(messages).map((agent) => agent.name),
    ).toEqual(["Ada", "Lin"]);
  });

  it("scopes snapshot subagents to the latest user turn", () => {
    const snapshot = buildAgentActivitySnapshot({
      todos: [],
      toolExecutions: [],
      messages: [
        { id: "user-old", role: "user", parts: [] },
        {
          id: "assistant-old",
          role: "assistant",
          parts: [
            {
              type: "tool-delegate_task",
              toolCallId: "delegate-old",
              state: "output-available",
              input: { name: "Old", task: "Old task" },
            },
          ],
        },
        { id: "user-current", role: "user", parts: [] },
        {
          id: "assistant-current",
          role: "assistant",
          parts: [
            {
              type: "tool-delegate_task",
              toolCallId: "delegate-current",
              state: "input-available",
              input: { name: "Current", task: "Current task" },
            },
          ],
        },
      ],
    });

    expect(snapshot.subagents.map((agent) => agent.name)).toEqual(["Current"]);
    expect(snapshot.runningSubagents).toBe(1);
    expect(snapshot.label).toBe("Coordinating Current");
  });

  it("uses the latest concrete stream event instead of a generic working label", () => {
    const snapshot = buildAgentActivitySnapshot({
      todos: [],
      toolExecutions: [],
      status: "streaming",
      messages: [
        { role: "user", parts: [] },
        {
          role: "assistant",
          parts: [
            {
              type: "tool-find_skills",
              state: "input-available",
              input: { task: "Build a dashboard" },
            },
          ],
        },
      ],
    });

    expect(snapshot.label).toBe("Loading skills");
    expect(snapshot.label).not.toMatch(/working|starting agent/i);
  });

  it("counts the Build coordinator with its delegated agents", () => {
    const withoutDelegation = buildAgentActivitySnapshot({
      todos: [],
      toolExecutions: [],
      messages: [{ id: "user-current", role: "user", parts: [] }],
      status: "submitted",
    });

    expect(withoutDelegation.activeAgents).toBe(1);
    expect(withoutDelegation.totalAgents).toBe(1);

    const withDelegation = buildAgentActivitySnapshot({
      todos: [],
      toolExecutions: [],
      status: "streaming",
      subagents: [
        {
          id: "active-agent",
          name: "Lin",
          role: "debugger",
          task: "Trace the request",
          status: "running",
        },
        {
          id: "done-agent",
          name: "Ada",
          role: "reviewer",
          task: "Review the result",
          status: "completed",
        },
      ],
    });

    expect(withDelegation.activeAgents).toBe(2);
    expect(withDelegation.totalAgents).toBe(3);
    expect(withDelegation.runningSubagents).toBe(1);
    expect(withDelegation.subagents).toHaveLength(2);
  });

  it("keeps the coordinator in a completed run's total", () => {
    const snapshot = buildAgentActivitySnapshot({
      todos: [{ id: "done", content: "Finish the build", status: "completed" }],
      toolExecutions: [],
      status: "ready",
      subagents: [
        {
          id: "done-agent",
          name: "Ada",
          role: "reviewer",
          task: "Review the result",
          status: "completed",
        },
      ],
    });

    expect(snapshot.activeAgents).toBe(0);
    expect(snapshot.totalAgents).toBe(2);
    expect(snapshot.runningSubagents).toBe(0);
  });

  it("resets current-run counters at the latest user turn", () => {
    const messages = [
      { role: "user", parts: [] },
      { role: "assistant", parts: [{ type: "tool-file" }] },
      { role: "user", parts: [] },
      { role: "assistant", parts: [{ type: "tool-shell" }] },
    ];

    expect(getCurrentRunMessages(messages)).toEqual(messages.slice(2));
  });

  it("keeps sourced plans scoped to the current assistant turn", () => {
    const sourcedTodos: Todo[] = [
      {
        id: "old",
        content: "Old plan",
        status: "completed",
        sourceMessageId: "assistant-old",
      },
      {
        id: "current",
        content: "Current plan",
        status: "in_progress",
        sourceMessageId: "assistant-current",
      },
      { id: "legacy", content: "Legacy plan", status: "pending" },
    ];

    expect(
      getCurrentRunTodos(sourcedTodos, [
        { id: "user-current", role: "user", parts: [] },
        { id: "assistant-current", role: "assistant", parts: [] },
      ]),
    ).toEqual([sourcedTodos[1]]);
    expect(
      getCurrentRunTodos(sourcedTodos, [
        { id: "user-next", role: "user", parts: [] },
      ]),
    ).toEqual([]);
    expect(
      getCurrentRunTodos(
        [sourcedTodos[2]],
        [{ id: "user-legacy", role: "user", parts: [] }],
      ),
    ).toEqual([sourcedTodos[2]]);
  });

  it("builds the delegation instruction used by the chat queue", () => {
    expect(
      buildSubagentPrompt({
        name: "Lin",
        role: "product_designer",
        task: "Review the workspace",
      }),
    ).toBe(
      "Create and run a product designer subagent named Lin to: Review the workspace. Run the subagent now rather than only describing it.",
    );
  });

  it("only permits manual subagent creation in Agent mode", () => {
    expect(canCreateSubagentInMode("agent")).toBe(true);
    expect(canCreateSubagentInMode("ask")).toBe(false);
  });
});

describe("AgentActivityPanel", () => {
  it("shows explicit plan, file, tool, and subagent progress", () => {
    render(
      <AgentActivityPanel
        todos={todos}
        toolExecutions={executions}
        messages={delegateMessages}
        status="streaming"
      />,
    );

    // Real run totals remain available without competing with active work.
    expect(screen.getByText("2 (1 active)")).not.toBeVisible();
    fireEvent.click(screen.getByText("Run details"));
    expect(screen.getByText("2 (1 active)")).toBeVisible();
    expect(
      screen.getByText("Tool operations").nextElementSibling,
    ).toHaveTextContent("4");
    expect(
      screen.getByText("Changed files").nextElementSibling,
    ).toHaveTextContent("1");
    expect(screen.queryByText("Tasks active")).not.toBeInTheDocument();
    expect(screen.queryByText("Files changed")).not.toBeInTheDocument();
    expect(screen.queryByText("0 active, 1 total")).not.toBeInTheDocument();
    expect(
      screen
        .getAllByText("Build the interface")
        .find((element) => element.closest("li"))
        ?.closest("li"),
    ).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: /Done/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Review the interface")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Show details for Ada" }),
    );
    expect(
      screen.getByText("The interaction is coherent."),
    ).toBeInTheDocument();
    expect(screen.getByText("1 finding")).toBeInTheDocument();
    expect(screen.getByText("Run the browser check")).toBeInTheDocument();
    expect(screen.getAllByText("2.4s")).toHaveLength(2);
  });

  it("uses semantic contrast for primary, live, and completed activity text", () => {
    render(
      <AgentActivityPanel
        todos={todos}
        toolExecutions={executions}
        messages={delegateMessages}
        status="streaming"
      />,
    );

    expect(screen.getByRole("heading", { name: "Operations" })).toHaveClass(
      "text-foreground",
    );
    expect(
      screen
        .getAllByText("Build the interface")
        .find((element) => element.closest("li"))
        ?.closest("li"),
    ).toHaveClass("text-foreground");
    expect(screen.getByText("Verify the result").closest("li")).toHaveClass(
      "text-[var(--cursor-text-secondary)]",
    );
    expect(screen.getByText("Plan the change").closest("li")).toHaveClass(
      "text-muted-foreground",
    );
    expect(screen.getByText("Review the interface")).toHaveClass(
      "text-[var(--cursor-text-secondary)]",
    );
    // The live row pins the current phase to the foot of the trace. Its label
    // takes the same secondary role every other verb in the trace takes.
    const liveRow = document.querySelector('[data-ui="activity-live-row"]');
    expect(liveRow).not.toBeNull();
    expect(
      liveRow?.querySelector(".text-\\[var\\(--cursor-text-secondary\\)\\]"),
    ).not.toBeNull();
  });

  it("groups real subagents into Active and Done with explicit failed outcomes", () => {
    render(
      <AgentActivityPanel
        todos={[]}
        toolExecutions={[]}
        subagents={[
          {
            id: "working-agent",
            name: "Lin",
            role: "debugger",
            task: "Trace the failing request",
            status: "running",
          },
          {
            id: "done-agent",
            name: "Ada",
            role: "reviewer",
            task: "Review the interface",
            status: "completed",
            durationMs: 2_400,
          },
          {
            id: "failed-agent",
            name: "Mira",
            role: "researcher",
            task: "Collect the references",
            status: "failed",
            durationMs: 900,
            error: "The source was unavailable.",
          },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: /Active/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    const doneGroup = screen.getByRole("button", { name: /Done/ });
    expect(doneGroup).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Lin")).toBeVisible();
    expect(screen.getByText("Mira")).toBeVisible();
    expect(screen.getByText("Failed")).toBeVisible();
    expect(screen.getByText("Ada")).toBeVisible();

    fireEvent.click(doneGroup);
    expect(screen.queryByText("Ada")).toBeNull();
  });

  it("opens the done group when the last active subagent completes", () => {
    const { rerender } = render(
      <AgentActivityPanel
        todos={[]}
        toolExecutions={[]}
        subagents={[
          {
            id: "review-agent",
            name: "Ada",
            role: "reviewer",
            task: "Review the interface",
            status: "running",
          },
        ]}
      />,
    );

    expect(screen.queryByRole("button", { name: /Done/ })).toBeNull();

    rerender(
      <AgentActivityPanel
        todos={[]}
        toolExecutions={[]}
        subagents={[
          {
            id: "review-agent",
            name: "Ada",
            role: "reviewer",
            task: "Review the interface",
            status: "completed",
          },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: /Done/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("Ada")).toBeInTheDocument();
  });

  it("preserves an explicit done-group disclosure choice across status changes", () => {
    const runningAgent = {
      id: "running-agent",
      name: "Lin",
      role: "debugger" as const,
      task: "Trace the failing request",
      status: "running" as const,
    };
    const doneAgent = {
      id: "done-agent",
      name: "Ada",
      role: "reviewer" as const,
      task: "Review the interface",
      status: "completed" as const,
    };
    const { rerender } = render(
      <AgentActivityPanel
        todos={[]}
        toolExecutions={[]}
        subagents={[runningAgent, doneAgent]}
      />,
    );

    const doneGroup = screen.getByRole("button", { name: /Done/ });
    fireEvent.click(doneGroup);
    expect(doneGroup).toHaveAttribute("aria-expanded", "false");

    rerender(
      <AgentActivityPanel
        todos={[]}
        toolExecutions={[]}
        subagents={[{ ...runningAgent, status: "completed" }, doneAgent]}
      />,
    );

    expect(screen.getByRole("button", { name: /Done/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("Ada")).toBeNull();
  });

  it("only exposes subagent creation when a real callback is connected", () => {
    const onCreateSubagent = jest.fn();
    const { rerender } = render(
      <AgentActivityPanel todos={[]} toolExecutions={[]} />,
    );

    expect(screen.queryByRole("button", { name: "New subagent" })).toBeNull();

    rerender(
      <AgentActivityPanel
        todos={[]}
        toolExecutions={[]}
        onCreateSubagent={onCreateSubagent}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "New subagent" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Lin" },
    });
    fireEvent.change(screen.getByLabelText("Role"), {
      target: { value: "debugger" },
    });
    fireEvent.change(screen.getByLabelText("Task"), {
      target: { value: "Trace the failing request" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create subagent" }));

    expect(onCreateSubagent).toHaveBeenCalledWith({
      name: "Lin",
      role: "debugger",
      task: "Trace the failing request",
    });
  });

  it("says nothing at all about the run while it is at rest", () => {
    // A resting panel used to carry a hidden "Operations ready" status. The
    // live phase and elapsed time now ride the last row of the trace, so when
    // there is no run there is simply no status to announce.
    render(<AgentActivityPanel todos={[]} toolExecutions={[]} />);

    expect(screen.queryByText(/idle/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Operations ready")).not.toBeInTheDocument();
    expect(document.querySelector('[data-ui="activity-live-row"]')).toBeNull();
  });
});

describe("agent activity navigation and terminal state", () => {
  const pending = (toolCallId = "review-call") => ({
    role: "assistant",
    parts: [
      {
        type: "tool-delegate_task",
        toolCallId,
        state: "input-available",
        input: { agentId: "quality", task: "Review keyboard navigation" },
      },
    ],
  });
  const completed = () => ({
    role: "assistant",
    parts: [
      {
        ...pending().parts[0],
        state: "output-available",
        output: {
          ok: true,
          agent: {
            id: "runtime-random-id",
            profileId: "quality",
            name: "Probe",
            role: "reviewer",
            status: "completed",
            model: "GPT",
            durationMs: 2400,
          },
          summary: "Keyboard navigation works.",
          findings: [
            {
              title: "Focus retained",
              detail: "Back restores row focus.",
              priority: "low",
            },
          ],
          nextActions: ["Check dark mode", "Check narrow layout"],
          execution: {
            mode: "read-only-tools",
            steps: 2,
            toolCalls: 3,
            failedToolCalls: 1,
            toolsUsed: ["file", "list_files"],
            stopReason: "completed",
          },
        },
      },
    ],
  });

  it("keeps invocation identity stable while retaining server profile and execution facts", () => {
    const [live] = extractSubagentsFromMessages([pending()], "streaming");
    const [done] = extractSubagentsFromMessages([completed()], "ready");
    expect(live.id).toBe("review-call");
    expect(done.id).toBe(live.id);
    expect(done).toMatchObject({
      profileId: "quality",
      identity: "quality",
      model: "GPT",
      execution: {
        steps: 2,
        toolCalls: 3,
        failedToolCalls: 1,
        toolsUsed: ["file", "list_files"],
      },
    });
  });

  it.each(["ready", "error"] as const)(
    "does not leave unresolved delegates Active after %s",
    (status) => {
      const snapshot = buildAgentActivitySnapshot({
        todos: [],
        toolExecutions: [],
        messages: [pending()],
        status,
      });
      expect(snapshot.runningSubagents).toBe(0);
      expect(snapshot.subagents[0].status).toBe("interrupted");
    },
  );

  it.each([
    ["output-denied", undefined, "Action denied.", "not-approved"],
    [
      "output-error",
      undefined,
      "Stopped by user before the tool completed",
      "interrupted",
    ],
    [
      "output-available",
      { ok: false, error: "Read failed" },
      undefined,
      "failed",
    ],
    ["approval-requested", undefined, undefined, "awaiting-approval"],
  ] as const)(
    "honors real %s outcomes",
    (state, output, errorText, expected) => {
      const message = pending();
      const [agent] = extractSubagentsFromMessages(
        [
          {
            ...message,
            parts: [
              {
                ...message.parts[0],
                state: state as string,
                output,
                errorText,
              },
            ],
          },
        ],
        "streaming",
      );
      expect(agent.status).toBe(expected);
      if (errorText) expect(agent.error).toBe(errorText);
    },
  );

  it("opens a live detail, updates it in place on completion and restores focus on Back", () => {
    const { rerender } = render(
      <AgentActivityPanel
        todos={[]}
        toolExecutions={[]}
        messages={[pending()]}
        status="streaming"
      />,
    );
    const row = screen.getByRole("button", { name: /Show details for/ });
    row.focus();
    fireEvent.click(row);
    const back = screen.getByRole("button", { name: "Back to activity" });
    expect(back).toHaveFocus();
    const detail = within(
      screen.getByRole("region", { name: "Agent task details" }),
    );
    expect(detail.getByText("Review keyboard navigation")).toBeVisible();
    expect(screen.queryByText(/\d+s$/)).not.toBeInTheDocument();
    rerender(
      <AgentActivityPanel
        todos={[]}
        toolExecutions={[]}
        messages={[completed()]}
        status="ready"
      />,
    );
    expect(screen.getByRole("button", { name: "Back to activity" })).toBe(back);
    expect(screen.getByText("Keyboard navigation works.")).toBeVisible();
    expect(screen.getByText("Back restores row focus.")).toBeVisible();
    expect(screen.getByText("Check narrow layout")).toBeVisible();
    expect(screen.getByText("GPT")).not.toBeVisible();
    fireEvent.click(screen.getByText("Execution details"));
    expect(screen.getByText("GPT")).toBeVisible();
    expect(detail.getByText("2.4s")).toBeVisible();
    fireEvent.click(back);
    expect(
      screen.getByRole("button", { name: "Show details for Probe" }),
    ).toHaveFocus();
    expect(
      screen.queryByText("Keyboard navigation works."),
    ).not.toBeInTheDocument();
  });

  it("resolves a controlled older transcript selection outside the current-run list", () => {
    function Controlled() {
      const [selection, setSelection] = useState<string | null>("review-call");
      return (
        <AgentActivityPanel
          todos={[]}
          toolExecutions={[]}
          status="ready"
          messages={[
            completed(),
            { role: "user", parts: [{ type: "text", text: "New turn" }] },
          ]}
          selectedSubagentToolCallId={selection}
          onSelectSubagent={setSelection}
        />
      );
    }
    render(<Controlled />);
    expect(screen.getByText("Keyboard navigation works.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Back to activity" }));
    expect(
      screen.queryByRole("button", { name: "Show details for Probe" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("No activity yet")).toBeVisible();
  });

  it("keeps concurrent tasks from the same profile independently selectable", () => {
    render(
      <AgentActivityPanel
        todos={[]}
        toolExecutions={[]}
        status="streaming"
        messages={[
          {
            role: "assistant",
            parts: [
              pending("first").parts[0],
              {
                ...pending("second").parts[0],
                input: { agentId: "quality", task: "Check the second task" },
              },
            ],
          },
        ]}
      />,
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: /Show details for/ })[1],
    );
    const detail = within(
      screen.getByRole("region", { name: "Agent task details" }),
    );
    expect(detail.getByText("Check the second task")).toBeVisible();
    expect(
      detail.queryByText("Review keyboard navigation"),
    ).not.toBeInTheDocument();
  });

  it("can open legacy invocation ids consistently after an earlier turn", async () => {
    const user = userEvent.setup();
    render(
      <AgentActivityPanel
        todos={[]}
        toolExecutions={[]}
        status="streaming"
        messages={[
          { role: "user", parts: [] },
          {
            role: "assistant",
            parts: [{ type: "text", text: "Earlier reply" }],
          },
          { role: "user", parts: [] },
          {
            role: "assistant",
            parts: [
              {
                type: "tool-delegate_task",
                state: "input-available",
                input: { name: "Legacy", task: "Check the legacy selection" },
              },
            ],
          },
        ]}
      />,
    );
    const row = screen.getByRole("button", { name: "Show details for Legacy" });
    row.focus();
    await user.keyboard("{Enter}");
    expect(
      within(
        screen.getByRole("region", { name: "Agent task details" }),
      ).getByText("Check the legacy selection"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Back to activity" }),
    ).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(row).toHaveFocus();
  });

  it("keeps missing task selection reversible", () => {
    function MissingSelection() {
      const [selected, setSelected] = useState<string | null>("removed-call");
      return (
        <AgentActivityPanel
          todos={[]}
          toolExecutions={[]}
          selectedSubagentToolCallId={selected}
          onSelectSubagent={setSelected}
        />
      );
    }
    render(<MissingSelection />);
    expect(screen.getByText(/no longer available/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Back to activity" }));
    expect(screen.getByText("No activity yet")).toBeVisible();
  });

  it("shows terminal status with missing duration or result without claiming work continues", () => {
    render(
      <AgentActivityPanel
        todos={[]}
        toolExecutions={[]}
        subagents={[
          {
            id: "done",
            name: "Ada",
            role: "reviewer",
            task: "Review",
            status: "completed",
          },
        ]}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Show details for Ada" }),
    );
    expect(screen.queryByText("In progress")).not.toBeInTheDocument();
    expect(screen.queryByText(/still handling/)).not.toBeInTheDocument();
    expect(
      screen.getByText("No result was recorded for this task."),
    ).toBeVisible();
  });
});

describe("AgentRunSummaryBar", () => {
  it("keeps the toggle reachable while the activity panel is open", () => {
    // The strip used to remove itself once the panel opened, which was fine
    // while it duplicated the run summary -- but it is now a row of workspace
    // controls, and vanishing left no way to close the panel from where it was
    // opened. It stays, and reports the panel as expanded.
    render(
      <AgentRunSummaryBar
        todos={todos}
        toolExecutions={executions}
        messages={delegateMessages}
        status="streaming"
        panelOpen={true}
        onTogglePanel={jest.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Hide agent activity" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("offers a way back to the panel once it is closed", () => {
    const onTogglePanel = jest.fn();
    render(
      <AgentRunSummaryBar
        todos={todos}
        toolExecutions={executions}
        messages={delegateMessages}
        status="streaming"
        panelOpen={false}
        onTogglePanel={onTogglePanel}
      />,
    );

    const open = screen.getByRole("button", { name: "Show agent activity" });
    expect(open).toHaveAttribute("aria-expanded", "false");
    expect(open).toHaveAttribute("aria-controls", "agent-activity-panel");

    fireEvent.click(open);
    expect(onTogglePanel).toHaveBeenCalledTimes(1);
  });
});
