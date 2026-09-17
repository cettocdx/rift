/** @jest-environment node */
import { getFunctionName } from "convex/server";
import { createHash } from "node:crypto";
import { createAgentRunInputBridge } from "../agent-run-inputs";
import { withConvexClientScope } from "@/lib/db/convex-client-scope";

const mockCalls: Array<{
  url: string;
  kind: string;
  name: string;
  args: Record<string, unknown>;
}> = [];
const receipt = {
  id: "receipt-a",
  clientRequestId: "input-a",
  requestMessageId: "request-a",
  claimId: "claim-a",
  runId: "run-a",
  sequence: 1,
  status: "pending",
  acceptedAt: 1,
};
let mockFailure: Error | undefined;
let mockRead: unknown;
jest.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    constructor(private url: string) {}
    mutation(
      reference: Parameters<typeof getFunctionName>[0],
      args: Record<string, unknown>,
    ) {
      mockCalls.push({
        url: this.url,
        kind: "mutation",
        name: getFunctionName(reference),
        args,
      });
      return mockFailure
        ? Promise.reject(mockFailure)
        : Promise.resolve(receipt);
    }
    query(
      reference: Parameters<typeof getFunctionName>[0],
      args: Record<string, unknown>,
    ) {
      mockCalls.push({
        url: this.url,
        kind: "query",
        name: getFunctionName(reference),
        args,
      });
      return mockFailure
        ? Promise.reject(mockFailure)
        : Promise.resolve(mockRead);
    }
  },
}));
const A = "https://origin-a.convex.cloud";
const B = "https://origin-b.convex.cloud";
const owner = () => ({
  userId: "owner-a",
  chatId: "chat-a",
  requestMessageId: "request-a",
  requestHash: "original-request-hash",
  claimId: "claim-a",
  runId: "run-a",
});
const previousUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const previousKey = process.env.CONVEX_SERVICE_ROLE_KEY;
beforeEach(() => {
  mockCalls.length = 0;
  mockFailure = undefined;
  mockRead = receipt;
  process.env.NEXT_PUBLIC_CONVEX_URL = A;
  process.env.CONVEX_SERVICE_ROLE_KEY = "key-a";
});
afterAll(() => {
  if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_CONVEX_URL;
  else process.env.NEXT_PUBLIC_CONVEX_URL = previousUrl;
  if (previousKey === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
  else process.env.CONVEX_SERVICE_ROLE_KEY = previousKey;
});

it("captures the exact client/key before later scope and environment changes", async () => {
  const bridge = withConvexClientScope(A, () =>
    createAgentRunInputBridge(owner()),
  );
  process.env.NEXT_PUBLIC_CONVEX_URL = B;
  process.env.CONVEX_SERVICE_ROLE_KEY = "key-b";
  await withConvexClientScope(B, async () => {
    await Promise.resolve();
    expect(
      await bridge.enqueue({ clientRequestId: "input-a", text: "Use blue" }),
    ).toBe(receipt);
    expect(await bridge.get("input-a")).toBe(receipt);
  });
  expect(mockCalls.map((call) => [call.url, call.args.serviceKey])).toEqual([
    [A, "key-a"],
    [A, "key-a"],
  ]);
  expect(mockCalls.map((call) => call.name)).toEqual([
    "agentRunInputs:enqueueForBackend",
    "agentRunInputs:getForBackend",
  ]);
});

it("copies only immutable owner/run/request fields and ignores attempted operation overrides", async () => {
  const scope = owner();
  const bridge = createAgentRunInputBridge(scope);
  Object.assign(scope, {
    userId: "owner-b",
    chatId: "chat-b",
    requestMessageId: "request-b",
    requestHash: "hash-b",
    claimId: "claim-b",
    runId: "run-b",
  });
  const spoof = {
    ...scope,
    serviceKey: "attacker-key",
    payloadHash: "attacker-hash",
    clientRequestId: "input-a",
    text: "Use blue",
  };
  await bridge.enqueue(spoof);
  expect(mockCalls[0].args).toEqual({
    ...owner(),
    serviceKey: "key-a",
    clientRequestId: "input-a",
    text: "Use blue",
    payloadHash: createHash("sha256").update("Use blue", "utf8").digest("hex"),
  });
  await bridge.get("input-a");
  expect(mockCalls[1].args).toEqual({
    serviceKey: "key-a",
    userId: "owner-a",
    chatId: "chat-a",
    clientRequestId: "input-a",
  });
});

it("isolates A and B bridges sharing a deployment after asynchronous invocation", async () => {
  const a = withConvexClientScope(A, () => createAgentRunInputBridge(owner()));
  process.env.CONVEX_SERVICE_ROLE_KEY = "key-b";
  const b = withConvexClientScope(A, () =>
    createAgentRunInputBridge({
      ...owner(),
      userId: "owner-b",
      chatId: "chat-b",
      runId: "run-b",
    }),
  );
  await Promise.all([
    Promise.resolve().then(() => b.get("input-b")),
    Promise.resolve().then(() => a.get("input-a")),
  ]);
  expect(
    mockCalls.map((call) => [
      call.args.userId,
      call.args.chatId,
      call.args.serviceKey,
    ]),
  ).toEqual([
    ["owner-b", "chat-b", "key-b"],
    ["owner-a", "chat-a", "key-a"],
  ]);
});

it("rejects missing captured authority without borrowing a later available environment key", async () => {
  delete process.env.CONVEX_SERVICE_ROLE_KEY;
  await withConvexClientScope(A, async () => {
    process.env.CONVEX_SERVICE_ROLE_KEY = "later-key";
    await Promise.resolve();
    expect(() => createAgentRunInputBridge(owner())).toThrow(/service key/i);
  });
  expect(mockCalls).toEqual([]);
});

it("rejects missing deployment before returning a usable bridge", () => {
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  expect(() => createAgentRunInputBridge(owner())).toThrow(/CONVEX_URL/);
  expect(mockCalls).toEqual([]);
});

it("passes transport failures through with no fallback retry or invented acceptance", async () => {
  const bridge = createAgentRunInputBridge(owner());
  mockFailure = new Error("offline");
  process.env.NEXT_PUBLIC_CONVEX_URL = B;
  process.env.CONVEX_SERVICE_ROLE_KEY = "key-b";
  await expect(
    bridge.enqueue({ clientRequestId: "input-a", text: "Use blue" }),
  ).rejects.toBe(mockFailure);
  await expect(bridge.get("input-a")).rejects.toBe(mockFailure);
  expect(mockCalls).toHaveLength(2);
  expect(
    mockCalls.every(
      (call) => call.url === A && call.args.serviceKey === "key-a",
    ),
  ).toBe(true);
});

it("hashes exact UTF-8 text deterministically without trimming or Unicode normalization", async () => {
  const bridge = createAgentRunInputBridge(owner());
  const text = "  café 🌱\nKeep exact bytes\n";
  await bridge.enqueue({ clientRequestId: "input-a", text });
  await bridge.enqueue({ clientRequestId: "input-a", text });
  await bridge.enqueue({
    clientRequestId: "input-a",
    text: text.normalize("NFD"),
  });
  expect(mockCalls[0].args.text).toBe(text);
  expect(mockCalls[0].args.payloadHash).toBe(
    createHash("sha256").update(text, "utf8").digest("hex"),
  );
  expect(mockCalls[1].args.payloadHash).toBe(mockCalls[0].args.payloadHash);
  expect(mockCalls[2].args.payloadHash).not.toBe(mockCalls[0].args.payloadHash);
});

it("returns only backend receipt outcomes, including a missing owner-scoped receipt", async () => {
  const bridge = createAgentRunInputBridge(owner());
  mockRead = null;
  expect(await bridge.get("missing-input")).toBeNull();
  expect(mockCalls[0]).toMatchObject({
    kind: "query",
    args: {
      userId: "owner-a",
      chatId: "chat-a",
      clientRequestId: "missing-input",
    },
  });
});
