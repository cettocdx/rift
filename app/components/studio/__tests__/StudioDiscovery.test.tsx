import "@testing-library/jest-dom";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  STUDIO_MODEL_REFERENCES,
  StudioDiscovery,
  referenceProvenance,
} from "../StudioDiscovery";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/types/chat";

/*
 * The showcase illustrates the models it has artwork for.
 *
 * Every reference is a still or clip art-directed to express one model's
 * strongest use, so a model added to the roster has none until someone makes
 * it one. Demanding a reference per catalogue model would leave whoever adds a
 * model two ways out — invent a path that 404s, or re-use another model's
 * artwork — and "never captions another model's artwork with the active model"
 * below exists to stop exactly that second thing.
 *
 * So the contract asserted here is the honest one: the rail shows precisely
 * the models with a reference, and every one of those references is distinct
 * and on disk.
 */
const withReference = <T extends { id: string; name: string }>(
  models: readonly T[],
) => models.filter((model) => STUDIO_MODEL_REFERENCES[model.id as never]);

const SHOWCASED_IMAGE = withReference(IMAGE_MODELS);
const SHOWCASED_VIDEO = withReference(VIDEO_MODELS);

const setSelectedModel = jest.fn();
const setChatMode = jest.fn();
const setInput = jest.fn();
const mockFetch = jest.fn();
let selectedModel = "image-gemini";
let mockReducedMotion: boolean | null = true;

jest.mock("motion/react", () => ({
  useReducedMotion: () => mockReducedMotion,
}));
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
jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    selectedModel,
    setSelectedModel,
    setChatMode,
  }),
}));
jest.mock("@/app/contexts/InputContext", () => ({
  useInputApi: () => ({ setInput }),
}));

