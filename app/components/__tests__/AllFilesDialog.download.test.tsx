import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import JSZip from "jszip";
import { toast } from "sonner";
import { downloadBlob } from "@/lib/utils/file-download";
import { AllFilesDialog } from "../AllFilesDialog";

const mockGetFileUrl = jest.fn();
const mockConvex = { query: jest.fn() };
jest.mock("convex/react", () => ({
  useConvex: () => mockConvex,
  useAction: () => mockGetFileUrl,
}));
jest.mock("@/app/contexts/FileUrlCacheContext", () => ({
  useFileUrlCacheContext: () => null,
}));
jest.mock("@/lib/utils/file-download", () => ({
  downloadBlob: jest.fn(),
  downloadFromUrl: jest.fn(),
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));

const originalFetch = global.fetch;
const files = [
  {
    part: { name: "first.txt", url: "https://files.example/first" },
    partIndex: 0,
    messageId: "m",
  },
  {
    part: { name: "second.txt", url: "https://files.example/second" },
    partIndex: 1,
    messageId: "m",
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  global.fetch = jest.fn().mockImplementation(async (url: string) => ({
    ok: true,
    status: 200,
    blob: async () =>
      new Blob([url.endsWith("first") ? "first bytes" : "second bytes"]),
  }));
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  global.fetch = originalFetch;
});

async function startBatch(selectedFiles = files) {
  render(
    <AllFilesDialog
      open
      onOpenChange={() => {}}
      files={selectedFiles}
      chatTitle="My files"
    />,
  );
  await screen.findByText("first.txt");
  fireEvent.click(screen.getByRole("button", { name: "Download files" }));
  fireEvent.click(screen.getByRole("button", { name: "Batch download (2)" }));
}

it.each(["http", "network", "missing-url"])(
  "keeps the selection and saves no incomplete ZIP after a %s failure",
  async (failure) => {
    if (failure === "http") {
      jest.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 403,
        blob: async () => new Blob(["Access denied"]),
      } as Response);
    } else if (failure === "network") {
      jest
        .mocked(fetch)
        .mockRejectedValueOnce(new Error("Network request failed"));
    }
    const selectedFiles =
      failure === "missing-url"
        ? [files[0], { ...files[1], part: { name: "second.txt", url: "" } }]
        : files;
    await startBatch(selectedFiles);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Batch download (2)" }),
    ).toBeInTheDocument();
    expect(jest.mocked(toast.error).mock.calls[0][0]).toMatch(
      /first\.txt|second\.txt/,
    );
  },
);

it("saves both selected files with their original bytes when every fetch succeeds", async () => {
  await startBatch();
  await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
  const saved = jest.mocked(downloadBlob).mock.calls[0][0];
  expect(saved.filename).toBe("My-files.zip");
  const zip = await JSZip.loadAsync(saved.blob);
  expect(Object.keys(zip.files)).toEqual(
    expect.arrayContaining(["first.txt", "second.txt"]),
  );
  expect(await zip.file("first.txt")!.async("string")).toBe("first bytes");
  expect(await zip.file("second.txt")!.async("string")).toBe("second bytes");
  expect(toast.error).not.toHaveBeenCalled();
});
