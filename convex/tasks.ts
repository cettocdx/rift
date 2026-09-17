import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { validateServiceKey } from "./lib/utils";
import { requireBotTaskBinding } from "./lib/botTaskBindings";
import {
  assertTaskTimezone,
  nextRecurringRunAt,
  normalizeRecurringExpression,
  TaskScheduleError,
} from "./lib/taskSchedule";

const MAX_TASKS_PER_USER = 250;
const MAX_RUNS_PER_TASK = 100;
const MAX_TITLE_LENGTH = 120;
const MAX_PROMPT_LENGTH = 8_000;
const MAX_SCHEDULE_EXPRESSION_LENGTH = 240;
const MAX_TIMEZONE_LENGTH = 80;
const MAX_DISPATCH_BATCH = 10;
const MAX_DISPATCH_CANDIDATES = 100;
const DISPATCH_LEASE_MS = 2 * 60_000;
const RUN_LEASE_MS = 70 * 60_000;
const MAX_BACKEND_ID_LENGTH = 200;
const SCHEDULED_TASKS_PREMIUM_ERROR =
  "Automatic schedules require RIFT Pro or Max";
const HACK_TASKS_DEDICATED_ERROR =
  "Security tasks must be run from the dedicated Hack Workbench";
const ENTITLED_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "on_trial",
  "past_due",
  "cancelled",
]);

const taskStatusValidator = v.union(v.literal("open"), v.literal("completed"));

const scheduleTypeValidator = v.union(
  v.literal("manual"),
  v.literal("once"),
  v.literal("recurring"),
);

const taskPurposeValidator = v.union(v.literal("security"), v.literal("app"));

const runStatusValidator = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("canceled"),
);

const schedulerStateValidator = v.union(
  v.literal("scheduled"),
  v.literal("inactive"),
  v.literal("invalid"),
);

const subscriptionValidator = v.union(
  v.literal("free"),
  v.literal("pro"),
  v.literal("pro-plus"),
  v.literal("ultra"),
  v.literal("team"),
);

const taskReturnValidator = v.object({
  _id: v.id("tasks"),
  project_id: v.optional(v.id("projects")),
  assignee_bot_id: v.optional(v.id("project_bots")),
  bot_meeting_id: v.optional(v.id("bot_meetings")),
  title: v.string(),
  prompt: v.string(),
  purpose: taskPurposeValidator,
  status: taskStatusValidator,
  enabled: v.boolean(),
  schedule_type: scheduleTypeValidator,
  scheduled_for: v.optional(v.number()),
  schedule_expression: v.optional(v.string()),
  timezone: v.optional(v.string()),
  scheduler_state: v.optional(schedulerStateValidator),
  schedule_error: v.optional(v.string()),
  next_run_at: v.optional(v.number()),
  created_at: v.number(),
  updated_at: v.number(),
  completed_at: v.optional(v.number()),
});

function authedUserId(subject: string): string {
  return subject.split("|")[0];
}

async function requireAuthedUserId(ctx: {
  auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
}): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Unauthorized: User not authenticated",
    });
  }
  return authedUserId(identity.subject);
}

function requireText(value: string, label: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new ConvexError({
      code: "INVALID_TASK",
      message: `${label} cannot be empty`,
    });
  }
  if (normalized.length > maxLength) {
    throw new ConvexError({
      code: "INVALID_TASK",
      message: `${label} must be ${maxLength} characters or fewer`,
    });
  }
  return normalized;
}

function optionalTrimmedText(
  value: string | undefined,
  label: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) {
    throw new ConvexError({
      code: "INVALID_TASK",
      message: `${label} must be ${maxLength} characters or fewer`,
    });
  }
  return normalized;
}

const isSecurityTask = (purpose: "security" | "app" | undefined) =>
  (purpose ?? "security") === "security";

async function retireSecurityTask(
  ctx: { db: { patch: (id: any, value: any) => Promise<any> } },
  task: any,
  now: number,
) {
  await ctx.db.patch(task._id, {
    enabled: false,
    scheduler_state: "inactive",
    next_run_at: undefined,
    schedule_error: HACK_TASKS_DEDICATED_ERROR,
    schedule_version: (task.schedule_version ?? 0) + 1,
    updated_at: now,
  });
}

export function normalizeSchedule(
  args: {
    scheduleType: "manual" | "once" | "recurring";
    scheduledFor?: number;
    scheduleExpression?: string;
    timezone?: string;
  },
  now: number,
) {
  if (args.scheduleType === "manual") {
    return {
      schedule_type: args.scheduleType,
      scheduled_for: undefined,
      schedule_expression: undefined,
      timezone: undefined,
      scheduler_state: "inactive" as const,
      schedule_error: undefined,
      next_run_at: undefined,
    };
  }

  const timezoneValue = optionalTrimmedText(
    args.timezone,
    "Time zone",
    MAX_TIMEZONE_LENGTH,
  );
  let timezone: string;
  try {
    timezone = assertTaskTimezone(timezoneValue);
  } catch (error) {
    throw invalidScheduleError(error);
  }

  if (args.scheduleType === "once") {
    if (
      args.scheduledFor === undefined ||
      !Number.isFinite(args.scheduledFor)
    ) {
      throw new ConvexError({
        code: "INVALID_TASK",
        message: "A valid date and time is required for a one-time schedule",
      });
    }
    if (args.scheduledFor <= now) {
      throw new ConvexError({
        code: "INVALID_TASK",
        message: "One-time schedules must be in the future",
      });
    }
    return {
      schedule_type: args.scheduleType,
      scheduled_for: args.scheduledFor,
      schedule_expression: undefined,
      timezone,
      scheduler_state: "scheduled" as const,
      schedule_error: undefined,
      next_run_at: args.scheduledFor,
    };
  }

  const rawScheduleExpression = requireText(
    args.scheduleExpression ?? "",
    "Recurring schedule",
    MAX_SCHEDULE_EXPRESSION_LENGTH,
  );
  let scheduleExpression: string;
  let nextRunAt: number;
  try {
    scheduleExpression = normalizeRecurringExpression(rawScheduleExpression);
    nextRunAt = nextRecurringRunAt(scheduleExpression, timezone, now);
  } catch (error) {
    throw invalidScheduleError(error);
  }
  return {
    schedule_type: args.scheduleType,
    scheduled_for: undefined,
    schedule_expression: scheduleExpression,
    timezone,
    scheduler_state: "scheduled" as const,
    schedule_error: undefined,
    next_run_at: nextRunAt,
  };
}

