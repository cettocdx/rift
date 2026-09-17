import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { FilePartRenderer } from "../FilePartRenderer";
import { FileUrlCacheProvider } from "../../contexts/FileUrlCacheContext";
import type { FilePart } from "@/types/file";

const mockGetFileUrl = jest.fn();
const mockStorageQuery = jest.fn();
const mockConvex = { query: mockStorageQuery };
const mockDownload = jest.fn();
const mockToastError = jest.fn();
const mockViewerSource = jest.fn();
jest.mock("convex/react", () => ({
  useAction: () => mockGetFileUrl,
  useConvex: () => mockConvex,
}));
jest.mock("@/lib/utils/file-download", () => ({
  downloadFromUrl: (...args: unknown[]) => mockDownload(...args),
}));
jest.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));
jest.mock("next/image", () => ({
  __esModule: true,
  default: ({ fill, alt, ...props }: any) => {
    if (props.width === 1200) mockViewerSource(props.src);
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={alt} data-fill={String(!!fill)} {...props} />;
  },
}));

const fileId = "file-a" as FilePart["fileId"];
const expired = "https://media.example/expired.png";
const fresh = "https://media.example/fresh.png";
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function fixture(initial: Partial<FilePart> = {}, seeded = true) {
  const cache = new Map(seeded ? [[fileId!, expired]] : []);
  const getCachedUrl = (id: string) => cache.get(id) ?? null;
  const setCachedUrl = jest.fn((id: string, url: string) => cache.set(id, url));
  const part = {
    fileId,
    mediaType: "image/png",
    url: expired,
    name: "Original.png",
    ...initial,
  };
  const view = (next: Partial<FilePart>) => (
    <FileUrlCacheProvider
      getCachedUrl={getCachedUrl}
      setCachedUrl={setCachedUrl}
    >
      <FilePartRenderer
        part={{ ...part, ...next }}
        partIndex={0}
        messageId="answer"
      />
    </FileUrlCacheProvider>
  );
  const mounted = render(view({}));
  return {
    ...mounted,
    cache,
    setCachedUrl,
    update: (next: Partial<FilePart>) => mounted.rerender(view(next)),
  };
}
const open = () =>
  fireEvent.click(
    screen.getByRole("button", { name: "View Original.png in full size" }),
  );
const download = () =>
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Download image",
    }),
  );
beforeEach(() => {
  mockGetFileUrl.mockReset().mockReturnValue(new Promise(() => {}));
  mockStorageQuery.mockReset();
  mockDownload.mockReset().mockResolvedValue(undefined);
  mockToastError.mockReset();
  mockViewerSource.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it("resolves a fresh authorized URL when downloading a cached image from its viewer", async () => {
  const pending = deferred<string>();
  mockGetFileUrl.mockReturnValue(pending.promise);
  fixture();
  open();
  download();
  expect(mockGetFileUrl).toHaveBeenCalledWith({ fileId });
  expect(mockDownload).not.toHaveBeenCalled();
  await act(async () => pending.resolve(fresh));
  expect(mockDownload).toHaveBeenCalledWith({
    url: fresh,
    filename: "Original.png",
  });
  expect(within(screen.getByRole("dialog")).getByRole("img")).toHaveAttribute(
    "src",
    fresh,
  );
});

it("does not download the expired fallback when current durable authorization fails", async () => {
  const pending = deferred<string>();
  mockGetFileUrl.mockReturnValue(pending.promise);
  const externalOpen = jest
    .spyOn(window, "open")
    .mockImplementation(() => null);
  fixture();
  open();
  download();
  expect(mockGetFileUrl).toHaveBeenCalledWith({ fileId });
  await act(async () => pending.reject(new Error("Access denied")));
  expect(mockDownload).not.toHaveBeenCalled();
  expect(externalOpen).not.toHaveBeenCalled();
  expect(mockToastError).toHaveBeenCalledTimes(1);
});

it.each([
  { url: "https://media.example/corrected.png", name: "Corrected.png" },
  { fileId: "file-b" as FilePart["fileId"], name: "Other.png" },
  { mediaType: "application/pdf", name: "Document.pdf" },
])(
  "retires the open selection synchronously after a receipt changes: %j",
  (replacement) => {
    const f = fixture();
    open();
    mockViewerSource.mockClear();
    f.update(replacement);
    expect(mockViewerSource).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    f.update({});
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  },
);

it("updates the open image when the same receipt's canonical URL arrives", async () => {
  const pending = deferred<string>();
  mockGetFileUrl.mockReturnValue(pending.promise);
  fixture({}, false);
  open();
  await act(async () => pending.resolve(fresh));
  expect(within(screen.getByRole("dialog")).getByRole("img")).toHaveAttribute(
    "src",
    fresh,
  );
});

it("finishes a clicked original download after replacement without repopulating its cache", async () => {
  const pending = deferred<string>();
  mockGetFileUrl.mockReturnValueOnce(pending.promise);
  const f = fixture();
  open();
  download();
  f.update({ fileId: "file-b" as FilePart["fileId"], name: "Other.png" });
  await act(async () => pending.resolve(fresh));
  expect(mockDownload).toHaveBeenCalledWith({
    url: fresh,
    filename: "Original.png",
  });
  expect(f.setCachedUrl).not.toHaveBeenCalled();
  expect(mockToastError).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("resolves the durable storage ID for an image viewer download", async () => {
  mockStorageQuery.mockResolvedValue(fresh);
  fixture({ fileId: undefined, storageId: "storage-a" }, false);
  open();
  download();
  await act(async () => {});
  expect(mockStorageQuery).toHaveBeenCalledWith(expect.anything(), {
    storageId: "storage-a",
  });
  expect(mockDownload).toHaveBeenCalledWith({
    url: fresh,
    filename: "Original.png",
  });
});

it.each(["resolve", "reject"] as const)(
  "settles the clicked viewer download after unmount without stale notifications (%s)",
  async (settlement) => {
    const pending = deferred<string>();
    mockGetFileUrl.mockReturnValue(pending.promise);
    const f = fixture();
    open();
    download();
    f.unmount();
    await act(async () => {
      if (settlement === "resolve") pending.resolve(fresh);
      else pending.reject(new Error("Late authorization failure"));
    });
    if (settlement === "resolve") {
      expect(mockDownload).toHaveBeenCalledWith({
        url: fresh,
        filename: "Original.png",
      });
    } else {
      expect(mockDownload).not.toHaveBeenCalled();
    }
    expect(f.setCachedUrl).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  },
);
