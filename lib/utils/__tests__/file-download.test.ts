import { downloadBlob, downloadFile, downloadFromUrl } from "../file-download";
import { isTauriEnvironment, saveFileToLocal } from "@/app/hooks/useTauri";
import { toast } from "sonner";
jest.mock("@/app/hooks/useTauri", () => ({
  isTauriEnvironment: jest.fn(),
  saveFileToLocal: jest.fn(),
  revealFileInDir: jest.fn(),
}));
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));
const native = jest.mocked(isTauriEnvironment);
const save = jest.mocked(saveFileToLocal);
beforeEach(() => {
  jest.clearAllMocks();
  native.mockReturnValue(true);
  save.mockResolvedValue("/Downloads/image.png");
});
it("saves original binary bytes through native IPC with a MIME extension", async () => {
  await downloadBlob({
    filename: "image",
    blob: new Blob([new Uint8Array([0, 255, 128, 10])], { type: "image/png" }),
  });
  expect(save).toHaveBeenCalledWith("image.png", "AP+ACg==", "base64");
  expect(toast.success).toHaveBeenCalled();
});
it("does not announce success when the native write fails", async () => {
  save.mockResolvedValue(null);
  await expect(
    downloadBlob({ filename: "image.png", blob: new Blob(["image"]) }),
  ).rejects.toThrow(/save/i);
  expect(toast.success).not.toHaveBeenCalled();
});
it("does not save error response bodies as image files", async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 });
  await expect(
    downloadFromUrl({
      url: "https://media.example/image.png",
      filename: "image.png",
    }),
  ).rejects.toThrow(/403/);
  expect(save).not.toHaveBeenCalled();
});
it("does not save empty files or an aborted download", async () => {
  await expect(
    downloadBlob({ filename: "empty", blob: new Blob([]) }),
  ).rejects.toThrow(/empty/);
  const controller = new AbortController();
  controller.abort();
  await expect(
    downloadBlob({
      filename: "image.png",
      blob: new Blob(["x"]),
      signal: controller.signal,
    }),
  ).rejects.toThrow();
  expect(save).not.toHaveBeenCalled();
});
it("writes exact text through the browser picker and closes before reporting success", async () => {
  native.mockReturnValue(false);
  const write = jest.fn().mockResolvedValue(undefined);
  const close = jest.fn().mockResolvedValue(undefined);
  const picker = jest.fn().mockResolvedValue({
    createWritable: async () => ({ write, close }),
  });
  Object.defineProperty(window, "showSaveFilePicker", {
    configurable: true,
    value: picker,
  });
  try {
    const content = "    return 'Türkçe'\n\n";
    await downloadFile({ filename: "snippet.py", content });
    expect(picker).toHaveBeenCalledWith({ suggestedName: "snippet.py" });
    expect(write).toHaveBeenCalledWith(content);
    expect(close).toHaveBeenCalledTimes(1);
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(toast.success).mock.invocationCallOrder[0],
    );
  } finally {
    Reflect.deleteProperty(window, "showSaveFilePicker");
  }
});
it.each(["binary", "text"])(
  "keeps %s browser download URLs alive until the click can be consumed",
  async (kind) => {
    jest.useFakeTimers();
    native.mockReturnValue(false);
    URL.createObjectURL = jest.fn().mockReturnValue("blob:download");
    URL.revokeObjectURL = jest.fn();
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    if (kind === "binary")
      await downloadBlob({ filename: "image.png", blob: new Blob(["x"]) });
    else
      await downloadFile({ filename: "terminal.txt", content: "  output\n" });
    expect(click).toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    jest.runOnlyPendingTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:download");
    click.mockRestore();
    jest.useRealTimers();
  },
);