function invalidScheduleError(error: unknown): ConvexError<{
  code: string;
  message: string;
}> {
  return new ConvexError({
    code: "INVALID_TASK",
    message:
      error instanceof TaskScheduleError
        ? error.message
        : "Schedule could not be validated",
  });
}

async function getOwnedTask(
  ctx: { db: { get: (id: any) => Promise<any> } },
  id: any,
  userId: string,
) {
  const task = await ctx.db.get(id);
  if (!task) return null;
  // Do not reveal whether an ID belongs to another account. User-facing
  // mutations treat missing and foreign rows identically.
  if (task.user_id !== userId) return null;
  return task;
}

async function cancelQueuedRunsForTask(
  ctx: { db: any },
  taskId: any,
  userId: string,
  now: number,
) {
  const queuedRuns = await ctx.db
    .query("task_runs")
    .withIndex("by_user_task_and_started", (q: any) =>
      q.eq("user_id", userId).eq("task_id", taskId),
    )
    .order("desc")
    .take(MAX_RUNS_PER_TASK);
  await Promise.all(
    queuedRuns
      .filter((run: any) => run.status === "queued")
      .map((run: any) =>
        ctx.db.patch(run._id, {
          status: "canceled",
          finished_at: now,
          error_message: "Canceled because the task schedule changed",
          dispatch_lease_owner: undefined,
          dispatch_lease_until: undefined,
        }),
      ),
  );
}

export const listForUser = query({
  args: {},
  returns: v.array(taskReturnValidator),
  handler: async (ctx) => {
    const userId = await requireAuthedUserId(ctx);
    const rows = await ctx.db
      .query("tasks")
      .withIndex("by_user_and_updated", (q) => q.eq("user_id", userId))
      .order("desc")
      .collect();

    return rows.map((row) => ({
      _id: row._id,
      project_id: row.project_id,
      assignee_bot_id: row.assignee_bot_id,
      bot_meeting_id: row.bot_meeting_id,
      title: row.title,
      prompt: row.prompt,
      purpose: row.purpose ?? "security",
      status: row.status,
      enabled: row.enabled,
      schedule_type: row.schedule_type,
      scheduled_for: row.scheduled_for,
      schedule_expression: row.schedule_expression,
      timezone: row.timezone,
      scheduler_state: row.scheduler_state,
      schedule_error: row.schedule_error,
      next_run_at: row.next_run_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at,
    }));
  },
});

export const listRecentRuns = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.id("task_runs"),
      task_id: v.id("tasks"),
      task_title: v.string(),
      run_id: v.string(),
      status: runStatusValidator,
      chat_id: v.optional(v.string()),
      started_at: v.number(),
      finished_at: v.optional(v.number()),
      error_message: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await requireAuthedUserId(ctx);
    const requestedLimit = Math.floor(args.limit ?? 20);
    const limit = Math.min(50, Math.max(1, requestedLimit));
    const rows = await ctx.db
      .query("task_runs")
      .withIndex("by_user_and_started", (q) => q.eq("user_id", userId))
      .order("desc")
      .take(limit);

    const taskIds = [...new Set(rows.map((row) => row.task_id))];
    const tasks = await Promise.all(taskIds.map((id) => ctx.db.get(id)));
    const taskTitles = new Map(
      tasks
        .filter((task) => task?.user_id === userId)
        .map((task) => [task!._id, task!.title]),
    );

    return rows.flatMap((row) => {
      const taskTitle = taskTitles.get(row.task_id);
      if (!taskTitle) return [];
      return [
        {
          _id: row._id,
          task_id: row.task_id,
          task_title: taskTitle,
          run_id: row.agent_run_id ?? row.worker_run_id ?? row.run_id,
          status: row.status,
          chat_id: row.chat_id,
          started_at: row.started_at,
          finished_at: row.finished_at,
          error_message: row.error_message,
        },
      ];
    });
  },
});

export const createTask = mutation({
  args: {
    projectId: v.optional(v.id("projects")),
    assigneeBotId: v.optional(v.id("project_bots")),
    title: v.string(),
    prompt: v.string(),
    purpose: v.optional(taskPurposeValidator),
    scheduleType: scheduleTypeValidator,
    scheduledFor: v.optional(v.number()),
    scheduleExpression: v.optional(v.string()),
    timezone: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    id: v.optional(v.id("tasks")),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const userId = await requireAuthedUserId(ctx);
    const existing = await ctx.db
      .query("tasks")
      .withIndex("by_user_and_updated", (q) => q.eq("user_id", userId))
      .take(MAX_TASKS_PER_USER);
    if (existing.length >= MAX_TASKS_PER_USER) {
      return { success: false, error: "Task limit reached" };
    }

    const title = requireText(args.title, "Title", MAX_TITLE_LENGTH);
    const prompt = requireText(args.prompt, "Instructions", MAX_PROMPT_LENGTH);
    const purpose = args.purpose ?? "app";
    if (purpose === "security") {
      return { success: false, error: HACK_TASKS_DEDICATED_ERROR };
    }
    if (args.scheduleType !== "manual") {
      const subscription = await resolveSubscriptionForBackend(ctx, userId);
      if (subscription === "free") {
        return {
          success: false,
          error: SCHEDULED_TASKS_PREMIUM_ERROR,
        };
      }
    }
    const binding = {
      project_id: args.projectId,
      assignee_bot_id: args.assigneeBotId,
    };
    await requireBotTaskBinding(ctx.db, userId, binding);
    const now = Date.now();
    const schedule = normalizeSchedule(args, now);
    const id = await ctx.db.insert("tasks", {
      user_id: userId,
      ...binding,
      title,
      prompt,
      purpose,
      status: "open",
      enabled: true,
      ...schedule,
      schedule_version: 1,
      created_at: now,
      updated_at: now,
    });
    return { success: true, id };
  },
});

