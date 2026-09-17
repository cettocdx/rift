/** @jest-environment node */
const mockQuery = jest.fn();
const mockMutation = jest.fn();
const mockRetrieve = jest.fn();
const mockCancel = jest.fn();
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: () => ({ query: mockQuery, mutation: mockMutation }),
  getConvexServiceKey: () => "service",
}));
jest.mock("@trigger.dev/sdk", () => ({
  runs: { retrieve: (...args: unknown[]) => mockRetrieve(...args) },
}));
jest.mock("../agent-long-runs", () => ({
  ACTIVE_RUN_STATUSES: ["EXECUTING", "QUEUED"],
  TERMINAL_RUN_STATUSES: new Set([
    "COMPLETED",
    "CANCELED",
    "FAILED",
    "CRASHED",
    "EXPIRED",
    "TIMED_OUT",
    "SYSTEM_FAILURE",
  ]),
  cancelRunAndConfirm: (...args: unknown[]) => mockCancel(...args),
}));
import { getFunctionName } from "convex/server";
import {
  beginAgentDispatch,
  refreshAgentDispatchTerminal,
  lookupAgentDispatch,
  markAgentDispatching,
  recordAgentDispatchAccepted,
} from "../agent-dispatch-admission";
const input = {
  userId: "owner",
  chatId: "chat",
  dispatchId: "dispatch",
  requestMessageId: "message",
  payloadHash: "a".repeat(64),
  replaceActiveRun: true,
};
const saved = process.env.RIFT_DURABLE_DISPATCH_ADMISSION;
beforeEach(() => {
  jest.resetAllMocks();
  process.env.RIFT_DURABLE_DISPATCH_ADMISSION = "true";
  mockMutation.mockImplementation(async (ref) => {
    switch (getFunctionName(ref)) {
      case "agentDispatchAdmission:elect":
        return { outcome: "elected", previousRunId: null };
      case "agentDispatchAdmission:attachClaim":
        return { attached: true, claimId: "claim" };
      case "agentDispatchAdmission:authorizeCancellation":
        return { runId: "old" };
      case "agentDispatchAdmission:rejectBeforeDispatch":
        return { rejected: true };
      case "agentDispatchAdmission:markDispatching":
        return { transitioned: true, claimId: "claim" };
      default:
        return {};
    }
  });
});
afterEach(() => {
  if (saved === undefined) delete process.env.RIFT_DURABLE_DISPATCH_ADMISSION;
  else process.env.RIFT_DURABLE_DISPATCH_ADMISSION = saved;
});
const names = () =>
  mockMutation.mock.calls.map(([ref]) => getFunctionName(ref));
