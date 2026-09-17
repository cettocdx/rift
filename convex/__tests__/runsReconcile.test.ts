import { describe, it, expect, jest } from "@jest/globals";

// Time is a candidate selector, never evidence of task termination.

jest.mock("../_generated/server", () => ({
  query: jest.fn((c: any) => c),
  mutation: jest.fn((c: any) => c),
  internalMutation: jest.fn((c: any) => c),
}));
jest.mock("convex/values", () => ({
  // runs.ts builds many validators at module load; every one just needs to
  // exist. What is under test is the handler, not the schema of its arguments.
  v: new Proxy({}, { get: () => () => "validator" }),
  ConvexError: class ConvexError extends Error {},
}));
jest.mock("../lib/utils", () => ({ validateServiceKey: jest.fn() }));

type Row = Record<string, any>;

/** The slice of ctx.db the handler touches: an index range query and a patch. */
function fakeDb(rows: Row[]) {
  return {
    query: (table: string) => ({
      paginate: async ({
        cursor,
        numItems,
      }: {
        cursor: string | null;
        numItems: number;
      }) => {
        const runs = rows.filter((r) => r.started_at !== undefined);
        const start = Number(cursor ?? 0);
        const end = Math.min(runs.length, start + numItems);
        return {
          page: runs.slice(start, end),
          isDone: end >= runs.length,
          continueCursor: String(end),
        };
      },
      withIndex: (_name: string, build: (q: any) => any) => {
        const constraints: ((r: Row) => boolean)[] = [];
        const q: any = {
          eq: (f: string, val: any) => {
            constraints.push((r) => r[f] === val);
            return q;
          },
          lt: (f: string, val: any) => {
            constraints.push((r) => r[f] < val);
            return q;
          },
        };
        build(q);
        return {
          first: async () =>
            rows.find((r) => constraints.every((c) => c(r))) ?? null,
          take: async (n: number) =>
            rows.filter((r) => constraints.every((c) => c(r))).slice(0, n),
        };
      },
    }),
    patch: async (id: string, patch: Row) => {
      const row = rows.find((r) => r._id === id);
      Object.assign(row!, patch);
    },
  };
}

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;
const run = (over: Row): Row => ({
  _id: over.id,
  id: over.id,
  chat_id: "chat",
  user_id: "user",
  status: "starting",
  started_at: NOW - 3 * HOUR,
  update_time: NOW - 3 * HOUR,
  ...over,
});

async function reconcile(rows: Row[], cutoffMs = NOW - 75 * 60 * 1000) {
  const { reconcileStaleRuns } = await import("../runs");
  const handler = (reconcileStaleRuns as any).handler as (
    ctx: any,
    args: { cutoffMs: number; limit: number },
  ) => Promise<{ closedCount: number }>;
  return handler({ db: fakeDb(rows) }, { cutoffMs, limit: 100 });
}

