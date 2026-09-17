import { createOpenRouterVideoDownload } from "../video-download";

const response = (
  bytes: number[],
  init: { status?: number; headers?: Record<string, string> } = {},
): Response => {
  const status = init.status ?? 200;
  const headers = new Map(
    Object.entries({ "content-type": "video/mp4", ...init.headers }).map(
      ([key, value]) => [key.toLowerCase(), value],
    ),
  );
  const data = Uint8Array.from(bytes);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 302 ? "Found" : "OK",
    headers: {
      get: (name: string) => headers.get(name.toLowerCase()) ?? null,
    },
    body: null,
    arrayBuffer: async () => data.buffer,
  } as Response;
};

describe("OpenRouter video download", () => {
  it("authenticates the protected OpenRouter content endpoint", async () => {
    const fetchImpl = jest.fn(async () => response([1, 2, 3]));
    const download = createOpenRouterVideoDownload({
      apiKey: "or-secret",
      maxBytes: 16,
      fetchImpl,
    });

    await expect(
      download({
        url: new URL(
          "https://openrouter.ai/api/v1/videos/job-123/content?index=0",
        ),
      }),
    ).resolves.toEqual({
      data: Uint8Array.from([1, 2, 3]),
      mediaType: "video/mp4",
    });

    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(headers.Authorization).toBe("Bearer or-secret");
  });

  it("strips credentials when OpenRouter redirects to provider storage", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        response([], {
          status: 302,
          headers: { location: "https://cdn.example.com/video.mp4" },
        }),
      )
      .mockResolvedValueOnce(response([9, 8]));
    const download = createOpenRouterVideoDownload({
      apiKey: "or-secret",
      maxBytes: 16,
      fetchImpl,
    });

    await expect(
      download({
        url: new URL(
          "https://openrouter.ai/api/v1/videos/job-123/content?index=0",
        ),
      }),
    ).resolves.toMatchObject({ mediaType: "video/mp4" });

    expect(
      (fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>)
        .Authorization,
    ).toBe("Bearer or-secret");
    expect(fetchImpl.mock.calls[1]?.[1]?.headers).toBeUndefined();
  });

  it("enforces the generated-media byte limit before buffering", async () => {
    const fetchImpl = jest.fn(async () =>
      response([1], { headers: { "content-length": "17" } }),
    );
    const download = createOpenRouterVideoDownload({
      apiKey: "or-secret",
      maxBytes: 16,
      fetchImpl,
    });

    await expect(
      download({
        url: new URL(
          "https://openrouter.ai/api/v1/videos/job-123/content?index=0",
        ),
      }),
    ).rejects.toThrow("exceeds the 16-byte limit");
  });

  it("rejects insecure provider redirects", async () => {
    const fetchImpl = jest.fn(async () =>
      response([], {
        status: 302,
        headers: { location: "http://cdn.example.com/video.mp4" },
      }),
    );
    const download = createOpenRouterVideoDownload({
      apiKey: "or-secret",
      maxBytes: 16,
      fetchImpl,
    });

    await expect(
      download({
        url: new URL(
          "https://openrouter.ai/api/v1/videos/job-123/content?index=0",
        ),
      }),
    ).rejects.toThrow("unsafe download URL");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries transient provider failures before downloading", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        response([], {
          status: 429,
          headers: { "retry-after": "0" },
        }),
      )
      .mockResolvedValueOnce(response([4, 2]));
    const download = createOpenRouterVideoDownload({
      apiKey: "or-secret",
      maxBytes: 16,
      fetchImpl,
    });

    await expect(
      download({
        url: new URL(
          "https://openrouter.ai/api/v1/videos/job-123/content?index=0",
        ),
      }),
    ).resolves.toMatchObject({ data: Uint8Array.from([4, 2]) });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stops retrying immediately when the caller aborts", async () => {
    const controller = new AbortController();
    const fetchImpl = jest.fn(async () => {
      controller.abort(new DOMException("Cancelled", "AbortError"));
      throw controller.signal.reason;
    });
    const download = createOpenRouterVideoDownload({
      apiKey: "or-secret",
      maxBytes: 16,
      fetchImpl,
    });

    await expect(
      download({
        url: new URL(
          "https://openrouter.ai/api/v1/videos/job-123/content?index=0",
        ),
        abortSignal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
