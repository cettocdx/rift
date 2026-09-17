import { describe, expect, it } from "@jest/globals";
import type { SubscriptionTier } from "@/types";
import { ChatSDKError } from "@/lib/errors";
import {
  assertHackWorkbenchAccess,
  assertHackWorkbenchPurposeRoute,
  assertPremiumAccess,
  hasHackWorkbenchAccess,
  hasPremiumAccess,
} from "@/lib/auth/premium-access";

describe("premium access", () => {
  const paidTiers = [
    "pro",
    "pro-plus",
    "team",
    "ultra",
  ] as const satisfies readonly SubscriptionTier[];

  it.each(paidTiers)("grants access to the %s tier", (tier) => {
    expect(hasPremiumAccess(tier)).toBe(true);
    expect(() => assertPremiumAccess(tier, "hack-mode")).not.toThrow();
  });

  it("denies the free tier with a 403 auth error", () => {
    expect(hasPremiumAccess("free")).toBe(false);

    try {
      assertPremiumAccess("free", "hack-mode");
      throw new Error("expected assertPremiumAccess to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ChatSDKError);
      expect(error).toMatchObject({
        type: "forbidden",
        surface: "auth",
        statusCode: 403,
      });
    }
  });

  it.each([undefined, null, "enterprise", ""])(
    "fails closed for an invalid runtime tier (%p)",
    (tier) => {
      const unsafeTier = tier as unknown as SubscriptionTier;

      expect(hasPremiumAccess(unsafeTier)).toBe(false);
      expect(() => assertPremiumAccess(unsafeTier)).toThrow(ChatSDKError);
    },
  );

  it("grants Hack Workbench only to the Max billing tier", () => {
    expect(hasHackWorkbenchAccess("ultra")).toBe(true);
    expect(() => assertHackWorkbenchAccess("ultra")).not.toThrow();
  });

  it.each(["free", "pro", "pro-plus", "team"] as const)(
    "denies Hack Workbench to the %s tier",
    (tier) => {
      expect(hasHackWorkbenchAccess(tier)).toBe(false);

      try {
        assertHackWorkbenchAccess(tier);
        throw new Error("expected Hack Workbench gate to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(ChatSDKError);
        expect(error).toMatchObject({
          type: "forbidden",
          surface: "auth",
          statusCode: 403,
          cause: "max_required",
          metadata: expect.objectContaining({
            feature: "hack-mode",
            requiredPlan: "Max",
            requiredTier: "ultra",
            upgradeUrl: "/upgrade?feature=hack",
          }),
        });
      }
    },
  );

  it("allows the security persona only on the dedicated Hack route", () => {
    expect(() =>
      assertHackWorkbenchPurposeRoute("security", true),
    ).not.toThrow();
    expect(() => assertHackWorkbenchPurposeRoute("app", false)).not.toThrow();

    try {
      assertHackWorkbenchPurposeRoute("security", false);
      throw new Error("expected the normal chat route to reject security");
    } catch (error) {
      expect(error).toBeInstanceOf(ChatSDKError);
      expect(error).toMatchObject({
        type: "forbidden",
        surface: "auth",
        statusCode: 403,
        cause: "hack_workbench_required",
        metadata: expect.objectContaining({ route: "/hack" }),
      });
    }
  });
});
