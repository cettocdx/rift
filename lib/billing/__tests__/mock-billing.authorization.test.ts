import { afterEach, describe, expect, it } from "@jest/globals";
import { resolveMockTierFromCookie } from "@/lib/billing/mock-billing";

const originalNodeEnv = process.env.NODE_ENV;
const originalMockBilling = process.env.MOCK_BILLING;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  if (originalMockBilling === undefined) delete process.env.MOCK_BILLING;
  else process.env.MOCK_BILLING = originalMockBilling;
});

describe("mock billing authorization boundary", () => {
  it("honors the local test cookie only when mock billing is explicit", () => {
    process.env.NODE_ENV = "test";
    process.env.MOCK_BILLING = "true";

    expect(resolveMockTierFromCookie("pro")).toBe("pro");
    expect(resolveMockTierFromCookie("not-a-tier")).toBeNull();
  });

  it("ignores a forged paid-tier cookie in production", () => {
    process.env.NODE_ENV = "production";
    process.env.MOCK_BILLING = "true";

    expect(resolveMockTierFromCookie("ultra")).toBeNull();
  });
});
