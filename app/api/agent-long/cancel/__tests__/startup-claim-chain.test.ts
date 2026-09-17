/** @jest-environment node */
const mockQuery = jest.fn(),
  mockMutation = jest.fn(),
  mockCancel = jest.fn();
jest.mock("@/convex/_generated/server", () => ({
  mutation: (v: unknown) => v,
  query: (v: unknown) => v,
  internalMutation: (v: unknown) => v,
}));
jest.mock("@/convex/_generated/api", () => ({
  api: {
    agentRunClaims: Object.fromEntries(
      [
        "reserve",
        "getForBackend",
        "requestCancellation",
        "release",
        "activateForWorker",
        "isExecutionCurrent",
      ].map((k) => [k, k]),
    ),
  },
}));
jest.mock("@/lib/db/convex-client", () => ({
  ...jest.requireActual<typeof import("@/lib/db/convex-client")>(
    "@/lib/db/convex-client",
  ),
  getConvexClient: () => ({ query: mockQuery, mutation: mockMutation }),
}));
jest.mock("@/lib/auth/get-user-id", () => ({
  getUserIDAndPro: async () => ({ userId: "owner" }),
}));
jest.mock("@/lib/db/actions", () => ({
  getChatById: async () => null,
  getActiveTriggerRun: async () => null,
  setActiveTriggerRun: jest.fn(),
}));
jest.mock("@/lib/api/agent-long-runs", () => ({
  cancelRunAndConfirm: (...args: unknown[]) => mockCancel(...args),
  cancelClaimedRunAndConfirm: (...args: unknown[]) => mockCancel(...args),
  getOwnedTaggedRunIds: async () => [],
  isRunActive: async () => false,
}));
import type { NextRequest } from "next/server";
import { createUIMessageStream } from "ai";
import * as handlers from "@/convex/agentRunClaims";
import { startClaimedAgentRunForWorker } from "@/lib/api/agent-run-claims";
import { createWorkerClaimCancellation } from "@/lib/agent/claim-cancellation";
import { POST } from "../route";
const owner = { userId: "owner", chatId: "chat" };
const a = { ...owner, claimId: "claim-a" },
  run = { ...a, runId: "run-a" };
const b = { ...owner, claimId: "claim-b" };
const KEY = "startup-chain-authority";
function fixture() {
  const tables: Record<string, any[]> = {
    chats: [],
    agent_run_claims: [],
    agent_dispatch_requests: [],
    hack_http_execution_heads: [],
    hack_http_executions: [],
  };
  const db = {
    query: (table: string) => ({
      withIndex: (_index: string, fn: (q: any) => unknown) => {
        const eqs: Record<string, unknown> = {};
        const q = {
          eq: (k: string, v: unknown) => {
            eqs[k] = v;
            return q;
          },
        };
        fn(q);
        return {
          take: async (n: number) =>
            tables[table]
              .filter((r) => Object.entries(eqs).every(([k, v]) => r[k] === v))
              .slice(0, n),
        };
      },
    }),
    insert: async (table: string, data: object) => {
      const row = {
        _id: `${table}-${tables[table].length}`,
        _creationTime: Date.now(),
        ...data,
      };
      tables[table].push(row);
      return row._id;
    },
    patch: async (id: string, data: object) => {
      Object.assign(
        Object.values(tables)
          .flat()
          .find((r) => r._id === id),
        data,
      );
    },
  };
  const ctx = { db };
  let hook: ((name: string, args: any) => Promise<void>) | undefined;
  const calls: { name: string; args: any }[] = [];
  const raw = (name: string, args: any) =>
    (handlers as any)[name].handler(ctx, { ...args, serviceKey: KEY });
  mockQuery.mockImplementation((name, args) => raw(name, args));
  mockMutation.mockImplementation(async (name, args) => {
    calls.push({ name, args });
    await hook?.(name, args);
    return raw(name, args);
  });
  return {
    tables,
    calls,
    raw,
    setHook(value: typeof hook) {
      hook = value;
    },
  };
}
const previous = process.env.CONVEX_SERVICE_ROLE_KEY;
beforeAll(() => {
  process.env.CONVEX_SERVICE_ROLE_KEY = KEY;
});
afterAll(() => {
  if (previous === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
  else process.env.CONVEX_SERVICE_ROLE_KEY = previous;
});
beforeEach(() => {
  jest.resetAllMocks();
  mockCancel.mockResolvedValue(undefined);
});
const req = () =>
  ({
    json: async () => ({ chatId: owner.chatId, temporary: true }),
  }) as unknown as NextRequest;
it("route-only unbound Stop preserves the marker through release and the real worker emits abort", async () => {
  const f = fixture();
  await f.raw("reserve", a);
  const response = await POST(req());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ canceled: true });
  const row = await f.raw("getForBackend", owner);
  expect(row.phase).toBe("released");
  expect(row.cancelRequestedAt).toEqual(expect.any(Number));
  const stop = createWorkerClaimCancellation(),
    onError = jest.fn(() => "failure");
  const effect = jest.fn();
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      try {
        await startClaimedAgentRunForWorker({
          ...run,
          startClaimId: a.claimId,
          temporary: true,
        });
        effect();
      } catch (error) {
        if (!stop.handle(error, writer)) throw error;
      }
    },
    onError,
  });
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  expect(chunks).toEqual([{ type: "abort" }]);
  expect(onError).not.toHaveBeenCalled();
  expect(effect).not.toHaveBeenCalled();
  expect(mockCancel).not.toHaveBeenCalled();
  expect(f.calls.slice(0, 2).map((c) => c.name)).toEqual([
    "requestCancellation",
    "release",
  ]);
});
it("failed marker write leaves the unbound claim unreleased and reports failure", async () => {
  const f = fixture();
  await f.raw("reserve", a);
  f.setHook(async (name) => {
    if (name === "requestCancellation") throw new Error("unavailable");
  });
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await POST(req());
    expect(response.status).toBe(500);
    expect((await f.raw("getForBackend", owner)).phase).toBe("starting");
    expect(f.calls.some((c) => c.name === "release")).toBe(false);
    expect(mockCancel).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});
