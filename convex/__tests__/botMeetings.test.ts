/** @jest-environment node */
jest.mock("../_generated/server", () => ({
  mutation: (x: unknown) => x,
  query: (x: unknown) => x,
}));
jest.mock("../lib/utils", () => ({ validateServiceKey: jest.fn() }));
import * as meetings from "../botMeetings";
import * as tasks from "../tasks";
import { createProjectBotProfile } from "../../lib/ai/agents/project-bot-templates";

const handler = (x: unknown) => (x as any).handler;
function fixture() {
  const rows: Record<string, any> = {
    p1: { _id: "p1", user_id: "u1", type: "app" },
    p2: { _id: "p2", user_id: "u2", type: "app" },
    sub: {
      _table: "subscriptions",
      user_id: "u1",
      tier: "pro",
      status: "active",
      updated_at: 1,
    },
  };
  for (const [id, template] of [
    ["b1", "engineer"],
    ["b2", "research"],
  ]) {
    rows[id] = {
      _id: id,
      _table: "project_bots",
      user_id: "u1",
      project_id: "p1",
      chat_id: `chat-${id}`,
      profile_json: JSON.stringify(
        createProjectBotProfile(template, `${id}-profile`),
      ),
    };
    rows[`chat-${id}`] = {
      _id: `chat-${id}`,
      _table: "chats",
      id: `chat-${id}`,
      user_id: "u1",
      project_id: "p1",
      project_bot_id: id,
    };
  }
  let sequence = 0;
  const db = {
    get: jest.fn(async (id: string) => rows[id] ?? null),
    insert: jest.fn(async (table: string, value: any) => {
      const id = `${table}-${++sequence}`;
      rows[id] = { ...value, _id: id, _table: table };
      return id;
    }),
    patch: jest.fn(async (id: string, value: any) => {
      Object.assign(rows[id], value);
    }),
    query: (table: string) => ({
      withIndex: (_index: string, callback: any) => {
        const filters: [string, unknown][] = [];
        const ranges: Array<(row: any) => boolean> = [];
        const q = {
          gt: (key: string, value: number) => {
            ranges.push((row) => row[key] > value);
            return q;
          },
          lte: (key: string, value: number) => {
            ranges.push((row) => row[key] <= value);
            return q;
          },
          eq: (key: string, value: unknown) => {
            filters.push([key, value]);
            return q;
          },
        };
        callback(q);
        const found = () =>
          Object.values(rows).filter(
            (row) =>
              row._table === table &&
              filters.every(([key, value]) => row[key] === value) &&
              ranges.every((matches) => matches(row)),
          );
        const result: any = {
          collect: async () => found(),
          unique: async () => found()[0] ?? null,
          first: async () => found()[0] ?? null,
          take: async (limit: number) => found().slice(0, limit),
          order: () => result,
        };
        return result;
      },
    }),
  };
  return {
    rows,
    ctx: {
      db,
      auth: { getUserIdentity: async () => ({ subject: "u1|session" }) },
    },
  };
}
const meetingArgs = {
  projectId: "p1",
  title: "Release review",
  agenda: "Review reliability and agree the release criteria.",
  participantBotIds: ["b1", "b2"],
  requestId: "meeting-request-1",
};

test("creates one saved meeting conversation without dispatching or fabricating messages", async () => {
  const { ctx, rows } = fixture();
  const first = await handler(meetings.create)(ctx, meetingArgs);
  expect(await handler(meetings.create)(ctx, meetingArgs)).toEqual(first);
  expect(ctx.db.insert).toHaveBeenCalledTimes(2);
  expect(Object.values(rows).find((r) => r.id === first.chatId)).toMatchObject({
    bot_meeting_id: first.meetingId,
    project_id: "p1",
    purpose: "app",
  });
  expect(
    Object.values(rows).filter(
      (r) => r._table === "messages" || r._table === "task_runs",
    ),
  ).toHaveLength(0);
  expect(await handler(meetings.openChat)(ctx, { id: first.meetingId })).toBe(
    first.chatId,
  );
});

