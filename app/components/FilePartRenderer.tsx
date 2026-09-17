import Image from "next/image";
import React, {
  useState,
  memo,
  useMemo,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { useConvex, useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import { ImageViewer } from "./ImageViewer";
import { getGenerationLayout } from "./GeneratingImagePlaceholder";
import { AlertCircle, File, Download } from "lucide-react";
import { FilePart, FilePartRendererProps } from "@/types/file";
import { toast } from "sonner";
import { useFileUrlCacheContext } from "../contexts/FileUrlCacheContext";
import { downloadFromUrl } from "@/lib/utils/file-download";

const FilePartRendererComponent = ({
  part,
  partIndex,
  messageId,
  totalFileParts = 1,
  large = false,
}: FilePartRendererProps) => {
  const convex = useConvex();
  const getFileUrlAction = useAction(api.s3Actions.getFileUrlAction);
  const fileUrlCache = useFileUrlCacheContext();
  // Use ref to access cache without adding to useEffect dependencies
  // This prevents re-renders from triggering URL refetches
  const fileUrlCacheRef = useRef(fileUrlCache);
  fileUrlCacheRef.current = fileUrlCache;

  const [selectedImage, setSelectedImage] = useState<{
    receiptIdentity: string;
    alt: string;
  } | null>(null);
  const activeDownloadsRef = useRef(new Set<string>());
  const [downloadingReceipts, setDownloadingReceipts] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const receiptIdentity = JSON.stringify([
    part.fileId,
    part.storageId,
    part.url,
    part.s3Key,
    part.storage,
    part.mediaType,
  ]);
  // The render guard below hides an obsolete selection immediately. Clear it
  // as well so returning to that receipt never reopens a dismissed viewer.
  useEffect(() => {
    setSelectedImage((previous) =>
      previous && previous.receiptIdentity !== receiptIdentity
        ? null
        : previous,
    );
  }, [receiptIdentity]);
  const currentReceiptRef = useRef(receiptIdentity);
  currentReceiptRef.current = receiptIdentity;
  const downloadingFile = downloadingReceipts.has(receiptIdentity);
  // Tag resolved state with the receipt that produced it. A changed receipt
  // must not paint the old image while its URL effect is still pending.
  const [urlState, setUrlState] = useState(() => ({
    receiptIdentity,
    url:
      (part.fileId && fileUrlCache?.getCachedUrl(part.fileId)) ||
      part.url ||
      null,
  }));
  const fileUrl =
    urlState.receiptIdentity === receiptIdentity
      ? urlState.url
      : part.url || null;
  const setFileUrl = useCallback(
    (url: string | null) => {
      setUrlState((previous) =>
        previous.receiptIdentity === receiptIdentity && previous.url === url
          ? previous
          : { receiptIdentity, url },
      );
    },
    [receiptIdentity],
  );
  const fileUrlRef = useRef(fileUrl);
  fileUrlRef.current = fileUrl;
  const [errorState, setErrorState] = useState<{
    receiptIdentity: string;
    error: string | null;
  }>({ receiptIdentity, error: null });
  const urlError =
    errorState.receiptIdentity === receiptIdentity ? errorState.error : null;
  const setUrlError = useCallback(
    (error: string | null) => {
      setErrorState((previous) =>
        previous.receiptIdentity === receiptIdentity && previous.error === error
          ? previous
          : { receiptIdentity, error },
      );
    },
    [receiptIdentity],
  );

  const lastFetchedRef = useRef<{
    receiptIdentity: string;
    completed: boolean;
    bypassCache: boolean;
  } | null>(null);

  // Fetch URLs for inline visual media. Other files stay lazy until download.
  useEffect(() => {
    const isInlineMedia =
      part.mediaType?.startsWith("image/") ||
      part.mediaType?.startsWith("video/");
    if (!isInlineMedia) {
      return;
    }

    // Check if we already fetched for these same identifiers
    const previous = lastFetchedRef.current;
    const sameIdentifiers =
      previous !== null && previous.receiptIdentity === receiptIdentity;

    // If identifiers haven't changed and we have a URL, skip refetch
    if (sameIdentifiers && previous.completed && fileUrl) {
      return;
    }

    // A corrected receipt invalidates an older cache hit, but the durable ID
    // still resolves through the authorized action. Its new URL is only the
    // visible fallback while that refresh is pending or transiently fails.
    const bypassCache = sameIdentifiers
      ? previous.bypassCache
      : previous !== null;
    const request = {
      receiptIdentity,
      completed: false,
      bypassCache,
    };
    lastFetchedRef.current = request;
    let active = true;
    if (previous && !sameIdentifiers) {
      setFileUrl(part.url || null);
      setUrlError(null);
    }

    async function fetchUrl() {
      const cache = fileUrlCacheRef.current;

      // If we have fileId (for S3 files), check cache first
      if (part.fileId) {
        if (cache && !bypassCache) {
          const cachedUrl = cache.getCachedUrl(part.fileId);
          if (cachedUrl) {
            setFileUrl(cachedUrl);
            return;
          }
        }

        // Not in cache, fetch URL for image
        // Don't reset to null - keep showing previous image while fetching
        setUrlError(null);
        try {
          const url = await getFileUrlAction({ fileId: part.fileId });
          if (!active) return;
          setFileUrl(url);
          // Cache the fetched URL
          if (cache) {
            cache.setCachedUrl(part.fileId, url);
          }
        } catch (error) {
          if (!active) return;
          console.error("Failed to fetch file URL:", error);
          const errorMessage =
            error instanceof ConvexError
              ? (error.data as { message?: string })?.message ||
                error.message ||
                "Failed to load file"
              : error instanceof Error
                ? error.message
                : "Failed to load file";
          // A transient refresh failure must not replace media that is already
          // visible from a still-valid streamed/storage URL.
          if (!fileUrlRef.current && !part.url) {
            setUrlError(errorMessage);
            toast.error(errorMessage);
          }
        }
        return;
      }

      // Fallback: if no fileId but we have part.url (Convex storage), use it
      if (part.url) {
        setFileUrl(part.url);
        return;
      }

      // If we have storageId (for Convex files), fetch URL on-demand for images
      if (part.storageId) {
        setUrlError(null);
        try {
          const url = await convex.query(api.fileStorage.getFileDownloadUrl, {
            storageId: part.storageId,
          });
          if (!active) return;
          if (url) {
            setFileUrl(url);
          } else {
            setUrlError("Failed to get download URL");
          }
        } catch (error) {
          if (!active) return;
          console.error("Failed to fetch download URL:", error);
          const errorMessage =
            error instanceof ConvexError
              ? (error.data as { message?: string })?.message ||
                error.message ||
                "Failed to load file"
              : error instanceof Error
                ? error.message
                : "Failed to load file";
          if (!fileUrlRef.current && !part.url) {
            setUrlError(errorMessage);
            toast.error(errorMessage);
          }
        }
        return;
      }
    }

    void fetchUrl().finally(() => {
      if (active) request.completed = true;
    });
    return () => {
      active = false;
    };
    // Note: fileUrl is intentionally not in deps - we check it inside the effect
    // fileUrlCacheRef is a ref, so it doesn't need to be in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    part.url,
    part.fileId,
    part.storageId,
    part.mediaType,
    part.aspectRatio,
    receiptIdentity,
    getFileUrlAction,
    convex,
  ]);

  const handleFreshDownload = useCallback(
    async (fileName: string) => {
      // Lock before any await, including batched double clicks. Another receipt
      // may start its own download without the older one clearing its status.
      if (activeDownloadsRef.current.has(receiptIdentity)) return;
      activeDownloadsRef.current.add(receiptIdentity);
      setDownloadingReceipts((previous) =>
        new Set(previous).add(receiptIdentity),
      );
      const cache = fileUrlCacheRef.current;
      const isCurrentReceipt = () =>
        mountedRef.current && currentReceiptRef.current === receiptIdentity;
      let startedDownload = false;
      try {
        let resolvedUrl = fileUrl || part.url || null;
        // Durable identifiers must pass their current authorization check. A
        // denied/failed resolution must never fall back to an older signed URL.
        if (part.fileId) {
          resolvedUrl = await getFileUrlAction({ fileId: part.fileId });
        } else if (part.storageId) {
          resolvedUrl = await convex.query(api.fileStorage.getFileDownloadUrl, {
            storageId: part.storageId,
          });
        }
        if (!resolvedUrl) throw new Error("File URL is unavailable");
        if (isCurrentReceipt()) {
          setFileUrl(resolvedUrl);
          if (part.fileId) cache?.setCachedUrl(part.fileId, resolvedUrl);
        }
        // The user's explicit download remains valid after navigating away;
        // only the obsolete renderer's state/cache/notifications are suppressed.
        startedDownload = true;
        await downloadFromUrl({ url: resolvedUrl, filename: fileName });
      } catch (error) {
        console.error("Failed to download file:", error);
        if (isCurrentReceipt()) {
          toast.error(
            startedDownload
              ? "Failed to download file"
              : "Failed to prepare download",
          );
        }
      } finally {
        activeDownloadsRef.current.delete(receiptIdentity);
        if (mountedRef.current) {
          setDownloadingReceipts((previous) => {
            if (!previous.has(receiptIdentity)) return previous;
            const next = new Set(previous);
            next.delete(receiptIdentity);
            return next;
          });
        }
      }
    },
    [
      convex,
      fileUrl,
      getFileUrlAction,
      part.fileId,
      part.storageId,
      part.url,
      receiptIdentity,
      setFileUrl,
    ],
  );

  const handleNonImageFileClick = useCallback(
    async (fileName: string) => {
      setUrlError(null);
      await handleFreshDownload(fileName);
    },
    [handleFreshDownload, setUrlError],
  );

  // Memoize file preview component to prevent unnecessary re-renders
  const FilePreviewCard = useMemo(() => {
    const PreviewCard = ({
      partId,
      icon,
      fileName,
      subtitle,
      url,
      storageId,
      fileId,
    }: {
      partId: string;
      icon: React.ReactNode;
      fileName: string;
      subtitle: string;
      url?: string;
      storageId?: string;
      fileId?: string;
    }) => {
      const content = (
        <div className="flex flex-row items-center gap-2">
          <div className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-white/[0.04] text-muted-foreground">
            {icon}
          </div>
          <div className="overflow-hidden flex-1">
            <div className="truncate text-left text-[12.5px] font-medium text-foreground">
              {fileName}
            </div>
            <div className="truncate text-left text-[11px] text-muted-foreground">
              {subtitle}
            </div>
          </div>
          {(url || storageId || fileId) && (
            <div className="flex size-6 items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              <Download className="size-3.5 text-muted-foreground" />
            </div>
          )}
        </div>
      );

      if (url || storageId || fileId) {
        return (
          <button
            key={partId}
            onClick={() => handleNonImageFileClick(fileName)}
            disabled={downloadingFile}
            className="group w-full min-w-64 max-w-80 cursor-pointer rounded-md border border-border bg-card p-2 transition-colors hover:bg-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            aria-label={`Download ${fileName}`}
          >
            {content}
          </button>
        );
      }

      return (
        <div
          key={partId}
          className="w-full min-w-64 max-w-80 rounded-md border border-border bg-card p-2"
        >
          {content}
        </div>
      );
    };
    PreviewCard.displayName = "FilePreviewCard";
    return PreviewCard;
  }, [handleNonImageFileClick, downloadingFile]);

  // Render within the stable parent. Declaring a component type on every
  // render remounts media when a URL resolves and disconnects the viewer opener.
  const renderConvexFilePart = ({
    part,
    partId,
  }: {
    part: FilePart;
    partId: string;
  }) => {
    // Show error state if URL fetch failed
    if (urlError) {
      return (
        <FilePreviewCard
          partId={partId}
          icon={<AlertCircle className="h-6 w-6 text-red-500" />}
          fileName={part.name || part.filename || "Unknown file"}
          subtitle={urlError}
          url={undefined}
          storageId={undefined}
          fileId={undefined}
        />
      );
    }

    // Use the fetched URL or the URL from props
    const actualUrl = fileUrl || part.url;

    if (part.storage === "local-desktop") {
      return (
        <FilePreviewCard
          partId={partId}
          icon={<File className="h-6 w-6 text-muted-foreground" />}
          fileName={part.name || part.filename || "Local file"}
          subtitle="Local-only attachment"
          url={undefined}
          storageId={undefined}
          fileId={undefined}
        />
      );
    }

    if (!actualUrl && !part.storageId && !part.fileId) {
      // Error state for files without URLs or storage references
      return (
        <FilePreviewCard
          partId={partId}
          icon={<AlertCircle className="h-6 w-6 text-red-500" />}
          fileName={part.name || part.filename || "Unknown file"}
          subtitle="File not available"
          url={undefined}
          storageId={undefined}
          fileId={undefined}
        />
      );
    }

    // Handle image files - they should always have URL
    if (part.mediaType?.startsWith("image/")) {
      if (!actualUrl) {
        return (
          <FilePreviewCard
            partId={partId}
            icon={<AlertCircle className="h-6 w-6 text-red-500" />}
            fileName={part.name || part.filename || "Unknown image"}
            subtitle="Image URL not available"
            url={undefined}
            storageId={undefined}
            fileId={undefined}
          />
        );
      }

      const altText = part.name || `Uploaded image ${partIndex + 1}`;
      const isMultipleImages = totalFileParts > 1;

      // Reserve exactly the same canvas as generation. The decoded image
      // fits inside it; natural dimensions must never resize the transcript.
      const frameClass = isMultipleImages
        ? "relative h-10 w-[60px] shrink-0 overflow-hidden rounded-md bg-muted/25"
        : large
          ? `relative my-1 min-h-[300px] w-full overflow-hidden rounded-xl bg-muted/25 ring-1 ring-inset ring-border/70 ${getGenerationLayout("image", part.aspectRatio)}`
          : "relative aspect-square w-64 max-w-full overflow-hidden rounded-md border border-border bg-muted/25";
      return (
        <div key={partId} data-ui="inline-image-frame" className={frameClass}>
          <button
            onClick={(event) => {
              // Let the viewer restore this opener after a WebKit mouse click.
              event.currentTarget.focus({ preventScroll: true });
              setSelectedImage({ receiptIdentity, alt: altText });
            }}
            className="absolute inset-0 block h-full w-full cursor-zoom-in overflow-hidden rounded-[inherit] focus-visible:outline-none"
            aria-label={`View ${altText} in full size`}
            type="button"
          >
            <Image
              src={actualUrl}
              alt={altText}
              fill
              sizes={
                isMultipleImages
                  ? "60px"
                  : large
                    ? "(max-width: 768px) 100vw, 640px"
                    : "256px"
              }
              className={
                isMultipleImages
                  ? "object-cover object-center"
                  : "object-contain object-center"
              }
            />
          </button>
        </div>
      );
    }

    if (part.mediaType?.startsWith("video/")) {
      if (!actualUrl) {
        return (
          <FilePreviewCard
            partId={partId}
            icon={<AlertCircle className="h-6 w-6 text-red-500" />}
            fileName={part.name || part.filename || "Generated video"}
            subtitle="Video URL not available"
            url={undefined}
            storageId={undefined}
            fileId={undefined}
          />
        );
      }

      return (
        <figure
          key={partId}
          className={`${large ? "max-w-2xl" : "max-w-lg"} w-full overflow-hidden rounded-xl bg-[#101010] ring-1 ring-inset ring-white/[0.09]`}
        >
          <video
            src={actualUrl}
            controls
            playsInline
            preload="metadata"
            className="aspect-video w-full bg-black object-contain"
            aria-label={part.name || part.filename || "Generated video"}
          />
          <figcaption className="flex min-h-11 items-center justify-between gap-3 border-t border-white/[0.08] bg-[#181818] px-3 text-[11px]">
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full bg-emerald-400/80"
              />
              <span className="shrink-0 font-medium text-neutral-200">
                Saved
              </span>
              <span className="truncate text-neutral-500">
                {part.name || part.filename || "Generated video"}
              </span>
            </span>
            <button
              type="button"
              onClick={() =>
                handleFreshDownload(
                  part.name || part.filename || "rift-video.mp4",
                )
              }
              aria-busy={downloadingFile}
              disabled={downloadingFile}
              className="inline-flex min-h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-white/[0.09] bg-white/[0.04] px-2 text-neutral-300 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none disabled:cursor-wait disabled:opacity-60"
            >
              <Download className="size-3.5" aria-hidden="true" />
              {downloadingFile ? "Preparing…" : "Download"}
            </button>
          </figcaption>
        </figure>
      );
    }

    // Handle all non-image files with the new UI (use storageId or fileId if no URL)
    return (
      <FilePreviewCard
        partId={partId}
        icon={<File className="h-6 w-6 text-muted-foreground" />}
        fileName={part.name || part.filename || "Document"}
        subtitle="Document"
        url={actualUrl}
        storageId={part.storageId}
        fileId={part.fileId}
      />
    );
  };

  // Memoize the rendered file part to prevent re-renders
  const renderedFilePart = useMemo(() => {
    const partId = `${messageId}-file-${partIndex}`;

    // Check if this is a file part with either URL, storageId, or fileId
    if (
      part.url ||
      part.storageId ||
      part.fileId ||
      part.storage === "local-desktop" ||
      fileUrl
    ) {
      return renderConvexFilePart({ part, partId });
    }

    // Fallback for unsupported file types
    return (
      <FilePreviewCard
        partId={partId}
        icon={<File className="h-6 w-6 text-muted-foreground" />}
        fileName={part.name || part.filename || "Unknown file"}
        subtitle="Document"
        url={part.url}
        storageId={part.storageId}
        fileId={part.fileId}
      />
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    messageId,
    partIndex,
    part.url,
    part.storageId,
    part.fileId,
    part.storage,
    part.name,
    part.filename,
    part.mediaType,
    part.aspectRatio,
    fileUrl,
    urlError,
    FilePreviewCard,
    handleFreshDownload,
    large,
    totalFileParts,
  ]);

  return (
    <>
      {renderedFilePart}
      {/* Image Viewer Modal - rendered via portal to escape contentVisibility containment */}
      {selectedImage?.receiptIdentity === receiptIdentity &&
        part.mediaType?.startsWith("image/") &&
        (fileUrl || part.url) &&
        typeof document !== "undefined" &&
        createPortal(
          <ImageViewer
            isOpen={!!selectedImage}
            onClose={() => setSelectedImage(null)}
            imageSrc={fileUrl || part.url!}
            imageAlt={part.name || selectedImage.alt}
            fileName={part.name || part.filename || selectedImage.alt}
            onDownload={handleFreshDownload}
          />,
          document.body,
        )}
    </>
  );
};

// Memoize the entire component to prevent unnecessary re-renders during streaming
export const FilePartRenderer = memo(
  FilePartRendererComponent,
  (prevProps, nextProps) => {
    // Custom comparison to prevent re-renders when props haven't meaningfully changed
    return (
      prevProps.messageId === nextProps.messageId &&
      prevProps.partIndex === nextProps.partIndex &&
      prevProps.totalFileParts === nextProps.totalFileParts &&
      prevProps.large === nextProps.large &&
      prevProps.part.url === nextProps.part.url &&
      prevProps.part.aspectRatio === nextProps.part.aspectRatio &&
      prevProps.part.storageId === nextProps.part.storageId &&
      prevProps.part.storage === nextProps.part.storage &&
      prevProps.part.localAttachmentId === nextProps.part.localAttachmentId &&
      prevProps.part.fileId === nextProps.part.fileId &&
      prevProps.part.s3Key === nextProps.part.s3Key &&
      prevProps.part.name === nextProps.part.name &&
      prevProps.part.filename === nextProps.part.filename &&
      prevProps.part.mediaType === nextProps.part.mediaType
    );
  },
);
