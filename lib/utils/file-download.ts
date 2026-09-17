import { toast } from "sonner";
import {
  isTauriEnvironment,
  revealFileInDir,
  saveFileToLocal,
} from "@/app/hooks/useTauri";

/**
 * Options for file download/save operations.
 */
interface DownloadFileOptions {
  /** The suggested filename for the save dialog */
  filename: string;
  /** The file content as a string */
  content: string;
  /** MIME type for the blob fallback (default: "text/plain") */
  mimeType?: string;
}

/**
 * Unified file download handler that works across Tauri desktop and web browsers.
 *
 * Strategy:
 * 1. Tauri: save via command server (anchor downloads don't work in WebView)
 * 2. File System Access API: native save dialog (Chrome/Edge)
 * 3. Blob download: traditional anchor element fallback
 */
export async function downloadFile({
  filename,
  content,
  mimeType = "text/plain",
}: DownloadFileOptions): Promise<void> {
  // Tauri: save via command server
  if (isTauriEnvironment()) {
    const filePath = await saveFileToLocal(filename, content);
    if (filePath) {
      toast.success(`Saved ${filename}`, {
        action: {
          label: "Show in Finder",
          onClick: () => revealFileInDir(filePath),
        },
      });
    } else {
      toast.error("Failed to save file");
    }
    return;
  }

  // File System Access API (native save dialog)
  try {
    if ("showSaveFilePicker" in window) {
      const fileHandle = await (
        window as Window & {
          showSaveFilePicker: (options: {
            suggestedName: string;
          }) => Promise<FileSystemFileHandle>;
        }
      ).showSaveFilePicker({
        suggestedName: filename,
      });

      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      toast.success("File saved successfully");
      return;
    }
  } catch (err) {
    // User cancelled the save dialog — not an error
    if (err instanceof DOMException && err.name === "AbortError") {
      return;
    }
    toast.error("Failed to save file");
    return;
  }

  // Blob download fallback
  let url: string | undefined;
  let anchor: HTMLAnchorElement | undefined;
  try {
    const blob = new Blob([content], { type: mimeType });
    url = URL.createObjectURL(blob);
    anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    toast.success("Download started");
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }
    toast.error("Failed to download file", {
      description:
        error instanceof Error ? error.message : "Unknown error occurred",
    });
  } finally {
    anchor?.remove();
    // As with media downloads, WebKit may consume this URL after click returns.
    // Keep a bounded lifetime instead of revoking it during the same event.
    if (url) {
      const downloadUrl = url;
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 30_000);
    }
  }
}

const MEDIA_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "application/pdf": "pdf",
  "application/zip": "zip",
};

/** One binary download path for generated media, attachments and ZIP exports. */
export async function downloadBlob({
  filename,
  blob,
  signal,
}: {
  filename: string;
  blob: Blob;
  signal?: AbortSignal;
}): Promise<void> {
  signal?.throwIfAborted();
  if (!blob.size) throw new Error("Downloaded file is empty");
  const safeName =
    filename.replace(/[\\/\u0000-\u001f]/g, "-").trim() || "download";
  const extension = MEDIA_EXTENSIONS[blob.type.split(";")[0]];
  const name =
    extension && !/\.[a-z0-9]{1,8}$/i.test(safeName)
      ? `${safeName}.${extension}`
      : safeName;
  if (isTauriEnvironment()) {
    if (blob.size > 64 * 1024 * 1024)
      throw new Error("This file exceeds the 64 MiB desktop download limit.");
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
      reader.onerror = () =>
        reject(new Error("Could not read the download data"));
      reader.readAsDataURL(blob);
    });
    signal?.throwIfAborted();
    const path = await saveFileToLocal(name, content, "base64");
    if (!path)
      throw new Error(
        "Could not save the file to Downloads. Check desktop access and available disk space.",
      );
    toast.success(`Saved ${name}`, {
      action: { label: "Show in Finder", onClick: () => revealFileInDir(path) },
    });
    return;
  }
  signal?.throwIfAborted();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    // WebKit may consume the URL after the event handler has returned.
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

export async function downloadFromUrl({
  url,
  filename,
  signal,
}: {
  url: string;
  filename: string;
  signal?: AbortSignal;
}): Promise<void> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  await downloadBlob({ filename, blob: await response.blob(), signal });
}
