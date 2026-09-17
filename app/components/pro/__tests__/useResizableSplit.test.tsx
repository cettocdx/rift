import { act, render, renderHook } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import { useResizableSplit } from "../useResizableSplit";

describe("useResizableSplit", () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrameId = 1;
  let notifyResize: () => void;
  const disconnectObserver = jest.fn();

  const createResizeTarget = ({
    right = 1_000,
    width = 1_000,
  }: { right?: number; width?: number } = {}) => {
    const root = document.createElement("div");
    const handle = document.createElement("div");
    const pane = document.createElement("div");
    const setPointerCapture = jest.fn();
    const hasPointerCapture = jest.fn(() => true);
    const releasePointerCapture = jest.fn();

    Object.defineProperty(root, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ right, width }),
    });
    Object.defineProperties(handle, {
      setPointerCapture: { configurable: true, value: setPointerCapture },
      hasPointerCapture: { configurable: true, value: hasPointerCapture },
      releasePointerCapture: {
        configurable: true,
        value: releasePointerCapture,
      },
    });
    root.append(handle, pane);
    document.body.append(root);

    return {
      handle,
      pane,
      setPointerCapture,
      releasePointerCapture,
    };
  };

  const flushNextFrame = () => {
    const frame = frames.values().next().value;
    expect(frame).toBeDefined();
    act(() => frame?.(16));
  };

  beforeEach(() => {
    localStorage.removeItem("rift:pro:split-ratio");
    document.body.innerHTML = "";
    document.documentElement.style.cursor = "";
    document.documentElement.style.userSelect = "";
    delete document.documentElement.dataset.riftPanelResizing;
    notifyResize = () => {};
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class {
        constructor(callback: () => void) {
          notifyResize = callback;
        }
        observe() {}
        disconnect = disconnectObserver;
      },
    });
    window.dispatchEvent(
      new StorageEvent("storage", { key: "rift:pro:split-ratio" }),
    );
    frames.clear();
    nextFrameId = 1;
    jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        const id = nextFrameId++;
        frames.set(id, callback);
        return id;
      });
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    document.body.innerHTML = "";
    document.documentElement.style.cursor = "";
    document.documentElement.style.userSelect = "";
    delete document.documentElement.dataset.riftPanelResizing;
  });

  it("clamps a saved 72% on open and restores it when the container widens", () => {
    localStorage.setItem("rift:pro:split-ratio", "0.72");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "rift:pro:split-ratio" }),
    );
    let width = 1_000;
    jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(() => ({ width, right: width }) as DOMRect);
    function Split({ open }: { open: boolean }) {
      const split = useResizableSplit(open);
      return (
        <div>
          <div role="separator" {...split.handleProps} />
          <div data-testid="pane" style={{ width: `${split.ratio * 100}%` }} />
        </div>
      );
    }
    const view = render(<Split open={false} />);
    view.rerender(<Split open />);
    expect(view.getByTestId("pane").style.width).toBe("60%");
    expect(
      width *
        (1 - Number.parseFloat(view.getByTestId("pane").style.width) / 100),
    ).toBeGreaterThanOrEqual(400);
    expect(view.getByRole("separator")).toHaveAttribute("aria-valuemax", "60");
    expect(view.getByRole("separator")).toHaveAttribute("aria-valuenow", "60");
    expect(localStorage.getItem("rift:pro:split-ratio")).toBe("0.72");
    width = 1_600;
    act(() => notifyResize());
    expect(view.getByTestId("pane").style.width).toBe("72%");
    expect(view.getByRole("separator")).toHaveAttribute("aria-valuemax", "72");
    width = 500;
    act(() => notifyResize());
    expect(Number.parseFloat(view.getByTestId("pane").style.width)).toBeCloseTo(
      (280 / 680) * 100,
    );
    expect(view.getByRole("separator")).toHaveAttribute("aria-valuemin", "41");
    expect(view.getByRole("separator")).toHaveAttribute("aria-valuemax", "41");
    expect(localStorage.getItem("rift:pro:split-ratio")).toBe("0.72");
    view.unmount();
    expect(disconnectObserver).toHaveBeenCalled();
  });

  it("uses the visible clamped width for keyboard steps and narrow pointer bounds", () => {
    localStorage.setItem("rift:pro:split-ratio", "0.72");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "rift:pro:split-ratio" }),
    );
    const { result } = renderHook(() => useResizableSplit(true));
    const target = createResizeTarget();
    act(() => {
      result.current.handleProps.onKeyDown({
        key: "ArrowRight",
        shiftKey: false,
        currentTarget: target.handle,
        preventDefault: jest.fn(),
      } as never);
    });
    expect(result.current.ratio).toBeCloseTo(0.58);
    act(() => {
      result.current.handleProps.onKeyDown({
        key: "ArrowLeft",
        shiftKey: true,
        currentTarget: target.handle,
        preventDefault: jest.fn(),
      } as never);
    });
    expect(result.current.ratio).toBe(0.6);
    const narrow = createResizeTarget({ width: 500, right: 500 });
    act(() => {
      result.current.handleProps.onPointerDown({
        button: 0,
        isPrimary: true,
        currentTarget: narrow.handle,
        pointerId: 7,
        preventDefault: jest.fn(),
      } as never);
      result.current.handleProps.onPointerMove({ clientX: -100 } as never);
    });
    flushNextFrame();
    expect(Number.parseFloat(narrow.pane.style.width)).toBeCloseTo(
      (280 / 680) * 100,
      1,
    );
    expect(narrow.handle).toHaveAttribute("aria-valuemin", "41");
    expect(narrow.handle).toHaveAttribute("aria-valuemax", "41");
    act(() => result.current.handleProps.onLostPointerCapture());
    act(() => {
      result.current.handleProps.onKeyDown({
        key: "Home",
        currentTarget: narrow.handle,
        preventDefault: jest.fn(),
      } as never);
    });
    expect(result.current.ratio).toBeCloseTo(280 / 680);
  });

  it("resizes outside the React render loop and commits once on release", () => {
    const { result } = renderHook(() => useResizableSplit(true));
    const target = createResizeTarget();
    const preventDefault = jest.fn();

    act(() => result.current.handleProps.onDoubleClick());

    act(() => {
      result.current.handleProps.onPointerDown({
        button: 0,
        isPrimary: true,
        currentTarget: target.handle,
        pointerId: 1,
        preventDefault,
      } as never);
      result.current.handleProps.onPointerMove({
        currentTarget: target.handle,
        clientX: 700,
      } as never);
      result.current.handleProps.onPointerMove({
        currentTarget: target.handle,
        clientX: 600,
      } as never);
      result.current.handleProps.onPointerMove({
        currentTarget: target.handle,
        clientX: 500,
      } as never);
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(target.setPointerCapture).toHaveBeenCalledWith(1);
    expect(target.handle).toHaveAttribute("aria-valuemin", "28");
    expect(result.current.isResizing).toBe(true);
    expect(document.documentElement.style.cursor).toBe("col-resize");
    expect(document.documentElement.style.userSelect).toBe("none");
    expect(document.documentElement.dataset.riftPanelResizing).toBe("true");
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(result.current.ratio).toBe(0.42);
    expect(target.pane.style.width).toBe("");

    flushNextFrame();

    expect(result.current.ratio).toBe(0.42);
    expect(target.pane.style.width).toBe("50%");
    expect(target.handle).toHaveAttribute("aria-valuenow", "50");

    act(() => {
      result.current.handleProps.onPointerUp({
        currentTarget: target.handle,
        pointerId: 1,
      } as never);
    });

    expect(target.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(result.current.isResizing).toBe(false);
    expect(result.current.ratio).toBe(0.5);
    expect(localStorage.getItem("rift:pro:split-ratio")).toBe("0.5");
    expect(document.documentElement.style.cursor).toBe("");
    expect(document.documentElement.style.userSelect).toBe("");
    expect(document.documentElement.dataset.riftPanelResizing).toBeUndefined();
  });

  it("ignores non-primary and secondary-button pointer starts", () => {
    const { result } = renderHook(() => useResizableSplit(true));
    const target = createResizeTarget();

    act(() => {
      result.current.handleProps.onPointerDown({
        button: 2,
        isPrimary: true,
        currentTarget: target.handle,
        pointerId: 2,
        preventDefault: jest.fn(),
      } as never);
      result.current.handleProps.onPointerDown({
        button: 0,
        isPrimary: false,
        currentTarget: target.handle,
        pointerId: 3,
        preventDefault: jest.fn(),
      } as never);
    });

    expect(target.setPointerCapture).not.toHaveBeenCalled();
    expect(result.current.isResizing).toBe(false);
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("clamps pointer resizing to preserve 280 pixels for the panel and 400 for chat", () => {
    const { result } = renderHook(() => useResizableSplit(true));
    const target = createResizeTarget();

    act(() => {
      result.current.handleProps.onPointerDown({
        button: 0,
        isPrimary: true,
        currentTarget: target.handle,
        pointerId: 4,
        preventDefault: jest.fn(),
      } as never);
      result.current.handleProps.onPointerMove({ clientX: 999 } as never);
    });
    flushNextFrame();
    expect(target.pane.style.width).toBe("28%");

    act(() => {
      result.current.handleProps.onPointerMove({ clientX: -100 } as never);
    });
    flushNextFrame();
    expect(target.pane.style.width).toBe("60%");

    act(() => {
      result.current.handleProps.onPointerUp({
        currentTarget: target.handle,
        pointerId: 4,
      } as never);
    });
    expect(Number(localStorage.getItem("rift:pro:split-ratio"))).toBe(0.6);
  });

  it("commits pending width and restores the document when capture is lost", () => {
    const { result } = renderHook(() => useResizableSplit(true));
    const target = createResizeTarget();

    act(() => {
      result.current.handleProps.onPointerDown({
        button: 0,
        isPrimary: true,
        currentTarget: target.handle,
        pointerId: 5,
        preventDefault: jest.fn(),
      } as never);
      result.current.handleProps.onPointerMove({ clientX: 620 } as never);
      result.current.handleProps.onLostPointerCapture();
    });

    expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(Number(localStorage.getItem("rift:pro:split-ratio"))).toBeCloseTo(
      0.38,
    );
    expect(result.current.isResizing).toBe(false);
    expect(document.documentElement.style.cursor).toBe("");
    expect(document.documentElement.style.userSelect).toBe("");

    act(() => {
      result.current.handleProps.onPointerMove({ clientX: 500 } as never);
    });
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it("exposes separator values and resizes the right pane with arrow keys", () => {
    const { result } = renderHook(() => useResizableSplit(true));
    const target = {
      parentElement: {
        getBoundingClientRect: () => ({ width: 1_000 }),
      },
    };

    act(() => {
      result.current.handleProps.onDoubleClick();
    });

    expect(result.current.handleProps.tabIndex).toBe(0);
    expect(result.current.handleProps["aria-valuemin"]).toBe(23);
    expect(result.current.handleProps["aria-valuemax"]).toBe(72);
    expect(result.current.handleProps["aria-valuenow"]).toBe(42);
    expect(result.current.handleProps["aria-valuetext"]).toBe(
      "42% panel width",
    );

    const moveLeft = jest.fn();
    act(() => {
      result.current.handleProps.onKeyDown({
        key: "ArrowLeft",
        shiftKey: false,
        currentTarget: target,
        preventDefault: moveLeft,
      } as never);
    });

    expect(moveLeft).toHaveBeenCalledTimes(1);
    expect(result.current.ratio).toBeCloseTo(0.44);
    expect(result.current.handleProps["aria-valuenow"]).toBe(44);
    expect(Number(localStorage.getItem("rift:pro:split-ratio"))).toBeCloseTo(
      0.44,
    );

    const moveRight = jest.fn();
    act(() => {
      result.current.handleProps.onKeyDown({
        key: "ArrowRight",
        shiftKey: false,
        currentTarget: target,
        preventDefault: moveRight,
      } as never);
    });

    expect(moveRight).toHaveBeenCalledTimes(1);
    expect(result.current.ratio).toBeCloseTo(0.42);
  });

  it("supports Home, End, and accelerated keyboard resizing", () => {
    const { result } = renderHook(() => useResizableSplit(true));
    const target = {
      parentElement: {
        getBoundingClientRect: () => ({ width: 800 }),
      },
    };

    act(() => {
      result.current.handleProps.onDoubleClick();
      result.current.handleProps.onKeyDown({
        key: "Home",
        shiftKey: false,
        currentTarget: target,
        preventDefault: jest.fn(),
      } as never);
    });
    expect(result.current.ratio).toBe(0.35);

    act(() => {
      result.current.handleProps.onKeyDown({
        key: "End",
        shiftKey: false,
        currentTarget: target,
        preventDefault: jest.fn(),
      } as never);
    });
    expect(result.current.ratio).toBe(0.5);

    act(() => {
      result.current.handleProps.onKeyDown({
        key: "ArrowRight",
        shiftKey: true,
        currentTarget: target,
        preventDefault: jest.fn(),
      } as never);
    });
    expect(result.current.ratio).toBeCloseTo(0.4);
  });

  it("updates the accessible minimum from the actual split width on focus", () => {
    const { result } = renderHook(() => useResizableSplit(true));
    const target = createResizeTarget({ width: 800 });

    act(() => {
      result.current.handleProps.onFocus({
        currentTarget: target.handle,
      } as never);
    });

    expect(target.handle).toHaveAttribute("aria-valuemin", "35");
    expect(target.handle).toHaveAttribute("aria-valuemax", "50");
  });

  it("disables pointer and keyboard access while the pane is closed", () => {
    const { result } = renderHook(() => useResizableSplit(false));
    const target = createResizeTarget();

    expect(result.current.handleProps.tabIndex).toBe(-1);
    expect(result.current.handleProps["aria-disabled"]).toBe(true);

    act(() => {
      result.current.handleProps.onPointerDown({
        button: 0,
        isPrimary: true,
        currentTarget: target.handle,
        pointerId: 6,
        preventDefault: jest.fn(),
      } as never);
      result.current.handleProps.onKeyDown({
        key: "End",
        currentTarget: target.handle,
        preventDefault: jest.fn(),
      } as never);
    });

    expect(target.setPointerCapture).not.toHaveBeenCalled();
    expect(result.current.isResizing).toBe(false);
    expect(localStorage.getItem("rift:pro:split-ratio")).toBeNull();
  });
});
