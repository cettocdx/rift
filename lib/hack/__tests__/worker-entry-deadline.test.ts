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
beforeEach(() => {
  jest.useFakeTimers();
  mutation.mockReset().mockResolvedValue(true);
});
afterEach(() => {
  jest.useRealTimers();
});

it("bounds a lost entry acknowledgment and ignores late permission", async () => {
  let finish!: (value: boolean) => void;
  mutation.mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  const execute = jest.fn();
  let error: unknown;
  const done = withHackWorkerEntry(payload, "run", execute, jest.fn()).catch(
    (e) => {
      error = e;
    },
  );
  await jest.advanceTimersByTimeAsync(10000);
  expect(error).toBeInstanceOf(Error);
  finish(true);
  await done;
  await Promise.resolve();
  expect(execute).not.toHaveBeenCalled();
  expect(mutation).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it("does not start effects or assert cleanup after lost effects acknowledgment", async () => {
  let finish!: (value: boolean) => void;
  mutation.mockResolvedValueOnce(true).mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  const effect = jest.fn();
  let error: unknown;
  const done = withHackWorkerEntry(
    payload,
    "run",
    async (entry) => {
      entry.handoff();
      await entry.beforeEffects();
      effect();
    },
    jest.fn(),
  ).catch((e) => {
    error = e;
  });
  await jest.advanceTimersByTimeAsync(10000);
  expect(error).toBeInstanceOf(Error);
  finish(true);
  await done;
  expect(effect).not.toHaveBeenCalled();
  expect(mutation.mock.calls.map(([ref]) => getFunctionName(ref))).toEqual([
    "agentDispatchRequests:enterWorker",
    "agentDispatchRequests:markWorkerEffectsStarted",
  ]);
  expect(jest.getTimerCount()).toBe(0);
});

it("preserves the setup error when early cleanup hangs", async () => {
  mutation
    .mockResolvedValueOnce(true)
    .mockReturnValueOnce(new Promise(() => {}));
  const original = new Error("Entitlement revoked");
  const report = jest.fn();
  let error: unknown;
  const done = withHackWorkerEntry(
    payload,
    "run",
    async () => {
      throw original;
    },
    report,
  ).catch((e) => {
    error = e;
  });
  await jest.advanceTimersByTimeAsync(10000);
  expect(error).toBe(original);
  await done;
  expect(report).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it("removes successful request timers", async () => {
  await withHackWorkerEntry(
    payload,
    "run",
    async (entry) => {
      entry.handoff();
      await entry.beforeEffects();
    },
    jest.fn(),
  );
  expect(jest.getTimerCount()).toBe(0);
});

it("reports cleanup timeout even when setup returned normally", async () => {
  mutation
    .mockResolvedValueOnce(true)
    .mockReturnValueOnce(new Promise(() => {}));
  const report = jest.fn();
  let error: unknown;
  const done = withHackWorkerEntry(
    payload,
    "run",
    async () => {},
    report,
  ).catch((e) => {
    error = e;
  });
  await jest.advanceTimersByTimeAsync(10000);
  expect(error).toBeInstanceOf(Error);
  await done;
  expect(report).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it("observes a late transport rejection after the entry deadline", async () => {
  let reject!: (error: Error) => void;
  mutation.mockReturnValueOnce(
    new Promise((_, r) => {
      reject = r;
    }),
  );
  const execute = jest.fn();
  const done = withHackWorkerEntry(payload, "run", execute, jest.fn()).catch(
    (e) => e,
  );
  await jest.advanceTimersByTimeAsync(10000);
  expect(await done).toBeInstanceOf(Error);
  reject(new Error("Late transport failure"));
  await jest.advanceTimersByTimeAsync(1);
  expect(execute).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});
