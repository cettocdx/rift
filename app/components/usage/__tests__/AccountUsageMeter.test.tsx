import { render, screen } from "@testing-library/react";
import { AccountUsageMeter } from "../AccountUsageMeter";

describe("the account usage meter", () => {
  it("shows the ledger reset date in UTC and omits invalid dates", () => {
    const { rerender } = render(
      <AccountUsageMeter
        used={45}
        total={100}
        resetAt="2026-10-01T00:00:00Z"
      />,
    );
    expect(screen.getByText("Resets Oct 1 (UTC)")).toBeVisible();
    rerender(<AccountUsageMeter used={45} total={100} resetAt="invalid" />);
    expect(screen.queryByText(/Resets/)).not.toBeInTheDocument();
  });

  it("reports the proportion of the allowance that is gone", () => {
    render(<AccountUsageMeter used={45} total={100} />);
    expect(screen.getByText("45%")).toBeVisible();
    expect(
      screen.getByRole("img", {
        name: "45% of this period's allowance used",
      }),
    ).toBeInTheDocument();
  });

  it("offers a bare bar without duplicating the surrounding panel's labels", () => {
    const { container, rerender } = render(
      <AccountUsageMeter
        variant="bar"
        used={994}
        total={1000}
        resetAt="2026-10-01T00:00:00Z"
        upgradeHref="/upgrade"
        upgradeLabel="Max"
      />,
    );

    const bar = screen.getByRole("img", {
      name: "100% of this period's allowance used",
    });
    expect(container.firstElementChild).toBe(bar);
    expect(bar.querySelector('[data-warning="true"]')).not.toBeNull();
    expect(screen.queryByText("Your usage limit")).not.toBeInTheDocument();
    expect(screen.queryByText(/Resets/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Learn more" })).toBeNull();

    rerender(<AccountUsageMeter variant="bar" used={0} total={0} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<AccountUsageMeter variant="bar" used={Number.NaN} total={100} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing at all on a plan with no allowance", () => {
    // Zero is not "you have used none of it" -- it means this plan does not
    // work that way, and an empty bar would say the opposite.
    const { container } = render(<AccountUsageMeter used={0} total={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("rounds against the reader, not toward a comfortable number", () => {
    // 99.4% of a budget you are about to exhaust is not "99%".
    render(<AccountUsageMeter used={994} total={1000} />);
    expect(screen.getByText("100%")).toBeVisible();
  });

  it("never reports more than all of it, whatever the ledger says", () => {
    render(<AccountUsageMeter used={5000} total={1000} />);
    expect(screen.getByText("100%")).toBeVisible();
  });

  it("lights a segment as soon as anything has been spent", () => {
    // A barely-started period should not look untouched.
    render(<AccountUsageMeter used={1} total={100_000} />);
    expect(screen.getByText("1%")).toBeVisible();
  });

  it("offers the upgrade only when there is one to offer", () => {
    const { rerender } = render(<AccountUsageMeter used={90} total={100} />);
    expect(screen.queryByRole("link", { name: "Learn more" })).toBeNull();

    rerender(
      <AccountUsageMeter
        used={90}
        total={100}
        upgradeHref="/upgrade"
        upgradeLabel="Max"
      />,
    );
    expect(
      screen.getByText(/Upgrade to Max for extended usage\./),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Learn more" })).toHaveAttribute(
      "href",
      "/upgrade",
    );
  });

  it("refuses to draw anything from a nonsense ledger row", () => {
    const { container } = render(
      <AccountUsageMeter used={Number.NaN} total={100} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
