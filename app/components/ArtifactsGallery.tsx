"use client";
import { downloadBlob } from "@/lib/utils/file-download";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Download,
  ExternalLink,
  Film,
  Images,
  Play,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CodexEmptyState,
  CodexPageHeader,
  CodexPageShell,
} from "./page-shell/CodexPageShell";

type Artifact = {
  url: string;
  mediaType: string;
  kind: "generated" | "uploaded";
  chat_id: string;
  time: number;
  /** What a generated asset was made from. Absent on uploads. */
  generation?: {
    prompt: string;
    model: string;
    cost_dollars?: number;
    run_id?: string;
  };
};

type ArtifactFilter = "all" | "generated" | "uploaded";

/**
 * The empty-state heading already reports that nothing matched, so the line
 * under it is only worth printing if it says how to put something here. Each
 * filter has a different answer, which is why this is a map and not one string.
 */
const EMPTY_DESCRIPTIONS: Record<ArtifactFilter, string> = {
  all: "Generate an image or video, or attach one in a chat. It will appear here automatically.",
  generated:
    "Ask RIFT for an image or a video in any chat and it will appear here.",
  uploaded: "Attach an image or a video to a message and it will appear here.",
};

const VIDEO_LOADING_POSTER =
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

function isVideoArtifact(artifact: Artifact): boolean {
  return artifact.mediaType.toLowerCase().startsWith("video/");
}

function artifactFileName(artifact: Artifact): string {
  const mediaType = artifact.mediaType.toLowerCase();
  const extension = mediaType.includes("webm")
    ? "webm"
    : mediaType.includes("quicktime")
      ? "mov"
      : isVideoArtifact(artifact)
        ? "mp4"
        : mediaType.includes("webp")
          ? "webp"
          : mediaType.includes("jpeg")
            ? "jpg"
            : "png";

  return `rift-${artifact.kind}-${isVideoArtifact(artifact) ? "video" : "image"}-${artifact.time}.${extension}`;
}

function ArtifactVideo({
  artifact,
  preview = false,
}: {
  artifact: Artifact;
  preview?: boolean;
}) {
  const [frameReady, setFrameReady] = useState(false);

  // Black behind the thumbnail, like the rest of the page: any tint here reads
  // as a light slab under every artifact while the frame is still decoding.
  return (
    <div className="relative size-full overflow-hidden bg-background">
      <div
        data-ui="artifact-video-poster"
        aria-hidden
        className={`absolute inset-0 flex items-center justify-center text-muted-foreground ${frameReady ? "invisible" : "visible"}`}
      >
        <span className="flex size-11 items-center justify-center rounded-full border border-border/80 bg-background/70 shadow-sm backdrop-blur-sm">
          <Film className="size-4" strokeWidth={1.6} />
        </span>
      </div>
      <video
        data-ui={preview ? "artifact-video-preview" : "artifact-video-tile"}
        src={artifact.url}
        aria-label={
          preview ? `${artifact.kind} video artifact preview` : undefined
        }
        aria-hidden={preview ? undefined : true}
        controls={preview}
        muted={!preview}
        playsInline
        preload="metadata"
        poster={frameReady ? undefined : VIDEO_LOADING_POSTER}
        onLoadedData={() => setFrameReady(true)}
        className={`size-full object-contain ${preview ? "max-h-full md:max-h-[80dvh]" : "object-cover"} ${frameReady ? "visible" : "invisible"}`}
      />
      {!preview && (
        <span className="pointer-events-none absolute bottom-2 right-2 flex size-7 items-center justify-center rounded-full border border-white/15 bg-black/65 text-white shadow-sm backdrop-blur-sm">
          <Play className="ml-px size-3" fill="currentColor" aria-hidden />
        </span>
      )}
    </div>
  );
}

/**
 * Artifacts — a gallery of every image or video the user has sent (uploaded) or
 * received (generated), gathered from their messages.
 */
