jest.mock("@e2b/code-interpreter", () => ({ Sandbox: class MockSandbox {} }));
jest.mock("../sandbox", () => ({
  ensureSandboxConnection: jest.fn(),
  SANDBOX_KEEPALIVE_MS: 60_000,
}));
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: () => ({ query: mockQuery }),
}));
jest.mock("../local-sandbox-presence", () => ({
  assertLocalSandboxOnline: (...args: unknown[]) => mockPresence(...args),
}));
jest.mock("../centrifugo-sandbox", () => ({
  CentrifugoSandbox: class {
    sandboxKind = "centrifugo";
    constructor(
      public user: string,
      public connection: { name: string; capabilities: { pty: boolean } },
    ) {
      mockLocal(this);
    }
    supportsPty() {
      return this.connection.capabilities.pty;
    }
    getSandboxContext() {
      return "Selected local runner";
    }
    close = jest.fn();
  },
}));

import { Sandbox } from "@e2b/code-interpreter";
import { HybridSandboxManager } from "../hybrid-sandbox-manager";
import { ensureSandboxConnection } from "../sandbox";
const mockQuery = jest.fn();
const mockPresence = jest.fn();
const mockLocal = jest.fn();
const connection = {
  connectionId: "runner-1",
  name: "My Mac",
  lastSeen: 1,
  isDesktop: false,
  capabilities: { commands: true, pty: true },
};
const manager = (preference = "runner-1") =>
  new HybridSandboxManager("owner", jest.fn(), preference, "service");
beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue([connection]);
  mockPresence.mockResolvedValue(undefined);
  process.env.CENTRIFUGO_WS_URL = "ws://relay.test";
  process.env.CENTRIFUGO_TOKEN_SECRET = "fixture-secret";
});
afterEach(() => {
  delete process.env.CENTRIFUGO_WS_URL;
  delete process.env.CENTRIFUGO_TOKEN_SECRET;
});

it("uses the exact owned runner and coalesces simultaneous local requests without cloud allocation", async () => {
  const selected = manager();
  const [a, b] = await Promise.all([
    selected.getSandbox(),
    selected.getSandbox(),
  ]);
  expect(mockQuery).toHaveBeenCalledWith(expect.anything(), {
    serviceKey: "service",
    userId: "owner",
  });
  expect(mockPresence).toHaveBeenCalledWith(
    "owner",
    "runner-1",
    "ws://relay.test",
    expect.objectContaining({
      wsUrl: "ws://relay.test",
      tokenSecret: "fixture-secret",
      serviceKey: "service",
    }),
  );
  expect(a.sandbox).toBe(b.sandbox);
  expect(mockLocal).toHaveBeenCalledTimes(1);
  expect(selected.getEffectivePreference()).toBe("runner-1");
  expect(selected.getSandboxInfo()).toEqual({
    type: "remote-connection",
    name: "My Mac",
  });
  expect(ensureSandboxConnection).not.toHaveBeenCalled();
});

it.each([
  { available: [] },
  { available: [{ ...connection, connectionId: "other-owner-runner" }] },
  {
    available: [
      { ...connection, capabilities: { commands: false, pty: false } },
    ],
  },
])(
  "rejects unavailable or non-command connections without creating cloud work",
  async ({ available }) => {
    mockQuery.mockResolvedValue(available);
    await expect(manager().getSandbox()).rejects.toThrow(/local runner/i);
    expect(mockLocal).not.toHaveBeenCalled();
    expect(ensureSandboxConnection).not.toHaveBeenCalled();
  },
);

it("does not turn the consent-scoped Desktop relay into a shell", async () => {
  await expect(manager("desktop").getSandbox()).rejects.toThrow(
    /desktop.*file|local runner/i,
  );
  expect(mockLocal).not.toHaveBeenCalled();
  expect(ensureSandboxConnection).not.toHaveBeenCalled();
});

