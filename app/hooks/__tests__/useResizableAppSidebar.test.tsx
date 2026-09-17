import { act, renderHook } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import {
  APP_SIDEBAR_DEFAULT_WIDTH,
  APP_SIDEBAR_MAX_WIDTH,
  APP_SIDEBAR_MIN_WIDTH,
  APP_SIDEBAR_STORAGE_KEY,
  useResizableAppSidebar,
} from "../useResizableAppSidebar";

describe("useResizableAppSidebar", () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrameId = 1;

  beforeEach(() => {
    window.localStorage.removeItem(APP_SIDEBAR_STORAGE_KEY);
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
    document.documentElement.style.cursor = "";
    document.documentElement.style.userSelect = "";
    jest.restoreAllMocks();
  });

  it("restores a persisted desktop width and clamps invalid extremes", () => {
    window.localStorage.setItem(APP_SIDEBAR_STORAGE_KEY, "356");
    const stored = renderHook(() => useResizableAppSidebar(true));
    expect(stored.result.current.width).toBe(356);
    stored.unmount();

    window.localStorage.setItem(APP_SIDEBAR_STORAGE_KEY, "9999");
    const clamped = renderHook(() => useResizableAppSidebar(true));
    expect(clamped.result.current.width).toBe(APP_SIDEBAR_MAX_WIDTH);
  });

  it("coalesces pointer moves, persists on release, and restores document state", () => {
    const { result } = renderHook(() => useResizableAppSidebar(true));
    const target = {
      parentElement: {
        getBoundingClientRect: () => ({ left: 24 }),
      },
      setPointerCapture: jest.fn(),
      hasPointerCapture: jest.fn(() => true),
      releasePointerCapture: jest.fn(),
    };

    act(() => {
      result.current.handleProps.onPointerDown({
        button: 0,
        currentTarget: target,
        pointerId: 4,
        preventDefault: jest.fn(),
      } as never);
      result.current.handleProps.onPointerMove({
        clientX: 304,
        currentTarget: target,
      } as never);
      result.current.handleProps.onPointerMove({
        clientX: 344,
        currentTarget: target,
      } as never);
    });

    expect(target.setPointerCapture).toHaveBeenCalledWith(4);
    expect(document.documentElement.style.cursor).toBe("col-resize");
    expect(result.current.isResizing).toBe(true);
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);

    const frame = frames.values().next().value;
    act(() => frame?.(16));
    expect(result.current.width).toBe(320);

    act(() => {
      result.current.handleProps.onPointerUp({
        currentTarget: target,
        pointerId: 4,
      } as never);
    });

    expect(target.releasePointerCapture).toHaveBeenCalledWith(4);
    expect(window.localStorage.getItem(APP_SIDEBAR_STORAGE_KEY)).toBe("320");
    expect(result.current.width).toBe(320);
    expect(result.current.isResizing).toBe(false);
    expect(document.documentElement.style.cursor).toBe("");
    expect(document.documentElement.style.userSelect).toBe("");
  });

  it("supports arrow, accelerated arrow, Home, End, and reset controls", () => {
    const { result } = renderHook(() => useResizableAppSidebar(true));
    const preventDefault = jest.fn();

    expect(result.current.handleProps["aria-valuemin"]).toBe(
      APP_SIDEBAR_MIN_WIDTH,
    );
    expect(result.current.handleProps["aria-valuemax"]).toBe(
      APP_SIDEBAR_MAX_WIDTH,
    );
    expect(result.current.handleProps["aria-valuenow"]).toBe(
      APP_SIDEBAR_DEFAULT_WIDTH,
    );

    act(() => {
      result.current.handleProps.onKeyDown({
        key: "ArrowRight",
        shiftKey: false,
        preventDefault,
      } as never);
    });
    expect(result.current.width).toBe(APP_SIDEBAR_DEFAULT_WIDTH + 8);

    act(() => {
      result.current.handleProps.onKeyDown({
        key: "ArrowRight",
        shiftKey: true,
        preventDefault,
      } as never);
    });
    expect(result.current.width).toBe(APP_SIDEBAR_DEFAULT_WIDTH + 40);

    act(() => {
      result.current.handleProps.onKeyDown({
        key: "Home",
        shiftKey: false,
        preventDefault,
      } as never);
    });
    expect(result.current.width).toBe(APP_SIDEBAR_MIN_WIDTH);

    act(() => {
      result.current.handleProps.onKeyDown({
        key: "End",
        shiftKey: false,
        preventDefault,
      } as never);
    });
    expect(result.current.width).toBe(APP_SIDEBAR_MAX_WIDTH);
    expect(preventDefault).toHaveBeenCalledTimes(4);

    act(() => result.current.handleProps.onDoubleClick());
    expect(result.current.width).toBe(APP_SIDEBAR_DEFAULT_WIDTH);
    expect(window.localStorage.getItem(APP_SIDEBAR_STORAGE_KEY)).toBe(
      String(APP_SIDEBAR_DEFAULT_WIDTH),
    );
  });

  it("stays inert when the mobile shell disables desktop resizing", () => {
    const { result } = renderHook(() => useResizableAppSidebar(false));
    const target = {
      parentElement: {
        getBoundingClientRect: () => ({ left: 0 }),
      },
      setPointerCapture: jest.fn(),
    };
    const preventDefault = jest.fn();

    act(() => {
      result.current.handleProps.onPointerDown({
        button: 0,
        currentTarget: target,
        pointerId: 1,
        preventDefault,
      } as never);
      result.current.handleProps.onPointerMove({
        clientX: 400,
        currentTarget: target,
      } as never);
      result.current.handleProps.onKeyDown({
        key: "End",
        shiftKey: false,
        preventDefault,
      } as never);
      result.current.handleProps.onDoubleClick();
    });

    expect(result.current.width).toBe(APP_SIDEBAR_DEFAULT_WIDTH);
    expect(result.current.handleProps.tabIndex).toBe(-1);
    expect(result.current.handleProps["aria-disabled"]).toBe(true);
    expect(target.setPointerCapture).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(APP_SIDEBAR_STORAGE_KEY)).toBeNull();
  });
});
