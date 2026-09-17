import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { Id } from "../_generated/dataModel";

jest.mock("../_generated/server", () => ({
  mutation: jest.fn((config: any) => config),
  query: jest.fn((config: any) => config),
}));

jest.mock("convex/values", () => ({
  v: {
    id: jest.fn(() => "id"),
    string: jest.fn(() => "string"),
    number: jest.fn(() => "number"),
    optional: jest.fn(() => "optional"),
    object: jest.fn(() => "object"),
    union: jest.fn(() => "union"),
    array: jest.fn(() => "array"),
    boolean: jest.fn(() => "boolean"),
    literal: jest.fn(() => "literal"),
  },
  ConvexError: class ConvexError extends Error {
    data: any;

    constructor(data: any) {
      super(typeof data === "string" ? data : data.message);
      this.data = data;
      this.name = "ConvexError";
    }
  },
}));

jest.mock("../lib/utils", () => ({
  validateServiceKey: jest.fn(),
}));

const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";
const TASK_ID = "task-1" as Id<"tasks">;
const RUN_ID = "task-run-1" as Id<"task_runs">;

function identity() {
  return { subject: `${USER_ID}|session-1` };
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    _id: TASK_ID,
    _creationTime: 10,
    user_id: USER_ID,
    title: "Dependency review",
    prompt: "Review dependency updates and report risks.",
    status: "open" as const,
    enabled: true,
    schedule_type: "manual" as const,
    created_at: 10,
    updated_at: 10,
    ...overrides,
  };
}

function updateArgs(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    title: "Dependency review",
    prompt: "Review dependency updates and report risks.",
    scheduleType: "manual" as const,
    ...overrides,
  };
}

