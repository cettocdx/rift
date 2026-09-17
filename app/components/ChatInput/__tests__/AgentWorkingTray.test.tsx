import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentWorkingTray } from "../AgentWorkingTray";
import { extractSubagentsFromMessages } from "../../agent-activity";
import {
  openAgentActivity,
  OPEN_AGENT_ACTIVITY_EVENT,
} from "@/lib/workbench/events";
const messages = [
  {
    role: "assistant",
    parts: [
      {
        type: "tool-delegate_task",
        state: "input-available",
        input: { name: "Old" },
      },
    ],
  },
  { id: "turn", role: "user", parts: [] },
  {
    role: "assistant",
    parts: [
      {
        type: "tool-delegate_task",
        state: "input-available",
        input: { name: "Ada", task: "Review all keyboard interactions" },
      },
      {
        type: "tool-delegate_task",
        toolCallId: "queued",
        state: "input-streaming",
        input: { name: "Lin" },
      },
      {
        type: "tool-delegate_task",
        toolCallId: "approval",
        state: "approval-requested",
        input: { name: "Sam" },
      },
      {
        type: "tool-delegate_task",
        toolCallId: "done",
        state: "output-available",
        input: { name: "Jo" },
        output: {
          ok: true,
          agent: { status: "completed" },
          summary: "Checked every route",
        },
      },
    ],
  },
];
const agents = () =>
  extractSubagentsFromMessages(messages, "streaming", { currentRunOnly: true });
it("renders nothing without actual delegates", () => {
  const { container } = render(
    <AgentWorkingTray agents={[]} runKey="a" onSelectAgent={() => {}} />,
  );
  expect(container).toBeEmptyDOMElement();
});
it("distinguishes working, queued, approval and completed receipts", () => {
  render(
    <AgentWorkingTray agents={agents()} runKey="a" onSelectAgent={() => {}} />,
  );
  expect(screen.getByText("1 working")).toBeInTheDocument();
  expect(screen.getByText("Queued")).toBeInTheDocument();
  expect(screen.getByText("Awaiting approval")).toBeInTheDocument();
  expect(screen.getByText("Completed")).toBeInTheDocument();
  expect(screen.queryByText("Old")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /Jo/ }),
  ).toHaveAccessibleDescription("Checked every route");
});
it("opens the exact legacy invocation through the existing event", async () => {
  const received = jest.fn();
  window.addEventListener(OPEN_AGENT_ACTIVITY_EVENT, received);
  try {
    render(
      <AgentWorkingTray
        agents={agents()}
        runKey="a"
        onSelectAgent={(id) => openAgentActivity({ toolCallId: id })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Ada/ }));
    expect(received.mock.calls[0][0].detail).toEqual({
      toolCallId: "message-2-delegate-0",
    });
  } finally {
    window.removeEventListener(OPEN_AGENT_ACTIVITY_EVENT, received);
  }
});
it.each(["ready", "error"] as const)(
  "does not claim unresolved collaborators are working after parent %s",
  (status) => {
    render(
      <AgentWorkingTray
        agents={extractSubagentsFromMessages(messages, status, {
          currentRunOnly: true,
        })}
        runKey="a"
        onSelectAgent={() => {}}
      />,
    );
    expect(screen.queryByText("1 working")).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("button", { name: /Ada/ })).getByText(
        "Interrupted",
      ),
    ).toBeInTheDocument();
  },
);
it("retains collapse during arrivals/completion without moving focus, and resets for a new run", async () => {
  const user = userEvent.setup();
  const onSelectAgent = jest.fn();
  const view = render(
    <>
      <textarea aria-label="Draft" />
      <AgentWorkingTray
        agents={agents()}
        runKey="a"
        onSelectAgent={onSelectAgent}
      />
    </>,
  );
  await user.tab();
  await user.tab();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("button", { name: /Collaborators/ })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await user.click(screen.getByRole("textbox"));
  view.rerender(
    <>
      <textarea aria-label="Draft" />
      <AgentWorkingTray
        agents={agents().slice(0, 2)}
        runKey="a"
        onSelectAgent={onSelectAgent}
      />
    </>,
  );
  expect(screen.getByRole("textbox")).toHaveFocus();
  expect(screen.queryByRole("button", { name: /Ada/ })).not.toBeInTheDocument();
  view.rerender(
    <>
      <textarea aria-label="Draft" />
      <AgentWorkingTray
        agents={agents()}
        runKey="b"
        onSelectAgent={onSelectAgent}
      />
    </>,
  );
  expect(screen.getByRole("button", { name: /Collaborators/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(screen.getByRole("textbox")).toHaveFocus();
});
it("does not resurrect collapsed A after visiting B without toggling B", async () => {
  const onSelectAgent = jest.fn();
  const content = (runKey: string) => (
    <>
      <textarea aria-label="Draft" />
      <AgentWorkingTray
        agents={agents()}
        runKey={runKey}
        onSelectAgent={onSelectAgent}
      />
    </>
  );
  const view = render(content("a"));
  await userEvent.click(screen.getByRole("button", { name: /Collaborators/ }));
  expect(screen.getByRole("button", { name: /Collaborators/ })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  screen.getByRole("textbox").focus();
  view.rerender(content("b"));
  expect(screen.getByRole("button", { name: /Collaborators/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  view.rerender(content("a"));
  expect(screen.getByRole("button", { name: /Collaborators/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(screen.getByRole("textbox")).toHaveFocus();
  expect(onSelectAgent).not.toHaveBeenCalled();
});
