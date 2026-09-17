/** @jest-environment node */
const mockQuery = jest.fn();
const mockMutation = jest.fn();
const mockGetChatById = jest.fn();
const mockIsRunActive = jest.fn();
const mockCancel = jest.fn();
const mockTagged = jest.fn();
jest.mock("@/convex/_generated/api", () => ({
  api: {
    agentRunClaims: {
      getForBackend: "get",
      isExecutionCurrent: "isExecutionCurrent",
      requestCancellation: "requestCancellation",
      getAdmissionSnapshot: "admission",
      reserveObserved: "reserveObserved",
      activate: "activate",
      activateForWorker: "activateForWorker",
      release: "release",
    },
  },
}));
jest.mock("@/lib/db/convex-client", () => ({
  ...jest.requireActual<typeof import("@/lib/db/convex-client")>(
    "@/lib/db/convex-client",
  ),
  getConvexClient: () => ({ query: mockQuery, mutation: mockMutation }),
}));
jest.mock("@/lib/db/actions", () => ({
  getChatById: (...args: unknown[]) => mockGetChatById(...args),
}));
jest.mock("@/lib/api/agent-long-runs", () => ({
  isRunActive: (...args: unknown[]) => mockIsRunActive(...args),
  cancelRunAndConfirm: (...args: unknown[]) => mockCancel(...args),
  getOwnedTaggedRunIds: (...args: unknown[]) => mockTagged(...args),
}));
import {
  acquireAgentRunStart,
  assertAgentRunExecutionCurrent,
  requestAgentRunCancellation,
  assertAgentRunStartCurrent,
  registerAgentRun,
  releaseCanceledAgentRunClaim,
  releaseAgentRunClaim,
  startClaimedAgentRun,
  startClaimedAgentRunForWorker,
  AgentRunBusyError,
  AgentRunClaimLostError,
} from "../agent-run-claims";
import {
  AgentRunCanceledError,
  createWorkerClaimCancellation,
} from "@/lib/agent/claim-cancellation";
const owner = { userId: "owner", chatId: "chat" };
const run = { ...owner, claimId: "claim", runId: "run" };
const activeClaim = {
  ...owner,
  claimId: "claim",
  runId: "run",
  phase: "active",
  leaseUntil: 1,
  startedAt: 0,
};
beforeEach(() => {
  jest.resetAllMocks();
  mockQuery.mockResolvedValue(null);
  mockGetChatById.mockResolvedValue(null);
  mockMutation.mockResolvedValue({ acquired: true });
  mockIsRunActive.mockResolvedValue(false);
  mockTagged.mockResolvedValue([]);
});
it("reserves using the observed generation only after a previous run is confirmed terminal", async () => {
  mockQuery.mockResolvedValue(activeClaim);
  await acquireAgentRunStart(owner);
  expect(mockIsRunActive).toHaveBeenCalledWith("run");
  expect(mockMutation).toHaveBeenCalledWith(
    "reserveObserved",
    expect.objectContaining({ expectedClaimId: "claim", expectedRunId: "run" }),
    { skipQueue: true },
  );
  expect(mockIsRunActive.mock.invocationCallOrder[0]).toBeLessThan(
    mockMutation.mock.invocationCallOrder[0],
  );
});
it.each([
  null,
  { ...activeClaim, phase: "released" },
  { ...activeClaim, claimId: "newer", phase: "starting", runId: undefined },
])("does not save or dispatch after admission is lost (%j)", async (claim) => {
  mockQuery.mockResolvedValue(claim);
  await expect(
    assertAgentRunStartCurrent({ ...owner, claimId: "claim" }),
  ).rejects.toBeInstanceOf(AgentRunClaimLostError);
});
it("aborted preparation is rejected before another database request", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    assertAgentRunStartCurrent(
      { ...owner, claimId: "claim" },
      controller.signal,
    ),
  ).rejects.toBeInstanceOf(AgentRunClaimLostError);
  expect(mockQuery).not.toHaveBeenCalled();
});
it("a current prepared claim may proceed without renewing its lease", async () => {
  mockQuery.mockResolvedValue({
    ...activeClaim,
    phase: "starting",
    runId: undefined,
  });
  await expect(
    assertAgentRunStartCurrent({ ...owner, claimId: "claim" }),
  ).resolves.toBeUndefined();
  expect(mockMutation).not.toHaveBeenCalled();
});
it("does not reserve if Trigger cannot confirm liveness", async () => {
  mockQuery.mockResolvedValue(activeClaim);
  mockIsRunActive.mockRejectedValue(new Error("offline"));
  await expect(acquireAgentRunStart(owner)).rejects.toThrow("offline");
  expect(mockMutation).not.toHaveBeenCalled();
});
it.each([false, true])(
  "does not replace or cancel a run after an unresolved 404 (replace=%s)",
  async (replaceActiveRun) => {
    mockQuery.mockResolvedValue(activeClaim);
    const failure = Object.assign(new Error("Run lookup unavailable"), {
      status: 404,
    });
    mockIsRunActive.mockRejectedValue(failure);
    await expect(
      acquireAgentRunStart({ ...owner, replaceActiveRun }),
    ).rejects.toBe(failure);
    expect(mockMutation).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
  },
);
it("rejects a live run, even though its starting lease is old", async () => {
  mockQuery.mockResolvedValue(activeClaim);
  mockIsRunActive.mockResolvedValue(true);
  await expect(acquireAgentRunStart(owner)).rejects.toBeInstanceOf(
    AgentRunBusyError,
  );
  expect(mockMutation).not.toHaveBeenCalled();
});
it("cancels an explicitly replaced run before reserving its replacement", async () => {
  mockQuery.mockResolvedValue(activeClaim);
  mockIsRunActive.mockResolvedValue(true);
  await acquireAgentRunStart({ ...owner, replaceActiveRun: true });
  expect(mockCancel).toHaveBeenCalledWith("run");
  expect(mockCancel.mock.invocationCallOrder[0]).toBeLessThan(
    mockMutation.mock.invocationCallOrder[
      mockMutation.mock.calls.findIndex(
        ([method]) => method === "reserveObserved",
      )
    ],
  );
});
it("checks legacy temporary runs through owned tags", async () => {
  mockTagged.mockResolvedValue(["legacy-run"]);
  mockIsRunActive.mockResolvedValue(true);
  await expect(
    acquireAgentRunStart({ ...owner, temporary: true }),
  ).rejects.toBeInstanceOf(AgentRunBusyError);
  expect(mockTagged).toHaveBeenCalledWith(owner);
  expect(mockMutation).not.toHaveBeenCalled();
});
it("rejects a new mapping that appeared after admission checks", async () => {
  mockGetChatById.mockResolvedValue({
    user_id: "owner",
    active_trigger_run_id: "newer-run",
  });
  await expect(acquireAgentRunStart(owner)).rejects.toBeInstanceOf(
    AgentRunBusyError,
  );
  expect(mockMutation).not.toHaveBeenCalled();
});
it("a lost database reservation never dispatches as acquired", async () => {
  mockMutation.mockResolvedValue({ acquired: false, runId: "winner" });
  await expect(acquireAgentRunStart(owner)).rejects.toBeInstanceOf(
    AgentRunBusyError,
  );
});
it("late route bookkeeping accepts an already completed same run without reviving it", async () => {
  mockMutation.mockResolvedValue(false);
  mockQuery.mockResolvedValue({ ...activeClaim, phase: "released" });
  await expect(registerAgentRun(run)).resolves.toBeUndefined();
  expect(mockMutation).toHaveBeenCalledTimes(1);
});
it("route registration cannot accept a different replacement run", async () => {
  mockMutation.mockResolvedValue(false);
  mockQuery.mockResolvedValue({
    ...activeClaim,
    claimId: "newer",
    phase: "released",
  });
  await expect(registerAgentRun(run)).rejects.toBeInstanceOf(
    AgentRunClaimLostError,
  );
});
it("worker admission rejects replaced claims before work", async () => {
  mockMutation.mockResolvedValue(false);
  await expect(
    startClaimedAgentRun({ ...owner, startClaimId: "claim", runId: "run" }),
  ).rejects.toBeInstanceOf(AgentRunClaimLostError);
});
it("confirmed cancellation releases a reservation whose run binding failed", async () => {
  mockMutation.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await expect(releaseCanceledAgentRunClaim(run)).resolves.toBe(true);
  expect(mockMutation.mock.calls[1]).toEqual([
    "release",
    expect.objectContaining({ ...owner, claimId: "claim" }),
  ]);
  expect(mockMutation.mock.calls[1][1]).not.toHaveProperty("runId");
});
it("confirmed cancellation handles a worker binding between release attempts", async () => {
  mockMutation
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);
  await expect(releaseCanceledAgentRunClaim(run)).resolves.toBe(true);
  expect(mockMutation.mock.calls[2][1]).toEqual(expect.objectContaining(run));
});
it("confirmed cancellation never releases a newer claim generation", async () => {
  mockMutation.mockResolvedValue(false);
  await expect(releaseCanceledAgentRunClaim(run)).resolves.toBe(false);
  for (const [name, args] of mockMutation.mock.calls) {
    expect(name).toBe("release");
    expect(args).toEqual(
      expect.objectContaining({ ...owner, claimId: "claim" }),
    );
  }
});
it("a queued legacy worker cannot revive a chat that has a newer claim", async () => {
  mockQuery.mockResolvedValue({ ...activeClaim, phase: "released" });
  await expect(
    startClaimedAgentRun({ ...owner, runId: "old-run" }),
  ).rejects.toBeInstanceOf(AgentRunClaimLostError);
  expect(mockMutation).not.toHaveBeenCalled();
});
it("scheduled legacy workers must reserve and activate before proceeding", async () => {
  mockMutation
    .mockResolvedValueOnce({ acquired: true })
    .mockResolvedValueOnce(true);
  await expect(
    startClaimedAgentRun({ ...owner, runId: "scheduled" }),
  ).resolves.toBe("legacy_scheduled");
  expect(mockMutation.mock.calls.map(([name]) => name)).toEqual([
    "reserveObserved",
    "activate",
  ]);
});

