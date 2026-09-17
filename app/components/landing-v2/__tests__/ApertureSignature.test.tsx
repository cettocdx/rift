import { act } from "react";
import type { ReactElement } from "react";
import { hydrateRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { render } from "@testing-library/react";
import { ApertureSignature } from "../ApertureSignature";
import { F1Reveal } from "../F1Reveal";

class ImmediateIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0];

  constructor(private readonly callback: IntersectionObserverCallback) {}

  disconnect() {}

  observe(target: Element) {
    const bounds = target.getBoundingClientRect();
    this.callback(
      [
        {
          boundingClientRect: bounds,
          intersectionRatio: 1,
          intersectionRect: bounds,
          isIntersecting: true,
          rootBounds: null,
          target,
          time: 0,
        },
      ],
      this,
    );
  }

  takeRecords() {
    return [];
  }

  unobserve() {}
}

async function withImmediateIntersectionObserver(run: () => Promise<void>) {
  const originalWindowObserver = window.IntersectionObserver;
  const originalGlobalObserver = global.IntersectionObserver;

  window.IntersectionObserver = ImmediateIntersectionObserver;
  global.IntersectionObserver = ImmediateIntersectionObserver;

  try {
    await run();
  } finally {
    window.IntersectionObserver = originalWindowObserver;
    global.IntersectionObserver = originalGlobalObserver;
  }
}

async function expectHydratesWithoutErrors(element: ReactElement) {
  const host = document.createElement("div");
  host.innerHTML = renderToString(element);
  document.body.appendChild(host);

  const consoleError = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  let root: Root | undefined;

  try {
    await act(async () => {
      root = hydrateRoot(host, element);
      await Promise.resolve();
    });
    await act(async () => {
      root?.unmount();
    });

    expect(consoleError).not.toHaveBeenCalled();
  } finally {
    consoleError.mockRestore();
    host.remove();
  }
}

describe("ApertureSignature", () => {
  it("renders deterministic decorative geometry", () => {
    const { container } = render(<ApertureSignature />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(container.querySelectorAll("line")).toHaveLength(48);
  });

  it("exposes the compact state without changing geometry", () => {
    const { container } = render(<ApertureSignature compact />);
    expect(container.firstChild).toHaveAttribute("data-compact", "true");
    expect(container.querySelectorAll("line")).toHaveLength(48);
  });

  it("produces identical static markup across repeated renders", () => {
    const firstRender = renderToStaticMarkup(<ApertureSignature />);
    const secondRender = renderToStaticMarkup(<ApertureSignature />);

    expect(secondRender).toBe(firstRender);
  });

  it("hydrates the Aperture and reveal without logging errors", async () => {
    await withImmediateIntersectionObserver(async () => {
      await expectHydratesWithoutErrors(<ApertureSignature />);
      await expectHydratesWithoutErrors(
        <F1Reveal>
          <span>Reveal content</span>
        </F1Reveal>,
      );
    });
  });

  it("encodes reduced-motion behavior in server output", () => {
    const apertureMarkup = renderToStaticMarkup(<ApertureSignature />);
    const revealMarkup = renderToStaticMarkup(
      <F1Reveal>
        <span>Reveal content</span>
      </F1Reveal>,
    );

    expect(apertureMarkup).toContain("@media (prefers-reduced-motion: reduce)");
    expect(apertureMarkup).toContain("animation: none");
    expect(apertureMarkup).toContain("transform: none");
    expect(revealMarkup).toContain("motion-reduce:!transform-none");
    expect(revealMarkup).toContain("motion-reduce:!opacity-100");
    expect(revealMarkup).toContain("transform:translateY(16px)");
  });

  it("animates one SVG group instead of each line", () => {
    const { container } = render(<ApertureSignature />);
    const animatedGroups = container.querySelectorAll("g.f1-aperture-motion");
    const lines = container.querySelectorAll("line");

    expect(animatedGroups).toHaveLength(1);
    expect(lines).toHaveLength(48);
    for (const line of lines) {
      expect(line).not.toHaveAttribute("style");
    }
  });
});
