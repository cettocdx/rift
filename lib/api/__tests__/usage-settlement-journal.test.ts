/** @jest-environment node */
import { settleWithJournal } from "../usage-settlement-journal";
const mutation = jest.fn();
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: () => ({ mutation }),
  getConvexServiceKey: () => "service",
}));
jest.mock("@/convex/_generated/api", () => ({
  api: { usageLogs: { beginSettlement: "begin", finishSettlement: "finish" } },
}));
const input = { userId: "owner", runId: "run", evidence: { cost: 1 } };
beforeEach(() => mutation.mockReset());
it("leaves a failed debit unresolved if outcome storage is unavailable", async () => {
  mutation.mockResolvedValueOnce(true).mockRejectedValue(new Error("offline"));
  const error = new Error("debit unknown");
  const debit = jest.fn(async () => {
    throw error;
  });
  await expect(settleWithJournal(input, debit)).rejects.toBe(error);
  expect(debit).toHaveBeenCalledTimes(1);
  expect(
    mutation.mock.calls.slice(1).every((c) => c[1].state === "uncertain"),
  ).toBe(true);
});
it.each([false, undefined])(
  "does not execute a debit without a newly acknowledged intent (%s)",
  async (result) => {
    mutation.mockResolvedValue(result);
    const debit = jest.fn();
    await expect(settleWithJournal(input, debit)).rejects.toThrow();
    expect(debit).not.toHaveBeenCalled();
    expect(mutation).toHaveBeenCalledTimes(1);
  },
);
it("waits for intent before debit and records its acknowledged outcome", async () => {
  let allow!: (v: boolean) => void;
  mutation
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          allow = r;
        }),
    )
    .mockResolvedValue(true);
  const debit = jest.fn(async () => {});
  const pending = settleWithJournal(input, debit);
  expect(debit).not.toHaveBeenCalled();
  allow(true);
  await pending;
  expect(debit).toHaveBeenCalledTimes(1);
  expect(mutation.mock.calls[1][1]).toMatchObject({
    state: "acknowledged",
    attempt_id: mutation.mock.calls[0][1].attempt_id,
  });
});
it("records uncertain debit without replay and preserves the original error", async () => {
  mutation.mockResolvedValue(true);
  const error = new Error("lost acknowledgment");
  const debit = jest.fn(async () => {
    throw error;
  });
  await expect(settleWithJournal(input, debit)).rejects.toBe(error);
  expect(debit).toHaveBeenCalledTimes(1);
  expect(mutation.mock.calls[1][1].state).toBe("uncertain");
});
it("retries only the same outcome receipt, never the debit", async () => {
  mutation
    .mockResolvedValueOnce(true)
    .mockRejectedValueOnce(new Error("lost result"))
    .mockResolvedValueOnce(true);
  const debit = jest.fn(async () => {});
  await settleWithJournal(input, debit);
  expect(debit).toHaveBeenCalledTimes(1);
  expect(mutation.mock.calls[1]).toEqual(mutation.mock.calls[2]);
});
it("does not rewrite an acknowledged debit as uncertain when receipt storage fails", async () => {
  mutation.mockResolvedValueOnce(true).mockRejectedValue(new Error("offline"));
  const debit = jest.fn(async () => {});
  await expect(settleWithJournal(input, debit)).rejects.toThrow();
  expect(debit).toHaveBeenCalledTimes(1);
  expect(
    mutation.mock.calls.slice(1).every((c) => c[1].state === "acknowledged"),
  ).toBe(true);
});
it("a timed-out intent remains non-executable even after late acknowledgment", async () => {
  jest.useFakeTimers();
  try {
    let late!: (v: boolean) => void;
    mutation.mockImplementationOnce(
      () =>
        new Promise((r) => {
          late = r;
        }),
    );
    const debit = jest.fn();
    const result = settleWithJournal(input, debit).catch((e) => e);
    await jest.advanceTimersByTimeAsync(3000);
    expect(await result).toBeInstanceOf(Error);
    late(true);
    await Promise.resolve();
    expect(debit).not.toHaveBeenCalled();
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

it("persists workspace correlation alongside the internal run identity and exact debit units", async () => {
  mutation.mockResolvedValue(true);
  await settleWithJournal(
    {
      ...input,
      evidence: {
        chatId: "chat",
        operationId: "workspace-op",
        subscription: "pro",
        servedFrom: "account",
        pricingMargin: 2.5,
        usage: { costDollars: 0.001 },
      },
    },
    async () => {},
  );
  expect(mutation.mock.calls[0][1]).toMatchObject({
    run_id: "run",
    chat_id: "chat",
    operation_id: "workspace-op",
    actual_points: 25,
  });
});
