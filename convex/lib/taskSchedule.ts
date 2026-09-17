const MINUTE_MS = 60_000;
const MAX_SEARCH_MINUTES = 8 * 24 * 60 + 180;

const WEEKDAY_ALIASES: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

const FORMATTER_WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export class TaskScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskScheduleError";
  }
}

function parseNumber(
  value: string,
  min: number,
  max: number,
  aliases?: Record<string, number>,
): number {
  const normalized = value.trim().toLowerCase();
  const alias = aliases?.[normalized];
  const parsed = alias ?? Number(normalized);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new TaskScheduleError(`Invalid cron value: ${value}`);
  }
  return parsed;
}

function parseField(
  raw: string,
  min: number,
  max: number,
  aliases?: Record<string, number>,
): Set<number> {
  const values = new Set<number>();
  for (const segment of raw.split(",")) {
    const [base, rawStep, ...extra] = segment.trim().split("/");
    if (!base || extra.length > 0) {
      throw new TaskScheduleError(`Invalid cron field: ${raw}`);
    }
    const step = rawStep === undefined ? 1 : Number(rawStep);
    if (!Number.isInteger(step) || step < 1 || step > max - min + 1) {
      throw new TaskScheduleError(`Invalid cron step: ${rawStep ?? ""}`);
    }

    let start: number;
    let end: number;
    if (base === "*") {
      start = min;
      end = max;
    } else if (base.includes("-")) {
      const range = base.split("-");
      if (range.length !== 2) {
        throw new TaskScheduleError(`Invalid cron range: ${base}`);
      }
      start = parseNumber(range[0], min, max, aliases);
      end = parseNumber(range[1], min, max, aliases);
      if (start > end) {
        throw new TaskScheduleError(`Invalid cron range: ${base}`);
      }
    } else {
      start = parseNumber(base, min, max, aliases);
      end = start;
    }

    for (let value = start; value <= end; value += step) {
      values.add(value === 7 && max === 7 ? 0 : value);
    }
  }

  if (values.size === 0) {
    throw new TaskScheduleError(`Cron field cannot be empty: ${raw}`);
  }
  return values;
}

function naturalScheduleToCron(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  const timed = (pattern: RegExp, days: string) => {
    const match = normalized.match(pattern);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) {
      throw new TaskScheduleError(
        "Recurring time must use a valid HH:MM value",
      );
    }
    return `${minute} ${hour} * * ${days}`;
  };

  const weekdays = timed(/^weekdays(?: at)? (\d{1,2}):(\d{2})$/, "1-5");
  if (weekdays) return weekdays;
  const daily = timed(/^daily(?: at)? (\d{1,2}):(\d{2})$/, "*");
  if (daily) return daily;

  const weekly = normalized.match(
    /^(?:weekly on |every )?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)(?: at)? (\d{1,2}):(\d{2})$/,
  );
  if (!weekly) return null;
  const weekday = WEEKDAY_ALIASES[weekly[1]];
  const hour = Number(weekly[2]);
  const minute = Number(weekly[3]);
  if (weekday === undefined || hour > 23 || minute > 59) {
    throw new TaskScheduleError("Recurring schedule is invalid");
  }
  return `${minute} ${hour} * * ${weekday}`;
}

export function assertTaskTimezone(value: string | undefined): string {
  const timezone = value?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
  } catch {
    throw new TaskScheduleError("Time zone must be a valid IANA time zone");
  }
  return timezone;
}

export function normalizeRecurringExpression(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new TaskScheduleError("Recurring schedule cannot be empty");
  }
  const expression =
    naturalScheduleToCron(trimmed) ?? trimmed.replace(/\s+/g, " ");
  const fields = expression.split(" ");
  if (fields.length !== 5) {
    throw new TaskScheduleError(
      "Use a five-field cron expression, for example 0 9 * * 1-5",
    );
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  if (dayOfMonth !== "*" || month !== "*") {
    throw new TaskScheduleError(
      "Recurring tasks currently support hourly, daily, or weekly schedules",
    );
  }
  const minutes = parseField(minute, 0, 59);
  parseField(hour, 0, 23);
  parseField(dayOfWeek, 0, 7, WEEKDAY_ALIASES);
  if (minutes.size !== 1) {
    throw new TaskScheduleError(
      "Recurring tasks can run at most once per hour",
    );
  }
  return expression;
}

type ParsedRecurringSchedule = {
  minutes: Set<number>;
  hours: Set<number>;
  weekdays: Set<number>;
};

function parseRecurringSchedule(expression: string): ParsedRecurringSchedule {
  const [minute, hour, _dayOfMonth, _month, dayOfWeek] =
    normalizeRecurringExpression(expression).split(" ");
  return {
    minutes: parseField(minute, 0, 59),
    hours: parseField(hour, 0, 23),
    weekdays: parseField(dayOfWeek, 0, 7, WEEKDAY_ALIASES),
  };
}

function zonedParts(
  formatter: Intl.DateTimeFormat,
  timestamp: number,
): { minute: number; hour: number; weekday: number } {
  const parts = formatter.formatToParts(new Date(timestamp));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const minute = Number(get("minute"));
  const hour = Number(get("hour"));
  const weekday = FORMATTER_WEEKDAYS[get("weekday") ?? ""];
  if (
    !Number.isInteger(minute) ||
    !Number.isInteger(hour) ||
    weekday === undefined
  ) {
    throw new TaskScheduleError("Could not evaluate recurring schedule");
  }
  return { minute, hour: hour === 24 ? 0 : hour, weekday };
}

export function nextRecurringRunAt(
  expression: string,
  timezoneValue: string | undefined,
  afterTimestamp: number,
): number {
  if (!Number.isFinite(afterTimestamp)) {
    throw new TaskScheduleError("Schedule reference time is invalid");
  }
  const timezone = assertTaskTimezone(timezoneValue);
  const schedule = parseRecurringSchedule(expression);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  let candidate =
    Math.floor(afterTimestamp / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  for (let checked = 0; checked < MAX_SEARCH_MINUTES; checked += 1) {
    const parts = zonedParts(formatter, candidate);
    if (
      schedule.minutes.has(parts.minute) &&
      schedule.hours.has(parts.hour) &&
      schedule.weekdays.has(parts.weekday)
    ) {
      return candidate;
    }
    candidate += MINUTE_MS;
  }
  throw new TaskScheduleError(
    "Recurring schedule must have at least one occurrence each week",
  );
}
