import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "@jest/globals";
import { openShortcutsDialog, ProShortcutsDialog } from "../ProShortcutsDialog";

describe("ProShortcutsDialog", () => {
  it("uses semantic shortcut key surfaces in light and dark themes", async () => {
    render(<ProShortcutsDialog />);

    act(() => openShortcutsDialog());

    expect(
      await screen.findByText("Open the terminal dock"),
    ).toBeInTheDocument();
    // jsdom is not a Mac, so the chord renders in its Ctrl form.
    const terminalKey = screen.getByText("Ctrl+J");
    expect(terminalKey).toHaveClass(
      "border-border-strong",
      "bg-muted/45",
      "text-foreground/85",
    );
    expect(terminalKey.className).not.toMatch(/border-white|bg-black/);
  });

  it("lists the chords this shell actually handles", async () => {
    render(<ProShortcutsDialog />);
    act(() => openShortcutsDialog());
    await screen.findByText("Open the terminal dock");

    // Mod+K led this list while the only handler for it returned early in the
    // Pro shell. It is handled here now, so listing it is honest.
    expect(document.querySelector('[data-shortcut-id="command-palette-k"]')).
      toBeInTheDocument();
    // Workspace-only chords belong to the workspace list, not this one.
    expect(
      document.querySelector('[data-shortcut-id="workspace-bottom-panel"]'),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-shortcut-id="chat-search"]'),
    ).not.toBeInTheDocument();
  });
});
