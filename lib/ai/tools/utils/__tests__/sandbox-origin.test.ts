/** @jest-environment node */
jest.mock("@e2b/code-interpreter", () => ({
  ...jest.requireActual("e2b"),
  Sandbox: class {
    static list = jest.fn();
    static create = jest.fn();
    static connect = jest.fn();
    static kill = jest.fn();
    sandboxId = "fixture-sandbox";
  },
}));
jest.mock("../sandbox-disk-reclaim", () => ({
  reclaimSandboxDisk: jest.fn().mockResolvedValue(undefined),
}));
import { Sandbox } from "@e2b/code-interpreter";
import { DefaultSandboxManager } from "../sandbox-manager";
import { HybridSandboxManager } from "../hybrid-sandbox-manager";
import { getSandboxContext } from "@/lib/ai/sandbox-context";
import { ensureSandboxConnection } from "../sandbox";
import {
  withConvexClientScope,
  bindConvexClientScope,
} from "@/lib/db/convex-client-scope";
const names = [
  "E2B_TEMPLATE",
  "E2B_API_KEY",
  "E2B_ACCESS_TOKEN",
  "E2B_DOMAIN",
  "E2B_API_URL",
  "E2B_SANDBOX_URL",
  "E2B_DEBUG",
] as const;
const saved = Object.fromEntries(
  names.map((name) => [name, process.env[name]]),
);
function configure(origin: string) {
  for (const name of names) process.env[name] = `${origin}-${name}`;
  process.env.E2B_DEBUG = origin === "a" ? "false" : "true";
}
beforeEach(() => {
  jest.clearAllMocks();
  (Sandbox.list as jest.Mock).mockReturnValue({
    nextItems: jest.fn().mockResolvedValue([]),
  });
  (Sandbox.create as jest.Mock).mockResolvedValue(new (Sandbox as any)());
});
afterEach(() => {
  for (const name of names) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});
it.each(["default", "hybrid"])(
  "late %s manager retains A template and connection origin",
  async (kind) => {
    configure("a");
    const manager = withConvexClientScope(undefined, () =>
      kind === "default"
        ? new DefaultSandboxManager("user-a", jest.fn())
        : new HybridSandboxManager(
            "user-a",
            jest.fn(),
            "e2b",
            "fixture-service",
          ),
    );
    configure("b");
    await withConvexClientScope(undefined, () => manager.getSandbox());
    expect(Sandbox.list).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "a-E2B_API_KEY",
        accessToken: "a-E2B_ACCESS_TOKEN",
        debug: false,
        environmentFallback: false,
        query: { metadata: { userID: "user-a", template: "a-E2B_TEMPLATE" } },
      }),
    );
    expect(Sandbox.create).toHaveBeenCalledWith(
      "a-E2B_TEMPLATE",
      expect.objectContaining({
        apiKey: "a-E2B_API_KEY",
        domain: "a-E2B_DOMAIN",
        apiUrl: "a-E2B_API_URL",
        sandboxUrl: "a-E2B_SANDBOX_URL",
        environmentFallback: false,
      }),
    );
  },
);

