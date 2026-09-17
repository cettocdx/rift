import { describe, expect, it } from "@jest/globals";
import {
  assertTaskTimezone,
  nextRecurringRunAt,
  normalizeRecurringExpression,
  TaskScheduleError,
} from "../lib/taskSchedule";

describe("task schedule parsing", () => {
  it("normalizes the supported natural-language shortcuts to cron", () => {
    expect(normalizeRecurringExpression("Weekdays at 09:30")).toBe(
      "30 9 * * 1-5",
    );
    expect(normalizeRecurringExpression("daily at 18:05")).toBe("5 18 * * *");
    expect(normalizeRecurringExpression("every Monday at 07:00")).toBe(
      "0 7 * * 1",
    );
  });

  it("rejects schedules that are more frequent than once per hour", () => {
    expect(() => normalizeRecurringExpression("*/15 * * * *")).toThrow(
      "at most once per hour",
    );
    expect(() => normalizeRecurringExpression("0,30 * * * *")).toThrow(
      TaskScheduleError,
    );
  });

  it("rejects monthly expressions because the bounded runner is weekly", () => {
    expect(() => normalizeRecurringExpression("0 9 1 * *")).toThrow(
      "hourly, daily, or weekly",
    );
  });

  it("validates IANA time zones without silently falling back", () => {
    expect(assertTaskTimezone(" Europe/Istanbul ")).toBe("Europe/Istanbul");
    expect(() => assertTaskTimezone("Mars/Olympus")).toThrow(
      "valid IANA time zone",
    );
  });

  it("finds the next weekday occurrence in the requested time zone", () => {
    // Friday 2026-07-17 10:30 in Istanbul (UTC+3).
    const after = Date.UTC(2026, 6, 17, 7, 30);
    // Monday 2026-07-20 09:00 in Istanbul.
    expect(nextRecurringRunAt("0 9 * * 1-5", "Europe/Istanbul", after)).toBe(
      Date.UTC(2026, 6, 20, 6, 0),
    );
  });

  it("uses a strictly later minute for hourly schedules", () => {
    const after = Date.UTC(2026, 6, 14, 9, 0, 30);
    expect(nextRecurringRunAt("0 * * * *", "UTC", after)).toBe(
      Date.UTC(2026, 6, 14, 10, 0),
    );
  });
});
