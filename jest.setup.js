// Learn more: https://github.com/testing-library/jest-dom
import "@testing-library/jest-dom";
import { TextDecoder, TextEncoder } from "util";
import { ReadableStream, TransformStream } from "stream/web";

// Mock environment variables
process.env.NEXT_PUBLIC_CONVEX_URL = "https://test.convex.cloud";

// Polyfill TextEncoder/TextDecoder for gpt-tokenizer
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Polyfill Web Streams API for AI SDK
global.ReadableStream = ReadableStream;
global.TransformStream = TransformStream;

// Mock window.matchMedia (jsdom only; node-env suites have no window)
if (typeof window !== "undefined") Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // Deprecated
    removeListener: jest.fn(), // Deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// jsdom ships no IntersectionObserver, and Motion builds one the moment a
// `whileInView` element mounts. Every public page now renders through the shared
// marketing shell, so this went from "one landing test" to "any test that
// renders a page".
//
// The stub reports the observed element as intersecting straight away, which is
// what a real browser does for anything inside the viewport. An inert stub that
// never fires is worse than no observer at all: reveal-on-scroll content stays
// at its initial state forever and text a test is looking for never arrives.
if (typeof window !== "undefined" && typeof window.IntersectionObserver === "undefined") {
  class TestIntersectionObserver {
    constructor(callback, options = {}) {
      this.callback = callback;
      this.root = options.root ?? null;
      this.rootMargin = options.rootMargin ?? "0px";
      this.thresholds = Array.isArray(options.threshold)
        ? options.threshold
        : [options.threshold ?? 0];
      this.elements = new Set();
    }
    observe(element) {
      this.elements.add(element);
      this.callback(
        [
          {
            target: element,
            isIntersecting: true,
            intersectionRatio: 1,
            time: 0,
            boundingClientRect: element.getBoundingClientRect?.() ?? {},
            intersectionRect: element.getBoundingClientRect?.() ?? {},
            rootBounds: null,
          },
        ],
        this,
      );
    }
    unobserve(element) {
      this.elements.delete(element);
    }
    disconnect() {
      this.elements.clear();
    }
    takeRecords() {
      return [];
    }
  }
  window.IntersectionObserver = TestIntersectionObserver;
  global.IntersectionObserver = TestIntersectionObserver;
}

// Global test utilities
global.beforeEach(() => {
  // Clear mocks before each test
  jest.clearAllMocks();
});
