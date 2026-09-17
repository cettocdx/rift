import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useQuery } from "convex/react";

import { ArtifactsGallery } from "../ArtifactsGallery";

jest.mock("convex/react", () => ({ useQuery: jest.fn() }));
jest.mock("@/convex/_generated/api", () => ({
  api: { artifacts: { listForUser: "artifacts:listForUser" } },
}));

const ARTIFACT = {
  url: "https://assets.example.test/generated.webp",
  mediaType: "image/webp",
  kind: "generated",
  chat_id: "chat-1",
  time: 1,
  generation: { prompt: "A red bicycle at dusk", model: "image-model" },
};
const SECOND_ARTIFACT = {
  ...ARTIFACT,
  url: "https://assets.example.test/second.webp",
  time: 2,
  generation: { prompt: "A green bicycle at noon", model: "image-model" },
};

const originalFetch = global.fetch;
const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
const originalCreateUrl = Object.getOwnPropertyDescriptor(
  URL,
  "createObjectURL",
);
const originalRevokeUrl = Object.getOwnPropertyDescriptor(
  URL,
  "revokeObjectURL",
);
const mockFetch = jest.fn();
const mockCreateUrl = jest.fn(() => "blob:artifact-download");
const mockRevokeUrl = jest.fn();

function restoreProperty(
  object: object,
  key: string,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) Object.defineProperty(object, key, descriptor);
  else Reflect.deleteProperty(object, key);
}

function setClipboard(writeText?: jest.Mock) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}

function openArtifact(index = 0) {
  fireEvent.click(
    screen.getAllByRole("button", { name: "Open generated image artifact" })[
      index
    ],
  );
}

describe("ArtifactsGallery action recovery", () => {
  beforeEach(() => {
    jest.mocked(useQuery).mockReturnValue([ARTIFACT, SECOND_ARTIFACT] as never);
    mockFetch.mockReset();
    mockCreateUrl.mockClear();
    mockRevokeUrl.mockClear();
    global.fetch = mockFetch;
    setClipboard(jest.fn().mockResolvedValue(undefined));
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: mockCreateUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: mockRevokeUrl,
    });
    jest.spyOn(window, "open").mockReturnValue(null);
    jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
    restoreProperty(navigator, "clipboard", originalClipboard);
    restoreProperty(URL, "createObjectURL", originalCreateUrl);
    restoreProperty(URL, "revokeObjectURL", originalRevokeUrl);
  });

  it("shows a failed download with explicit retry and a direct original-file link", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<ArtifactsGallery />);
    openArtifact();

    fireEvent.click(screen.getByRole("link", { name: "Download" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn’t download this file. Try again or open the original.",
    );
    expect(window.open).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Open original" })).toHaveAttribute(
      "href",
      ARTIFACT.url,
    );
    expect(screen.getByRole("link", { name: "Open original" })).toHaveAttribute(
      "target",
      "_blank",
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: async () => new Blob(["fixture image"], { type: "image/webp" }),
    });
    fireEvent.click(screen.getByRole("link", { name: "Retry download" }));

    await waitFor(() => expect(mockCreateUrl).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      await screen.findByRole("link", { name: "Download" }),
    ).toHaveAttribute("aria-disabled", "false");
  });

  it.each([
    ["an HTTP failure", { ok: false, status: 403 }],
    ["an empty response", { ok: true, blob: async () => new Blob([]) }],
  ])(
    "reports %s instead of silently trying a popup",
    async (_label, response) => {
      mockFetch.mockResolvedValueOnce(response);
      render(<ArtifactsGallery />);
      openArtifact();

      fireEvent.click(screen.getByRole("link", { name: "Download" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Couldn’t download this file.",
      );
      expect(window.open).not.toHaveBeenCalled();
      expect(mockCreateUrl).not.toHaveBeenCalled();
    },
  );

  it("reports clipboard rejection and confirms a successful retry", async () => {
    const writeText = jest
      .fn()
      .mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"))
      .mockResolvedValueOnce(undefined);
    setClipboard(writeText);
    render(<ArtifactsGallery />);
    openArtifact();

    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn’t copy the prompt. Try again or select and copy the text below.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry copy" }));

    expect(
      await screen.findByRole("button", { name: "Prompt copied" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(writeText).toHaveBeenNthCalledWith(2, ARTIFACT.generation.prompt);
  });

  it("explains how to recover when the Clipboard API is unavailable", async () => {
    setClipboard();
    render(<ArtifactsGallery />);
    openArtifact();

    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "select and copy the text below",
    );
    const promptText = screen.getByRole("textbox", { name: "Prompt text" });
    expect(promptText).toHaveValue(ARTIFACT.generation.prompt);
    expect(promptText).toHaveAttribute("readonly");
    promptText.focus();
    expect(promptText).toHaveFocus();
  });

  it("does not show an earlier artifact’s copy confirmation on a new preview", async () => {
    let resolveCopy!: () => void;
    setClipboard(
      jest.fn().mockReturnValue(
        new Promise<void>((resolve) => {
          resolveCopy = resolve;
        }),
      ),
    );
    render(<ArtifactsGallery />);
    openArtifact();
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    openArtifact(1);

    await act(async () => resolveCopy());

    expect(
      screen.getByRole("button", { name: "Copy prompt" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Prompt copied")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("cancels a download when its preview closes and ignores its late error", async () => {
    let rejectDownload!: (error: Error) => void;
    mockFetch.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectDownload = reject;
      }),
    );
    render(<ArtifactsGallery />);
    openArtifact();
    fireEvent.click(screen.getByRole("link", { name: "Download" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    openArtifact(1);

    await act(async () => rejectDownload(new Error("late network failure")));

    expect(mockFetch.mock.calls[0][1]?.signal.aborted).toBe(true);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      await screen.findByRole("link", { name: "Download" }),
    ).toHaveAttribute("aria-disabled", "false");
    expect(window.open).not.toHaveBeenCalled();
  });
});
