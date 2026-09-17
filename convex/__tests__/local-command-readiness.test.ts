/** @jest-environment node */
jest.mock("../_generated/server", () => ({
  mutation: (config: unknown) => config,
  internalMutation: (config: unknown) => config,
  query: (config: unknown) => config,
}));
jest.mock("jose", () => ({ SignJWT: class {
  setProtectedHeader() { return this; }
  setExpirationTime() { return this; }
  async sign() { return "test-relay-token"; }
} }));
import { refreshCentrifugoToken } from "../localSandbox";

function context(owner: string, capabilities?: { commands: boolean; pty: boolean }) {
  const connection = { _id: "connection", user_id: owner, status: "connected", capabilities };
  return { db: {
    query: (table: string) => ({ withIndex: () => ({ first: async () =>
      table === "local_sandbox_tokens" ? { user_id: "owner" } : connection }) }),
    patch: jest.fn(async () => {}),
  } };
}
const handler = (refreshCentrifugoToken as unknown as { handler: (ctx: unknown, args: unknown) => Promise<unknown> }).handler;
const args = { token: "fixture", connectionId: "connection", commandReadiness: true };
const previousSecret = process.env.CENTRIFUGO_TOKEN_SECRET;
beforeAll(() => { process.env.CENTRIFUGO_TOKEN_SECRET = "test-only"; });
afterAll(() => { if (previousSecret === undefined) delete process.env.CENTRIFUGO_TOKEN_SECRET; else process.env.CENTRIFUGO_TOKEN_SECRET = previousSecret; });

it("cannot announce readiness capabilities on another user's connection", async () => {
  const ctx = context("other");
  expect(await handler(ctx, args)).toMatchObject({ ok: false, reason: "ownership_mismatch" });
  expect(ctx.db.patch).not.toHaveBeenCalled();
});
it("adds readiness without granting command or PTY permissions", async () => {
  const ctx = context("owner");
  expect(await handler(ctx, args)).toMatchObject({ ok: true });
  expect(ctx.db.patch).toHaveBeenCalledWith("connection", expect.objectContaining({
    capabilities: { commands: false, pty: false, commandReadiness: true },
  }));
});
it("preserves the existing runner permissions", async () => {
  const ctx = context("owner", { commands: true, pty: false });
  await handler(ctx, args);
  expect(ctx.db.patch).toHaveBeenCalledWith("connection", expect.objectContaining({
    capabilities: { commands: true, pty: false, commandReadiness: true },
  }));
});