describe("durable tasks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("requires authentication before listing tasks", async () => {
    const ctx: any = {
      auth: { getUserIdentity: jest.fn<any>().mockResolvedValue(null) },
      db: { query: jest.fn() },
    };
    const { listForUser } = await import("../tasks");

    await expect((listForUser as any).handler(ctx, {})).rejects.toMatchObject({
      data: expect.objectContaining({ code: "UNAUTHORIZED" }),
    });
    expect(ctx.db.query).not.toHaveBeenCalled();
  });

  it("lists only the authenticated user's tasks through the ownership index", async () => {
    const eq = jest.fn<any>().mockReturnThis();
    const collect = jest.fn<any>().mockResolvedValue([task()]);
    const order = jest.fn(() => ({ collect }));
    const withIndex = jest.fn((_indexName: string, predicate: any) => {
      predicate({ eq });
      return { order };
    });
    const ctx: any = {
      auth: { getUserIdentity: jest.fn<any>().mockResolvedValue(identity()) },
      db: { query: jest.fn(() => ({ withIndex })) },
    };
    const { listForUser } = await import("../tasks");

    const result = await (listForUser as any).handler(ctx, {});

    expect(ctx.db.query).toHaveBeenCalledWith("tasks");
    expect(withIndex).toHaveBeenCalledWith(
      "by_user_and_updated",
      expect.any(Function),
    );
    expect(eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(result).toEqual([
      expect.objectContaining({
        _id: TASK_ID,
        title: "Dependency review",
        status: "open",
      }),
    ]);
    expect(result[0]).not.toHaveProperty("user_id");
  });

  it("normalizes and persists recurring schedule metadata", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_234);
    const take = jest.fn<any>().mockResolvedValue([]);
    const withIndex = jest.fn((_indexName: string, predicate: any) => {
      const range: any = {};
      range.eq = jest.fn(() => range);
      predicate(range);
      return { take };
    });
    const insert = jest.fn<any>().mockResolvedValue(TASK_ID);
    const ctx: any = {
      auth: { getUserIdentity: jest.fn<any>().mockResolvedValue(identity()) },
      db: {
        query: jest.fn((table: string) =>
          table === "subscriptions"
            ? {
                withIndex: jest.fn(() => ({
                  collect: jest.fn<any>().mockResolvedValue([
                    {
                      tier: "pro",
                      status: "active",
                      updated_at: 1,
                    },
                  ]),
                })),
              }
            : { withIndex },
        ),
        insert,
      },
    };
    const { createTask } = await import("../tasks");

    await expect(
      (createTask as any).handler(ctx, {
        title: "  Morning review  ",
        prompt: "  Review overnight changes.  ",
        scheduleType: "recurring",
        scheduleExpression: "  Weekdays at 09:00  ",
        timezone: "  Europe/Istanbul  ",
      }),
    ).resolves.toEqual({ success: true, id: TASK_ID });

    expect(take).toHaveBeenCalledWith(250);
    expect(insert).toHaveBeenCalledWith(
      "tasks",
      expect.objectContaining({
        user_id: USER_ID,
        title: "Morning review",
        prompt: "Review overnight changes.",
        status: "open",
        enabled: true,
        schedule_type: "recurring",
        scheduled_for: undefined,
        schedule_expression: "0 9 * * 1-5",
        timezone: "Europe/Istanbul",
        scheduler_state: "scheduled",
        schedule_version: 1,
        created_at: 1_234,
        updated_at: 1_234,
      }),
    );
    expect(insert.mock.calls[0]?.[1].next_run_at).toBeGreaterThan(1_234);
  });

  it("keeps manual tasks available but rejects free-plan schedules", async () => {
    const taskTake = jest.fn<any>().mockResolvedValue([]);
    const insert = jest.fn<any>().mockResolvedValue(TASK_ID);
    const ctx: any = {
      auth: { getUserIdentity: jest.fn<any>().mockResolvedValue(identity()) },
      db: {
        query: jest.fn((table: string) => ({
          withIndex: jest.fn(() =>
            table === "subscriptions"
              ? { collect: jest.fn<any>().mockResolvedValue([]) }
              : { take: taskTake },
          ),
        })),
        insert,
      },
    };
    const { createTask } = await import("../tasks");

    await expect(
      (createTask as any).handler(ctx, {
        title: "Scheduled review",
        prompt: "Review changes",
        purpose: "app",
        scheduleType: "once",
        scheduledFor: Date.now() + 60_000,
        timezone: "UTC",
      }),
    ).resolves.toEqual({
      success: false,
      error: "Automatic schedules require RIFT Pro or Max",
    });
    expect(insert).not.toHaveBeenCalled();

    await expect(
      (createTask as any).handler(ctx, {
        title: "Manual review",
        prompt: "Review changes",
        purpose: "app",
        scheduleType: "manual",
      }),
    ).resolves.toEqual({ success: true, id: TASK_ID });
    expect(insert).toHaveBeenCalledWith(
      "tasks",
      expect.objectContaining({ purpose: "app", schedule_type: "manual" }),
    );

    insert.mockClear();
    await expect(
      (createTask as any).handler(ctx, {
        title: "Legacy security task",
        prompt: "Run an assessment",
        purpose: "security",
        scheduleType: "manual",
      }),
    ).resolves.toEqual({
      success: false,
      error: "Security tasks must be run from the dedicated Hack Workbench",
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("returns the same not-found result for missing and foreign task IDs", async () => {
    const patch = jest.fn<any>();
    const makeCtx = (row: Record<string, unknown> | null) => ({
      auth: { getUserIdentity: jest.fn<any>().mockResolvedValue(identity()) },
      db: {
        get: jest.fn<any>().mockResolvedValue(row),
        patch,
      },
    });
    const { updateTask } = await import("../tasks");

    const missing = await (updateTask as any).handler(
      makeCtx(null),
      updateArgs(),
    );
    const foreign = await (updateTask as any).handler(
      makeCtx(task({ user_id: OTHER_USER_ID })),
      updateArgs(),
    );

    expect(missing).toEqual({ success: false, error: "Task not found" });
    expect(foreign).toEqual(missing);
    expect(patch).not.toHaveBeenCalled();
  });

  it("does not let a completed task be enabled before it is reopened", async () => {
    const patch = jest.fn<any>();
    const ctx: any = {
      auth: { getUserIdentity: jest.fn<any>().mockResolvedValue(identity()) },
      db: {
        get: jest.fn<any>().mockResolvedValue(task({ status: "completed" })),
        patch,
      },
    };
    const { setTaskEnabled } = await import("../tasks");

    await expect(
      (setTaskEnabled as any).handler(ctx, { id: TASK_ID, enabled: true }),
    ).resolves.toEqual({
      success: false,
      error: "Reopen the task before enabling it",
    });
    expect(patch).not.toHaveBeenCalled();
  });

  it("does not expose or delete a foreign task during idempotent removal", async () => {
    const ctx: any = {
      auth: { getUserIdentity: jest.fn<any>().mockResolvedValue(identity()) },
      db: {
        get: jest.fn<any>().mockResolvedValue(task({ user_id: OTHER_USER_ID })),
        query: jest.fn(),
        delete: jest.fn(),
      },
    };
    const { removeTask } = await import("../tasks");

    await expect(
      (removeTask as any).handler(ctx, { id: TASK_ID }),
    ).resolves.toEqual({ success: true });
    expect(ctx.db.query).not.toHaveBeenCalled();
    expect(ctx.db.delete).not.toHaveBeenCalled();
  });

  it("rejects backend run writes when task ownership does not match", async () => {
    const ctx: any = {
      db: {
        get: jest.fn<any>().mockResolvedValue(task({ user_id: OTHER_USER_ID })),
        query: jest.fn(),
        insert: jest.fn(),
      },
    };
    const { upsertRunForBackend } = await import("../tasks");

    await expect(
      (upsertRunForBackend as any).handler(ctx, {
        serviceKey: "service-key",
        taskId: TASK_ID,
        userId: USER_ID,
        runId: "run-1",
        status: "running",
        startedAt: 100,
      }),
    ).rejects.toMatchObject({
      data: expect.objectContaining({ code: "TASK_NOT_FOUND" }),
    });
    expect(ctx.db.query).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("updates an existing real run idempotently", async () => {
    const existingRun = {
      _id: RUN_ID,
      task_id: TASK_ID,
      user_id: USER_ID,
      run_id: "run-1",
      status: "running",
      started_at: 100,
    };
    const take = jest.fn<any>().mockResolvedValue([existingRun]);
    const withIndex = jest.fn((_indexName: string, predicate: any) => {
      const range: any = {};
      range.eq = jest.fn(() => range);
      predicate(range);
      return { take };
    });
    const patch = jest.fn<any>().mockResolvedValue(undefined);
    const ctx: any = {
      db: {
        get: jest.fn<any>().mockResolvedValue(task()),
        query: jest.fn(() => ({ withIndex })),
        patch,
        insert: jest.fn(),
      },
    };
    const { upsertRunForBackend } = await import("../tasks");

    await expect(
      (upsertRunForBackend as any).handler(ctx, {
        serviceKey: "service-key",
        taskId: TASK_ID,
        userId: USER_ID,
        runId: "run-1",
        status: "succeeded",
        startedAt: 100,
        finishedAt: 250,
      }),
    ).resolves.toBe(RUN_ID);

    expect(patch).toHaveBeenCalledWith(RUN_ID, {
      status: "succeeded",
      chat_id: undefined,
      started_at: 100,
      finished_at: 250,
      error_message: undefined,
    });
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("does not trust a worker payload before the dispatcher registers its run id", async () => {
    const run = {
      _id: RUN_ID,
      task_id: TASK_ID,
      user_id: USER_ID,
      execution_key: "task-1:1:100",
      schedule_version: 1,
      status: "queued",
    };
    const ctx: any = {
      db: {
        query: jest.fn((table: string) => ({
          withIndex: jest.fn(() =>
            table === "subscriptions"
              ? {
                  collect: jest
                    .fn<any>()
                    .mockResolvedValue([
                      { tier: "pro", status: "active", updated_at: 10 },
                    ]),
                }
              : { first: jest.fn<any>().mockResolvedValue(run) },
          ),
        })),
        get: jest.fn(),
        patch: jest.fn(),
      },
    };
    const { beginScheduledRunForBackend } = await import("../tasks");

    await expect(
      (beginScheduledRunForBackend as any).handler(ctx, {
        serviceKey: "service-key",
        executionKey: run.execution_key,
        workerRunId: "unregistered-worker",
        now: 200,
      }),
    ).resolves.toEqual({ state: "pending" });
    expect(ctx.db.get).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("cancels a claimed occurrence when the paid entitlement was revoked", async () => {
    const run = {
      _id: RUN_ID,
      task_id: TASK_ID,
      user_id: USER_ID,
      execution_key: "task-1:2:100",
      schedule_version: 2,
      worker_run_id: "worker-1",
      status: "queued",
    };
    const ownedTask = task({
      purpose: "app",
      enabled: false,
      schedule_type: "once",
      schedule_version: 2,
      scheduler_state: "inactive",
    });
    const patch = jest.fn<any>();
    const ctx: any = {
      db: {
        query: jest.fn((table: string) => ({
          withIndex: jest.fn(() =>
            table === "subscriptions"
              ? { collect: jest.fn<any>().mockResolvedValue([]) }
              : { first: jest.fn<any>().mockResolvedValue(run) },
          ),
        })),
        get: jest.fn<any>().mockResolvedValue(ownedTask),
        patch,
      },
    };
    const { beginScheduledRunForBackend } = await import("../tasks");

    await expect(
      (beginScheduledRunForBackend as any).handler(ctx, {
        serviceKey: "service-key",
        executionKey: run.execution_key,
        workerRunId: "worker-1",
        now: 200,
      }),
    ).resolves.toEqual({ state: "canceled" });

    expect(patch).toHaveBeenCalledWith(
      TASK_ID,
      expect.objectContaining({
        enabled: false,
        scheduler_state: "inactive",
        next_run_at: undefined,
        schedule_error: "Automatic schedules require RIFT Pro or Max",
        schedule_version: 3,
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      RUN_ID,
      expect.objectContaining({
        status: "canceled",
        error_message: "Automatic schedules require RIFT Pro or Max",
      }),
    );
  });

  it("retires a claimed legacy security occurrence before creating a chat snapshot", async () => {
    const run = {
      _id: RUN_ID,
      task_id: TASK_ID,
      user_id: USER_ID,
      execution_key: "task-1:2:100",
      schedule_version: 2,
      worker_run_id: "worker-1",
      status: "queued",
    };
    const ownedTask = task({
      purpose: "security",
      schedule_type: "recurring",
      schedule_version: 2,
      scheduler_state: "scheduled",
    });
    const patch = jest.fn<any>();
    const query = jest.fn(() => ({
      withIndex: jest.fn(() => ({
        first: jest.fn<any>().mockResolvedValue(run),
      })),
    }));
    const ctx: any = {
      db: {
        query,
        get: jest.fn<any>().mockResolvedValue(ownedTask),
        patch,
      },
    };
    const { beginScheduledRunForBackend } = await import("../tasks");

    await expect(
      (beginScheduledRunForBackend as any).handler(ctx, {
        serviceKey: "service-key",
        executionKey: run.execution_key,
        workerRunId: "worker-1",
        now: 200,
      }),
    ).resolves.toEqual({ state: "canceled" });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith("task_runs");
    expect(patch).toHaveBeenCalledWith(
      TASK_ID,
      expect.objectContaining({
        enabled: false,
        scheduler_state: "inactive",
        next_run_at: undefined,
        schedule_error:
          "Security tasks must be run from the dedicated Hack Workbench",
        schedule_version: 3,
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      RUN_ID,
      expect.objectContaining({
        status: "canceled",
        error_message:
          "Security tasks must be run from the dedicated Hack Workbench",
      }),
    );
  });

  it("authorizes agent execution only for the registered owner and chat", async () => {
    const run = {
      _id: RUN_ID,
      task_id: TASK_ID,
      user_id: USER_ID,
      execution_key: "task-1:4:100",
      schedule_version: 4,
      agent_run_id: "agent-1",
      chat_id: "scheduled-chat",
      status: "running",
    };
    const ctx: any = {
      db: {
        query: jest.fn((table: string) => ({
          withIndex: jest.fn(() =>
            table === "subscriptions"
              ? {
                  collect: jest
                    .fn<any>()
                    .mockResolvedValue([
                      { tier: "pro", status: "active", updated_at: 10 },
                    ]),
                }
              : { first: jest.fn<any>().mockResolvedValue(run) },
          ),
        })),
        get: jest.fn<any>().mockResolvedValue(task({ schedule_version: 4 })),
      },
    };
    const { authorizeScheduledAgentRunForBackend } = await import("../tasks");

    await expect(
      (authorizeScheduledAgentRunForBackend as any).handler(ctx, {
        serviceKey: "service-key",
        executionKey: run.execution_key,
        agentRunId: "agent-1",
        userId: USER_ID,
        chatId: "scheduled-chat",
      }),
    ).resolves.toEqual({ authorized: true });

    await expect(
      (authorizeScheduledAgentRunForBackend as any).handler(ctx, {
        serviceKey: "service-key",
        executionKey: run.execution_key,
        agentRunId: "attacker-run",
        userId: USER_ID,
        chatId: "scheduled-chat",
      }),
    ).resolves.toEqual({ authorized: false });
  });

  it("atomically claims and advances a paid user's due recurring occurrence", async () => {
    const now = Date.UTC(2026, 6, 14, 10, 0);
    const dueTask = task({
      schedule_type: "recurring",
      schedule_expression: "0 * * * *",
      timezone: "UTC",
      scheduler_state: "scheduled",
      next_run_at: now,
      schedule_version: 7,
      purpose: "app",
    });
    const range = () => {
      const value: any = {};
      value.eq = jest.fn(() => value);
      value.gt = jest.fn(() => value);
      value.lte = jest.fn(() => value);
      return value;
    };
    let schedulerIndexReads = 0;
    const insert = jest.fn<any>().mockResolvedValue(RUN_ID);
    const patch = jest.fn<any>();
    const ctx: any = {
      db: {
        query: jest.fn((table: string) => ({
          withIndex: jest.fn((index: string, predicate: any) => {
            predicate(range());
            if (table === "subscriptions") {
              return {
                collect: jest
                  .fn<any>()
                  .mockResolvedValue([
                    { tier: "pro", status: "active", updated_at: now },
                  ]),
              };
            }
            if (
              table === "tasks" &&
              index === "by_scheduler_state_and_next_run"
            ) {
              schedulerIndexReads += 1;
              return {
                take: jest
                  .fn<any>()
                  .mockResolvedValue(
                    schedulerIndexReads === 1 ? [] : [dueTask],
                  ),
              };
            }
            if (index === "by_execution_key") {
              return { first: jest.fn<any>().mockResolvedValue(null) };
            }
            if (index === "by_user_task_and_started") {
              return {
                order: jest.fn(() => ({
                  take: jest.fn<any>().mockResolvedValue([]),
                })),
              };
            }
            return { take: jest.fn<any>().mockResolvedValue([]) };
          }),
        })),
        get: jest.fn(),
        insert,
        patch,
        delete: jest.fn(),
      },
    };
    const { claimDueRunsForBackend } = await import("../tasks");

    await expect(
      (claimDueRunsForBackend as any).handler(ctx, {
        serviceKey: "service-key",
        now,
        leaseOwner: "dispatcher-1",
        limit: 10,
      }),
    ).resolves.toEqual([
      {
        taskId: TASK_ID,
        userId: USER_ID,
        executionKey: `${TASK_ID}:7:${now}`,
        scheduledAt: now,
        dispatchAttempt: 1,
      },
    ]);
    expect(insert).toHaveBeenCalledWith(
      "task_runs",
      expect.objectContaining({
        task_id: TASK_ID,
        status: "queued",
        execution_key: `${TASK_ID}:7:${now}`,
        dispatch_attempts: 1,
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      TASK_ID,
      expect.objectContaining({
        next_run_at: Date.UTC(2026, 6, 14, 11, 0),
      }),
    );
  });
});
