import { isMcpToolReadOnlyForPlan } from "../mcp-plan-policy";

describe("MCP Build Plan policy", () => {
  it("fails closed for missing, ambiguous, or mutating annotations", () => {
    expect(isMcpToolReadOnlyForPlan(undefined)).toBe(false);
    expect(isMcpToolReadOnlyForPlan({})).toBe(false);
    expect(isMcpToolReadOnlyForPlan({ readOnlyHint: false })).toBe(false);
    expect(
      isMcpToolReadOnlyForPlan({
        readOnlyHint: true,
        destructiveHint: true,
      }),
    ).toBe(false);
  });

  it("admits only explicitly read-only, non-destructive tools", () => {
    expect(
      isMcpToolReadOnlyForPlan({
        readOnlyHint: true,
        destructiveHint: false,
      }),
    ).toBe(true);
    expect(isMcpToolReadOnlyForPlan({ readOnlyHint: true })).toBe(true);
  });
});
