import { getFunctionName } from "convex/server";
import { deductFromPlanCredits } from "../extra-usage";
const mockMutation = jest.fn();
const mockAction = jest.fn();
jest.mock("@/lib/db/convex-client", () => ({
  ...jest.requireActual<typeof import("@/lib/db/convex-client")>(
    "@/lib/db/convex-client",
  ),
  getConvexClient: () => ({ mutation: mockMutation, action: mockAction }),
}));
const result = {
  success: true,
  newBalanceDollars: 2,
  insufficientFunds: false,
  monthlyCapExceeded: false,
  autoReloadTriggered: false,
  includedPointsDeducted: 90,
  purchasedPointsDeducted: 10,
  includedTotalPoints: 500_000,
  includedRemainingPoints: 499_910,
  includedResetAt: "2026-10-01",
  debtPoints: 0,
};
beforeEach(() => {
  mockMutation.mockReset().mockResolvedValue(result);
  mockAction.mockReset().mockResolvedValue(result);
});
it.each([undefined, false])(
  "uses only one mutation when auto-reload permission is %s",
  async (allowAutoReload) => {
    expect(
      await deductFromPlanCredits("owner", "pro", 100, { allowAutoReload }),
    ).toEqual(result);
    expect(mockMutation).toHaveBeenCalledTimes(1);
    expect(mockAction).not.toHaveBeenCalled();
    expect(getFunctionName(mockMutation.mock.calls[0][0])).toBe(
      "extraUsage:deductPlanCreditsWithoutAutoReload",
    );
    expect(mockMutation.mock.calls[0][1]).toEqual({
      serviceKey: process.env.CONVEX_SERVICE_ROLE_KEY,
      userId: "owner",
      subscription: "pro",
      amountPoints: 100,
      allowDebt: undefined,
    });
  },
);
it("keeps the existing auto-reload action and its complete argument contract", async () => {
  expect(
    await deductFromPlanCredits("owner", "ultra", 100, {
      allowAutoReload: true,
      allowDebt: true,
    }),
  ).toEqual(result);
  expect(mockAction).toHaveBeenCalledTimes(1);
  expect(mockMutation).not.toHaveBeenCalled();
  expect(getFunctionName(mockAction.mock.calls[0][0])).toBe(
    "extraUsageActions:deductWithAutoReload",
  );
  expect(mockAction.mock.calls[0][1]).toEqual({
    serviceKey: process.env.CONVEX_SERVICE_ROLE_KEY,
    userId: "owner",
    subscription: "ultra",
    amountPoints: 100,
    allowAutoReload: true,
    allowDebt: true,
  });
});
it("returns declined debit results without a second mutation or fallback purchase", async () => {
  const denied = {
    ...result,
    success: false,
    insufficientFunds: true,
    includedPointsDeducted: 0,
    purchasedPointsDeducted: 0,
  };
  mockMutation.mockResolvedValueOnce(denied);
  expect(await deductFromPlanCredits("owner", "pro", 100)).toEqual(denied);
  expect(mockMutation).toHaveBeenCalledTimes(1);
  expect(mockAction).not.toHaveBeenCalled();
});
it("propagates a lost debit response without retry or action fallback", async () => {
  const error = new Error("response lost after server commit");
  let committed = 0;
  mockMutation.mockImplementation(async () => {
    committed++;
    throw error;
  });
  await expect(deductFromPlanCredits("owner", "pro", 100)).rejects.toBe(error);
  expect(committed).toBe(1);
  expect(mockAction).not.toHaveBeenCalled();
});
it("fails closed if the new backend function has not been deployed", async () => {
  const error = new Error("Could not find public function");
  mockMutation.mockRejectedValueOnce(error);
  await expect(deductFromPlanCredits("owner", "pro", 100)).rejects.toBe(error);
  expect(mockMutation).toHaveBeenCalledTimes(1);
  expect(mockAction).not.toHaveBeenCalled();
});
