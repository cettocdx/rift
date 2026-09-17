jest.mock("@e2b/code-interpreter", () => ({
  Sandbox: {
    list: jest.fn(),
    create: jest.fn(),
    kill: jest.fn(),
    connect: jest.fn(),
  },
}));
jest.mock("../sandbox-disk-reclaim", () => ({
  reclaimSandboxDisk: jest.fn().mockResolvedValue(undefined),
}));

import { ensureSandboxConnection } from "../sandbox";

const { list, create } = (
  jest.requireMock("@e2b/code-interpreter") as {
    Sandbox: { list: jest.Mock; create: jest.Mock };
  }
).Sandbox;

describe("E2B project identity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    list.mockReturnValue({
      nextItems: jest.fn().mockResolvedValue([]),
    });
    create.mockResolvedValue({ sandboxId: "sandbox-new" });
  });

  it("looks up by opaque namespace and keeps the account owner for cleanup", async () => {
    await ensureSandboxConnection({
      userID: "user-1",
      sandboxNamespace: "rift-project-opaque",
      setSandbox: jest.fn(),
    });

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          metadata: {
            userID: "rift-project-opaque",
            template: expect.any(String),
          },
        },
      }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        metadata: expect.objectContaining({
          userID: "rift-project-opaque",
          ownerUserID: "user-1",
          workspaceScope: "project",
        }),
      }),
    );
  });

  it("preserves the legacy per-user lookup when no project is bound", async () => {
    await ensureSandboxConnection({
      userID: "user-1",
      setSandbox: jest.fn(),
    });

    const metadata = create.mock.calls[0]?.[1]?.metadata;
    expect(metadata).toEqual(
      expect.objectContaining({
        userID: "user-1",
      }),
    );
    expect(metadata).not.toHaveProperty("ownerUserID");
    expect(metadata).not.toHaveProperty("workspaceScope");
  });
});
