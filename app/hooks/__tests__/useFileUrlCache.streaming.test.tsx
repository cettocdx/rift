import { act, renderHook } from "@testing-library/react";
import { useFileUrlCache } from "../useFileUrlCache";
import type { ChatMessage } from "@/types";

const mockGetUrls = jest.fn();
let mockCurrentAction = mockGetUrls;
jest.mock("convex/react", () => ({ useAction: () => mockCurrentAction }));
jest.mock("@/convex/_generated/api", () => ({
  api: { s3Actions: { getFileUrlsBatchAction: "getUrls" } },
}));

function messages(text: string, ids = ["image-one"]): ChatMessage[] {
  return [
    {
      id: "answer",
      role: "assistant",
      parts: [
        ...ids.map((fileId) => ({
          type: "file",
          fileId,
          s3Key: `fixtures/${fileId}`,
          mediaType: "image/png",
          url: "",
        })),
        { type: "text", text },
      ],
    },
  ] as ChatMessage[];
}

beforeEach(() => {
  mockGetUrls.mockReset();
  mockCurrentAction = mockGetUrls;
});
afterEach(() => jest.restoreAllMocks());

it("does not start another URL request for each text delta while an image is loading", async () => {
  let resolve!: (value: Record<string, string>) => void;
  mockGetUrls.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { rerender, result } = renderHook(
    ({ text }) => useFileUrlCache(messages(text)),
    { initialProps: { text: "First" } },
  );
  for (let i = 0; i < 120; i++) rerender({ text: `Delta ${i}` });
  expect(mockGetUrls).toHaveBeenCalledTimes(1);
  await act(async () =>
    resolve({ "image-one": "https://example.com/image.png" }),
  );
  expect(result.current.getCachedUrl("image-one")).toBe(
    "https://example.com/image.png",
  );
  rerender({ text: "Finished" });
  expect(mockGetUrls).toHaveBeenCalledTimes(1);
});

it("allows a failed image request to retry on the next message update", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  mockGetUrls
    .mockRejectedValueOnce(new Error("Synthetic offline failure"))
    .mockResolvedValue({ "image-one": "https://example.com/retry.png" });
  const { rerender, result } = renderHook(
    ({ text }) => useFileUrlCache(messages(text)),
    { initialProps: { text: "First" } },
  );
  await act(async () => {});
  rerender({ text: "Next delta" });
  await act(async () => {});
  expect(mockGetUrls).toHaveBeenCalledTimes(2);
  expect(result.current.getCachedUrl("image-one")).toBe(
    "https://example.com/retry.png",
  );
  log.mockRestore();
});

it("loads a newly added image independently while another request is pending", async () => {
  let resolveFirst!: (value: Record<string, string>) => void;
  mockGetUrls.mockImplementation(({ fileIds }) =>
    fileIds.includes("image-one")
      ? new Promise((done) => {
          resolveFirst = done;
        })
      : Promise.resolve({ "image-two": "https://example.com/two.png" }),
  );
  const { rerender, result } = renderHook(
    ({ ids }) => useFileUrlCache(messages("Reply", ids)),
    { initialProps: { ids: ["image-one"] } },
  );
  rerender({ ids: ["image-one", "image-two"] });
  await act(async () => {});
  expect(mockGetUrls).toHaveBeenNthCalledWith(2, { fileIds: ["image-two"] });
  expect(result.current.getCachedUrl("image-two")).toBe(
    "https://example.com/two.png",
  );
  await act(async () =>
    resolveFirst({ "image-one": "https://example.com/one.png" }),
  );
  expect(result.current.getCachedUrl("image-one")).toBe(
    "https://example.com/one.png",
  );
});

