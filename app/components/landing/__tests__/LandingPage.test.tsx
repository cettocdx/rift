import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { BUILD_MODELS, IMAGE_MODELS, VIDEO_MODELS } from "@/types/chat";
import { LandingHeader } from "../LandingHeader";
import { LandingPage } from "../LandingPage";

const mockNavigateToAuth = jest.fn();
const mockScrollIntoView = jest.fn();

jest.mock("next/image", () => ({
  __esModule: true,
  default: ({
    fill: _fill,
    priority: _priority,
    alt,
    ...props
  }: React.ComponentProps<"img"> & {
    fill?: boolean;
    priority?: boolean;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt ?? ""} {...props} />
  ),
}));

jest.mock("@/app/hooks/useTauri", () => ({
  navigateToAuth: (...args: unknown[]) => mockNavigateToAuth(...args),
}));

const EXPECTED_PRODUCT_CAPTURES = [
  "/landing/product/build-product-design-4k.webp",
  "/landing/product/studio-4k.webp",
  "/landing/product/agents-4k.webp",
  "/landing/product/appearance-4k.webp",
  "/landing/product/workbench-4k.webp",
  "/landing/product/workspace-4k.webp",
] as const;

const EXPECTED_BUILD_PROVIDERS = [
  { provider: "Google", family: "Gemini", logo: "/brands/providers/gemini.svg", accent: "#4285f4" },
  {
    provider: "OpenAI",
    family: "GPT & Codex",
    logo: "/brands/providers/openai.svg",
    accent: "#111111",
  },
  {
    provider: "Anthropic",
    family: "Claude",
    logo: "/brands/providers/anthropic.svg",
    accent: "#d97757",
  },
  {
    provider: "xAI",
    family: "Grok",
    logo: "/brands/providers/xai.svg",
    accent: "#0a0a0a",
  },
  {
    provider: "Moonshot AI",
    family: "Kimi",
    logo: "/brands/providers/kimi.svg",
    accent: "#1783ff",
  },
  {
    provider: "Alibaba",
    family: "Qwen",
    logo: "/brands/providers/qwen.svg",
    accent: "#6950ef",
  },
  {
    provider: "Z.ai",
    family: "GLM",
    logo: "/brands/providers/zai.svg",
    accent: "#3859ff",
  },
  {
    provider: "Tencent",
    family: "Hunyuan",
    // Reuses the Z.ai mark until a Tencent one is added: an invented asset
    // path would 404 in production, which is worse than a shared placeholder.
    logo: "/brands/providers/zai.svg",
    accent: "#1478ff",
  },
] as const;

const EXPECTED_SHOWCASE = [
  "/studio/showcase-v3/image-gemini-pro-4k.webp",
  "/studio/showcase-v3/image-grok-4k.webp",
  "/studio/showcase-v3/video-kling-4k.webp",
] as const;