it("activation winning the initial marker CAS is reread and canceled under the same run binding", async () => {
  const f = fixture();
  await f.raw("reserve", a);
  let first = true;
  f.setHook(async (name, args) => {
    if (first && name === "requestCancellation" && !args.runId) {
      first = false;
      expect(
        (await f.raw("activateForWorker", { ...run, requireChat: false }))
          .activated,
      ).toBe(true);
    }
  });
  mockCancel.mockImplementation(async (id) => {
    expect(id).toBe(run.runId);
    const row = await f.raw("getForBackend", owner);
    expect(row).toMatchObject({
      phase: "active",
      runId: run.runId,
      cancelRequestedAt: expect.any(Number),
    });
  });
  expect((await POST(req())).status).toBe(200);
  expect(mockCancel).toHaveBeenCalledTimes(1);
  expect(
    f.calls
      .filter((c) => c.name === "requestCancellation")
      .map((c) => c.args.runId),
  ).toEqual([undefined, run.runId]);
  expect(
    f.calls.filter((c) => c.name === "release").map((c) => c.args.runId),
  ).toEqual([run.runId]);
  expect((await f.raw("getForBackend", owner)).phase).toBe("released");
});
it.each(["marker", "release"])(
  "replacement at the %s CAS is neither marked nor released nor remotely canceled",
  async (stage) => {
    const f = fixture();
    await f.raw("reserve", a);
    let replaced = false;
    f.setHook(async (name) => {
      if (
        !replaced &&
        name === (stage === "marker" ? "requestCancellation" : "release")
      ) {
        replaced = true;
        expect(await f.raw("release", a)).toBe(true);
        expect((await f.raw("reserve", b)).acquired).toBe(true);
      }
    });
    expect((await POST(req())).status).toBe(200);
    const row = await f.raw("getForBackend", owner);
    expect(row).toMatchObject({ claimId: b.claimId, phase: "starting" });
    expect(row.cancelRequestedAt).toBeUndefined();
    expect(mockCancel).not.toHaveBeenCalled();
    expect(f.calls.some((c) => c.args.claimId === b.claimId)).toBe(false);
  },
);
it("activation-race remote failure preserves active marked claim without releasing or falsely confirming", async () => {
  const f = fixture();
  await f.raw("reserve", a);
  let first = true;
  f.setHook(async (name, args) => {
    if (first && name === "requestCancellation" && !args.runId) {
      first = false;
      await f.raw("activateForWorker", { ...run, requireChat: false });
    }
  });
  mockCancel.mockRejectedValue(new Error("remote cancel unconfirmed"));
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect((await POST(req())).status).toBe(500);
    expect(await f.raw("getForBackend", owner)).toMatchObject({
      phase: "active",
      runId: run.runId,
      cancelRequestedAt: expect.any(Number),
    });
    expect(f.calls.some((c) => c.name === "release")).toBe(false);
  } finally {
    log.mockRestore();
  }
});
