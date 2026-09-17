jest.mock("@e2b/code-interpreter", () => ({
  Sandbox: class MockSandbox {
    setTimeout = jest.fn().mockResolvedValue(undefined);
  },
}));
jest.mock("../sandbox", () => ({
  ensureSandboxConnection: jest.fn(),
  SANDBOX_KEEPALIVE_MS: 60_000,
}));

import { HybridSandboxManager } from "../hybrid-sandbox-manager";

const { ensureSandboxConnection } = jest.requireMock("../sandbox") as {
  ensureSandboxConnection: jest.Mock;
};

describe("project sandbox namespace wiring", () => {
  beforeEach(() => {
    ensureSandboxConnection.mockReset();
    ensureSandboxConnection.mockImplementation(async (context) => {
      const { Sandbox } = jest.requireMock("@e2b/code-interpreter") as {
        Sandbox: new () => { setTimeout: jest.Mock };
      };
      const sandbox = new Sandbox();
      context.setSandbox(sandbox);
      return { sandbox };
    });
  });

  it("keeps the account user id and passes the opaque workspace identity separately", async () => {
    const manager = new HybridSandboxManager(
      "user-1",
      jest.fn(),
      "e2b",
      "service-key",
      null,
      "pro",
      undefined,
      "rift-project-opaque",
    );

    await manager.getSandbox();

    expect(ensureSandboxConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        userID: "user-1",
        sandboxNamespace: "rift-project-opaque",
        setSandbox: expect.any(Function),
      }),
      expect.objectContaining({
        initialSandbox: null,
        origin: expect.objectContaining({
          connection: expect.objectContaining({ environmentFallback: false }),
        }),
      }),
    );
  });
});
