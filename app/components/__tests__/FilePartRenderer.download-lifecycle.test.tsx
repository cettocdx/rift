import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { FilePartRenderer } from "../FilePartRenderer";
import { FileUrlCacheProvider } from "../../contexts/FileUrlCacheContext";
import type { FilePart } from "@/types/file";

const mockGetFileUrl = jest.fn();
const mockQuery = jest.fn();
const mockConvex = { query: mockQuery };
const mockDownload = jest.fn();
const mockToastError = jest.fn();
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
jest.mock("../ImageViewer", () => ({ ImageViewer: () => null }));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const id = "file" as FilePart["fileId"];
const v1 = "https://media.example/v1.mp4",
  v2 = "https://media.example/v2.mp4";
function fixture(
  part: Partial<FilePart> = {},
  entries: Array<[string, string]> = [],
) {
  const cache = new Map(entries);
  const getCachedUrl = (fileId: string) => cache.get(fileId) ?? null;
  const setCachedUrl = jest.fn((fileId: string, url: string) => {
    cache.set(fileId, url);
  });
  const view = (next: Partial<FilePart>) => (
    <FileUrlCacheProvider
      getCachedUrl={getCachedUrl}
      setCachedUrl={setCachedUrl}
    >
      <FilePartRenderer
        part={{
          fileId: id,
          name: "report.pdf",
          mediaType: "application/pdf",
          url: v1,
          ...next,
        }}
        partIndex={0}
        messageId="answer"
      />
    </FileUrlCacheProvider>
  );
  const mounted = render(view(part));
  return {
    ...mounted,
    cache,
    setCachedUrl,
    update: (next: Partial<FilePart>) => mounted.rerender(view(next)),
  };
}
const button = () => screen.getByRole("button", { name: /download/i });
beforeEach(() => {
  mockGetFileUrl.mockReset();
  mockQuery.mockReset();
  mockDownload.mockReset().mockResolvedValue(undefined);
  mockToastError.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(window, "open").mockImplementation(() => null);
});
afterEach(() => jest.restoreAllMocks());

it("locks the clicked receipt before authorization resolves, including batched double clicks", async () => {
  const pending = deferred<string>();
  mockGetFileUrl.mockReturnValue(pending.promise);
  fixture();
  const target = button();
  act(() => {
    fireEvent.click(target);
    fireEvent.click(target);
  });
  expect(mockGetFileUrl).toHaveBeenCalledTimes(1);
  expect(button()).toBeDisabled();
  await act(async () => pending.resolve(v1));
  expect(mockDownload).toHaveBeenCalledTimes(1);
  expect(button()).not.toBeDisabled();
});

it.each(["fileId", "storageId"] as const)(
  "does not bypass %s authorization failure with an old URL",
  async (kind) => {
    const failure = new Error("Access denied");
    if (kind === "fileId") mockGetFileUrl.mockRejectedValue(failure);
    else mockQuery.mockRejectedValue(failure);
    fixture(
      kind === "storageId" ? { fileId: undefined, storageId: "stored" } : {},
    );
    fireEvent.click(button());
    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    expect(mockDownload).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  },
);

it("finishes the clicked download without overwriting a newer receipt's media or cache", async () => {
  const pending = deferred<string>();
  mockGetFileUrl.mockReturnValueOnce(pending.promise).mockResolvedValue(v2);
  const f = fixture({ mediaType: "video/mp4", name: "v1.mp4" }, [[id!, v1]]);
  fireEvent.click(button());
  f.update({ mediaType: "video/mp4", name: "v2.mp4", url: v2 });
  await waitFor(() =>
    expect(screen.getByLabelText("v2.mp4")).toHaveAttribute("src", v2),
  );
  await act(async () => pending.resolve(v1));
  expect(mockDownload).toHaveBeenCalledWith({ url: v1, filename: "v1.mp4" });
  expect(screen.getByLabelText("v2.mp4")).toHaveAttribute("src", v2);
  expect(f.cache.get(id!)).toBe(v2);
  expect(f.setCachedUrl).toHaveBeenCalledTimes(1);
});

it("does not show an old receipt's authorization error on the newer receipt", async () => {
  const pending = deferred<string>();
  mockGetFileUrl.mockReturnValue(pending.promise);
  const f = fixture();
  fireEvent.click(button());
  f.update({ url: v2, name: "new.pdf" });
  await act(async () => pending.reject(new Error("old request denied")));
  expect(mockToastError).not.toHaveBeenCalled();
  expect(window.open).not.toHaveBeenCalled();
});

it("keeps B busy when A finishes while B's own authorization is pending", async () => {
  const a = deferred<string>(),
    b = deferred<string>();
  mockGetFileUrl.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const f = fixture();
  fireEvent.click(button());
  f.update({ url: v2, name: "new.pdf" });
  fireEvent.click(button());
  expect(mockGetFileUrl).toHaveBeenCalledTimes(2);
  await act(async () => a.resolve(v1));
  expect(button()).toBeDisabled();
  await act(async () => b.resolve(v2));
  expect(button()).not.toBeDisabled();
  expect(mockDownload).toHaveBeenCalledTimes(2);
});

it("preserves a real clicked download after unmount without writing the old view cache", async () => {
  const pending = deferred<string>();
  mockGetFileUrl.mockReturnValue(pending.promise);
  const f = fixture();
  fireEvent.click(button());
  f.unmount();
  await act(async () => pending.resolve(v1));
  expect(mockDownload).toHaveBeenCalledWith({
    url: v1,
    filename: "report.pdf",
  });
  expect(f.setCachedUrl).not.toHaveBeenCalled();
  expect(mockToastError).not.toHaveBeenCalled();
});

it("does not emit a stale error or open a fallback after unmount", async () => {
  const pending = deferred<string>();
  mockGetFileUrl.mockReturnValue(pending.promise);
  const f = fixture();
  fireEvent.click(button());
  f.unmount();
  await act(async () => pending.reject(new Error("denied")));
  expect(mockToastError).not.toHaveBeenCalled();
  expect(window.open).not.toHaveBeenCalled();
  expect(mockDownload).not.toHaveBeenCalled();
});
