import { fireEvent, render, screen } from "@testing-library/react";
import ToolBlock from "../tool-block";

describe("ToolBlock", () => {
  it("renders passive agent activity without a decorative prompt or dead button", () => {
    render(
      <ToolBlock
        icon={<span aria-hidden="true">T</span>}
        action="Running checks"
        target="pnpm test"
      />,
    );

    const row = screen
      .getByText("Running checks")
      .closest("[data-ui=action-block]");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(row).toHaveTextContent("Running checks");
    expect(row).toHaveTextContent("pnpm test");
    expect(row).not.toHaveTextContent("$");
  });

  it("uses a native button only when the row is interactive", () => {
    const onClick = jest.fn();
    render(
      <ToolBlock
        icon={<span aria-hidden="true">T</span>}
        action="Open command"
        target="pnpm test"
        isClickable
        onClick={onClick}
      />,
    );

    const button = screen.getByRole("button", {
      name: "Open pnpm test in sidebar",
    });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
