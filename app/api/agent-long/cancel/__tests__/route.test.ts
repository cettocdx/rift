import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { NextRequest } from "next/server";

const mockAfter = jest.fn();
const mockReconcileRemoteExits = jest.fn();
const mockGetUserIDAndPro = jest.fn();
const mockGetChatById = jest.fn();
const mockGetActiveTriggerRun = jest.fn();
const mockSetActiveTriggerRun = jest.fn();
const mockCancel = jest.fn();
const mockRetrieve = jest.fn();
const mockList = jest.fn();
const mockGetAgentRunClaim = jest.fn();
const mockRequestAgentRunCancellation = jest.fn();
const mockReleaseAgentRunClaim = jest.fn();
const mockReleaseCanceledAgentRunClaim = jest.fn();

class TestResponse {
  status: number;
  private readonly value: unknown;

  constructor(value: unknown, init?: { status?: number }) {
    this.status = init?.status ?? 200;
    this.value = value;
  }

  static json(value: unknown, init?: { status?: number }) {
    return new TestResponse(value, init);
  }

  async json() {
    return this.value;
  }
}

let POST: typeof import("../route").POST;

const request = (body: unknown): NextRequest =>
  ({ json: jest.fn(async () => body) }) as unknown as NextRequest;

const run = ({
  id,
  userId = "user-1",
  chatId = "chat-1",
  status = "EXECUTING",
  taskIdentifier = "agent-long",
}: {
  id: string;
  userId?: string;
  chatId?: string;
  status?: string;
  taskIdentifier?: string;
}) => ({
  id,
  status,
  taskIdentifier,
  tags: [`user_${userId}`, `chat_${chatId}`],
});

