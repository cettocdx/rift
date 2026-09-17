/** @jest-environment node */
// The repository maps jose to a stub. Bundle the installed ESM package only
// for this test and execute its real cryptographic implementation in Node.
jest.mock("jose", () => {
  const fs = jest.requireActual("node:fs");
  // Resolve the declared Trigger CLI dependency, independent of hoisting.
  const esbuildPath = require.resolve("esbuild", {
    paths: [fs.realpathSync(process.cwd() + "/node_modules/trigger.dev")],
  });
  const { buildSync } = jest.requireActual(esbuildPath);
  const Module = jest.requireActual("node:module");
  const filename = process.cwd() + "/node_modules/jose/dist/webapi/index.js";
  const result = buildSync({
    entryPoints: [filename],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    target: "node22",
  });
  const loaded = new Module(filename);
  loaded._compile(result.outputFiles[0].text, filename);
  return loaded.exports;
});
import { jwtVerify } from "jose";
const mockQueries: Array<{ url: string; args: any }> = [];
const mockClients: any[] = [];
let mockBeforeQuery: (() => Promise<void>) | undefined;
jest.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    constructor(readonly url: string) {}
    async query(_ref: unknown, args: any) {
      mockQueries.push({ url: this.url, args });
      await mockBeforeQuery?.();
      return [
        {
          connectionId: "runner-a",
          name: "runner",
          capabilities: { commands: true, pty: true },
          isDesktop: false,
        },
        { connectionId: "desktop-a", isDesktop: true, lastSeen: 1 },
      ];
    }
  },
}));
jest.mock("centrifuge", () => ({
  Centrifuge: class extends jest.requireActual("node:events").EventEmitter {
    sub: any;
    constructor(
      readonly url: string,
      readonly options: any,
    ) {
      super();
      mockClients.push(this);
    }
    newSubscription(channel: string) {
      this.sub = Object.assign(
        new (jest.requireActual("node:events").EventEmitter)(),
        {
          channel,
          subscribe: jest.fn(),
          unsubscribe: jest.fn(),
          presence: async () => ({
            clients: {
              fixture: { connInfo: { connectionId: "runner-a" } },
              desktop: { connInfo: { connectionId: "desktop-a" } },
            },
          }),
          publish: jest.fn(async (message: any) => {
            if (message.type === "command")
              queueMicrotask(() =>
                this.sub.emit("publication", {
                  data: {
                    type: "exit",
                    commandId: message.commandId,
                    exitCode: 0,
                  },
                }),
              );
            if (message.type === "pty_create")
              queueMicrotask(() =>
                this.sub.emit("publication", {
                  data: {
                    type: "pty_ready",
                    sessionId: message.sessionId,
                    pid: 123,
                  },
                }),
              );
            if (message.type === "pty_kill")
              queueMicrotask(() =>
                this.sub.emit("publication", {
                  data: {
                    type: "pty_exit",
                    sessionId: message.sessionId,
                    exitCode: 0,
                  },
                }),
              );
            if (message.type === "desktop_local_access_request")
              queueMicrotask(() =>
                this.sub.emit("publication", {
                  data: {
                    type: "desktop_local_access_result",
                    requestId: message.requestId,
                    ok: true,
                    result:
                      message.operation === "list_grants"
                        ? []
                        : message.operation === "fetch_loopback"
                          ? {
                              status: 200,
                              finalUrl: "http://localhost:5173/",
                              contentType: "text/html",
                              encoding: "utf8",
                              body: "<main>Ready</main>",
                              bytes: 18,
                              truncated: false,
                            }
                          : { enabled: true },
                  },
                }),
              );
          }),
        },
      );
      return this.sub;
    }
    connect() {
      queueMicrotask(() => this.sub.emit("subscribed"));
    }
    disconnect() {}
  },
}));
import { CentrifugoSandbox } from "@/lib/ai/tools/utils/centrifugo-sandbox";
import { HybridSandboxManager } from "@/lib/ai/tools/utils/hybrid-sandbox-manager";
import { createCentrifugoPtyHandle } from "@/lib/ai/tools/utils/centrifugo-pty-adapter";
import { createDesktopComputerTools } from "@/lib/ai/tools/desktop-computer";
import { createDesktopWorkspaceToolSets } from "@/lib/ai/tools/desktop-workspace";
import { createTools } from "@/lib/ai/tools";
import { generateCentrifugoToken } from "../jwt";
import {
  withConvexClientScope,
  bindConvexClientScope,
} from "@/lib/db/convex-client-scope";
const names = [
  "CENTRIFUGO_WS_URL",
  "CENTRIFUGO_TOKEN_SECRET",
  "NEXT_PUBLIC_CONVEX_URL",
  "CONVEX_SERVICE_ROLE_KEY",
] as const;
const saved = Object.fromEntries(
  names.map((name) => [name, process.env[name]]),
);
function configure(origin: string) {
  process.env.CENTRIFUGO_WS_URL = `wss://${origin}.example.test/connection/websocket`;
  process.env.CENTRIFUGO_TOKEN_SECRET = `fixture-secret-${origin}`;
  process.env.NEXT_PUBLIC_CONVEX_URL = `https://${origin}.convex.cloud`;
  process.env.CONVEX_SERVICE_ROLE_KEY = `service-${origin}`;
}
const key = (name: string) =>
  new TextEncoder().encode(`fixture-secret-${name}`);