it("reads chat and claim together for fresh admission, without waiting for a serial round trip", async () => {
  let release!: (value: null) => void;
  mockQuery.mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const pending = acquireAgentRunStart(owner);
  await Promise.resolve();
  const chatStarted = mockGetChatById.mock.calls.length;
  expect(mockMutation).not.toHaveBeenCalled();
  release(null);
  await pending;
  expect(chatStarted).toBe(1);
});

it("rereads the chat after checking an old run so a new mapping cannot be overwritten", async () => {
  mockQuery.mockResolvedValue(activeClaim);
  mockGetChatById
    .mockResolvedValueOnce({ user_id: "owner", active_trigger_run_id: "run" })
    .mockResolvedValueOnce({
      user_id: "owner",
      active_trigger_run_id: "replacement",
    });
  await expect(acquireAgentRunStart(owner)).rejects.toBeInstanceOf(
    AgentRunBusyError,
  );
  expect(mockMutation).not.toHaveBeenCalled();
});

it("reuses an authenticated empty chat snapshot but still reserves atomically", async () => {
  await acquireAgentRunStart({ ...owner, chatSnapshot: null });
  expect(mockGetChatById).not.toHaveBeenCalled();
  expect(mockMutation).toHaveBeenCalledWith(
    "reserveObserved",
    expect.objectContaining(owner),
    { skipQueue: true },
  );
});
it("rejects another owner's snapshot before reserving", async () => {
  await expect(
    acquireAgentRunStart({
      ...owner,
      chatSnapshot: { user_id: "other" } as any,
    }),
  ).rejects.toThrow();
  expect(mockMutation).not.toHaveBeenCalled();
});
it("rereads after remote liveness even when an initial snapshot was supplied", async () => {
  mockQuery.mockResolvedValue(activeClaim);
  mockGetChatById.mockResolvedValue({
    user_id: "owner",
    active_trigger_run_id: "replacement",
  });
  await expect(
    acquireAgentRunStart({ ...owner, chatSnapshot: null }),
  ).rejects.toBeInstanceOf(AgentRunBusyError);
  expect(mockGetChatById).toHaveBeenCalledTimes(1);
  expect(mockMutation).not.toHaveBeenCalled();
});

