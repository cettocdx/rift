import Image from "next/image";
import { downloadFromUrl } from "@/lib/utils/file-download";
import { toast } from "sonner";
import { Download, X, ZoomIn, ZoomOut } from "lucide-react";
import { useState, useEffect, useRef } from "react";

interface ImageViewerProps {
  isOpen: boolean;
  onClose: () => void;
  imageSrc: string;
  imageAlt: string;
  fileName?: string;
  /** Resolve durable media at click time; URL-only callers keep direct downloads. */
  onDownload?: (fileName: string) => Promise<void>;
}

export const ImageViewer = ({
  isOpen,
  onClose,
  imageSrc,
  imageAlt,
  fileName,
  onDownload,
}: ImageViewerProps) => {
  const [isImageLoading, setIsImageLoading] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [downloading, setDownloading] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const imageFrameRef = useRef<HTMLDivElement>(null);
  const didDragRef = useRef(false);
  const dragStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const visible = Boolean(isOpen && imageSrc && imageSrc.trim() !== "");

  // Reset loading state when imageSrc changes
  useEffect(() => {
    setIsImageLoading(true);
    setZoom(100);
    setPan({ x: 0, y: 0 });
  }, [imageSrc]);

  // The modal owns its controls as well as the canvas. Return keyboard focus
  // to the opener after the viewer is dismissed or unmounted.
  useEffect(() => {
    if (!visible || !dialogRef.current) return;
    const previousFocus = document.activeElement;
    dialogRef.current.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, [visible]);

  // Handle Escape key press
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [visible, onClose]);

  // Don't render if not open or no valid image source
  if (!visible) {
    return null;
  }

  const handleImageLoad = () => {
    setIsImageLoading(false);
  };

  const handleImageError = () => {
    setIsImageLoading(false);
  };

  const handleClose = () => {
    onClose();
  };

  const setZoomAtPoint = (
    nextZoom: number,
    point?: { x: number; y: number },
  ) => {
    setZoom((currentZoom) => {
      const clampedZoom = Math.min(300, Math.max(25, nextZoom));

      if (!point || clampedZoom <= 100) {
        setPan({ x: 0, y: 0 });
        return clampedZoom;
      }

      const oldScale = currentZoom / 100;
      const newScale = clampedZoom / 100;
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;

      setPan((currentPan) => ({
        x:
          point.x -
          centerX -
          (newScale / oldScale) * (point.x - centerX - currentPan.x),
        y:
          point.y -
          centerY -
          (newScale / oldScale) * (point.y - centerY - currentPan.y),
      }));

      return clampedZoom;
    });
  };

  const handleDownload = async () => {
    const downloadName =
      fileName ||
      imageAlt
        .trim()
        .replace(/[^\w.\- ]+/g, "")
        .replace(/\s+/g, "-")
        .slice(0, 80) ||
      "image";

    if (downloading) return;
    setDownloading(true);
    try {
      if (onDownload) {
        await onDownload(downloadName);
      } else {
        await downloadFromUrl({ url: imageSrc, filename: downloadName });
      }
    } catch (error) {
      toast.error("Could not download image", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setDownloading(false);
    }
  };

  const handleZoomOut = () => {
    setZoomAtPoint(zoom - 25);
  };

  const handleZoomIn = () => {
    setZoomAtPoint(zoom + 25, {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const direction = e.deltaY > 0 ? -25 : 25;
    setZoomAtPoint(zoom + direction, { x: e.clientX, y: e.clientY });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (zoom <= 100 || e.button !== 0) return;

    dragStartRef.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const dragStart = dragStartRef.current;
    if (!dragStart) return;

    if (
      Math.abs(e.clientX - dragStart.x) > 3 ||
      Math.abs(e.clientY - dragStart.y) > 3
    ) {
      didDragRef.current = true;
    }

    setPan({
      x: dragStart.panX + e.clientX - dragStart.x,
      y: dragStart.panY + e.clientY - dragStart.y,
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current?.pointerId === e.pointerId) {
      dragStartRef.current = null;
      setIsDragging(false);
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }

    if (e.target === e.currentTarget) {
      const imageBounds = imageFrameRef.current?.getBoundingClientRect();
      if (
        imageBounds &&
        e.clientX >= imageBounds.left &&
        e.clientX <= imageBounds.right &&
        e.clientY >= imageBounds.top &&
        e.clientY <= imageBounds.bottom
      ) {
        return;
      }

      handleClose();
    }
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    setZoomAtPoint(zoom >= 200 ? 100 : 200, {
      x: e.clientX,
      y: e.clientY,
    });
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  const handleDialogKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || e.defaultPrevented) return;
    const dialog = e.currentTarget;
    const controls = dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first || !last) {
      e.preventDefault();
      dialog.focus();
    } else if (
      e.shiftKey &&
      (document.activeElement === first || document.activeElement === dialog)
    ) {
      e.preventDefault();
      last.focus();
    } else if (
      !e.shiftKey &&
      (document.activeElement === last || document.activeElement === dialog)
    ) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="image-viewer-title"
      aria-describedby="image-viewer-description"
      data-state="open"
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[#0b0b0b]/95 focus:outline-hidden"
      style={{ pointerEvents: "auto" }}
      onClick={handleBackdropClick}
      onKeyDown={handleDialogKeyDown}
      tabIndex={-1}
      data-testid="image-zoom-modal"
    >
      <div className="absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-md border border-white/[0.12] bg-[#181818] p-1 text-[#f0f0f0] shadow-lg">
        <button
          type="button"
          className="flex size-7 cursor-pointer items-center justify-center rounded-md text-[#f0f0f0]/70 transition-colors hover:bg-white/[0.08] hover:text-[#f0f0f0] focus-visible:outline-none"
          onClick={handleDownload}
          disabled={downloading}
          aria-label="Download image"
        >
          <Download className="size-3.5" aria-hidden="true" />
        </button>
        <div className="h-4 w-px bg-white/[0.12]" />
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded-md text-[#f0f0f0]/70 transition-colors hover:bg-white/[0.08] hover:text-[#f0f0f0] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            onClick={handleZoomOut}
            disabled={zoom <= 25}
            aria-label="Zoom out"
          >
            <ZoomOut className="size-3.5" aria-hidden="true" />
          </button>
          <span className="min-w-9 text-center text-[11px] tabular-nums text-[#f0f0f0]/70">
            {zoom}%
          </span>
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded-md text-[#f0f0f0]/70 transition-colors hover:bg-white/[0.08] hover:text-[#f0f0f0] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            onClick={handleZoomIn}
            disabled={zoom >= 300}
            aria-label="Zoom in"
          >
            <ZoomIn className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Close Button */}
      <button
        className="absolute end-3 top-3 z-10 flex size-7 items-center justify-center rounded-md border border-white/[0.12] bg-[#181818] text-[#f0f0f0]/70 transition-colors hover:bg-white/[0.08] hover:text-[#f0f0f0] focus-visible:outline-none"
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleClose();
        }}
        aria-label="Close image viewer"
        tabIndex={0}
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>

      {/* Image Container */}
      <div
        data-state="open"
        className={`relative flex h-full w-full items-center justify-center overflow-hidden ${
          zoom > 100
            ? isDragging
              ? "cursor-grabbing"
              : "cursor-grab"
            : "cursor-zoom-in"
        }`}
        style={{ pointerEvents: "auto" }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleCanvasClick}
        onDoubleClick={handleDoubleClick}
      >
        {/* Screen reader title */}
        <div id="image-viewer-title" className="sr-only">
          Image Viewer
        </div>
        <div id="image-viewer-description" className="sr-only">
          {imageAlt}
        </div>

        <div
          ref={imageFrameRef}
          className="relative select-none transition-transform duration-100"
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom / 100})`,
          }}
        >
          {/* Loading Indicator */}
          {isImageLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-6 w-6 border-2 border-white border-t-transparent" />
                <span className="text-sm text-white">Loading...</span>
              </div>
            </div>
          )}

          <Image
            draggable={false}
            className={`object-contain transition-opacity duration-300 ${
              isImageLoading ? "opacity-0" : "opacity-100"
            }`}
            src={imageSrc}
            alt={imageAlt}
            width={1200}
            height={800}
            style={{
              maxHeight: "85vh",
              maxWidth: "90vw",
              height: "auto",
              width: "auto",
            }}
            sizes="(max-width: 768px) 90vw, 85vw"
            onLoad={handleImageLoad}
            onError={handleImageError}
          />
        </div>
      </div>
    </div>
  );
};