function deferredBatch() {
  let resolve!: (value: Record<string, string>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Record<string, string>>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

it("keeps a newer explicit URL when the older batch completes", async () => {
  const pending = deferredBatch();
  mockGetUrls.mockReturnValue(pending.promise);
  const { result } = renderHook(() => useFileUrlCache(messages("First")));
  result.current.setCachedUrl("image-one", "https://example.com/new.png");
  await act(async () =>
    pending.resolve({ "image-one": "https://example.com/old.png" }),
  );
  expect(result.current.getCachedUrl("image-one")).toBe(
    "https://example.com/new.png",
  );
});

it.each(["resolve", "reject"] as const)(
  "ignores batch %s after unmount",
  async (settlement) => {
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    const pending = deferredBatch();
    mockGetUrls.mockReturnValue(pending.promise);
    const { result, unmount } = renderHook(() =>
      useFileUrlCache(messages("First")),
    );
    const cache = result.current;
    unmount();
    await act(async () => {
      if (settlement === "resolve")
        pending.resolve({ "image-one": "https://example.com/old.png" });
      else pending.reject(new Error("Obsolete failure"));
    });
    expect(cache.getCachedUrl("image-one")).toBeNull();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  },
);

it("ignores a removed image batch without releasing the replacement request", async () => {
  const old = deferredBatch(),
    current = deferredBatch();
  mockGetUrls
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);
  const { result, rerender } = renderHook(
    ({ ids }) => useFileUrlCache(messages("Text", ids)),
    {
      initialProps: { ids: ["image-one"] },
    },
  );
  rerender({ ids: [] });
  rerender({ ids: ["image-one"] });
  expect(mockGetUrls).toHaveBeenCalledTimes(2);
  await act(async () =>
    old.resolve({ "image-one": "https://example.com/old.png" }),
  );
  expect(result.current.getCachedUrl("image-one")).toBeNull();
  rerender({ ids: ["image-one"] });
  expect(mockGetUrls).toHaveBeenCalledTimes(2);
  await act(async () =>
    current.resolve({ "image-one": "https://example.com/new.png" }),
  );
  expect(result.current.getCachedUrl("image-one")).toBe(
    "https://example.com/new.png",
  );
});

it("does not log a failed batch whose image was removed", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  const pending = deferredBatch();
  mockGetUrls.mockReturnValue(pending.promise);
  const { rerender } = renderHook(
    ({ ids }) => useFileUrlCache(messages("Text", ids)),
    {
      initialProps: { ids: ["image-one"] },
    },
  );
  rerender({ ids: [] });
  await act(async () => pending.reject(new Error("Obsolete failure")));
  expect(log).not.toHaveBeenCalled();
  log.mockRestore();
});

it("ignores batch response IDs that were not requested", async () => {
  mockGetUrls.mockResolvedValue({
    "image-one": "one",
    unrelated: "unrequested",
  });
  const { result } = renderHook(() => useFileUrlCache(messages("First")));
  await act(async () => {});
  expect(result.current.getCachedUrl("image-one")).toBe("one");
  expect(result.current.getCachedUrl("unrelated")).toBeNull();
});

it("retires an obsolete action batch while preserving the replacement batch", async () => {
  const old = deferredBatch(),
    current = deferredBatch();
  mockGetUrls.mockReturnValue(old.promise);
  const { result, rerender } = renderHook(
    ({ text }) => useFileUrlCache(messages(text)),
    {
      initialProps: { text: "First" },
    },
  );
  mockCurrentAction = jest.fn().mockReturnValue(current.promise);
  rerender({ text: "Replacement client" });
  expect(mockCurrentAction).toHaveBeenCalledTimes(1);
  await act(async () => old.resolve({ "image-one": "old" }));
  expect(result.current.getCachedUrl("image-one")).toBeNull();
  rerender({ text: "Streaming delta" });
  expect(mockCurrentAction).toHaveBeenCalledTimes(1);
  await act(async () => current.resolve({ "image-one": "current" }));
  expect(result.current.getCachedUrl("image-one")).toBe("current");
});

it("ignores explicit cache writes after unmount", () => {
  mockGetUrls.mockReturnValue(new Promise(() => {}));
  const { result, unmount } = renderHook(() =>
    useFileUrlCache(messages("First")),
  );
  const cache = result.current;
  unmount();
  cache.setCachedUrl("image-one", "late explicit write");
  expect(cache.getCachedUrl("image-one")).toBeNull();
});

it("does not let an old explicit writer update the replacement action cache", () => {
  mockGetUrls.mockReturnValue(new Promise(() => {}));
  const { result, rerender } = renderHook(
    ({ text }) => useFileUrlCache(messages(text)),
    {
      initialProps: { text: "First" },
    },
  );
  const oldCache = result.current;
  mockCurrentAction = jest.fn().mockReturnValue(new Promise(() => {}));
  rerender({ text: "Replacement client" });
  result.current.setCachedUrl("image-one", "new authority");
  oldCache.setCachedUrl("image-one", "old authority");
  expect(result.current.getCachedUrl("image-one")).toBe("new authority");
  expect(oldCache.getCachedUrl("image-one")).toBeNull();
});