it("worker activation returns a run-bound snapshot using its separate API", async () => {
  const { startClaimedAgentRunForWorker } = await import("../agent-run-claims");
  mockMutation.mockResolvedValue({
    activated: true,
    chat: {
      id: "chat",
      user_id: "owner",
      active_trigger_run_id: "run",
      title: "owned",
    },
  });
  const result = await startClaimedAgentRunForWorker({
    ...owner,
    runId: "run",
    startClaimId: "claim",
  });
  expect(result.claimId).toBe("claim");
  expect(result.chatSnapshot.read({ ...owner, runId: "run" })).toMatchObject({
    title: "owned",
  });
  expect(mockMutation).toHaveBeenCalledWith(
    "activateForWorker",
    expect.objectContaining({ requireChat: true, claimId: "claim" }),
  );
  expect(mockGetChatById).not.toHaveBeenCalled();
  expect(() =>
    result.chatSnapshot.read({ ...owner, runId: "replacement" }),
  ).toThrow();
});
it("worker lost activation never creates a snapshot", async () => {
  const { startClaimedAgentRunForWorker } = await import("../agent-run-claims");
  mockMutation.mockResolvedValue({ activated: false });
  await expect(
    startClaimedAgentRunForWorker({
      ...owner,
      runId: "run",
      startClaimId: "claim",
    }),
  ).rejects.toBeInstanceOf(AgentRunClaimLostError);
});
it("temporary worker absence remains null, while a persisted absent chat fails closed", async () => {
  const { startClaimedAgentRunForWorker } = await import("../agent-run-claims");
  mockMutation.mockResolvedValue({ activated: true, chat: null });
  const result = await startClaimedAgentRunForWorker({
    ...owner,
    runId: "run",
    startClaimId: "claim",
    temporary: true,
  });
  expect(result.chatSnapshot.read({ ...owner, runId: "run" })).toBeNull();
  await expect(
    startClaimedAgentRunForWorker({
      ...owner,
      runId: "run",
      startClaimId: "claim",
    }),
  ).rejects.toBeInstanceOf(AgentRunClaimLostError);
});
it("a legacy worker still reserves before activating its snapshot", async () => {
  const { startClaimedAgentRunForWorker } = await import("../agent-run-claims");
  mockMutation.mockImplementation(async (ref) =>
    ref === "reserveObserved"
      ? { acquired: true }
      : { activated: true, chat: null },
  );
  await startClaimedAgentRunForWorker({
    ...owner,
    runId: "run",
    temporary: true,
  });
  expect(mockMutation.mock.calls.map(([name]) => name)).toEqual([
    "reserveObserved",
    "activateForWorker",
  ]);
});

