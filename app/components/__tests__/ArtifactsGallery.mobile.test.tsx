import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useQuery } from "convex/react";

import { ArtifactsGallery } from "../ArtifactsGallery";

jest.mock("convex/react", () => ({
  useQuery: jest.fn(),
}));

jest.mock("@/convex/_generated/api", () => ({
  api: { artifacts: { listForUser: "artifacts:listForUser" } },
}));

const GENERATED_IMAGE = {
  url: "https://assets.example.test/generated.webp",
  mediaType: "image/webp",
  kind: "generated",
  chat_id: "chat-1",
  time: 1,
};

const GENERATED_VIDEO = {
  url: "https://assets.example.test/generated.mp4",
  mediaType: "video/mp4",
  kind: "generated",
  chat_id: "chat-1",
  time: 2,
};

const UPLOADED_IMAGE = {
  url: "https://assets.example.test/uploaded.png",
  mediaType: "image/png",
  kind: "uploaded",
  chat_id: "chat-2",
  time: 3,
};

/** Stands in for the Convex query the gallery reads its library from. */
function mockLibrary(artifacts: Array<Record<string, unknown>>) {
  jest.mocked(useQuery).mockReturnValue(artifacts as never);
}

describe("ArtifactsGallery mobile surface", () => {
  beforeEach(() => {
    mockLibrary([GENERATED_IMAGE, GENERATED_VIDEO, UPLOADED_IMAGE]);
  });

  it("uses touch-sized filters and a safe full-dvh preview without overflow", () => {
    render(<ArtifactsGallery />);

    expect(screen.getByRole("button", { name: /^All / })).toHaveClass(
      "min-h-11",
      "touch-manipulation",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open generated image artifact" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Image preview" });
    expect(dialog).toHaveClass(
      "h-[100dvh]",
      "max-h-[100dvh]",
      "w-screen",
      "max-w-none",
      "overflow-hidden",
    );
    expect(
      dialog.querySelector('[data-ui="artifact-lightbox-layout"]'),
    ).toHaveClass(
      "min-h-0",
      "w-full",
      "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
      "pt-[max(0.75rem,env(safe-area-inset-top))]",
    );
    expect(
      within(dialog).getByRole("link", { name: "Open original" }),
    ).toHaveClass("min-h-11", "touch-manipulation");
    // Dismissal is a fixed 44px square, not a third of the row: three
    // equal-width buttons that each carry a label cannot hold "Open original"
    // on one line at 375px.
    const close = within(dialog).getByRole("button", { name: "Close" });
    expect(close).toHaveClass(
      "min-h-11",
      "w-11",
      "shrink-0",
      "touch-manipulation",
    );
    expect(close).not.toHaveClass("flex-1");
  });

  it("badges a tile's kind while the grid holds both kinds", () => {
    render(<ArtifactsGallery />);

    expect(
      screen.getByRole("button", { name: "Open generated image artifact" }),
    ).toHaveTextContent("Generated");
    expect(
      screen.getByRole("button", { name: "Open uploaded image artifact" }),
    ).toHaveTextContent("Uploaded");
  });

  it("drops the kind badge once a filter narrows the grid to one kind", () => {
    render(<ArtifactsGallery />);

    fireEvent.click(screen.getByRole("button", { name: /^Generated / }));

    const tile = screen.getByRole("button", {
      name: "Open generated image artifact",
    });
    expect(tile).not.toHaveTextContent("Generated");
    expect(
      screen.queryByRole("button", { name: "Open uploaded image artifact" }),
    ).not.toBeInTheDocument();
  });

  it("drops the kind badge in the unfiltered view of a single-kind library", () => {
    mockLibrary([GENERATED_IMAGE, GENERATED_VIDEO]);
    render(<ArtifactsGallery />);

    expect(screen.getByRole("button", { name: /^All / })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The chip is unfiltered but the library is not mixed, so the word
    // "Generated" would land on every tile and distinguish nothing.
    expect(
      screen.getByRole("button", { name: "Open generated image artifact" }),
    ).not.toHaveTextContent("Generated");
  });

  it("tells the reader how to fill each empty view", () => {
    mockLibrary([GENERATED_IMAGE]);
    const view = render(<ArtifactsGallery />);

    fireEvent.click(screen.getByRole("button", { name: /^Uploaded / }));
    expect(
      screen.getByRole("heading", { name: "No uploaded artifacts" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Attach an image or a video to a message and it will appear here.",
      ),
    ).toBeInTheDocument();

    view.unmount();
    mockLibrary([UPLOADED_IMAGE]);
    render(<ArtifactsGallery />);

    fireEvent.click(screen.getByRole("button", { name: /^Generated / }));
    expect(
      screen.getByRole("heading", { name: "No generated artifacts" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Ask RIFT for an image or a video in any chat and it will appear here.",
      ),
    ).toBeInTheDocument();
  });

  it("points an empty library at both ways of adding to it", () => {
    mockLibrary([]);
    render(<ArtifactsGallery />);

    expect(
      screen.getByRole("heading", { name: "No artifacts yet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Generate an image or video, or attach one in a chat. It will appear here automatically.",
      ),
    ).toBeInTheDocument();
  });

  it("restores generated videos with a stable frame, native controls, and a durable download", () => {
    render(<ArtifactsGallery />);

    const tile = screen.getByRole("button", {
      name: "Open generated video artifact",
    });
    const tileVideo = tile.querySelector(
      '[data-ui="artifact-video-tile"]',
    ) as HTMLVideoElement;

    expect(tileVideo).toHaveAttribute(
      "src",
      "https://assets.example.test/generated.mp4",
    );
    expect(tileVideo).toHaveAttribute("preload", "metadata");
    expect(tileVideo).toHaveAttribute("playsinline");
    expect(tileVideo).not.toHaveAttribute("autoplay");

    fireEvent.loadedData(tileVideo);
    expect(tileVideo).toHaveClass("visible");
    expect(tile.querySelector('[data-ui="artifact-video-poster"]')).toHaveClass(
      "invisible",
    );

    fireEvent.click(tile);

    const dialog = screen.getByRole("dialog", { name: "Video preview" });
    const preview = dialog.querySelector(
      '[data-ui="artifact-video-preview"]',
    ) as HTMLVideoElement;
    expect(preview).toHaveAttribute("controls");
    expect(preview).toHaveAttribute("preload", "metadata");
    expect(preview).not.toHaveAttribute("autoplay");

    expect(
      within(dialog).getByRole("link", { name: "Download" }),
    ).toHaveAttribute("download", "rift-generated-video-2.mp4");
    expect(
      within(dialog).getByRole("link", { name: "Download" }),
    ).toHaveAttribute("href", "https://assets.example.test/generated.mp4");
  });
});
