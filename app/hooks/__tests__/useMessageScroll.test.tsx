import { act, fireEvent, renderHook } from "@testing-library/react";
import { useMessageScroll } from "../useMessageScroll";
import type { ChatScrollPosition } from "@/app/contexts/ChatViewStateContext";

let resize: ResizeObserverCallback;
const observe = jest.fn();
const disconnect = jest.fn();
const unobserve = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  global.ResizeObserver = jest.fn(function (callback) {
    resize = callback;
    return { observe, disconnect, unobserve };
  }) as never;
});
function setup(saved?: { top: number; atBottom: boolean }) {
  const view: { scroll?: { top: number; atBottom: boolean } } = {
    scroll: saved,
  };
  const scroll = document.createElement("div");
  const content = document.createElement("div");
  const anchor = document.createElement("p");
  content.append(anchor);
  scroll.append(content);
  document.body.append(scroll);
  let height = 2000,
    width = 800,
    anchorTop = 380;
  Object.defineProperties(scroll, {
    scrollHeight: { get: () => height, configurable: true },
    clientHeight: { value: 400, configurable: true },
    clientWidth: { get: () => width, configurable: true },
  });
  scroll.getBoundingClientRect = () =>
    ({
      top: 0,
      bottom: 400,
      left: 0,
      right: width,
      width,
      height: 400,
    }) as DOMRect;
  anchor.getBoundingClientRect = () =>
    ({
      top: anchorTop - scroll.scrollTop,
      bottom: anchorTop - scroll.scrollTop + 60,
    }) as DOMRect;
  const hook = renderHook(
    ({ visible }) => {
      const result = useMessageScroll(view, visible);
      result.scrollRef.current = scroll;
      result.contentRef.current = content;
      return result;
    },
    { initialProps: { visible: true } },
  );
  return {
    ...hook,
    view,
    scroll,
    content,
    anchor,
    layoutBeforeScroll: (nextHeight: number) => {
      height = nextHeight;
    },
    grow: (nextHeight: number, nextAnchor = anchorTop, nextWidth = width) => {
      height = nextHeight;
      anchorTop = nextAnchor;
      width = nextWidth;
      act(() => resize([], {} as ResizeObserver));
    },
    dispose: () => {
      hook.unmount();
      scroll.remove();
    },
  };
}
it("restores a reading position before paint and remembers user scrolls", () => {
  const h = setup({ top: 380, atBottom: false });
  expect(h.scroll.scrollTop).toBe(380);
  h.scroll.scrollTop = 650;
  fireEvent.scroll(h.scroll);
  expect(h.view.scroll).toEqual({ top: 650, atBottom: false });
  h.dispose();
});
it("follows growth immediately without a repeated spring animation", () => {
  const h = setup();
  expect(h.scroll.scrollTop).toBe(1600);
  h.grow(2500);
  expect(h.scroll.scrollTop).toBe(2100);
  h.dispose();
});
it("keeps the pressed control under the pointer when streaming reflows other blocks", () => {
  const h = setup({ top: 380, atBottom: false });
  const button = document.createElement("button");
  const label = document.createElement("span");
  button.append(label);
  h.content.append(button);
  let buttonTop = 600;
  button.getBoundingClientRect = () =>
    ({
      top: buttonTop - h.scroll.scrollTop,
      bottom: buttonTop - h.scroll.scrollTop + 40,
    }) as DOMRect;
  fireEvent.pointerDown(label);
  buttonTop += 60;
  h.grow(2060);
  expect(button.getBoundingClientRect().top).toBe(220);
  expect(h.scroll.scrollTop).toBe(440);
  expect(h.result.current.isAtBottom).toBe(false);
  h.dispose();
});
it("retains a control hit against WebKit's previous painted geometry", () => {
  const h = setup({ top: 380, atBottom: false });
  const button = document.createElement("button");
  h.content.append(button);
  button.getBoundingClientRect = () =>
    ({
      top: 700 - h.scroll.scrollTop,
      bottom: 740 - h.scroll.scrollTop,
      height: 40,
    }) as DOMRect;
  // The browser selected this control at y=250 before its layout moved to 320.
  const down = new Event("pointerdown", { bubbles: true });
  Object.defineProperties(down, {
    clientY: { value: 250 },
    button: { value: 0 },
    isPrimary: { value: true },
  });
  fireEvent(button, down);
  expect(button.getBoundingClientRect().top).toBeLessThan(250);
  expect(button.getBoundingClientRect().bottom).toBeGreaterThan(250);
  expect(h.scroll.scrollTop).toBe(470);
  h.dispose();
});
it("does not detach following for a text press or secondary button", () => {
  const h = setup();
  fireEvent.pointerDown(h.anchor);
  const button = document.createElement("button");
  h.content.append(button);
  const secondary = new Event("pointerdown", { bubbles: true });
  Object.defineProperty(secondary, "button", { value: 2 });
  fireEvent(button, secondary);
  expect(h.result.current.isAtBottom).toBe(true);
  h.grow(2500);
  expect(h.scroll.scrollTop).toBe(2100);
  h.dispose();
});
it.each(["button", "summary", "div"])(
  "restores a pressed %s after history height changes",
  (tag) => {
    const view: { scroll?: ChatScrollPosition } = {
      scroll: { top: 380, atBottom: false },
    };
    const scroll = document.createElement("div");
    const content = document.createElement("div");
    const row = document.createElement("article");
    row.dataset.messageId = "controls";
    const control = document.createElement(tag);
    if (tag === "div") control.setAttribute("role", "button");
    control.textContent = "Show details";
    row.append(control);
    content.append(row);
    scroll.append(content);
    document.body.append(scroll);
    let controlTop = 600;
    Object.defineProperties(scroll, {
      scrollHeight: { value: 3000 },
      clientHeight: { value: 400 },
      clientWidth: { value: 800 },
    });
    scroll.getBoundingClientRect = () => ({ top: 0, bottom: 400 }) as DOMRect;
    row.getBoundingClientRect = () =>
      ({
        top: controlTop - 100 - scroll.scrollTop,
        bottom: controlTop + 100 - scroll.scrollTop,
      }) as DOMRect;
    control.getBoundingClientRect = () =>
      ({
        top: controlTop - scroll.scrollTop,
        bottom: controlTop + 40 - scroll.scrollTop,
        height: 40,
      }) as DOMRect;
    const mount = () =>
      renderHook(() => {
        const result = useMessageScroll(view);
        result.scrollRef.current = scroll;
        result.contentRef.current = content;
        return result;
      });
    const first = mount();
    fireEvent.pointerDown(control);
    expect(view.scroll?.anchor?.text).toBe("Show details");
    first.unmount();
    controlTop += 240;
    scroll.scrollTop = 0;
    const second = mount();
    expect(control.getBoundingClientRect().top).toBe(220);
    second.unmount();
    scroll.remove();
  },
);
it("rearms only a stale content observation while correcting position immediately", () => {
  const schedule = jest
    .spyOn(window, "requestAnimationFrame")
    .mockReturnValue(123);
  const cancel = jest
    .spyOn(window, "cancelAnimationFrame")
    .mockImplementation(() => {});
  const h = setup();
  Object.defineProperties(h.content, {
    offsetHeight: { value: 2000 },
    offsetWidth: { value: 800 },
  });
  const deliver = (height: number) =>
    act(() =>
      resize(
        [
          {
            target: h.content,
            borderBoxSize: [{ blockSize: height, inlineSize: 800 }],
          } as unknown as ResizeObserverEntry,
        ],
        {} as ResizeObserver,
      ),
    );
  try {
    deliver(2000);
    expect(unobserve).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    h.scroll.scrollTop = 0;
    deliver(1900);
    expect(h.scroll.scrollTop).toBe(1600);
    expect(unobserve).toHaveBeenCalledWith(h.content);
    expect(schedule).toHaveBeenCalledTimes(1);
    act(() => schedule.mock.calls[0][0](0));
    expect(observe).toHaveBeenLastCalledWith(h.content);
    deliver(2000);
    expect(schedule).toHaveBeenCalledTimes(1);
    deliver(1800);
    h.dispose();
    expect(cancel).toHaveBeenCalledWith(123);
  } finally {
    schedule.mockRestore();
    cancel.mockRestore();
  }
});
it("keeps the same visible paragraph when a panel narrows the transcript", () => {
  const h = setup({ top: 380, atBottom: false });
  h.grow(2800, 760, 420);
  expect(h.scroll.scrollTop).toBe(760);
  expect(h.anchor.getBoundingClientRect().top).toBe(0);
  expect(h.result.current.isAtBottom).toBe(false);
  h.dispose();
});
it("keeps reading anchored when an image above finishes loading", () => {
  const h = setup({ top: 380, atBottom: false });
  h.grow(2300, 680);
  expect(h.scroll.scrollTop).toBe(680);
  h.dispose();
});
it("never reattaches following when a shrinking layout happens to reach the bottom", () => {
  const h = setup({ top: 380, atBottom: false });
  h.grow(500, 100);
  fireEvent.scroll(h.scroll);
  h.grow(1500, 100);
  expect(h.scroll.scrollTop).toBe(100);
  expect(h.result.current.isAtBottom).toBe(false);
  h.dispose();
});
it("lets a wheel-up interrupt following and an explicit jump resume it", () => {
  const h = setup();
  fireEvent.wheel(h.scroll, { deltaY: -120 });
  h.scroll.scrollTop = 1200;
  fireEvent.scroll(h.scroll);
  h.grow(2400);
  expect(h.scroll.scrollTop).toBe(1200);
  act(() => {
    h.result.current.scrollToBottom({ instant: true, force: true });
  });
  h.grow(2600);
  expect(h.scroll.scrollTop).toBe(2200);
  h.dispose();
});
it.each([false, true])(
  "honors a reader scroll when skipped content changes height before its scroll event (wheel=%s)",
  (wheel) => {
    const h = setup({ top: 380, atBottom: false });
    if (wheel) fireEvent.wheel(h.scroll, { deltaY: -120 });
    h.scroll.scrollTop = 300;
    h.layoutBeforeScroll(2400);
    fireEvent.scroll(h.scroll);
    expect(h.scroll.scrollTop).toBe(300);
    expect(h.view.scroll?.top).toBe(300);
    expect(h.result.current.isAtBottom).toBe(false);
    h.grow(2600, 580);
    expect(h.anchor.getBoundingClientRect().top).toBe(80);
    h.dispose();
  },
);