describe("POST /api/agent-long/cancel", () => {
  beforeAll(() => {
    jest.resetModules();
    jest.doMock("next/server", () => ({
      NextResponse: TestResponse,
      after: mockAfter,
    }));
    jest.doMock("@/lib/api/reconcile-remote-exit-receipts", () => ({
      reconcileOwnedRemoteExitReceipts: mockReconcileRemoteExits,
    }));
    jest.doMock("@trigger.dev/sdk", () => ({
      runs: {
        cancel: mockCancel,
        retrieve: mockRetrieve,
        list: mockList,
      },
    }));
    jest.doMock("@/lib/auth/get-user-id", () => ({
      getUserIDAndPro: mockGetUserIDAndPro,
    }));
    jest.doMock("@/lib/api/agent-run-claims", () => ({
      getAgentRunClaim: mockGetAgentRunClaim,
      requestAgentRunCancellation: mockRequestAgentRunCancellation,
      releaseAgentRunClaim: mockReleaseAgentRunClaim,
      releaseCanceledAgentRunClaim: mockReleaseCanceledAgentRunClaim,
    }));
    jest.doMock("@/lib/db/actions", () => ({
      getChatById: mockGetChatById,
      getActiveTriggerRun: mockGetActiveTriggerRun,
      setActiveTriggerRun: mockSetActiveTriggerRun,
    }));
    ({ POST } = require("../route") as typeof import("../route"));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserIDAndPro.mockResolvedValue({ userId: "user-1" } as never);
    mockGetChatById.mockResolvedValue(null as never);
    mockGetActiveTriggerRun.mockResolvedValue(null as never);
    mockSetActiveTriggerRun.mockResolvedValue(undefined as never);
    mockCancel.mockReset().mockResolvedValue(undefined as never);
    // Model asynchronous cancellation: the initial observation is executing,
    // and a subsequent read confirms only the ID actually sent to cancel.
    mockRetrieve.mockReset().mockImplementation(async (id) =>
      run({
        id: id as string,
        status: mockCancel.mock.calls.some(([canceledId]) => canceledId === id)
          ? "CANCELED"
          : "EXECUTING",
      }),
    );
    mockList.mockResolvedValue({ data: [] } as never);
    mockGetAgentRunClaim.mockReset().mockResolvedValue(null as never);
    mockRequestAgentRunCancellation
      .mockReset()
      .mockResolvedValue(true as never);
    mockReleaseAgentRunClaim.mockReset().mockResolvedValue(true as never);
    mockReleaseCanceledAgentRunClaim
      .mockReset()
      .mockResolvedValue(true as never);
  });

  it("authenticates before parsing a user-controlled chat id", async () => {
    const req = request({ chatId: "chat-1", temporary: true });
    mockGetUserIDAndPro.mockRejectedValue(new Error("unauthorized") as never);
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const response = await POST(req);

      expect(response.status).toBe(500);
      expect(req.json).not.toHaveBeenCalled();
      expect(mockList).not.toHaveBeenCalled();
      expect(mockCancel).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("cancels only temporary runs carrying both the chat and authenticated user tags", async () => {
    // Temporary mode may reuse a chat id that also has a persisted row. The
    // caller's explicit scope must select the tag-authenticated temp path.
    mockGetChatById.mockResolvedValue({ user_id: "user-1" } as never);
    mockList.mockResolvedValue({
      data: [
        run({ id: "run-owned" }),
        run({ id: "run-other-user", userId: "user-2" }),
        run({ id: "run-other-chat", chatId: "chat-2" }),
        run({ id: "run-other-task", taskIdentifier: "other-task" }),
        run({ id: "run-complete", status: "COMPLETED" }),
      ],
    } as never);

    const response = await POST(request({ chatId: "chat-1", temporary: true }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ canceled: true });
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: "chat_chat-1",
        taskIdentifier: "agent-long",
      }),
    );
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockCancel).toHaveBeenCalledWith("run-owned");
    expect(mockGetChatById).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain("run-owned");
  });

  it("accepts stopping a draft rejected before it was persisted", async () => {
    const response = await POST(
      request({ chatId: "draft", allowMissingChat: true }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      canceled: false,
      reason: "no_active_run",
      chatMissing: true,
    });
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it("does not let the draft hint bypass another chat's ownership", async () => {
    mockGetChatById.mockResolvedValue({ user_id: "user-2" } as never);
    const response = await POST(
      request({ chatId: "chat-1", allowMissingChat: true }),
    );
    expect(response.status).toBe(403);
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it("accepts a repeated stop after an owned startup was released before persistence", async () => {
    mockGetAgentRunClaim.mockResolvedValue({
      claimId: "released",
      phase: "released",
    } as never);
    const response = await POST(request({ chatId: "chat-1" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      canceled: false,
      reason: "no_active_run",
      chatMissing: true,
    });
  });

  it("rejects an unknown persistent chat when no user-owned tagged run exists", async () => {
    const response = await POST(
      request({ chatId: "unknown-chat", temporary: false }),
    );

    expect(response.status).toBe(403);
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ tag: "chat_unknown-chat" }),
    );
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it("rejects a persisted chat owned by another user before reading its run", async () => {
    mockGetChatById.mockResolvedValue({ user_id: "user-2" } as never);

    const response = await POST(
      request({ chatId: "chat-1", temporary: false }),
    );

    expect(response.status).toBe(403);
    expect(mockGetActiveTriggerRun).not.toHaveBeenCalled();
    expect(mockList).toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it("cancels a temporary run even if the toggle changed before Stop", async () => {
    mockGetChatById.mockResolvedValue({ user_id: "user-1" } as never);
    mockGetActiveTriggerRun.mockResolvedValue(null as never);
    mockList.mockResolvedValue({
      data: [run({ id: "run-temp-after-toggle" })],
    } as never);

    const response = await POST(
      request({ chatId: "chat-1", temporary: false }),
    );

    expect(response.status).toBe(200);
    expect(mockCancel).toHaveBeenCalledWith("run-temp-after-toggle");
    expect(mockSetActiveTriggerRun).not.toHaveBeenCalled();
  });

  it("keeps persisted compare-and-clear behavior without returning the run id", async () => {
    mockGetChatById.mockResolvedValue({ user_id: "user-1" } as never);
    mockGetActiveTriggerRun.mockResolvedValue("run-persisted" as never);

    const response = await POST(request({ chatId: "chat-1" }));
    const body = await response.json();

    expect(mockCancel).toHaveBeenCalledWith("run-persisted");
    expect(mockSetActiveTriggerRun).toHaveBeenCalledWith({
      chatId: "chat-1",
      triggerRunId: null,
      expectedRunId: "run-persisted",
    });
    expect(body).toEqual({ canceled: true });
    expect(JSON.stringify(body)).not.toContain("run-persisted");
  });

  it("does not clear the persisted retry handle after an unconfirmed cancel failure", async () => {
    mockGetChatById.mockResolvedValue({ user_id: "user-1" } as never);
    mockGetActiveTriggerRun.mockResolvedValue("run-persisted" as never);
    mockCancel.mockRejectedValue(new Error("provider unavailable") as never);
    mockRetrieve.mockResolvedValue(
      run({ id: "run-persisted", status: "EXECUTING" }) as never,
    );
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const response = await POST(request({ chatId: "chat-1" }));

      expect(response.status).toBe(500);
      expect(mockSetActiveTriggerRun).not.toHaveBeenCalled();
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
        "run-persisted",
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("accepts a cancel race when the run already reached a terminal state", async () => {
    mockGetChatById.mockResolvedValue({ user_id: "user-1" } as never);
    mockGetActiveTriggerRun.mockResolvedValue("run-persisted" as never);
    mockCancel.mockRejectedValue(new Error("already complete") as never);
    mockRetrieve.mockResolvedValue(
      run({ id: "run-persisted", status: "COMPLETED" }) as never,
    );

    const response = await POST(request({ chatId: "chat-1" }));

    expect(response.status).toBe(200);
    expect(mockSetActiveTriggerRun).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRunId: "run-persisted" }),
    );
  });

  it.each([false, true])(
    "cancels an unbound startup before a chat row or Trigger run exists (temporary=%s)",
    async (temporary) => {
      mockGetAgentRunClaim.mockResolvedValue({
        claimId: "claim-starting",
        phase: "starting",
      } as never);

      const response = await POST(request({ chatId: "chat-1", temporary }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ canceled: true });
      expect(mockReleaseAgentRunClaim).toHaveBeenCalledWith({
        userId: "user-1",
        chatId: "chat-1",
        claimId: "claim-starting",
      });
      expect(mockRequestAgentRunCancellation).toHaveBeenCalledWith({
        userId: "user-1",
        chatId: "chat-1",
        claimId: "claim-starting",
      });
      expect(
        mockRequestAgentRunCancellation.mock.invocationCallOrder[0],
      ).toBeLessThan(mockReleaseAgentRunClaim.mock.invocationCallOrder[0]);
      expect(mockCancel).not.toHaveBeenCalled();
      expect(mockList).not.toHaveBeenCalled();
    },
  );

  it("cancels the same run if worker activation wins the unbound marker race", async () => {
    mockGetAgentRunClaim
      .mockResolvedValueOnce({
        claimId: "claim-starting",
        phase: "starting",
      } as never)
      .mockResolvedValueOnce({
        claimId: "claim-starting",
        phase: "active",
        runId: "run-bound",
      } as never);
    mockRequestAgentRunCancellation.mockResolvedValueOnce(false as never);
    mockReleaseAgentRunClaim.mockResolvedValue(false as never);

    const response = await POST(request({ chatId: "chat-1" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ canceled: true });
    expect(mockCancel).toHaveBeenCalledWith("run-bound");
    expect(mockReleaseCanceledAgentRunClaim).toHaveBeenCalledWith({
      userId: "user-1",
      chatId: "chat-1",
      claimId: "claim-starting",
      runId: "run-bound",
    });
    expect(mockCancel.mock.invocationCallOrder[0]).toBeLessThan(
      mockReleaseCanceledAgentRunClaim.mock.invocationCallOrder[0],
    );
    expect(mockList).not.toHaveBeenCalled();
  });

  it.each([
    { claimId: "claim-newer", phase: "active", runId: "run-newer" },
    { claimId: "claim-starting", phase: "released", runId: "run-finished" },
  ])(
    "never follows a replaced or already released startup into another run: %j",
    async (current) => {
      mockGetAgentRunClaim
        .mockResolvedValueOnce({
          claimId: "claim-starting",
          phase: "starting",
        } as never)
        .mockResolvedValueOnce(current as never);
      mockReleaseAgentRunClaim.mockResolvedValue(false as never);

      const response = await POST(request({ chatId: "chat-1" }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ canceled: true });
      expect(mockCancel).not.toHaveBeenCalled();
      expect(mockReleaseAgentRunClaim).toHaveBeenCalledTimes(1);
      expect(mockReleaseCanceledAgentRunClaim).not.toHaveBeenCalled();
      expect(mockList).not.toHaveBeenCalled();
    },
  );

  it("cancels a bound claim and clears only its claim after confirmation", async () => {
    mockGetAgentRunClaim.mockResolvedValue({
      claimId: "claim-active",
      phase: "active",
      runId: "run-bound",
    } as never);

    const response = await POST(request({ chatId: "chat-1", temporary: true }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ canceled: true });
    expect(mockCancel).toHaveBeenCalledWith("run-bound");
    expect(mockReleaseCanceledAgentRunClaim).toHaveBeenCalledWith({
      userId: "user-1",
      chatId: "chat-1",
      claimId: "claim-active",
      runId: "run-bound",
    });
    expect(mockCancel.mock.invocationCallOrder[0]).toBeLessThan(
      mockReleaseCanceledAgentRunClaim.mock.invocationCallOrder[0],
    );
    expect(mockList).not.toHaveBeenCalled();
  });

  it("keeps a bound claim when cancellation cannot be confirmed", async () => {
    mockGetAgentRunClaim.mockResolvedValue({
      claimId: "claim-active",
      phase: "active",
      runId: "run-bound",
    } as never);
    mockCancel.mockRejectedValue(new Error("provider unavailable") as never);
    mockRetrieve.mockResolvedValue(run({ id: "run-bound" }) as never);
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      expect((await POST(request({ chatId: "chat-1" }))).status).toBe(500);
      expect(mockReleaseCanceledAgentRunClaim).not.toHaveBeenCalled();
      expect(mockReleaseAgentRunClaim).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("fails closed if claim authority is unavailable instead of reporting no active run", async () => {
    mockGetAgentRunClaim.mockRejectedValue(
      new Error("database unavailable") as never,
    );
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      expect(
        (await POST(request({ chatId: "chat-1", temporary: true }))).status,
      ).toBe(500);
      expect(mockList).not.toHaveBeenCalled();
      expect(mockCancel).not.toHaveBeenCalled();
      expect(mockReleaseAgentRunClaim).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("returns a non-disclosing 403 when claim authority rejects ownership", async () => {
    const { ConvexError } = await import("convex/values");
    mockGetAgentRunClaim.mockRejectedValue(
      new ConvexError({
        code: "FORBIDDEN",
        message: "Do not expose private-claim/run-secret",
      }) as never,
    );
    const response = await POST(request({ chatId: "chat-1", temporary: true }));
    expect(response.status).toBe(403);
    expect(await response.json()).not.toContain("private-claim");
    expect(mockList).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it("does not report a successful Stop when the same startup remains unbound", async () => {
    mockGetAgentRunClaim.mockResolvedValue({
      claimId: "claim-starting",
      phase: "starting",
    } as never);
    mockReleaseAgentRunClaim.mockResolvedValue(false as never);
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      expect((await POST(request({ chatId: "chat-1" }))).status).toBe(500);
      expect(mockGetAgentRunClaim).toHaveBeenCalledTimes(2);
      expect(mockCancel).not.toHaveBeenCalled();
      expect(mockList).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("does not clear a replacement that appears during confirmed cancellation", async () => {
    mockGetAgentRunClaim
      .mockResolvedValueOnce({
        claimId: "claim-active",
        phase: "active",
        runId: "run-bound",
      } as never)
      .mockResolvedValue({
        claimId: "claim-new",
        phase: "active",
        runId: "run-new",
      } as never);
    // The CAS helper returns false once a newer claim owns the slot.
    mockReleaseCanceledAgentRunClaim.mockResolvedValue(false as never);

    const response = await POST(request({ chatId: "chat-1" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ canceled: true });
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockCancel).toHaveBeenCalledWith("run-bound");
    expect(mockReleaseCanceledAgentRunClaim).toHaveBeenCalledTimes(1);
    expect(mockReleaseAgentRunClaim).not.toHaveBeenCalled();
    expect(mockSetActiveTriggerRun).not.toHaveBeenCalled();
    expect(mockList).not.toHaveBeenCalled();
  });
  it("stamps exact observed generation before remote cancellation starts", async () => {
    mockGetAgentRunClaim.mockResolvedValue({
      claimId: "claim-a",
      phase: "active",
      runId: "run-a",
    } as never);
    mockCancel.mockImplementation(async () => {
      expect(mockRequestAgentRunCancellation).toHaveBeenCalledWith({
        userId: "user-1",
        chatId: "chat-1",
        claimId: "claim-a",
        runId: "run-a",
      });
    });
    expect((await POST(request({ chatId: "chat-1" }))).status).toBe(200);
    expect(
      mockRequestAgentRunCancellation.mock.invocationCallOrder[0],
    ).toBeLessThan(mockCancel.mock.invocationCallOrder[0]);
  });
  it("marker failure stops before remote cancel or release", async () => {
    mockGetAgentRunClaim.mockResolvedValue({
      claimId: "claim-a",
      phase: "active",
      runId: "run-a",
    } as never);
    mockRequestAgentRunCancellation.mockRejectedValue(
      new Error("database unavailable") as never,
    );
    const spy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      expect((await POST(request({ chatId: "chat-1" }))).status).toBe(500);
      expect(mockCancel).not.toHaveBeenCalled();
      expect(mockReleaseCanceledAgentRunClaim).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
  it("a replacement between claim read and marker CAS is never remotely canceled", async () => {
    mockGetAgentRunClaim.mockResolvedValue({
      claimId: "old",
      phase: "active",
      runId: "old-run",
    } as never);
    mockRequestAgentRunCancellation.mockResolvedValue(false as never);
    expect((await POST(request({ chatId: "chat-1" }))).status).toBe(200);
    expect(mockCancel).not.toHaveBeenCalled();
    expect(mockReleaseCanceledAgentRunClaim).not.toHaveBeenCalled();
  });
  it("remote timeout retains durable intent without releasing an active generation", async () => {
    mockGetAgentRunClaim.mockResolvedValue({
      claimId: "claim-a",
      phase: "active",
      runId: "run-a",
    } as never);
    let marked = false;
    mockRequestAgentRunCancellation.mockImplementation(async () => {
      marked = true;
      return true;
    });
    mockCancel.mockRejectedValue(new Error("timeout") as never);
    mockRetrieve.mockResolvedValue(run({ id: "run-a" }) as never);
    const spy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      expect((await POST(request({ chatId: "chat-1" }))).status).toBe(500);
      expect(marked).toBe(true);
      expect(mockReleaseCanceledAgentRunClaim).not.toHaveBeenCalled();
      expect(mockReleaseAgentRunClaim).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
  it("lets a cooperative worker finish its usage settlement before forcing cancellation", async () => {
    mockGetAgentRunClaim.mockResolvedValue({
      claimId: "claim-a",
      phase: "active",
      runId: "run-a",
    } as never);
    mockRetrieve
      .mockReset()
      .mockResolvedValueOnce({
        ...run({ id: "run-a" }),
        metadata: { cooperativeStopReady: true },
      } as never)
      .mockResolvedValueOnce({
        ...run({ id: "run-a", status: "COMPLETED" }),
        metadata: { status: "canceled" },
      } as never);
    expect((await POST(request({ chatId: "chat-1" }))).status).toBe(200);
    expect(mockCancel).not.toHaveBeenCalled();
    expect(mockReleaseCanceledAgentRunClaim).toHaveBeenCalledWith({
      userId: "user-1",
      chatId: "chat-1",
      claimId: "claim-a",
      runId: "run-a",
    });
  });

  it("keeps Stop pending when the worker is terminal but remote cleanup is unconfirmed", async () => {
    mockGetAgentRunClaim.mockResolvedValue({
      claimId: "claim-a",
      phase: "active",
      runId: "run-a",
    } as never);
    mockReleaseCanceledAgentRunClaim.mockResolvedValue(false as never);
    const response = await POST(request({ chatId: "chat-1" }));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      canceled: false,
      reason: "cleanup_pending",
    });
    expect(mockReleaseAgentRunClaim).not.toHaveBeenCalled();
    expect(mockAfter).toHaveBeenCalledTimes(1);
    expect(mockReconcileRemoteExits).not.toHaveBeenCalled();
    const callback = mockAfter.mock.calls[0][0] as () => Promise<void>;
    await callback();
    expect(mockReconcileRemoteExits).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", chatId: "chat-1" }),
    );
  });

  it("forces an unresponsive cooperative worker after a bounded grace period", async () => {
    jest.useFakeTimers();
    try {
      mockGetAgentRunClaim.mockResolvedValue({
        claimId: "claim-a",
        phase: "active",
        runId: "run-a",
      } as never);
      mockRetrieve.mockReset().mockResolvedValue({
        ...run({ id: "run-a" }),
        metadata: { cooperativeStopReady: true },
      } as never);
      mockCancel.mockImplementation(async () => {
        mockRetrieve.mockResolvedValue(
          run({ id: "run-a", status: "CANCELED" }) as never,
        );
      });
      const response = POST(request({ chatId: "chat-1" }));
      await jest.advanceTimersByTimeAsync(7500);
      expect(mockCancel).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(600);
      expect((await response).status).toBe(200);
      expect(mockCancel).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
