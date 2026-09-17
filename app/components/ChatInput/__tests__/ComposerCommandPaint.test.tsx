import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { ComposerCommandPaint } from "../ComposerCommandPaint";

const ref = () => createRef<HTMLTextAreaElement>();

describe("the composer command paint", () => {
  it("paints a resolved command and only the command", () => {
    render(
      <ComposerCommandPaint
        input="/goal ship the redesign"
        textareaRef={ref()}
      />,
    );
    const token = screen.getByText("/goal");
    expect(token).toHaveAttribute("data-ui", "composer-command-token");
    // The argument stays plain: the colour marks what the runtime will
    // execute, not the whole line.
    expect(screen.getByText(/ship the redesign/)).not.toHaveAttribute(
      "data-ui",
      "composer-command-token",
    );
  });

  it("renders nothing at all for prose or an unknown name", () => {
    // A token painted as a command that the parser then rejects is worse than
    // no colour: while nothing resolves, the mirror must not exist, so plain
    // typing never risks a metrics mismatch.
    for (const input of [
      "hello world",
      "/definitelynotacommand x",
      "@files app/page.tsx",
      "@agent:unknown review this",
      "person@example.com",
      "",
    ]) {
      const { container, unmount } = render(
        <ComposerCommandPaint input={input} textareaRef={ref()} />,
      );
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it("is invisible to assistive tech", () => {
    // The textarea still holds the real value; the mirror is purely paint.
    render(<ComposerCommandPaint input="/goal x" textareaRef={ref()} />);
    expect(
      document.querySelector('[data-ui="composer-command-paint"]'),
    ).toHaveAttribute("aria-hidden", "true");
  });

  it("matches the actual textarea metrics instead of shifting the text when a command resolves", () => {
    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    textarea.value = "/goal review the change\n";
    textarea.setSelectionRange(10, 10);
    Object.assign(textarea.style, {
      padding: "16px 16px 10px",
      fontFamily: "Arial",
      fontSize: "13px",
      fontWeight: "450",
      lineHeight: "20px",
      letterSpacing: "0px",
    });
    Object.defineProperties(textarea, {
      clientWidth: { value: 280, configurable: true },
      clientHeight: { value: 80 },
    });
    const textareaRef = ref();
    textareaRef.current = textarea;

    const { unmount } = render(
      <ComposerCommandPaint input={textarea.value} textareaRef={textareaRef} />,
    );
    const mirror = document.querySelector('[data-ui="composer-command-paint"]');

    expect(mirror).toHaveStyle({
      padding: "16px 16px 10px",
      fontFamily: "Arial",
      fontSize: "13px",
      fontWeight: "450",
      lineHeight: "20px",
      letterSpacing: "0px",
      width: "280px",
      height: "80px",
      boxSizing: "border-box",
    });
    expect(textarea.value).toBe("/goal review the change\n");
    expect(textarea.selectionStart).toBe(10);
    expect(textarea.selectionEnd).toBe(10);

    Object.defineProperty(textarea, "clientWidth", { value: 220 });
    textarea.style.fontSize = "16px";
    fireEvent(window, new Event("resize"));
    expect(mirror).toHaveStyle({ width: "220px", fontSize: "16px" });
    unmount();
    textarea.remove();
  });

  it("copies both scroll axes without changing the textarea's scroll or content", () => {
    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    textarea.value = "/goal " + "long line ".repeat(100);
    const textareaRef = ref();
    textareaRef.current = textarea;
    const { unmount } = render(
      <ComposerCommandPaint input={textarea.value} textareaRef={textareaRef} />,
    );
    const mirror = document.querySelector('[data-ui="composer-command-paint"]');

    textarea.scrollTop = 60;
    textarea.scrollLeft = 12;
    fireEvent.scroll(textarea);

    expect(mirror?.scrollTop).toBe(60);
    expect(mirror?.scrollLeft).toBe(12);
    expect(textarea.scrollTop).toBe(60);
    expect(textarea.scrollLeft).toBe(12);
    unmount();
    textarea.remove();
  });
});