test.each([
  ["duplicate", ["b1", "b1"]],
  ["missing", ["b1", "missing"]],
  ["too few", ["b1"]],
])(
  "rejects %s participants before writes",
  async (_name, participantBotIds) => {
    const { ctx } = fixture();
    await expect(
      handler(meetings.create)(ctx, { ...meetingArgs, participantBotIds }),
    ).rejects.toThrow();
    expect(ctx.db.insert).not.toHaveBeenCalled();
  },
);

test("rejects cross-project, foreign, and archived bots", async () => {
  const { ctx, rows } = fixture();
  rows.b2.project_id = "p2";
  await expect(handler(meetings.create)(ctx, meetingArgs)).rejects.toThrow();
  rows.b2.project_id = "p1";
  rows.b2.user_id = "u2";
  await expect(handler(meetings.create)(ctx, meetingArgs)).rejects.toThrow();
  rows.b2.user_id = "u1";
  rows.b2.archived_at = 3;
  await expect(handler(meetings.create)(ctx, meetingArgs)).rejects.toThrow();
  expect(ctx.db.insert).not.toHaveBeenCalled();
});

test("schedules through the durable task scheduler and keeps the meeting binding", async () => {
  const { ctx, rows } = fixture();
  const scheduledFor = Date.now() + 3_600_000;
  const result = await handler(meetings.create)(ctx, {
    ...meetingArgs,
    scheduledFor,
    timezone: "Europe/Istanbul",
  });
  const task = rows[rows[result.meetingId].task_id];
  expect(task).toMatchObject({
    project_id: "p1",
    bot_meeting_id: result.meetingId,
    prompt: meetingArgs.agenda,
    schedule_type: "once",
    scheduler_state: "scheduled",
    next_run_at: scheduledFor,
    schedule_version: 1,
  });
  expect(
    Object.values(rows).filter((r) => r._table === "task_runs"),
  ).toHaveLength(0);
});

test("does not create partial meeting records when scheduling is unavailable", async () => {
  const { ctx, rows } = fixture();
  rows.sub.tier = "free";
  await expect(
    handler(meetings.create)(ctx, {
      ...meetingArgs,
      scheduledFor: Date.now() + 3_600_000,
    }),
  ).rejects.toThrow(/Pro or Max/);
  expect(ctx.db.insert).not.toHaveBeenCalled();
});

test("runtime resolves actual participant profiles, rechecks ownership and rejects stale bindings", async () => {
  const { ctx, rows } = fixture();
  const { meetingId, chatId } = await handler(meetings.create)(
    ctx,
    meetingArgs,
  );
  const args = {
    id: meetingId,
    chatId,
    projectId: "p1",
    userId: "u1",
    serviceKey: "test",
  };
  expect(await handler(meetings.getForRuntime)(ctx, args)).toMatchObject({
    profilesJson: [rows.b1.profile_json, rows.b2.profile_json],
    agenda: meetingArgs.agenda,
  });
  await expect(
    handler(meetings.getForRuntime)(ctx, { ...args, userId: "u2" }),
  ).rejects.toThrow();
  await expect(
    handler(meetings.getForRuntime)(ctx, { ...args, chatId: "other" }),
  ).rejects.toThrow();
  rows.b2.archived_at = 1;
  await expect(handler(meetings.getForRuntime)(ctx, args)).rejects.toThrow();
});

async function assignedRun() {
  const fixtureData = fixture(),
    { ctx, rows } = fixtureData;
  const { id } = await handler(tasks.createTask)(ctx, {
    title: "Review",
    prompt: "Review the project.",
    purpose: "app",
    projectId: "p1",
    assigneeBotId: "b1",
    scheduleType: "once",
    scheduledFor: Date.now() + 3_600_000,
    timezone: "UTC",
  });
  rows.run = {
    _id: "run",
    _table: "task_runs",
    user_id: "u1",
    task_id: id,
    execution_key: "occurrence",
    worker_run_id: "worker-1",
    schedule_version: 1,
    status: "queued",
  };
  return {
    ...fixtureData,
    args: {
      serviceKey: "test",
      executionKey: "occurrence",
      workerRunId: "worker-1",
      now: Date.now(),
    },
    taskId: id,
  };
}

test("assigned tasks carry the owned bot conversation into the worker", async () => {
  const { ctx, args } = await assignedRun();
  expect(
    await handler(tasks.beginScheduledRunForBackend)(ctx, args),
  ).toMatchObject({ state: "ready", chatId: "chat-b1", userId: "u1" });
});