describe("runs.reconcileStaleRuns", () => {
  it.each(["starting", "running", "queued", "stopping", "degraded"])(
    "never closes an old %s run from its age",
    async (status) => {
      const rows = [run({ id: "old", status })];
      expect((await reconcile(rows)).closedCount).toBe(0);
      expect(rows[0].ended_at).toBeUndefined();
      expect(rows[0].status).toBe(status);
    },
  );

  it("closes only the exact final assistant outcome, not a checkpoint", async () => {
    const rows = [
      run({ id: "done", message_id: "final" }),
      run({ id: "live", message_id: "checkpoint" }),
      {
        id: "final",
        user_id: "user",
        chat_id: "chat",
        role: "assistant",
        finish_reason: "stop",
        update_time: NOW,
      },
      {
        id: "checkpoint",
        user_id: "user",
        chat_id: "chat",
        role: "assistant",
        finish_reason: "checkpoint",
        update_time: NOW,
      },
    ];
    expect((await reconcile(rows)).closedCount).toBe(1);
    expect(rows[0]).toMatchObject({ status: "completed", ended_at: NOW });
    expect(rows[1].ended_at).toBeUndefined();
    expect((await reconcile(rows)).closedCount).toBe(0);
  });

  it("does not rewrite an ended or terminal run", async () => {
    const rows = [
      run({ id: "done", ended_at: 123 }),
      run({ id: "complete", status: "completed" }),
    ];
    expect((await reconcile(rows)).closedCount).toBe(0);
    expect(rows[0].ended_at).toBe(123);
    expect(rows[1].status).toBe("completed");
  });

  it("advances past a full page of long-running work to find later saved outcomes", async () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      run({ id: `live-${i}` }),
    );
    rows.push(run({ id: "done", message_id: "final" }), {
      id: "final",
      user_id: "user",
      chat_id: "chat",
      role: "assistant",
      finish_reason: "stop",
      update_time: NOW,
    });
    const { reconcileStaleRuns } = await import("../runs");
    const handler = (reconcileStaleRuns as any).handler;
    const first = await handler(
      { db: fakeDb(rows) },
      { cutoffMs: NOW, limit: 100 },
    );
    expect(first).toMatchObject({ closedCount: 0, isDone: false });
    const second = await handler(
      { db: fakeDb(rows) },
      { cutoffMs: NOW, limit: 100, cursor: first.continueCursor },
    );
    expect(second).toMatchObject({ closedCount: 1, isDone: true });
    expect(rows.slice(0, 100).every((r) => r.ended_at === undefined)).toBe(
      true,
    );
  });
});

describe("owned worker reconciliation", () => {
  it("does not close a worker solely because it was reported missing", async () => {
    const { closeMissingWorker } = await import("../runs");
    const rows = [
      run({ id: "missing" }),
      run({ id: "foreign", user_id: "someone-else" }),
      run({ id: "done", ended_at: 123 }),
    ];
    const invoke = (id: string, chatId = "chat") =>
      (closeMissingWorker as any).handler(
        { db: fakeDb(rows) },
        { serviceKey: "key", userId: "user", chatId, runId: id },
      );
    expect(await invoke("foreign")).toBe(false);
    expect(await invoke("missing", "other-chat")).toBe(false);
    expect(await invoke("done")).toBe(false);
    expect(await invoke("missing")).toBe(false);
    expect(rows[0].ended_at).toBeUndefined();
    expect(rows[1].ended_at).toBeUndefined();
    expect(rows[2].ended_at).toBe(123);
  });
  it("accepts only a final assistant message tied to the same run owner and chat", async () => {
    const { reconcileCompletedMessages } = await import("../runs");
    const rows = [
      run({ id: "final", message_id: "m1" }),
      run({ id: "ongoing", message_id: "m2" }),
      run({ id: "wrong-owner", message_id: "m3" }),
      {
        _id: "m1",
        id: "m1",
        user_id: "user",
        chat_id: "chat",
        role: "assistant",
        finish_reason: "stop",
        update_time: NOW,
      },
      {
        _id: "m2",
        id: "m2",
        user_id: "user",
        chat_id: "chat",
        role: "assistant",
        finish_reason: "tool-calls",
        update_time: NOW,
      },
      {
        _id: "m3",
        id: "m3",
        user_id: "other",
        chat_id: "chat",
        role: "assistant",
        finish_reason: "stop",
        update_time: NOW,
      },
    ];
    await (reconcileCompletedMessages as any).handler(
      { db: fakeDb(rows) },
      {
        serviceKey: "key",
        userId: "user",
        runIds: ["final", "ongoing", "wrong-owner"],
      },
    );
    expect(rows[0].status).toBe("completed");
    expect(rows[0].ended_at).toBe(NOW);
    expect(rows[1].ended_at).toBeUndefined();
    expect(rows[2].ended_at).toBeUndefined();
  });
});

