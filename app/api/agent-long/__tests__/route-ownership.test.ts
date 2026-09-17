/** @jest-environment node */
import type { NextRequest } from "next/server";

const mockHackQuery = jest.fn();
const mockHackMutation = jest.fn();
const mockReadStop = jest.fn();
const mockNotAttempted = jest.fn();
jest.mock("@/convex/_generated/server", () => ({
  mutation: (c: unknown) => c,
  query: (c: unknown) => c,
}));
jest.mock("@/lib/hack/durable-stop", () => ({
  readHackDispatchStop: (...args: unknown[]) => mockReadStop(...args),
  recordHackDispatchNotAttempted: (...args: unknown[]) =>
    mockNotAttempted(...args),
  cancelHackDispatch: (...args: unknown[]) =>
    jest.requireActual("@/lib/hack/durable-stop").cancelHackDispatch(...args),
}));
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: () => ({ query: mockHackQuery, mutation: mockHackMutation }),
  getConvexServiceKey: () => "service-fixture",
}));
const mockDurableEnabled = jest.fn(() => false);
const mockBeginDispatch = jest.fn();
const mockLookupDispatch = jest.fn();
const mockMarkDispatching = jest.fn();
const mockRecordAccepted = jest.fn();
jest.mock("@/lib/api/agent-dispatch-admission", () => ({
  agentDispatchAdmissionEnabled: () => mockDurableEnabled(),
  beginAgentDispatch: (...args: unknown[]) => mockBeginDispatch(...args),
  lookupAgentDispatch: (...args: unknown[]) => mockLookupDispatch(...args),
  markAgentDispatching: (...args: unknown[]) => mockMarkDispatching(...args),
  recordAgentDispatchAccepted: (...args: unknown[]) =>
    mockRecordAccepted(...args),
}));
const mockGetUserIDAndPro = jest.fn();
const mockEntitlement = jest.fn();
const mockGetChatById = jest.fn();
const mockGetAdmissionSnapshot = jest.fn();
const mockGetActiveProjectForUser = jest.fn();
const mockHandleInitialChatAndUserMessage = jest.fn();
const mockSetActiveTriggerRun = jest.fn();
const mockIsRunActive = jest.fn();
const mockCancelRunAndConfirm = jest.fn();
const mockTrigger = jest.fn();
const mockCreatePublicToken = jest.fn();
const mockAcquireAgentRunStart = jest.fn();
const mockRequestAgentRunCancellation = jest.fn();
const mockAssertAgentRunStartCurrent = jest.fn();
const mockRegisterAgentRun = jest.fn();
const mockReleaseAgentRunClaim = jest.fn();
const mockReleaseCanceledAgentRunClaim = jest.fn();
jest.mock("@/lib/api/agent-run-claims", () => ({
  requestAgentRunCancellation: (...args: unknown[]) =>
    mockRequestAgentRunCancellation(...args),
  acquireAgentRunStart: (...args: unknown[]) =>
    mockAcquireAgentRunStart(...args),
  assertAgentRunStartCurrent: (...args: unknown[]) =>
    mockAssertAgentRunStartCurrent(...args),
  registerAgentRun: (...args: unknown[]) => mockRegisterAgentRun(...args),
  releaseAgentRunClaim: (...args: unknown[]) =>
    mockReleaseAgentRunClaim(...args),
  releaseCanceledAgentRunClaim: (...args: unknown[]) =>
    mockReleaseCanceledAgentRunClaim(...args),
  AgentRunClaimLostError: class extends Error {},
  AgentRunBusyError: class extends Error {
    runId?: string;
    constructor(runId?: string) {
      super("A run is already active in this chat.");
      this.runId = runId;
    }
  },
}));

jest.mock("@/lib/api/agent-run-read-token", () => ({
  prepareAgentRunReadToken: jest.fn(async () => {}),
  createAgentRunReadToken: (runId: string) =>
    mockCreatePublicToken({
      scopes: { read: { runs: [runId] } },
      expirationTime: "6h",
    }),
}));
jest.mock("@trigger.dev/sdk", () => ({
  tasks: { trigger: (...args: unknown[]) => mockTrigger(...args) },
  auth: {
    createPublicToken: (...args: unknown[]) => mockCreatePublicToken(...args),
  },
  runs: { cancel: jest.fn() },
}));
jest.mock("@vercel/functions", () => ({ geolocation: () => ({}) }));
jest.mock("@/lib/auth/get-user-id", () => ({
  getUserIDAndPro: (...args: unknown[]) => mockGetUserIDAndPro(...args),
}));
jest.mock("@/lib/suspensions", () => ({
  assertUserCanMakeCostIncurringRequest: (...args: unknown[]) =>
    mockEntitlement(...args),
}));
jest.mock("@/lib/db/agent-admission-snapshot", () => ({
  getAgentAdmissionSnapshot: (...args: unknown[]) =>
    mockGetAdmissionSnapshot(...args),
}));
jest.mock("@/lib/db/actions", () => ({
  getChatById: (...args: unknown[]) => mockGetChatById(...args),
  getActiveProjectForUser: (...args: unknown[]) =>
    mockGetActiveProjectForUser(...args),
  handleInitialChatAndUserMessage: (...args: unknown[]) =>
    mockHandleInitialChatAndUserMessage(...args),
  setActiveTriggerRun: (...args: unknown[]) => mockSetActiveTriggerRun(...args),
}));
jest.mock("@/lib/db/initial-turn", () => ({
  persistClaimedInitialTurn: (...args: unknown[]) =>
    mockHandleInitialChatAndUserMessage(...args),
}));
jest.mock("@/lib/api/chat-stream-helpers", () => ({
  assertFreeAgentGates: jest.fn(),
}));
jest.mock("@/lib/api/agent-long-runs", () => ({
  isRunActive: (...args: unknown[]) => mockIsRunActive(...args),
  cancelRunAndConfirm: (...args: unknown[]) => mockCancelRunAndConfirm(...args),
}));
jest.mock("@/lib/auth/premium-access", () => ({
  ...jest.requireActual("@/lib/auth/premium-access"),
  assertHackWorkbenchPurposeRoute: jest.fn(),
}));
jest.mock("@/lib/ai/tools/utils/hybrid-sandbox-manager", () => ({
  HybridSandboxManager: jest.fn(),
}));
jest.mock("@/lib/utils/sandbox-file-utils", () => ({
  stripLocalDesktopSourcePaths: (messages: unknown) => messages,
  hasLocalDesktopSourcePaths: () => false,
}));
jest.mock("@/lib/api/active-goal-context", () => ({
  getActiveGoalForModel: () => undefined,
}));