const connection = {
  connectionId: "runner-a",
  name: "runner",
  capabilities: { commands: true, pty: true },
} as any;
const execute = (definition: any) =>
  definition.execute(
    { brief: "fixture" },
    { toolCallId: "fixture", messages: [] },
  );
beforeEach(() => {
  mockClients.length = 0;
  mockQueries.length = 0;
  mockBeforeQuery = undefined;
});
afterEach(() => {
  for (const name of names) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});
async function expectA(token: string, ttl?: number) {
  const verified = await jwtVerify(token, key("a"), { algorithms: ["HS256"] });
  expect(verified.payload.sub).toBe("user-a");
  expect(verified.protectedHeader).toEqual({ alg: "HS256", typ: "JWT" });
  if (ttl) {
    const now = Math.floor(Date.now() / 1000);
    expect(verified.payload.exp).toBeGreaterThanOrEqual(now + ttl - 2);
    expect(verified.payload.exp).toBeLessThanOrEqual(now + ttl + 1);
  }
  expect(verified.payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  await expect(jwtVerify(token, key("b"))).rejects.toThrow();
}
it("copies incoming relay config and signs A tokens after caller mutation and B scope", async () => {
  configure("a");
  const config = {
    wsUrl: process.env.CENTRIFUGO_WS_URL!,
    tokenSecret: process.env.CENTRIFUGO_TOKEN_SECRET!,
  };
  const sandbox = new CentrifugoSandbox("user-a", connection, config);
  config.wsUrl = "wss://mutated.example.test";
  config.tokenSecret = "mutated";
  configure("b");
  expect(sandbox.getWsUrl()).toBe("wss://a.example.test/connection/websocket");
  await expectA(
    await withConvexClientScope(undefined, () => sandbox.issueToken(600)),
  );
});
it("keeps actual PTY refresh callback on A after B starts", async () => {
  configure("a");
  const sandbox = new CentrifugoSandbox("user-a", connection, {
    wsUrl: process.env.CENTRIFUGO_WS_URL!,
    tokenSecret: process.env.CENTRIFUGO_TOKEN_SECRET!,
  });
  const handle = await createCentrifugoPtyHandle(sandbox, {
    command: "echo fixture",
    cols: 80,
    rows: 24,
  });
  const client = mockClients[0];
  configure("b");
  try {
    await expectA(client.options.token, 600);
    await expectA(
      await withConvexClientScope(undefined, () => client.options.getToken()),
      600,
    );
    expect(client.url).toBe("wss://a.example.test/connection/websocket");
  } finally {
    // Drain the existing 1.5s PTY shutdown grace timer without leaving handles.
    jest.useFakeTimers();
    try {
      const closing = handle.kill();
      await jest.runAllTimersAsync();
      await closing;
    } finally {
      jest.useRealTimers();
    }
  }
  await expect(client.options.getToken()).rejects.toThrow(/closed/);
});
it("scoped missing signing authority cannot borrow B", async () => {
  configure("a");
  delete process.env.CENTRIFUGO_TOKEN_SECRET;
  const sign = withConvexClientScope(undefined, () =>
    bindConvexClientScope(() => generateCentrifugoToken("user-a", 30)),
  );
  configure("b");
  await expect(sign()).rejects.toThrow(/SECRET|configured/);
});
it("late manager owner query and presence token remain on A", async () => {
  configure("a");
  const manager = withConvexClientScope(
    undefined,
    () =>
      new HybridSandboxManager("user-a", jest.fn(), "runner-a", "service-a"),
  );
  configure("b");
  const result = await withConvexClientScope(undefined, () =>
    manager.getSandbox(),
  );
  expect(mockQueries).toEqual([
    {
      url: "https://a.convex.cloud",
      args: { userId: "user-a", serviceKey: "service-a" },
    },
  ]);
  await expectA(mockClients[0].options.token);
  expect(mockClients[0].url).toBe("wss://a.example.test/connection/websocket");
  await (result.sandbox as CentrifugoSandbox).close();
});
it.each([
  "CENTRIFUGO_WS_URL",
  "CENTRIFUGO_TOKEN_SECRET",
  "NEXT_PUBLIC_CONVEX_URL",
])("missing originating %s prevents a local relay connection", async (name) => {
  configure("a");
  delete process.env[name];
  const manager = withConvexClientScope(
    undefined,
    () =>
      new HybridSandboxManager("user-a", jest.fn(), "runner-a", "service-a"),
  );
  configure("b");
  await expect(
    withConvexClientScope(undefined, () => manager.getSandbox()),
  ).rejects.toThrow(/configured|authorized/);
  expect(mockClients).toHaveLength(0);
});
it.each(["computer", "workspace"])(
  "late %s tools retain A owner query, relay and signature",
  async (kind) => {
    configure("a");
    const tool = withConvexClientScope(undefined, () =>
      kind === "computer"
        ? createDesktopComputerTools({
            userId: "user-a",
            serviceKey: "service-a",
            canViewScreenshots: () => true,
          }).all.desktop_access_status
        : createDesktopWorkspaceToolSets({
            userId: "user-a",
            serviceKey: "service-a",
          }).all.desktop_workspace_list_grants,
    );
    configure("b");
    const result = await withConvexClientScope(undefined, () => execute(tool));
    expect(result.ok).toBe(true);
    expect(mockQueries[0]).toEqual({
      url: "https://a.convex.cloud",
      args: { serviceKey: "service-a", userId: "user-a" },
    });
    await expectA(mockClients[0].options.token);
    expect(mockClients[0].url).toBe(
      "wss://a.example.test/connection/websocket",
    );
    expect(JSON.stringify(result)).not.toMatch(/fixture-secret|service-a/);
  },
);

it("ordinary commands sign with copied A config after B starts", async () => {
  configure("a");
  const sandbox = new CentrifugoSandbox("user-a", connection, {
    wsUrl: process.env.CENTRIFUGO_WS_URL!,
    tokenSecret: process.env.CENTRIFUGO_TOKEN_SECRET!,
  });
  configure("b");
  try {
    await withConvexClientScope(undefined, () =>
      sandbox.commands.run("echo fixture", { timeoutMs: 100 }),
    );
    await expectA(mockClients[0].options.token);
    expect(mockClients[0].url).toBe(
      "wss://a.example.test/connection/websocket",
    );
  } finally {
    await sandbox.close();
  }
});
it("presence retains A signature when ownership lookup settles after B starts", async () => {
  configure("a");
  let release!: () => void;
  mockBeforeQuery = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  const manager = withConvexClientScope(
    undefined,
    () =>
      new HybridSandboxManager("user-a", jest.fn(), "runner-a", "service-a"),
  );
  const pending = manager.getSandbox();
  configure("b");
  release();
  const result = await pending;
  await expectA(mockClients[0].options.token);
  expect(mockQueries[0].url).toBe("https://a.convex.cloud");
  await (result.sandbox as CentrifugoSandbox).close();
});
it.each([
  "CENTRIFUGO_WS_URL",
  "CENTRIFUGO_TOKEN_SECRET",
  "NEXT_PUBLIC_CONVEX_URL",
  "serviceKey",
])("missing originating %s prevents desktop transport", async (name) => {
  configure("a");
  if (name !== "serviceKey") delete process.env[name];
  const tool = withConvexClientScope(
    undefined,
    () =>
      createDesktopComputerTools({
        userId: "user-a",
        serviceKey: name === "serviceKey" ? "" : "service-a",
        canViewScreenshots: () => true,
      }).all.desktop_access_status,
  );
  configure("b");
  const result = await withConvexClientScope(undefined, () => execute(tool));
  expect(result.ok).toBe(false);
  expect(mockQueries).toHaveLength(0);
  expect(mockClients).toHaveLength(0);
});

it.each([
  "desktop_access_status",
  "desktop_workspace_list_grants",
  "browse_url",
])("factory rebuild preserves origin for %s", async (name) => {
  configure("a");
  const args: Parameters<typeof createTools> = [
    "user-a",
    "chat-a",
    { write: jest.fn() } as never,
    "agent",
    {} as never,
  ];
  args[10] = "service-a";
  args[26] = "app";
  const runtime = withConvexClientScope(undefined, () => createTools(...args));
  configure("b");
  const tools = withConvexClientScope(undefined, () =>
    runtime.getToolsForModel("ask-model"),
  );
  const result = await withConvexClientScope(undefined, () =>
    (tools[name] as any).execute(
      { brief: "fixture", url: "http://localhost:5173/" },
      { toolCallId: "fixture", messages: [] },
    ),
  );
  expect(result.ok).toBe(true);
  expect(mockQueries[0]).toEqual({
    url: "https://a.convex.cloud",
    args: { serviceKey: "service-a", userId: "user-a" },
  });
  await expectA(mockClients[0].options.token);
  expect(mockClients[0].url).toBe("wss://a.example.test/connection/websocket");
  expect(JSON.stringify(result)).not.toMatch(/fixture-secret|service-a/);
});