export function ArtifactsGallery() {
  const artifacts = useQuery(api.artifacts.listForUser, {});
  const [active, setActive] = useState<Artifact | null>(null);
  // Scoped to the open artifact: the confirmation must not carry over to the
  // next one, where it would claim a copy that never happened.
  const [promptCopied, setPromptCopied] = useState(false);
  const [copyingPrompt, setCopyingPrompt] = useState(false);
  const [promptCopyError, setPromptCopyError] = useState(false);
  const [filter, setFilter] = useState<ArtifactFilter>("all");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const previewVersion = useRef(0);
  const downloadController = useRef<AbortController | null>(null);
  const previewOpener = useRef<HTMLButtonElement | null>(null);
  const filters = useRef<HTMLDivElement>(null);

  useEffect(
    () => () => {
      previewVersion.current += 1;
      downloadController.current?.abort();
    },
    [],
  );

  const selectArtifact = (artifact: Artifact | null) => {
    previewVersion.current += 1;
    downloadController.current?.abort();
    downloadController.current = null;
    setPromptCopied(false);
    setCopyingPrompt(false);
    setPromptCopyError(false);
    setDownloading(false);
    setDownloadError(false);
    setActive(artifact);
  };

  const copyPrompt = async (artifact: Artifact) => {
    if (!artifact.generation || copyingPrompt) return;
    const version = previewVersion.current;
    setCopyingPrompt(true);
    setPromptCopied(false);
    setPromptCopyError(false);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard is unavailable");
      }
      await navigator.clipboard.writeText(artifact.generation.prompt);
      if (version === previewVersion.current) setPromptCopied(true);
    } catch {
      if (version === previewVersion.current) setPromptCopyError(true);
    } finally {
      if (version === previewVersion.current) setCopyingPrompt(false);
    }
  };

  const loading = artifacts === undefined;
  const all = artifacts ?? [];
  const items = filter === "all" ? all : all.filter((a) => a.kind === filter);

  /**
   * Whether the grid on screen holds generated and uploaded artifacts at once.
   * A kind filter always narrows to one kind, and an unfiltered library can
   * still be all of one kind, so this is a property of the visible set rather
   * than of the selected chip.
   */
  const kindsAreMixed = new Set(items.map((a) => a.kind)).size > 1;

  const counts = {
    all: all.length,
    generated: all.filter((a) => a.kind === "generated").length,
    uploaded: all.filter((a) => a.kind === "uploaded").length,
  };

  const chips: Array<{ id: ArtifactFilter; label: string; n: number }> = [
    { id: "all", label: "All", n: counts.all },
    { id: "generated", label: "Generated", n: counts.generated },
    { id: "uploaded", label: "Uploaded", n: counts.uploaded },
  ];

  const downloadArtifact = async (artifact: Artifact) => {
    if (downloadController.current) return;
    const version = previewVersion.current;
    const controller = new AbortController();
    downloadController.current = controller;
    setDownloading(true);
    setDownloadError(false);

    try {
      const response = await fetch(artifact.url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Download failed (${response.status})`);
      const blob = await response.blob();
      if (!blob.size) throw new Error("Downloaded artifact is empty");
      if (controller.signal.aborted || version !== previewVersion.current)
        return;

      await downloadBlob({
        filename: artifactFileName(artifact),
        blob,
        signal: controller.signal,
      });
    } catch {
      if (!controller.signal.aborted && version === previewVersion.current) {
        setDownloadError(true);
      }
    } finally {
      if (version === previewVersion.current) {
        downloadController.current = null;
        setDownloading(false);
      }
    }
  };

  return (
    <CodexPageShell busy={loading}>
      <CodexPageHeader
        title="Artifacts"
        description="Images and videos shared with RIFT or generated during your sessions, collected in one workspace."
        leading={
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border/80 bg-background text-muted-foreground">
            <Images className="size-4" strokeWidth={1.7} aria-hidden />
          </span>
        }
      />

      <div
        ref={filters}
        className="mb-5 flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-md border border-border/80 bg-background p-0.5"
        role="group"
        aria-label="Artifact filters"
      >
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={filter === c.id}
            onClick={() => setFilter(c.id)}
            className={`flex min-h-11 shrink-0 touch-manipulation items-center gap-1.5 rounded-[4px] px-3 py-1.5 text-ui-nav font-medium transition-colors duration-(--duration-hover) md:px-2.5 md:pointer-fine:min-h-0 ${
              filter === c.id
                ? "bg-accent text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            }`}
          >
            {c.label}
            <span className="font-mono text-ui-caption tabular-nums text-muted-foreground">
              {c.n}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div
          className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
          role="status"
          aria-label="Loading artifacts"
        >
          <span className="sr-only">Loading artifacts…</span>
          {Array.from({ length: 10 }, (_, index) => (
            <Skeleton
              key={index}
              aria-hidden
              className="aspect-square w-full rounded-md motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <CodexEmptyState
          icon={<Images className="size-4" strokeWidth={1.7} aria-hidden />}
          title={
            filter === "all" ? "No artifacts yet" : `No ${filter} artifacts`
          }
          description={EMPTY_DESCRIPTIONS[filter]}
        />
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((a) => (
            <button
              key={`${a.chat_id}-${a.time}-${a.url}`}
              type="button"
              onClick={(event) => {
                previewOpener.current = event.currentTarget;
                selectArtifact(a);
              }}
              aria-label={`Open ${a.kind} ${isVideoArtifact(a) ? "video" : "image"} artifact`}
              className="group relative aspect-square overflow-hidden rounded-md border border-border/80 bg-background text-left transition-colors duration-(--duration-hover) hover:border-foreground/25"
            >
              {isVideoArtifact(a) ? (
                <ArtifactVideo artifact={a} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={a.url}
                  alt={`${a.kind === "generated" ? "Generated" : "Uploaded"} artifact`}
                  loading="lazy"
                  className="size-full object-cover opacity-90 transition-opacity duration-150 group-hover:opacity-100 motion-reduce:transition-none"
                />
              )}
              {/* Only a mixed grid has two kinds to tell apart; on a grid of
                  one kind the badge would stamp the same word on every tile.
                  The button's accessible name carries the kind either way. */}
              {kindsAreMixed && (
                <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-[4px] border border-white/10 bg-black/65 px-1.5 py-0.5 text-ui-caption font-medium leading-4 text-white/85 backdrop-blur-sm">
                  {a.kind === "generated" ? (
                    <Sparkles className="size-2.5" aria-hidden />
                  ) : (
                    <Upload className="size-2.5" aria-hidden />
                  )}
                  {a.kind === "generated" ? "Generated" : "Uploaded"}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {/* Lightbox */}
      <Dialog
        open={active !== null}
        onOpenChange={(o) => !o && selectArtifact(null)}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            // A live library update can remove the card while its preview is open.
            const target = previewOpener.current?.isConnected
              ? previewOpener.current
              : filters.current?.querySelector<HTMLButtonElement>(
                  '[aria-pressed="true"]',
                );
            target?.focus({ preventScroll: true });
            previewOpener.current = null;
          }}
          showCloseButton={false}
          data-ui="artifact-lightbox-dialog"
          className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 bg-background/98 p-0 shadow-none sm:max-w-none md:h-auto md:max-h-[calc(100dvh-2rem)] md:w-auto md:max-w-[80vw] md:rounded-md md:bg-transparent"
        >
          <DialogTitle className="sr-only">
            {active && isVideoArtifact(active)
              ? "Video preview"
              : "Image preview"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Preview the selected artifact at full size or open its original
            stored file. Generated media remains available from durable RIFT
            storage.
          </DialogDescription>
          {active && (
            <div
              data-ui="artifact-lightbox-layout"
              className="relative flex h-full min-h-0 w-full flex-1 flex-col items-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] md:h-auto md:p-0"
            >
              <div className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden md:flex-none">
                {isVideoArtifact(active) ? (
                  <div className="h-full min-h-0 w-full overflow-hidden rounded-md md:h-auto md:max-h-[80dvh] md:max-w-[80vw]">
                    <ArtifactVideo artifact={active} preview />
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={active.url}
                    alt={`${active.kind === "generated" ? "Generated" : "Uploaded"} artifact preview`}
                    className="max-h-full w-auto max-w-full rounded-md object-contain md:max-h-[80dvh]"
                  />
                )}
              </div>
              {/* Lineage. A generated asset used to be an anonymous image: the
                  prompt that made it, the model, the cost and the run were all
                  unrecoverable once the message scrolled away. Uploads show
                  nothing here, because there is no lineage to invent for a file
                  a person brought in themselves. */}
              {active.generation ? (
                <section
                  data-ui="artifact-lineage"
                  aria-label="How this was made"
                  className="w-full shrink-0 pt-3 md:max-w-[560px]"
                >
                  <div className="rounded-md border border-border/70 bg-background/95 px-3 py-2.5 backdrop-blur">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-ui-label text-muted-foreground">
                      <span className="text-foreground">
                        {active.generation.model}
                      </span>
                      {typeof active.generation.cost_dollars === "number" &&
                      active.generation.cost_dollars > 0 ? (
                        <span>
                          {active.generation.cost_dollars < 0.01
                            ? "<$0.01"
                            : `$${active.generation.cost_dollars.toFixed(2)}`}
                        </span>
                      ) : null}
                      {active.generation.run_id ? (
                        <Link
                          href={`/runs/${encodeURIComponent(active.generation.run_id)}`}
                          className="underline underline-offset-2 transition-colors hover:text-foreground"
                        >
                          Open source run
                        </Link>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void copyPrompt(active)}
                        disabled={copyingPrompt}
                        className="ml-auto underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:text-foreground"
                      >
                        {copyingPrompt
                          ? "Copying…"
                          : promptCopied
                            ? "Prompt copied"
                            : promptCopyError
                              ? "Retry copy"
                              : "Copy prompt"}
                      </button>
                    </div>
                    {promptCopyError ? (
                      <>
                        <p
                          role="alert"
                          className="mt-2 text-ui-label leading-5 text-destructive"
                        >
                          Couldn’t copy the prompt. Try again or select and copy
                          the text below.
                        </p>
                        <textarea
                          readOnly
                          aria-label="Prompt text"
                          value={active.generation.prompt}
                          rows={3}
                          className="mt-1.5 w-full resize-none rounded-sm bg-transparent text-ui-label leading-5 text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30"
                        />
                      </>
                    ) : (
                      <p className="mt-1.5 line-clamp-3 text-ui-label leading-5 text-muted-foreground">
                        {active.generation.prompt}
                      </p>
                    )}
                  </div>
                </section>
              ) : null}

              {downloadError ? (
                <p
                  role="alert"
                  className="mt-3 w-full rounded-md border border-border/70 bg-background/95 px-3 py-2 text-ui-label leading-5 text-destructive md:max-w-[560px]"
                >
                  Couldn’t download this file. Try again or open the original.
                </p>
              ) : null}
              <div className="flex w-full shrink-0 items-center gap-2 pt-3 md:w-auto">
                <a
                  href={active.url}
                  download={artifactFileName(active)}
                  onClick={(event) => {
                    event.preventDefault();
                    void downloadArtifact(active);
                  }}
                  aria-disabled={downloading}
                  className="flex min-h-11 flex-1 touch-manipulation items-center justify-center gap-1.5 rounded-md border border-border/80 bg-background/95 px-3 py-1.5 text-ui font-medium text-foreground backdrop-blur transition-colors duration-(--duration-hover) hover:bg-accent md:flex-none"
                >
                  <Download className="size-3.5" aria-hidden />
                  {downloading
                    ? "Preparing…"
                    : downloadError
                      ? "Retry download"
                      : "Download"}
                </a>
                <a
                  href={active.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-11 flex-1 touch-manipulation items-center justify-center gap-1.5 rounded-md border border-border/80 bg-background/95 px-3 py-1.5 text-ui font-medium text-foreground backdrop-blur transition-colors duration-(--duration-hover) hover:bg-accent md:flex-none"
                >
                  <ExternalLink className="size-3.5" aria-hidden />
                  Open original
                </a>
                {/* Dismissal is chrome, not an action on the artifact, so it
                    holds a fixed 44px square and leaves the rest of the row to
                    the two labelled actions — split into equal thirds, "Open
                    original" wraps to a second line at 375px. */}
                <button
                  type="button"
                  onClick={() => selectArtifact(null)}
                  aria-label="Close"
                  className="flex min-h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-md border border-border/80 bg-background/95 text-foreground backdrop-blur transition-colors duration-(--duration-hover) hover:bg-accent"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </CodexPageShell>
  );
}
