/** @jest-environment jsdom */
import { observeChatViewport } from "../ChatViewport";

const HEIGHT = "--rift-chat-viewport-height";
const OFFSET = "--rift-chat-viewport-offset";
const ACTIVE = "data-rift-visible-viewport";

describe("reported mobile visual viewport", () => {
  let view: EventTarget & { height: number; offsetTop: number; scale: number };
  let media: EventTarget & { matches: boolean };
  let frames: Map<number, FrameRequestCallback>;
  let node: HTMLDivElement;
  let cleanup: (() => void) | undefined;
  const originalViewport = Object.getOwnPropertyDescriptor(
    window,
    "visualViewport",
  );
  const originalMatchMedia = Object.getOwnPropertyDescriptor(
    window,
    "matchMedia",
  );
  const originalHeight = window.innerHeight;
  const flush = () => {
    const queued = [...frames.values()];
    frames.clear();
    for (const frame of queued) frame(0);
  };
  beforeEach(() => {
    view = Object.assign(new EventTarget(), {
      height: 400,
      offsetTop: 0,
      scale: 1,
    });
    media = Object.assign(new EventTarget(), { matches: true });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: view,
    });
    jest
      .spyOn(window, "matchMedia")
      .mockImplementation(() => media as unknown as MediaQueryList);
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 844,
    });
    frames = new Map();
    let nextId = 0;
    jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frames.set(++nextId, callback);
        return nextId;
      });
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    node = document.createElement("div");
    document.body.append(node);
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    node?.remove();
    jest.restoreAllMocks();
    if (originalViewport)
      Object.defineProperty(window, "visualViewport", originalViewport);
    else Reflect.deleteProperty(window, "visualViewport");
    if (originalMatchMedia)
      Object.defineProperty(window, "matchMedia", originalMatchMedia);
    else Reflect.deleteProperty(window, "matchMedia");
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalHeight,
    });
  });
  it("uses measured height and offset, then releases the shell when restored", () => {
    cleanup = observeChatViewport(node);
    expect(node.style.getPropertyValue(HEIGHT)).toBe("400px");
    view.offsetTop = 40;
    view.dispatchEvent(new Event("scroll"));
    flush();
    expect(node.style.getPropertyValue(OFFSET)).toBe("40px");
    view.height = 844;
    view.offsetTop = 0;
    view.dispatchEvent(new Event("resize"));
    flush();
    expect(node.hasAttribute(ACTIVE)).toBe(false);
    expect(node.style.getPropertyValue(HEIGHT)).toBe("");
  });
  it("keeps the iOS layout anchored when innerHeight shrinks with the keyboard", () => {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 377,
    });
    jest
      .spyOn(document.documentElement, "clientHeight", "get")
      .mockReturnValue(714);
    view.height = 377;
    view.offsetTop = 337;
    cleanup = observeChatViewport(node);
    expect(node.hasAttribute(ACTIVE)).toBe(true);
    expect(node.style.getPropertyValue(HEIGHT)).toBe("377px");
    expect(node.style.getPropertyValue(OFFSET)).toBe("337px");
  });
  it("coalesces events and does not rewrite stable geometry during scrolling", () => {
    cleanup = observeChatViewport(node);
    const writes = jest.spyOn(node.style, "setProperty");
    view.dispatchEvent(new Event("scroll"));
    view.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    expect(frames.size).toBe(1);
    flush();
    expect(writes).not.toHaveBeenCalled();
  });
  it("preserves desktop geometry and native pinch zoom", () => {
    media.matches = false;
    cleanup = observeChatViewport(node);
    expect(node.hasAttribute(ACTIVE)).toBe(false);
    media.matches = true;
    media.dispatchEvent(new Event("change"));
    flush();
    expect(node.hasAttribute(ACTIVE)).toBe(true);
    view.scale = 2;
    view.dispatchEvent(new Event("resize"));
    flush();
    expect(node.hasAttribute(ACTIVE)).toBe(false);
    expect(node.style.getPropertyValue(HEIGHT)).toBe("");
  });
  it("restores preexisting inline values and priority on cleanup", () => {
    node.style.setProperty(HEIGHT, "70vh", "important");
    node.style.setProperty(OFFSET, "7px");
    node.setAttribute(ACTIVE, "previous");
    // jsdom's custom-property implementation drops priorities; verify the
    // browser CSSOM restore call rather than depending on that emulator bug.
    jest
      .spyOn(node.style, "getPropertyPriority")
      .mockImplementation((name) => (name === HEIGHT ? "important" : ""));
    const writes = jest.spyOn(node.style, "setProperty");
    cleanup = observeChatViewport(node);
    writes.mockClear();
    cleanup();
    cleanup = undefined;
    expect(node.style.getPropertyValue(HEIGHT)).toBe("70vh");
    expect(writes).toHaveBeenCalledWith(HEIGHT, "70vh", "important");
    expect(node.style.getPropertyValue(OFFSET)).toBe("7px");
    expect(node.getAttribute(ACTIVE)).toBe("previous");
  });
  it("cancels queued frames and removes all listeners on unmount", () => {
    cleanup = observeChatViewport(node);
    view.dispatchEvent(new Event("resize"));
    expect(frames.size).toBe(1);
    cleanup();
    cleanup = undefined;
    expect(frames.size).toBe(0);
    view.dispatchEvent(new Event("resize"));
    view.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    media.dispatchEvent(new Event("change"));
    expect(frames.size).toBe(0);
    expect(node.hasAttribute(ACTIVE)).toBe(false);
  });
  it.each([
    ["height", 0],
    ["height", -1],
    ["height", NaN],
    ["scale", NaN],
    ["scale", Infinity],
    ["offsetTop", NaN],
  ] as const)("rejects invalid %s %s", (property, value) => {
    cleanup = observeChatViewport(node);
    view[property] = value;
    view.dispatchEvent(new Event("resize"));
    flush();
    expect(node.hasAttribute(ACTIVE)).toBe(false);
  });
  it.each([0, -1, NaN, Infinity])(
    "rejects invalid layout height %s",
    (height) => {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: height,
      });
      cleanup = observeChatViewport(node);
      expect(node.hasAttribute(ACTIVE)).toBe(false);
    },
  );
  it("ignores unusable measurements and browsers without the API", () => {
    cleanup = observeChatViewport(node);
    view.height = NaN;
    view.dispatchEvent(new Event("resize"));
    flush();
    expect(node.hasAttribute(ACTIVE)).toBe(false);
    cleanup();
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: null,
    });
    cleanup = observeChatViewport(node);
    expect(node.hasAttribute(ACTIVE)).toBe(false);
  });
});
