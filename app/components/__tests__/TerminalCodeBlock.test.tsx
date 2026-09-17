import { render, screen } from "@testing-library/react";
import { TerminalCodeBlock } from "../TerminalCodeBlock";

describe("TerminalCodeBlock", () => {
  it("does not add a decorative shell prompt to live agent commands", () => {
    const { rerender } = render(
      <TerminalCodeBlock
        command="pnpm test"
        isExecuting
        status="streaming"
        variant="sidebar"
      />,
    );

    expect(
      screen.getByText("pnpm test", { selector: "code" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("pnpm test", { selector: "code" }),
    ).not.toHaveTextContent("$ pnpm test");

    rerender(
      <TerminalCodeBlock
        command={'printf "$HOME"'}
        isExecuting
        status="streaming"
        variant="sidebar"
      />,
    );

    expect(
      screen.getByText('printf "$HOME"', { selector: "code" }),
    ).toHaveTextContent('printf "$HOME"');
  });
});
