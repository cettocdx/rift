/** @jest-environment node */
const mockCalls: Array<{
  url: string;
  operation: string;
  args: Record<string, unknown>;
}> = [];
jest.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    constructor(readonly url: string) {}
    async query(operation: string, args: Record<string, unknown>) {
      mockCalls.push({ url: this.url, operation, args });
      return operation === "mcp-list" ? [] : null;
    }
    async mutation(operation: string, args: Record<string, unknown>) {
      mockCalls.push({ url: this.url, operation, args });
      return { state: "closed" };
    }
  },
}));
jest.mock("@/convex/_generated/api", () => ({
  api: {
    agentRunClaims: { getForBackend: "claim-get" },
    extraUsage: { closeAccountCreditReservation: "credit-close" },
    mcpServers: { listEnabledForBackend: "mcp-list" },
  },
}));
jest.mock("@/lib/db/actions", () => ({ getChatById: jest.fn() }));
jest.mock("../agent-long-runs", () => ({
  cancelRunAndConfirm: jest.fn(),
  getOwnedTaggedRunIds: jest.fn(),
  isRunActive: jest.fn(),
}));
import { withConvexClientScope } from "@/lib/db/convex-client-scope";
import { getAgentRunClaim } from "../agent-run-claims";
import { AccountCreditLifecycle } from "@/lib/billing/account-credit-lifecycle";
import { loadUserMcpTools } from "@/lib/ai/mcp/load-user-mcp-tools";

const A = "https://authority-a.convex.cloud",
  B = "https://authority-b.convex.cloud";
const savedKey = process.env.CONVEX_SERVICE_ROLE_KEY;
afterEach(() => {
  mockCalls.length = 0;
  if (savedKey === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
  else process.env.CONVEX_SERVICE_ROLE_KEY = savedKey;
});
const setup = {
  userId: "owner-A",
  subscription: "pro" as const,
  amountPoints: 1,
  allowAutoReload: false as const,
  runId: "run-A",
  chatId: "chat-A",
  claimId: "claim-A",
};

test("claim reads retain A credentials across awaits while B uses its own scope", async () => {
  process.env.CONVEX_SERVICE_ROLE_KEY = "key-A";
  await withConvexClientScope(A, async () => {
    process.env.CONVEX_SERVICE_ROLE_KEY = "key-B";
    await withConvexClientScope(B, () =>
      getAgentRunClaim({ userId: "owner-B", chatId: "chat-B" }),
    );
    await getAgentRunClaim({ userId: "owner-A", chatId: "chat-A" });
  });
  expect(mockCalls).toEqual([
    {
      url: B,
      operation: "claim-get",
      args: { serviceKey: "key-B", userId: "owner-B", chatId: "chat-B" },
    },
    {
      url: A,
      operation: "claim-get",
      args: { serviceKey: "key-A", userId: "owner-A", chatId: "chat-A" },
    },
  ]);
});

test("billing created after an await captures A authority for out-of-scope close", async () => {
  process.env.CONVEX_SERVICE_ROLE_KEY = "key-A";
  const billing = await withConvexClientScope(A, async () => {
    process.env.CONVEX_SERVICE_ROLE_KEY = "key-B";
    await Promise.resolve();
    return AccountCreditLifecycle.forAgentRun(setup);
  });
  await withConvexClientScope(B, () => billing.closeBeforeUse());
  expect(mockCalls).toEqual([
    {
      url: A,
      operation: "credit-close",
      args: expect.objectContaining({ serviceKey: "key-A", userId: "owner-A" }),
    },
  ]);
});

test("MCP reads use A authority even when loader starts after environment switches to B", async () => {
  process.env.CONVEX_SERVICE_ROLE_KEY = "key-A";
  await withConvexClientScope(A, async () => {
    process.env.CONVEX_SERVICE_ROLE_KEY = "key-B";
    await Promise.resolve();
    await loadUserMcpTools("owner-A", undefined, { lazy: true });
  });
  expect(mockCalls).toEqual([
    {
      url: A,
      operation: "mcp-list",
      args: { serviceKey: "key-A", userId: "owner-A" },
    },
  ]);
});

test("scope without a service key cannot borrow later credentials for billing or MCP", async () => {
  delete process.env.CONVEX_SERVICE_ROLE_KEY;
  await withConvexClientScope(A, async () => {
    process.env.CONVEX_SERVICE_ROLE_KEY = "key-B";
    await Promise.resolve();
    expect(() => AccountCreditLifecycle.forAgentRun(setup)).toThrow(
      "service authority unavailable",
    );
    expect(
      (await loadUserMcpTools("owner-A", undefined, { lazy: true })).tools,
    ).toEqual({});
  });
  expect(mockCalls).toEqual([]);
});