test("a busy bot defers the same occurrence without adding messages or losing the task", async () => {
  const { ctx, rows, args } = await assignedRun();
  rows["chat-b1"].active_trigger_run_id = "manual-live-run";
  expect(await handler(tasks.beginScheduledRunForBackend)(ctx, args)).toEqual({
    state: "deferred",
  });
  expect(rows.run).toMatchObject({
    status: "queued",
    execution_key: "occurrence",
    worker_run_id: undefined,
    dispatch_lease_until: args.now + 60_000,
  });
});

test("archiving a bot before execution cancels the scheduled work", async () => {
  const { ctx, rows, args, taskId } = await assignedRun();
  rows.b1.archived_at = 1;
  expect(await handler(tasks.beginScheduledRunForBackend)(ctx, args)).toEqual({
    state: "canceled",
  });
  expect(rows[taskId]).toMatchObject({
    enabled: false,
    scheduler_state: "inactive",
  });
  expect(rows.run.status).toBe("canceled");
});

test("a participant without delegation cannot silently become the meeting leader", async () => {
  const { ctx } = fixture();
  await expect(
    handler(meetings.create)(ctx, {
      ...meetingArgs,
      participantBotIds: ["b2", "b1"],
    }),
  ).rejects.toThrow(
    "Choose a bot with delegation enabled as the first participant.",
  );
  expect(ctx.db.insert).not.toHaveBeenCalled();
});

test("meeting runtime revalidates delegation when the leader profile changes", async () => {
  const { ctx, rows } = fixture();
  const { meetingId, chatId } = await handler(meetings.create)(
    ctx,
    meetingArgs,
  );
  const profile = JSON.parse(rows.b1.profile_json);
  profile.toolIds = profile.toolIds.filter(
    (id: string) => id !== "delegate_task",
  );
  rows.b1.profile_json = JSON.stringify(profile);
  await expect(
    handler(meetings.getForRuntime)(ctx, {
      id: meetingId,
      chatId,
      projectId: "p1",
      userId: "u1",
      serviceKey: "test",
    }),
  ).rejects.toThrow(
    "Choose a bot with delegation enabled as the first participant.",
  );
});

test("an explicitly configured read-only coordinator keeps its permission ceiling", async () => {
  const { ctx, rows } = fixture();
  const profile = JSON.parse(rows.b1.profile_json);
  profile.permissionPreset = "read-only";
  profile.toolIds = ["file", "delegate_task"];
  rows.b1.profile_json = JSON.stringify(profile);
  const { meetingId, chatId } = await handler(meetings.create)(
    ctx,
    meetingArgs,
  );
  const result = await handler(meetings.getForRuntime)(ctx, {
    id: meetingId,
    chatId,
    projectId: "p1",
    userId: "u1",
    serviceKey: "test",
  });
  expect(JSON.parse(result.profilesJson[0])).toMatchObject({
    permissionPreset: "read-only",
    toolIds: ["file", "delegate_task"],
  });
});

async function manualRunFixture() {
  const value = fixture();
  const { id } = await handler(tasks.createTask)(value.ctx, {
    title: "Manual review",
    prompt: "Review the files.",
    purpose: "app",
    scheduleType: "manual",
    projectId: "p1",
    assigneeBotId: "b1",
  });
  return {
    ...value,
    taskId: id,
    args: {
      serviceKey: "test",
      userId: "u1",
      taskId: id,
      requestId: "manual-request-123",
      leaseOwner: "manual-request:manual-request-123",
      now: Date.now(),
    },
  };
}

test("Run now persists one occurrence without changing the saved manual schedule", async () => {
  const { ctx, rows, taskId, args } = await manualRunFixture();
  const a = await handler(tasks.requestManualRunForBackend)(ctx, args);
  const b = await handler(tasks.requestManualRunForBackend)(ctx, args);
  expect(b).toEqual(a);
  expect(a).toMatchObject({
    state: "queued",
    shouldDispatch: true,
    chatId: "chat-b1",
  });
  expect(rows[taskId]).toMatchObject({
    schedule_type: "manual",
    scheduler_state: "inactive",
    enabled: true,
  });
  expect(
    Object.values(rows).filter((r) => r._table === "task_runs"),
  ).toHaveLength(1);
});

