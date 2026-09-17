jest.mock("../_generated/server", () => ({
  query: (config: unknown) => config,
  mutation: (config: unknown) => config,
  internalMutation: (config: unknown) => config,
}));
jest.mock("../lib/utils", () => ({
  validateServiceKey: (key: string) => {
    if (key !== "service") throw new Error("Unauthorized");
  },
}));
import { decide, consume, request, pending } from "../approvals";

it("binds a pending review to its exact tool invocation for activity rendering", async () => {
  const rows = [
    {
      _id: "approval",
      toolName: "run_terminal_cmd",
      toolCallId: "pending-call",
      preview: "{}",
      expiresAt: Date.now() + 60000,
    },
  ];
  const take = jest.fn(async () => rows);
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: "owner|session" }) },
    db: { query: () => ({ withIndex: () => ({ take }) }) },
  };
  expect(await (pending as any).handler(ctx, { chatId: "chat" })).toEqual(rows);
});
const fixture = (override = {}) => {
  const row = {
    _id: "approval",
    userId: "owner",
    runId: "run",
    status: "pending",
    expiresAt: Date.now() + 60000,
    ...override,
  };
  return {
    row,
    ctx: {
      auth: {
        getUserIdentity: jest.fn(async () => ({ subject: "owner|session" })),
      },
      db: {
        get: jest.fn(async () => row),
        patch: jest.fn(async (_: string, values: object) =>
          Object.assign(row, values),
        ),
      },
    },
  };
};
it("only the request owner can approve", async () => {
  const { ctx } = fixture({ userId: "another-user" });
  await expect(
    (decide as any).handler(ctx, { id: "approval", approve: true }),
  ).rejects.toThrow("Not authorized");
  expect(ctx.db.patch).not.toHaveBeenCalled();
});
it("expired approval cannot authorize an action", async () => {
  const { ctx } = fixture({ expiresAt: Date.now() - 1 });
  await expect(
    (decide as any).handler(ctx, { id: "approval", approve: true }),
  ).rejects.toThrow("no longer active");
});
it("decisions are immutable and an allow-once decision is consumed exactly once", async () => {
  const { ctx } = fixture();
  await (decide as any).handler(ctx, { id: "approval", approve: true });
  await expect(
    (decide as any).handler(ctx, { id: "approval", approve: false }),
  ).rejects.toThrow();
  const args = {
    serviceKey: "service",
    id: "approval",
    userId: "owner",
    runId: "run",
  };
  expect(await (consume as any).handler(ctx, args)).toBe("approved");
  expect(await (consume as any).handler(ctx, args)).toBe("consumed");
});
it("a different run cannot consume an approval", async () => {
  const { ctx } = fixture({ status: "approved" });
  await expect(
    (consume as any).handler(ctx, {
      serviceKey: "service",
      id: "approval",
      userId: "owner",
      runId: "other",
    }),
  ).rejects.toThrow("Not authorized");
});
it("creating approval requests requires backend authority", async () => {
  await expect(
    (request as any).handler({}, { serviceKey: "invalid" }),
  ).rejects.toThrow("Unauthorized");
});

it("terminal approval requires the exact owner, chat and live decision", async () => {
  const { decideForBackend } = await import("../approvals");
  const { ctx, row } = fixture({ chatId: "terminal-chat" });
  const args = {
    serviceKey: "service",
    userId: "owner",
    chatId: "terminal-chat",
    id: "approval",
    approve: true,
  };
  await expect(
    (decideForBackend as any).handler(ctx, { ...args, userId: "other" }),
  ).rejects.toThrow("Not authorized");
  await expect(
    (decideForBackend as any).handler(ctx, { ...args, chatId: "main-chat" }),
  ).rejects.toThrow("Not authorized");
  expect(ctx.db.patch).not.toHaveBeenCalled();
  await (decideForBackend as any).handler(ctx, args);
  expect(row.status).toBe("approved");
  await expect((decideForBackend as any).handler(ctx, args)).rejects.toThrow(
    "expired",
  );
});
