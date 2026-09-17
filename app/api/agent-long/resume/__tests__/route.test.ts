/** @jest-environment node */
import { NextRequest } from "next/server";

const mockAfter = jest.fn();
const mockReconcileExits = jest.fn();
jest.mock("next/server", () => ({
  ...jest.requireActual("next/server"),
  after: (...args: unknown[]) => mockAfter(...args),
}));
jest.mock("@/lib/api/reconcile-remote-exit-receipts", () => ({
  reconcileOwnedRemoteExitReceipts: (...args: unknown[]) =>
    mockReconcileExits(...args),
}));
const mockUser = jest.fn();
const mockChat = jest.fn();
const mockActiveRun = jest.fn();
const mockSetActiveRun = jest.fn();
const mockTaggedRuns = jest.fn();
const mockRetrieve = jest.fn();
const mockPublicToken = jest.fn();
const mockClaim = jest.fn();
const mockReleaseClaim = jest.fn();
jest.mock("@/lib/api/agent-run-claims", () => ({
  getAgentRunClaim: (...args: unknown[]) => mockClaim(...args),
  releaseAgentRunClaim: (...args: unknown[]) => mockReleaseClaim(...args),
}));
jest.mock("@/lib/auth/get-user-id", () => ({
  getUserIDAndPro: () => mockUser(),
}));
jest.mock("@/lib/db/actions", () => ({
  getChatById: (...args: unknown[]) => mockChat(...args),
  getActiveTriggerRun: (...args: unknown[]) => mockActiveRun(...args),
  setActiveTriggerRun: (...args: unknown[]) => mockSetActiveRun(...args),
}));
jest.mock("@/lib/api/agent-long-runs", () => ({
  getOwnedTaggedRunIds: (...args: unknown[]) => mockTaggedRuns(...args),
}));
jest.mock("@trigger.dev/sdk", () => ({
  runs: { retrieve: (...args: unknown[]) => mockRetrieve(...args) },
  auth: { createPublicToken: (...args: unknown[]) => mockPublicToken(...args) },
  ApiError: class extends Error {
    status = 404;
  },
}));

import { GET } from "../route";

const workingFile = {
  grantId: "2c097a16-0944-4f23-867c-cc8cde0aebf6",
  name: "notes.md",
  relativePath: "notes.md",
};
const payload = () => ({
  chatId: "chat-a",
  userId: "owner",
  subscription: "ultra",
  organizationId: "private-org",
  messages: [{ content: "private worker transcript" }],
  convexUrl: "https://private.invalid",
  providerKey: "never-return-this-key",
  purpose: "app",
  temporary: false,
  selectedModel: "build-codex",
  reasoningEffort: "xhigh",
  approvalMode: "ask",
  sandboxPreference: "tauri",
  projectId: "project-a",
  workingFile,
  baseTodos: [
    {
      id: "todo-a",
      content: "Keep building",
      status: "in_progress",
      sourceMessageId: "assistant-a",
      privateField: "secret",
    },
  ],
  activeGoal: {
    objective: "Finish the build",
    status: "active",
    privateField: "secret",
  },
  regenerate: true,
  replaceActiveRun: true,
  startClaimId: "private-claim",
});
const request = () =>
  new NextRequest("http://localhost/api/agent-long/resume?chatId=chat-a");

beforeEach(() => {
  jest.clearAllMocks();
  mockClaim.mockResolvedValue(null);
  mockReleaseClaim.mockResolvedValue(true);
  mockUser.mockResolvedValue({ userId: "owner", subscription: "pro" });
  mockChat.mockResolvedValue({
    id: "chat-a",
    user_id: "owner",
    purpose: "app",
  });
  mockActiveRun.mockResolvedValue("run-a");
  mockSetActiveRun.mockResolvedValue(undefined);
  mockTaggedRuns.mockResolvedValue([]);
  mockRetrieve.mockResolvedValue({ status: "EXECUTING", payload: payload() });
  mockPublicToken.mockResolvedValue("scoped-public-token");
});

