import { render, screen, fireEvent, within } from "@testing-library/react";

const mockUseQuery = jest.fn();
jest.mock("convex/react", () => ({ useQuery: (...a: unknown[]) => mockUseQuery(...a) }));
jest.mock("@/convex/_generated/api", () => ({
  api: { artifacts: { listForUser: "artifacts.listForUser" } },
}));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { ArtifactsGallery } from "../ArtifactsGallery";

const generated = (overrides: Record<string, unknown> = {}) => ({
  url: "https://example.test/a.png",
  mediaType: "image/png",
  kind: "generated" as const,
  chat_id: "chat-1",
  time: 1700000000000,
  generation: {
    prompt: "a red bicycle at dusk",
    model: "google/gemini-3.1-flash-image",
    cost_dollars: 0.02,
    run_id: "run-abc",
  },
  ...overrides,
});

const openFirstArtifact = () =>
  fireEvent.click(screen.getAllByRole("button", { name: /artifact/i })[0]);

describe("Artifact lineage", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows how a generated asset was made", () => {
    // The prompt, model, cost and run were all unrecoverable once the message
    // scrolled away.
    mockUseQuery.mockReturnValue([generated()]);
    render(<ArtifactsGallery />);
    openFirstArtifact();

    const panel = screen.getByLabelText("How this was made");
    expect(within(panel).getByText("google/gemini-3.1-flash-image")).toBeInTheDocument();
    expect(within(panel).getByText("a red bicycle at dusk")).toBeInTheDocument();
    expect(within(panel).getByText("$0.02")).toBeInTheDocument();
  });

  it("links to the run that produced it", () => {
    mockUseQuery.mockReturnValue([generated()]);
    render(<ArtifactsGallery />);
    openFirstArtifact();

    expect(
      screen.getByRole("link", { name: "Open source run" }),
    ).toHaveAttribute("href", "/runs/run-abc");
  });

  it("shows nothing for an uploaded file, which has no lineage to invent", () => {
    mockUseQuery.mockReturnValue([
      { ...generated(), kind: "uploaded" as const, generation: undefined },
    ]);
    render(<ArtifactsGallery />);
    openFirstArtifact();

    expect(screen.queryByLabelText("How this was made")).not.toBeInTheDocument();
  });

  it("omits the run link when the asset predates run recording", () => {
    mockUseQuery.mockReturnValue([
      generated({
        generation: { prompt: "old one", model: "m", run_id: undefined },
      }),
    ]);
    render(<ArtifactsGallery />);
    openFirstArtifact();

    expect(screen.getByText("old one")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open source run" })).toBeNull();
  });

  it("hides a zero cost rather than claiming it was free", () => {
    mockUseQuery.mockReturnValue([
      generated({
        generation: { prompt: "p", model: "m", cost_dollars: 0 },
      }),
    ]);
    render(<ArtifactsGallery />);
    openFirstArtifact();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("copies the prompt and confirms in place", () => {
    const writeText = jest.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    mockUseQuery.mockReturnValue([generated()]);
    render(<ArtifactsGallery />);
    openFirstArtifact();

    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    expect(writeText).toHaveBeenCalledWith("a red bicycle at dusk");
  });
});