describe("admission snapshot reuse", () => {
  const load = async () => {
    const snapshotModule = jest.requireActual(
      "@/lib/db/agent-admission-snapshot",
    );
    return snapshotModule.getAgentAdmissionSnapshot(owner);
  };
  it.each([null, { ...activeClaim, phase: "released" }])(
    "uses one query for fresh chat+claim while reserving atomically",
    async (claim) => {
      mockQuery.mockResolvedValue({ chat: null, claim });
      const admissionSnapshot = await load();
      await acquireAgentRunStart({ ...owner, admissionSnapshot } as any);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockGetChatById).not.toHaveBeenCalled();
      expect(mockMutation).toHaveBeenCalledWith(
        "reserveObserved",
        expect.objectContaining(owner),
        { skipQueue: true },
      );
    },
  );
  it("rejects a capability reused for another owner or chat before any side effect", async () => {
    mockQuery.mockResolvedValue({ chat: null, claim: null });
    const admissionSnapshot = await load();
    for (const changed of [{ userId: "other" }, { chatId: "other" }]) {
      await expect(
        acquireAgentRunStart({
          ...owner,
          ...changed,
          admissionSnapshot,
        } as any),
      ).rejects.toThrow("Admission snapshot owner mismatch");
    }
    expect(mockMutation).not.toHaveBeenCalled();
    expect(mockIsRunActive).not.toHaveBeenCalled();
  });
  it("does not accept a JSON-shaped capability", async () => {
    await expect(
      acquireAgentRunStart({
        ...owner,
        admissionSnapshot: { chat: null, claim: null },
      } as any),
    ).rejects.toThrow("Invalid admission snapshot");
    expect(mockMutation).not.toHaveBeenCalled();
  });
  it("retains live claim and post-liveness chat reads for active snapshots", async () => {
    mockQuery
      .mockResolvedValueOnce({ chat: null, claim: activeClaim })
      .mockResolvedValue(activeClaim);
    const admissionSnapshot = await load();
    mockGetChatById.mockResolvedValue({
      user_id: "owner",
      active_trigger_run_id: "replacement",
    });
    await expect(
      acquireAgentRunStart({ ...owner, admissionSnapshot } as any),
    ).rejects.toBeInstanceOf(AgentRunBusyError);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockGetChatById).toHaveBeenCalledTimes(1);
    expect(mockMutation).not.toHaveBeenCalled();
  });
  it("temporary admission retains migration discovery and live claim lookup", async () => {
    mockQuery
      .mockResolvedValueOnce({ chat: null, claim: null })
      .mockResolvedValue(null);
    const admissionSnapshot = await load();
    await acquireAgentRunStart({
      ...owner,
      temporary: true,
      admissionSnapshot,
    } as any);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockTagged).toHaveBeenCalledWith(owner);
  });
  it.each([
    { chat: { id: "chat", user_id: "other" }, claim: null },
    { chat: null, claim: { ...activeClaim, chatId: "other" } },
  ])(
    "rejects a mismatched backend response before constructing a capability",
    async (result) => {
      mockQuery.mockResolvedValue(result);
      await expect(load()).rejects.toThrow("Admission snapshot owner mismatch");
      expect(mockMutation).not.toHaveBeenCalled();
    },
  );
  it("stale fresh snapshot still obeys a rejected current reservation", async () => {
    mockQuery.mockResolvedValue({ chat: null, claim: null });
    const admissionSnapshot = await load();
    mockMutation.mockResolvedValue({ acquired: false, runId: "competing-run" });
    await expect(
      acquireAgentRunStart({ ...owner, admissionSnapshot } as any),
    ).rejects.toBeInstanceOf(AgentRunBusyError);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockMutation).toHaveBeenCalledTimes(1);
  });
  it("preserves a forbidden response when backend snapshot ownership is rejected", async () => {
    const { ConvexError } = jest.requireActual("convex/values");
    mockQuery.mockRejectedValue(
      new ConvexError({
        code: "FORBIDDEN",
        message: "You do not own this chat",
      }),
    );
    await expect(load()).rejects.toMatchObject({
      type: "forbidden",
      surface: "chat",
    });
    expect(mockMutation).not.toHaveBeenCalled();
  });
});