import { POST } from "../route";
import { POST as HACK_POST } from "../../hack-long/route";
import { hashHackRunPayload } from "@/lib/hack/durable-run";
import { HybridSandboxManager } from "@/lib/ai/tools/utils/hybrid-sandbox-manager";

const request = (overrides: Record<string, unknown> = {}) =>
  new Request("http://localhost/api/agent-long", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chatId: "chat-1",
      messages: [
        {
          id: "user-message",
          role: "user",
          parts: [{ type: "text", text: "Continue the task" }],
        },
      ],
      ...overrides,
    }),
  }) as NextRequest;

describe("agent-long startup ownership", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEntitlement.mockResolvedValue(undefined);
    mockGetUserIDAndPro.mockResolvedValue({
      userId: "owner",
      subscription: "pro",
    });
    mockGetChatById.mockResolvedValue({
      id: "chat-1",
      user_id: "owner",
      active_trigger_run_id: "run-active",
    });
    mockGetAdmissionSnapshot.mockImplementation(async () => {
      const chat = await mockGetChatById();
      return { read: () => ({ chat, claim: null }) };
    });
    mockGetActiveProjectForUser.mockResolvedValue(null);
    mockIsRunActive.mockResolvedValue(true);
    mockCancelRunAndConfirm.mockResolvedValue(undefined);
    mockHandleInitialChatAndUserMessage.mockResolvedValue(undefined);
    mockSetActiveTriggerRun.mockResolvedValue(undefined);
    mockTrigger.mockResolvedValue({ id: "run-new" });
    mockCreatePublicToken.mockResolvedValue("test-public-token");
    mockAcquireAgentRunStart.mockResolvedValue("claim-new");
    mockRequestAgentRunCancellation.mockResolvedValue(true);
    mockRegisterAgentRun.mockResolvedValue(undefined);
    mockReleaseAgentRunClaim.mockResolvedValue(undefined);
    mockReleaseCanceledAgentRunClaim.mockResolvedValue(true);
    mockReleaseCanceledAgentRunClaim.mockResolvedValue(true);
    jest.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it("passes only the server-read admission capability through startup", async () => {
    const snapshot = { read: () => ({ chat: null, claim: null }) };
    mockGetAdmissionSnapshot.mockResolvedValue(snapshot);
    const response = await POST(
      request({ admissionSnapshot: { chat: { user_id: "forged" } } }),
    );
    expect(response.status).toBe(200);
    expect(mockGetAdmissionSnapshot).toHaveBeenCalledTimes(1);
    expect(mockGetAdmissionSnapshot).toHaveBeenCalledWith({
      userId: "owner",
      chatId: "chat-1",
    });
    expect(mockGetChatById).not.toHaveBeenCalled();
    expect(mockAcquireAgentRunStart).toHaveBeenCalledWith(
      expect.objectContaining({ admissionSnapshot: snapshot }),
    );
    expect(mockHandleInitialChatAndUserMessage).toHaveBeenCalled();
    expect(mockAssertAgentRunStartCurrent).toHaveBeenCalled();
  });

  it("does not open a local sandbox while project authorization is pending or denied", async () => {
    mockGetChatById.mockResolvedValue({
      id: "chat-1",
      user_id: "owner",
      purpose: "app",
      project_id: "project-1",
    });
    let deny!: (value: null) => void;
    mockGetActiveProjectForUser.mockReturnValueOnce(
      new Promise((resolve) => {
        deny = resolve;
      }),
    );
    const result = POST(
      request({ purpose: "app", sandboxPreference: "local-test-machine" }),
    );
    for (let i = 0; i < 20; i++)
      await new Promise((resolve) => setImmediate(resolve));
    expect(mockGetActiveProjectForUser).toHaveBeenCalled();
    expect(HybridSandboxManager).not.toHaveBeenCalled();
    expect(mockAcquireAgentRunStart).not.toHaveBeenCalled();
    deny(null);
    const response = await result;
    expect(response.status).toBe(403);
    expect(HybridSandboxManager).not.toHaveBeenCalled();
    expect(mockHandleInitialChatAndUserMessage).not.toHaveBeenCalled();
    expect(mockTrigger).not.toHaveBeenCalled();
  });

  it("checks entitlement alongside the chat read but never dispatches before approval", async () => {
    let rejectGate!: (error: Error) => void;
    mockEntitlement.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectGate = reject;
      }),
    );
    mockGetChatById.mockImplementationOnce(async () => null);
    const result = POST(request());
    // Flush request parsing and the independent reads without a time-based assertion.
    for (let i = 0; i < 20; i++)
      await new Promise((resolve) => setImmediate(resolve));
    const readStarted = mockGetChatById.mock.calls.length;
    expect(mockTrigger).not.toHaveBeenCalled();
    expect(mockAcquireAgentRunStart).not.toHaveBeenCalled();
    rejectGate(new Error("account suspended"));
    await result;
    expect(readStarted).toBe(1);
  });

  it("atomically persists with the claim and keeps the independent final dispatch check", async () => {
    mockIsRunActive.mockResolvedValue(false);
    const req = request();
    expect((await POST(req)).status).toBe(200);
    expect(mockHandleInitialChatAndUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "owner",
        chatId: "chat-1",
        claimId: "claim-new",
      }),
      req.signal,
    );
    expect(mockAssertAgentRunStartCurrent).toHaveBeenCalledTimes(1);
    expect(mockAssertAgentRunStartCurrent).toHaveBeenCalledWith(
      { userId: "owner", chatId: "chat-1", claimId: "claim-new" },
      req.signal,
    );
    expect(
      mockHandleInitialChatAndUserMessage.mock.invocationCallOrder[0],
    ).toBeLessThan(mockAssertAgentRunStartCurrent.mock.invocationCallOrder[0]);
    expect(
      mockAssertAgentRunStartCurrent.mock.invocationCallOrder[0],
    ).toBeLessThan(mockTrigger.mock.invocationCallOrder[0]);
  });

  it("uses one current-claim check when temporary input has no persistence step", async () => {
    mockAssertAgentRunStartCurrent.mockResolvedValue(undefined);
    const response = await POST(request({ temporary: true }));
    expect(response.status).toBe(200);
    expect(mockAssertAgentRunStartCurrent).toHaveBeenCalledTimes(1);
    expect(mockHandleInitialChatAndUserMessage).not.toHaveBeenCalled();
  });

  it("returns a fresh read-only six-hour token instead of exposing the SDK token", async () => {
    mockTrigger.mockResolvedValueOnce({
      id: "run-new",
      publicAccessToken: "sdk-token-with-different-scope",
    });
    mockGetChatById.mockResolvedValue(null);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      runId: "run-new",
      publicAccessToken: "test-public-token",
    });
    expect(mockCreatePublicToken).toHaveBeenCalledWith({
      scopes: { read: { runs: ["run-new"] } },
      expirationTime: "6h",
    });
    expect(mockRegisterAgentRun).toHaveBeenCalled();
  });

  it("rejects malformed working-file selections before active-run controls or dispatch", async () => {
    const response = await POST(
      request({
        replaceActiveRun: true,
        workingFile: {
          grantId: "fake",
          name: "/private/file",
          relativePath: "/private/file",
        },
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid working file selection");
    expect(mockIsRunActive).not.toHaveBeenCalled();
    expect(mockCancelRunAndConfirm).not.toHaveBeenCalled();
    expect(mockTrigger).not.toHaveBeenCalled();
  });

  it("passes only the validated working-file reference without changing approval or sandbox", async () => {
    mockGetChatById.mockResolvedValue({
      id: "chat-1",
      user_id: "owner",
      purpose: "app",
      active_trigger_run_id: "run-active",
    });
    const workingFile = {
      grantId: "2c097a16-0944-4f23-867c-cc8cde0aebf6",
      name: "notes.md",
      relativePath: "notes.md",
    };
    const response = await POST(
      request({
        replaceActiveRun: true,
        workingFile,
        approvalMode: "ask",
        sandboxPreference: "e2b",
      }),
    );
    expect(response.status).toBe(200);
    expect(mockTrigger.mock.calls[0][1]).toMatchObject({
      workingFile,
      approvalMode: "ask",
      sandboxPreference: "e2b",
    });
  });

  it("rejects working files on non-Build surfaces before replacing a run", async () => {
    const workingFile = {
      grantId: "2c097a16-0944-4f23-867c-cc8cde0aebf6",
      name: "notes.md",
      relativePath: "notes.md",
    };
    const response = await POST(
      request({ replaceActiveRun: true, workingFile, purpose: "image" }),
    );
    expect(response.status).toBe(400);
    expect(mockCancelRunAndConfirm).not.toHaveBeenCalled();
    expect(mockTrigger).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "rejects another owner's chat before reading or canceling its active run (replace=%s)",
    async (replaceActiveRun) => {
      mockGetChatById.mockResolvedValue({
        id: "chat-1",
        user_id: "another-owner",
        active_trigger_run_id: "private-run",
      });

      const response = await POST(request({ replaceActiveRun }));

      expect(response.status).toBe(403);
      expect(mockIsRunActive).not.toHaveBeenCalled();
      expect(mockCancelRunAndConfirm).not.toHaveBeenCalled();
      expect(mockHandleInitialChatAndUserMessage).not.toHaveBeenCalled();
      expect(mockTrigger).not.toHaveBeenCalled();
      expect(JSON.stringify(await response.json())).not.toContain(
        "private-run",
      );
    },
  );

  it("preserves the owner's active run unless replacement was requested", async () => {
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "run_active",
      runId: "run-active",
    });
    expect(mockCancelRunAndConfirm).not.toHaveBeenCalled();
    expect(mockTrigger).not.toHaveBeenCalled();
  });

  it("does not create a second run when the current run cannot be checked", async () => {
    mockAcquireAgentRunStart.mockRejectedValueOnce(
      new Error("Provider temporarily unavailable"),
    );
    jest.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(request({ replaceActiveRun: true }));
    expect(response.status).toBe(500);
    expect(mockTrigger).not.toHaveBeenCalled();
    expect(mockCancelRunAndConfirm).not.toHaveBeenCalled();
    expect(mockHandleInitialChatAndUserMessage).not.toHaveBeenCalled();
  });

  it("replaces the owner's run after validating the existing chat context", async () => {
    const response = await POST(request({ replaceActiveRun: true }));
    expect(response.status).toBe(200);
    expect(mockCancelRunAndConfirm).not.toHaveBeenCalled();
    expect(mockAcquireAgentRunStart).toHaveBeenCalledWith(
      expect.objectContaining({
        activeRunId: "run-active",
        replaceActiveRun: true,
      }),
    );
    expect(mockTrigger).toHaveBeenCalledTimes(1);
    expect(mockAcquireAgentRunStart.mock.invocationCallOrder[0]).toBeLessThan(
      mockTrigger.mock.invocationCallOrder[0],
    );
  });

  it("rejects an unavailable bound project before canceling its existing run", async () => {
    mockGetChatById.mockResolvedValue({
      id: "chat-1",
      user_id: "owner",
      project_id: "project-1",
      active_trigger_run_id: "run-active",
    });
    const response = await POST(request({ replaceActiveRun: true }));
    expect(response.status).toBe(403);
    expect(mockGetActiveProjectForUser).toHaveBeenCalledWith({
      userId: "owner",
      projectId: "project-1",
    });
    expect(mockIsRunActive).not.toHaveBeenCalled();
    expect(mockCancelRunAndConfirm).not.toHaveBeenCalled();
    expect(mockTrigger).not.toHaveBeenCalled();
  });
});

