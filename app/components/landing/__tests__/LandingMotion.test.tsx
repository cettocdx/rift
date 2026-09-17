import { act, render, screen } from "@testing-library/react";

import {
  LandingCountUp,
  LandingReveal,
  LandingSequenceText,
} from "../LandingMotion";

type ObserverHarness = {
  callback: IntersectionObserverCallback;
  disconnect: jest.Mock;
  observe: jest.Mock;
};

const observers: ObserverHarness[] = [];

class MockIntersectionObserver {
  callback: IntersectionObserverCallback;
  disconnect = jest.fn();
  observe = jest.fn();
  unobserve = jest.fn();
  takeRecords = jest.fn(() => []);
  root = null;
  rootMargin = "0px";
  thresholds = [0];

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    observers.push(this);
  }
}

function enterViewport(observer: ObserverHarness) {
  observer.callback(
    [{ isIntersecting: true } as IntersectionObserverEntry],
    observer as unknown as IntersectionObserver,
  );
}

describe("LandingMotion", () => {
  beforeEach(() => {
    observers.length = 0;
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: MockIntersectionObserver,
    });
    (window.matchMedia as jest.Mock).mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reveals once, disconnects its observer, and keeps the final state", () => {
    render(
      <LandingReveal>
        <p>One-shot content</p>
      </LandingReveal>,
    );

    const reveal = screen.getByText("One-shot content").parentElement;
    expect(reveal).toHaveAttribute("data-motion-state", "pending");
    expect(observers).toHaveLength(1);

    act(() => enterViewport(observers[0]));

    expect(reveal).toHaveAttribute("data-motion-state", "visible");
    expect(reveal).toHaveAttribute("data-motion-complete", "true");
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);

    act(() => enterViewport(observers[0]));
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it("sequences words through the same one-shot visibility contract", () => {
    const { container } = render(
      <LandingSequenceText text="Build what comes next." />,
    );

    expect(container).toHaveTextContent("Build what comes next.");
    expect(
      container.querySelectorAll('[style*="--landing-word-index"]'),
    ).toHaveLength(4);
    expect(container.firstElementChild).toHaveAttribute(
      "data-motion-state",
      "pending",
    );

    act(() => enterViewport(observers[0]));
    expect(container.firstElementChild).toHaveAttribute(
      "data-motion-state",
      "visible",
    );
  });

  it("keeps final values static when reduced motion is requested", () => {
    (window.matchMedia as jest.Mock).mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    render(<LandingCountUp value={1800} />);

    expect(screen.getByLabelText("1,800")).toHaveTextContent("1,800");
    expect(observers).toHaveLength(0);
  });

  it("counts to the target only on the first intersection", () => {
    let now = 0;
    const requestAnimationFrame = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        now += 500;
        callback(now);
        return now;
      });
    jest.spyOn(performance, "now").mockReturnValue(0);

    render(<LandingCountUp value={50} duration={900} />);

    expect(screen.getByLabelText("50")).toHaveTextContent("0");
    act(() => enterViewport(observers[0]));
    expect(screen.getByLabelText("50")).toHaveTextContent("50");
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);

    act(() => enterViewport(observers[0]));
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
  });
});
