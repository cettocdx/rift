import { splitComposerCommand } from "../command-highlight";

describe("composer command highlighting", () => {
  it("paints nothing until the name resolves", () => {
    // Half-typed is not wrong, it is unfinished. Colouring it would promise a
    // command that does not exist yet, and take the promise back on the next
    // keystroke if the user was typing something else.
    for (const partial of ["/", "/g", "/go", "/definitely-not-a-command"]) {
      expect(splitComposerCommand(partial)).toEqual([
        { text: partial, kind: "plain" },
      ]);
    }
  });

  it("paints the invocation and leaves the argument alone", () => {
    const segments = splitComposerCommand("/model sonnet");

    expect(segments).toEqual([
      { text: "/model", kind: "command" },
      { text: " sonnet", kind: "plain" },
    ]);
  });

  it("keeps the colour on the token when the field opens with whitespace", () => {
    // The parser trims before matching, so the invocation does not start at
    // index 0 here. Slicing from index 0 would paint the leading spaces too and
    // shift every glyph after them out from under the field's own caret.
    expect(splitComposerCommand("  /model")).toEqual([
      { text: "  ", kind: "plain" },
      { text: "/model", kind: "command" },
    ]);
  });

  it("leaves prose that merely contains a slash alone", () => {
    const prose = "put it in app/globals.css and /model it after";

    expect(splitComposerCommand(prose)).toEqual([
      { text: prose, kind: "plain" },
    ]);
  });

  it("returns nothing for an empty field", () => {
    expect(splitComposerCommand("")).toEqual([]);
  });
});
