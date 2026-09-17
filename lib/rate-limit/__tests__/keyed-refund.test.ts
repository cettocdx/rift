jest.mock("../token-bucket", () => ({ refundUsage: jest.fn() }));
jest.mock("@/lib/extra-usage", () => ({ refundFreeAgentRun: jest.fn() }));

import { UsageRefundTracker } from "../refund";
import { refundUsage } from "../token-bucket";
import { refundFreeAgentRun } from "@/lib/extra-usage";

function fixture(phase = "reserve_unknown") {
  const state = {
    userId: "owner",
    subscription: "pro" as const,
    phase,
    reservationAttempted: true,
    reservationKey: "credit:chat:server-id:preflight",
  };
  const closeBeforeUse = jest.fn(
    async (): Promise<{ state: "closed" | "unresolved" }> => ({
      state: "closed",
    }),
  );
  const handle = { inspect: () => ({ ...state }), closeBeforeUse };
  const tracker = new UsageRefundTracker();
  tracker.setUser("owner", "pro");
  tracker.trackKeyedReservation(handle);
  return { tracker, handle, state, closeBeforeUse };
}

beforeEach(() => jest.clearAllMocks());
afterEach(() => {
  expect(refundUsage).not.toHaveBeenCalled();
  expect(refundFreeAgentRun).not.toHaveBeenCalled();
});

it("tracks an uncertain committed reserve even with no delivered deduction receipt", async () => {
  const { tracker, closeBeforeUse } = fixture();
  expect(tracker.hasDeductions()).toBe(true);
  expect(await tracker.refund()).toBe(true);
  expect(closeBeforeUse).toHaveBeenCalledTimes(1);
  expect(await tracker.refund()).toBe(true);
  expect(closeBeforeUse).toHaveBeenCalledTimes(1);
});

it("does not declare restoration after a lost close response and permits keyed recovery", async () => {
  const { tracker, closeBeforeUse } = fixture();
  closeBeforeUse.mockRejectedValueOnce(new Error("lost close receipt"));
  expect(await tracker.refund()).toBe(false);
  expect(await tracker.refund()).toBe(true);
  expect(closeBeforeUse).toHaveBeenCalledTimes(2);
});

it("reports unresolved first use instead of invoking a legacy refund", async () => {
  const { tracker, closeBeforeUse } = fixture("use_unknown");
  closeBeforeUse.mockResolvedValue({ state: "unresolved" });
  expect(await tracker.refund()).toBe(false);
  expect(await tracker.refund()).toBe(false);
});

it("tombstones an attached reservation even before its asynchronous reserve starts", async () => {
  const { tracker, state, closeBeforeUse } = fixture("ready");
  state.reservationAttempted = false;
  expect(tracker.hasDeductions()).toBe(false);
  expect(await tracker.refund()).toBe(true);
  expect(closeBeforeUse).toHaveBeenCalledTimes(1);
});

it("leaves an acknowledged terminal charge settled rather than refunding it", async () => {
  const { tracker, closeBeforeUse } = fixture("settled");
  expect(await tracker.refund()).toBe(true);
  expect(closeBeforeUse).not.toHaveBeenCalled();
});

it("accepts keyed receipt metadata without enabling old arithmetic", async () => {
  const { tracker, closeBeforeUse } = fixture("reserved");
  tracker.recordDeductions({
    remaining: 0,
    resetTime: new Date(),
    limit: 1000,
    servedFrom: "account",
    pointsDeducted: 50,
    extraUsagePointsDeducted: 1200,
  });
  expect(await tracker.refund()).toBe(true);
  expect(closeBeforeUse).toHaveBeenCalledTimes(1);
});

it("rejects legacy receipts, free claims, changed owners and replacement handles once keyed", () => {
  const { tracker, handle } = fixture();
  expect(() =>
    tracker.recordDeductions({
      remaining: 0,
      resetTime: new Date(),
      limit: 1000,
      servedFrom: "account",
      creditRefundKey: "old-refund",
      pointsDeducted: 50,
    }),
  ).toThrow();
  expect(() => tracker.recordFreeAgentClaim()).toThrow();
  expect(() => tracker.setUser("other", "pro")).toThrow();
  expect(() => tracker.trackKeyedReservation({ ...handle })).toThrow();
  expect(() => tracker.trackKeyedReservation(handle)).not.toThrow();
});

it("cannot attach keyed cleanup after legacy charging has been recorded", () => {
  const tracker = new UsageRefundTracker();
  tracker.setUser("owner", "pro");
  tracker.recordDeductions({
    remaining: 0,
    resetTime: new Date(),
    limit: 1000,
    pointsDeducted: 50,
  });
  expect(() => tracker.trackKeyedReservation(fixture().handle)).toThrow();
});

it("requires an eligible fixed account context before attaching cleanup", () => {
  const handle = fixture().handle;
  const tracker = new UsageRefundTracker();
  expect(() => tracker.trackKeyedReservation(handle)).toThrow();
  tracker.setUser("owner", "free");
  expect(() => tracker.trackKeyedReservation(handle)).toThrow();
  tracker.setUser("owner", "pro", "team-id");
  expect(() => tracker.trackKeyedReservation(handle)).toThrow();
});

it("rejects an initially foreign owner or tier without closing that owner's reservation", () => {
  const { handle, closeBeforeUse } = fixture();
  const tracker = new UsageRefundTracker();
  tracker.setUser("foreign", "pro");
  expect(() => tracker.trackKeyedReservation(handle)).toThrow();
  tracker.setUser("owner", "ultra");
  expect(() => tracker.trackKeyedReservation(handle)).toThrow();
  expect(closeBeforeUse).not.toHaveBeenCalled();
});