it("restores only the original run settings with nested allowlists and no worker secrets or prior intent flags", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({
    runId: "run-a",
    publicAccessToken: "scoped-public-token",
    requestContext: {
      mode: "agent",
      purpose: "app",
      temporary: false,
      selectedModel: "build-codex",
      reasoningEffort: "xhigh",
      approvalMode: "ask",
      sandboxPreference: "tauri",
      projectId: "project-a",
      workingFile,
      activeGoal: { objective: "Finish the build", status: "active" },
      todos: [
        {
          id: "todo-a",
          content: "Keep building",
          status: "in_progress",
          sourceMessageId: "assistant-a",
        },
      ],
    },
  });
  expect(mockPublicToken).toHaveBeenCalledWith({
    scopes: { read: { runs: ["run-a"] } },
    expirationTime: "6h",
  });
  expect(mockRetrieve).toHaveBeenCalledTimes(1);
});

it("does not retrieve a run or issue a token for another user's chat", async () => {
  mockChat.mockResolvedValue({
    id: "chat-a",
    user_id: "other",
    purpose: "app",
  });
  const response = await GET(request());
  expect(response.status).toBe(403);
  expect(mockRetrieve).not.toHaveBeenCalled();
  expect(mockTaggedRuns).not.toHaveBeenCalled();
  expect(mockPublicToken).not.toHaveBeenCalled();
});

it.each([{ userId: "other" }, { chatId: "another-chat" }])(
  "rejects mismatched immutable payload ownership: %j",
  async (mismatch) => {
    mockRetrieve.mockResolvedValue({
      status: "EXECUTING",
      payload: { ...payload(), ...mismatch },
    });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Forbidden");
    expect(mockPublicToken).not.toHaveBeenCalled();
  },
);

it("reads the owned tagged run's context for a temporary chat without reinstating its mapping", async () => {
  mockChat.mockResolvedValue(null);
  mockTaggedRuns.mockResolvedValue(["run-tagged"]);
  mockRetrieve.mockResolvedValue({
    status: "EXECUTING",
    payload: { ...payload(), temporary: true },
  });
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    runId: "run-tagged",
    requestContext: { temporary: true, mode: "agent" },
  });
  expect(mockTaggedRuns).toHaveBeenCalledWith({
    chatId: "chat-a",
    userId: "owner",
  });
  expect(mockRetrieve).toHaveBeenCalledWith("run-tagged");
  expect(mockSetActiveRun).not.toHaveBeenCalled();
});

it("keeps the Hack purpose gate for a tagged run with no chat row", async () => {
  mockChat.mockResolvedValue(null);
  mockTaggedRuns.mockResolvedValue(["run-tagged"]);
  mockRetrieve.mockResolvedValue({
    status: "EXECUTING",
    payload: { ...payload(), purpose: "security" },
  });
  const response = await GET(request());
  expect(response.status).toBe(403);
  expect(mockPublicToken).not.toHaveBeenCalled();
});

it("clears the terminal stored id and uses only the live replacement's context", async () => {
  mockRetrieve
    .mockResolvedValueOnce({ status: "COMPLETED", payload: payload() })
    .mockResolvedValueOnce({ status: "COMPLETED", payload: payload() })
    .mockResolvedValueOnce({
      status: "EXECUTING",
      payload: { ...payload(), selectedModel: "build-opus46" },
    });
  mockTaggedRuns.mockResolvedValue(["run-stale-tag", "run-new"]);
  const response = await GET(request());
  expect(await response.json()).toMatchObject({
    runId: "run-new",
    requestContext: { selectedModel: "build-opus46" },
  });
  expect(mockSetActiveRun).toHaveBeenCalledWith({
    chatId: "chat-a",
    triggerRunId: null,
    expectedRunId: "run-a",
  });
});

it("returns 204 without context or token when the tagged run finished during lookup", async () => {
  mockActiveRun.mockResolvedValue(null);
  mockTaggedRuns.mockResolvedValue(["run-gone"]);
  mockRetrieve.mockResolvedValue({ status: "COMPLETED", payload: payload() });
  const response = await GET(request());
  expect(response.status).toBe(204);
  expect(mockPublicToken).not.toHaveBeenCalled();
});

it("keeps legacy row-authorized streams reconnectable without inventing a request context", async () => {
  mockRetrieve.mockResolvedValue({ status: "EXECUTING" });
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    runId: "run-a",
    publicAccessToken: "scoped-public-token",
  });
});