describe("LandingPage", () => {
  beforeAll(() => {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: mockScrollIntoView,
    });
  });

  beforeEach(() => {
    mockNavigateToAuth.mockClear();
    mockScrollIntoView.mockClear();
    window.history.replaceState({}, "", "/");
  });

  it("explains the complete product with original hero art, real Studio work, and product captures", async () => {
    const { container } = render(<LandingPage />);

    expect(
      screen.getByRole("heading", {
        name: "Build what comes next.",
      }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Create software, direct frontier media models, and run authorized security work from one exacting AI workspace.",
      ),
    ).toHaveClass("text-[#cbd2de]");
    expect(
      screen.getByText(
        "Build plans against your repository, edits real files, runs the stack, opens a live preview and proves the result before handoff.",
      ),
    ).toHaveClass("text-[#525c6d]");
    expect(container.querySelector("#landing-main")).toHaveAttribute(
      "tabindex",
      "-1",
    );
    expect(container.querySelector("#capabilities")).toBeInTheDocument();
    expect(container.querySelector("#how")).toBeInTheDocument();
    expect(container.querySelector("#pricing")).toBeInTheDocument();
    expect(container.querySelector("#hack-workbench")).toBeInTheDocument();

    const productImages = Array.from(container.querySelectorAll("img"));
    const expectedImages = [
      "/landing/brand/rift-flight-4k.webp",
      ...EXPECTED_PRODUCT_CAPTURES,
      ...EXPECTED_SHOWCASE,
      ...EXPECTED_BUILD_PROVIDERS.map(({ logo }) => logo),
    ];
    expect(productImages).toHaveLength(expectedImages.length);
    expect(
      productImages.map((image) => image.getAttribute("src")).sort(),
    ).toEqual([...expectedImages].sort());
    expect(
      screen.getByAltText(
        "A crystalline bird crossing a luminous rift in deep space",
      ),
    ).toHaveAttribute("width", "3840");
    expect(container.querySelector("picture source")).toHaveAttribute(
      "srcset",
      "/landing/brand/rift-flight-mobile.webp",
    );

    expect(screen.getByRole("heading", { name: "Agents" })).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "A visual studio with range.",
      }),
    ).toBeVisible();
    expect(screen.getByText("CLI Workspace")).toBeVisible();
    expect(screen.getByText("Tasks")).toBeVisible();
    expect(screen.getByText("Plugins")).toBeVisible();
    expect(screen.getByText("Artifacts")).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "Everything around the run stays connected.",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "Authorized pentesting, from scope to proof.",
      }),
    ).toBeVisible();
    // The counters animate up once they scroll into view, so this waits for the
    // settled figure rather than catching them mid-count. They used to appear
    // instantly only because jsdom had no IntersectionObserver to observe with.
    await waitFor(() => expect(screen.getAllByText("50")).toHaveLength(2), {
      timeout: 5000,
    });
    expect(screen.getByText("guided workflows")).toBeVisible();
    expect(screen.getByText("Map the attack surface")).toBeVisible();
    expect(screen.getByText("Orchestrate Kali tooling")).toBeVisible();
    expect(screen.getByText("Validate meaningful risk")).toBeVisible();
    expect(screen.getByText("Report and retest")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Prepare the right stack" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Work in the open" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "A professional AI workspace for software, media and authorized security work.",
      ),
    ).toHaveClass("text-[#8f99a9]");
  });

  it("renders canonical Build and Studio models from the product catalog", () => {
    render(<LandingPage />);

    for (const model of BUILD_MODELS) {
      expect(screen.getByText(model.model)).toBeVisible();
    }
    for (const model of [...IMAGE_MODELS, ...VIDEO_MODELS]) {
      expect(screen.getByText(model.name)).toBeVisible();
    }

    expect(
      screen.getByRole("heading", {
        name: `${IMAGE_MODELS.length} image models`,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: `${VIDEO_MODELS.length} video models`,
      }),
    ).toBeVisible();
  });

  it("identifies each Build family with authentic local provider branding", () => {
    const { container } = render(<LandingPage />);

    for (const { provider, family, logo, accent } of EXPECTED_BUILD_PROVIDERS) {
      const card = screen.getByRole("article", {
        name: `${provider} ${family} models`,
      });

      expect(
        within(card).getByRole("img", { name: `${provider} logo` }),
      ).toHaveAttribute("src", logo);
      expect(card.style.getPropertyValue("--provider-accent")).toBe(accent);
      expect(
        readFileSync(join(process.cwd(), "public", logo), "utf8"),
      ).toContain("<svg");
    }

    expect(container.querySelectorAll("[data-provider]")).toHaveLength(
      EXPECTED_BUILD_PROVIDERS.length,
    );
  });

  it("keeps header and hero actions connected to auth and reduced-motion navigation", () => {
    render(<LandingPage />);
    const header = screen.getByRole("banner");

    fireEvent.click(within(header).getByRole("button", { name: "Log in" }));
    expect(mockNavigateToAuth).toHaveBeenCalledWith("/login");

    fireEvent.click(
      within(header).getByRole("button", { name: "Start building" }),
    );
    expect(mockNavigateToAuth).toHaveBeenCalledWith("/signup", {
      preferSignInForReturningUser: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "See the workflow" }));
    expect(mockScrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });

    fireEvent.click(
      within(header).getByRole("button", { name: "Hack Workbench" }),
    );
    expect(mockScrollIntoView).toHaveBeenLastCalledWith({
      behavior: "smooth",
      block: "start",
    });

    fireEvent.click(
      within(header).getByRole("button", { name: "Go to RIFT home" }),
    );
    expect(mockScrollIntoView).toHaveBeenLastCalledWith({
      behavior: "smooth",
      block: "start",
    });

    expect(
      within(header).getByRole("link", { name: "Download" }),
    ).toHaveAttribute("href", "/download");
  });

  it("offers a touch-sized mobile navigation without changing scroll position", () => {
    render(<LandingPage />);

    const toggle = screen.getByRole("button", { name: "Open navigation" });
    expect(toggle).toHaveClass("size-11");
    fireEvent.click(toggle);

    const mobileNav = screen.getByRole("navigation", {
      name: "Mobile navigation",
    });
    expect(mobileNav).toBeVisible();
    expect(
      within(mobileNav).getByRole("button", { name: "Studio" }),
    ).toHaveClass("min-h-11");

    fireEvent.click(
      within(mobileNav).getByRole("button", { name: "How Build works" }),
    );
    expect(mockScrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
    expect(
      screen.queryByRole("navigation", { name: "Mobile navigation" }),
    ).not.toBeInTheDocument();
  });

  it("uses real home hash links when the shared header appears on a subpage", () => {
    render(<LandingHeader sectionLinksToHome />);

    expect(
      screen.getByRole("link", { name: "Go to RIFT home" }),
    ).toHaveAttribute("href", "/");
    expect(
      screen.getByRole("link", { name: "How Build works" }),
    ).toHaveAttribute("href", "/#how");
    expect(screen.getByRole("link", { name: "Models" })).toHaveAttribute(
      "href",
      "/#models",
    );
    expect(screen.getByRole("link", { name: "Studio" })).toHaveAttribute(
      "href",
      "/#studio",
    );
    expect(
      screen.getByRole("link", { name: "Hack Workbench" }),
    ).toHaveAttribute("href", "/#hack-workbench");
    expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute(
      "href",
      "/#pricing",
    );
    expect(mockScrollIntoView).not.toHaveBeenCalled();
  });

  it("preserves the team pricing hash handoff", async () => {
    window.history.replaceState({}, "", "/#team-pricing-seat-selection");

    render(<LandingPage />);

    await waitFor(() => {
      expect(mockNavigateToAuth).toHaveBeenCalledWith(
        "/signup?intent=pricing",
        { preferSignInForReturningUser: true },
      );
    });
  });

  it("keeps the Studio return path on desktop, mobile and page auth actions", () => {
    render(<LandingPage authReturnPath="/studio" />);
    const header = screen.getByRole("banner");
    fireEvent.click(within(header).getByRole("button", { name: "Log in" }));
    expect(mockNavigateToAuth).toHaveBeenLastCalledWith(
      "/login?redirect=%2Fstudio",
    );

    for (const start of screen.getAllByRole("button", {
      name: "Start building",
    })) {
      fireEvent.click(start);
      expect(mockNavigateToAuth).toHaveBeenLastCalledWith(
        "/signup?redirect=%2Fstudio",
        { preferSignInForReturningUser: true },
      );
    }

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const mobileNav = screen.getByRole("navigation", {
      name: "Mobile navigation",
    });
    fireEvent.click(within(mobileNav).getByRole("button", { name: "Log in" }));
    expect(mockNavigateToAuth).toHaveBeenLastCalledWith(
      "/login?redirect=%2Fstudio",
    );
  });

  it("retains pricing intent alongside the Studio return path", async () => {
    window.history.replaceState({}, "", "/studio#team-pricing-seat-selection");
    render(<LandingPage authReturnPath="/studio" />);

    await waitFor(() => {
      expect(mockNavigateToAuth).toHaveBeenCalledWith(
        "/signup?intent=pricing&redirect=%2Fstudio",
        { preferSignInForReturningUser: true },
      );
    });
  });

  it("uses the existing safe fallback for an external auth return path", () => {
    render(<LandingPage authReturnPath="//untrusted.example/studio" />);
    const header = screen.getByRole("banner");
    fireEvent.click(within(header).getByRole("button", { name: "Log in" }));
    expect(mockNavigateToAuth).toHaveBeenLastCalledWith("/login?redirect=%2F");
  });

  it("reserves Hack Workbench for the Max pricing card", () => {
    render(<LandingPage />);

    const proCard = screen
      .getByRole("heading", { name: "Pro" })
      .closest("article");
    const maxCard = screen
      .getByRole("heading", { name: "Max" })
      .closest("article");

    expect(proCard).not.toBeNull();
    expect(maxCard).not.toBeNull();
    expect(within(proCard!).queryByText(/Hack Workbench/i)).toBeNull();
    expect(
      within(maxCard!).getByText("Exclusive Hack Workbench access"),
    ).toBeVisible();
  });

  it("keeps the art-directed, stable-scroll and public-bundle contracts", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/landing/LandingPage.tsx"),
      "utf8",
    );
    const header = readFileSync(
      join(process.cwd(), "app/components/landing/LandingHeader.tsx"),
      "utf8",
    );
    const motion = readFileSync(
      join(process.cwd(), "app/components/landing/LandingMotion.tsx"),
      "utf8",
    );
    const motionStyles = readFileSync(
      join(process.cwd(), "app/components/landing/LandingMotion.module.css"),
      "utf8",
    );
    const labRoute = readFileSync(
      join(process.cwd(), "app/lab/marketing/page.tsx"),
      "utf8",
    );
    const publicRoute = readFileSync(
      join(process.cwd(), "app/(chat)/page.tsx"),
      "utf8",
    );
    const studioRoute = readFileSync(
      join(process.cwd(), "app/(chat)/studio/page.tsx"),
      "utf8",
    );

    expect(`${source}\n${header}\n${motion}`).not.toMatch(/[—–]/u);
    expect(source).toContain('["--background" as string]: "#070a10"');
    expect(source).toContain('["--foreground" as string]: "#f6f7fb"');
    expect(source).toContain('["--signal" as string]: "#3159e8"');
    expect(source).toContain(
      'import { BUILD_MODELS, IMAGE_MODELS, VIDEO_MODELS } from "@/types/chat";',
    );
    expect(source).not.toContain("Qwen3.8");
    expect(`${source}\n${header}\n${motion}`).not.toMatch(
      /100dvh|100vh|backdrop-blur|\bsticky\b|addEventListener\(["']scroll["']|useScroll|parallax/i,
    );
    expect(source).not.toContain("content-visibility");
    expect(source).toContain("/landing/brand/rift-flight-4k.webp");
    expect(source).toContain("/landing/brand/rift-flight-mobile.webp");
    expect(source).toContain('media="(max-width: 767px)"');
    expect(source).toContain("aspect-[4/5]");
    expect(source).not.toContain("CAPTURES.hero");
    expect(source).toContain("/landing/product/build-product-design-4k.webp");
    expect(source).not.toContain("/landing/product/build-reasoning-4k.webp");
    expect(source).not.toMatch(/\bCursor\b/u);
    EXPECTED_PRODUCT_CAPTURES.forEach((capture) =>
      expect(source).toContain(capture),
    );
    EXPECTED_SHOWCASE.forEach((capture) => expect(source).toContain(capture));
    expect(source.match(/\/landing\/product\//g)).toHaveLength(
      EXPECTED_PRODUCT_CAPTURES.length,
    );
    expect(motion).toContain("new IntersectionObserver");
    expect(motion).toContain("prefers-reduced-motion: reduce");
    expect(motionStyles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(motionStyles).toMatch(/opacity 640ms/);
    expect(publicRoute).toContain('import dynamic from "next/dynamic"');
    expect(publicRoute).not.toContain(
      'import { Chat } from "../components/chat"',
    );
    expect(studioRoute).toContain('import dynamic from "next/dynamic"');
    expect(`${publicRoute}\n${studioRoute}`).toContain(
      "[scrollbar-gutter:stable]",
    );
    expect(labRoute).toContain(
      'import { LandingPage } from "@/app/components/landing/LandingPage";',
    );
    expect(labRoute).toContain("return <LandingPage />;");
  });
});
