import { connect, refreshForBackend } from "../github";
jest.mock("../_generated/server", () => ({
  mutation: (c: unknown) => c,
  query: (c: unknown) => c,
}));
const args = {
  serviceKey: "service",
  userId: "alice",
  connectionId: "row1",
  credentialsVersion: 2,
  leaseId: "worker1",
  token: "new",
  refreshToken: "rotated",
  expiresAt: 10000,
  refreshExpiresAt: 20000,
};
const fixture = (row: any) => ({
  auth: { getUserIdentity: async () => ({ subject: "alice|session" }) },
  db: {
    get: jest.fn(async () => row),
    query: () => ({ withIndex: () => ({ first: async () => row }) }),
    patch: jest.fn(),
  },
});
beforeEach(() => {
  process.env.CONVEX_SERVICE_ROLE_KEY = "service";
});
it.each([
  null,
  { _id: "row1", user_id: "bob", credentials_version: 2 },
  { _id: "row1", user_id: "alice", credentials_version: 3 },
])("rejects deleted, foreign, or reconnected credentials", async (row) => {
  const ctx = fixture(row);
  expect(await (refreshForBackend as any).handler(ctx, args)).toEqual({
    success: false,
  });
  expect(ctx.db.patch).not.toHaveBeenCalled();
});
it("rotates matching credentials and increments version", async () => {
  const ctx = fixture({
    _id: "row1",
    user_id: "alice",
    credentials_version: 2,
    refresh_lease_id: "worker1",
  });
  expect(await (refreshForBackend as any).handler(ctx, args)).toEqual({
    success: true,
  });
  expect(ctx.db.patch).toHaveBeenCalledWith(
    "row1",
    expect.objectContaining({
      token: "new",
      refresh_token: "rotated",
      credentials_version: 3,
    }),
  );
});
it("PAT reconnect clears OAuth secrets and invalidates refresh in flight", async () => {
  const ctx = fixture({
    _id: "row1",
    user_id: "alice",
    credentials_version: 2,
    refresh_lease_id: "worker1",
  });
  await (connect as any).handler(ctx, { token: "pat" });
  expect(ctx.db.patch).toHaveBeenCalledWith(
    "row1",
    expect.objectContaining({
      token: "pat",
      refresh_token: undefined,
      expires_at: undefined,
      refresh_expires_at: undefined,
      credentials_version: 3,
    }),
  );
});
it("only one worker can lease a credential version for rotation", async () => {
  const row: any = { _id: "row1", user_id: "alice", credentials_version: 2 };
  const ctx = fixture(row);
  ctx.db.patch.mockImplementation(async (_id, updates) => {
    Object.assign(row, updates);
  });
  const { acquireRefreshForBackend } = await import("../github");
  const leaseArgs = {
    serviceKey: "service",
    userId: "alice",
    connectionId: "row1",
    credentialsVersion: 2,
    leaseId: "worker1",
  };
  expect(
    await (acquireRefreshForBackend as any).handler(ctx, leaseArgs),
  ).toEqual({ success: true });
  expect(
    await (acquireRefreshForBackend as any).handler(ctx, {
      ...leaseArgs,
      leaseId: "worker2",
    }),
  ).toEqual({ success: false });
});
it("reclaims expired leases and rejects their original owner's late commit", async () => {
  const row: any = {
    _id: "row1",
    user_id: "alice",
    credentials_version: 2,
    refresh_lease_id: "worker1",
    refresh_lease_until: Date.now() - 1,
  };
  const ctx = fixture(row);
  ctx.db.patch.mockImplementation(async (_id, updates) => {
    Object.assign(row, updates);
  });
  const { acquireRefreshForBackend } = await import("../github");
  expect(
    await (acquireRefreshForBackend as any).handler(ctx, {
      ...args,
      leaseId: "worker2",
    }),
  ).toEqual({ success: true });
  expect(await (refreshForBackend as any).handler(ctx, args)).toEqual({
    success: false,
  });
});
