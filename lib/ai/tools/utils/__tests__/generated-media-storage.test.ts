jest.mock("@/lib/db/convex-client", () => ({
  ...jest.requireActual<typeof import("@/lib/db/convex-client")>(
    "@/lib/db/convex-client",
  ),
  getConvexClient: jest.fn(),
}));

import { getConvexClient } from "@/lib/db/convex-client";
import {
  canPersistGeneratedMedia,
  persistGeneratedMediaBytes,
} from "../generated-media-storage";

const mockGetConvexClient = getConvexClient as jest.MockedFunction<
  typeof getConvexClient
>;

describe("generated media storage preflight", () => {
  const originalConvexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const originalServiceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockGetConvexClient.mockReset();
    mockGetConvexClient.mockReturnValue({ action: jest.fn() } as any);
    global.fetch = jest.fn();
  });

  afterEach(() => {
    if (originalConvexUrl === undefined) {
      delete process.env.NEXT_PUBLIC_CONVEX_URL;
    } else {
      process.env.NEXT_PUBLIC_CONVEX_URL = originalConvexUrl;
    }
    if (originalServiceKey === undefined) {
      delete process.env.CONVEX_SERVICE_ROLE_KEY;
    } else {
      process.env.CONVEX_SERVICE_ROLE_KEY = originalServiceKey;
    }
    global.fetch = originalFetch;
  });

  it.each([
    ["Convex URL", undefined, "service-key"],
    ["service key", "https://example.convex.cloud", undefined],
  ])(
    "fails closed when the %s is missing",
    async (_missingSetting, convexUrl, serviceKey) => {
      if (convexUrl === undefined) {
        delete process.env.NEXT_PUBLIC_CONVEX_URL;
      } else {
        process.env.NEXT_PUBLIC_CONVEX_URL = convexUrl;
      }
      if (serviceKey === undefined) {
        delete process.env.CONVEX_SERVICE_ROLE_KEY;
      } else {
        process.env.CONVEX_SERVICE_ROLE_KEY = serviceKey;
      }

      expect(canPersistGeneratedMedia()).toBe(false);
      await expect(
        persistGeneratedMediaBytes({
          bytes: new Uint8Array([1]),
          mediaType: "image/png",
          name: "generated.png",
          userId: "user-1",
        }),
      ).rejects.toThrow("storage is not configured");
      expect(mockGetConvexClient).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );

  it("reports readiness only when both durable-storage settings exist", () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.CONVEX_SERVICE_ROLE_KEY = "service-key";

    expect(canPersistGeneratedMedia()).toBe(true);
  });

  it("routes persistence through the shared client before and after an override", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://configured.convex.cloud";
    process.env.CONVEX_SERVICE_ROLE_KEY = "service-key";

    const primaryAction = jest
      .fn()
      .mockResolvedValueOnce("https://uploads.example/primary")
      .mockResolvedValueOnce({
        url: "https://media.example/primary.png",
        fileId: "file_primary",
      });
    const overrideAction = jest
      .fn()
      .mockResolvedValueOnce("https://uploads.example/override")
      .mockResolvedValueOnce({
        url: "https://media.example/override.png",
        fileId: "file_override",
      });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ storageId: "storage_primary" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ storageId: "storage_override" }),
      });

    mockGetConvexClient.mockReturnValue({ action: primaryAction } as any);
    await persistGeneratedMediaBytes({
      bytes: new Uint8Array([1]),
      mediaType: "image/png",
      name: "primary.png",
      userId: "user-1",
    });

    mockGetConvexClient.mockReturnValue({ action: overrideAction } as any);
    await persistGeneratedMediaBytes({
      bytes: new Uint8Array([2]),
      mediaType: "image/png",
      name: "override.png",
      userId: "user-1",
    });

    expect(mockGetConvexClient).toHaveBeenCalledTimes(2);
    expect(primaryAction).toHaveBeenCalledTimes(2);
    expect(overrideAction).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "https://uploads.example/primary",
      expect.objectContaining({ method: "POST" }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "https://uploads.example/override",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("registers completed media as a message attachment", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://configured.convex.cloud";
    process.env.CONVEX_SERVICE_ROLE_KEY = "service-key";
    const add = jest.fn();
    const action = jest
      .fn()
      .mockResolvedValueOnce("https://uploads.example/video")
      .mockResolvedValueOnce({
        url: "https://media.example/video.mp4",
        fileId: "file_video",
      });
    mockGetConvexClient.mockReturnValue({ action } as any);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ storageId: "storage_video" }),
    });

    await persistGeneratedMediaBytes({
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: "video/mp4",
      name: "rift-video.mp4",
      userId: "user-1",
      fileAccumulator: { add } as any,
    });

    expect(add).toHaveBeenCalledWith({
      fileId: "file_video",
      storageId: "storage_video",
      name: "rift-video.mp4",
      mediaType: "video/mp4",
    });
  });
});