it("elects and attaches with fresh server identifiers without remote cancellation for no predecessor", async () => {
  const result = await beginAgentDispatch(input);
  expect(result).toMatchObject({
    kind: "new",
    claimId: "claim",
    dispatchId: "dispatch",
    idempotencyKey: expect.stringMatching(/^agent-dispatch:v1:/),
  });
  expect(mockMutation.mock.calls[0][1]).toMatchObject({
    ...input,
    attemptId: expect.any(String),
    nextClaimId: expect.any(String),
    fingerprintVersion: 1,
    serviceKey: "service",
  });
  expect(names()).toEqual([
    "agentDispatchAdmission:elect",
    "agentDispatchAdmission:attachClaim",
  ]);
  expect(mockRetrieve).not.toHaveBeenCalled();
  expect(mockCancel).not.toHaveBeenCalled();
});
it("duplicate queries receipts and intents without cancellation or attachment", async () => {
  mockMutation.mockResolvedValue({ outcome: "duplicate" });
  mockQuery.mockResolvedValue(null);
  expect(await beginAgentDispatch(input)).toEqual({
    kind: "duplicate",
    receipt: null,
    intent: null,
  });
  expect(mockQuery).toHaveBeenCalledTimes(2);
  expect(mockCancel).not.toHaveBeenCalled();
  expect(names()).toEqual(["agentDispatchAdmission:elect"]);
});
it("carries the trusted Hack cleanup requirement into admission", async () => {
  await beginAgentDispatch({ ...input, requiresCleanup: true });
  expect(mockMutation.mock.calls[0][1]).toMatchObject({
    requiresCleanup: true,
  });
});
it("rejects duplicate lookup whose cleanup capability differs from admission", async () => {
  mockQuery.mockResolvedValue({
    requestMessageId: input.requestMessageId,
    payloadHash: input.payloadHash,
    fingerprintVersion: 1,
  });
  await expect(
    lookupAgentDispatch({ ...input, requiresCleanup: true }),
  ).rejects.toThrow();
});
it("confirms exact predecessor terminality after authorized cancellation before attachment", async () => {
  mockMutation.mockImplementation(
    async (ref) =>
      ({
        "agentDispatchAdmission:elect": {
          outcome: "elected",
          previousRunId: "old",
        },
        "agentDispatchAdmission:authorizeCancellation": { runId: "old" },
        "agentDispatchAdmission:attachClaim": {
          attached: true,
          claimId: "claim",
        },
      })[getFunctionName(ref)],
  );
  mockRetrieve
    .mockResolvedValueOnce({ status: "EXECUTING" })
    .mockResolvedValueOnce({ status: "CANCELED" });
  expect((await beginAgentDispatch(input)).kind).toBe("new");
  expect(names()).toEqual([
    "agentDispatchAdmission:elect",
    "agentDispatchAdmission:authorizeCancellation",
    "agentDispatchAdmission:attachClaim",
  ]);
  expect(mockCancel).toHaveBeenCalledWith("old");
  expect(mockMutation.mock.calls.at(-1)?.[1]).toMatchObject({
    confirmedTerminalRunId: "old",
  });
});
it("active nonreplacement releases only its undispatched election and returns busy", async () => {
  mockMutation.mockImplementation(async (ref) =>
    getFunctionName(ref).endsWith(":elect")
      ? { outcome: "elected", previousRunId: "old" }
      : { rejected: true },
  );
  mockRetrieve.mockResolvedValue({ status: "EXECUTING" });
  expect(
    await beginAgentDispatch({ ...input, replaceActiveRun: false }),
  ).toEqual({ kind: "busy" });
  expect(names()).toEqual([
    "agentDispatchAdmission:elect",
    "agentDispatchAdmission:rejectBeforeDispatch",
  ]);
  expect(mockCancel).not.toHaveBeenCalled();
});
it.each(["EXECUTING", "UNKNOWN"])(
  "uncertain postcancel state %s never attaches or releases election",
  async (status) => {
    mockMutation.mockImplementation(async (ref) =>
      getFunctionName(ref).endsWith(":elect")
        ? { outcome: "elected", previousRunId: "old" }
        : { runId: "old" },
    );
    mockRetrieve
      .mockResolvedValueOnce({ status: "EXECUTING" })
      .mockResolvedValueOnce({ status });
    await expect(beginAgentDispatch(input)).rejects.toThrow();
    expect(names()).toEqual([
      "agentDispatchAdmission:elect",
      "agentDispatchAdmission:authorizeCancellation",
    ]);
  },
);
it("never substitutes an unexpected cancellation target", async () => {
  mockMutation.mockImplementation(async (ref) =>
    getFunctionName(ref).endsWith(":elect")
      ? { outcome: "elected", previousRunId: "old" }
      : { runId: "newer" },
  );
  mockRetrieve.mockResolvedValue({ status: "EXECUTING" });
  await expect(beginAgentDispatch(input)).rejects.toThrow();
  expect(mockCancel).not.toHaveBeenCalled();
});
it("marks and records acceptance using exact elected binding", async () => {
  const handle = {
    kind: "new" as const,
    dispatchId: "dispatch",
    attemptId: "attempt",
    claimId: "claim",
    idempotencyKey: "key",
  };
  expect(await markAgentDispatching(handle, input)).toBe(true);
  await recordAgentDispatchAccepted({ ...input, ...handle }, "run");
  expect(names()).toEqual([
    "agentDispatchAdmission:markDispatching",
    "agentDispatchRequests:recordAccepted",
  ]);
  expect(mockMutation.mock.calls[1][1]).toEqual({
    serviceKey: "service",
    userId: "owner",
    chatId: "chat",
    dispatchId: "dispatch",
    claimId: "claim",
    runId: "run",
  });
});
it("disabled orchestration never contacts Convex or Trigger", async () => {
  delete process.env.RIFT_DURABLE_DISPATCH_ADMISSION;
  await expect(beginAgentDispatch(input)).rejects.toThrow();
  expect(mockMutation).not.toHaveBeenCalled();
});

it("preflight returns null only after both authoritative reads find no request", async () => {
  mockQuery.mockResolvedValue(null);
  expect(await lookupAgentDispatch(input)).toBeNull();
  expect(mockMutation).not.toHaveBeenCalled();
  expect(mockCancel).not.toHaveBeenCalled();
});
it("preflight failure never turns into absent-request permission", async () => {
  mockQuery.mockRejectedValue(new Error("offline"));
  await expect(lookupAgentDispatch(input)).rejects.toThrow("offline");
  expect(mockMutation).not.toHaveBeenCalled();
});
it("preflight rejects changed content for a retained logical request", async () => {
  mockQuery.mockResolvedValue({
    requestMessageId: input.requestMessageId,
    payloadHash: "b".repeat(64),
    fingerprintVersion: 1,
  });
  await expect(lookupAgentDispatch(input)).rejects.toThrow("conflicts");
  expect(mockMutation).not.toHaveBeenCalled();
});
it("failed receipt persistence propagates rather than claiming durable acceptance", async () => {
  mockMutation.mockRejectedValue(new Error("write unavailable"));
  await expect(
    recordAgentDispatchAccepted({ ...input, claimId: "claim" }, "run"),
  ).rejects.toThrow("write unavailable");
});

