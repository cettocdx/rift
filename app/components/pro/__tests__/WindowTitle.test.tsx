import { render, screen } from "@testing-library/react";
import { WindowTitle } from "../WindowTitle";

function wideViewport(wide: boolean) {
  (window.matchMedia as jest.Mock).mockImplementation((query: string) => ({
    matches: wide && query.includes("768px"),
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
}

function mountSlot() {
  const slot = document.createElement("div");
  slot.id = "rift-window-title-slot";
  document.body.appendChild(slot);
  return slot;
}

describe("the window title", () => {
  it("puts what you are working on in the strip", () => {
    wideViewport(true);
    const slot = mountSlot();

    render(<WindowTitle title="Refactor the parser" badge="rift" />);

    expect(slot).toContainElement(screen.getByText("Refactor the parser"));
    expect(screen.getByText("rift")).toBeVisible();
    slot.remove();
  });

  it("says an untitled conversation is untitled rather than borrowing a name", () => {
    wideViewport(true);
    const slot = mountSlot();

    render(<WindowTitle title={null} />);

    expect(screen.getByText("New chat")).toBeVisible();
    slot.remove();
  });

  it("stays out of a window that has no strip", () => {
    // The web shell has its own header; a second title bar would be a
    // duplicate, not a fallback.
    wideViewport(false);
    const slot = mountSlot();

    const { container } = render(<WindowTitle title="Refactor the parser" />);

    expect(container).toBeEmptyDOMElement();
    expect(slot).toBeEmptyDOMElement();
    slot.remove();
  });
});
