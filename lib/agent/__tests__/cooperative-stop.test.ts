import { watchClaimCancellation } from "../cooperative-stop";
import { AgentRunCanceledError } from "../claim-cancellation";
const binding = {
  userId: "user",
  chatId: "chat",
  claimId: "claim",
  runId: "run",
};
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
it("aborts once only for an authoritative matching cancellation marker", async () => {
  const cancel = jest.fn();
  const read = jest
    .fn()
    .mockResolvedValue({ ...binding, cancelRequestedAt: 0 });
  const dispose = watchClaimCancellation({ binding, read, onCancel: cancel });
  await jest.advanceTimersByTimeAsync(3000);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(cancel.mock.calls[0][0]).toBeInstanceOf(AgentRunCanceledError);
  expect(read).toHaveBeenCalledTimes(1);
  dispose();
});
it.each(["userId", "chatId", "claimId", "runId"])(
  "ignores a foreign %s",
  async (key) => {
    const cancel = jest.fn();
    const dispose = watchClaimCancellation({
      binding,
      read: async () => ({ ...binding, [key]: "other", cancelRequestedAt: 1 }),
      onCancel: cancel,
    });
    await jest.advanceTimersByTimeAsync(1100);
    expect(cancel).not.toHaveBeenCalled();
    dispose();
  },
);
it("does not overlap slow reads or abort after disposal", async () => {
  let resolve!: (value: typeof binding & { cancelRequestedAt: number }) => void;
  const read = jest.fn(
    () =>
      new Promise<typeof binding & { cancelRequestedAt: number }>((r) => {
        resolve = r;
      }),
  );
  const cancel = jest.fn();
  const dispose = watchClaimCancellation({ binding, read, onCancel: cancel });
  await jest.advanceTimersByTimeAsync(5000);
  expect(read).toHaveBeenCalledTimes(1);
  dispose();
  resolve({ ...binding, cancelRequestedAt: 1 });
  await jest.advanceTimersByTimeAsync(2000);
  expect(cancel).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalledTimes(1);
});
it("retries read failures without inventing cancellation", async () => {
  const cancel = jest.fn();
  const read = jest
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ ...binding });
  const dispose = watchClaimCancellation({ binding, read, onCancel: cancel });
  await jest.advanceTimersByTimeAsync(2100);
  expect(read).toHaveBeenCalledTimes(2);
  expect(cancel).not.toHaveBeenCalled();
  dispose();
});
