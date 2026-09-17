import { act, fireEvent, render, screen } from "@testing-library/react";
import { ActiveGoalStatus } from "../ActiveGoalStatus";
import {
  browserTaskGoalStore,
  notifyTaskGoalChanged,
} from "@/lib/composer/browser-goal-store";

describe("ActiveGoalStatus", () => {
  beforeEach(() => window.localStorage.clear());

  it("renders, pauses, resumes and clears the current goal", () => {
    browserTaskGoalStore.set("task-1", "Finish the command system");
    render(<ActiveGoalStatus taskId="task-1" />);

    expect(screen.getByText("Finish the command system")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pause goal" }));
    expect(screen.getByText("Paused")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Resume goal" }));
    expect(screen.queryByText("Paused")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear goal" }));
    expect(screen.queryByTestId("active-goal-status")).not.toBeInTheDocument();
  });

  it("reacts to command updates", async () => {
    render(<ActiveGoalStatus taskId="task-2" />);
    expect(screen.queryByTestId("active-goal-status")).not.toBeInTheDocument();

    act(() => {
      browserTaskGoalStore.set("task-2", "Visible after slash command");
      notifyTaskGoalChanged("task-2");
    });
    expect(
      await screen.findByText("Visible after slash command"),
    ).toBeInTheDocument();
  });
});
