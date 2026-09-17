import { render, screen } from "@testing-library/react";
import { RunStatusBadge } from "../run-status-badge";

describe("RunStatusBadge", () => {
  it("renders the canonical label and tone for a status", () => {
    const { container } = render(<RunStatusBadge status="completed" />);
    const badge = container.querySelector('[data-ui="run-status"]');

    expect(badge).toHaveAttribute("data-status", "completed");
    expect(badge).toHaveAttribute("data-tone", "success");
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("does not colour a cancelled run as a danger", () => {
    // A run the user stopped is not a failure, and the colour is read before
    // the word is.
    const { container } = render(<RunStatusBadge status="cancelled" />);
    expect(
      container.querySelector('[data-ui="run-status"]'),
    ).toHaveAttribute("data-tone", "neutral");
  });

  it("shows a reason beside the status when one is given", () => {
    render(<RunStatusBadge status="failed" reason="provider timeout" />);
    expect(screen.getByText("provider timeout")).toBeInTheDocument();
  });

  it("shows progress only while the run is still in flight", () => {
    const { rerender } = render(
      <RunStatusBadge status="running" progress={42} />,
    );
    expect(screen.getByText("42%")).toBeInTheDocument();

    // A percentage on a finished run is a leftover number, not information.
    rerender(<RunStatusBadge status="completed" progress={42} />);
    expect(screen.queryByText("42%")).not.toBeInTheDocument();
  });

  it("renders a machine-readable timestamp", () => {
    const at = Date.now() - 3 * 60 * 60 * 1000;
    const { container } = render(
      <RunStatusBadge status="completed" timestamp={at} />,
    );

    const time = container.querySelector("time");
    expect(time).toHaveAttribute("datetime", new Date(at).toISOString());
    expect(time).toHaveTextContent("3h ago");
  });

  it("spins only for an in-flight status", () => {
    const { container, rerender } = render(<RunStatusBadge status="running" />);
    expect(container.querySelector("svg")).toBeInTheDocument();

    rerender(<RunStatusBadge status="cancelled" />);
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });
});
