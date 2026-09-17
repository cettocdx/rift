import {
  createForBackend,
  consumeForBackend,
  expire,
} from "../githubOAuthHandoffs";
jest.mock("../_generated/server", () => ({
  mutation: (c: unknown) => c,
  internalMutation: (c: unknown) => c,
}));
function fixture() {
  const rows: any[] = [];
  return {
    rows,
    scheduler: { runAfter: jest.fn() },
    db: {
      insert: jest.fn(async (_table: string, row: any) => {
        rows.push({ ...row, _id: "row" });
        return "row";
      }),
      query: () => ({
        withIndex: () => ({ first: async () => rows[0] ?? null }),
      }),
      get: async () => rows[0] ?? null,
      delete: jest.fn(async () => {
        rows.splice(0);
      }),
    },
  };
}
beforeEach(() => {
  process.env.CONVEX_SERVICE_ROLE_KEY = "service";
});
it("keeps codes encrypted, schedules cleanup, and consumes only once for the initiating account", async () => {
  const ctx = fixture();
  await (createForBackend as any).handler(ctx, {
    serviceKey: "service",
    userId: "alice",
    ticketHash: "hash",
    ciphertext: "encrypted",
  });
  expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
    600000,
    expect.anything(),
    { id: "row" },
  );
  const args = { serviceKey: "service", userId: "bob", ticketHash: "hash" };
  expect(await (consumeForBackend as any).handler(ctx, args)).toBeNull();
  expect(ctx.rows).toHaveLength(1);
  args.userId = "alice";
  expect(await (consumeForBackend as any).handler(ctx, args)).toBe("encrypted");
  expect(await (consumeForBackend as any).handler(ctx, args)).toBeNull();
});
it("rejects expired handoffs and deletes them through TTL cleanup", async () => {
  const ctx = fixture();
  ctx.rows.push({
    _id: "row",
    user_id: "alice",
    ticket_hash: "hash",
    ciphertext: "encrypted",
    expires_at: Date.now() - 1,
  });
  expect(
    await (consumeForBackend as any).handler(ctx, {
      serviceKey: "service",
      userId: "alice",
      ticketHash: "hash",
    }),
  ).toBeNull();
  await (expire as any).handler(ctx, { id: "row" });
  expect(ctx.rows).toHaveLength(0);
});
it("rejects untrusted service calls before accessing handoffs", async () => {
  const ctx = fixture();
  await expect(
    (consumeForBackend as any).handler(ctx, {
      serviceKey: "wrong",
      userId: "alice",
      ticketHash: "hash",
    }),
  ).rejects.toThrow();
  expect(ctx.db.delete).not.toHaveBeenCalled();
});
