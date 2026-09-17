import { fireEvent, render, screen } from "@testing-library/react";
import StudioError from "@/app/(chat)/studio/error";
import StudioLoading from "@/app/(chat)/studio/loading";

describe("Studio route states", () => {
  it("provides a structured, reduced-motion-safe loading surface", () => {
    render(<StudioLoading />);

    expect(
      screen.getByRole("status", { name: "Opening Studio" }),
    ).toHaveAttribute("aria-busy", "true");
    const loading = screen.getByTestId("studio-loading");
    expect(
      loading.querySelector('[data-ui="studio-discovery-grid"]')?.children,
    ).toHaveLength(2);
    expect(
      loading.querySelector('[data-ui="composer-shell"]'),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("explains route failures and retries through the error boundary", () => {
    const reset = jest.fn();
    render(<StudioError reset={reset} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your conversation and saved outputs were not changed.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
