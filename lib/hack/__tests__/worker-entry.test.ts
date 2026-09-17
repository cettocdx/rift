/** @jest-environment node */
jest.mock("server-only", () => ({}));
const mutation = jest.fn();
jest.mock("@/lib/db/convex-client", () => ({
  getConvexServiceKey: () => "test-key",
  getConvexClient: () => ({ mutation }),
}));
jest.mock("../durable-run", () => ({
  assertHackRunPayload: jest.fn(),
  hashHackRunPayload: () => "a".repeat(64),
}));
import { getFunctionName } from "convex/server";
import { withHackWorkerEntry } from "../worker-entry";
const payload = {
  userId: "owner",
  chatId: "chat",
  dispatchId: "dispatch",
  startClaimId: "claim",
};
const calls = () => mutation.mock.calls.map(([ref]) => getFunctionName(ref));
beforeEach(() => {
  mutation.mockReset().mockResolvedValue(true);
});
it.each(["authorization revoked", "setup metadata failed", "already aborted"])(
  "cleans pre-effect failure: %s",
  async (message) => {
    const error = new Error(message);
    await expect(
      withHackWorkerEntry(
        payload,
        "run",
        async () => {
          throw error;
        },
        jest.fn(),
      ),
    ).rejects.toBe(error);
    expect(calls()).toEqual([
      "agentDispatchRequests:enterWorker",
      "agentDispatchRequests:recordPreExecutionCleanup",
    ]);
    expect(mutation.mock.calls[1][1]).toEqual(mutation.mock.calls[0][1]);
  },
);
it("hands off before an ambiguous effects-start response without claiming no effects", async () => {
  mutation
    .mockResolvedValueOnce(true)
    .mockRejectedValueOnce(new Error("response lost"));
  await expect(
    withHackWorkerEntry(
      payload,
      "run",
      async (entry) => {
        entry.handoff();
        await entry.beforeEffects();
      },
      jest.fn(),
    ),
  ).rejects.toThrow("response lost");
  expect(calls()).toEqual([
    "agentDispatchRequests:enterWorker",
    "agentDispatchRequests:markWorkerEffectsStarted",
  ]);
});
it("retains the original failure and reports unconfirmed early cleanup", async () => {
  mutation
    .mockResolvedValueOnce(true)
    .mockRejectedValueOnce(new Error("cleanup unavailable"));
  const original = new Error("revoked");
  const report = jest.fn();
  await expect(
    withHackWorkerEntry(
      payload,
      "run",
      async () => {
        throw original;
      },
      report,
    ),
  ).rejects.toBe(original);
  expect(report).toHaveBeenCalledTimes(1);
});
it("cannot enter execution or release on an unconfirmed entry response", async () => {
  mutation.mockResolvedValueOnce(false);
  const execute = jest.fn();
  await expect(
    withHackWorkerEntry(payload, "run", execute, jest.fn()),
  ).rejects.toThrow("entry not confirmed");
  expect(execute).not.toHaveBeenCalled();
  expect(mutation).toHaveBeenCalledTimes(1);
});
it("generates a fresh invocation nonce rather than accepting one from the payload", async () => {
  for (let i = 0; i < 2; i++)
    await withHackWorkerEntry(
      { ...payload, workerEntryId: "forged" },
      "run",
      async () => {},
      jest.fn(),
    );
  const first = mutation.mock.calls[0][1].workerEntryId;
  const second = mutation.mock.calls[2][1].workerEntryId;
  expect(first).not.toBe("forged");
  expect(second).not.toBe(first);
});
