jest.mock("../_generated/server", () => ({
  mutation: (config: unknown) => config,
  query: (config: unknown) => config,
}));
jest.mock("../_generated/api", () => ({
  internal: { redisPubsub: { publishCancellation: "publish" } },
}));
jest.mock("../lib/utils", () => ({ validateServiceKey: jest.fn() }));
import { cancelStreamFromClient } from "../chatStreams";

const make = (patch: Record<string, unknown> = {}) => {
  const chat = {
    _id: "chat",
    id: "c1",
    user_id: "u1",
    active_trigger_run_id: "r1",
  };
  const checkpoint = {
    _id: "checkpoint",
    chat_id: "c1",
    user_id: "u1",
    run_id: "r1",
    status: "active",
    checkpoint: { messagesJson: "sensitive transcript" },
    ...patch,
  };
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: "u1|session" }) },
    db: {
      query: (table: string) => ({
        withIndex: () => {
          // These legacy checkpoint cases intentionally have no claim. Keep
          // table reads distinct so the new ownership check cannot mistake a
          // checkpoint fixture for an agent claim.
          const rows =
            table === "chats"
              ? [chat]
              : table === "agent_checkpoints"
                ? [checkpoint]
                : [
                      "agent_run_claims",
                      "hack_http_execution_heads",
                      "hack_http_executions",
                    ].includes(table)
                  ? []
                  : undefined;
          if (!rows) throw new Error(`Unexpected table: ${table}`);
          return {
            first: async () => rows[0] ?? null,
            take: async (count: number) => rows.slice(0, count),
          };
        },
      }),
      patch: jest.fn(async (id: string, fields: object) => {
        Object.assign(id === "chat" ? chat : checkpoint, fields);
      }),
    },
    scheduler: { runAfter: jest.fn() },
  };
  return { ctx, chat, checkpoint };
};
it.each([false, true])(
  "persists cancellation beyond later chat flag resets (discard=%s)",
  async (discard) => {
    const { ctx, checkpoint } = make();
    await (cancelStreamFromClient as any).handler(ctx, {
      chatId: "c1",
      skipSave: discard,
    });
    expect(checkpoint).toMatchObject({
      status: "finished",
      blocked_reason: "canceled",
    });
    expect(checkpoint.checkpoint).toEqual(
      discard ? undefined : { messagesJson: "sensitive transcript" },
    );
  },
);
it.each([{ run_id: "other-run" }, { user_id: "other-owner" }])(
  "does not cancel a different owner/run checkpoint",
  async (patch) => {
    const { ctx, checkpoint } = make(patch);
    await (cancelStreamFromClient as any).handler(ctx, { chatId: "c1" });
    expect(checkpoint.status).toBe("active");
  },
);