/** A user click creates one occurrence without changing the saved schedule. */
export const requestManualRunForBackend = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    taskId: v.id("tasks"),
    requestId: v.string(),
    leaseOwner: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    assertFiniteTimestamp(args.now, "Run request time");
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(args.requestId))
      throw new ConvexError("Invalid task run request.");
    const leaseOwner = requireBackendIdentifier(args.leaseOwner, "Lease owner");
    const task = await getOwnedTask(ctx, args.taskId, args.userId);
    if (!task || task.status !== "open" || !task.enabled)
      throw new ConvexError("This task is not available to run.");
    if (task.schedule_type !== "manual")
      throw new ConvexError("Run now is available for manual tasks.");
    if (isSecurityTask(task.purpose))
      throw new ConvexError(HACK_TASKS_DEDICATED_ERROR);
    const boundChat = await requireBotTaskBinding(ctx.db, args.userId, task);
    const version = task.schedule_version ?? 1;
    const executionKey = `manual:${task._id}:${version}:${args.requestId}`;
    const existing = await ctx.db
      .query("task_runs")
      .withIndex("by_execution_key", (q) => q.eq("execution_key", executionKey))
      .first();
    if (existing) {
      if (existing.user_id !== args.userId || existing.task_id !== task._id)
        throw new ConvexError("This task run is not available.");
      const retryDispatch =
        existing.status === "queued" &&
        !existing.worker_run_id &&
        existing.dispatch_lease_owner === leaseOwner;
      return {
        state: existing.status,
        executionKey,
        dispatchAttempt: existing.dispatch_attempts ?? 1,
        shouldDispatch: retryDispatch,
        chatId: existing.chat_id ?? boundChat?.id,
      };
    }
    const previous = await ctx.db
      .query("task_runs")
      .withIndex("by_user_task_and_started", (q) =>
        q.eq("user_id", args.userId).eq("task_id", task._id),
      )
      .order("desc")
      .take(MAX_RUNS_PER_TASK);
    const active = previous.find(
      (run) => run.status === "queued" || run.status === "running",
    );
    if (active)
      return {
        state: active.status,
        executionKey: active.execution_key ?? active.run_id,
        dispatchAttempt: active.dispatch_attempts ?? 1,
        shouldDispatch: false,
        chatId: active.chat_id ?? boundChat?.id,
      };
    if (previous.length >= MAX_RUNS_PER_TASK)
      await ctx.db.delete(previous[previous.length - 1]._id);
    if (task.schedule_version === undefined)
      await ctx.db.patch(task._id, { schedule_version: version });
    await ctx.db.insert("task_runs", {
      task_id: task._id,
      user_id: args.userId,
      run_id: executionKey,
      execution_key: executionKey,
      schedule_version: version,
      scheduled_at: args.now,
      status: "queued",
      started_at: args.now,
      chat_id: boundChat?.id,
      dispatch_lease_owner: leaseOwner,
      dispatch_lease_until: args.now + DISPATCH_LEASE_MS,
      dispatch_attempts: 1,
    });
    return {
      state: "queued" as const,
      executionKey,
      dispatchAttempt: 1,
      shouldDispatch: true,
      chatId: boundChat?.id,
    };
  },
});

