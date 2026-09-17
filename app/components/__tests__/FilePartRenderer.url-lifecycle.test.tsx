import { act, render, screen, waitFor } from "@testing-library/react";
import { FilePartRenderer } from "../FilePartRenderer";
import { FileUrlCacheProvider } from "../../contexts/FileUrlCacheContext";
import type { FilePart } from "@/types/file";

const mockGetFileUrl = jest.fn();
const mockStorageQuery = jest.fn();
const mockConvex = { query: mockStorageQuery };
const mockToastError = jest.fn();
const mockImageSource = jest.fn();
jest.mock("convex/react", () => ({
  useAction: () => mockGetFileUrl,
  useConvex: () => mockConvex,
}));
jest.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));
jest.mock("../ImageViewer", () => ({ ImageViewer: () => null }));
jest.mock("next/image", () => ({
  __esModule: true,
  default: ({ fill, alt, ...props }: any) => {
    mockImageSource(props.src);
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img alt={alt} data-fill={String(!!fill)} {...props} />
    );
  },
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function fixture(
  initial: Partial<FilePart>,
  entries: Array<[string, string]> = [],
) {
  const cache = new Map(entries);
  const getCachedUrl = (id: string) => cache.get(id) ?? null;
  const setCachedUrl = jest.fn((id: string, url: string) => {
    cache.set(id, url);
  });
  const view = (part: Partial<FilePart>) => (
    <FileUrlCacheProvider
      getCachedUrl={getCachedUrl}
      setCachedUrl={setCachedUrl}
    >
      <FilePartRenderer
        part={{ mediaType: "image/png", name: "Result", ...part }}
        partIndex={0}
        messageId="answer"
      />
    </FileUrlCacheProvider>
  );
  const mounted = render(view(initial));
  return {
    ...mounted,
    cache,
    setCachedUrl,
    update: (part: Partial<FilePart>) => mounted.rerender(view(part)),
  };
}
const fileId = "file-one" as FilePart["fileId"];
const v1 = "https://media.example/v1.png";
const v2 = "https://media.example/v2.png";
beforeEach(() => {
  mockGetFileUrl.mockReset();
  mockStorageQuery.mockReset();
  mockToastError.mockReset();
  mockImageSource.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it("refreshes the canonical file ID on a corrected receipt and keeps the new fallback if refresh fails", async () => {
  const pending = deferred<string>();
  mockGetFileUrl.mockReturnValue(pending.promise);
  const f = fixture({ fileId, url: v1 }, [[fileId!, v1]]);
  expect(screen.getByRole("img")).toHaveAttribute("src", v1);
  f.update({ fileId, url: v2 });
  expect(screen.getByRole("img")).toHaveAttribute("src", v2);
  expect(mockGetFileUrl).toHaveBeenCalledWith({ fileId });
  await act(async () => pending.reject(new Error("temporary outage")));
  expect(screen.getByRole("img")).toHaveAttribute("src", v2);
  expect(mockToastError).not.toHaveBeenCalled();
  expect(f.setCachedUrl).not.toHaveBeenCalled();
});

it("still prefers the authorized canonical response over a corrected receipt URL", async () => {
  mockGetFileUrl.mockResolvedValue("https://media.example/authorized.png");
  const f = fixture({ fileId, url: v1 }, [[fileId!, v1]]);
  f.update({ fileId, url: v2 });
  await waitFor(() =>
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "https://media.example/authorized.png",
    ),
  );
  expect(mockGetFileUrl).toHaveBeenCalledTimes(1);
  expect(f.cache.get(fileId!)).toBe("https://media.example/authorized.png");
});

it("ignores the earlier pending receipt response after the same file ID is corrected", async () => {
  const old = deferred<string>(),
    current = deferred<string>();
  mockGetFileUrl
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);
  const f = fixture({ fileId, url: v1 });
  f.update({ fileId, url: v2 });
  await act(async () => current.resolve(v2));
  await act(async () => old.resolve(v1));
  expect(screen.getByRole("img")).toHaveAttribute("src", v2);
  expect(f.cache.get(fileId!)).toBe(v2);
  expect(f.setCachedUrl).toHaveBeenCalledTimes(1);
});

it("ignores a stale storage URL response after switching to another storage ID", async () => {
  const old = deferred<string>(),
    current = deferred<string>();
  mockStorageQuery
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);
  const f = fixture({ storageId: "old" });
  f.update({ storageId: "current" });
  await act(async () => current.resolve(v2));
  await act(async () => old.resolve(v1));
  expect(screen.getByRole("img")).toHaveAttribute("src", v2);
});

it.each(["resolve", "reject"] as const)(
  "ignores a file URL request that settles after unmount (%s)",
  async (settlement) => {
    const pending = deferred<string>();
    mockGetFileUrl.mockReturnValue(pending.promise);
    const f = fixture({ fileId });
    f.unmount();
    await act(async () => {
      if (settlement === "resolve") pending.resolve(v1);
      else pending.reject(new Error("late failure"));
    });
    expect(f.setCachedUrl).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  },
);

it("never renders the old URL during the corrected receipt commit before effects settle", () => {
  mockGetFileUrl.mockReturnValue(new Promise(() => {}));
  const f = fixture({ fileId, url: v1 }, [[fileId!, v1]]);
  mockImageSource.mockClear();
  f.update({ fileId, url: v2 });
  expect(mockImageSource).toHaveBeenCalled();
  expect(mockImageSource.mock.calls.every(([src]) => src === v2)).toBe(true);
});
