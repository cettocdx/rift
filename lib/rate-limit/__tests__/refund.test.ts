/**
 * Tests for UsageRefundTracker class.
 *
 * Uses jest.isolateModules() to mock the refundUsage dependency.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { RateLimitInfo } from "@/types";

describe("UsageRefundTracker", () => {
  const mockRefundUsage = jest.fn();
  const mockRefundFreeAgentRun = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockRefundUsage.mockResolvedValue(undefined);
    mockRefundFreeAgentRun.mockResolvedValue(true);
  });

  const getIsolatedModule = () => {
    let isolatedModule: typeof import("../refund");

    jest.isolateModules(() => {
      jest.doMock("../token-bucket", () => ({
        refundUsage: mockRefundUsage,
      }));

      jest.doMock("@/lib/extra-usage", () => ({
        refundFreeAgentRun: mockRefundFreeAgentRun,
      }));

      isolatedModule = require("../refund");
    });

    return isolatedModule!;
  };

  describe("setUser", () => {
    it("should store user context", () => {
      const { UsageRefundTracker } = getIsolatedModule();
      const tracker = new UsageRefundTracker();

      tracker.setUser("user-123", "pro");

      // User context is stored internally, verified by refund behavior
      expect(tracker).toBeDefined();
    });
  });

  describe("recordDeductions", () => {
    it("should record points deducted from rate limit info", () => {
      const { UsageRefundTracker } = getIsolatedModule();
      const tracker = new UsageRefundTracker();

      const rateLimitInfo: RateLimitInfo = {
        remaining: 5000,
        resetTime: new Date(),
        limit: 10000,
        pointsDeducted: 100,
        extraUsagePointsDeducted: 50,
      };

      tracker.recordDeductions(rateLimitInfo);

      expect(tracker.hasDeductions()).toBe(true);
    });

    it("should handle missing deduction fields", () => {
      const { UsageRefundTracker } = getIsolatedModule();
      const tracker = new UsageRefundTracker();

      const rateLimitInfo: RateLimitInfo = {
        remaining: 5000,
        resetTime: new Date(),
        limit: 10000,
      };

      tracker.recordDeductions(rateLimitInfo);

      expect(tracker.hasDeductions()).toBe(false);
    });
  });

  describe("hasDeductions", () => {
    it("should return false when no deductions recorded", () => {
      const { UsageRefundTracker } = getIsolatedModule();
      const tracker = new UsageRefundTracker();

      expect(tracker.hasDeductions()).toBe(false);
    });

    it("should return true when points deducted", () => {
      const { UsageRefundTracker } = getIsolatedModule();
      const tracker = new UsageRefundTracker();

      tracker.recordDeductions({
        remaining: 5000,
        resetTime: new Date(),
        limit: 10000,
        pointsDeducted: 100,
      });

      expect(tracker.hasDeductions()).toBe(true);
    });

    it("should return true when extra usage points deducted", () => {
      const { UsageRefundTracker } = getIsolatedModule();
      const tracker = new UsageRefundTracker();

      tracker.recordDeductions({
        remaining: 5000,
        resetTime: new Date(),
        limit: 10000,
        extraUsagePointsDeducted: 50,
      });

      expect(tracker.hasDeductions()).toBe(true);
    });

    it("should return false when both deductions are 0", () => {
      const { UsageRefundTracker } = getIsolatedModule();
      const tracker = new UsageRefundTracker();

      tracker.recordDeductions({
        remaining: 5000,
        resetTime: new Date(),
        limit: 10000,
        pointsDeducted: 0,
        extraUsagePointsDeducted: 0,
      });

      expect(tracker.hasDeductions()).toBe(false);
    });
  });

  describe("refund", () => {
    it("should call refundUsage with recorded deductions", async () => {
      const { UsageRefundTracker } = getIsolatedModule();
      const tracker = new UsageRefundTracker();

      tracker.setUser("user-123", "pro");
      tracker.recordDeductions({
        remaining: 5000,
        resetTime: new Date(),
        limit: 10000,
        pointsDeducted: 100,
        extraUsagePointsDeducted: 50,
      });

      await tracker.refund();

      expect(mockRefundUsage).toHaveBeenCalledWith(
        "user-123",
        "pro",
        100,
        50,
        undefined,
        undefined,
        undefined,
      );
    });

    it("forwards exact account-ledger refund identity and source", async () => {
      const { UsageRefundTracker } = getIsolatedModule();
      const tracker = new UsageRefundTracker();

      tracker.setUser("user-123", "ultra");
      tracker.recordDeductions({
        remaining: 1_700_000,
        resetTime: new Date(),
        limit: 1_800_000,
        pointsDeducted: 80_000,
        extraUsagePointsDeducted: 20_000,
        creditRefundKey: "request-1:precharge",
        servedFrom: "account",
      });

      await tracker.refund();

      expect(mockRefundUsage).toHaveBeenCalledWith(
        "user-123",
        "ultra",
        80_000,
        20_000,
        undefined,
        "request-1:precharge",
        "account",
      );
    });

    it("should be idempotent - only refund once", async () => {
      const { UsageRefundTracker } = getIsolatedModule();
      const tracker = new UsageRefundTracker();

      tracker.setUser("user-123", "pro");
      tracker.recordDeductions({
        remaining: 5000,
        resetTime: new Date(),
        limit: 10000,
        pointsDeducted: 100,
      });

      await tracker.refund();
      await tracker.refund();
      await tracker.refund();

      expect(mockRefundUsage).toHaveBeenCalledTimes(1);
    });

    it("should not refund if no deductions", async () => {
      const { UsageRefundTracker } = getIsolatedModule();
      const tracker = new UsageRefundTracker();

      tracker.setUser("user-123", "pro");

      await tracker.refund();

      expect(mockRefundUsage).not.toHaveBeenCalled();
    });

    it("should not refund if no user set", async () => {
      const { UsageRefundTracker } = getIsolatedModule();
      const tracker = new UsageRefundTracker();

      tracker.recordDeductions({
        remaining: 5000,
        resetTime: new Date(),
        limit: 10000,
        pointsDeducted: 100,
      });

      await tracker.refund();

      expect(mockRefundUsage).not.toHaveBeenCalled();
    });

    it("shares a pending legacy refund between concurrent error handlers", async () => {
      const { UsageRefundTracker } = getIsolatedModule();
      const tracker = new UsageRefundTracker();
      tracker.setUser("user-123", "free");
      tracker.recordDeductions({
        remaining: 0,
        resetTime: new Date(),
        limit: 0,
        extraUsagePointsDeducted: 50,
      });
      let resolve!: () => void;
      mockRefundUsage.mockReturnValue(
        new Promise<void>((r) => {
          resolve = r;
        }),
      );
      const first = tracker.refund();
      const second = tracker.refund();
      await Promise.resolve();
      expect(mockRefundUsage).toHaveBeenCalledTimes(1);
      resolve();
      expect(await Promise.all([first, second])).toEqual([true, true]);
    });

    it("does not replay an unconfirmed legacy refund", async () => {
      const { UsageRefundTracker } = getIsolatedModule();
      const tracker = new UsageRefundTracker();
      tracker.setUser("user-123", "free");
      tracker.recordDeductions({
        remaining: 0,
        resetTime: new Date(),
        limit: 0,
        extraUsagePointsDeducted: 50,
      });
      mockRefundUsage.mockRejectedValueOnce(new Error("Acknowledgment lost"));
      expect(await tracker.refund()).toBe(false);
      expect(await tracker.refund()).toBe(false);
      expect(mockRefundUsage).toHaveBeenCalledTimes(1);
    });

    it("does not repeat the money refund after free-claim cleanup fails", async () => {
      const { UsageRefundTracker } = getIsolatedModule();
      const tracker = new UsageRefundTracker();
      tracker.setUser("user-123", "free");
      tracker.recordDeductions({
        remaining: 0,
        resetTime: new Date(),
        limit: 0,
        extraUsagePointsDeducted: 50,
      });
      tracker.recordFreeAgentClaim();
      mockRefundFreeAgentRun.mockResolvedValue(false);
      expect(await tracker.refund()).toBe(false);
      expect(await tracker.refund()).toBe(false);
      expect(mockRefundUsage).toHaveBeenCalledTimes(1);
      expect(mockRefundFreeAgentRun).toHaveBeenCalledTimes(1);
    });

    it("un-claims the free agent run on refund even with no balance deductions", async () => {
      const { UsageRefundTracker } = getIsolatedModule();
      const tracker = new UsageRefundTracker();

      // A free agent run is served free (no balance points), but it spends the
      // one lifetime claim — which must be refunded if the run fails.
      tracker.setUser("user-123", "free");
      tracker.recordDeductions({
        remaining: 0,
        resetTime: new Date(),
        limit: 1,
        servedFrom: "free",
      });
      tracker.recordFreeAgentClaim();

      await tracker.refund();

      expect(mockRefundUsage).not.toHaveBeenCalled();
      expect(mockRefundFreeAgentRun).toHaveBeenCalledWith("user-123");
    });

    it("free agent un-claim is idempotent (only once)", async () => {
      const { UsageRefundTracker } = getIsolatedModule();
      const tracker = new UsageRefundTracker();

      tracker.setUser("user-123", "free");
      tracker.recordDeductions({
        remaining: 0,
        resetTime: new Date(),
        limit: 1,
        servedFrom: "free",
      });
      tracker.recordFreeAgentClaim();

      await tracker.refund();
      await tracker.refund();
      await tracker.refund();

      expect(mockRefundFreeAgentRun).toHaveBeenCalledTimes(1);
    });
  });
});