it.each([false, true])(
  "fresh execution seam prevents effects for canceled claimed purpose (temporary=%s)",
  async (temporary) => {
    mockQuery.mockResolvedValue(false);
    const effect = jest.fn();
    await expect(
      (async () => {
        await assertAgentRunExecutionCurrent({ ...run, temporary });
        effect();
      })(),
    ).rejects.toBeInstanceOf(AgentRunClaimLostError);
    expect(effect).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledWith(
      "isExecutionCurrent",
      expect.objectContaining({ ...run, requireChat: !temporary }),
    );
  },
);
it("execution seam rechecks the abort signal after its database await", async () => {
  const abort = new AbortController();
  mockQuery.mockImplementation(async () => {
    abort.abort();
    return true;
  });
  const effect = jest.fn();
  await expect(
    (async () => {
      await assertAgentRunExecutionCurrent(run, abort.signal);
      effect();
    })(),
  ).rejects.toBeInstanceOf(AgentRunCanceledError);
  expect(effect).not.toHaveBeenCalled();
});
it("current execution seam preserves permission and cancellation mutation keeps exact binding", async () => {
  mockQuery.mockResolvedValue(true);
  await expect(assertAgentRunExecutionCurrent(run)).resolves.toBeUndefined();
  await requestAgentRunCancellation(run);
  expect(mockMutation).toHaveBeenCalledWith(
    "requestCancellation",
    expect.objectContaining(run),
  );
});
it("worker fence is unconditional before the first sandbox side effect", () => {
  const fs = jest.requireActual<typeof import("node:fs")>("node:fs");
  const path = jest.requireActual<typeof import("node:path")>("node:path");
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../../trigger/agent-long.ts"),
    "utf8",
  );
  const fence = source.indexOf('await measureSetup("executionFence",');
  const firstEffect = source.indexOf('await measureSetup("turnSandbox",');
  expect(fence).toBeGreaterThan(0);
  expect(firstEffect).toBeGreaterThan(0);
  expect(fence).toBeLessThan(firstEffect);
  expect(source.slice(fence, firstEffect)).toContain(
    "assertAgentRunExecutionCurrent(",
  );
  expect(source.slice(firstEffect)).toContain("prepareTurnSandbox({");
  expect(source.slice(fence, firstEffect)).not.toMatch(
    /if\s*\([^)]*(?:temporary|purpose)/,
  );
});

