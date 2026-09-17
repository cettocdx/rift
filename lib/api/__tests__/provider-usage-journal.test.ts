/** @jest-environment node */
import { persistProviderUsage } from "../provider-usage-journal";
const mutation = jest.fn();
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: () => ({ mutation }),
  getConvexServiceKey: () => "service",
}));
jest.mock("@/convex/_generated/api", () => ({
  api: { usageLogs: { recordProviderReceipt: "append" } },
}));
beforeEach(() => mutation.mockReset());
it("replays exactly the same evidence and receipt ID after an acknowledgment is lost", async () => {
  mutation
    .mockRejectedValueOnce(new Error("lost acknowledgment"))
    .mockResolvedValueOnce(true);
  await persistProviderUsage({
    userId: "owner",
    runId: "run",
    model: "model",
    usage: {
      inputTokens: 12,
      outputTokens: 2,
      totalTokens: 14,
      raw: { cost: 0 },
    },
  });
  expect(mutation).toHaveBeenCalledTimes(2);
  expect(mutation.mock.calls[0]).toEqual(mutation.mock.calls[1]);
  expect(mutation.mock.calls[0][1]).toMatchObject({
    usage: {
      input_tokens: 12,
      output_tokens: 2,
      total_tokens: 14,
      cost_dollars: 0,
    },
  });
});
it("does not claim storage succeeded without an acknowledgment", async () => {
  mutation.mockResolvedValue(undefined);
  await expect(
    persistProviderUsage({
      userId: "owner",
      runId: "run",
      model: "model",
      usage: {
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
      },
    }),
  ).rejects.toThrow();
  expect(mutation).toHaveBeenCalledTimes(3);
});

it("uses the same key when a timed-out write may still commit", async () => {
  jest.useFakeTimers();
  try {
    mutation
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce(true);
    const pending = persistProviderUsage({
      userId: "owner",
      runId: "run",
      model: "model",
      usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
    });
    await jest.advanceTimersByTimeAsync(3000);
    await pending;
    expect(mutation).toHaveBeenCalledTimes(2);
    expect(mutation.mock.calls[0]).toEqual(mutation.mock.calls[1]);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});
