import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, jest } from "@jest/globals";

const mockUseQuery = jest.fn();
const mockQueryResults: { current: unknown[] } = { current: [] };

jest.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => {
    const resultIndex = mockUseQuery.mock.calls.length % 3;
    mockUseQuery(...args);
    return mockQueryResults.current[resultIndex];
  },
  useMutation: () => jest.fn(),
  useAction: () => jest.fn(),
}));

jest.mock("@/app/components/extra-usage", () => ({
  TurnOffExtraUsageDialog: () => null,
  AdjustSpendingLimitDialog: () => null,
  AutoReloadDialog: () => null,
  AddOnCreditsDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">Credit package picker</div> : null,
}));

const { ExtraUsageSection } = jest.requireActual<
  typeof import("../ExtraUsageSection")
>("../ExtraUsageSection");

describe("ExtraUsageSection loading state", () => {
  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  it("does not flash a free plan while billing queries are unresolved", () => {
    mockQueryResults.current = [undefined, undefined, undefined];
    render(<ExtraUsageSection />);

    expect(
      screen.getByRole("status", {
        name: "Loading usage and billing settings",
      }),
    ).toHaveAttribute("aria-busy", "true");
    expect(
      screen.queryByText(/You're on the free plan/i),
    ).not.toBeInTheDocument();
  });

  it("keeps add-on packs visible when legacy extra usage is off", async () => {
    const user = userEvent.setup();
    mockQueryResults.current = [
      { extra_usage_enabled: false },
      {
        balanceDollars: 12.5,
        balancePoints: 125_000,
        autoReloadEnabled: false,
        monthlySpentDollars: 0,
        includedCredits: {
          total: 500_000,
          used: 100_000,
          remaining: 400_000,
          resetAt: null,
        },
      },
      { tier: "pro" },
    ];

    render(<ExtraUsageSection />);

    expect(
      screen.getByRole("heading", { name: "Add-on credits" }),
    ).toBeVisible();
    expect(screen.getByText("Add-on balance: 125K credits")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Add credits" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Credit package picker",
    );
  });

  it("uses the exhausted-credit state for a paid account with no balance", () => {
    mockQueryResults.current = [
      { extra_usage_enabled: false },
      {
        balanceDollars: 0,
        balancePoints: 0,
        autoReloadEnabled: false,
        monthlySpentDollars: 0,
        includedCredits: {
          total: 1_800_000,
          used: 1_800_000,
          remaining: 0,
          resetAt: null,
        },
      },
      { tier: "ultra" },
    ];

    render(<ExtraUsageSection />);

    expect(
      screen.getByRole("heading", { name: "Credits exhausted" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Add credits" })).toBeEnabled();
  });
});