it("preserves reader intent when content shrink clamps scroll before observer delivery", () => {
  const h = setup({ top: 380, atBottom: false });
  h.layoutBeforeScroll(600);
  h.scroll.scrollTop = 200;
  fireEvent.scroll(h.scroll);
  expect(h.result.current.isAtBottom).toBe(false);
  h.dispose();
});

it("detaches following when a scrollbar jump materializes older messages", () => {
  const h = setup();
  h.scroll.scrollTop = 300;
  h.layoutBeforeScroll(2400);
  fireEvent.scroll(h.scroll);
  expect(h.scroll.scrollTop).toBe(300);
  expect(h.result.current.isAtBottom).toBe(false);
  h.grow(2600);
  expect(h.scroll.scrollTop).toBe(300);
  h.dispose();
});
it("disconnects the resize observer on unmount", () => {
  const h = setup();
  h.dispose();
  expect(disconnect).toHaveBeenCalled();
});
it("attaches when an existing chat's messages arrive after the first render", () => {
  const view = {};
  const { result, unmount } = renderHook(() => useMessageScroll(view, true));
  const element = document.createElement("div"),
    content = document.createElement("div");
  Object.defineProperties(element, {
    scrollHeight: { value: 1000 },
    clientHeight: { value: 400 },
  });
  act(() => {
    result.current.scrollRef(element);
    result.current.contentRef(content);
  });
  expect(element.scrollTop).toBe(600);
  expect(observe).toHaveBeenCalledWith(content);
  unmount();
});
it("waits for a previously hidden scroll surface", () => {
  const view = {};
  const h = renderHook(({ visible }) => useMessageScroll(view, visible), {
    initialProps: { visible: false },
  });
  const element = document.createElement("div"),
    content = document.createElement("div");
  Object.defineProperties(element, {
    scrollHeight: { value: 1200 },
    clientHeight: { value: 400 },
  });
  act(() => {
    h.result.current.scrollRef(element);
    h.result.current.contentRef(content);
  });
  expect(observe).not.toHaveBeenCalled();
  h.rerender({ visible: true });
  expect(element.scrollTop).toBe(800);
  h.unmount();
});
it("honors keyboard reading intent during incoming output", () => {
  const h = setup();
  fireEvent.keyDown(h.scroll, { key: "PageUp" });
  h.scroll.scrollTop = 900;
  fireEvent.scroll(h.scroll);
  h.grow(3000);
  expect(h.scroll.scrollTop).toBe(900);
  expect(h.result.current.isAtBottom).toBe(false);
  h.dispose();
});

