/** @jest-environment node */
import { getFunctionName } from "convex/server";
import { AccountCreditLifecycle } from "../account-credit-lifecycle";
jest.mock("server-only", () => ({}), { virtual: true });
const mockMutation = jest.fn();
jest.mock("@/lib/db/convex-client", () => ({
  ...jest.requireActual<typeof import("@/lib/db/convex-client")>(
    "@/lib/db/convex-client",
  ),
  getConvexClient: () => ({ mutation: mockMutation }),
}));
const setup = {
  userId: "owner",
  subscription: "pro" as const,
  amountPoints: 100,
  allowAutoReload: false as const,
};
const reserved = {
  state: "reserved",
  receipt: {
    success: true,
    includedPointsDeducted: 100,
    purchasedPointsDeducted: 0,
    includedRemainingPoints: 400,
    includedTotalPoints: 500,
  },
};
const name = (ref: any) => getFunctionName(ref).split(":")[1];
const saved = process.env.CONVEX_SERVICE_ROLE_KEY;
beforeEach(() => {
  process.env.CONVEX_SERVICE_ROLE_KEY = "production-client-test";
  mockMutation.mockReset();
});
afterEach(() => {
  if (saved === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
  else process.env.CONVEX_SERVICE_ROLE_KEY = saved;
});
function create() {
  return AccountCreditLifecycle.forProductionConsole(setup);
}
it("binds production identity to its server UUID and selects stronger reserve/admit only", async () => {
  const lifecycle = create();
  mockMutation
    .mockResolvedValueOnce(reserved)
    .mockResolvedValueOnce({ state: "in_use", newlyGranted: true });
  await lifecycle.reserve();
  expect(await lifecycle.startUse()).toEqual({ newlyGranted: true });
  expect(mockMutation.mock.calls.map(([ref]) => name(ref))).toEqual([
    "reserveProductionAccountCredits",
    "admitProductionAccountCreditUse",
  ]);
  for (const [, args] of mockMutation.mock.calls)
    expect(args).toMatchObject({
      userId: "owner",
      subscription: "pro",
      amountPoints: 100,
      binding: {
        version: 1,
        kind: "console_model",
        requestId: lifecycle.operationId,
      },
      reservationKey: `credit:console:${lifecycle.operationId}:preflight`,
    });
  expect(mockMutation.mock.calls[0][1]).toEqual(mockMutation.mock.calls[1][1]);
  expect(Object.isFrozen(mockMutation.mock.calls[0][1].binding)).toBe(true);
});
it("keeps low-level console factory behavior unchanged", async () => {
  const lifecycle = AccountCreditLifecycle.forConsole(setup);
  mockMutation
    .mockResolvedValueOnce(reserved)
    .mockResolvedValueOnce({ state: "in_use", newlyGranted: true });
  await lifecycle.reserve();
  await lifecycle.startUse();
  expect(mockMutation.mock.calls.map(([ref]) => name(ref))).toEqual([
    "reserveAccountCredits",
    "startAccountCreditReservationUse",
  ]);
  expect(mockMutation.mock.calls[0][1]).not.toHaveProperty("binding");
});
it("retries an uncertain reservation with exactly the same production binding and no weak fallback", async () => {
  const lifecycle = create();
  mockMutation
    .mockRejectedValueOnce(new Error("lost"))
    .mockResolvedValueOnce(reserved);
  await lifecycle.reserve();
  expect(mockMutation).toHaveBeenCalledTimes(2);
  expect(mockMutation.mock.calls[0]).toEqual(mockMutation.mock.calls[1]);
  expect(name(mockMutation.mock.calls[1][0])).toBe(
    "reserveProductionAccountCredits",
  );
});
it("lost first-use response is never retried or downgraded to the weak API", async () => {
  const lifecycle = create();
  mockMutation
    .mockResolvedValueOnce(reserved)
    .mockRejectedValueOnce(new Error("lost"));
  await lifecycle.reserve();
  await expect(lifecycle.startUse()).rejects.toThrow();
  expect(await lifecycle.closeBeforeUse()).toEqual({ state: "unresolved" });
  expect(mockMutation.mock.calls.map(([ref]) => name(ref))).toEqual([
    "reserveProductionAccountCredits",
    "admitProductionAccountCreditUse",
  ]);
});
it("known admission denial positively confirms closed cleanup without another refund", async () => {
  const lifecycle = create();
  mockMutation.mockResolvedValueOnce(reserved).mockResolvedValueOnce({
    state: "closed",
    newlyGranted: false,
    denialReason: "outstanding_debt",
    refund: "confirmed",
  });
  await lifecycle.reserve();
  await expect(lifecycle.startUse()).rejects.toThrow();
  expect(await lifecycle.closeBeforeUse()).toEqual({ state: "closed" });
  expect(mockMutation).toHaveBeenCalledTimes(2);
});
it("close retains the original keyed API without production-admission assertions", async () => {
  const lifecycle = create();
  mockMutation.mockResolvedValueOnce({ state: "closed" });
  expect(await lifecycle.closeBeforeUse()).toEqual({ state: "closed" });
  expect(name(mockMutation.mock.calls[0][0])).toBe(
    "closeAccountCreditReservation",
  );
  expect(mockMutation.mock.calls[0][1]).not.toHaveProperty("binding");
});
it.each(["binding", "requestId", "operationId", "reservationKey"])(
  "does not accept externally supplied %s identity",
  (field) => {
    expect(() =>
      AccountCreditLifecycle.forProductionConsole({
        ...setup,
        [field]: "client",
      } as any),
    ).toThrow();
    expect(mockMutation).not.toHaveBeenCalled();
  },
);
it("missing production endpoint fails closed without falling back", async () => {
  const lifecycle = create();
  mockMutation.mockRejectedValue(new Error("function not deployed"));
  await expect(lifecycle.reserve()).rejects.toThrow();
  expect(mockMutation.mock.calls.map(([ref]) => name(ref))).toEqual([
    "reserveProductionAccountCredits",
    "reserveProductionAccountCredits",
  ]);
});

it("terminal settlement keeps the original immutable keyed API", async () => {
  const lifecycle = create();
  mockMutation
    .mockResolvedValueOnce(reserved)
    .mockResolvedValueOnce({ state: "in_use", newlyGranted: true })
    .mockResolvedValueOnce({
      state: "reconciliation_required",
      reason: "unknown_usage",
    });
  await lifecycle.reserve();
  await lifecycle.startUse();
  await lifecycle.settle(
    lifecycle.captureTerminalUsage({
      status: "unknown",
      reason: "interrupted",
    }),
  );
  expect(name(mockMutation.mock.calls[2][0])).toBe(
    "settleAccountCreditReservation",
  );
  expect(mockMutation.mock.calls[2][1]).not.toHaveProperty("binding");
  expect(mockMutation.mock.calls[2][1].reservationKey).toBe(
    mockMutation.mock.calls[0][1].reservationKey,
  );
});
it("a confirmed closed response wins over cancellation racing admission", async () => {
  const lifecycle = create();
  let release!: (value: unknown) => void;
  mockMutation.mockResolvedValueOnce(reserved).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await lifecycle.reserve();
  const admission = lifecycle.startUse();
  expect(await lifecycle.closeBeforeUse()).toEqual({ state: "unresolved" });
  release({ state: "closed", newlyGranted: false, refund: "confirmed" });
  await expect(admission).rejects.toThrow();
  expect(await lifecycle.closeBeforeUse()).toEqual({ state: "closed" });
  expect(mockMutation).toHaveBeenCalledTimes(2);
});
