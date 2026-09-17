import { render } from "@testing-library/react";
import { XStage } from "../XStage";

describe("XStage", () => {
  const originalClientWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  );
  const originalResizeObserver = global.ResizeObserver;

  afterEach(() => {
    if (originalClientWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        "clientWidth",
        originalClientWidth,
      );
    }
    global.ResizeObserver = originalResizeObserver;
  });

  it("uses the boolean inert state when the scaled surface is too small to interact with", () => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 500,
    });
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    const { container } = render(
      <XStage title="RIFT" height={900}>
        <button type="button">Run</button>
      </XStage>,
    );

    const scaledSurface = container.firstElementChild?.firstElementChild;
    expect(scaledSurface).toHaveAttribute("inert");
  });
});