test("different click ids while pending return the same occurrence instead of adding another", async () => {
  const { ctx, rows, args } = await manualRunFixture();
  const a = await handler(tasks.requestManualRunForBackend)(ctx, args);
  const b = await handler(tasks.requestManualRunForBackend)(ctx, {
    ...args,
    requestId: "another-click-456",
    leaseOwner: "manual-request:another-click-456",
  });
  expect(b).toMatchObject({
    executionKey: a.executionKey,
    shouldDispatch: false,
    chatId: "chat-b1",
  });
  expect(
    Object.values(rows).filter((r) => r._table === "task_runs"),
  ).toHaveLength(1);
});

test("Run now rejects foreign, disabled, completed and archived bot work", async () => {
  const { ctx, rows, taskId, args } = await manualRunFixture();
  await expect(
    handler(tasks.requestManualRunForBackend)(ctx, { ...args, userId: "u2" }),
  ).rejects.toThrow();
  rows[taskId].enabled = false;
  await expect(
    handler(tasks.requestManualRunForBackend)(ctx, args),
  ).rejects.toThrow();
  rows[taskId].enabled = true;
  rows[taskId].status = "completed";
  await expect(
    handler(tasks.requestManualRunForBackend)(ctx, args),
  ).rejects.toThrow();
  rows[taskId].status = "open";
  rows.b1.archived_at = 1;
  await expect(
    handler(tasks.requestManualRunForBackend)(ctx, args),
  ).rejects.toThrow();
  expect(
    Object.values(rows).filter((r) => r._table === "task_runs"),
  ).toHaveLength(0);
});

test("manual runs remain available without a premium schedule subscription", async () => {
  const { ctx, rows, args } = await manualRunFixture();
  rows.sub.tier = "free";
  const run = await handler(tasks.requestManualRunForBackend)(ctx, args);
  const stored = Object.values(rows).find(
    (r) => r.execution_key === run.executionKey,
  )!;
  stored.worker_run_id = "manual-worker";
  expect(
    await handler(tasks.beginScheduledRunForBackend)(ctx, {
      serviceKey: "test",
      executionKey: run.executionKey,
      workerRunId: "manual-worker",
      now: Date.now(),
    }),
  ).toMatchObject({ state: "ready", subscription: "free", chatId: "chat-b1" });
});

test("the regular dispatcher recovers a manual occurrence after immediate dispatch fails", async () => {
  const { ctx, rows, args, taskId } = await manualRunFixture();
  const run = await handler(tasks.requestManualRunForBackend)(ctx, args);
  const retryAt = args.now + 30_000;
  await handler(tasks.releaseRunDispatchForBackend)(ctx, {
    serviceKey: "test",
    executionKey: run.executionKey,
    leaseOwner: args.leaseOwner,
    retryAt,
  });
  const claims = await handler(tasks.claimDueRunsForBackend)(ctx, {
    serviceKey: "test",
    now: retryAt + 1,
    leaseOwner: "periodic-dispatcher",
    limit: 1,
  });
  expect(claims).toEqual([
    expect.objectContaining({
      taskId,
      executionKey: run.executionKey,
      dispatchAttempt: 2,
    }),
  ]);
  expect(rows[taskId].schedule_type).toBe("manual");
  expect(
    Object.values(rows).filter((row) => row._table === "task_runs"),
  ).toHaveLength(1);
});

test("manual worker authorization accepts its registered run on a free plan", async () => {
  const { ctx, rows, args } = await manualRunFixture();
  rows.sub.tier = "free";
  const run = await handler(tasks.requestManualRunForBackend)(ctx, args);
  const stored = Object.values(rows).find(
    (row) => row.execution_key === run.executionKey,
  )!;
  Object.assign(stored, {
    status: "running",
    agent_run_id: "agent-manual",
    chat_id: "chat-b1",
  });
  expect(
    await handler(tasks.authorizeScheduledAgentRunForBackend)(ctx, {
      serviceKey: "test",
      executionKey: run.executionKey,
      agentRunId: "agent-manual",
      userId: "u1",
      chatId: "chat-b1",
    }),
  ).toEqual({ authorized: true });
});