const acceptedReceipt = {
  dispatchId: "dispatch",
  requestMessageId: "message",
  payloadHash: "a".repeat(64),
  fingerprintVersion: 1 as const,
  claimId: "claim",
  state: "accepted" as const,
  runId: "original",
  createdAt: 1,
};
it.each([
  "COMPLETED",
  "CANCELED",
  "FAILED",
  "CRASHED",
  "SYSTEM_FAILURE",
  "EXPIRED",
  "TIMED_OUT",
])(
  "records authoritative terminal status %s for the original receipt",
  async (status) => {
    mockRetrieve.mockResolvedValue({ status });
    mockMutation.mockResolvedValue({
      ...acceptedReceipt,
      state: "terminal",
      terminalStatus: status,
    });
    const result = await refreshAgentDispatchTerminal(input, acceptedReceipt);
    expect(result.reconciliation).toBe("terminal");
    expect(mockRetrieve).toHaveBeenCalledWith("original");
    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "owner",
        chatId: "chat",
        dispatchId: "dispatch",
        claimId: "claim",
        runId: "original",
        terminalStatus: status,
      }),
    );
  },
);
it.each(["EXECUTING", "QUEUED", "UNKNOWN"])(
  "does not record terminality for %s",
  async (status) => {
    mockRetrieve.mockResolvedValue({ status });
    const result = await refreshAgentDispatchTerminal(input, acceptedReceipt);
    expect(result.receipt).toEqual(acceptedReceipt);
    expect(mockMutation).not.toHaveBeenCalled();
    expect(result.reconciliation).toBe(
      status === "UNKNOWN" ? "unavailable" : "active",
    );
  },
);
it.each([new Error("offline"), { status: 404 }])(
  "failed/missing retrieval preserves acceptance with explicit unavailable freshness",
  async (error) => {
    mockRetrieve.mockRejectedValue(error);
    expect(await refreshAgentDispatchTerminal(input, acceptedReceipt)).toEqual({
      receipt: acceptedReceipt,
      reconciliation: "unavailable",
    });
    expect(mockMutation).not.toHaveBeenCalled();
  },
);
it("cached terminal evidence avoids another provider read", async () => {
  const terminal = {
    ...acceptedReceipt,
    state: "terminal" as const,
    terminalStatus: "COMPLETED" as const,
  };
  expect(await refreshAgentDispatchTerminal(input, terminal)).toEqual({
    receipt: terminal,
    reconciliation: "terminal",
  });
  expect(mockRetrieve).not.toHaveBeenCalled();
});
it("late status evidence after the read deadline cannot mutate the receipt", async () => {
  let finish!: (value: unknown) => void;
  mockRetrieve.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  expect(
    (await refreshAgentDispatchTerminal(input, acceptedReceipt, 5))
      .reconciliation,
  ).toBe("unavailable");
  finish({ status: "COMPLETED" });
  await Promise.resolve();
  await Promise.resolve();
  expect(mockMutation).not.toHaveBeenCalled();
});
it("a failed terminal write is not reported as durable completion", async () => {
  mockRetrieve.mockResolvedValue({ status: "COMPLETED" });
  mockMutation.mockRejectedValue(new Error("write failed"));
  await expect(
    refreshAgentDispatchTerminal(input, acceptedReceipt),
  ).rejects.toThrow("write failed");
});
it("backend ownership denial during refresh propagates", async () => {
  mockRetrieve.mockResolvedValue({ status: "COMPLETED" });
  mockMutation.mockRejectedValue({ data: { code: "FORBIDDEN" } });
  await expect(
    refreshAgentDispatchTerminal(input, acceptedReceipt),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
});

it("reconciles persisted terminal cleanup without another provider lookup", async () => {
  const terminal = {
    ...acceptedReceipt,
    state: "terminal" as const,
    terminalStatus: "CRASHED" as const,
    requiresCleanup: true,
  };
  const reconciled = { ...terminal, cleanupConfirmedAt: 123 };
  mockMutation.mockResolvedValue(reconciled);
  const result = await refreshAgentDispatchTerminal(input, terminal);
  expect(result.receipt).toEqual(reconciled);
  expect(mockRetrieve).not.toHaveBeenCalled();
  expect(mockMutation).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ runId: "original", terminalStatus: "CRASHED" }),
  );
});
