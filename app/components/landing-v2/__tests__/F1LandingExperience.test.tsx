import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";

import { BuildNarrative } from "../BuildNarrative";
import { EnterpriseProof } from "../EnterpriseProof";
import { F1LandingNav } from "../F1LandingNav";
import { F1StudioShowcase } from "../F1StudioShowcase";
import { LandingHero } from "../LandingHero";
import { LandingShell } from "../LandingShell";
import { ProductProof } from "../ProductProof";
import { SystemContinuity } from "../SystemContinuity";
import { CONTINUITY_STEPS, ENTERPRISE_CONTROLS } from "../f1-content";

jest.mock("../F1Reveal", () => ({
  F1Reveal: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, ...props }: ComponentProps<"a"> & { href: string }) => (
    <a data-next-link="true" href={href} {...props} />
  ),
}));

jest.mock("next/image", () => ({
  __esModule: true,
  default: ({
    preload = false,
    priority = false,
    fill: _fill,
    alt = "",
    ...props
  }: ComponentProps<"img"> & {
    preload?: boolean;
    priority?: boolean;
    fill?: boolean;
  }) => (
    // The image optimizer is not present in jsdom. Rendering the underlying
    // element keeps the public source, dimensions and accessible name testable.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={alt}
      data-preload={preload ? "true" : "false"}
      data-priority={priority ? "true" : "false"}
      {...props}
    />
  ),
}));

/**
 * Controls no longer draw their own ring. A 2px near-white ring at a 2px
 * offset read as a bright rectangle appearing beside whatever you touched, so
 * every one of these was removed in favour of the hairline floor in
 * globals.css — which still gives keyboard focus a visible indicator, and
 * which these controls opt into precisely by NOT carrying a ring class.
 */
function expectFocusRing(element: Element) {
  expect(element.className).not.toMatch(/focus-visible:ring/);
  expect(element).toHaveClass("focus-visible:outline-none");
}

function renderNavigation() {
  return render(
    <LandingShell>
      <F1LandingNav />
    </LandingShell>,
  );
}