describe("agent-long atomic admission", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserIDAndPro.mockResolvedValue({
      userId: "owner",
      subscription: "pro",
    });
    mockGetChatById.mockResolvedValue(null);
    mockGetActiveProjectForUser.mockResolvedValue(null);
    mockIsRunActive.mockResolvedValue(false);
    mockHandleInitialChatAndUserMessage.mockResolvedValue(undefined);
    mockSetActiveTriggerRun.mockResolvedValue(undefined);
    mockTrigger.mockResolvedValue({ id: "run-new" });
    mockCreatePublicToken.mockResolvedValue("token");
    mockRegisterAgentRun.mockResolvedValue(undefined);
    mockReleaseAgentRunClaim.mockResolvedValue(undefined);
    jest.spyOn(console, "info").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    {},
    { temporary: true },
    { regenerate: true },
    { isAutoContinue: true },
  ])(
    "admits only one simultaneous start before persistence or dispatch (%j)",
    async (flags) => {
      const { AgentRunBusyError } = jest.requireMock(
        "@/lib/api/agent-run-claims",
      );
      let held = false;
      mockAcquireAgentRunStart.mockImplementation(async () => {
        if (held) throw new AgentRunBusyError();
        held = true;
        return "claim-one";
      });
      const results = await Promise.all([
        POST(request(flags)),
        POST(request(flags)),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(mockTrigger).toHaveBeenCalledTimes(1);
      expect(mockHandleInitialChatAndUserMessage).toHaveBeenCalledTimes(
        flags.temporary ? 0 : 1,
      );
      expect(mockTrigger.mock.calls[0][1]).toMatchObject({
        startClaimId: "claim-one",
      });
      expect(mockTrigger.mock.calls[0][2]).toMatchObject({
        idempotencyKey: "agent-start:claim-one",
      });
    },
  );

  it("releases a reservation if message persistence fails before Trigger is called", async () => {
    mockAcquireAgentRunStart.mockResolvedValue("claim-one");
    mockHandleInitialChatAndUserMessage.mockRejectedValue(
      new Error("database unavailable"),
    );
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(mockTrigger).not.toHaveBeenCalled();
    expect(mockReleaseAgentRunClaim).toHaveBeenCalledWith({
      userId: "owner",
      chatId: "chat-1",
      claimId: "claim-one",
    });
  });

  it("keeps a reservation when Trigger acceptance is uncertain", async () => {
    mockAcquireAgentRunStart.mockResolvedValue("claim-one");
    mockTrigger.mockRejectedValue(new Error("connection lost after dispatch"));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(mockReleaseAgentRunClaim).not.toHaveBeenCalled();
  });

  it("clears an unbound reservation only after startup cancellation is confirmed", async () => {
    mockAcquireAgentRunStart.mockResolvedValue("claim-one");
    mockRegisterAgentRun.mockRejectedValue(new Error("binding unavailable"));
    mockCreatePublicToken.mockRejectedValue(new Error("token unavailable"));
    mockCancelRunAndConfirm.mockResolvedValue(undefined);
    expect((await POST(request())).status).toBe(500);
    expect(mockReleaseCanceledAgentRunClaim).toHaveBeenCalledWith({
      userId: "owner",
      chatId: "chat-1",
      claimId: "claim-one",
      runId: "run-new",
    });
    expect(mockCancelRunAndConfirm.mock.invocationCallOrder[0]).toBeLessThan(
      mockReleaseCanceledAgentRunClaim.mock.invocationCallOrder[0],
    );
    expect(mockReleaseAgentRunClaim).not.toHaveBeenCalled();
  });

  it("keeps the claim if startup cancellation cannot be confirmed", async () => {
    mockAcquireAgentRunStart.mockResolvedValue("claim-one");
    mockCreatePublicToken.mockRejectedValue(new Error("token unavailable"));
    mockCancelRunAndConfirm.mockRejectedValue(
      new Error("unknown cancellation"),
    );
    expect((await POST(request())).status).toBe(500);
    expect(mockReleaseCanceledAgentRunClaim).not.toHaveBeenCalled();
    expect(mockReleaseAgentRunClaim).not.toHaveBeenCalled();
  });

  it.each([1, 2])(
    "does not dispatch if canceled at preparation checkpoint %s",
    async (checkpoint) => {
      const { AgentRunClaimLostError } = jest.requireMock(
        "@/lib/api/agent-run-claims",
      );
      mockAcquireAgentRunStart.mockResolvedValue("claim-one");
      if (checkpoint === 1)
        mockHandleInitialChatAndUserMessage.mockRejectedValueOnce(
          new AgentRunClaimLostError(),
        );
      else
        mockAssertAgentRunStartCurrent.mockRejectedValueOnce(
          new AgentRunClaimLostError(),
        );
      const response = await POST(request());
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: "start_superseded",
      });
      expect(mockTrigger).not.toHaveBeenCalled();
      expect(mockHandleInitialChatAndUserMessage).toHaveBeenCalledTimes(1);
      expect(mockAssertAgentRunStartCurrent).toHaveBeenCalledTimes(
        checkpoint - 1,
      );
      expect(mockReleaseAgentRunClaim).toHaveBeenCalled();
    },
  );
  it("replacement delegates its owned snapshot without a separate early cancellation", async () => {
    mockRequestAgentRunCancellation.mockResolvedValue(true);
    mockCancelRunAndConfirm.mockResolvedValue(undefined);
    mockAcquireAgentRunStart.mockResolvedValue("claim-new");
    mockAssertAgentRunStartCurrent.mockResolvedValue(undefined);
    mockGetAdmissionSnapshot.mockResolvedValue({
      read: () => ({
        chat: {
          id: "chat-1",
          user_id: "owner",
          active_trigger_run_id: "old-run",
        },
        claim: { claimId: "old-claim", runId: "old-run", phase: "active" },
      }),
    });
    mockIsRunActive.mockResolvedValue(true);
    expect((await POST(request({ replaceActiveRun: true }))).status).toBe(200);
    expect(mockRequestAgentRunCancellation).not.toHaveBeenCalled();
    expect(mockCancelRunAndConfirm).not.toHaveBeenCalled();
    expect(mockAcquireAgentRunStart).toHaveBeenCalledWith(
      expect.objectContaining({
        activeRunId: "old-run",
        replaceActiveRun: true,
        admissionSnapshot: expect.any(Object),
      }),
    );
  });
  it("replacement stops when its observed claim was replaced before marking", async () => {
    mockGetAdmissionSnapshot.mockResolvedValue({
      read: () => ({
        chat: {
          id: "chat-1",
          user_id: "owner",
          active_trigger_run_id: "old-run",
        },
        claim: { claimId: "old-claim", runId: "old-run", phase: "active" },
      }),
    });
    mockIsRunActive.mockResolvedValue(true);
    const { AgentRunClaimLostError } = jest.requireMock(
      "@/lib/api/agent-run-claims",
    );
    mockAcquireAgentRunStart.mockRejectedValueOnce(
      new AgentRunClaimLostError(),
    );
    expect((await POST(request({ replaceActiveRun: true }))).status).toBe(409);
    expect(mockCancelRunAndConfirm).not.toHaveBeenCalled();
    expect(mockAcquireAgentRunStart).toHaveBeenCalledTimes(1);
    expect(mockTrigger).not.toHaveBeenCalled();
  });

  it("keeps the existing run when its requested replacement target is unavailable", async () => {
    mockGetAdmissionSnapshot.mockResolvedValue({
      read: () => ({
        chat: {
          id: "chat-1",
          user_id: "owner",
          purpose: "app",
          active_trigger_run_id: "run-active",
        },
        claim: null,
      }),
    });
    mockIsRunActive.mockResolvedValue(true);
    (HybridSandboxManager as jest.Mock).mockImplementation(() => ({
      getSandbox: jest.fn().mockRejectedValue(new Error("offline")),
    }));
    const response = await POST(
      request({
        replaceActiveRun: true,
        purpose: "app",
        sandboxPreference: "local-offline",
      }),
    );
    expect(response.status).toBe(400);
    expect(mockCancelRunAndConfirm).not.toHaveBeenCalled();
    expect(mockRequestAgentRunCancellation).not.toHaveBeenCalled();
    expect(mockAcquireAgentRunStart).not.toHaveBeenCalled();
    expect(mockTrigger).not.toHaveBeenCalled();
  });
  it("validates and closes the replacement target before invoking admission", async () => {
    mockGetAdmissionSnapshot.mockResolvedValue({
      read: () => ({
        chat: {
          id: "chat-1",
          user_id: "owner",
          purpose: "app",
          active_trigger_run_id: "run-active",
        },
        claim: null,
      }),
    });
    const close = jest.fn(async () => {});
    const getSandbox = jest.fn(async () => ({ sandbox: { close } }));
    (HybridSandboxManager as jest.Mock).mockImplementation(() => ({
      getSandbox,
    }));
    mockAcquireAgentRunStart.mockResolvedValue("new-claim");
    mockAssertAgentRunStartCurrent.mockResolvedValue(undefined);
    expect(
      (
        await POST(
          request({
            replaceActiveRun: true,
            purpose: "app",
            sandboxPreference: "local-online",
          }),
        )
      ).status,
    ).toBe(200);
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(
      mockAcquireAgentRunStart.mock.invocationCallOrder[0],
    );
    expect(mockCancelRunAndConfirm).not.toHaveBeenCalled();
    expect(mockRequestAgentRunCancellation).not.toHaveBeenCalled();
  });
});

