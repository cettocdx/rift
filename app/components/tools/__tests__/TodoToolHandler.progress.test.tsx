import { createContext } from "react";
import { render, screen, within } from "@testing-library/react";
import { TodoToolHandler } from "../TodoToolHandler";
import { TodoPanel } from "../../TodoPanel";
import type { Todo } from "@/types";

let mockTodos: Todo[] = [];
const mockTodoContext = createContext<Todo[]>([]);
jest.mock("../../../contexts/GlobalState", () => ({
  useGlobalState: () => ({
    todos: require("react").useContext(mockTodoContext),
    isTodoPanelExpanded: true,
    setIsTodoPanelExpanded: jest.fn(),
    sidebarOpen: false,
  }),
}));
jest.mock("../../../contexts/TodoBlockContext", () => ({
  useTodoBlockContext: () => ({
    autoOpenTodoBlock: jest.fn(),
    toggleTodoBlock: jest.fn(),
    isBlockExpanded: () => true,
  }),
}));
const initial: Todo[] = Array.from({ length: 6 }, (_, i) => ({
  id: `task-${i}`,
  content: `Task ${i + 1}`,
  status: i === 0 ? "in_progress" : "pending",
  sourceMessageId: "plan-message",
}));
const message = { id: "plan-message", role: "assistant", parts: [] } as const;
const part = {
  type: "tool-todo_write",
  toolCallId: "create-plan",
  state: "output-available",
  input: { merge: false, todos: initial },
  output: { currentTodos: initial },
};
function View() {
  return (
    <>
      <section aria-label="Transcript plan">
        <TodoToolHandler
          message={message as never}
          part={part}
          status="streaming"
        />
      </section>
      <section aria-label="Live plan">
        <TodoPanel status="streaming" />
      </section>
    </>
  );
}
function TestView() {
  return (
    <mockTodoContext.Provider value={mockTodos}>
      <View />
    </mockTodoContext.Provider>
  );
}
beforeEach(() => {
  mockTodos = initial;
});
it("shows a structured tool failure instead of a successful plan", () => {
  render(
    <TodoToolHandler
      message={message as never}
      status="ready"
      part={{
        ...part,
        output: { error: "Failed to manage todos: storage unavailable" },
      }}
    />,
  );
  expect(screen.getByText("Todo creation failed")).toBeInTheDocument();
  expect(
    screen.getByText("Failed to manage todos: storage unavailable"),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("0/6")).not.toBeInTheDocument();
});
it("updates the explanation when only errorText changes", () => {
  const failed = {
    ...part,
    state: "output-error",
    errorText: "Plan validation failed",
  };
  const { rerender } = render(
    <TodoToolHandler message={message as never} status="ready" part={failed} />,
  );
  rerender(
    <TodoToolHandler
      message={message as never}
      status="ready"
      part={{ ...failed, errorText: "Plan needs unique task ids" }}
    />,
  );
  expect(screen.getByText("Plan needs unique task ids")).toBeInTheDocument();
  expect(screen.queryByText("Plan validation failed")).not.toBeInTheDocument();
});
it("uses resolved tasks in both counters, not the ordinal of the active task", () => {
  render(<TestView />);
  expect(
    within(
      screen.getByRole("region", { name: "Transcript plan" }),
    ).getByLabelText("0/6"),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole("region", { name: "Live plan" })).getByText(
      "0 / 6",
    ),
  ).toBeInTheDocument();
});
it("updates an existing transcript block as the plan advances without a new tool result", () => {
  const { rerender } = render(<TestView />);
  mockTodos = initial.map((todo, i) => ({
    ...todo,
    status: i < 2 ? "completed" : i === 2 ? "in_progress" : "pending",
  }));
  rerender(<TestView />);
  const transcript = within(
    screen.getByRole("region", { name: "Transcript plan" }),
  );
  expect(transcript.getByLabelText("2/6")).toBeInTheDocument();
  expect(
    transcript.getByText("Task 1").closest('[data-testid="todo-item"]'),
  ).toHaveAttribute("data-status", "completed");
  expect(
    within(screen.getByRole("region", { name: "Live plan" })).getByText(
      "2 / 6",
    ),
  ).toBeInTheDocument();
});
it("retains historical snapshots when another plan reuses task ids", () => {
  mockTodos = initial.map((todo) => ({
    ...todo,
    status: "completed",
    sourceMessageId: "different-message",
  }));
  render(<TestView />);
  expect(screen.getByLabelText("0/6")).toBeInTheDocument();
});
it("updates the total when tasks are added to the same plan", () => {
  mockTodos = [
    ...initial,
    {
      id: "added",
      content: "New task",
      status: "pending",
      sourceMessageId: "plan-message",
    },
  ];
  render(<TestView />);
  expect(screen.getByLabelText("0/7")).toBeInTheDocument();
  expect(screen.getAllByText("New task")).toHaveLength(2);
});
it("falls back to the stored output when live state is empty", () => {
  mockTodos = [];
  render(<TestView />);
  expect(screen.getByLabelText("0/6")).toBeInTheDocument();
});
it("does not count an active task as resolved when work happens out of order", () => {
  mockTodos = initial.map((todo, i) => ({
    ...todo,
    status: i === 0 ? "cancelled" : i === 5 ? "in_progress" : "pending",
  }));
  render(<TestView />);
  expect(screen.getByLabelText("1/6")).toBeInTheDocument();
  expect(
    within(screen.getByRole("region", { name: "Live plan" })).getByText(
      "1 / 6",
    ),
  ).toBeInTheDocument();
});
it("keeps a finished plan up to date when the composer progress bar disappears", () => {
  mockTodos = initial.map((todo) => ({ ...todo, status: "completed" }));
  render(<TestView />);
  expect(screen.getByLabelText("6/6")).toBeInTheDocument();
  expect(
    screen.getByRole("region", { name: "Live plan" }),
  ).toBeEmptyDOMElement();
});
it("removes deleted tasks from the transcript's current plan", () => {
  mockTodos = initial.slice(0, 5);
  render(<TestView />);
  expect(screen.getByLabelText("0/5")).toBeInTheDocument();
  expect(screen.queryByText("Task 6")).not.toBeInTheDocument();
});
