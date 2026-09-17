import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useWorkbenchTitlebarInset } from "../useWorkbenchTitlebarInset";

const PROPERTY = "--rift-workbench-titlebar-inset";
const observers = new Set<() => void>();
let width = 380;

function Fixture({
  enabled = true,
  mounted = true,
  paneKey = "first",
}: {
  enabled?: boolean;
  mounted?: boolean;
  paneKey?: string;
}) {
  const paneRef = useWorkbenchTitlebarInset(enabled);
  return (
    <div className="pro-shell" data-testid="shell">
      <div data-rift-native-titlebar="window">
        <button>Open browser</button>
      </div>
      <main>
        {mounted && <div key={paneKey} ref={paneRef} data-testid="pane" />}
      </main>
    </div>
  );
}

beforeEach(() => {
  width = 380;
  observers.clear();
  jest
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      const measuredWidth = this.dataset.testid === "pane" ? width : 1228;
      return {
        x: 1228 - measuredWidth,
        y: 0,
        left: 1228 - measuredWidth,
        top: 0,
        right: 1228,
        bottom: 768,
        width: measuredWidth,
        height: 768,
        toJSON: () => ({}),
      };
    });
  global.ResizeObserver = class {
    constructor(private callback: () => void) {}
    observe() {
      observers.add(this.callback);
    }
    disconnect() {
      observers.delete(this.callback);
    }
    unobserve() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function inset() {
  return screen.getByTestId("shell").style.getPropertyValue(PROPERTY);
}

it("publishes right dock geometry on the common titlebar ancestor", () => {
  render(<Fixture />);
  expect(inset()).toBe("380px");
  expect(screen.getByRole("button").closest(".pro-shell")).toBe(
    screen.getByTestId("shell"),
  );
});

it("tracks opening transition, resize, and final maximized widths", () => {
  width = 0;
  render(<Fixture />);
  for (const nextWidth of [96.5, 220, 380, 520, 984]) {
    act(() => {
      width = nextWidth;
      observers.forEach((callback) => callback());
    });
    expect(inset()).toBe(`${nextWidth}px`);
  }
});

it("resets for hidden, bottom, or mobile layout and resumes measurement", () => {
  const { rerender } = render(<Fixture />);
  rerender(<Fixture enabled={false} />);
  expect(inset()).toBe("0px");
  act(() => {
    width = 1228;
    observers.forEach((callback) => callback());
  });
  expect(inset()).toBe("0px");
  width = 440;
  rerender(<Fixture />);
  expect(inset()).toBe("440px");
});

it("measures a pane attached after the first render without toggling the dock", () => {
  const { rerender } = render(<Fixture mounted={false} />);
  expect(inset()).toBe("");
  rerender(<Fixture />);
  expect(inset()).toBe("380px");
  expect(observers.size).toBe(1);
});

it("releases detached panes and observes a replacement without stale measurements", () => {
  const { rerender } = render(<Fixture />);
  rerender(<Fixture mounted={false} />);
  expect(inset()).toBe("");
  expect(observers.size).toBe(0);
  width = 500;
  rerender(<Fixture paneKey="replacement" />);
  expect(inset()).toBe("500px");
  expect(observers.size).toBe(1);
});

it("removes its geometry on unmount", () => {
  const { unmount } = render(<Fixture />);
  const shell = screen.getByTestId("shell");
  unmount();
  expect(shell.style.getPropertyValue(PROPERTY)).toBe("");
  expect(observers.size).toBe(0);
});

it("ignores queued stale observer callbacks after the dock stops owning width", () => {
  const { rerender } = render(<Fixture />);
  const staleCallbacks = Array.from(observers);
  rerender(<Fixture enabled={false} />);
  act(() => staleCallbacks.forEach((callback) => callback()));
  expect(inset()).toBe("0px");
});

it("restores existing shell geometry when a conditionally mounted pane leaves", () => {
  const { rerender } = render(<Fixture mounted={false} />);
  const shell = screen.getByTestId("shell");
  shell.style.setProperty(PROPERTY, "12px");
  rerender(<Fixture />);
  expect(inset()).toBe("380px");
  rerender(<Fixture mounted={false} />);
  expect(inset()).toBe("12px");
});