describe("stale claim reconciliation", () => {
  const claim = {
    userId: "owner",
    chatId: "chat-a",
    claimId: "claim-a",
    runId: "run-a",
    phase: "active",
  };
  const exactClaim = {
    userId: "owner",
    chatId: "chat-a",
    claimId: "claim-a",
    runId: "run-a",
  };
  beforeEach(() => {
    mockClaim.mockResolvedValue({ ...claim });
  });

  it.each([
    "COMPLETED",
    "CANCELED",
    "FAILED",
    "CRASHED",
    "SYSTEM_FAILURE",
    "EXPIRED",
    "TIMED_OUT",
  ])(
    "releases the exact owned claim after authoritative %s",
    async (status) => {
      mockRetrieve.mockResolvedValue({ status, payload: payload() });
      const response = await GET(request());
      expect(response.status).toBe(204);
      expect(mockClaim).toHaveBeenCalledWith({
        userId: "owner",
        chatId: "chat-a",
      });
      expect(mockReleaseClaim).toHaveBeenCalledTimes(1);
      expect(mockReleaseClaim).toHaveBeenCalledWith(exactClaim);
      expect(mockRetrieve).toHaveBeenCalledTimes(1);
      expect(mockPublicToken).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "recovers a failed claim with no chat pointer (temporary=%s)",
    async (temporary) => {
      if (temporary) mockChat.mockResolvedValue(null);
      mockActiveRun.mockResolvedValue(null);
      mockRetrieve.mockResolvedValue({ status: "FAILED" });
      expect((await GET(request())).status).toBe(204);
      expect(mockRetrieve).toHaveBeenCalledWith("run-a");
      expect(mockReleaseClaim).toHaveBeenCalledTimes(1);
      expect(mockReleaseClaim).toHaveBeenCalledWith(exactClaim);
      expect(mockSetActiveRun).not.toHaveBeenCalled();
    },
  );

  it("preserves the claim and mapping on an SDK 404, then reconnects the same run", async () => {
    const { ApiError } = await import("@trigger.dev/sdk");
    mockRetrieve.mockRejectedValue(
      new ApiError(404, undefined, "not found", undefined),
    );
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("3");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mockReleaseClaim).not.toHaveBeenCalled();
    expect(mockSetActiveRun).not.toHaveBeenCalled();
    expect(mockPublicToken).not.toHaveBeenCalled();
    expect(mockAfter).not.toHaveBeenCalled();
    mockRetrieve.mockResolvedValue({ status: "EXECUTING", payload: payload() });
    expect(await (await GET(request())).json()).toMatchObject({
      runId: "run-a",
    });
  });

  it("keeps failed cleanup retryable and does not clear the pointer first", async () => {
    mockRetrieve.mockResolvedValue({ status: "FAILED" });
    mockReleaseClaim.mockRejectedValueOnce(
      new Error("temporary database outage"),
    );
    expect((await GET(request())).status).toBe(500);
    expect(mockSetActiveRun).not.toHaveBeenCalled();
    expect(mockPublicToken).not.toHaveBeenCalled();
    expect((await GET(request())).status).toBe(204);
    expect(mockReleaseClaim).toHaveBeenCalledTimes(2);
    expect(mockReleaseClaim).toHaveBeenLastCalledWith(exactClaim);
  });

  it("does not touch a replacement claim or mapping installed during retrieve", async () => {
    let current = { ...claim };
    let pointer: string | null = "run-a";
    mockClaim.mockImplementation(async () => ({ ...current }));
    mockRetrieve.mockImplementation(async (id: string) => {
      if (id === "run-a") {
        current = { ...claim, claimId: "claim-b", runId: "run-b" };
        pointer = "run-b";
        return { status: "FAILED" };
      }
      return { status: "EXECUTING", payload: payload() };
    });
    mockReleaseClaim.mockImplementation(async (args: typeof exactClaim) => {
      if (args.claimId !== current.claimId || args.runId !== current.runId)
        return false;
      current.phase = "released";
      return true;
    });
    mockSetActiveRun.mockImplementation(
      async (args: { expectedRunId: string }) => {
        if (pointer === args.expectedRunId) pointer = null;
      },
    );
    mockTaggedRuns.mockResolvedValue(["run-b"]);
    const response = await GET(request());
    expect(await response.json()).toMatchObject({ runId: "run-b" });
    expect(mockReleaseClaim).toHaveBeenCalledTimes(1);
    expect(mockReleaseClaim).toHaveBeenCalledWith(exactClaim);
    expect(current).toMatchObject({
      claimId: "claim-b",
      runId: "run-b",
      phase: "active",
    });
    expect(pointer).toBe("run-b");
  });

  it.each([new Error("timeout"), { status: 503 }])(
    "never releases on an uncertain retrieve failure: %j",
    async (error) => {
      mockRetrieve.mockRejectedValue(error);
      expect((await GET(request())).status).toBe(500);
      expect(mockReleaseClaim).not.toHaveBeenCalled();
      expect(mockSetActiveRun).not.toHaveBeenCalled();
      expect(mockPublicToken).not.toHaveBeenCalled();
    },
  );

  it("does not release an executing claim", async () => {
    expect((await GET(request())).status).toBe(200);
    expect(mockReleaseClaim).not.toHaveBeenCalled();
    expect(mockSetActiveRun).not.toHaveBeenCalled();
    expect(mockRetrieve).toHaveBeenCalledTimes(1);
  });

  it.each(["UNKNOWN", undefined])(
    "does not interpret an unrecognized status as terminal: %s",
    async (status) => {
      mockRetrieve.mockResolvedValue({ status });
      await GET(request());
      expect(mockReleaseClaim).not.toHaveBeenCalled();
      expect(mockSetActiveRun).not.toHaveBeenCalled();
    },
  );

  it("does not repeat reconciliation after the exact claim is released", async () => {
    const current = { ...claim };
    let pointer: string | null = "run-a";
    mockClaim.mockImplementation(async () => ({ ...current }));
    mockActiveRun.mockImplementation(async () => pointer);
    mockRetrieve.mockResolvedValue({ status: "FAILED" });
    mockReleaseClaim.mockImplementation(async () => {
      current.phase = "released";
      pointer = null;
      return true;
    });
    expect((await GET(request())).status).toBe(204);
    expect((await GET(request())).status).toBe(204);
    expect(mockReleaseClaim).toHaveBeenCalledTimes(1);
    expect(mockRetrieve).toHaveBeenCalledTimes(1);
  });

  it("rejects a mismatched claim owner before remote reads, including without a chat row", async () => {
    mockChat.mockResolvedValue(null);
    mockClaim.mockResolvedValue({ ...claim, userId: "other" });
    expect((await GET(request())).status).toBe(403);
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockReleaseClaim).not.toHaveBeenCalled();
  });

  it("does not inspect claims for a foreign chat", async () => {
    mockChat.mockResolvedValue({
      id: "chat-a",
      user_id: "other",
      purpose: "app",
    });
    expect((await GET(request())).status).toBe(403);
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockReleaseClaim).not.toHaveBeenCalled();
  });
});