it("replacement stamps the observed claim before remote cancellation and retains busy ownership on failure", async () => {
  mockQuery.mockResolvedValue(activeClaim);
  mockGetChatById.mockResolvedValue({
    user_id: "owner",
    active_trigger_run_id: "run",
  });
  mockIsRunActive.mockResolvedValue(true);
  mockMutation.mockResolvedValue(true);
  mockCancel.mockRejectedValue(new Error("remote timeout"));
  await expect(
    acquireAgentRunStart({ ...owner, replaceActiveRun: true }),
  ).rejects.toThrow("remote timeout");
  expect(mockMutation).toHaveBeenCalledWith(
    "requestCancellation",
    expect.objectContaining({ ...run, reason: "replace" }),
  );
  expect(mockMutation.mock.invocationCallOrder[0]).toBeLessThan(
    mockCancel.mock.invocationCallOrder[0],
  );
  expect(
    mockMutation.mock.calls.some(([method]) => method === "reserveObserved"),
  ).toBe(false);
});
it("replacement marker CAS losing to a newer generation stops before remote cancellation", async () => {
  mockQuery.mockResolvedValue(activeClaim);
  mockGetChatById.mockResolvedValue({
    user_id: "owner",
    active_trigger_run_id: "run",
  });
  mockIsRunActive.mockResolvedValue(true);
  mockMutation.mockResolvedValue(false);
  await expect(
    acquireAgentRunStart({ ...owner, replaceActiveRun: true }),
  ).rejects.toBeInstanceOf(AgentRunBusyError);
  expect(mockCancel).not.toHaveBeenCalled();
});

it("classifies an exact owned durable Stop as cancellation before Trigger abort arrives", async () => {
  mockQuery.mockResolvedValueOnce(false).mockResolvedValueOnce({
    ...activeClaim,
    cancelRequestedAt: 123,
  });
  const signal = new AbortController().signal;
  await expect(
    assertAgentRunExecutionCurrent(run, signal),
  ).rejects.toMatchObject({
    name: "AgentRunCanceledError",
  });
  expect(signal.aborted).toBe(false);
  expect(mockQuery).toHaveBeenNthCalledWith(
    2,
    "get",
    expect.objectContaining(owner),
  );
});

it("the actual SDK stream emits abort rather than error for durable Stop with a clear Trigger signal", async () => {
  const { createUIMessageStream } = await import("ai");
  mockQuery.mockResolvedValueOnce(false).mockResolvedValueOnce({
    ...activeClaim,
    cancelRequestedAt: 123,
  });
  const cancellation = createWorkerClaimCancellation();
  const onError = jest.fn(() => "The agent run failed");
  const finish = jest.fn();
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      try {
        await assertAgentRunExecutionCurrent(run);
      } catch (error) {
        if (!cancellation.handle(error, writer)) throw error;
      }
    },
    onError,
    onFinish: finish,
  });
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  expect(chunks).toEqual([{ type: "abort" }]);
  expect(onError).not.toHaveBeenCalled();
  expect(finish).toHaveBeenCalledWith(
    expect.objectContaining({ isAborted: true }),
  );
  expect(cancellation.terminalStatus(false, "succeeded")).toBe("canceled");
  expect(cancellation.terminalStatus(false, "failed")).toBe("canceled");
});

it.each([
  null,
  { ...activeClaim },
  { ...activeClaim, cancelRequestedAt: 1, claimId: "replacement" },
  { ...activeClaim, cancelRequestedAt: 1, runId: "replacement-run" },
  { ...activeClaim, cancelRequestedAt: 1, userId: "foreign" },
  { ...activeClaim, cancelRequestedAt: 1, chatId: "other-chat" },
  { ...activeClaim, cancelRequestedAt: 1, phase: "starting", runId: undefined },
])(
  "denied execution is not mislabeled Stop without exact run evidence: %j",
  async (current) => {
    mockQuery.mockResolvedValueOnce(false).mockResolvedValueOnce(current);
    await expect(assertAgentRunExecutionCurrent(run)).rejects.toBeInstanceOf(
      AgentRunClaimLostError,
    );
  },
);
it.each(["initial", "diagnostic"])(
  "%s permission/transport failures remain real SDK error chunks",
  async (stage) => {
    const { createUIMessageStream } = await import("ai");
    const failure = new Error("read unavailable");
    if (stage === "initial") mockQuery.mockRejectedValueOnce(failure);
    else mockQuery.mockResolvedValueOnce(false).mockRejectedValueOnce(failure);
    const cancellation = createWorkerClaimCancellation();
    const onError = jest.fn(() => "Real read failure");
    const effect = jest.fn();
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        try {
          await assertAgentRunExecutionCurrent(run);
          effect();
        } catch (error) {
          if (!cancellation.handle(error, writer)) throw error;
        }
      },
      onError,
    });
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    expect(chunks).toEqual([{ type: "error", errorText: "Real read failure" }]);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(effect).not.toHaveBeenCalled();
    expect(cancellation.terminalStatus(false, "failed")).toBe("failed");
  },
);
it("successful execution adds no diagnostic read", async () => {
  mockQuery.mockResolvedValueOnce(true);
  await expect(assertAgentRunExecutionCurrent(run)).resolves.toBeUndefined();
  expect(mockQuery).toHaveBeenCalledTimes(1);
});
it("same-run canceled activation re-entry is expected Stop while replacement remains claim loss", async () => {
  mockMutation.mockResolvedValue({ activated: false });
  mockQuery.mockResolvedValue({ ...activeClaim, cancelRequestedAt: 1 });
  await expect(
    startClaimedAgentRunForWorker({ ...run, startClaimId: run.claimId }),
  ).rejects.toBeInstanceOf(AgentRunCanceledError);
  mockQuery.mockResolvedValue({
    ...activeClaim,
    claimId: "replacement",
    cancelRequestedAt: 1,
  });
  await expect(
    startClaimedAgentRunForWorker({ ...run, startClaimId: run.claimId }),
  ).rejects.toBeInstanceOf(AgentRunClaimLostError);
});
it("explicit AbortSignal rejects before admission without a diagnostic read", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    assertAgentRunExecutionCurrent(run, controller.signal),
  ).rejects.toBeInstanceOf(AgentRunCanceledError);
  expect(mockQuery).not.toHaveBeenCalled();
});

