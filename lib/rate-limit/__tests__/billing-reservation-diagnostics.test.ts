import { getFunctionName } from "convex/server";
import { checkRateLimit } from "../index";
import type { BillingReservationEvent } from "../reservation-diagnostics";

jest.mock("server-only", () => ({}), { virtual: true });
const mockMigrate = jest.fn();
const mockAction = jest.fn();
const mockMutation = jest.fn();
jest.mock("@/lib/billing/paid-ledger-migration", () => ({
  migratePaidPlanLedger: (...args: unknown[]) => mockMigrate(...args),
}));
jest.mock("@/lib/db/convex-client", () => ({
  ...jest.requireActual<typeof import("@/lib/db/convex-client")>(
    "@/lib/db/convex-client",
  ),
  getConvexClient: () => ({ action: mockAction, mutation: mockMutation }),
}));

const debit = {
  success: true,
  insufficientFunds: false,
  monthlyCapExceeded: false,
  newBalanceDollars: 5,
  includedPointsDeducted: 10,
  purchasedPointsDeducted: 0,
  includedTotalPoints: 100,
  includedRemainingPoints: 90,
  includedResetAt: "2026-10-01T00:00:00.000Z",
  debtPoints: 0,
  autoReloadTriggered: false,
};
const snapshot = { userId: "private-user", state: null };
const run = (
  observer?: (event: BillingReservationEvent) => void,
  enabled = false,
) =>
  checkRateLimit(
    "private-user",
    "agent",
    "pro",
    100,
    { enabled: true, hasBalance: true, autoReloadEnabled: enabled },
    "build-balanced",
    undefined,
    snapshot,
    observer,
  );

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(0);
  mockMigrate.mockReset().mockResolvedValue(undefined);
  mockAction.mockReset().mockResolvedValue(debit);
  mockMutation.mockReset().mockResolvedValue(debit);
});
afterEach(() => jest.useRealTimers());

it.each([false, true])(
  "times the actual ordered migration and debit chain (auto reload=%s)",
  async (allowed) => {
    const selectedTransport = allowed ? mockAction : mockMutation;
    const otherTransport = allowed ? mockMutation : mockAction;
    let finishMigration!: () => void;
    let finishDebit!: (value: typeof debit) => void;
    mockMigrate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishMigration = resolve;
        }),
    );
    selectedTransport.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishDebit = resolve;
        }),
    );
    const events: BillingReservationEvent[] = [];
    const pending = run((event) => events.push(event), allowed);
    expect(mockMigrate).toHaveBeenCalledWith("private-user", "pro", snapshot);
    expect(mockAction).not.toHaveBeenCalled();
    expect(mockMutation).not.toHaveBeenCalled();
    jest.setSystemTime(37);
    finishMigration();
    await jest.advanceTimersByTimeAsync(0);
    expect(selectedTransport).toHaveBeenCalledTimes(1);
    expect(otherTransport).not.toHaveBeenCalled();
    expect(getFunctionName(selectedTransport.mock.calls[0][0])).toBe(
      allowed
        ? "extraUsageActions:deductWithAutoReload"
        : "extraUsage:deductPlanCreditsWithoutAutoReload",
    );
    expect(selectedTransport.mock.calls[0][1]).toMatchObject({
      userId: "private-user",
      subscription: "pro",
      ...(allowed ? { allowAutoReload: true } : {}),
    });
    if (!allowed)
      expect(selectedTransport.mock.calls[0][1]).not.toHaveProperty(
        "allowAutoReload",
      );
    jest.setSystemTime(120);
    finishDebit(debit);
    const result = await pending;
    expect(result).toMatchObject({
      servedFrom: "account",
      pointsDeducted: 10,
      remaining: 90,
    });
    expect(events).toEqual([
      { type: "stage", stage: "billingMigration", durationMs: 37 },
      {
        type: "strategy",
        strategy: "account_credits",
        autoReloadAllowed: allowed,
      },
      { type: "stage", stage: "billingAccountDebit", durationMs: 83 },
    ]);
    expect(JSON.stringify(events)).not.toContain("private-user");
  },
);

it("reports failed migration without beginning a debit", async () => {
  const fail = new Error("migration unavailable");
  mockMigrate.mockImplementation(async () => {
    jest.setSystemTime(25);
    throw fail;
  });
  const events: BillingReservationEvent[] = [];
  await expect(run((event) => events.push(event))).rejects.toMatchObject({
    cause: expect.stringContaining("Credit ledger unavailable"),
  });
  expect(mockMutation).not.toHaveBeenCalled();
  expect(mockAction).not.toHaveBeenCalled();
  expect(events.at(-1)).toEqual({
    type: "stage",
    stage: "billingMigration",
    durationMs: 25,
  });
});

it("reports a rejected debit once without retrying or masking its failure", async () => {
  mockMutation.mockImplementation(async () => {
    jest.setSystemTime(41);
    throw new Error("transport lost");
  });
  const events: BillingReservationEvent[] = [];
  await expect(run((event) => events.push(event))).rejects.toThrow();
  expect(mockMutation).toHaveBeenCalledTimes(1);
  expect(mockAction).not.toHaveBeenCalled();
  expect(events.at(-1)).toEqual({
    type: "stage",
    stage: "billingAccountDebit",
    durationMs: 41,
  });
});

it("observer errors cannot turn a successful charge into a setup failure", async () => {
  const expected = await run();
  const actual = await run(() => {
    throw new Error("telemetry unavailable");
  });
  expect({ ...actual, creditRefundKey: undefined }).toEqual({
    ...expected,
    creditRefundKey: undefined,
  });
  expect(mockMutation).toHaveBeenCalledTimes(2);
  expect(mockAction).not.toHaveBeenCalled();
});

it("observer errors cannot replace the original debit failure", async () => {
  mockMutation.mockRejectedValue(new Error("ledger unavailable"));
  await expect(
    run(() => {
      throw new Error("observer failure");
    }),
  ).rejects.toMatchObject({
    cause: "Credit ledger unavailable: ledger unavailable",
  });
  expect(mockMutation).toHaveBeenCalledTimes(1);
  expect(mockAction).not.toHaveBeenCalled();
});

it("reads debit options after migration completes, matching uninstrumented ordering", async () => {
  const config = { enabled: true, hasBalance: true, autoReloadEnabled: false };
  let finish!: () => void;
  mockMigrate.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const events: BillingReservationEvent[] = [];
  const pending = checkRateLimit(
    "private-user",
    "agent",
    "pro",
    100,
    config,
    undefined,
    undefined,
    snapshot,
    (event) => events.push(event),
  );
  config.autoReloadEnabled = true;
  finish();
  await pending;
  expect(mockAction.mock.calls[0][1].allowAutoReload).toBe(true);
  expect(mockAction).toHaveBeenCalledTimes(1);
  expect(mockMutation).not.toHaveBeenCalled();
  expect(events).toContainEqual({
    type: "strategy",
    strategy: "account_credits",
    autoReloadAllowed: true,
  });
});

it("a rejecting asynchronous sink cannot mask a completed debit", async () => {
  await expect(
    run(async () => {
      throw new Error("async sink failed");
    }),
  ).resolves.toMatchObject({ servedFrom: "account" });
  await Promise.resolve();
  expect(mockMutation).toHaveBeenCalledTimes(1);
  expect(mockAction).not.toHaveBeenCalled();
});
