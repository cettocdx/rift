/** @jest-environment node */
import { createGithubHandoff, consumeGithubHandoff } from "../oauth-handoff";
import { signState } from "../oauth-state";
const mutation = jest.fn();
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: () => ({ mutation }),
}));
beforeEach(() => {
  mutation.mockReset();
  process.env.GITHUB_OAUTH_CLIENT_ID = "client";
  process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";
  process.env.CONVEX_SERVICE_ROLE_KEY = "service";
  process.env.GITHUB_OAUTH_STATE_SECRET = "state-secret";
});
it("encrypts code/state at rest and exposes only a random ticket", async () => {
  const state = signState("alice", "/c/chat", "a".repeat(64));
  const ticket = await createGithubHandoff(
    "alice",
    state,
    "private-code",
    "https://riftsys.app",
  );
  expect(ticket).toMatch(/^[a-f0-9]{64}$/);
  const stored = mutation.mock.calls[0][1];
  expect(stored.ticketHash).not.toBe(ticket);
  expect(JSON.stringify(stored)).not.toContain("private-code");
  expect(JSON.stringify(stored)).not.toContain(state);
  mutation.mockResolvedValue(stored.ciphertext);
  expect(
    await consumeGithubHandoff("alice", ticket, "https://riftsys.app"),
  ).toEqual({ code: "private-code", returnTo: "/c/chat" });
  expect(
    await consumeGithubHandoff("bob", ticket, "https://riftsys.app"),
  ).toBeNull();
  expect(
    await consumeGithubHandoff("alice", ticket, "https://wrong.test"),
  ).toBeNull();
});
