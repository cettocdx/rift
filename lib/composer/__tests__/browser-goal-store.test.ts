import {
  browserTaskGoalStore,
  notifyTaskGoalChanged,
  onTaskGoalChanged,
  readActiveGoalRequestContext,
} from "../browser-goal-store";

describe("browser goal store", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("only exposes active goals to model requests", () => {
    expect(readActiveGoalRequestContext("task-1")).toBeUndefined();

    expect(browserTaskGoalStore.set("task-1", "Ship slash commands").ok).toBe(
      true,
    );
    expect(readActiveGoalRequestContext("task-1")).toEqual({
      objective: "Ship slash commands",
      status: "active",
    });

    expect(browserTaskGoalStore.pause("task-1").ok).toBe(true);
    expect(readActiveGoalRequestContext("task-1")).toBeUndefined();
  });

  it("notifies subscribers without leaking the objective", () => {
    const listener = jest.fn();
    const unsubscribe = onTaskGoalChanged(listener);

    notifyTaskGoalChanged("task-2");
    expect(listener).toHaveBeenCalledWith("task-2");

    unsubscribe();
    notifyTaskGoalChanged("task-3");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