it("finds the reading anchor without measuring every paragraph in offscreen messages", () => {
  const scroll = document.createElement("div");
  const content = document.createElement("div");
  scroll.append(content);
  document.body.append(scroll);
  let addedHeight = 0;
  let reads = 0;
  const view = { scroll: { top: 398000, atBottom: false } };
  Object.defineProperties(scroll, {
    scrollHeight: { get: () => 400000 + addedHeight },
    clientHeight: { value: 400 },
    clientWidth: { value: 800 },
  });
  scroll.getBoundingClientRect = () => ({ top: 0, bottom: 400 }) as DOMRect;
  for (let i = 0; i < 200; i++) {
    const row = document.createElement("article");
    row.dataset.messageId = `row-${i}`;
    row.getBoundingClientRect = () => {
      reads++;
      return {
        top: i * 2000 + addedHeight - scroll.scrollTop,
        bottom: (i + 1) * 2000 + addedHeight - scroll.scrollTop,
      } as DOMRect;
    };
    for (let j = 0; j < 20; j++) {
      const paragraph = document.createElement("p");
      paragraph.getBoundingClientRect = () => {
        reads++;
        return {
          top: i * 2000 + j * 100 + addedHeight - scroll.scrollTop,
          bottom: i * 2000 + (j + 1) * 100 + addedHeight - scroll.scrollTop,
        } as DOMRect;
      };
      row.append(paragraph);
    }
    content.append(row);
  }
  const hook = renderHook(() => {
    const result = useMessageScroll(view);
    result.scrollRef.current = scroll;
    result.contentRef.current = content;
    return result;
  });
  expect(reads).toBeLessThanOrEqual(30);
  addedHeight = 240;
  act(() => resize([], {} as ResizeObserver));
  expect(scroll.scrollTop).toBe(398240);
  expect(hook.result.current.isAtBottom).toBe(false);
  hook.unmount();
  scroll.remove();
});