it("captures missing config and late bound callbacks at run entry", async () => {
  for (const name of names) delete process.env[name];
  const callback = withConvexClientScope(undefined, () =>
    bindConvexClientScope(() => {
      const origin = getSandboxContext();
      expect(origin.template).toBe("terminal-agent-sandbox");
      expect(origin.connection).toMatchObject({
        environmentFallback: false,
        apiKey: undefined,
        accessToken: undefined,
        debug: false,
        domain: "e2b.app",
        apiUrl: undefined,
        sandboxUrl: undefined,
      });
      expect(Object.isFrozen(origin)).toBe(true);
      expect(Object.isFrozen(origin.connection)).toBe(true);
      return ensureSandboxConnection({
        userID: "user-a",
        setSandbox: jest.fn(),
      });
    }),
  );
  configure("b");
  await withConvexClientScope(undefined, callback);
  expect(Sandbox.create).toHaveBeenCalledWith(
    "terminal-agent-sandbox",
    expect.objectContaining({
      apiKey: undefined,
      accessToken: undefined,
      environmentFallback: false,
      debug: false,
    }),
  );
});
it("retains A and the existing workspace across a template version change", async () => {
  let release!: (items: unknown[]) => void;
  (Sandbox.list as jest.Mock).mockReturnValueOnce({
    nextItems: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  configure("a");
  const run = withConvexClientScope(undefined, () =>
    ensureSandboxConnection({
      userID: "user-a",
      sandboxNamespace: "opaque-a",
      setSandbox: jest.fn(),
    }),
  );
  configure("b");
  (Sandbox.connect as jest.Mock).mockResolvedValueOnce(new (Sandbox as any)());
  release([{ sandboxId: "stale-a", metadata: { sandboxVersion: "old" } }]);
  const log = jest.spyOn(console, "log").mockImplementation(() => {});
  try {
    await run;
  } finally {
    log.mockRestore();
  }
  expect(Sandbox.kill).not.toHaveBeenCalled();
  expect(Sandbox.create).not.toHaveBeenCalled();
  expect(Sandbox.connect).toHaveBeenCalledWith(
    "stale-a",
    expect.objectContaining({
      apiKey: "a-E2B_API_KEY",
      environmentFallback: false,
      timeoutMs: 2 * 60 * 60 * 1000,
    }),
  );
});
it("retains A on existing sandbox reconnect and keeps initial handles untouched", async () => {
  configure("a");
  const manager = withConvexClientScope(
    undefined,
    () => new DefaultSandboxManager("user-a", jest.fn()),
  );
  configure("b");
  (Sandbox.list as jest.Mock).mockReturnValueOnce({
    nextItems: jest
      .fn()
      .mockResolvedValue([
        { sandboxId: "existing-a", metadata: { sandboxVersion: "v15" } },
      ]),
  });
  const existing = new (Sandbox as any)();
  (Sandbox.connect as jest.Mock).mockResolvedValueOnce(existing);
  expect((await manager.getSandbox()).sandbox).toBe(existing);
  expect(Sandbox.connect).toHaveBeenCalledWith(
    "existing-a",
    expect.objectContaining({
      apiKey: "a-E2B_API_KEY",
      environmentFallback: false,
    }),
  );
  expect(Sandbox.create).not.toHaveBeenCalled();
  expect(
    (
      await ensureSandboxConnection(
        { userID: "user-a", setSandbox: jest.fn() },
        { initialSandbox: existing },
      )
    ).sandbox,
  ).toBe(existing);
  expect(Sandbox.list).toHaveBeenCalledTimes(1);
});

it("keeps a rate-limit retry on A after the environment changes", async () => {
  jest.useFakeTimers();
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    configure("a");
    (Sandbox.create as jest.Mock).mockRejectedValueOnce(
      new Error("429 fixture"),
    );
    const run = withConvexClientScope(undefined, () =>
      ensureSandboxConnection({ userID: "user-a", setSandbox: jest.fn() }),
    );
    configure("b");
    await jest.advanceTimersByTimeAsync(1000);
    await run;
    expect(Sandbox.create).toHaveBeenCalledTimes(2);
    for (const call of (Sandbox.create as jest.Mock).mock.calls) {
      expect(call[0]).toBe("a-E2B_TEMPLATE");
      expect(call[1]).toMatchObject({
        apiKey: "a-E2B_API_KEY",
        environmentFallback: false,
      });
    }
  } finally {
    warn.mockRestore();
    jest.useRealTimers();
  }
});

it.each(["connection timeout", "429 rate limit", "proxy not found"])(
  "a reconnect error (%s) cannot destroy or silently replace existing work",
  async (message) => {
    (Sandbox.list as jest.Mock).mockReturnValueOnce({
      nextItems: async () => [
        { sandboxId: "saved", metadata: { sandboxVersion: "v15" } },
      ],
    });
    (Sandbox.connect as jest.Mock).mockRejectedValueOnce(new Error(message));
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        ensureSandboxConnection({ userID: "user-a", setSandbox: jest.fn() }),
      ).rejects.toThrow();
      expect(Sandbox.kill).not.toHaveBeenCalled();
      expect(Sandbox.create).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  },
);
