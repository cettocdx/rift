"use client";

import { useId, type ComponentType } from "react";
import {
  Check,
  CircleAlert,
  Film,
  ImageIcon,
  LoaderCircle,
} from "lucide-react";

const MAX_MEDIA_BRIEF_LENGTH = 240;

const IMAGE_GENERATION_LAYOUTS: Record<string, string> = {
  "1:1": "aspect-square max-w-lg",
  "16:9": "aspect-video max-w-[640px]",
  "9:16": "aspect-[9/16] max-w-[22rem]",
  "4:3": "aspect-[4/3] max-w-[600px]",
  "3:4": "aspect-[3/4] max-w-[28rem]",
  "3:2": "aspect-[3/2] max-w-[640px]",
  "2:3": "aspect-[2/3] max-w-[27rem]",
  "4:5": "aspect-[4/5] max-w-[30rem]",
  "5:4": "aspect-[5/4] max-w-[600px]",
};

const VIDEO_GENERATION_LAYOUTS: Record<string, string> = {
  "16:9": "aspect-video max-w-2xl",
  "9:16": "aspect-[9/16] max-w-[22rem]",
  "1:1": "aspect-square max-w-lg",
};

export type MediaGenerationKind = "image" | "video";

export type MediaGenerationToolState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error"
  | "output-denied";

export type CreativeRunState = "planning" | "generating" | "done" | "error";

export type CreativePhaseStatus = "pending" | "active" | "done" | "error";

export interface CreativeGenerationPhase {
  id: "brief" | "direction" | "generation" | "review" | "delivery";
  label: string;
  status: CreativePhaseStatus;
}

export function normalizeMediaGenerationBrief(value: unknown) {
  if (typeof value !== "string") return undefined;

  const brief = value.replace(/\s+/g, " ").trim();
  if (!brief) return undefined;

  return brief.slice(0, MAX_MEDIA_BRIEF_LENGTH);
}

// Retain the image-specific export for existing callers.
export const normalizeImageGenerationBrief = normalizeMediaGenerationBrief;

export function mapMediaGenerationToolState(state: unknown): CreativeRunState {
  if (state === "input-streaming") return "planning";
  if (state === "output-available") return "done";
  if (state === "output-error" || state === "output-denied") return "error";
  return "generating";
}

export function getCreativeGenerationPhases(
  kind: MediaGenerationKind,
  toolState: unknown = "input-available",
): CreativeGenerationPhase[] {
  const runState = mapMediaGenerationToolState(toolState);
  const definitions: Array<Pick<CreativeGenerationPhase, "id" | "label">> = [
    { id: "brief", label: "Brief analysis" },
    {
      id: "direction",
      label: kind === "image" ? "Art direction" : "Motion plan",
    },
    { id: "generation", label: "Model preparation and generation" },
    { id: "review", label: "Output check" },
    { id: "delivery", label: "Delivery" },
  ];

  return definitions.map((phase, index) => {
    let status: CreativePhaseStatus = "pending";

    if (runState === "done") status = "done";
    else if (runState === "planning" && index === 0) status = "active";
    else if (runState === "generating") {
      if (index < 2) status = "done";
      else if (index === 2) status = "active";
    } else if (runState === "error") {
      if (index < 2) status = "done";
      else if (index === 2) status = "error";
    }

    return { ...phase, status };
  });
}

export function getGenerationLayout(kind: MediaGenerationKind, value: unknown) {
  const layouts =
    kind === "image" ? IMAGE_GENERATION_LAYOUTS : VIDEO_GENERATION_LAYOUTS;
  const fallback = kind === "image" ? "1:1" : "16:9";

  if (typeof value !== "string") return layouts[fallback];
  return layouts[value] ?? layouts[fallback];
}

function getRunCopy(kind: MediaGenerationKind, runState: CreativeRunState) {
  if (runState === "planning") {
    return {
      title: kind === "image" ? "Creating image" : "Rendering video",
      detail:
        kind === "image"
          ? "Reading the brief and shaping a visual direction."
          : "Reading the brief and shaping a motion plan.",
    };
  }

  if (runState === "done") {
    return {
      title: kind === "image" ? "Image ready" : "Video ready",
      detail: "The output was validated and saved for delivery.",
    };
  }

  if (runState === "error") {
    return {
      title: `${kind === "image" ? "Image" : "Video"} generation stopped`,
      detail: "The run stopped before a deliverable was saved.",
    };
  }

  return {
    title: kind === "image" ? "Creating image" : "Rendering video",
    detail:
      kind === "image"
        ? "Preparing the model and generating the image. Timing varies by model."
        : "Preparing the model, frames, and motion. Rendering time varies by model.",
  };
}

