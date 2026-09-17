jest.mock("../_generated/server", () => ({
  mutation: (config: unknown) => config,
  internalMutation: (config: unknown) => config,
  query: (config: unknown) => config,
}));
jest.mock("../_generated/api", () => ({
  internal: {
    chats: {
      deleteAllChatsBatch: "delete-all-chats",
      deleteChatCheckpointsBatch: "delete-checkpoints",
    },
    userDeletion: { deleteTasksAndProjectsBatch: "delete-projects" },
  },
}));
jest.mock("../fileAggregate", () => ({
  fileCountAggregate: { deleteIfExists: jest.fn() },
}));
jest.mock("../lib/utils", () => ({ validateServiceKey: jest.fn() }));
jest.mock("../lib/logger", () => ({ convexLogger: { warn: jest.fn() } }));

const chats = jest.requireActual("../chats");
const { deleteAllUserData } = jest.requireActual("../userDeletion");
const { validateServiceKey } = jest.requireMock("../lib/utils");

function fixture(count = 1) {
  const tables: Record<string, any[]> = {
    chats: [{ _id: "chat-row", id: "chat", user_id: "owner" }],
    agent_checkpoints: [
      ...Array.from({ length: count }, (_, i) => ({
        _id: `checkpoint-${i}`,
        chat_id: "chat",
        user_id: "owner",
        checkpoint: { messagesJson: "private full transcript" },
      })),
      { _id: "other-chat-checkpoint", chat_id: "other-chat", user_id: "owner" },
      { _id: "other-owner-checkpoint", chat_id: "chat", user_id: "other" },
    ],
    messages: [],
  };
  const jobs: Array<{ operation: string; args: any }> = [];
  const reads: Array<{ table: string; limit: number }> = [];
  const ctx: any = {
    auth: {
      getUserIdentity: jest
        .fn()
        .mockResolvedValue({ subject: "owner|session" }),
    },
    scheduler: {
      runAfter: jest.fn(async (_delay, operation, args) => {
        jobs.push({ operation, args });
      }),
    },
    storage: { delete: jest.fn() },
    db: {
      query: jest.fn((table: string) => {
        let criteria: Record<string, unknown> = {};
        let filter = (_row: any) => true;
        const values = () =>
          (tables[table] ?? []).filter(
            (row) =>
              Object.entries(criteria).every(
                ([key, value]) => row[key] === value,
              ) && filter(row),
          );
        const builder: any = {
          withIndex: (_name: string, fn: any) => {
            const q: any = {
              eq: (key: string, value: unknown) => {
                criteria[key] = value;
                return q;
              },
            };
            fn(q);
            return builder;
          },
          filter: (fn: any) => {
            filter = (row) =>
              fn({
                field: (key: string) => row[key],
                eq: (a: unknown, b: unknown) => a === b,
              });
            return builder;
          },
          take: async (limit: number) => {
            reads.push({ table, limit });
            return values().slice(0, limit);
          },
          collect: async () => values(),
          first: async () => values()[0] ?? null,
        };
        return builder;
      }),
      delete: jest.fn(async (id: string) => {
        for (const rows of Object.values(tables)) {
          const at = rows.findIndex((row) => row._id === id);
          if (at >= 0) rows.splice(at, 1);
        }
      }),
    },
  };
  const drain = async () => {
    for (let i = 0; jobs.length && i < 50; i++) {
      const job = jobs.shift()!;
      if (job.operation === "delete-checkpoints")
        await chats.deleteChatCheckpointsBatch.handler(ctx, job.args);
      if (job.operation === "delete-all-chats")
        await chats.deleteAllChatsBatch.handler(ctx, job.args);
    }
    expect(jobs).toHaveLength(0);
  };
  const owned = () =>
    tables.agent_checkpoints.filter(
      (row) => row.chat_id === "chat" && row.user_id === "owner",
    );
  return { ctx, tables, reads, jobs, drain, owned };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("chat deletion also deletes canonical checkpoints", () => {
  it("removes a single chat's snapshot in the same deletion", async () => {
    const f = fixture();
    await chats.deleteChat.handler(f.ctx, { chatId: "chat" });
    expect(f.tables.chats).toHaveLength(0);
    expect(f.owned()).toHaveLength(0);
    expect(f.tables.agent_checkpoints.map((row) => row._id)).toEqual([
      "other-chat-checkpoint",
      "other-owner-checkpoint",
    ]);
  });
  it("removes snapshots during the authenticated batched delete-all path", async () => {
    const f = fixture();
    f.tables.messages.push({ _id: "message-row", chat_id: "chat" });
    await chats.deleteAllChats.handler(f.ctx, {});
    expect(f.owned()).toHaveLength(0);
    await f.drain();
    expect(f.tables.chats).toHaveLength(0);
  });
  it.each(["service", "account"])(
    "schedules bounded snapshot deletion in the %s-wide deletion path",
    async (kind) => {
      const f = fixture();
      if (kind === "service")
        await chats.deleteAllChatsForUser.handler(f.ctx, {
          serviceKey: "valid",
          userId: "owner",
        });
      else await deleteAllUserData.handler(f.ctx, {});
      expect(f.tables.chats).toHaveLength(0);
      expect(f.ctx.scheduler.runAfter).toHaveBeenCalledWith(
        0,
        "delete-checkpoints",
        { chatId: "chat", userId: "owner" },
      );
      await f.drain();
      expect(f.owned()).toHaveLength(0);
    },
  );
  it("cleans duplicate rows through bounded internal batches without crossing ownership", async () => {
    const f = fixture(19);
    await chats.deleteChat.handler(f.ctx, { chatId: "chat" });
    expect(f.owned().length).toBeGreaterThan(0);
    expect(f.owned().length).toBeLessThan(19);
    await f.drain();
    expect(f.owned()).toHaveLength(0);
    expect(
      f.reads
        .filter((read) => read.table === "agent_checkpoints")
        .every((read) => read.limit <= 8),
    ).toBe(true);
    expect(f.tables.agent_checkpoints).toHaveLength(2);
  });
  it("cannot schedule or delete another owner's checkpoint", async () => {
    const f = fixture();
    f.ctx.auth.getUserIdentity.mockResolvedValueOnce({ subject: "stranger" });
    await chats.deleteChat.handler(f.ctx, { chatId: "chat" });
    expect(f.ctx.db.delete).not.toHaveBeenCalled();
    expect(f.jobs).toHaveLength(0);
    validateServiceKey.mockImplementationOnce(() => {
      throw new Error("invalid key");
    });
    await expect(
      chats.deleteAllChatsForUser.handler(f.ctx, {
        serviceKey: "invalid",
        userId: "owner",
      }),
    ).rejects.toThrow();
    expect(f.ctx.db.delete).not.toHaveBeenCalled();
  });
});
