/** @jest-environment node */
jest.mock("../_generated/server", () => ({
  mutation: (x: unknown) => x,
  query: (x: unknown) => x,
}));
jest.mock("../lib/utils", () => ({ validateServiceKey: jest.fn() }));
import * as bots from "../projectBots";
import { createProjectBotProfile } from "../../lib/ai/agents/project-bot-templates";

function fixture() {
  const rows: Record<string, any> = {
    p1: { _id: "p1", user_id: "u1", type: "app" },
    p2: { _id: "p2", user_id: "u2", type: "app" },
  };
  let next = 0;
  const db = {
    get: jest.fn(async (id: string) => rows[id] ?? null),
    normalizeId: (_table: string, id: string) => id,
    insert: jest.fn(async (table: string, value: any) => {
      const id = `${table}-${++next}`;
      rows[id] = { ...value, _id: id, _table: table };
      return id;
    }),
    patch: jest.fn(async (id: string, value: any) => {
      Object.assign(rows[id], value);
    }),
    query: (table: string) => ({
      withIndex: (_index: string, fn: any) => {
        const filters: [string, unknown][] = [];
        const q = {
          eq: (key: string, value: unknown) => {
            filters.push([key, value]);
            return q;
          },
        };
        fn(q);
        const result = () =>
          Object.values(rows).filter(
            (r) => r._table === table && filters.every(([k, v]) => r[k] === v),
          );
        return {
          collect: async () => result(),
          unique: async () => result()[0] ?? null,
        };
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
const handler = (x: unknown) => (x as any).handler;

test("creates bot and bound Build conversation once for retried request", async () => {
  const { ctx, rows } = fixture();
  const args = {
    projectId: "p1",
    templateId: "engineer",
    requestId: "same-request-123",
  };
  const a = await handler(bots.create)(ctx, args);
  const b = await handler(bots.create)(ctx, args);
  expect(a).toEqual(b);
  expect(ctx.db.insert).toHaveBeenCalledTimes(2);
  const chat = Object.values(rows).find((r) => r._table === "chats");
  expect(chat).toMatchObject({
    project_id: "p1",
    project_bot_id: a.botId,
    purpose: "app",
  });
  expect(await handler(bots.openChat)(ctx, { id: a.botId })).toBe(a.chatId);
});
test("foreign and archived projects cannot receive bots", async () => {
  const { ctx, rows } = fixture();
  await expect(
    handler(bots.create)(ctx, {
      projectId: "p2",
      templateId: "engineer",
      requestId: "foreign-request",
    }),
  ).rejects.toThrow();
  rows.p1.archived_at = 1;
  await expect(
    handler(bots.create)(ctx, {
      projectId: "p1",
      templateId: "engineer",
      requestId: "archived-request",
    }),
  ).rejects.toThrow();
  expect(ctx.db.insert).not.toHaveBeenCalled();
});
test("profile update cannot borrow credentials or replace stable identity", async () => {
  const { ctx, rows } = fixture();
  const { botId } = await handler(bots.create)(ctx, {
    projectId: "p1",
    templateId: "engineer",
    requestId: "update-request",
  });
  const before = JSON.parse(rows[botId].profile_json);
  const profile = createProjectBotProfile("designer", "replacement");
  profile.mcpServerIds = ["foreign-server"];
  rows["foreign-server"] = { user_id: "u2" };
  await expect(
    handler(bots.update)(ctx, {
      id: botId,
      name: "New",
      mission: "New work",
      profileJson: JSON.stringify(profile),
    }),
  ).rejects.toThrow();
  profile.mcpServerIds = [];
  await handler(bots.update)(ctx, {
    id: botId,
    name: "New",
    mission: "New work",
    profileJson: JSON.stringify(profile),
  });
  expect(JSON.parse(rows[botId].profile_json)).toMatchObject({
    id: before.id,
    mention: before.mention,
    name: "New",
    mission: "New work",
  });
});
test("runtime rejects a mismatched conversation or project and archived bot", async () => {
  const { ctx, rows } = fixture();
  const { botId, chatId } = await handler(bots.create)(ctx, {
    projectId: "p1",
    templateId: "research",
    requestId: "runtime-request",
  });
  const args = {
    id: botId,
    userId: "u1",
    projectId: "p1",
    chatId,
    serviceKey: "test",
  };
  expect(await handler(bots.getForRuntime)(ctx, args)).toHaveProperty(
    "profileJson",
  );
  await expect(
    handler(bots.getForRuntime)(ctx, { ...args, chatId: "other" }),
  ).rejects.toThrow();
  await expect(
    handler(bots.getForRuntime)(ctx, { ...args, projectId: "p2" }),
  ).rejects.toThrow();
  rows[botId].archived_at = 1;
  await expect(handler(bots.getForRuntime)(ctx, args)).rejects.toThrow();
});

test("archiving disables assigned and participant meeting schedules only", async () => {
  const { ctx, rows } = fixture();
  const { botId } = await handler(bots.create)(ctx, {
    projectId: "p1",
    templateId: "lead",
    requestId: "archive-schedules",
  });
  rows.meeting = {
    _id: "meeting",
    _table: "bot_meetings",
    user_id: "u1",
    project_id: "p1",
    participant_bot_ids: [botId],
    chat_id: "meeting-chat",
  };
  rows.assigned = {
    _id: "assigned",
    _table: "tasks",
    user_id: "u1",
    assignee_bot_id: botId,
    enabled: true,
    schedule_version: 2,
    next_run_at: 100,
  };
  rows.scheduledMeeting = {
    _id: "scheduledMeeting",
    _table: "tasks",
    user_id: "u1",
    bot_meeting_id: "meeting",
    enabled: true,
    schedule_version: 3,
    next_run_at: 100,
  };
  rows.other = {
    _id: "other",
    _table: "tasks",
    user_id: "u1",
    enabled: true,
    next_run_at: 100,
  };
  await handler(bots.archive)(ctx, { id: botId });
  expect(rows.assigned).toMatchObject({
    enabled: false,
    scheduler_state: "inactive",
    schedule_version: 3,
  });
  expect(rows.scheduledMeeting).toMatchObject({
    enabled: false,
    scheduler_state: "inactive",
    schedule_version: 4,
  });
  expect(rows.assigned.next_run_at).toBeUndefined();
  expect(rows.other.enabled).toBe(true);
  expect(rows[botId].archived_at).toEqual(expect.any(Number));
});

test("archiving a participant cannot interrupt an active meeting", async () => {
  const { ctx, rows } = fixture();
  const { botId } = await handler(bots.create)(ctx, {
    projectId: "p1",
    templateId: "lead",
    requestId: "archive-active-meeting",
  });
  rows.meeting = {
    _id: "meeting",
    _table: "bot_meetings",
    user_id: "u1",
    project_id: "p1",
    participant_bot_ids: [botId],
    chat_id: "meeting-chat",
  };
  rows.meetingChat = {
    _id: "meetingChat",
    _table: "chats",
    id: "meeting-chat",
    active_trigger_run_id: "running",
  };
  await expect(handler(bots.archive)(ctx, { id: botId })).rejects.toThrow(
    "Stop the active meeting",
  );
  expect(rows[botId].archived_at).toBeUndefined();
});

test("distinct long idempotency keys never collapse bot runtime identities", async () => {
  const { ctx, rows } = fixture();
  const prefix = "request-".repeat(8);
  const a = await handler(bots.create)(ctx, {
    projectId: "p1",
    templateId: "lead",
    requestId: prefix + "a",
  });
  const b = await handler(bots.create)(ctx, {
    projectId: "p1",
    templateId: "lead",
    requestId: prefix + "b",
  });
  const first = JSON.parse(rows[a.botId].profile_json);
  const second = JSON.parse(rows[b.botId].profile_json);
  expect(first.id).not.toEqual(second.id);
  expect(first.mention).not.toEqual(second.mention);
});
