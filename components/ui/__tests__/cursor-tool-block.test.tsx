import { fireEvent, render, screen } from "@testing-library/react";
import { CursorToolBlock } from "../cursor-tool-block";

describe("CursorToolBlock", () => {
  it("reveals a running transcript when command data arrives after mount", () => {
    const { rerender } = render(
      <CursorToolBlock label="Preparing command" status="running" />,
    );

    expect(
      screen.queryByRole("region", { name: "Terminal output" }),
    ).not.toBeInTheDocument();

    rerender(
      <CursorToolBlock
        label="Running tests"
        status="running"
        command="pnpm test"
        output="PASS"
      />,
    );

    const transcript = screen.getByRole("region", {
      name: "Terminal output",
    });
    expect(transcript).toHaveAttribute("aria-busy", "true");
    expect(transcript).toHaveTextContent("pnpm test");
    expect(transcript).toHaveTextContent("PASS");
    expect(transcript).not.toHaveTextContent("$");
  });

  it("exposes completed output as a keyboard-toggleable region", () => {
    render(
      <CursorToolBlock
        label="Ran terminal command"
        status="done"
        command="pnpm typecheck"
        output="Done"
      />,
    );

    const trigger = screen.getByRole("button");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveClass("hover:bg-[var(--accent)]");
    // The trigger draws no ring of its own; the hairline focus floor in
    // globals.css owns the indicator, and a control opts into it by not
    // carrying a ring class.
    expect(trigger.className).not.toMatch(/focus-visible:ring/);
    expect(trigger).toHaveClass("focus-visible:outline-none");
    expect(
      screen.queryByRole("region", { name: "Terminal output" }),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(trigger, { key: "Enter" });

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("region", { name: "Terminal output" }),
    ).toBeVisible();
  });

  it("draws a finished row as a sentence, with no rule and no tick", () => {
    // Codex renders a working agent as a column of quiet lines: a leading
    // glyph, the sentence, and nothing else. A hairline under every row turns
    // one trace into a stack of cards, and a tick beside every finished row is
    // a column of decoration -- the label is already past tense.
    const { container } = render(
      <CursorToolBlock label="Ran typecheck and production build" status="done" />,
    );

    const row = container.querySelector('[data-ui="tool-block"]');
    expect(row).not.toHaveClass("border-b");
    expect(
      container.querySelector('[data-ui="tool-status"] svg'),
    ).toBeNull();
    // The state a reader cannot get from the words is still announced.
    expect(screen.getByText("Done")).toHaveClass("sr-only");
  });

  it("still shows the two states the words cannot carry", () => {
    const { container, rerender } = render(
      <CursorToolBlock label="Running typecheck" status="running" />,
    );
    expect(
      container.querySelector('[data-ui="tool-status"] svg'),
    ).toBeInTheDocument();

    rerender(<CursorToolBlock label="Ran typecheck" status="error" />);
    expect(
      container.querySelector('[data-ui="tool-status"] svg'),
    ).toBeInTheDocument();
  });

  it("honors an explicit default-open request for completed output", () => {
    render(
      <CursorToolBlock
        label="Ran terminal command"
        status="done"
        output="Done"
        defaultOpen
      />,
    );

    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("region", { name: "Terminal output" }),
    ).toBeVisible();
  });
});