it.each(["stored", "tagged"])(
  "keeps an unavailable %s run retryable without a claim",
  async (source) => {
    const { ApiError } = await import("@trigger.dev/sdk");
    if (source === "tagged") {
      mockChat.mockResolvedValue(null);
      mockActiveRun.mockResolvedValue(null);
      mockTaggedRuns.mockResolvedValue(["run-a"]);
    }
    mockRetrieve.mockRejectedValue(
      new ApiError(404, undefined, "not found", undefined),
    );
    expect((await GET(request())).status).toBe(503);
    expect(mockReleaseClaim).not.toHaveBeenCalled();
    expect(mockSetActiveRun).not.toHaveBeenCalled();
    expect(mockPublicToken).not.toHaveBeenCalled();
  },
);

it("schedules receipt reconciliation when a terminal claim cannot be released", async () => {
  mockClaim.mockResolvedValue({
    userId: "owner",
    chatId: "chat-a",
    claimId: "claim-a",
    runId: "run-a",
    phase: "active",
  });
  mockRetrieve.mockResolvedValue({ status: "COMPLETED", payload: payload() });
  mockReleaseClaim.mockResolvedValue(false);
  mockReconcileExits.mockResolvedValue({ released: true });
  expect((await GET(request())).status).toBe(204);
  expect(mockAfter).toHaveBeenCalledTimes(1);
  expect(mockReconcileExits).not.toHaveBeenCalled();
  await mockAfter.mock.calls[0][0]();
  expect(mockReconcileExits).toHaveBeenCalledWith({
    userId: "owner",
    chatId: "chat-a",
    claimId: "claim-a",
    runId: "run-a",
  });
});