it("binds the tested Stop latch to execute, post-drain scheduling, outer setup and finally", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(
    path.join(process.cwd(), "trigger/agent-long.ts"),
    "utf8",
  );
  expect(source).toMatch(
    /if \(\s*claimCancellation\.handle\([\s\S]*?error,\s*writer,[\s\S]*?\)\s*\)\s*return;\s*throw error;/,
  );
  expect(source).toMatch(
    /scheduledRunOutcome = claimCancellation\.terminalStatus\(\s*triggerSignal\.aborted,\s*"succeeded",?\s*\)/,
  );
  expect(source).toMatch(
    /const finalStatus = claimCancellation\.terminalStatus\(\s*triggerSignal\.aborted,\s*scheduledRunOutcome,?\s*\)/,
  );
  expect(source).toMatch(
    /if \(checkpointStart\.reason === "canceled"\)\s*throw new AgentRunCanceledError\(\)/,
  );
  const outerStop = source.lastIndexOf(
    "claimCancellation.handle(",
    source.indexOf("failureMessage = triggerSignal.aborted"),
  );
  const ordinaryFailure = source.indexOf(
    "failureMessage = triggerSignal.aborted",
    outerStop,
  );
  const expected = source.slice(outerStop, ordinaryFailure);
  expect(expected).toContain('metadata.set("status", "canceled")');
  expect(expected).toContain('writer.write({ type: "abort" })');
  expect(expected).toContain("if (!hasObservedUsage())");
  expect(expected).not.toContain("recordAgentLongFailureForDashboard");
  expect(expected).toContain("return { chatId, assistantMessageId }");
});
it("an error name or message alone never creates expected Stop", () => {
  const cancellation = createWorkerClaimCancellation();
  const writer = { write: jest.fn() };
  const forged = Object.assign(new Error("This agent run was stopped."), {
    name: "AgentRunCanceledError",
  });
  expect(cancellation.handle(forged, writer)).toBe(false);
  expect(cancellation.stopped).toBe(false);
  expect(cancellation.terminalStatus(false, "succeeded")).toBe("succeeded");
  expect(cancellation.terminalStatus(false, "failed")).toBe("failed");
  expect(cancellation.terminalStatus(true, "succeeded")).toBe("canceled");
  expect(writer.write).not.toHaveBeenCalled();
});
it.each(["active", "starting"])(
  "proven %s cancellation carries exact release CAS even before workerClaimId assignment",
  async (phase) => {
    mockMutation.mockResolvedValue({ activated: false });
    mockQuery.mockResolvedValue({
      ...activeClaim,
      phase,
      runId: phase === "starting" ? undefined : run.runId,
      cancelRequestedAt: 1,
    });
    const stop = createWorkerClaimCancellation();
    try {
      await startClaimedAgentRunForWorker({
        ...run,
        startClaimId: run.claimId,
      });
      throw new Error("expected stop");
    } catch (error) {
      expect(stop.handle(error)).toBe(true);
    }
    const expected = {
      ...owner,
      claimId: run.claimId,
      ...(phase === "active" ? { runId: run.runId } : {}),
    };
    expect(stop.releaseBinding).toEqual(expected);
    expect(Object.isFrozen(stop.releaseBinding)).toBe(true);
    await releaseAgentRunClaim(stop.releaseBinding!);
    const args = mockMutation.mock.calls.at(-1)![1];
    expect(args).toEqual({
      ...expected,
      serviceKey: process.env.CONVEX_SERVICE_ROLE_KEY,
    });
    if (phase === "starting") expect(args).not.toHaveProperty("runId");
  },
);
it.each([
  { phase: "released", runId: undefined, cancelRequestedAt: undefined },
  {
    phase: "starting",
    runId: undefined,
    cancelRequestedAt: 1,
    claimId: "replacement",
  },
])(
  "does not fabricate queued Stop or release authority from %j",
  async (patch) => {
    mockMutation.mockResolvedValue({ activated: false });
    mockQuery.mockResolvedValue({ ...activeClaim, ...patch });
    const stop = createWorkerClaimCancellation();
    try {
      await startClaimedAgentRunForWorker({
        ...run,
        startClaimId: run.claimId,
      });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentRunClaimLostError);
      expect(stop.handle(error)).toBe(false);
    }
    expect(stop.releaseBinding).toBeUndefined();
    expect(mockMutation.mock.calls.some(([name]) => name === "release")).toBe(
      false,
    );
  },
);
it("legacy inferred starting claims do not acquire private payload cancellation authority", async () => {
  mockQuery.mockResolvedValue({
    ...activeClaim,
    claimId: "legacy_run",
    phase: "starting",
    runId: undefined,
    cancelRequestedAt: 1,
  });
  mockMutation.mockResolvedValue({ activated: false });
  await expect(startClaimedAgentRunForWorker(run)).rejects.toBeInstanceOf(
    AgentRunClaimLostError,
  );
});
it("a private queued marker remains expected Stop after exact startup release preserves it", async () => {
  mockMutation.mockResolvedValue({ activated: false });
  mockQuery.mockResolvedValue({
    ...activeClaim,
    phase: "released",
    runId: undefined,
    cancelRequestedAt: 1,
  });
  const stop = createWorkerClaimCancellation();
  try {
    await startClaimedAgentRunForWorker({ ...run, startClaimId: run.claimId });
  } catch (error) {
    expect(stop.handle(error)).toBe(true);
  }
  expect(stop.releaseBinding).toEqual({ ...owner, claimId: run.claimId });
});

