import type { RateLimitInfo, SubscriptionTier } from "@/types";
import { refundUsage } from "./token-bucket";
import { refundFreeAgentRun } from "@/lib/extra-usage";

/** Server-created handle, attached before any potentially charging await.
 * The lifecycle owns its binding and keyed recovery; this tracker never derives
 * an amount or a fallback refund from a missing response. */
interface KeyedReservationCleanup {
  inspect(): {
    userId: string;
    subscription: "pro" | "ultra";
    phase: string;
    reservationAttempted: boolean;
    reservationKey: string;
  };
  closeBeforeUse(): Promise<{ state: "closed" | "unresolved" }>;
}

/**
 * Tracks usage deductions and handles refunds on error.
 * Ensures refunds only happen once, even if multiple error handlers trigger.
 */
export class UsageRefundTracker {
  private pointsDeducted = 0;
  private extraUsagePointsDeducted = 0;
  private userId: string | undefined;
  private subscription: SubscriptionTier | undefined;
  private organizationId: string | undefined;
  private creditRefundKey: string | undefined;
  private servedFrom: RateLimitInfo["servedFrom"];
  private freeAgentClaimed = false;
  private hasRefunded = false;
  private deductionsRecorded = false;
  private keyedReservation: KeyedReservationCleanup | undefined;
  private legacyRefundPromise: Promise<boolean> | undefined;

  /**
   * Set user context for refunds.
   */
  setUser(
    userId: string,
    subscription: SubscriptionTier,
    organizationId?: string,
  ): void {
    if (
      this.keyedReservation &&
      (userId !== this.userId ||
        subscription !== this.subscription ||
        organizationId !== this.organizationId)
    ) {
      throw new Error("Cannot rebind keyed reservation cleanup");
    }
    this.userId = userId;
    this.subscription = subscription;
    this.organizationId = organizationId;
  }

  trackKeyedReservation(handle: KeyedReservationCleanup): void {
    if (this.keyedReservation === handle) return;
    const binding = handle.inspect();
    if (
      this.keyedReservation ||
      this.deductionsRecorded ||
      this.freeAgentClaimed ||
      this.hasRefunded ||
      !this.userId ||
      binding.userId !== this.userId ||
      binding.subscription !== this.subscription ||
      !["pro", "ultra"].includes(this.subscription ?? "") ||
      this.organizationId
    ) {
      throw new Error("Cannot mix keyed and legacy reservation cleanup");
    }
    this.keyedReservation = handle;
  }

  /**
   * Record deductions from rate limit check.
   */
  recordDeductions(rateLimitInfo: RateLimitInfo): void {
    if (
      this.keyedReservation &&
      (rateLimitInfo.servedFrom !== "account" || rateLimitInfo.creditRefundKey)
    ) {
      throw new Error("Legacy receipt cannot enter keyed reservation cleanup");
    }
    this.deductionsRecorded = true;
    this.pointsDeducted = rateLimitInfo.pointsDeducted ?? 0;
    this.extraUsagePointsDeducted = rateLimitInfo.extraUsagePointsDeducted ?? 0;
    this.creditRefundKey = rateLimitInfo.creditRefundKey;
    this.servedFrom = rateLimitInfo.servedFrom;
  }

  /**
   * Mark that this request spent the user's one free Agent run, so a refund
   * also un-claims that lifetime gate (a free agent run has no balance points).
   */
  recordFreeAgentClaim(): void {
    if (this.keyedReservation)
      throw new Error("Free claim cannot enter keyed reservation cleanup");
    this.freeAgentClaimed = true;
  }

  /**
   * Check if there are any deductions to refund.
   */
  hasDeductions(): boolean {
    return (
      this.keyedReservation?.inspect().reservationAttempted === true ||
      this.pointsDeducted > 0 ||
      this.extraUsagePointsDeducted > 0
    );
  }

  /**
   * One-line summary of what this tracker is responsible for refunding — for
   * structured logging / manual reconciliation when a refund attempt fails.
   */
  getDeductionSummary(): {
    userId: string | undefined;
    pointsDeducted: number;
    extraUsagePointsDeducted: number;
    freeAgentClaimed: boolean;
    reservationKey?: string;
    reservationPhase?: string;
  } {
    return {
      userId: this.userId,
      pointsDeducted: this.pointsDeducted,
      extraUsagePointsDeducted: this.extraUsagePointsDeducted,
      freeAgentClaimed: this.freeAgentClaimed,
      ...(this.keyedReservation
        ? {
            reservationKey: this.keyedReservation.inspect().reservationKey,
            reservationPhase: this.keyedReservation.inspect().phase,
          }
        : {}),
    };
  }

  /**
   * Refund all deducted credits, sharing the same legacy attempt and outcome.
   * Call this from error handlers to restore credits on failure.
   *
   * Returns `true` when there is nothing to refund or everything settled, and
   * `false` when a refund was attempted but a sub-step failed. A `false` return
   * means restoration is unconfirmed: the caller should surface a non-fatal
   * warning for reconciliation. A legacy response can be lost after a commit;
   * later error handlers must not replay that unkeyed attempt. The separate
   * keyed reservation lifecycle owns its safe recovery protocol.
   */
  async refund(): Promise<boolean> {
    if (this.hasRefunded) {
      return true;
    }
    if (this.keyedReservation) {
      // A durable terminal charge is already reconciled, not refundable. This
      // branch precedes the empty-tracker shortcut: an absent reserve receipt
      // must still close its key, including a reserve that has not started yet.
      if (this.keyedReservation.inspect().phase === "settled") return true;
      try {
        const result = await this.keyedReservation.closeBeforeUse();
        this.hasRefunded = result.state === "closed";
        return this.hasRefunded;
      } catch {
        // The caller's existing false-result warning includes our stable key
        // and phase through getDeductionSummary. Never try legacy arithmetic.
        return false;
      }
    }
    if (!this.hasDeductions() && !this.freeAgentClaimed) {
      return true;
    }
    this.legacyRefundPromise ??= Promise.resolve().then(() =>
      this.refundLegacy(),
    );
    return this.legacyRefundPromise;
  }

  private async refundLegacy(): Promise<boolean> {
    let allOk = true;

    // Refund any prepaid-balance / token-bucket deduction.
    if (this.hasDeductions() && this.userId && this.subscription) {
      try {
        await refundUsage(
          this.userId,
          this.subscription,
          this.pointsDeducted,
          this.extraUsagePointsDeducted,
          this.organizationId,
          this.creditRefundKey,
          this.servedFrom,
        );
      } catch (error) {
        // High-signal: a swallowed failure here means the user paid for a
        // request that never ran. Log enough to reconcile by hand.
        console.error("[refund] Failed to refund usage:", {
          userId: this.userId,
          pointsDeducted: this.pointsDeducted,
          extraUsagePointsDeducted: this.extraUsagePointsDeducted,
          error: error instanceof Error ? error.message : String(error),
        });
        allOk = false;
      }
    }

    // Un-claim the one free Agent run (separate lifetime gate, no balance
    // points), so a failed free agent run does not burn the user's free try.
    if (this.freeAgentClaimed && this.userId) {
      const ok = await refundFreeAgentRun(this.userId);
      if (!ok) {
        console.error("[refund] Failed to un-claim free agent run:", {
          userId: this.userId,
        });
        allOk = false;
      }
    }

    // Success and uncertainty are both retained by the shared attempt.
    if (allOk) {
      this.hasRefunded = true;
    }
    return allOk;
  }
}
