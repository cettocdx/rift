import { mockBillingQueryArgs } from "../mock-billing";

/**
 * Caught live on 18 Aug 2026: the sidebar read "Max" while the Monthly usage
 * card directly above the plan name read "0 credits left". Only the upgrade
 * flow writes `mock_subscription_tier`, so a mock-billing session that never
 * passed through it sent no tier to Convex; with no real subscription row
 * either, the server resolved the allowance for tier "" — which falls through
 * `INCLUDED_CREDITS_BY_TIER` to 0.
 */
describe("mockBillingQueryArgs tier fallback", () => {
  const originalEnv = process.env.NEXT_PUBLIC_MOCK_BILLING;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_MOCK_BILLING = "true";
    window.localStorage.clear();
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_MOCK_BILLING = originalEnv;
    window.localStorage.clear();
  });

  it("falls back to the plan the caller is already displaying", () => {
    expect(mockBillingQueryArgs("ultra")).toEqual({ mockTier: "ultra" });
  });

  it("still prefers an explicitly chosen mock tier over the fallback", () => {
    window.localStorage.setItem("mock_subscription_tier", "pro");
    expect(mockBillingQueryArgs("ultra")).toEqual({ mockTier: "pro" });
  });

  it("keeps the old empty-args behaviour when no tier is known", () => {
    expect(mockBillingQueryArgs()).toEqual({});
  });

  it("sends nothing at all when mock billing is off", () => {
    process.env.NEXT_PUBLIC_MOCK_BILLING = "false";
    window.localStorage.setItem("mock_subscription_tier", "ultra");
    expect(mockBillingQueryArgs("ultra")).toEqual({});
  });
});