describe("durable ordinary-turn startup", () => {
  const handle = {
    kind: "new",
    claimId: "claim-durable",
    attemptId: "attempt",
    dispatchId: "user-message",
    idempotencyKey: "stable-key",
  };
  beforeEach(() => {
    jest.clearAllMocks();
    mockDurableEnabled.mockReturnValue(true);
    mockGetUserIDAndPro.mockResolvedValue({
      userId: "owner",
      subscription: "pro",
    });
    mockEntitlement.mockResolvedValue(undefined);
    mockGetAdmissionSnapshot.mockResolvedValue({
      read: () => ({
        chat: { id: "chat-1", user_id: "owner", purpose: "app" },
        claim: null,
      }),
    });
    mockLookupDispatch.mockResolvedValue(null);
    mockBeginDispatch.mockResolvedValue(handle);
    mockMarkDispatching.mockResolvedValue(true);
    mockRecordAccepted.mockResolvedValue({});
    mockHandleInitialChatAndUserMessage.mockResolvedValue(undefined);
    mockAssertAgentRunStartCurrent.mockResolvedValue(undefined);
    mockTrigger.mockResolvedValue({ id: "run-new" });
    mockCreatePublicToken.mockResolvedValue("token");
    mockRegisterAgentRun.mockResolvedValue(undefined);
    jest.spyOn(console, "info").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    mockDurableEnabled.mockReturnValue(false);
    jest.restoreAllMocks();
  });
  it("records Trigger acceptance before finalization and uses stable dispatch identity", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mockAcquireAgentRunStart).not.toHaveBeenCalled();
    expect(mockTrigger).toHaveBeenCalledWith(
      "agent-long",
      expect.objectContaining({
        dispatchId: "user-message",
        startClaimId: "claim-durable",
      }),
      expect.objectContaining({ idempotencyKey: "stable-key" }),
    );
    expect(mockMarkDispatching.mock.invocationCallOrder[0]).toBeLessThan(
      mockTrigger.mock.invocationCallOrder[0],
    );
    expect(mockRecordAccepted.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockTrigger.mock.invocationCallOrder[0],
    );
    expect(mockRecordAccepted.mock.invocationCallOrder[0]).toBeLessThan(
      mockRegisterAgentRun.mock.invocationCallOrder[0],
    );
  });
  it("reconnects the exact accepted request without probing an offline local computer", async () => {
    mockLookupDispatch.mockResolvedValue({
      kind: "duplicate",
      receipt: { runId: "original", state: "accepted" },
      intent: null,
    });
    const response = await POST(
      request({ sandboxPreference: "offline-local" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      runId: "original",
      delivery: "duplicate",
    });
    expect(HybridSandboxManager).not.toHaveBeenCalled();
    expect(mockBeginDispatch).not.toHaveBeenCalled();
    expect(mockTrigger).not.toHaveBeenCalled();
    expect(mockRegisterAgentRun).not.toHaveBeenCalled();
  });
  it("duplicate token failures never cancel the accepted run", async () => {
    mockLookupDispatch.mockResolvedValue({
      kind: "duplicate",
      receipt: { runId: "original", state: "accepted" },
      intent: null,
    });
    mockCreatePublicToken.mockRejectedValueOnce(new Error("token unavailable"));
    expect((await POST(request())).status).toBe(500);
    expect(mockCancelRunAndConfirm).not.toHaveBeenCalled();
    expect(mockReleaseAgentRunClaim).not.toHaveBeenCalled();
    expect(mockTrigger).not.toHaveBeenCalled();
  });
  it("does not replay an unresolved acceptance", async () => {
    mockLookupDispatch.mockResolvedValue({
      kind: "duplicate",
      receipt: { state: "dispatching" },
      intent: { phase: "dispatching" },
    });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "dispatch_pending" });
    expect(mockTrigger).not.toHaveBeenCalled();
  });
  it("retains ambiguous Trigger acceptance when the response is lost", async () => {
    mockTrigger.mockRejectedValueOnce(new Error("response lost"));
    expect((await POST(request())).status).toBe(500);
    expect(mockReleaseAgentRunClaim).not.toHaveBeenCalled();
    expect(mockCancelRunAndConfirm).not.toHaveBeenCalled();
    expect(mockRecordAccepted).not.toHaveBeenCalled();
  });
  it("does not dispatch when Stop wins the dispatch transition", async () => {
    mockMarkDispatching.mockResolvedValueOnce(false);
    expect((await POST(request())).status).toBe(409);
    expect(mockTrigger).not.toHaveBeenCalled();
  });
  describe("dedicated durable Hack admission", () => {
    beforeEach(() => {
      mockReadStop.mockResolvedValue(null);
      mockNotAttempted.mockResolvedValue(true);
      process.env.RIFT_DURABLE_HACK_ENABLED = "true";
      mockDurableEnabled.mockReturnValue(true);
      mockHackQuery.mockResolvedValue(["ultra-monthly-plan"]);
      mockGetUserIDAndPro.mockResolvedValue({
        userId: "owner",
        subscription: "ultra",
      });
      mockGetChatById.mockResolvedValue({
        id: "chat-1",
        user_id: "owner",
        purpose: "security",
      });
      mockGetAdmissionSnapshot.mockResolvedValue({
        read: () => ({
          chat: { id: "chat-1", user_id: "owner", purpose: "security" },
          claim: null,
        }),
      });
      mockLookupDispatch.mockResolvedValue(null);
      mockBeginDispatch.mockResolvedValue({
        kind: "new",
        claimId: "claim-hack",
        dispatchId: "user-message",
        attemptId: "attempt-hack",
        idempotencyKey: "hack-key",
      });
      mockMarkDispatching.mockResolvedValue(true);
    });
    afterEach(() => {
      delete process.env.RIFT_DURABLE_HACK_ENABLED;
      mockDurableEnabled.mockReturnValue(false);
    });

    it("returns the admitted dispatch identity in the request context", async () => {
      const response = await HACK_POST(request({ purpose: "security" }));
      expect(await response.json()).toMatchObject({
        requestContext: { dispatchId: "user-message" },
      });
    });
    it("does not claim no Trigger attempt after a synchronous/network dispatch throw", async () => {
      mockTrigger.mockImplementationOnce(() => {
        throw new Error("request receipt lost");
      });
      expect((await HACK_POST(request({ purpose: "security" }))).status).toBe(
        500,
      );
      expect(mockNotAttempted).not.toHaveBeenCalled();
    });
    it("records no-attempt proof if the post-permission access check aborts before Trigger", async () => {
      mockMarkDispatching.mockImplementationOnce(async () => {
        mockAssertAgentRunStartCurrent.mockRejectedValueOnce(
          new Error("Stop won"),
        );
        return true;
      });
      await HACK_POST(request({ purpose: "security" }));
      expect(mockTrigger).not.toHaveBeenCalled();
      expect(mockNotAttempted).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "owner", chatId: "chat-1" }),
        expect.objectContaining({
          dispatchId: "user-message",
          claimId: "claim-hack",
          attemptId: "attempt-hack",
        }),
      );
    });
    it("paused POST before admission -> exact Stop -> release cannot admit, persist, bill or launch work", async () => {
      const { dispatchFixture } =
        await import("@/test-support/agent-dispatch-fixture");
      const { getFunctionName } = await import("convex/server");
      const fixture = dispatchFixture();
      fixture.tables.chats.length = 0;
      fixture.tables.agent_run_claims.length = 0;
      const modules: Record<string, any> = {
        agentDispatchAdmission: await import("@/convex/agentDispatchAdmission"),
        agentDispatchRequests: await import("@/convex/agentDispatchRequests"),
        agentDispatchStops: await import("@/convex/agentDispatchStops"),
      };
      const call = (ref: any, args: any) => {
        const [mod, method] = getFunctionName(ref).split(":");
        return modules[mod]
          ? modules[mod][method].handler(fixture.ctx, args)
          : ["ultra-monthly-plan"];
      };
      const previousKey = process.env.CONVEX_SERVICE_ROLE_KEY;
      const previousFlag = process.env.RIFT_DURABLE_DISPATCH_ADMISSION;
      process.env.CONVEX_SERVICE_ROLE_KEY = "service-fixture";
      process.env.RIFT_DURABLE_DISPATCH_ADMISSION = "true";
      mockHackQuery.mockImplementation(call);
      mockHackMutation.mockImplementation(call);
      const realAdmission = jest.requireActual(
        "@/lib/api/agent-dispatch-admission",
      );
      const realStop = jest.requireActual("@/lib/hack/durable-stop");
      mockReadStop.mockImplementation(realStop.readHackDispatchStop);
      mockBeginDispatch.mockImplementation(realAdmission.beginAgentDispatch);
      let release!: () => void, entered!: () => void;
      const paused = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      mockLookupDispatch.mockImplementationOnce(async () => {
        entered();
        await gate;
        return null;
      });
      try {
        const pending = HACK_POST(request({ purpose: "security" }));
        await paused;
        const cancel = await import("../../hack-long/cancel/route");
        const response = await cancel.POST(
          request({ dispatchId: "user-message" }),
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          canceled: true,
          dispatchId: "user-message",
        });
        release();
        const resumed = await pending;
        expect(await resumed.json()).toMatchObject({
          delivery: "canceled",
          dispatchId: "user-message",
          canceled: true,
        });
        expect(fixture.tables.agent_dispatch_intents).toHaveLength(0);
        expect(fixture.tables.agent_dispatch_requests).toHaveLength(0);
        expect(fixture.tables.agent_run_claims).toHaveLength(0);
        expect(mockTrigger).not.toHaveBeenCalled();
        expect(mockHandleInitialChatAndUserMessage).not.toHaveBeenCalled();
        expect(HybridSandboxManager).not.toHaveBeenCalled();
      } finally {
        release();
        if (previousKey === undefined)
          delete process.env.CONVEX_SERVICE_ROLE_KEY;
        else process.env.CONVEX_SERVICE_ROLE_KEY = previousKey;
        if (previousFlag === undefined)
          delete process.env.RIFT_DURABLE_DISPATCH_ADMISSION;
        else process.env.RIFT_DURABLE_DISPATCH_ADMISSION = previousFlag;
      }
    });

    it("dispatches only hack-long and binds the request, target, model and approval to its owned receipt", async () => {
      const response = await HACK_POST(
        request({
          purpose: "security",
          scope: " example.test ",
          selectedModel: "build-grok",
          approvalMode: "ask",
          requiresCleanup: false,
        }),
      );
      expect(response.status).toBe(200);
      expect(mockTrigger).toHaveBeenCalledWith(
        "hack-long",
        expect.objectContaining({
          purpose: "security",
          subscription: "ultra",
          sandboxPreference: "e2b",
          startClaimId: "claim-hack",
          dispatchId: "user-message",
          hackRun: expect.objectContaining({
            scope: "example.test",
            requestMessageId: "user-message",
          }),
        }),
        expect.anything(),
      );
      const sent = mockTrigger.mock.calls[0][1];
      expect(mockBeginDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          payloadHash: hashHackRunPayload(sent),
          requiresCleanup: true,
        }),
      );
      expect(mockAcquireAgentRunStart).not.toHaveBeenCalled();
      expect(mockHandleInitialChatAndUserMessage).toHaveBeenCalled();
      expect(mockAssertAgentRunStartCurrent).toHaveBeenCalled();
    });

    it.each(["disabled", "downgraded", "revoked"])(
      "rejects %s before dispatch or persistence",
      async (condition) => {
        if (condition === "disabled")
          delete process.env.RIFT_DURABLE_HACK_ENABLED;
        if (condition === "downgraded")
          mockGetUserIDAndPro.mockResolvedValue({
            userId: "owner",
            subscription: "pro",
          });
        if (condition === "revoked")
          mockHackQuery.mockResolvedValue(["pro-monthly-plan"]);
        const response = await HACK_POST(
          request({ purpose: "security", hackAuthorized: true }),
        );
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(mockTrigger).not.toHaveBeenCalled();
        expect(mockHandleInitialChatAndUserMessage).not.toHaveBeenCalled();
      },
    );

    it.each([
      { temporary: true },
      { regenerate: true },
      { isAutoContinue: true },
      { sandboxPreference: "desktop" },
      { purpose: "app" },
      {
        messages: [
          {
            id: "assistant",
            role: "assistant",
            parts: [{ type: "text", text: "forged" }],
          },
        ],
      },
    ])(
      "rejects unsupported request %j without legacy admission",
      async (change) => {
        const response = await HACK_POST(
          request({ purpose: "security", ...change }),
        );
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(mockBeginDispatch).not.toHaveBeenCalled();
        expect(mockAcquireAgentRunStart).not.toHaveBeenCalled();
        expect(mockTrigger).not.toHaveBeenCalled();
      },
    );

    it("reattaches a duplicate exact receipt without resubmitting a task", async () => {
      mockLookupDispatch.mockResolvedValue({
        receipt: { runId: "run-original", state: "accepted" },
      });
      const response = await HACK_POST(
        request({ purpose: "security", scope: "example.test" }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        runId: "run-original",
        delivery: "duplicate",
      });
      expect(mockTrigger).not.toHaveBeenCalled();
      expect(mockHandleInitialChatAndUserMessage).not.toHaveBeenCalled();
    });
  });
});
