import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FilePartRenderer } from "../FilePartRenderer";

const mockGetFileUrl = jest.fn();
const mockStorageQuery = jest.fn();

jest.mock("convex/react", () => ({
  useAction: () => mockGetFileUrl,
  useConvex: () => ({ query: mockStorageQuery }),
}));

describe("generated video persistence", () => {
  const originalFetch = global.fetch;
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  const originalWindowOpen = window.open;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFileUrl.mockResolvedValue(
      "https://media.example/fresh-rift-video.mp4",
    );
    mockStorageQuery.mockResolvedValue(null);
    URL.createObjectURL = jest.fn(() => "blob:rift-video");
    URL.revokeObjectURL = jest.fn();
    window.open = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
    window.open = originalWindowOpen;
  });

  const renderStoredVideo = (url?: string) =>
    render(
      <FilePartRenderer
        part={{
          fileId: "file-video" as any,
          storageId: "storage-video",
          mediaType: "video/mp4",
          name: "rift-video.mp4",
          url,
        }}
        partIndex={0}
        messageId="assistant-video"
        large
      />,
    );

  it("restores the player from its durable file id after a remount", async () => {
    const first = renderStoredVideo();

    await waitFor(() =>
      expect(screen.getByLabelText("rift-video.mp4")).toHaveAttribute(
        "src",
        "https://media.example/fresh-rift-video.mp4",
      ),
    );
    expect(screen.getByRole("button", { name: "Download" })).toBeVisible();

    first.unmount();
    renderStoredVideo();

    await waitFor(() =>
      expect(screen.getByLabelText("rift-video.mp4")).toHaveAttribute(
        "src",
        "https://media.example/fresh-rift-video.mp4",
      ),
    );
    expect(mockGetFileUrl).toHaveBeenCalledTimes(2);
  });

  it("keeps a valid fallback video visible when URL refresh fails", async () => {
    mockGetFileUrl.mockRejectedValueOnce(new Error("temporary outage"));

    renderStoredVideo("https://media.example/fallback-video.mp4");

    await waitFor(() => expect(mockGetFileUrl).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("rift-video.mp4")).toHaveAttribute(
      "src",
      "https://media.example/fallback-video.mp4",
    );
    expect(screen.queryByText(/failed to load file/i)).not.toBeInTheDocument();
  });

  it("rejects an HTTP error body instead of saving it as a video", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      blob: jest.fn(),
    });
    renderStoredVideo();
    await screen.findByLabelText("rift-video.mp4");

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "https://media.example/fresh-rift-video.mp4",
        { signal: undefined },
      ),
    );
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });
});
