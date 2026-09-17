/** @jest-environment node */
import {
  isRunActive,
  cancelRunAndConfirm,
  cancelClaimedRunAndConfirm,
} from "../agent-long-runs";

const mockRetrieve = jest.fn();
const mockCancel = jest.fn();
const mockFinish = jest.fn();
jest.mock("@trigger.dev/sdk", () => ({
  runs: {
    retrieve: (...args: unknown[]) => mockRetrieve(...args),
    cancel: (...args: unknown[]) => mockCancel(...args),
  },
}));
jest.mock("@/lib/ai/runs/run-recorder", () => ({
  finishRunRecord: (...args: unknown[]) => mockFinish(...args),
}));

describe("isRunActive", () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(["EXECUTING", "QUEUED", "PENDING_VERSION", "WAITING", "DELAYED"])(
    "recognizes %s as live",
    async (status) => {
      mockRetrieve.mockResolvedValue({ status });
      await expect(isRunActive("run-1")).resolves.toBe(true);
    },
  );

  it.each(["COMPLETED", "FAILED", "CANCELED", "TIMED_OUT"])(
    "recognizes terminal %s as inactive",
    async (status) => {
      mockRetrieve.mockResolvedValue({ status });
      await expect(isRunActive("run-1")).resolves.toBe(false);
    },
  );

  it("does not authorize a replacement when the provider cannot find the run", async () => {
    const error = Object.assign(new Error("Not found"), { status: 404 });
    mockRetrieve.mockRejectedValue(error);
    await expect(isRunActive("run-1")).rejects.toBe(error);
  });

  it.each([
    new Error("Network unavailable"),
    Object.assign(new Error("Service unavailable"), { status: 503 }),
  ])("preserves uncertainty on an unavailable provider", async (error) => {
    mockRetrieve.mockRejectedValue(error);
    await expect(isRunActive("run-1")).rejects.toBe(error);
  });

  it("does not treat an unknown provider status as permission to start another run", async () => {
    mockRetrieve.mockResolvedValue({ status: "UNKNOWN_NEW_STATE" });
    await expect(isRunActive("run-1")).rejects.toThrow("status");
  });
});

describe("confirmed Stop", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
    mockCancel.mockResolvedValue({ id: "run-1" });
    mockRetrieve.mockResolvedValue({ status: "CANCELED" });
    mockFinish.mockResolvedValue(undefined);
  });
  afterEach(() => jest.useRealTimers());

  it("waits after accepted cancellation until the same run is terminal", async () => {
    mockRetrieve.mockResolvedValueOnce({ status: "EXECUTING" });
    const result = cancelRunAndConfirm("run-1");
    await jest.advanceTimersByTimeAsync(100);
    expect(mockFinish).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(500);
    await result;
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockRetrieve.mock.calls.every(([id]) => id === "run-1")).toBe(true);
    expect(mockFinish).toHaveBeenCalledWith({
      runId: "run-1",
      status: "cancelled",
      stopReason: "user",
    });
  });

  it.each([undefined, new Error("cancel unavailable")])(
    "keeps Stop unconfirmed on 404 (cancel error=%s)",
    async (cancelError) => {
      if (cancelError) mockCancel.mockRejectedValue(cancelError);
      mockRetrieve.mockRejectedValue(
        Object.assign(new Error("not found"), { status: 404 }),
      );
      await expect(cancelRunAndConfirm("run-1")).rejects.toThrow();
      expect(mockFinish).not.toHaveBeenCalled();
    },
  );

  it("bounds an accepted cancellation whose run remains executing", async () => {
    mockRetrieve.mockResolvedValue({ status: "EXECUTING" });
    const result = expect(cancelRunAndConfirm("run-1")).rejects.toThrow();
    await jest.advanceTimersByTimeAsync(10_000);
    await result;
    expect(mockFinish).not.toHaveBeenCalled();
    expect(mockCancel).toHaveBeenCalledTimes(1);
  });

  it("bounds a stalled provider read without writing cancellation", async () => {
    mockRetrieve.mockImplementation(() => new Promise(() => {}));
    const result = expect(cancelRunAndConfirm("run-1")).rejects.toThrow();
    await jest.advanceTimersByTimeAsync(10_000);
    await result;
    expect(mockFinish).not.toHaveBeenCalled();
  });

  it.each(["COMPLETED", "FAILED"])(
    "preserves a racing %s outcome",
    async (status) => {
      mockRetrieve.mockResolvedValue({ status });
      await cancelRunAndConfirm("run-1");
      expect(mockFinish).not.toHaveBeenCalled();
    },
  );

  it("does not force cancel an already completed cooperative run", async () => {
    mockRetrieve.mockResolvedValue({
      status: "COMPLETED",
      metadata: { cooperativeStopReady: true },
    });
    await cancelClaimedRunAndConfirm("run-1");
    expect(mockCancel).not.toHaveBeenCalled();
    expect(mockFinish).not.toHaveBeenCalled();
  });
});
