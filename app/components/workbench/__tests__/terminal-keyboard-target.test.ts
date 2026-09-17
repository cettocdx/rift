import { shouldPreserveTerminalCtrlChord } from "../terminal-keyboard-target";

function keyboardEvent(
  target: Element,
  options: KeyboardEventInit,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", options);
  target.dispatchEvent(event);
  return event;
}

describe("shouldPreserveTerminalCtrlChord", () => {
  it("lets Ctrl chords reach nested xterm inputs", () => {
    const terminal = document.createElement("div");
    terminal.dataset.workbenchInteractiveTerminal = "";
    const input = document.createElement("textarea");
    terminal.append(input);
    document.body.append(terminal);

    expect(
      shouldPreserveTerminalCtrlChord(
        keyboardEvent(input, { key: "k", ctrlKey: true }),
      ),
    ).toBe(true);
  });

  it("keeps macOS Command shortcuts available inside the terminal", () => {
    const terminal = document.createElement("div");
    terminal.dataset.workbenchInteractiveTerminal = "";
    const input = document.createElement("textarea");
    terminal.append(input);
    document.body.append(terminal);

    expect(
      shouldPreserveTerminalCtrlChord(
        keyboardEvent(input, { key: "k", metaKey: true }),
      ),
    ).toBe(false);
  });

  it("does not suppress Ctrl shortcuts outside the terminal", () => {
    const input = document.createElement("input");
    document.body.append(input);

    expect(
      shouldPreserveTerminalCtrlChord(
        keyboardEvent(input, { key: "j", ctrlKey: true }),
      ),
    ).toBe(false);
  });
});