function PhaseMarker({ status }: { status: CreativePhaseStatus }) {
  if (status === "active") {
    return (
      <LoaderCircle
        aria-hidden="true"
        className="size-3.5 text-[var(--signal-bright)] motion-safe:animate-spin motion-reduce:animate-none"
        data-testid="creative-run-active-indicator"
      />
    );
  }

  if (status === "done") {
    return <Check aria-hidden="true" className="size-3.5 text-foreground/75" />;
  }

  if (status === "error") {
    return (
      <CircleAlert aria-hidden="true" className="size-3.5 text-destructive" />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="size-1.5 rounded-[2px] bg-muted-foreground/35"
    />
  );
}

interface CreativeGenerationProgressProps {
  kind: MediaGenerationKind;
  brief?: unknown;
  aspectRatio?: unknown;
  state?: MediaGenerationToolState | string;
  errorMessage?: string;
}

export function CreativeGenerationProgress({
  kind,
  brief,
  aspectRatio,
  state = "input-available",
  errorMessage,
}: CreativeGenerationProgressProps) {
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const runState = mapMediaGenerationToolState(state);
  const phases = getCreativeGenerationPhases(kind, state);
  const copy = getRunCopy(kind, runState);
  const publicBrief = normalizeMediaGenerationBrief(brief);
  const supportingCopy = publicBrief ?? "This can take a moment.";
  const isBusy = runState === "planning" || runState === "generating";
  const Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }> =
    kind === "image" ? ImageIcon : Film;

  return (
    <div
      aria-atomic="true"
      aria-busy={isBusy}
      aria-describedby={
        errorMessage ? `${descriptionId} ${errorId}` : descriptionId
      }
      aria-labelledby={titleId}
      aria-live={runState === "error" ? "assertive" : "polite"}
      className={`relative isolate my-1 min-h-[300px] w-full overflow-hidden rounded-xl bg-card/80 text-foreground ring-1 ring-inset ring-border/80 ${getGenerationLayout(kind, aspectRatio)}`}
      data-kind={kind}
      data-run-state={runState}
      role={runState === "error" ? "alert" : "status"}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--signal)_8%,transparent),transparent_42%,color-mix(in_srgb,currentColor_4%,transparent))]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--signal-bright)]/55 to-transparent"
      />
      {isBusy ? (
        <>
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[linear-gradient(108deg,transparent_35%,color-mix(in_srgb,currentColor_5%,transparent)_50%,transparent_65%)] bg-[length:220%_100%] motion-safe:[animation:shimmer_3.2s_ease-in-out_infinite] motion-reduce:animate-none"
            data-testid="creative-run-scan"
          />
          {/* The image condensing out of grain (aicss image-generation): a
              faint dot lattice with a denser layer breathing through two
              drifting masks. It replaces nothing -- the diagonal scan above
              stays -- it gives the empty canvas a subject. */}
          <div aria-hidden="true" className="rift-ig-dots absolute inset-0" />
          <div
            aria-hidden="true"
            data-testid="creative-run-grain"
            className="rift-ig-glow absolute inset-0"
          />
        </>
      ) : null}

      <div className="relative flex h-full min-h-[240px] flex-col justify-between p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.055] ring-1 ring-inset ring-border/70">
              <Icon aria-hidden className="size-3.5 text-foreground/75" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Creative agent run
              </p>
              <p
                className="mt-0.5 text-[13px] font-medium leading-5 text-foreground"
                id={titleId}
              >
                {copy.title}
              </p>
            </div>
          </div>
          <span className="shrink-0 rounded-md border border-border/70 bg-background/35 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
            {kind}
          </span>
        </div>

        <div className="my-3 grid gap-1.5" data-testid="creative-run-phases">
          <ol className="grid gap-1" aria-label="Generation phases">
            {phases.map((phase, index) => (
              <li
                className={`grid grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-md px-1.5 py-1 text-[11px] leading-4 ${
                  phase.status === "active"
                    ? "bg-foreground/[0.045] text-foreground"
                    : phase.status === "error"
                      ? "bg-destructive/[0.07] text-foreground"
                      : phase.status === "done"
                        ? "text-foreground/70"
                        : "text-muted-foreground/55"
                }`}
                data-phase={phase.id}
                data-status={phase.status}
                key={phase.id}
              >
                <span className="flex size-[18px] items-center justify-center">
                  <PhaseMarker status={phase.status} />
                </span>
                <span className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate">{phase.label}</span>
                  <span className="font-mono text-[9px] tabular-nums text-muted-foreground/45">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="sr-only">{phase.status}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="px-1.5 text-[10px] leading-4 text-muted-foreground">
            {copy.detail}
          </p>
        </div>

        <div className="border-t border-border/60 pt-3">
          <p
            className="line-clamp-2 text-[11px] leading-[17px] text-muted-foreground"
            id={descriptionId}
          >
            {supportingCopy}
          </p>
          {errorMessage ? (
            <p
              className="mt-1 text-[11px] leading-[17px] text-destructive"
              id={errorId}
            >
              {errorMessage}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface GeneratingImagePlaceholderProps {
  brief?: unknown;
  aspectRatio?: unknown;
  state?: MediaGenerationToolState | string;
  errorMessage?: string;
}

/** Public, event-driven progress shown while the durable image job is running. */
export function GeneratingImagePlaceholder(
  props: GeneratingImagePlaceholderProps = {},
) {
  return <CreativeGenerationProgress kind="image" {...props} />;
}

/** Public, event-driven progress shown while the durable video job is running. */
export function GeneratingVideoPlaceholder(
  props: GeneratingImagePlaceholderProps = {},
) {
  return <CreativeGenerationProgress kind="video" {...props} />;
}

function GenerationError({
  kind,
  message,
}: {
  kind: MediaGenerationKind;
  message: string;
}) {
  return (
    <div
      aria-live="assertive"
      className="my-1 flex w-full max-w-2xl items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-3"
      role="alert"
    >
      <CircleAlert
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-destructive"
      />
      <div className="text-sm leading-snug text-foreground">
        <span className="font-medium">Couldn&apos;t generate the {kind}.</span>{" "}
        <span className="text-muted-foreground">{message}</span>
      </div>
    </div>
  );
}

export function ImageGenerationError({ message }: { message: string }) {
  return <GenerationError kind="image" message={message} />;
}

export function VideoGenerationError({ message }: { message: string }) {
  return <GenerationError kind="video" message={message} />;
}
