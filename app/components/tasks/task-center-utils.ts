export type TaskView = "all" | "scheduled" | "completed";

export interface TaskListItem {
  _id: string;
  title: string;
  prompt: string;
  purpose?: "security" | "app";
  status: "open" | "completed";
  enabled: boolean;
  schedule_type: "manual" | "once" | "recurring";
  scheduled_for?: number;
  schedule_expression?: string;
  timezone?: string;
  scheduler_state?: "scheduled" | "inactive" | "invalid";
  schedule_error?: string;
  next_run_at?: number;
  created_at: number;
  updated_at: number;
  completed_at?: number;
}

export function filterTasks<T extends TaskListItem>(
  tasks: readonly T[],
  view: TaskView,
): T[] {
  if (view === "scheduled") {
    return tasks.filter(
      (task) => task.status !== "completed" && task.schedule_type !== "manual",
    );
  }
  if (view === "completed") {
    return tasks.filter((task) => task.status === "completed");
  }
  return [...tasks];
}

export function taskCounts(tasks: readonly TaskListItem[]) {
  return {
    all: tasks.length,
    scheduled: tasks.filter(
      (task) => task.status !== "completed" && task.schedule_type !== "manual",
    ).length,
    completed: tasks.filter((task) => task.status === "completed").length,
  };
}

export function scheduleLabel(task: TaskListItem): string {
  if (task.schedule_type === "manual") return "Manual";
  if (task.schedule_type === "recurring") {
    const expression = task.schedule_expression?.trim() || "Recurring";
    return task.timezone ? `${expression} (${task.timezone})` : expression;
  }
  if (task.scheduled_for === undefined) return "One-time schedule";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      ...(task.timezone ? { timeZone: task.timezone } : {}),
    }).format(new Date(task.scheduled_for));
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(task.scheduled_for));
  }
}

function zonedDateTimeParts(timestamp: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

export function toLocalDateTimeValue(
  timestamp?: number,
  timezone?: string,
): string {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  try {
    if (timezone) {
      const parts = zonedDateTimeParts(timestamp, timezone);
      return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(
        parts.hour,
      )}:${pad(parts.minute)}`;
    }
  } catch {
    // Fall through to the browser's local time for legacy invalid zones.
  }
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalDateTimeValue(
  value: string,
  timezone?: string,
): number | undefined {
  if (!value.trim()) return undefined;
  if (!timezone) {
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return undefined;
  const expected = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  const wallClockUtc = Date.UTC(
    expected.year,
    expected.month - 1,
    expected.day,
    expected.hour,
    expected.minute,
  );
  let candidate = wallClockUtc;
  try {
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const actual = zonedDateTimeParts(candidate, timezone);
      const representedAsUtc = Date.UTC(
        actual.year,
        actual.month - 1,
        actual.day,
        actual.hour,
        actual.minute,
      );
      candidate += wallClockUtc - representedAsUtc;
    }
    const verified = zonedDateTimeParts(candidate, timezone);
    return Object.entries(expected).every(
      ([key, expectedValue]) =>
        verified[key as keyof typeof verified] === expectedValue,
    )
      ? candidate
      : undefined;
  } catch {
    return undefined;
  }
}