it("fails closed on presence failure and revalidates a previously selected runner", async () => {
  const selected = manager();
  await selected.getSandbox();
  mockPresence.mockRejectedValue(new Error("Selected local runner is offline"));
  await expect(selected.getSandbox()).rejects.toThrow(/offline/);
  expect(ensureSandboxConnection).not.toHaveBeenCalled();
});

it("reports the actual runner PTY capability", async () => {
  mockQuery.mockResolvedValue([
    { ...connection, capabilities: { commands: true, pty: false } },
  ]);
  await expect(manager().supportsInteractivePty()).resolves.toBe(false);
  expect(ensureSandboxConnection).not.toHaveBeenCalled();
});

it("does not accept a local connection resolved after the user changed destinations", async () => {
  let finish!: () => void;
  mockPresence.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const selected = manager();
  const pending = selected.getSandbox();
  while (!finish) await Promise.resolve();
  await selected.setSandboxPreference("runner-2");
  finish();
  await expect(pending).rejects.toThrow(/changed/);
  expect(mockLocal).not.toHaveBeenCalled();
  expect(ensureSandboxConnection).not.toHaveBeenCalled();
});

it("keeps missing local configuration from becoming a cloud fallback", async () => {
  delete process.env.CENTRIFUGO_WS_URL;
  await expect(manager().getSandbox()).rejects.toThrow(/not configured/);
  expect(ensureSandboxConnection).not.toHaveBeenCalled();
});

it("updates PTY permission from the current authenticated connection metadata", async () => {
  const selected = manager();
  await selected.getSandbox();
  mockQuery.mockResolvedValue([
    { ...connection, capabilities: { commands: true, pty: false } },
  ]);
  await expect(selected.supportsInteractivePty()).resolves.toBe(false);
});

it("does not let an old cloud boot replace a newly selected local runner", async () => {
  const cloud = new (Sandbox as unknown as new () => Sandbox)();
  let finish!: () => void;
  jest.mocked(ensureSandboxConnection).mockImplementationOnce(
    (options) =>
      new Promise((resolve) => {
        finish = () => {
          options.setSandbox(cloud);
          resolve({ sandbox: cloud });
        };
      }),
  );
  const onSandbox = jest.fn();
  const selected = new HybridSandboxManager(
    "owner",
    onSandbox,
    "e2b",
    "service",
  );
  const pending = selected.getSandbox();
  await selected.setSandboxPreference("runner-1");
  const local = await selected.getSandbox();
  finish();

  await expect(pending).rejects.toThrow(/changed/);
  expect(onSandbox).toHaveBeenCalledTimes(1);
  expect(onSandbox).toHaveBeenCalledWith(local.sandbox);
  await expect(selected.getSandbox()).resolves.toEqual(local);
});

it("provides Plan only selected-runner metadata without command guidance or cloud allocation", async () => {
  mockQuery.mockResolvedValue([
    {
      ...connection,
      osInfo: {
        platform: "darwin",
        arch: "arm64",
        release: "fixture",
        hostname: "Work Mac",
      },
    },
  ]);
  const selected = manager();
  const context = await selected.getReadOnlySandboxContextForPrompt();
  expect(context).toContain('local runner "My Mac"');
  expect(context).toContain('"platform":"darwin"');
  expect(context).not.toMatch(/executing commands|DANGEROUS MODE|bash -c/);
  expect(mockPresence).toHaveBeenCalledTimes(1);
  expect(ensureSandboxConnection).not.toHaveBeenCalled();
});

it("does not boot Cloud or connect the picker relay to describe Plan", async () => {
  await expect(
    manager("e2b").getReadOnlySandboxContextForPrompt(),
  ).resolves.toBeNull();
  await expect(
    manager("desktop").getReadOnlySandboxContextForPrompt(),
  ).resolves.toBeNull();
  expect(mockQuery).not.toHaveBeenCalled();
  expect(mockPresence).not.toHaveBeenCalled();
  expect(mockLocal).not.toHaveBeenCalled();
  expect(ensureSandboxConnection).not.toHaveBeenCalled();
});
