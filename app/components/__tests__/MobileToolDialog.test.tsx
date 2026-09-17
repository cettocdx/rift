import { useRef, useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MobileToolDialog } from "../MobileToolDialog";

function DialogHarness() {
  const [open, setOpen] = useState(false);
  const backgroundRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <div ref={backgroundRef} data-testid="background">
        <button type="button" onClick={() => setOpen(true)}>
          Open tools
        </button>
      </div>
      {open ? (
        <MobileToolDialog
          backgroundRef={backgroundRef}
          label="Mobile tools"
          description="Full-screen mobile tools. Press Escape to close."
          contentClassName="top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-background p-4 shadow-none"
          onClose={() => setOpen(false)}
        >
          <button type="button">First action</button>
          <button type="button">Last action</button>
        </MobileToolDialog>
      ) : null}
    </>
  );
}

describe("MobileToolDialog", () => {
  it("traps focus, makes the background inert, closes on Escape, and returns focus", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    const opener = screen.getByRole("button", { name: "Open tools" });
    await user.click(opener);

    const dialog = await screen.findByRole("dialog", {
      name: "Mobile tools",
    });
    const background = screen.getByTestId("background");

    expect(dialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() => expect(dialog).toHaveFocus());
    expect(background.inert).toBe(true);
    expect(background).toHaveAttribute("aria-hidden", "true");

    await user.tab();
    expect(
      screen.getByRole("button", { name: "Close Mobile tools" }),
    ).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "First action" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Last action" })).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole("button", { name: "Close Mobile tools" }),
    ).toHaveFocus();

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Mobile tools" }),
      ).not.toBeInTheDocument(),
    );
    expect(background.inert).toBe(false);
    expect(background).not.toHaveAttribute("aria-hidden");
    expect(opener).toHaveFocus();
  });
  it("provides a visible touch close control and restores the opener without scrolling", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const opener = screen.getByRole("button", { name: "Open tools" });
    await user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Mobile tools" });
    const close = screen.getByRole("button", { name: "Close Mobile tools" });
    expect(close).toHaveClass("h-11", "w-11", "shrink-0");
    expect(
      screen.getByRole("heading", { name: "Mobile tools" }),
    ).not.toHaveClass("sr-only");
    expect(dialog).toHaveClass("p-0", "sm:max-w-none", "flex-col");
    expect(dialog).not.toHaveClass(
      "p-4",
      "sm:max-w-lg",
      "data-[state=open]:zoom-in-95",
    );
    const content = dialog.querySelector("[data-mobile-tool-content]");
    expect(content).toContainElement(
      screen.getByRole("button", { name: "First action" }),
    );
    expect(content).not.toContainElement(close);
    expect(content).toHaveClass(
      "min-h-0",
      "flex-1",
      "overflow-hidden",
      "[&_[data-build-preview-panel]]:!relative",
      "[&_[data-computer-sidebar]]:!relative",
    );
    expect(dialog.querySelector("[data-mobile-tool-header]")).toHaveClass(
      "pt-[env(safe-area-inset-top)]",
    );
    const focus = jest.spyOn(opener, "focus");
    await user.click(close);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(opener).toHaveFocus();
    expect(screen.getByTestId("background").inert).toBe(false);
    expect(screen.getByTestId("background")).not.toHaveAttribute("aria-hidden");
    focus.mockRestore();
  });
});