export const updateTask = mutation({
  args: {
    id: v.id("tasks"),
    projectId: v.optional(v.id("projects")),
    assigneeBotId: v.optional(v.id("project_bots")),
    title: v.string(),
    prompt: v.string(),
    purpose: v.optional(taskPurposeValidator),
    scheduleType: scheduleTypeValidator,
    scheduledFor: v.optional(v.number()),
    scheduleExpression: v.optional(v.string()),
    timezone: v.optional(v.string()),
  },
  returns: v.object({ success: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const userId = await requireAuthedUserId(ctx);
    const task = await getOwnedTask(ctx, args.id, userId);
    if (!task) return { success: false, error: "Task not found" };

    const title = requireText(args.title, "Title", MAX_TITLE_LENGTH);
    const prompt = requireText(args.prompt, "Instructions", MAX_PROMPT_LENGTH);
    const purpose = args.purpose ?? task.purpose ?? "app";
    if (purpose === "security") {
      return { success: false, error: HACK_TASKS_DEDICATED_ERROR };
    }
    if (args.scheduleType !== "manual") {
      const subscription = await resolveSubscriptionForBackend(ctx, userId);
      if (subscription === "free") {
        return {
          success: false,
          error: SCHEDULED_TASKS_PREMIUM_ERROR,
        };
      }
    }
    const binding = {
      project_id: args.projectId ?? task.project_id,
      assignee_bot_id: args.assigneeBotId ?? task.assignee_bot_id,
      bot_meeting_id: task.bot_meeting_id,
    };
    await requireBotTaskBinding(ctx.db, userId, binding);
    const now = Date.now();
    const schedule = normalizeSchedule(args, now);
    await cancelQueuedRunsForTask(ctx, args.id, userId, now);
    await ctx.db.patch(args.id, {
      ...binding,
      title,
      prompt,
      purpose,
      ...schedule,
      scheduler_state:
        task.enabled && task.status === "open"
          ? schedule.scheduler_state
          : "inactive",
      next_run_at:
        task.enabled && task.status === "open"
          ? schedule.next_run_at
          : undefined,
      schedule_version: (task.schedule_version ?? 0) + 1,
      updated_at: now,
    });
    return { success: true };
  },
});

export const setTaskEnabled = mutation({
  args: { id: v.id("tasks"), enabled: v.boolean() },
  returns: v.object({ success: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const userId = await requireAuthedUserId(ctx);
    const task = await getOwnedTask(ctx, args.id, userId);
    if (!task) return { success: false, error: "Task not found" };
    if (task.status === "completed" && args.enabled) {
      return {
        success: false,
        error: "Reopen the task before enabling it",
      };
    }
    if (args.enabled && isSecurityTask(task.purpose)) {
      return { success: false, error: HACK_TASKS_DEDICATED_ERROR };
    }
    if (
      args.enabled &&
      task.schedule_type !== "manual" &&
      (await resolveSubscriptionForBackend(ctx, userId)) === "free"
    ) {
      return {
        success: false,
        error: SCHEDULED_TASKS_PREMIUM_ERROR,
      };
    }
    if (args.enabled) await requireBotTaskBinding(ctx.db, userId, task);
    const now = Date.now();
    let nextRunAt: number | undefined;
    if (args.enabled && task.schedule_type === "once") {
      if (
        task.scheduled_for === undefined ||
        !Number.isFinite(task.scheduled_for) ||
        task.scheduled_for <= now
      ) {
        return {
          success: false,
          error: "Choose a future time before enabling this task",
        };
      }
      nextRunAt = task.scheduled_for;
    } else if (args.enabled && task.schedule_type === "recurring") {
      try {
        nextRunAt = nextRecurringRunAt(
          task.schedule_expression ?? "",
          task.timezone,
          now,
        );
      } catch (error) {
        return {
          success: false,
          error:
            error instanceof TaskScheduleError
              ? error.message
              : "Schedule could not be validated",
        };
      }
    }
    await cancelQueuedRunsForTask(ctx, args.id, userId, now);
    await ctx.db.patch(args.id, {
      enabled: args.enabled,
      scheduler_state:
        args.enabled && task.schedule_type !== "manual"
          ? "scheduled"
          : "inactive",
      schedule_error: undefined,
      next_run_at: nextRunAt,
      schedule_version: (task.schedule_version ?? 0) + 1,
      updated_at: now,
    });
    return { success: true };
  },
});

export const setTaskCompleted = mutation({
  args: { id: v.id("tasks"), completed: v.boolean() },
  returns: v.object({ success: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const userId = await requireAuthedUserId(ctx);
    const task = await getOwnedTask(ctx, args.id, userId);
    if (!task) return { success: false, error: "Task not found" };
    const now = Date.now();
    await cancelQueuedRunsForTask(ctx, args.id, userId, now);
    await ctx.db.patch(args.id, {
      status: args.completed ? "completed" : "open",
      enabled: args.completed ? false : task.enabled,
      scheduler_state: args.completed
        ? "inactive"
        : task.enabled && task.schedule_type !== "manual"
          ? "scheduled"
          : "inactive",
      next_run_at: args.completed ? undefined : task.next_run_at,
      schedule_version: (task.schedule_version ?? 0) + 1,
      completed_at: args.completed ? now : undefined,
      updated_at: now,
    });
    return { success: true };
  },
});

export const removeTask = mutation({
  args: { id: v.id("tasks") },
  returns: v.object({ success: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const userId = await requireAuthedUserId(ctx);
    const task = await getOwnedTask(ctx, args.id, userId);
    if (!task) return { success: true };

    const runs = await ctx.db
      .query("task_runs")
      .withIndex("by_user_task_and_started", (q) =>
        q.eq("user_id", userId).eq("task_id", args.id),
      )
      .collect();
    await Promise.all(runs.map((run) => ctx.db.delete(run._id)));
    await ctx.db.delete(args.id);
    return { success: true };
  },
});

/**
 * Generic backend-only persistence hook retained for trusted integrations.
 * The automatic Trigger.dev scheduler below uses the stricter claim/lease
 * lifecycle instead of treating this write as an execution request.
 */
export const upsertRunForBackend = mutation({
  args: {
    serviceKey: v.string(),
    taskId: v.id("tasks"),
    userId: v.string(),
    runId: v.string(),
    status: runStatusValidator,
    chatId: v.optional(v.string()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  returns: v.id("task_runs"),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.user_id !== args.userId) {
      throw new ConvexError({
        code: "TASK_NOT_FOUND",
        message: "Task not found",
      });
    }

    const runId = requireText(args.runId, "Run ID", 200);
    const errorMessage = optionalTrimmedText(
      args.errorMessage,
      "Run error",
      1_000,
    );
    const matchingRuns = await ctx.db
      .query("task_runs")
      .withIndex("by_run_id", (q) => q.eq("run_id", runId))
      .take(2);
    const existing = matchingRuns.find(
      (run) => run.task_id === args.taskId && run.user_id === args.userId,
    );
    const conflicting = matchingRuns.find(
      (run) => run.task_id !== args.taskId || run.user_id !== args.userId,
    );
    if (conflicting) {
      throw new ConvexError({
        code: "RUN_ID_CONFLICT",
        message: "Run ID is already associated with another task",
      });
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        chat_id: args.chatId,
        started_at: args.startedAt,
        finished_at: args.finishedAt,
        error_message: errorMessage,
      });
      return existing._id;
    }

    const priorRuns = await ctx.db
      .query("task_runs")
      .withIndex("by_user_task_and_started", (q) =>
        q.eq("user_id", args.userId).eq("task_id", args.taskId),
      )
      .order("asc")
      .take(MAX_RUNS_PER_TASK);
    if (priorRuns.length >= MAX_RUNS_PER_TASK) {
      await ctx.db.delete(priorRuns[0]._id);
    }

    return ctx.db.insert("task_runs", {
      task_id: args.taskId,
      user_id: args.userId,
      run_id: runId,
      status: args.status,
      chat_id: args.chatId,
      started_at: args.startedAt,
      finished_at: args.finishedAt,
      error_message: errorMessage,
    });
  },
});

const dispatchClaimValidator = v.object({
  taskId: v.id("tasks"),
  userId: v.string(),
  executionKey: v.string(),
  scheduledAt: v.number(),
  dispatchAttempt: v.number(),
});

function requireBackendIdentifier(value: string, label: string): string {
  return requireText(value, label, MAX_BACKEND_ID_LENGTH);
}

function assertFiniteTimestamp(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new ConvexError({
      code: "INVALID_TASK_RUN",
      message: `${label} is invalid`,
    });
  }
}

export async function resolveSubscriptionForBackend(
  ctx: { db: any },
  userId: string,
): Promise<"free" | "pro" | "pro-plus" | "ultra" | "team"> {
  const subscriptions = await ctx.db
    .query("subscriptions")
    .withIndex("by_user_id", (q: any) => q.eq("user_id", userId))
    .collect();
  const active = subscriptions
    .filter((row: any) => ENTITLED_SUBSCRIPTION_STATUSES.has(row.status))
    .sort((a: any, b: any) => b.updated_at - a.updated_at)[0];
  return active && ["pro", "pro-plus", "ultra", "team"].includes(active.tier)
    ? active.tier
    : "free";
}

async function hasActiveRunForUser(ctx: { db: any }, userId: string) {
  const queued = await ctx.db
    .query("task_runs")
    .withIndex("by_user_and_status", (q: any) =>
      q.eq("user_id", userId).eq("status", "queued"),
    )
    .take(1);
  if (queued.length > 0) return true;
  const running = await ctx.db
    .query("task_runs")
    .withIndex("by_user_and_status", (q: any) =>
      q.eq("user_id", userId).eq("status", "running"),
    )
    .take(1);
  return running.length > 0;
}

async function migrateLegacyTasks(ctx: { db: any }, now: number) {
  const legacyTasks = await ctx.db
    .query("tasks")
    .withIndex("by_scheduler_state_and_next_run", (q: any) =>
      q.eq("scheduler_state", undefined),
    )
    .take(5);

  for (const task of legacyTasks) {
    const scheduleVersion = task.schedule_version ?? 1;
    if (isSecurityTask(task.purpose)) {
      await retireSecurityTask(ctx, task, now);
      continue;
    }
    if (
      !task.enabled ||
      task.status !== "open" ||
      task.schedule_type === "manual"
    ) {
      await ctx.db.patch(task._id, {
        scheduler_state: "inactive",
        next_run_at: undefined,
        schedule_error: undefined,
        schedule_version: scheduleVersion,
      });
      continue;
    }
    if ((await resolveSubscriptionForBackend(ctx, task.user_id)) === "free") {
      await ctx.db.patch(task._id, {
        enabled: false,
        scheduler_state: "inactive",
        next_run_at: undefined,
        schedule_error: SCHEDULED_TASKS_PREMIUM_ERROR,
        schedule_version: scheduleVersion,
      });
      continue;
    }

    try {
      const timezone = assertTaskTimezone(task.timezone);
      if (task.schedule_type === "once") {
        if (
          task.scheduled_for === undefined ||
          !Number.isFinite(task.scheduled_for)
        ) {
          throw new TaskScheduleError("One-time schedule is missing its date");
        }
        await ctx.db.patch(task._id, {
          timezone,
          scheduler_state: "scheduled",
          next_run_at: task.scheduled_for,
          schedule_error: undefined,
          schedule_version: scheduleVersion,
        });
        continue;
      }

      const expression = normalizeRecurringExpression(
        task.schedule_expression ?? "",
      );
      await ctx.db.patch(task._id, {
        schedule_expression: expression,
        timezone,
        scheduler_state: "scheduled",
        next_run_at: nextRecurringRunAt(expression, timezone, now),
        schedule_error: undefined,
        schedule_version: scheduleVersion,
      });
    } catch (error) {
      await ctx.db.patch(task._id, {
        scheduler_state: "invalid",
        next_run_at: undefined,
        schedule_error:
          error instanceof TaskScheduleError
            ? error.message
            : "Schedule could not be migrated",
        schedule_version: scheduleVersion,
      });
    }
  }
}

async function expireStaleRunningRuns(ctx: { db: any }, now: number) {
  const staleRuns = await ctx.db
    .query("task_runs")
    .withIndex("by_status_and_run_lease", (q: any) =>
      q
        .eq("status", "running")
        .gt("run_lease_until", 0)
        .lte("run_lease_until", now),
    )
    .take(MAX_DISPATCH_BATCH);
  for (const run of staleRuns) {
    await ctx.db.patch(run._id, {
      status: "failed",
      finished_at: now,
      error_message: "The scheduled executor stopped before completion",
      run_lease_until: undefined,
    });
  }
}

/**
 * Atomically claims bounded due work for the minute-level Trigger dispatcher.
 * The execution key is derived only from server-owned task state, and a due
 * occurrence is advanced in the same transaction that creates its run row.
 */
export const claimDueRunsForBackend = mutation({
  args: {
    serviceKey: v.string(),
    now: v.number(),
    leaseOwner: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(dispatchClaimValidator),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    assertFiniteTimestamp(args.now, "Dispatcher time");
    const leaseOwner = requireBackendIdentifier(args.leaseOwner, "Lease owner");
    const limit = Math.min(
      MAX_DISPATCH_BATCH,
      Math.max(1, Math.floor(args.limit ?? MAX_DISPATCH_BATCH)),
    );
    await expireStaleRunningRuns(ctx, args.now);
    await migrateLegacyTasks(ctx, args.now);

    const claims: Array<{
      taskId: any;
      userId: string;
      executionKey: string;
      scheduledAt: number;
      dispatchAttempt: number;
    }> = [];
    const claimedUsers = new Set<string>();

    const staleQueued = await ctx.db
      .query("task_runs")
      .withIndex("by_status_and_dispatch_lease", (q: any) =>
        q
          .eq("status", "queued")
          .gt("dispatch_lease_until", 0)
          .lte("dispatch_lease_until", args.now),
      )
      .take(MAX_DISPATCH_CANDIDATES);

    for (const run of staleQueued) {
      if (claims.length >= limit) break;
      if (!run.execution_key) continue;
      if (claimedUsers.has(run.user_id)) continue;
      const task = await ctx.db.get(run.task_id);
      if (
        !task ||
        task.user_id !== run.user_id ||
        task.status !== "open" ||
        task.schedule_version !== run.schedule_version
      ) {
        await ctx.db.patch(run._id, {
          status: "canceled",
          finished_at: args.now,
          error_message: "Canceled because the task is no longer current",
          dispatch_lease_owner: undefined,
          dispatch_lease_until: undefined,
        });
        continue;
      }
      if (isSecurityTask(task.purpose)) {
        await retireSecurityTask(ctx, task, args.now);
        await ctx.db.patch(run._id, {
          status: "canceled",
          finished_at: args.now,
          error_message: HACK_TASKS_DEDICATED_ERROR,
          dispatch_lease_owner: undefined,
          dispatch_lease_until: undefined,
        });
        continue;
      }
      const dispatchAttempt = (run.dispatch_attempts ?? 0) + 1;
      await ctx.db.patch(run._id, {
        dispatch_lease_owner: leaseOwner,
        dispatch_lease_until: args.now + DISPATCH_LEASE_MS,
        dispatch_attempts: dispatchAttempt,
        worker_run_id: undefined,
        error_message: undefined,
      });
      claimedUsers.add(run.user_id);
      claims.push({
        taskId: run.task_id,
        userId: run.user_id,
        executionKey: run.execution_key,
        scheduledAt: run.scheduled_at ?? run.started_at,
        dispatchAttempt,
      });
    }

    if (claims.length >= limit) return claims;

    const dueTasks = await ctx.db
      .query("tasks")
      .withIndex("by_scheduler_state_and_next_run", (q: any) =>
        q.eq("scheduler_state", "scheduled").lte("next_run_at", args.now),
      )
      .take(MAX_DISPATCH_CANDIDATES);

    for (const task of dueTasks) {
      if (claims.length >= limit) break;
      if (
        task.status !== "open" ||
        !task.enabled ||
        task.next_run_at === undefined ||
        task.schedule_type === "manual"
      ) {
        continue;
      }
      if (isSecurityTask(task.purpose)) {
        await retireSecurityTask(ctx, task, args.now);
        continue;
      }
      if (
        claimedUsers.has(task.user_id) ||
        (await hasActiveRunForUser(ctx, task.user_id))
      ) {
        // Move a busy tenant's occurrence behind the current due window. This
        // preserves one-at-a-time execution without letting one user's many
        // overdue tasks permanently starve every other tenant in the index.
        await ctx.db.patch(task._id, {
          next_run_at: args.now + 60_000,
        });
        continue;
      }
      if ((await resolveSubscriptionForBackend(ctx, task.user_id)) === "free") {
        await ctx.db.patch(task._id, {
          enabled: false,
          scheduler_state: "inactive",
          schedule_error: SCHEDULED_TASKS_PREMIUM_ERROR,
          next_run_at: undefined,
          updated_at: args.now,
        });
        continue;
      }

      const scheduledAt = task.next_run_at;
      const scheduleVersion = task.schedule_version ?? 1;
      const executionKey = `${task._id}:${scheduleVersion}:${scheduledAt}`;
      const existing = await ctx.db
        .query("task_runs")
        .withIndex("by_execution_key", (q: any) =>
          q.eq("execution_key", executionKey),
        )
        .first();
      if (existing) continue;

      const priorRuns = await ctx.db
        .query("task_runs")
        .withIndex("by_user_task_and_started", (q: any) =>
          q.eq("user_id", task.user_id).eq("task_id", task._id),
        )
        .order("asc")
        .take(MAX_RUNS_PER_TASK);
      if (priorRuns.length >= MAX_RUNS_PER_TASK) {
        await ctx.db.delete(priorRuns[0]._id);
      }

      const taskRunId = await ctx.db.insert("task_runs", {
        task_id: task._id,
        user_id: task.user_id,
        run_id: executionKey,
        execution_key: executionKey,
        schedule_version: scheduleVersion,
        scheduled_at: scheduledAt,
        status: "queued",
        started_at: args.now,
        dispatch_lease_owner: leaseOwner,
        dispatch_lease_until: args.now + DISPATCH_LEASE_MS,
        dispatch_attempts: 1,
      });

      if (task.schedule_type === "once") {
        await ctx.db.patch(task._id, {
          enabled: false,
          scheduler_state: "inactive",
          next_run_at: undefined,
          updated_at: args.now,
        });
      } else {
        let nextRunAt: number;
        try {
          nextRunAt = nextRecurringRunAt(
            task.schedule_expression ?? "",
            task.timezone,
            Math.max(args.now, scheduledAt),
          );
        } catch (error) {
          await ctx.db.patch(task._id, {
            enabled: false,
            scheduler_state: "invalid",
            schedule_error:
              error instanceof TaskScheduleError
                ? error.message
                : "Schedule could not be advanced",
            next_run_at: undefined,
            updated_at: args.now,
          });
          await ctx.db.patch(taskRunId, {
            status: "canceled",
            finished_at: args.now,
            error_message: "Recurring schedule could not be advanced",
          });
          continue;
        }
        await ctx.db.patch(task._id, {
          next_run_at: nextRunAt,
          schedule_error: undefined,
          updated_at: args.now,
        });
      }

      claimedUsers.add(task.user_id);
      claims.push({
        taskId: task._id,
        userId: task.user_id,
        executionKey,
        scheduledAt,
        dispatchAttempt: 1,
      });
    }
    return claims;
  },
});

export const markRunDispatchedForBackend = mutation({
  args: {
    serviceKey: v.string(),
    executionKey: v.string(),
    leaseOwner: v.string(),
    workerRunId: v.string(),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const executionKey = requireBackendIdentifier(
      args.executionKey,
      "Execution key",
    );
    const leaseOwner = requireBackendIdentifier(args.leaseOwner, "Lease owner");
    const workerRunId = requireBackendIdentifier(
      args.workerRunId,
      "Worker run ID",
    );
    const run = await ctx.db
      .query("task_runs")
      .withIndex("by_execution_key", (q) => q.eq("execution_key", executionKey))
      .first();
    if (!run || run.status !== "queued") return { success: false };
    if (run.dispatch_lease_owner !== leaseOwner) return { success: false };
    if (run.worker_run_id && run.worker_run_id !== workerRunId) {
      throw new ConvexError({
        code: "TASK_RUN_CONFLICT",
        message: "Task run is already assigned to another worker",
      });
    }
    await ctx.db.patch(run._id, {
      worker_run_id: workerRunId,
      dispatch_lease_owner: "worker",
      dispatch_lease_until: Date.now() + DISPATCH_LEASE_MS,
      error_message: undefined,
    });
    return { success: true };
  },
});

export const releaseRunDispatchForBackend = mutation({
  args: {
    serviceKey: v.string(),
    executionKey: v.string(),
    leaseOwner: v.string(),
    retryAt: v.number(),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    assertFiniteTimestamp(args.retryAt, "Retry time");
    const executionKey = requireBackendIdentifier(
      args.executionKey,
      "Execution key",
    );
    const run = await ctx.db
      .query("task_runs")
      .withIndex("by_execution_key", (q) => q.eq("execution_key", executionKey))
      .first();
    if (
      !run ||
      run.status !== "queued" ||
      run.dispatch_lease_owner !== args.leaseOwner
    ) {
      return { success: false };
    }
    await ctx.db.patch(run._id, {
      dispatch_lease_owner: "retry",
      dispatch_lease_until: args.retryAt,
      error_message: "Waiting for the scheduler to retry dispatch",
    });
    return { success: true };
  },
});

const scheduledRunStateValidator = v.union(
  v.literal("deferred"),
  v.literal("ready"),
  v.literal("pending"),
  v.literal("canceled"),
  v.literal("finished"),
);

export const beginScheduledRunForBackend = mutation({
  args: {
    serviceKey: v.string(),
    executionKey: v.string(),
    workerRunId: v.string(),
    now: v.number(),
  },
  returns: v.object({
    state: scheduledRunStateValidator,
    userId: v.optional(v.string()),
    title: v.optional(v.string()),
    chatId: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    prompt: v.optional(v.string()),
    purpose: v.optional(taskPurposeValidator),
    subscription: v.optional(subscriptionValidator),
  }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    assertFiniteTimestamp(args.now, "Run start time");
    const executionKey = requireBackendIdentifier(
      args.executionKey,
      "Execution key",
    );
    const workerRunId = requireBackendIdentifier(
      args.workerRunId,
      "Worker run ID",
    );
    const run = await ctx.db
      .query("task_runs")
      .withIndex("by_execution_key", (q) => q.eq("execution_key", executionKey))
      .first();
    if (!run) return { state: "canceled" as const };
    if (["succeeded", "failed", "canceled"].includes(run.status)) {
      return { state: "finished" as const };
    }
    if (!run.worker_run_id) {
      return { state: "pending" as const };
    }
    if (run.worker_run_id !== workerRunId) {
      throw new ConvexError({
        code: "TASK_RUN_CONFLICT",
        message: "Task run is assigned to another worker",
      });
    }

    const task = await ctx.db.get(run.task_id);
    const versionMatches =
      !!task && task.schedule_version === run.schedule_version;
    const onceClaimStillValid =
      !!task && task.schedule_type === "once" && versionMatches;
    if (
      !task ||
      task.user_id !== run.user_id ||
      task.status !== "open" ||
      !versionMatches ||
      (!task.enabled && !onceClaimStillValid)
    ) {
      await ctx.db.patch(run._id, {
        status: "canceled",
        finished_at: args.now,
        error_message: "Canceled because the task is no longer active",
        dispatch_lease_owner: undefined,
        dispatch_lease_until: undefined,
      });
      return { state: "canceled" as const };
    }

    if (isSecurityTask(task.purpose)) {
      await retireSecurityTask(ctx, task, args.now);
      await ctx.db.patch(run._id, {
        status: "canceled",
        finished_at: args.now,
        error_message: HACK_TASKS_DEDICATED_ERROR,
        dispatch_lease_owner: undefined,
        dispatch_lease_until: undefined,
      });
      return { state: "canceled" as const };
    }

    let boundChat;
    try {
      boundChat = await requireBotTaskBinding(ctx.db, run.user_id, task);
    } catch {
      await ctx.db.patch(task._id, {
        enabled: false,
        scheduler_state: "inactive",
        next_run_at: undefined,
        schedule_error: "The assigned bot or meeting is no longer available",
        updated_at: args.now,
      });
      await ctx.db.patch(run._id, {
        status: "canceled",
        finished_at: args.now,
        error_message: "The assigned bot or meeting is no longer available",
        dispatch_lease_owner: undefined,
        dispatch_lease_until: undefined,
      });
      return { state: "canceled" as const };
    }
    if (boundChat?.active_stream_id || boundChat?.active_trigger_run_id) {
      // Preserve this exact occurrence and retry after the existing conversation.
      await ctx.db.patch(run._id, {
        status: "queued",
        worker_run_id: undefined,
        dispatch_lease_owner: undefined,
        dispatch_lease_until: args.now + 60_000,
      });
      return { state: "deferred" as const };
    }
    const subscription = await resolveSubscriptionForBackend(ctx, run.user_id);
    if (subscription === "free" && task.schedule_type !== "manual") {
      await ctx.db.patch(task._id, {
        enabled: false,
        scheduler_state: "inactive",
        next_run_at: undefined,
        schedule_error: SCHEDULED_TASKS_PREMIUM_ERROR,
        schedule_version: (task.schedule_version ?? 0) + 1,
        updated_at: args.now,
      });
      await ctx.db.patch(run._id, {
        status: "canceled",
        finished_at: args.now,
        error_message: SCHEDULED_TASKS_PREMIUM_ERROR,
        dispatch_lease_owner: undefined,
        dispatch_lease_until: undefined,
      });
      return { state: "canceled" as const };
    }
    await ctx.db.patch(run._id, {
      status: "running",
      worker_run_id: workerRunId,
      started_at: args.now,
      run_lease_until: args.now + RUN_LEASE_MS,
      dispatch_lease_owner: undefined,
      dispatch_lease_until: undefined,
      error_message: undefined,
    });
    return {
      state: "ready" as const,
      userId: run.user_id,
      title: task.title,
      chatId: boundChat?.id,
      projectId: task.project_id,
      prompt: task.prompt,
      // Missing legacy purpose values are retired by isSecurityTask above.
      // Keep the surviving execution path fail-closed to the normal app mode.
      purpose: task.purpose ?? "app",
      subscription,
    };
  },
});

export const registerScheduledAgentRunForBackend = mutation({
  args: {
    serviceKey: v.string(),
    executionKey: v.string(),
    workerRunId: v.string(),
    agentRunId: v.string(),
    chatId: v.string(),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const executionKey = requireBackendIdentifier(
      args.executionKey,
      "Execution key",
    );
    const run = await ctx.db
      .query("task_runs")
      .withIndex("by_execution_key", (q) => q.eq("execution_key", executionKey))
      .first();
    if (!run || !["queued", "running"].includes(run.status)) {
      return { success: false };
    }
    if (run.worker_run_id && run.worker_run_id !== args.workerRunId) {
      throw new ConvexError({
        code: "TASK_RUN_CONFLICT",
        message: "Task run is assigned to another worker",
      });
    }
    if (run.agent_run_id && run.agent_run_id !== args.agentRunId) {
      throw new ConvexError({
        code: "TASK_RUN_CONFLICT",
        message: "Task run is assigned to another agent run",
      });
    }
    await ctx.db.patch(run._id, {
      status: "running",
      agent_run_id: requireBackendIdentifier(args.agentRunId, "Agent run ID"),
      chat_id: requireBackendIdentifier(args.chatId, "Chat ID"),
      run_lease_until: Date.now() + RUN_LEASE_MS,
    });
    return { success: true };
  },
});

export const authorizeScheduledAgentRunForBackend = mutation({
  args: {
    serviceKey: v.string(),
    executionKey: v.string(),
    agentRunId: v.string(),
    userId: v.string(),
    chatId: v.string(),
  },
  returns: v.object({ authorized: v.boolean() }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const executionKey = requireBackendIdentifier(
      args.executionKey,
      "Execution key",
    );
    const run = await ctx.db
      .query("task_runs")
      .withIndex("by_execution_key", (q) => q.eq("execution_key", executionKey))
      .first();
    if (
      !run ||
      run.status !== "running" ||
      run.user_id !== args.userId ||
      run.agent_run_id !== args.agentRunId ||
      run.chat_id !== args.chatId
    ) {
      return { authorized: false };
    }
    const task = await ctx.db.get(run.task_id);
    if (
      !task ||
      task.user_id !== run.user_id ||
      task.schedule_version !== run.schedule_version
    ) {
      return { authorized: false };
    }
    try {
      const boundChat = await requireBotTaskBinding(ctx.db, run.user_id, task);
      if (boundChat && boundChat.id !== args.chatId)
        return { authorized: false };
    } catch {
      return { authorized: false };
    }
    if (
      task.schedule_type !== "manual" &&
      (await resolveSubscriptionForBackend(ctx, run.user_id)) === "free"
    ) {
      const now = Date.now();
      await ctx.db.patch(task._id, {
        enabled: false,
        scheduler_state: "inactive",
        next_run_at: undefined,
        schedule_error: SCHEDULED_TASKS_PREMIUM_ERROR,
        schedule_version: (task.schedule_version ?? 0) + 1,
        updated_at: now,
      });
      await ctx.db.patch(run._id, {
        status: "canceled",
        finished_at: now,
        error_message: SCHEDULED_TASKS_PREMIUM_ERROR,
        run_lease_until: undefined,
      });
      return { authorized: false };
    }
    return { authorized: true };
  },
});

export const finishScheduledRunForBackend = mutation({
  args: {
    serviceKey: v.string(),
    executionKey: v.string(),
    status: v.union(
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("canceled"),
    ),
    finishedAt: v.number(),
    workerRunId: v.optional(v.string()),
    agentRunId: v.optional(v.string()),
    chatId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    assertFiniteTimestamp(args.finishedAt, "Run finish time");
    const executionKey = requireBackendIdentifier(
      args.executionKey,
      "Execution key",
    );
    const run = await ctx.db
      .query("task_runs")
      .withIndex("by_execution_key", (q) => q.eq("execution_key", executionKey))
      .first();
    if (!run) return { success: false };
    if (args.workerRunId && run.worker_run_id !== args.workerRunId) {
      throw new ConvexError({
        code: "TASK_RUN_CONFLICT",
        message: "Worker run does not own this task run",
      });
    }
    if (
      args.agentRunId &&
      run.agent_run_id &&
      run.agent_run_id !== args.agentRunId
    ) {
      throw new ConvexError({
        code: "TASK_RUN_CONFLICT",
        message: "Agent run does not own this task run",
      });
    }
    if (["succeeded", "failed", "canceled"].includes(run.status)) {
      return { success: true };
    }
    await ctx.db.patch(run._id, {
      status: args.status,
      agent_run_id: args.agentRunId ?? run.agent_run_id,
      chat_id: args.chatId ?? run.chat_id,
      finished_at: args.finishedAt,
      error_message:
        args.status === "succeeded"
          ? undefined
          : (optionalTrimmedText(args.errorMessage, "Run error", 1_000) ??
            "The scheduled run did not complete"),
      run_lease_until: undefined,
      dispatch_lease_owner: undefined,
      dispatch_lease_until: undefined,
    });
    return { success: true };
  },
});