it("captures predecessor before liveness awaits and never rebases a rejected request", async () => {
  const observed = { ...activeClaim };
  mockQuery.mockResolvedValue(observed);
  mockIsRunActive.mockImplementation(async () => {
    // A changed external observation must not become authority for this start.
    observed.claimId = "replacement";
    return false;
  });
  mockMutation.mockResolvedValue({ acquired: false, claimId: "replacement" });
  await expect(acquireAgentRunStart(owner)).rejects.toBeInstanceOf(
    AgentRunBusyError,
  );
  expect(mockMutation).toHaveBeenCalledTimes(1);
  expect(mockMutation.mock.calls[0][0]).toBe("reserveObserved");
  expect(mockMutation.mock.calls[0][1]).toMatchObject({
    previousClaimId: "claim",
  });
  expect(mockQuery).toHaveBeenCalledTimes(1);
});

it("new route admission binds the explicit null predecessor", async () => {
  await acquireAgentRunStart(owner);
  expect(mockMutation.mock.calls[0][1]).toMatchObject({
    previousClaimId: null,
  });
});

it("legacy worker's initial reservation binds null and never falls back after conflict", async () => {
  mockMutation.mockResolvedValue({ acquired: false });
  await expect(
    startClaimedAgentRun({ ...owner, runId: "scheduled" }),
  ).rejects.toBeInstanceOf(AgentRunClaimLostError);
  expect(mockMutation).toHaveBeenCalledTimes(1);
  expect(mockMutation.mock.calls[0]).toEqual([
    "reserveObserved",
    expect.objectContaining({
      claimId: "legacy_scheduled",
      previousClaimId: null,
    }),
  ]);
});

it("retains the atomic cleanup acknowledgment from worker activation", async () => {
  mockMutation.mockResolvedValue({
    activated: true,
    chat: { id: "chat", user_id: "owner", active_trigger_run_id: "run" },
    remoteCleanupRequired: true,
  });
  const result = await startClaimedAgentRunForWorker({
    ...owner,
    runId: "run",
    startClaimId: "claim",
  });
  expect(result.remoteCleanupRequired).toBe(true);
  expect(mockMutation).toHaveBeenCalledWith(
    "activateForWorker",
    expect.objectContaining({ requireRemoteCleanup: true }),
  );
});
