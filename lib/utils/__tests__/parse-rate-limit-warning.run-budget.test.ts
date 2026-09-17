import { parseRateLimitWarning } from "@/lib/utils/parse-rate-limit-warning";

/*
 * The per-run ceiling warning has no reset time. The parser used to require
 * one for every type, which would have dropped this warning on the floor: the
 * run would stop at its cap and the user would see nothing.
 */
describe("parseRateLimitWarning — run-budget", () => {
  const opts = { hasUserDismissed: false };

  it("parses a run-budget warning without a reset time", () => {
    expect(
      parseRateLimitWarning(
        {
          warningType: "run-budget",
          usedPercent: 84,
          usedDollars: 4.2,
          ceilingDollars: 5,
          subscription: "pro",
          midStream: true,
        },
        opts,
      ),
    ).toEqual({
      warningType: "run-budget",
      usedPercent: 84,
      usedDollars: 4.2,
      ceilingDollars: 5,
      subscription: "pro",
      midStream: true,
    });
  });

  it("keeps the cut-off flag", () => {
    expect(
      parseRateLimitWarning(
        {
          warningType: "run-budget",
          usedPercent: 100,
          usedDollars: 5.1,
          ceilingDollars: 5,
          subscription: "free",
          cutOff: true,
        },
        opts,
      ),
    ).toMatchObject({ cutOff: true });
  });

  it("rejects malformed numbers and a zero ceiling", () => {
    expect(
      parseRateLimitWarning(
        { warningType: "run-budget", usedPercent: "84", usedDollars: 1, ceilingDollars: 5, subscription: "pro" },
        opts,
      ),
    ).toBeNull();
    expect(
      parseRateLimitWarning(
        { warningType: "run-budget", usedPercent: 84, usedDollars: 1, ceilingDollars: 0, subscription: "pro" },
        opts,
      ),
    ).toBeNull();
  });

  it("still honours a user dismissal", () => {
    expect(
      parseRateLimitWarning(
        { warningType: "run-budget", usedPercent: 84, usedDollars: 1, ceilingDollars: 5, subscription: "pro" },
        { hasUserDismissed: true },
      ),
    ).toBeNull();
  });
});
