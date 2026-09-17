/** @jest-environment node */
jest.mock("server-only", () => ({}));
jest.mock("@trigger.dev/sdk", () => ({ runs: { retrieve: jest.fn() } }));
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: jest.fn(),
  getConvexServiceKey: () => "service",
}));
jest.mock("@e2b/code-interpreter", () => ({
  SandboxNotFoundError: class SandboxNotFoundError extends Error {},
  Sandbox: {
    getInfo: jest.fn(),
    connect: jest.fn(),
    list: jest.fn(),
  },
}));
jest.mock("@/lib/ai/sandbox-context", () => ({
  getSandboxContext: () => ({
    connection: {
      apiKey: "scoped-key",
      accessToken: "scoped-token",
      apiUrl: "https://scope.invalid",
      environmentFallback: false,
    },
  }),
}));
import { runs } from "@trigger.dev/sdk";
import { Sandbox, SandboxNotFoundError } from "@e2b/code-interpreter";
import { getConvexClient } from "@/lib/db/convex-client";
import { reconcileOwnedRemoteExitReceipts } from "../reconcile-remote-exit-receipts";
const owner = {
  userId: "user",
  chatId: "chat",
  claimId: "claim",
  runId: "run",
};
const mutation = jest.fn();
const read = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  (runs.retrieve as jest.Mock).mockResolvedValue({
    id: "run",
    status: "COMPLETED",
    taskIdentifier: "agent-long",
    payload: { userId: "user", chatId: "chat", startClaimId: "claim" },
    metadata: { cleanupDrained: true },
  });
  (getConvexClient as jest.Mock).mockReturnValue({
    mutation,
    query: jest.fn(async (_ref, args) => ({
      page:
        args.state === "reserved"
          ? [
              {
                user_id: "user",
                chat_id: "chat",
                claim_id: "claim",
                run_id: "run",
                sandbox_id: "sandbox",
                resource_id: "resource",
              },
            ]
          : [],
      isDone: true,
      continueCursor: "",
    })),
  });
  mutation.mockResolvedValue(true);
  read.mockResolvedValue(
    JSON.stringify({
      resourceId: "resource",
      pid: 12,
      processIdentity: "supervised-v1:boot:12:resource",
      state: "exited",
      descendantsReaped: true,
    }),
  );
  (Sandbox.connect as jest.Mock).mockResolvedValue({ files: { read } });
});
it.each([
  { userID: "user" },
  {
    userID: "rift-project-opaque",
    ownerUserID: "user",
    workspaceScope: "project",
  },
])(
  "recovers an owned sandbox %j with the scoped provider origin",
  async (metadata) => {
    (Sandbox.getInfo as jest.Mock).mockResolvedValue({
      metadata,
      state: "running",
    });
    expect(await reconcileOwnedRemoteExitReceipts(owner)).toMatchObject({
      reconciled: 1,
      released: true,
    });
    expect(Sandbox.getInfo).toHaveBeenCalledWith(
      "sandbox",
      expect.objectContaining({
        apiKey: "scoped-key",
        accessToken: "scoped-token",
        environmentFallback: false,
      }),
    );
  },
);
it.each([
  { metadata: { userID: "foreign" }, state: "running" },
  {
    metadata: {
      userID: "rift-project-opaque",
      ownerUserID: "foreign",
      workspaceScope: "project",
    },
    state: "running",
  },
  {
    metadata: {
      userID: "user",
      ownerUserID: "foreign",
      workspaceScope: "project",
    },
    state: "running",
  },
  { metadata: { userID: "user" }, state: "paused" },
])("does not resume or release an unverified sandbox %j", async (info) => {
  (Sandbox.getInfo as jest.Mock).mockResolvedValue(info);
  expect(await reconcileOwnedRemoteExitReceipts(owner)).toMatchObject({
    unconfirmed: 1,
    released: false,
  });
  expect(Sandbox.connect).not.toHaveBeenCalled();
  expect(mutation).not.toHaveBeenCalled();
});
it.each(["not found", "Unauthorized", "request timeout"])(
  "does not infer cleanup from %s",
  async (message) => {
    (Sandbox.getInfo as jest.Mock).mockRejectedValue(new Error(message));
    expect(await reconcileOwnedRemoteExitReceipts(owner)).toMatchObject({
      unconfirmed: 1,
      released: false,
    });
    expect(mutation).not.toHaveBeenCalled();
  },
);

it("settles typed provider absence and releases without a process receipt", async () => {
  (Sandbox.getInfo as jest.Mock).mockRejectedValue(
    new SandboxNotFoundError("missing"),
  );
  let remaining = true;
  (Sandbox.list as jest.Mock).mockReturnValue({
    get hasNext() {
      return remaining;
    },
    nextItems: async () => {
      remaining = false;
      return [];
    },
  });
  expect(await reconcileOwnedRemoteExitReceipts(owner)).toMatchObject({
    reconciled: 1,
    released: true,
  });
  expect(Sandbox.list).toHaveBeenCalledWith(
    expect.objectContaining({ query: { state: ["running", "paused"] } }),
  );
  expect(Sandbox.connect).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  expect(mutation).toHaveBeenCalledTimes(3);
});