describe("F1 landing chrome", () => {
  it("opens with the approved message and product proof", () => {
    const { container } = render(<LandingHero />);

    expect(
      screen.getByRole("heading", { name: "Give RIFT the work." }),
    ).toBeVisible();
    const download = screen.getByRole("link", { name: "Download RIFT" });
    expect(download).toHaveAttribute("href", "/download");
    expect(download).toHaveAttribute("data-next-link", "true");
    expect(
      screen.getByRole("link", { name: "Watch RIFT work" }),
    ).toHaveAttribute("href", "#build");

    const productImage = screen.getByAltText(
      "RIFT Build showing an agent task and its execution workspace.",
    );
    expect(productImage).toBeVisible();
    expect(productImage).toHaveAttribute("data-preload", "true");
    expect(productImage).toHaveAttribute("data-priority", "false");

    for (const interactive of container.querySelectorAll("a, button")) {
      expectFocusRing(interactive);
    }
  });

  it("proves all three surfaces and the Build execution sequence", () => {
    const { container } = render(
      <>
        <ProductProof />
        <BuildNarrative />
      </>,
    );

    const productSection = container.querySelector("#product");
    const buildSection = container.querySelector("#build");

    expect(productSection).toBeInTheDocument();
    expect(productSection).toHaveAttribute(
      "aria-labelledby",
      "product-proof-title",
    );
    expect(buildSection).toBeInTheDocument();
    expect(buildSection).toHaveAttribute("aria-labelledby", "build-title");
    expect(productSection?.querySelectorAll("article")).toHaveLength(3);
    expect(buildSection?.querySelector("ol")).toBeInTheDocument();
    expect(buildSection?.querySelectorAll("ol > li")).toHaveLength(3);

    for (const label of ["Build", "Studio", "Hack"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    for (const label of ["01 / Plan", "02 / Execute", "03 / Verify"]) {
      expect(screen.getByText(label)).toBeVisible();
    }

    expect(
      screen.getByRole("heading", { name: "From task to verified change." }),
    ).toBeVisible();

    for (const alt of [
      "RIFT Build showing an agent task and its execution workspace.",
      "RIFT Studio showing available generation models and output controls.",
      "RIFT Hack showing a scoped security assessment workspace.",
      "RIFT Build showing a plan, execution state and verification results.",
    ]) {
      expect(screen.getByAltText(alt)).toBeVisible();
    }
  });

  it("keeps product proof media honest across responsive layouts", () => {
    const { container } = render(
      <>
        <ProductProof />
        <BuildNarrative />
      </>,
    );

    const productSection = container.querySelector("#product");
    const productArticles = Array.from(
      productSection?.querySelectorAll("article") ?? [],
    );
    const productGrid = productArticles[0]?.parentElement?.parentElement;

    expect(productGrid).toHaveClass(
      "md:grid-cols-2",
      "lg:grid-cols-3",
      "xl:grid-cols-12",
    );
    expect(productArticles[0]?.parentElement).toHaveClass("xl:col-span-6");
    expect(productArticles[1]?.parentElement).toHaveClass("xl:col-span-3");
    expect(productArticles[2]?.parentElement).toHaveClass(
      "md:last:col-span-2",
      "lg:last:col-span-1",
      "xl:last:col-span-3",
    );

    const productImageContracts = [
      {
        alt: "RIFT Build showing an agent task and its execution workspace.",
        sizes:
          "(max-width: 639px) calc(100vw - 40px), (max-width: 767px) calc(100vw - 64px), (max-width: 1023px) calc((100vw - 80px) / 2), (max-width: 1279px) calc((min(100vw, 1240px) - 112px) / 3), 572px",
      },
      {
        alt: "RIFT Studio showing available generation models and output controls.",
        sizes:
          "(max-width: 639px) calc(100vw - 40px), (max-width: 767px) calc(100vw - 64px), (max-width: 1023px) calc((100vw - 80px) / 2), (max-width: 1279px) calc((min(100vw, 1240px) - 112px) / 3), 278px",
      },
      {
        alt: "RIFT Hack showing a scoped security assessment workspace.",
        sizes:
          "(max-width: 639px) calc(100vw - 40px), (max-width: 767px) calc(100vw - 64px), (max-width: 1023px) calc(100vw - 64px), (max-width: 1279px) calc((min(100vw, 1240px) - 112px) / 3), 278px",
      },
    ] as const;

    for (const { alt, sizes } of productImageContracts) {
      const image = screen.getByAltText(alt);

      expect(image).toHaveAttribute("width", "3840");
      expect(image).toHaveAttribute("height", "2160");
      expect(image).toHaveAttribute("sizes", sizes);
      expect(image).toHaveClass("size-full", "object-cover");
    }

    const buildImage = screen.getByAltText(
      "RIFT Build showing a plan, execution state and verification results.",
    );
    expect(buildImage).toHaveAttribute("width", "3840");
    expect(buildImage).toHaveAttribute("height", "2160");
    expect(buildImage).toHaveAttribute(
      "sizes",
      "(max-width: 639px) calc(100vw - 40px), (max-width: 1023px) calc(100vw - 64px), (max-width: 1239px) calc(58.333vw - 66.667px), 657px",
    );
  });

  it("uses Next links for routes and focus rings for every nav control", () => {
    const { container } = renderNavigation();

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "data-next-link",
      "true",
    );
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute(
      "data-next-link",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    for (const interactive of container.querySelectorAll("a, button")) {
      expectFocusRing(interactive);
    }
  });

  it("exposes and closes the non-modal mobile navigation", () => {
    renderNavigation();
    const toggle = screen.getByRole("button", { name: "Open navigation" });

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const mobileNav = screen.getByRole("navigation", { name: "Mobile" });
    expect(mobileNav).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(within(mobileNav).getByRole("link", { name: "Studio" }));

    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the mobile navigation with Escape and returns focus", () => {
    renderNavigation();
    const toggle = screen.getByRole("button", { name: "Open navigation" });

    fireEvent.click(toggle);
    const closeToggle = screen.getByRole("button", {
      name: "Close navigation",
    });
    closeToggle.blur();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(
      screen.queryByRole("navigation", { name: "Mobile" }),
    ).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it("lifts against the landing shell scroll container", () => {
    const { container } = renderNavigation();
    const scrollContainer = container.querySelector<HTMLElement>("#top");
    const header = container.querySelector("header");

    expect(scrollContainer).not.toBeNull();
    expect(header).toHaveAttribute("data-lifted", "false");

    if (!scrollContainer)
      throw new Error("Landing scroll container is missing");
    scrollContainer.scrollTop = 81;
    fireEvent.scroll(scrollContainer);

    expect(header).toHaveAttribute("data-lifted", "true");
  });

  it("removes its native scroll listener when unmounted", () => {
    const addListener = jest.spyOn(HTMLElement.prototype, "addEventListener");
    const removeListener = jest.spyOn(
      HTMLElement.prototype,
      "removeEventListener",
    );

    try {
      const { container, unmount } = renderNavigation();
      const scrollContainer = container.querySelector("#top");
      const scrollCallIndex = addListener.mock.calls.findIndex(
        ([type, _listener, options]) =>
          type === "scroll" &&
          typeof options === "object" &&
          options !== null &&
          "passive" in options &&
          options.passive === true,
      );

      expect(scrollCallIndex).toBeGreaterThanOrEqual(0);
      expect(addListener.mock.contexts[scrollCallIndex]).toBe(scrollContainer);
      const listener = addListener.mock.calls[scrollCallIndex]?.[1];

      unmount();

      expect(removeListener).toHaveBeenCalledWith("scroll", listener);
    } finally {
      addListener.mockRestore();
      removeListener.mockRestore();
    }
  });
});

describe("F1 Studio showcase", () => {
  it("exposes four associated tabs with one selected output", () => {
    const { container } = render(<F1StudioShowcase />);

    expect(
      screen.getByRole("heading", {
        name: "The right model, inside the same workflow.",
      }),
    ).toBeVisible();

    const section = container.querySelector("#studio");
    expect(section).toHaveAttribute("aria-labelledby", "studio-title");

    const tablist = screen.getByRole("tablist", { name: "Studio outputs" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    expect(
      tabs.filter((tab) => tab.getAttribute("aria-selected") === "true"),
    ).toHaveLength(1);

    for (const tab of tabs) {
      const selected = tab.getAttribute("aria-selected") === "true";
      const panelId = tab.getAttribute("aria-controls");

      expect(tab).toHaveAttribute("id");
      expect(tab).toHaveAttribute("tabindex", selected ? "0" : "-1");
      expect(panelId).toBeTruthy();
      expect(container.querySelector(`#${panelId}`)).toHaveAttribute(
        "aria-labelledby",
        tab.id,
      );
      expectFocusRing(tab);
    }

    const panels = screen.getAllByRole("tabpanel", { hidden: true });
    expect(panels).toHaveLength(4);
    expect(
      panels.filter((panel) => !panel.hasAttribute("hidden")),
    ).toHaveLength(1);

    const selectedImage = screen.getByAltText(
      "Reference media showing a reflective chrome and translucent product form on dark stone.",
    );
    expect(selectedImage).toHaveAttribute("width", "3840");
    expect(selectedImage).toHaveAttribute("height", "2160");
    expect(selectedImage).toHaveAttribute(
      "sizes",
      "(max-width: 639px) calc(100vw - 40px), (max-width: 1023px) calc(100vw - 64px), (max-width: 1239px) calc(100vw - 440px), 800px",
    );
  });

  it("keeps video reference media user controlled", () => {
    const { container } = render(<F1StudioShowcase />);
    const initialImagePanel = screen.getByRole("tabpanel");
    const videoTab = screen.getByRole("tab", {
      name: /Character continuity/,
    });

    expect(initialImagePanel).toHaveAttribute("tabindex", "0");

    fireEvent.click(videoTab);

    expect(videoTab).toHaveAttribute("aria-selected", "true");
    expect(videoTab).toHaveAttribute("tabindex", "0");
    expect(videoTab).toHaveFocus();

    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("id", videoTab.getAttribute("aria-controls"));
    expect(panel).toHaveAttribute("aria-labelledby", videoTab.id);
    expect(panel).not.toHaveAttribute("tabindex");

    const video = panel.querySelector("video");
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("preload", "metadata");
    expect(video).toHaveAttribute("playsinline");
    expect(video).toHaveProperty("muted", true);
    expect(video).not.toHaveAttribute("autoplay");
    expect(video).not.toHaveAttribute("loop");
    expect(video).toHaveAttribute(
      "poster",
      "/studio/showcase-v3/video-kling-4k.webp",
    );

    const source = video?.querySelector("source");
    expect(source).toHaveAttribute(
      "src",
      "/studio/showcase-v3/video-kling-4k.mp4",
    );
    expect(source).toHaveAttribute("type", "video/mp4");
    expect(container.querySelector("video[autoplay], video[loop]")).toBeNull();
  });

  it("wraps arrow navigation and supports Home and End", () => {
    render(<F1StudioShowcase />);
    const tabs = screen.getAllByRole("tab");
    const first = tabs[0];
    const last = tabs[tabs.length - 1];

    first.focus();
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(last).toHaveFocus();
    expect(last).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(last, { key: "ArrowRight" });
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(first, { key: "End" });
    expect(last).toHaveFocus();
    expect(last).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(last, { key: "Home" });
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(last).toHaveFocus();
    expect(last).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(last, { key: "ArrowDown" });
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute("aria-selected", "true");
  });

  it("reflows controls before media and disables press motion when requested", () => {
    render(<F1StudioShowcase />);

    const tablist = screen.getByRole("tablist", { name: "Studio outputs" });
    const panelWrapper = screen.getByRole("tabpanel").parentElement;

    expect(tablist).toHaveClass(
      "grid-cols-1",
      "sm:grid-cols-2",
      "lg:grid-cols-1",
      "lg:col-start-2",
      "lg:row-start-1",
    );
    expect(panelWrapper).toHaveClass("lg:col-start-1", "lg:row-start-1");
    expect(tablist.nextElementSibling).toBe(panelWrapper);

    for (const tab of within(tablist).getAllByRole("tab")) {
      expect(tab).toHaveClass(
        "motion-reduce:active:scale-100",
        "motion-reduce:transition-none",
      );
    }
  });
});

describe("F1 system continuity and enterprise proof", () => {
  it("presents the approved continuity sequence in exact order", () => {
    const { container } = render(<SystemContinuity />);
    const section = container.querySelector("#system");

    expect(section).toHaveAttribute("aria-labelledby", "system-title");
    const heading = screen.getByRole("heading", {
      name: "One context. Three working surfaces.",
    });
    expect(heading).toBeVisible();
    expect(heading).toHaveClass("text-balance");

    const steps = within(screen.getByRole("list")).getAllByRole("listitem");
    const approvedLabels = ["01 / Build", "02 / Studio", "03 / Hack"];
    expect(steps).toHaveLength(approvedLabels.length);
    expect(steps.map((step) => step.querySelector("p")?.textContent)).toEqual(
      approvedLabels,
    );

    CONTINUITY_STEPS.forEach((step, index) => {
      expect(within(steps[index]).getByText(step.title)).toBeVisible();
      expect(within(steps[index]).getByText(step.body)).toBeVisible();
    });
  });

  it("renders compact decorative brand and timeline markers accessibly", () => {
    const { container } = render(<SystemContinuity />);
    const section = container.querySelector("#system");
    const aperture = section?.querySelector("svg");
    const apertureWrapper = aperture?.parentElement;
    const markers = section?.querySelectorAll(
      "ol > li > span[aria-hidden='true']",
    );

    expect(aperture).toHaveAttribute("aria-hidden", "true");
    expect(aperture).toHaveAttribute("focusable", "false");
    expect(apertureWrapper).toHaveAttribute("data-compact", "true");
    expect(apertureWrapper).toHaveClass("max-w-[320px]");
    expect(markers).toHaveLength(CONTINUITY_STEPS.length);
    expect(section?.querySelector("img, video")).toBeNull();
  });

  it("uses only grounded enterprise control copy", () => {
    const { container } = render(<EnterpriseProof />);
    const section = container.querySelector("#enterprise");

    expect(section).toHaveAttribute("aria-labelledby", "enterprise-title");
    const heading = screen.getByRole("heading", {
      name: "Built for work that has to hold up.",
    });
    expect(heading).toBeVisible();
    expect(heading).toHaveClass("text-balance");

    ENTERPRISE_CONTROLS.forEach((control) => {
      expect(screen.getByText(control.title)).toBeVisible();
      expect(screen.getByText(control.body)).toBeVisible();
    });

    expect(section).not.toHaveTextContent(
      /trusted by|customer logo|badge|certified|certification|soc\s*2|iso\s*27001|\d+(?:\.\d+)?%|metrics?/i,
    );
  });

  it("keeps enterprise control rows semantically neutral", () => {
    const { container } = render(<EnterpriseProof />);

    expect(container.querySelector("#enterprise article")).toBeNull();
  });

  it("keeps the continuity and enterprise story non-interactive", () => {
    const { container } = render(
      <>
        <SystemContinuity />
        <EnterpriseProof />
      </>,
    );

    expect(
      container.querySelector("a, button, input, select, textarea"),
    ).toBeNull();
  });
});