it("preserves a semantic reading anchor while a question/keyboard hides the transcript", () => {
  const h = setup({ top: 380, atBottom: false });
  Object.defineProperty(h.scroll, "clientHeight", {
    value: 0,
    configurable: true,
  });
  h.scroll.getBoundingClientRect = () =>
    ({ top: 0, bottom: 0, height: 0, width: 800 }) as DOMRect;
  h.grow(2000); // The anchored paragraph is exactly at the zero-height boundary.
  h.grow(2800, 760, 420); // Hidden panel reflow moves that same paragraph.
  Object.defineProperty(h.scroll, "clientHeight", {
    value: 400,
    configurable: true,
  });
  h.scroll.getBoundingClientRect = () =>
    ({ top: 0, bottom: 400, height: 400, width: 420 }) as DOMRect;
  h.grow(2800, 760, 420);
  expect(h.scroll.scrollTop).toBe(760);
  expect(h.result.current.isAtBottom).toBe(false);
  h.dispose();
});

it.each([
  {
    name: "same block",
    messageId: "message-19",
    index: 1,
    text: "Detail",
    duplicate: false,
    expected: 772,
  },
  {
    name: "uniquely moved block",
    messageId: "message-19",
    index: 9,
    text: "Detail",
    duplicate: false,
    expected: 772,
  },
  {
    name: "missing message",
    messageId: "removed",
    index: 1,
    text: "Detail",
    duplicate: false,
    expected: 380,
  },
  {
    name: "changed text",
    messageId: "message-19",
    index: 1,
    text: "Replaced",
    duplicate: false,
    expected: 380,
  },
  {
    name: "ambiguous moved block",
    messageId: "message-19",
    index: 9,
    text: "Detail",
    duplicate: true,
    expected: 380,
  },
])(
  "restores retained $name or uses numeric fallback",
  ({ messageId, index, text, duplicate, expected }) => {
    const view = {
      scroll: {
        top: 380,
        atBottom: false,
        anchor: { messageId, selector: "h2", index, text, offset: -12 },
      },
    };
    const scroll = document.createElement("div");
    const content = document.createElement("div");
    const row = document.createElement("article");
    row.dataset.messageId = "message-19";
    row.style.setProperty("content-visibility", "auto", "important");
    row.innerHTML = "<h2>Section</h2><p>Earlier paragraph</p><h2>Detail</h2>";
    if (duplicate) row.insertAdjacentHTML("beforeend", "<h2>Detail</h2>");
    content.append(row);
    scroll.append(content);
    document.body.append(scroll);
    Object.defineProperties(scroll, {
      scrollHeight: { value: 3000 },
      clientHeight: { value: 400 },
      clientWidth: { value: 390 },
    });
    scroll.getBoundingClientRect = () => ({ top: 0, bottom: 400 }) as DOMRect;
    row.getBoundingClientRect = () =>
      ({
        top: 400 - scroll.scrollTop,
        bottom: 1200 - scroll.scrollTop,
      }) as DOMRect;
    const target = row.querySelectorAll("h2")[1];
    target.getBoundingClientRect = () =>
      ({
        top: 760 - scroll.scrollTop,
        bottom: 800 - scroll.scrollTop,
      }) as DOMRect;
    const hook = renderHook(() => {
      const result = useMessageScroll(view);
      result.scrollRef.current = scroll;
      result.contentRef.current = content;
      return result;
    });
    expect(scroll.scrollTop).toBe(expected);
    expect(hook.result.current.isAtBottom).toBe(false);
    if (expected === 772)
      expect(view.scroll.anchor).toEqual({
        messageId: "message-19",
        selector: "h2",
        index: 1,
        text: "Detail",
        offset: -12,
      });
    if (expected === 772 && index === 9) {
      const schedule = jest
        .spyOn(window, "requestAnimationFrame")
        .mockReturnValue(123);
      const cancel = jest
        .spyOn(window, "cancelAnimationFrame")
        .mockImplementation(() => {});
      target.remove();
      act(() => resize([], {} as ResizeObserver));
      expect(schedule).toHaveBeenCalledTimes(1);
      // Observer delivery does not mutate layout; cleanup cancels its release.
      expect(row.style.contentVisibility).toBe("visible");
      hook.unmount();
      expect(cancel).toHaveBeenCalledWith(123);
      expect(row.style.contentVisibility).toBe("auto");
      expect(row.style.getPropertyPriority("content-visibility")).toBe(
        "important",
      );
      schedule.mockRestore();
      cancel.mockRestore();
      scroll.remove();
      return;
    }
    if (expected === 772) {
      expect(row.style.contentVisibility).toBe("visible");
      act(() => {
        hook.result.current.scrollToBottom({ instant: true, force: true });
      });
      expect(row.style.contentVisibility).toBe("auto");
      expect(row.style.getPropertyPriority("content-visibility")).toBe(
        "important",
      );
      expect(view.scroll.anchor).toBeUndefined();
    }
    hook.unmount();
    expect(row.style.contentVisibility).toBe("auto");
    expect(row.style.getPropertyPriority("content-visibility")).toBe(
      "important",
    );
    scroll.remove();
  },
);

it("does not force layout for each wheel event once the reader has left follow mode", () => {
  const h = setup({ top: 380, atBottom: false });
  const rect = jest.spyOn(h.anchor, "getBoundingClientRect");
  for (let index = 0; index < 20; index++) {
    fireEvent.wheel(h.scroll, { deltaY: -3 });
  }
  expect(rect).not.toHaveBeenCalled();
  h.scroll.scrollTop = 320;
  fireEvent.scroll(h.scroll);
  expect(h.view.scroll?.top).toBe(320);
  h.dispose();
});
