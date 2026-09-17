import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ComputerCodeBlock } from "../ComputerCodeBlock";

describe("ComputerCodeBlock theme contract", () => {
  it("inherits the app surface and readable foreground", () => {
    const { container } = render(
      <ComputerCodeBlock language="text">hello</ComputerCodeBlock>,
    );

    expect(container.firstElementChild).toHaveClass("bg-background");
    expect(container.firstElementChild?.className).not.toContain(
      "[--foreground:",
    );
    expect(screen.getByText("hello").closest("pre")).toHaveClass(
      "text-foreground",
    );
  });

  it("avoids hardcoded focus colors for toolbar actions", () => {
    render(<ComputerCodeBlock language="text">hello</ComputerCodeBlock>);

    for (const name of ["Download", "Disable text wrapping", "Copy"]) {
      const button = screen.getByRole("button", { name });
      // Browser coverage verifies the visible outline; it uses the theme token.
      expect(button.className).not.toMatch(/focus-visible:ring/);
      expect(button.className).not.toMatch(/#599ce7|(?:sky|blue|cyan)-/);
    }
  });
});

describe("ComputerCodeBlock controls", () => {
  it("follows the enclosing panel wrap control", () => {
    const { rerender } = render(
      <ComputerCodeBlock language="text" wrap={true} showButtons={false}>
        hello
      </ComputerCodeBlock>,
    );
    expect(screen.getByText("hello").closest("pre")).toHaveClass(
      "whitespace-pre-wrap",
    );
    rerender(
      <ComputerCodeBlock language="text" wrap={false} showButtons={false}>
        hello
      </ComputerCodeBlock>,
    );
    expect(screen.getByText("hello").closest("pre")).toHaveClass(
      "whitespace-pre",
    );
  });
  it("copies the exact document including indentation and final newline", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <ComputerCodeBlock language="text">
        {"  first\nlast\n"}
      </ComputerCodeBlock>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("  first\nlast\n"),
    );
  });
});
