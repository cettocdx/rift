import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { RateLimitWarning } from "../RateLimitWarning";

jest.mock("@/app/components/settings/useSettingsNavigation", () => ({
  useSettingsNavigation: () => ({ hrefFor: () => "/settings/billing" }),
}));

describe("RateLimitWarning — run-budget", () => {
  it("explains the run's own spending against its ceiling", () => {
    render(
      <RateLimitWarning
        data={{
          warningType: "run-budget",
          usedPercent: 84,
          usedDollars: 4.2,
          ceilingDollars: 5,
          subscription: "pro",
          midStream: true,
        }}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByTestId("rate-limit-warning")).toHaveTextContent(
      "$4.20 of this run's $5.00 limit (84%)",
    );
    // Not a balance problem: no "buy tokens" nudge.
    expect(screen.queryByText(/buy tokens/i)).toBeNull();
  });

  it("says the run was stopped when the ceiling cut it off", () => {
    render(
      <RateLimitWarning
        data={{
          warningType: "run-budget",
          usedPercent: 100,
          usedDollars: 5.1,
          ceilingDollars: 5,
          subscription: "free",
          midStream: true,
          cutOff: true,
        }}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByTestId("rate-limit-warning")).toHaveTextContent(
      /reached its \$5\.00 spending limit and was stopped/i,
    );
  });
});