it.each(["checkpoint", "tool-calls", "unknown", "future-reason"])(
  "never treats %s as a saved final outcome",
  async (finish_reason) => {
    const { reconcileCompletedMessages } = await import("../runs");
    const rows = [
      run({ id: "live", message_id: "partial" }),
      {
        id: "partial",
        user_id: "user",
        chat_id: "chat",
        role: "assistant",
        finish_reason,
        update_time: NOW,
      },
    ];
    await (reconcileCompletedMessages as any).handler(
      { db: fakeDb(rows) },
      { serviceKey: "key", userId: "user", runIds: ["live"] },
    );
    expect(rows[0].ended_at).toBeUndefined();
  },
);

const finalMessage = (over: Row = {}): Row => ({
  _id: "saved",
  id: "saved",
  user_id: "user",
  chat_id: "chat",
  role: "assistant",
  finish_reason: "stop",
  update_time: NOW,
  ...over,
});
it("repairs the historical missing-worker outcome using its exact saved final message", async () => {
  const { reconcileCompletedMessages } = await import("../runs");
  const rows = [
    run({
      id: "legacy",
      message_id: "saved",
      status: "disconnected",
      stop_reason: "worker_not_found",
      ended_at: NOW - HOUR,
    }),
    finalMessage(),
  ];
  await (reconcileCompletedMessages as any).handler(
    { db: fakeDb(rows) },
    { serviceKey: "key", userId: "user", runIds: ["legacy"] },
  );
  expect(rows[0]).toMatchObject({
    status: "completed",
    stop_reason: "persisted_outcome",
    finish_reason: "stop",
    ended_at: NOW,
  });
});
it.each([
  { finish_reason: "checkpoint" },
  { finish_reason: "tool-calls" },
  { finish_reason: "future" },
  { user_id: "other" },
  { chat_id: "other" },
  { role: "user" },
  { update_time: NOW - 4 * HOUR },
])(
  "does not repair legacy missing-worker status from unrelated or partial evidence %j",
  async (over) => {
    const { reconcileCompletedMessages } = await import("../runs");
    const rows = [
      run({
        id: "legacy",
        message_id: "saved",
        status: "disconnected",
        stop_reason: "worker_not_found",
        ended_at: 123,
      }),
      finalMessage(over),
    ];
    await (reconcileCompletedMessages as any).handler(
      { db: fakeDb(rows) },
      { serviceKey: "key", userId: "user", runIds: ["legacy"] },
    );
    expect(rows[0]).toMatchObject({ status: "disconnected", ended_at: 123 });
  },
);
it.each(["cancelled", "failed", "completed"])(
  "preserves an authoritative %s outcome despite a late message",
  async (status) => {
    const { reconcileCompletedMessages } = await import("../runs");
    const rows = [
      run({
        id: "terminal",
        message_id: "saved",
        status,
        stop_reason: "user",
        ended_at: 123,
      }),
      finalMessage(),
    ];
    await (reconcileCompletedMessages as any).handler(
      { db: fakeDb(rows) },
      { serviceKey: "key", userId: "user", runIds: ["terminal"] },
    );
    expect(rows[0]).toMatchObject({
      status,
      ended_at: 123,
      stop_reason: "user",
    });
  },
);
it("lets a late worker finish repair only the persisted missing-worker misclassification", async () => {
  const { finishRun } = await import("../runs");
  const rows = [
    run({
      id: "legacy",
      message_id: "saved",
      status: "disconnected",
      stop_reason: "worker_not_found",
      ended_at: 123,
    }),
    finalMessage(),
  ];
  await (finishRun as any).handler(
    { db: fakeDb(rows) },
    { serviceKey: "key", runId: "legacy", status: "completed", costDollars: 1 },
  );
  expect(rows[0]).toMatchObject({
    status: "completed",
    ended_at: NOW,
    cost_dollars: 1,
  });
});