describe("StudioDiscovery", () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: mockFetch,
    });
  });

  beforeEach(() => {
    selectedModel = "image-gemini";
    mockReducedMotion = true;
    setSelectedModel.mockClear();
    setChatMode.mockClear();
    setInput.mockClear();
    mockFetch.mockReset();
    mockFetch.mockImplementation(() => new Promise(() => undefined));
  });

  it("surfaces every allowlisted image and video model", () => {
    render(<StudioDiscovery />);
    const modelRail = screen.getByTestId("studio-model-rail");

    for (const model of [...SHOWCASED_IMAGE, ...SHOWCASED_VIDEO]) {
      expect(
        within(modelRail).getByText(model.name).closest("button"),
      ).toBeVisible();
    }

    // A model without artwork is absent from the showcase and nowhere else:
    // it stays selectable in Studio's picker and stays in the catalogue.
    for (const model of [...IMAGE_MODELS, ...VIDEO_MODELS]) {
      if (STUDIO_MODEL_REFERENCES[model.id]) continue;
      expect(within(modelRail).queryByText(model.name)).toBeNull();
    }
  });

  it("assigns every Studio model a distinct local cinematic reference", () => {
    const models = [...SHOWCASED_IMAGE, ...SHOWCASED_VIDEO];
    const references = models.map(
      (model) => STUDIO_MODEL_REFERENCES[model.id]!,
    );

    expect(Object.keys(STUDIO_MODEL_REFERENCES)).toHaveLength(models.length);
    expect(new Set(references.map((reference) => reference.src)).size).toBe(
      models.length,
    );
    expect(new Set(references.map((reference) => reference.poster)).size).toBe(
      models.length,
    );
    expect(
      references.filter((reference) => reference.kind === "video"),
    ).toHaveLength(SHOWCASED_VIDEO.length);

    for (const reference of references) {
      expect(reference.poster).toMatch(
        /^\/studio\/showcase-v3\/[a-z0-9-]+-4k\.webp$/,
      );
      expect(reference.mobilePoster).toMatch(
        /^\/studio\/showcase-v3\/[a-z0-9-]+-mobile\.webp$/,
      );
      expect(reference.src).toMatch(
        reference.kind === "video"
          ? /^\/studio\/showcase-v3\/[a-z0-9-]+-4k\.mp4$/
          : /^\/studio\/showcase-v3\/[a-z0-9-]+-4k\.webp$/,
      );
      expect(existsSync(join(process.cwd(), "public", reference.src))).toBe(
        true,
      );
      expect(existsSync(join(process.cwd(), "public", reference.poster))).toBe(
        true,
      );
      expect(
        existsSync(join(process.cwd(), "public", reference.mobilePoster)),
      ).toBe(true);
      expect(
        existsSync(join(process.cwd(), "public", reference.thumbnail)),
      ).toBe(true);
    }

    for (const reference of references.filter(
      (candidate) => candidate.kind === "video",
    )) {
      expect(reference.mobileSrc).toMatch(
        /^\/studio\/showcase-v3\/[a-z0-9-]+-mobile\.mp4$/,
      );
      expect(
        existsSync(join(process.cwd(), "public", reference.mobileSrc!)),
      ).toBe(true);
    }
  });

  it("uses small local derivatives for the model rail and direction cards", () => {
    for (const reference of Object.values(STUDIO_MODEL_REFERENCES)) {
      expect(reference!.thumbnail).toMatch(
        /^\/studio\/showcase-v3\/[a-z0-9-]+-thumb\.webp$/,
      );
      expect(reference!.thumbnail).not.toContain("4k");
    }

    render(<StudioDiscovery />);
    const modelRail = screen.getByTestId("studio-model-rail");
    const railSources = Array.from(modelRail.querySelectorAll("img"), (image) =>
      image.getAttribute("src"),
    );

    expect(railSources).toHaveLength(
      SHOWCASED_IMAGE.length + SHOWCASED_VIDEO.length,
    );
    expect(railSources).toEqual(
      expect.arrayContaining(
        Object.values(STUDIO_MODEL_REFERENCES).map(
          (reference) => reference!.thumbnail,
        ),
      ),
    );
    expect(railSources.every((source) => source?.endsWith("-thumb.webp"))).toBe(
      true,
    );

    for (const title of [
      "Product film",
      "Material study",
      "Character continuity",
      "Architecture",
    ]) {
      const card = screen.getByRole("button", {
        name: `Use direction: ${title}`,
      });
      const cardSource = card.querySelector("img")?.getAttribute("src");
      expect(cardSource).toMatch(
        /^\/studio\/references\/direction-[a-z0-9-]+-card\.webp$/,
      );
      expect(cardSource).not.toContain("4k");
      expect(existsSync(join(process.cwd(), "public", cardSource!))).toBe(true);
    }

    expect(
      screen.getByAltText(
        "Nano Banana 2 capability reference: Product storytelling",
      ),
    ).toHaveAttribute("src", "/studio/showcase-v3/image-gemini-4k.webp");
  });

  /*
   * One provenance label on the stage, and it reaches every width.
   *
   * The label is the only thing that credits the source and disclaims model
   * authorship, so a second claim elsewhere on the stage can contradict it,
   * and a breakpoint gate can hide it from the layout with the least room to
   * spare.
   */
  it("labels reference media without implying provider authorship", () => {
    render(<StudioDiscovery />);
    const stage = screen.getByTestId("studio-active-reference-stage");

    // `getByText` throws on a second match, so this is also the assertion that
    // the stage disclaims authorship once.
    const provenance = within(stage).getByText(/not model output/);
    expect(provenance).toHaveTextContent(
      "Original reference, not model output · RIFT Studio",
    );
    expect(provenance).toBeVisible();

    // jsdom loads no stylesheet, so a responsive display utility is invisible
    // to `toBeVisible` and only ever shows up in the class list.
    expect(
      provenance.className
        .split(/\s+/)
        .some((token) => /(^|:)(hidden|invisible)$/.test(token)),
    ).toBe(false);

    // And the originality claim is made once, by that same label.
    expect(within(stage).getAllByText(/Original/)).toHaveLength(1);
  });

  /*
   * "Original" is a claim about who made the asset, and only assets
   * art-directed for Studio can carry it. No entry in STUDIO_MODEL_REFERENCES
   * is stock today, so the stock wording has no fixture on the stage and is
   * exercised here directly.
   */
  it("claims originality only for references art-directed for Studio", () => {
    const asset = {
      kind: "image",
      src: "/studio/showcase-v3/image-lite-4k.webp",
      poster: "/studio/showcase-v3/image-lite-4k.webp",
      mobilePoster: "/studio/showcase-v3/image-lite-mobile.webp",
      thumbnail: "/studio/showcase-v3/image-lite-thumb.webp",
      title: "Rapid art direction",
      note: "Tactile color, clear negative space",
    } as const;

    expect(referenceProvenance({ ...asset, source: "RIFT Studio" })).toBe(
      "Original reference, not model output · RIFT Studio",
    );
    expect(referenceProvenance({ ...asset, source: "Pexels" })).toBe(
      "Licensed reference, not model output · Pexels",
    );
    expect(referenceProvenance({ ...asset, source: "Unsplash" })).toBe(
      "Licensed reference, not model output · Unsplash",
    );
  });

  /*
   * A reference belongs to the model it was art-directed for, or to no one.
   *
   * Sora, Wan, Runway, Hailuo and Qwen have no reference yet, and patterns
   * select them — "TV spot" is two clicks from the default view. Falling back
   * to another model's artwork would put the active model's name over a
   * picture it did not inform, the single thing STUDIO_MODEL_REFERENCES
   * promises not to do, so the stage shows a plain plate instead.
   */
  it("never captions another model's artwork with the active model", () => {
    selectedModel = "video-sora";
    render(<StudioDiscovery />);
    const stage = screen.getByTestId("studio-active-reference-stage");

    expect(within(stage).getByText("Sora 2 Pro")).toBeVisible();
    expect(stage.querySelector("img")).toBeNull();
    expect(within(stage).queryByText(/not model output/)).toBeNull();
    expect(
      within(stage).getByText(/No Studio reference has been art-directed/),
    ).toBeVisible();
    expect(
      within(stage).getByTestId("studio-provider-on-plate"),
    ).toHaveTextContent("OpenAI");
    expect(
      within(stage).queryByTestId("studio-provider-over-reference"),
    ).toBeNull();
  });

  /*
   * The rail is a roving-tabindex listbox, so exactly one row is the tab stop
   * whether or not the selected model is one of the rows. A pattern can select
   * a model the rail does not list — Sora has no reference — and keying every
   * row's tabindex off `selected` alone would leave all of them at -1 and drop
   * the list out of the tab order entirely.
   */
  it("keeps exactly one model row in the tab order", () => {
    const tabStops = () =>
      within(screen.getByTestId("studio-model-rail"))
        .getAllByRole("option")
        .filter((row) => row.getAttribute("tabindex") === "0");

    const { unmount } = render(<StudioDiscovery />);
    expect(tabStops()).toHaveLength(1);
    unmount();

    selectedModel = "video-sora";
    render(<StudioDiscovery />);
    expect(tabStops()).toHaveLength(1);
  });

  it("filters the model rail to the requested media type", () => {
    render(<StudioDiscovery />);
    const modelRail = screen.getByTestId("studio-model-rail");

    fireEvent.click(screen.getByRole("button", { name: "Video" }));

    for (const model of SHOWCASED_VIDEO) {
      expect(within(modelRail).getByText(model.name)).toBeVisible();
    }
    expect(
      within(modelRail).queryByText(IMAGE_MODELS[0].name),
    ).not.toBeInTheDocument();
  });

  it("supports arrow-key model selection and focus movement", () => {
    render(<StudioDiscovery />);
    const modelRail = screen.getByTestId("studio-model-rail");
    const current = within(modelRail)
      .getByText("Nano Banana 2")
      .closest("button");

    expect(current).not.toBeNull();
    fireEvent.keyDown(current!, { key: "ArrowRight" });

    expect(setSelectedModel).toHaveBeenLastCalledWith("image-gemini-pro");
    expect(setChatMode).toHaveBeenLastCalledWith("ask");
    expect(
      within(modelRail).getByText("Gemini 3 Pro Image").closest("button"),
    ).toHaveFocus();
  });

  it("routes model selection through the real media execution mode", () => {
    render(<StudioDiscovery />);

    fireEvent.click(screen.getByRole("option", { name: /Kling 3\.0 Pro/i }));
    expect(setSelectedModel).toHaveBeenLastCalledWith("video-kling");
    expect(setChatMode).toHaveBeenLastCalledWith("agent");

    fireEvent.click(screen.getByRole("option", { name: /FLUX\.2 Max/i }));
    expect(setSelectedModel).toHaveBeenLastCalledWith("image-flux");
    expect(setChatMode).toHaveBeenLastCalledWith("ask");
  });

  it("switches execution mode when the media type changes", () => {
    render(<StudioDiscovery />);

    fireEvent.click(screen.getByRole("button", { name: "Video" }));

    expect(setSelectedModel).toHaveBeenLastCalledWith("video-veo-fast");
    expect(setChatMode).toHaveBeenLastCalledWith("agent");
  });

  it("moves a proven creative brief into the composer", () => {
    render(<StudioDiscovery />);

    fireEvent.click(
      screen.getByRole("button", { name: "Use direction: Product film" }),
    );
    expect(setSelectedModel).toHaveBeenCalledWith("video-veo-fast");
    expect(setChatMode).toHaveBeenCalledWith("agent");
    expect(setInput).toHaveBeenCalledWith(
      expect.stringContaining("8-second 16:9"),
    );
  });

  it("synchronizes the active model before focusing the composer", () => {
    render(<StudioDiscovery />);

    fireEvent.click(screen.getByRole("button", { name: "Use in composer" }));

    expect(setSelectedModel).toHaveBeenLastCalledWith("image-gemini");
    expect(setChatMode).toHaveBeenLastCalledWith("ask");
  });

  it("repairs a retained non-media model when Studio opens", () => {
    selectedModel = "build-codex";
    render(<StudioDiscovery />);

    expect(setSelectedModel).toHaveBeenCalledWith("image-gemini");
    expect(setChatMode).toHaveBeenCalledWith("ask");
    expect(
      within(screen.getByTestId("studio-model-rail")).getByText(
        "Nano Banana 2",
      ),
    ).toBeVisible();
  });

  it("repairs Ask mode when a retained video model already matches a brief", () => {
    selectedModel = "video-kling";
    render(<StudioDiscovery />);

    fireEvent.click(
      screen.getByRole("button", { name: "Use direction: Product film" }),
    );

    expect(setSelectedModel).not.toHaveBeenCalled();
    expect(setChatMode).toHaveBeenCalledWith("agent");
  });

  it("shows static preview frames when reduced motion is requested", () => {
    selectedModel = "video-veo-fast";
    const { container } = render(<StudioDiscovery />);

    expect(container.querySelector("video")).not.toBeInTheDocument();
    expect(
      screen.getByAltText(
        "Veo 3.1 Fast capability reference: Velocity concept",
      ),
    ).toBeVisible();
  });

  it("keeps the poster mounted while motion preference is unresolved", () => {
    mockReducedMotion = null;
    selectedModel = "video-veo-fast";
    const { container } = render(<StudioDiscovery />);

    expect(container.querySelector("video")).not.toBeInTheDocument();
    expect(
      screen.getByAltText(
        "Veo 3.1 Fast capability reference: Velocity concept",
      ),
    ).toBeVisible();
  });

  it("defers multi-megabyte video loading until after the route can paint", () => {
    jest.useFakeTimers();
    mockReducedMotion = false;
    selectedModel = "video-veo-fast";
    render(<StudioDiscovery />);

    const reference = screen.getByTestId("studio-active-reference-video");
    expect(reference).not.toHaveAttribute("autoplay");
    expect(reference).toHaveProperty("muted", true);
    expect(reference).toHaveAttribute("playsinline");
    expect(reference).toHaveAttribute("preload", "none");
    expect(reference).not.toHaveAttribute("poster");
    expect(reference).toHaveAttribute("data-ready", "false");
    expect(reference).toHaveClass("opacity-0", "pointer-events-none");
    expect(reference.querySelectorAll("source")).toHaveLength(0);

    act(() => jest.advanceTimersByTime(350));

    expect(reference).toHaveAttribute("autoplay");
    expect(reference).toHaveAttribute("preload", "metadata");
    const sources = reference.querySelectorAll("source");
    expect(sources).toHaveLength(2);
    expect(sources[0]).toHaveAttribute("media", "(max-width: 780px)");
    expect(sources[0]).toHaveAttribute(
      "src",
      "/studio/showcase-v3/video-veo-fast-mobile.mp4",
    );
    expect(sources[1]).toHaveAttribute(
      "src",
      "/studio/showcase-v3/video-veo-fast-4k.mp4",
    );
    jest.useRealTimers();
  });

  it("keeps the stable poster visible until a decoded video frame is ready", () => {
    mockReducedMotion = false;
    selectedModel = "video-veo-fast";
    render(<StudioDiscovery />);

    const stage = screen.getByTestId("studio-active-reference-stage");
    const poster = screen.getByAltText(
      "Veo 3.1 Fast capability reference: Velocity concept",
    );
    const reference = screen.getByTestId("studio-active-reference-video");

    expect(stage).not.toHaveClass("animate-in", "fade-in");
    expect(poster).toBeVisible();
    expect(reference).toHaveClass("opacity-0");

    fireEvent.loadedData(reference);

    expect(poster).toBeVisible();
    expect(reference).toHaveAttribute("data-ready", "true");
    expect(reference).toHaveClass("opacity-100", "pointer-events-auto");
    expect(reference).not.toHaveClass("opacity-0");
  });

  it("keeps the preview stage mounted when switching between video models", () => {
    mockReducedMotion = false;
    selectedModel = "video-veo-fast";
    const { rerender } = render(<StudioDiscovery />);
    const stableStage = screen.getByTestId("studio-active-reference-stage");

    selectedModel = "video-kling";
    rerender(<StudioDiscovery />);

    expect(screen.getByTestId("studio-active-reference-stage")).toBe(
      stableStage,
    );
    expect(screen.getByTestId("studio-active-reference-video")).toHaveAttribute(
      "aria-label",
      "Kling 3.0 Pro curated capability reference",
    );
  });

  it("never mounts video for image-model references", () => {
    mockReducedMotion = false;
    selectedModel = "image-gemini-pro";
    const { container } = render(<StudioDiscovery />);

    expect(container.querySelector("video")).not.toBeInTheDocument();
  });

  it("keeps the provider label legible over bright reel frames", () => {
    render(<StudioDiscovery />);

    expect(screen.getByTestId("studio-provider-over-reference")).toHaveClass(
      "bg-black/65",
      "text-white",
    );
  });

  it("shows capability-aware execution details for video models", () => {
    selectedModel = "video-kling";
    render(<StudioDiscovery />);

    expect(screen.getByText("Agent job")).toBeVisible();
    expect(screen.getByText("5 / 10 sec")).toBeVisible();
    expect(screen.getByText("720p")).toBeVisible();
    expect(screen.getByText("Supported")).toBeVisible();
  });

  it("surfaces a truthful server configuration state", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ready: false,
        missing: ["OpenRouter generation", "durable media storage"],
      }),
    });
    render(<StudioDiscovery />);

    expect(await screen.findByText("Server setup required")).toBeVisible();
    expect(screen.getByText(/Missing OpenRouter generation/)).toBeVisible();
  });

  it("recovers when the runtime status request is retried", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ready: true, missing: [] }),
      });
    render(<StudioDiscovery />);

    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(screen.getByText("Runtime ready")).toBeVisible(),
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
