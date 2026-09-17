import {
  filterTasks,
  fromLocalDateTimeValue,
  scheduleLabel,
  taskCounts,
  toLocalDateTimeValue,
  type TaskListItem,
} from "../task-center-utils";

function task(overrides: Partial<TaskListItem> = {}): TaskListItem {
  return {
    _id: "task-1",
    title: "Review dependencies",
    prompt: "Review dependency changes.",
    status: "open",
    enabled: true,
    schedule_type: "manual",
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

describe("task center helpers", () => {
  const tasks = [
    task({ _id: "manual" }),
    task({
      _id: "scheduled",
      schedule_type: "recurring",
      schedule_expression: "Weekdays at 09:00",
      timezone: "Europe/Istanbul",
    }),
    task({
      _id: "completed",
      status: "completed",
      enabled: false,
      schedule_type: "once",
      scheduled_for: 1_700_000_000_000,
    }),
  ];

  it("keeps completed scheduled tasks out of the Scheduled view", () => {
    expect(filterTasks(tasks, "scheduled").map((item) => item._id)).toEqual([
      "scheduled",
    ]);
    expect(filterTasks(tasks, "completed").map((item) => item._id)).toEqual([
      "completed",
    ]);
  });

  it("returns truthful view counts", () => {
    expect(taskCounts(tasks)).toEqual({ all: 3, scheduled: 1, completed: 1 });
  });

  it("formats recurring metadata without inventing a next run", () => {
    expect(scheduleLabel(tasks[1])).toBe("Weekdays at 09:00 (Europe/Istanbul)");
    expect(scheduleLabel(tasks[0])).toBe("Manual");
  });

  it("round-trips local datetime input values", () => {
    const timestamp = fromLocalDateTimeValue("2026-07-14T09:30");
    expect(timestamp).toBeDefined();
    expect(toLocalDateTimeValue(timestamp)).toBe("2026-07-14T09:30");
    expect(fromLocalDateTimeValue("not-a-date")).toBeUndefined();
  });

  it("interprets one-time input in its explicit IANA time zone", () => {
    const timestamp = fromLocalDateTimeValue(
      "2026-07-14T09:30",
      "Europe/Istanbul",
    );
    expect(timestamp).toBe(Date.UTC(2026, 6, 14, 6, 30));
    expect(toLocalDateTimeValue(timestamp, "Europe/Istanbul")).toBe(
      "2026-07-14T09:30",
    );
  });

  it("rejects a wall-clock time skipped by daylight-saving transition", () => {
    expect(
      fromLocalDateTimeValue("2026-03-08T02:30", "America/New_York"),
    ).toBeUndefined();
  });
});