it("keeps batches capped at 50 and retries only omitted IDs on an update", async () => {
  const ids = Array.from({ length: 102 }, (_, index) => `image-${index}`);
  mockGetUrls.mockImplementation(async ({ fileIds }: { fileIds: string[] }) =>
    Object.fromEntries(
      fileIds
        .filter((id) => id !== "image-3")
        .map((id) => [id, `https://example.com/${id}`]),
    ),
  );
  const { result, rerender } = renderHook(
    ({ text }) => useFileUrlCache(messages(text, ids)),
    {
      initialProps: { text: "First" },
    },
  );
  await act(async () => {});
  expect(mockGetUrls.mock.calls.map(([args]) => args.fileIds.length)).toEqual([
    50, 50, 2,
  ]);
  expect(result.current.getCachedUrl("image-101")).toBe(
    "https://example.com/image-101",
  );
  rerender({ text: "Next delta" });
  await act(async () => {});
  expect(mockGetUrls).toHaveBeenLastCalledWith({ fileIds: ["image-3"] });
});

it("expires at 50 minutes and allows another prefetch", async () => {
  let now = 1_000;
  jest.spyOn(Date, "now").mockImplementation(() => now);
  mockGetUrls.mockResolvedValue({ "image-one": "first" });
  const { result, rerender } = renderHook(
    ({ text }) => useFileUrlCache(messages(text)),
    {
      initialProps: { text: "First" },
    },
  );
  await act(async () => {});
  now += 50 * 60 * 1000;
  expect(result.current.getCachedUrl("image-one")).toBe("first");
  now += 1;
  expect(result.current.getCachedUrl("image-one")).toBeNull();
  mockGetUrls.mockResolvedValue({ "image-one": "refreshed" });
  rerender({ text: "Next delta" });
  await act(async () => {});
  expect(mockGetUrls).toHaveBeenCalledTimes(2);
  expect(result.current.getCachedUrl("image-one")).toBe("refreshed");
});

it("keeps independent mounted caches separate", () => {
  mockGetUrls.mockReturnValue(new Promise(() => {}));
  const a = renderHook(() => useFileUrlCache(messages("A")));
  const b = renderHook(() => useFileUrlCache(messages("B")));
  a.result.current.setCachedUrl("image-one", "A URL");
  b.result.current.setCachedUrl("image-one", "B URL");
  expect(a.result.current.getCachedUrl("image-one")).toBe("A URL");
  expect(b.result.current.getCachedUrl("image-one")).toBe("B URL");
  a.unmount();
  expect(b.result.current.getCachedUrl("image-one")).toBe("B URL");
});

it("keeps the replacement request alive through Strict Mode effect replay", async () => {
  const old = deferredBatch(),
    current = deferredBatch();
  mockGetUrls
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);
  const { result, rerender } = renderHook(
    ({ text }) => useFileUrlCache(messages(text)),
    {
      initialProps: { text: "First" },
      reactStrictMode: true,
    },
  );
  expect(mockGetUrls).toHaveBeenCalledTimes(2);
  await act(async () => old.resolve({ "image-one": "old" }));
  expect(result.current.getCachedUrl("image-one")).toBeNull();
  rerender({ text: "Next delta" });
  expect(mockGetUrls).toHaveBeenCalledTimes(2);
  await act(async () => current.resolve({ "image-one": "current" }));
  expect(result.current.getCachedUrl("image-one")).toBe("current");
});

it("periodically expires prefetched IDs and removes its cleanup timer on unmount", async () => {
  jest.useFakeTimers();
  const startInterval = jest.spyOn(global, "setInterval");
  const stopInterval = jest.spyOn(global, "clearInterval");
  try {
    mockGetUrls.mockResolvedValue({ "image-one": "first" });
    const { rerender, unmount } = renderHook(
      ({ text }) => useFileUrlCache(messages(text)),
      {
        initialProps: { text: "First" },
      },
    );
    await act(async () => {});
    expect(startInterval).toHaveBeenCalledWith(
      expect.any(Function),
      5 * 60 * 1000,
    );
    const interval = startInterval.mock.results[0].value;
    act(() => jest.advanceTimersByTime(55 * 60 * 1000));
    rerender({ text: "Next delta" });
    await act(async () => {});
    expect(mockGetUrls).toHaveBeenCalledTimes(2);
    unmount();
    expect(stopInterval).toHaveBeenCalledWith(interval);
  } finally {
    jest.useRealTimers();
  }
});
