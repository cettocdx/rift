"use client";

import Image from "next/image";
import styles from "./StudioDiscovery.module.css";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useReducedMotion } from "motion/react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clapperboard,
  ImageIcon,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
  Volume2,
} from "lucide-react";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { useInputApi } from "@/app/contexts/InputContext";
import { MediaModelLogo } from "@/app/components/ModelSelector/ModelLogo";
import {
  getImageModelPolicy,
  getVideoModelPolicy,
} from "@/lib/ai/media-models";
import {
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODELS,
  MEDIA_MODELS,
  VIDEO_MODELS,
  resolveMediaModel,
  type MediaModelKind,
  type SelectedModel,
} from "@/types/chat";
import {
  STUDIO_PATTERNS,
  STUDIO_PATTERN_CATEGORIES,
  type StudioPatternCategory,
} from "@/lib/ai/studio-patterns";

type Filter = "all" | MediaModelKind;
type StudioModel = (typeof MEDIA_MODELS)[number];
type StudioModelId = StudioModel["id"];

type RuntimeState =
  | { state: "checking" }
  | { state: "ready" }
  | { state: "setup"; missing: string[] }
  | { state: "error" };

type RuntimeResponse = {
  ready: boolean;
  missing: string[];
};

type StudioModelReference = {
  kind: MediaModelKind;
  src: string;
  mobileSrc?: string;
  poster: string;
  mobilePoster: string;
  thumbnail: string;
  title: string;
  note: string;
  source: "Pexels" | "RIFT Studio" | "Unsplash";
};

const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: "all", label: "All models" },
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
];

/** The models this screen can illustrate — see STUDIO_MODEL_REFERENCES. */
const showcased = <T extends { id: StudioModelId }>(models: readonly T[]) =>
  models.filter((model) => STUDIO_MODEL_REFERENCES[model.id]);

const DEFAULT_STUDIO_MODEL =
  IMAGE_MODELS.find((model) => model.id === DEFAULT_IMAGE_MODEL) ??
  IMAGE_MODELS[0];

/**
 * Art-directed references selected to express each model's strongest
 * production use. They are never presented as provider output: `source`
 * records where each asset comes from, and `referenceProvenance` turns that
 * into the label the stage shows.
 *
 * ── Why this is partial ──
 *
 * Each entry is a still or clip chosen to show what one model is for. A model
 * added to the roster therefore has no reference until someone art-directs
 * one, and the only ways to satisfy a total `Record` are to invent an asset
 * path that 404s or to point the new model at another model's artwork. The
 * second is worse than the first: this screen's whole claim is
 * that the reference expresses *that* model, and a Veo clip captioned Sora is
 * exactly the thing the note above promises not to do.
 *
 * So the type admits the gap and the gallery below shows only the models it
 * can illustrate. The new model is still fully selectable in Studio's own
 * picker and still generates — it is absent from the showcase, not from the
 * product.
 */
export const STUDIO_MODEL_REFERENCES: Partial<
  Record<StudioModelId, StudioModelReference>
> = {
  "image-lite": {
    kind: "image",
    src: "/studio/showcase-v3/image-lite-4k.webp",
    poster: "/studio/showcase-v3/image-lite-4k.webp",
    mobilePoster: "/studio/showcase-v3/image-lite-mobile.webp",
    thumbnail: "/studio/showcase-v3/image-lite-thumb.webp",
    title: "Rapid art direction",
    note: "Tactile color, clear negative space and fast concept-level composition",
    source: "RIFT Studio",
  },
  "image-gemini": {
    kind: "image",
    src: "/studio/showcase-v3/image-gemini-4k.webp",
    poster: "/studio/showcase-v3/image-gemini-4k.webp",
    mobilePoster: "/studio/showcase-v3/image-gemini-mobile.webp",
    thumbnail: "/studio/showcase-v3/image-gemini-thumb.webp",
    title: "Product storytelling",
    note: "Transparent product geometry, natural caustics and campaign detail",
    source: "RIFT Studio",
  },
  "image-gemini-pro": {
    kind: "image",
    src: "/studio/showcase-v3/image-gemini-pro-4k.webp",
    poster: "/studio/showcase-v3/image-gemini-pro-4k.webp",
    mobilePoster: "/studio/showcase-v3/image-gemini-pro-mobile.webp",
    thumbnail: "/studio/showcase-v3/image-gemini-pro-thumb.webp",
    title: "Spatial campaign",
    note: "Believable scale, material depth and precise blue-hour composition",
    source: "RIFT Studio",
  },
  "image-seedream": {
    kind: "image",
    src: "/studio/showcase-v3/image-seedream-4k.webp",
    poster: "/studio/showcase-v3/image-seedream-4k.webp",
    mobilePoster: "/studio/showcase-v3/image-seedream-mobile.webp",
    thumbnail: "/studio/showcase-v3/image-seedream-thumb.webp",
    title: "Editorial motion",
    note: "A clear silhouette, tactile fabric and disciplined campaign framing",
    source: "RIFT Studio",
  },
  "image-flux": {
    kind: "image",
    src: "/studio/showcase-v3/image-flux-4k.webp",
    poster: "/studio/showcase-v3/image-flux-4k.webp",
    mobilePoster: "/studio/showcase-v3/image-flux-mobile.webp",
    thumbnail: "/studio/showcase-v3/image-flux-thumb.webp",
    title: "Surface study",
    note: "Chrome, smoked glass and translucent fabric with precise reflections",
    source: "RIFT Studio",
  },
  "image-grok": {
    kind: "image",
    src: "/studio/showcase-v3/image-grok-4k.webp",
    poster: "/studio/showcase-v3/image-grok-4k.webp",
    mobilePoster: "/studio/showcase-v3/image-grok-mobile.webp",
    thumbnail: "/studio/showcase-v3/image-grok-thumb.webp",
    title: "Imaginative realism",
    note: "A playful subject grounded by wet-surface detail and cinematic light",
    source: "RIFT Studio",
  },
  "image-gpt": {
    kind: "image",
    src: "/studio/showcase-v3/image-gpt-4k.webp",
    poster: "/studio/showcase-v3/image-gpt-4k.webp",
    mobilePoster: "/studio/showcase-v3/image-gpt-mobile.webp",
    thumbnail: "/studio/showcase-v3/image-gpt-thumb.webp",
    title: "Controlled object edit",
    note: "Coherent geometry, clean materials and production-ready object detail",
    source: "RIFT Studio",
  },
  "video-veo-fast": {
    kind: "video",
    src: "/studio/showcase-v3/video-veo-fast-4k.mp4",
    mobileSrc: "/studio/showcase-v3/video-veo-fast-mobile.mp4",
    poster: "/studio/showcase-v3/video-veo-fast-4k.webp",
    mobilePoster: "/studio/showcase-v3/video-veo-fast-mobile.webp",
    thumbnail: "/studio/showcase-v3/video-veo-fast-thumb.webp",
    title: "Velocity concept",
    note: "Fast camera language, legible motion and campaign-ready automotive detail",
    source: "RIFT Studio",
  },
  "video-veo": {
    kind: "video",
    src: "/studio/showcase-v3/video-veo-4k.mp4",
    mobileSrc: "/studio/showcase-v3/video-veo-mobile.mp4",
    poster: "/studio/showcase-v3/video-veo-4k.webp",
    mobilePoster: "/studio/showcase-v3/video-veo-mobile.webp",
    thumbnail: "/studio/showcase-v3/video-veo-thumb.webp",
    title: "World-scale cinema",
    note: "Monumental scale, deep atmosphere and a deliberate cinematic camera move",
    source: "RIFT Studio",
  },
  "video-kling": {
    kind: "video",
    src: "/studio/showcase-v3/video-kling-4k.mp4",
    mobileSrc: "/studio/showcase-v3/video-kling-mobile.mp4",
    poster: "/studio/showcase-v3/video-kling-4k.webp",
    mobilePoster: "/studio/showcase-v3/video-kling-mobile.webp",
    thumbnail: "/studio/showcase-v3/video-kling-thumb.webp",
    title: "Character continuity",
    note: "Readable identity, tactile wardrobe and grounded action across the frame",
    source: "RIFT Studio",
  },
  "video-seedance": {
    kind: "video",
    src: "/studio/showcase-v3/video-seedance-4k.mp4",
    mobileSrc: "/studio/showcase-v3/video-seedance-mobile.mp4",
    poster: "/studio/showcase-v3/video-seedance-4k.webp",
    mobilePoster: "/studio/showcase-v3/video-seedance-mobile.webp",
    thumbnail: "/studio/showcase-v3/video-seedance-thumb.webp",
    title: "Editorial choreography",
    note: "Full-body motion, saturated fabric and clean multi-subject composition",
    source: "RIFT Studio",
  },
  "video-grok": {
    kind: "video",
    src: "/studio/showcase-v3/video-grok-4k.mp4",
    mobileSrc: "/studio/showcase-v3/video-grok-mobile.mp4",
    poster: "/studio/showcase-v3/video-grok-4k.webp",
    mobilePoster: "/studio/showcase-v3/video-grok-mobile.webp",
    thumbnail: "/studio/showcase-v3/video-grok-thumb.webp",
    title: "Material transformation",
    note: "A precise transition from natural detail into liquid glass and chrome",
    source: "RIFT Studio",
  },
};

const PROVIDER_NAMES: Record<string, string> = {
  "black-forest-labs": "Black Forest Labs",
  bytedance: "ByteDance",
  "bytedance-seed": "ByteDance",
  google: "Google",
  kwaivgi: "Kuaishou",
  openai: "OpenAI",
  "x-ai": "xAI",
};

const DIRECTIONS = [
  {
    title: "Product film",
    detail: "Controlled camera movement and sound brief",
    prompt:
      "Create an 8-second 16:9 cinematic product film of matte-black headphones rotating through soft volumetric light. Add restrained studio sound design and preserve the exact product silhouette.",
    kind: "video" as const,
    cardSrc: "/studio/references/direction-product-film-v2-card.webp",
  },
  {
    title: "Material study",
    detail: "Precise reflections and product geometry",
    prompt:
      "Create a premium 4:5 campaign key visual for a futuristic audio brand. Use matte-black headphones, precise edge lighting, minimal typography and a production-ready advertising finish.",
    kind: "image" as const,
    cardSrc: "/studio/references/direction-material-study-v2-card.webp",
  },
  {
    title: "Character continuity",
    detail: "One identity across every frame",
    prompt:
      "Create a cinematic character portrait based on the attached reference. Preserve facial identity, costume language and color palette. Set the scene in a rain-lit city with realistic depth and natural skin detail.",
    kind: "image" as const,
    cardSrc: "/studio/references/direction-character-continuity-v2-card.webp",
  },
  {
    title: "Architecture",
    detail: "Natural light, scale and spatial clarity",
    prompt:
      "Create an architectural campaign image at dawn. Preserve clean geometry, natural material texture and believable scale. Use directional morning light with restrained cinematic contrast.",
    kind: "image" as const,
    cardSrc: "/studio/references/direction-architecture-v2-card.webp",
  },
] as const;

const subscribeToHydration = () => () => undefined;

/**
 * Keep the server and hydration pass poster-only. The live reel is mounted
 * only after React owns the client tree and motion preference is explicitly
 * known to be enabled.
 */
function useHydrated() {
  return useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
}

/**
 * Keep the responsive poster as the visual source of truth until the browser
 * has decoded an actual video frame. This prevents the native video element
 * from flashing black (or briefly swapping to a second poster) while a 4K
 * reference is being prepared.
 */
function StableReferenceVideo({
  modelName,
  reference,
}: {
  modelName: string;
  reference: StudioModelReference;
}) {
  const [hasPresentedFrame, setHasPresentedFrame] = useState(false);
  const [canLoadVideo, setCanLoadVideo] = useState(false);
  const revealDecodedFrame = () => setHasPresentedFrame(true);

  useEffect(() => {
    // A selected reference can be several megabytes. Let the Studio route and
    // its poster paint first, then begin video decoding during browser idle
    // time. This keeps Build -> Studio navigation responsive without removing
    // the live, model-specific reel.
    const browser = window as Window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let timeoutId: number | undefined;
    let idleId: number | undefined;
    const start = () => setCanLoadVideo(true);

    if (browser.requestIdleCallback) {
      idleId = browser.requestIdleCallback(start, { timeout: 1_200 });
    } else {
      timeoutId = window.setTimeout(start, 350);
    }

    return () => {
      if (idleId !== undefined) browser.cancelIdleCallback?.(idleId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [reference.src]);

  return (
    <video
      muted
      autoPlay={canLoadVideo}
      loop
      playsInline
      controls
      disablePictureInPicture
      controlsList="nodownload noremoteplayback"
      preload={canLoadVideo ? "metadata" : "none"}
      onLoadedData={revealDecodedFrame}
      onCanPlay={revealDecodedFrame}
      aria-label={`${modelName} curated capability reference`}
      data-ready={hasPresentedFrame ? "true" : "false"}
      data-testid="studio-active-reference-video"
      className={`absolute inset-0 block size-full object-cover transition-opacity duration-200 ease-out motion-reduce:transition-none ${
        hasPresentedFrame
          ? "pointer-events-auto opacity-100"
          : "pointer-events-none opacity-0"
      }`}
    >
      {canLoadVideo && reference.mobileSrc ? (
        <source
          media="(max-width: 780px)"
          src={reference.mobileSrc}
          type="video/mp4"
        />
      ) : null}
      {canLoadVideo ? <source src={reference.src} type="video/mp4" /> : null}
    </video>
  );
}

function isRuntimeResponse(value: unknown): value is RuntimeResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RuntimeResponse>;
  return (
    typeof candidate.ready === "boolean" &&
    Array.isArray(candidate.missing) &&
    candidate.missing.every((item) => typeof item === "string")
  );
}

function getModelKind(model: StudioModel): MediaModelKind {
  return model.id.startsWith("video-") ? "video" : "image";
}

function getProviderName(model: StudioModel) {
  const provider = model.model.split("/")[0];
  return PROVIDER_NAMES[provider] ?? provider;
}

/**
 * What the stage may truthfully say about a reference.
 *
 * Two claims are separable here. That the media is not the model's own output
 * holds for every reference and is the disclosure the screen owes the viewer.
 * That it is original work holds only for assets art-directed for Studio, so a
 * stock `source` gets the disclosure and the credit without that second claim.
 */
export function referenceProvenance(reference: StudioModelReference) {
  const origin = reference.source === "RIFT Studio" ? "Original" : "Licensed";
  return `${origin} reference, not model output · ${reference.source}`;
}

function focusComposer() {
  requestAnimationFrame(() => {
    const composer = document.querySelector<HTMLTextAreaElement>(
      '[data-ui="composer-textarea"] textarea',
    );
    composer?.focus();
    const end = composer?.value.length ?? 0;
    composer?.setSelectionRange(end, end);
  });
}

function capabilityRows(model: StudioModel) {
  const kind = getModelKind(model);
  if (kind === "video") {
    const policy = getVideoModelPolicy(model.model);
    if (!policy) return [];
    const frameSupport = policy.supportedFrameImages.includes("last_frame")
      ? "First and last frame"
      : policy.supportedFrameImages.includes("first_frame")
        ? "First frame"
        : policy.maxInputReferences > 0
          ? `${policy.maxInputReferences} references`
          : "Prompt only";

    return [
      { label: "Execution", value: "Agent job" },
      { label: "Duration", value: `${policy.durations.join(" / ")} sec` },
      { label: "Resolution", value: policy.resolutions.join(" / ") },
      { label: "References", value: frameSupport },
      { label: "Audio", value: policy.supportsAudio ? "Supported" : "Silent" },
    ];
  }

  const policy = getImageModelPolicy(model.model);
  if (!policy) return [];
  return [
    { label: "Execution", value: "Ask" },
    {
      label: "Resolution",
      value:
        policy.supportsResolution === false
          ? "Provider managed"
          : policy.resolutions.join(" / "),
    },
    {
      label: "Framing",
      value:
        policy.supportsAspectRatio === false
          ? "Provider managed"
          : `${policy.aspectRatios.length} ratios`,
    },
    {
      label: "References",
      value:
        policy.maxInputReferences > 0
          ? `Up to ${policy.maxInputReferences}`
          : "Prompt only",
    },
    {
      label: "Controls",
      value: policy.supportsBackground
        ? "Quality and background"
        : policy.outputFormats?.length
          ? policy.outputFormats
              .map((format) => format.toUpperCase())
              .join(" / ")
          : "Generation and edits",
    },
  ];
}

function RuntimeStatus({
  runtime,
  onRetry,
}: {
  runtime: RuntimeState;
  onRetry: () => void;
}) {
  if (runtime.state === "checking") {
    return (
      <div
        className={`${styles.caption} flex items-center gap-2 text-muted-foreground`}
        role="status"
        aria-label="Checking Studio runtime"
      >
        <LoaderCircle
          className="size-3.5 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        Checking runtime
      </div>
    );
  }

  if (runtime.state === "ready") {
    return (
      <div
        className={`${styles.caption} flex items-center gap-2 text-muted-foreground`}
        role="status"
      >
        <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" />
        Runtime ready
      </div>
    );
  }

  if (runtime.state === "setup") {
    return (
      <div
        className="rounded-[8px] border border-warning/25 bg-warning/[0.05] p-2.5"
        role="status"
      >
        <div className="flex items-start gap-2">
          <TriangleAlert
            className="mt-px size-3.5 shrink-0 text-warning"
            aria-hidden="true"
          />
          <div>
            <p className={`${styles.caption} font-medium text-foreground`}>
              Server setup required
            </p>
            <p className={`${styles.caption} mt-0.5 text-muted-foreground`}>
              Missing {runtime.missing.join(" and ")}.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-[8px] border border-destructive/25 bg-destructive/[0.05] p-2.5"
      role="alert"
    >
      <span
        className={`${styles.caption} flex items-center gap-2 text-foreground`}
      >
        <TriangleAlert
          className="size-3.5 text-destructive"
          aria-hidden="true"
        />
        Runtime check failed
      </span>
      <button
        type="button"
        onClick={onRetry}
        className={`${styles.caption} inline-flex cursor-pointer items-center gap-1 rounded-[5px] px-1.5 py-1 font-medium text-foreground transition-colors hover:bg-foreground/[0.07] focus-visible:outline-none`}
      >
        <RefreshCw className="size-3" aria-hidden="true" />
        Retry
      </button>
    </div>
  );
}

export function StudioDiscovery({
  hideHeading = false,
}: { hideHeading?: boolean } = {}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [runtime, setRuntime] = useState<RuntimeState>({ state: "checking" });
  const reducedMotion = useReducedMotion();
  const hydrated = useHydrated();
  const sectionRef = useRef<HTMLElement | null>(null);
  const modelButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const { selectedModel, setSelectedModel, setChatMode } = useGlobalState();
  const [patternCategory, setPatternCategory] =
    useState<StudioPatternCategory>("ugc");
  const { setInput } = useInputApi();
  const shouldPlayReference = hydrated && reducedMotion === false;

  const checkRuntime = useCallback(async (signal?: AbortSignal) => {
    setRuntime({ state: "checking" });
    try {
      const response = await fetch("/api/studio/status", {
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new Error("Studio runtime check failed");
      const body: unknown = await response.json();
      if (!isRuntimeResponse(body)) {
        throw new Error("Studio runtime returned an invalid response");
      }
      setRuntime(
        body.ready
          ? { state: "ready" }
          : { state: "setup", missing: body.missing },
      );
    } catch {
      if (signal?.aborted) return;
      setRuntime({ state: "error" });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void checkRuntime(controller.signal);
    return () => controller.abort();
  }, [checkRuntime]);

  useEffect(() => {
    const stage = sectionRef.current?.closest<HTMLElement>(
      "[data-rift-empty-stage]",
    );
    if (!stage) return;
    stage.scrollTop = 0;
    const frame = window.requestAnimationFrame(() => {
      stage.scrollTop = 0;
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const visibleModels = useMemo(() => {
    if (filter === "image") return showcased(IMAGE_MODELS);
    if (filter === "video") return showcased(VIDEO_MODELS);
    return showcased(MEDIA_MODELS);
  }, [filter]);

  const activeModel = useMemo(
    () =>
      MEDIA_MODELS.find((model) => model.id === selectedModel) ??
      DEFAULT_STUDIO_MODEL,
    [selectedModel],
  );
  const activeKind = getModelKind(activeModel);
  /**
   * Strictly this model's own reference, or none.
   *
   * A pattern selects the model its format is good on, and three of them
   * (TV spot, Short film beat, Seamless loop) land on Sora and Wan, which have
   * no art-directed reference yet. Falling back to another model's artwork
   * puts that model's name and its reference's title over a picture it did not
   * inform — the one thing STUDIO_MODEL_REFERENCES above promises never to do.
   * The stage shows a plain plate for those models instead.
   */
  const activeReference = STUDIO_MODEL_REFERENCES[activeModel.id];
  const capabilities = useMemo(
    () => capabilityRows(activeModel),
    [activeModel],
  );

  /**
   * The rail is a roving-tabindex listbox: exactly one row is the tab stop.
   * The selected model is not always in it — a pattern can select a model with
   * no reference — and keying every row off `selected` would leave all of them
   * at -1, dropping the whole list out of the tab order. Fall back to the first
   * row so the rail is always reachable.
   */
  const railTabStopIndex = useMemo(() => {
    const selectedIndex = visibleModels.findIndex(
      (model) => model.id === activeModel.id,
    );
    return selectedIndex === -1 ? 0 : selectedIndex;
  }, [activeModel.id, visibleModels]);

  const selectModel = useCallback(
    (model: SelectedModel) => {
      setSelectedModel(model);
      setChatMode(model.startsWith("video-") ? "agent" : "ask");
    },
    [setChatMode, setSelectedModel],
  );

  useEffect(() => {
    if (!resolveMediaModel(selectedModel)) {
      selectModel(DEFAULT_IMAGE_MODEL);
    }
  }, [selectModel, selectedModel]);

  const selectFilter = (nextFilter: Filter) => {
    setFilter(nextFilter);
    if (nextFilter === "image" && activeKind !== "image") {
      selectModel(IMAGE_MODELS[0].id);
    } else if (nextFilter === "video" && activeKind !== "video") {
      selectModel(VIDEO_MODELS[0].id);
    }
  };

  /**
   * Start from the deliverable, not from the model.
   *
   * The gallery below answers "which model is this?". Nobody arrives with that
   * question — they arrive needing an unboxing ad or an establishing shot, and
   * the model is an implementation detail of it. Picking a pattern selects the
   * model the format is actually good on and lands its shot discipline in the
   * composer for the operator to fill in.
   */
  const applyPattern = (pattern: (typeof STUDIO_PATTERNS)[number]) => {
    selectModel(pattern.model as StudioModelId);
    setChatMode(pattern.kind === "video" ? "agent" : "ask");
    setInput(pattern.prompt);
    focusComposer();
  };

  const applyPrompt = (prompt: string, kind: MediaModelKind) => {
    if (!selectedModel.startsWith(`${kind}-`)) {
      selectModel(kind === "video" ? "video-veo-fast" : "image-gemini");
    } else {
      setChatMode(kind === "video" ? "agent" : "ask");
    }
    setInput(prompt);
    focusComposer();
  };

  const moveModelFocus = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % visibleModels.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex =
        (currentIndex - 1 + visibleModels.length) % visibleModels.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = visibleModels.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    const nextModel = visibleModels[nextIndex];
    selectModel(nextModel.id);
    modelButtonRefs.current[nextIndex]?.focus();
  };

  return (
    <section
      ref={sectionRef}
      aria-labelledby="studio-heading"
      className="rift-studio-library w-full text-left text-foreground"
      data-testid="studio-discovery"
    >
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="studio-heading"
            className={`${styles.title} font-medium tracking-[-0.3px]`}
          >
            {hideHeading ? "Explore the possibilities" : "Studio"}
          </h2>
          <p className={`${styles.label} mt-1 text-muted-foreground`}>
            Find a look. Choose a model. Make it yours.
          </p>
        </div>
        <div
          role="group"
          aria-label="Filter Studio models"
          className="flex rounded-lg bg-muted/70 p-0.5"
        >
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => selectFilter(item.id)}
              aria-pressed={filter === item.id}
              className={`rounded-md px-3 py-1.5 ${styles.label} transition-colors ${filter === item.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <div
        data-ui="studio-discovery-grid"
        className={`${styles.stageGrid} overflow-hidden rounded-2xl border bg-background`}
      >
        <div
          data-testid="studio-active-reference-stage"
          className={`${styles.referenceStage} ${activeReference ? "bg-black" : "bg-muted/40"}`}
        >
          {activeReference ? (
            <>
              <picture className="absolute inset-0">
                <source
                  media="(max-width: 780px)"
                  srcSet={activeReference.mobilePoster}
                />
                <Image
                  src={activeReference.poster}
                  alt={`${activeModel.name} capability reference: ${activeReference.title}`}
                  fill
                  sizes="(min-width: 1024px) 55vw, 100vw"
                  loading="eager"
                  className="object-cover"
                />
              </picture>
              {activeReference.kind === "video" && shouldPlayReference && (
                <StableReferenceVideo
                  key={activeReference.src}
                  modelName={activeModel.name}
                  reference={activeReference}
                />
              )}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent"
              />
              <span
                data-testid="studio-provider-over-reference"
                className="absolute left-5 top-5 rounded-full border border-white/20 bg-black/65 px-2.5 py-1 text-[11px] text-white backdrop-blur"
              >
                {getProviderName(activeModel)}
              </span>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 p-6 text-white">
                <p className="text-[20px] font-medium tracking-[-0.4px]">
                  {activeReference.title}
                </p>
                <p className="mt-1 max-w-md text-[12px] leading-5 text-white/85">
                  {activeReference.note}
                </p>
                <p className="mt-3 text-[10px] text-white/60">
                  {referenceProvenance(activeReference)}
                </p>
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col justify-end p-6">
              <span
                data-testid="studio-provider-on-plate"
                className={`${styles.label} mb-auto text-muted-foreground`}
              >
                {getProviderName(activeModel)}
              </span>
              <h3 className={`${styles.title} font-medium`}>
                {activeModel.name}
              </h3>
              <p className={`${styles.label} mt-2 text-muted-foreground`}>
                No Studio reference has been art-directed for this model yet.
              </p>
            </div>
          )}
        </div>
        <aside
          aria-label="Selected model capabilities"
          className="flex min-w-0 flex-col border-t p-5 md:border-l md:border-t-0"
        >
          <div className="mb-4 flex items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg border bg-muted/30">
              <MediaModelLogo model={activeModel.id} size={22} />
            </span>
            <div className="min-w-0 flex-1">
              <p className={`${styles.caption} text-muted-foreground`}>
                {activeKind === "video"
                  ? "Video generation"
                  : "Image generation"}
              </p>
              <h3 className={`${styles.body} mt-0.5 break-words font-medium`}>
                {activeModel.name}
              </h3>
            </div>
          </div>
          <p className={`${styles.label} text-muted-foreground`}>
            {activeModel.desc}
          </p>
          <dl className="my-4 divide-y border-y">
            {capabilities.map((capability) => (
              <div
                key={capability.label}
                className={`${styles.label} flex items-baseline justify-between gap-3 py-2.5`}
              >
                <dt className="min-w-0 break-words text-muted-foreground">
                  {capability.label}
                </dt>
                <dd className="min-w-0 break-words text-right font-medium">
                  {capability.value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-auto">
            <RuntimeStatus
              runtime={runtime}
              onRetry={() => void checkRuntime()}
            />
            <button
              type="button"
              onClick={() => {
                selectModel(activeModel.id);
                focusComposer();
              }}
              className={`${styles.label} mt-4 flex min-h-9 w-full items-center justify-between gap-2 rounded-lg bg-foreground px-3 py-2 font-medium text-background transition-opacity hover:opacity-85`}
            >
              Use in composer
              <ArrowRight aria-hidden className="size-3.5" />
            </button>
          </div>
        </aside>
      </div>

      <section aria-label="Studio model library" className="mb-8 mt-4">
        <div
          role="listbox"
          aria-label="Studio models"
          data-testid="studio-model-rail"
          className="flex snap-x gap-2 overflow-x-auto pb-2 [scrollbar-width:thin]"
        >
          {visibleModels.map((model, index) => {
            const selected = model.id === activeModel.id;
            const reference = STUDIO_MODEL_REFERENCES[model.id]!;
            return (
              <button
                key={model.id}
                ref={(node) => {
                  modelButtonRefs.current[index] = node;
                }}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={index === railTabStopIndex ? 0 : -1}
                data-studio-model={model.id}
                data-studio-reference={reference.src}
                data-studio-thumbnail={reference.thumbnail}
                onClick={() => selectModel(model.id)}
                onKeyDown={(event) => moveModelFocus(event, index)}
                className={`${styles.modelCard} group flex shrink-0 snap-start items-center gap-2.5 rounded-xl border p-2 text-left transition-colors ${selected ? "border-foreground/35 bg-muted/60" : "border-transparent hover:bg-muted/50"}`}
              >
                <span className="relative size-11 shrink-0 overflow-hidden rounded-lg bg-muted">
                  <Image
                    src={reference.thumbnail}
                    alt=""
                    fill
                    sizes="44px"
                    className="object-cover"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`${styles.label} block truncate font-medium`}
                  >
                    {model.name}
                  </span>
                  <span
                    className={`${styles.caption} mt-0.5 block text-muted-foreground`}
                  >
                    {getModelKind(model) === "video" ? "Video" : "Image"}
                  </span>
                </span>
                {selected && <Check aria-hidden className="size-3 shrink-0" />}
              </button>
            );
          })}
        </div>
      </section>

      <section
        aria-labelledby="studio-patterns-heading"
        className="border-t pt-6"
      >
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2
              id="studio-patterns-heading"
              className={`${styles.body} font-medium`}
            >
              Start with an idea
            </h2>
            <p className={`${styles.label} mt-1 text-muted-foreground`}>
              Ready-to-edit briefs for the things you want to make.
            </p>
          </div>
        </div>
        <div
          role="group"
          aria-label="Pattern categories"
          className="mb-4 flex gap-1 overflow-x-auto pb-1"
        >
          {STUDIO_PATTERN_CATEGORIES.map((category) => (
            <button
              key={category.id}
              type="button"
              aria-pressed={patternCategory === category.id}
              title={category.description}
              onClick={() => setPatternCategory(category.id)}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 ${styles.label} transition-colors ${patternCategory === category.id ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              {category.label}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {STUDIO_PATTERNS.filter(
            (pattern) => pattern.category === patternCategory,
          ).map((pattern) => {
            const reference =
              STUDIO_MODEL_REFERENCES[pattern.model as StudioModelId];
            return (
              <button
                key={pattern.id}
                type="button"
                data-testid={`studio-pattern-${pattern.id}`}
                onClick={() => applyPattern(pattern)}
                className="group flex overflow-hidden rounded-xl border bg-background text-left transition-colors hover:border-foreground/25 hover:bg-muted/30"
              >
                <span className="relative w-[86px] shrink-0 bg-muted">
                  {reference ? (
                    <Image
                      src={reference.thumbnail}
                      alt=""
                      fill
                      sizes="86px"
                      className="object-cover"
                    />
                  ) : (
                    <span className="grid h-full place-items-center">
                      <Clapperboard
                        aria-hidden
                        className="size-6 text-muted-foreground"
                      />
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1 p-3.5">
                  <span
                    className={`${styles.caption} mb-1.5 block text-muted-foreground`}
                  >
                    {pattern.kind === "video" ? "Video brief" : "Image brief"}
                  </span>
                  <span className={`${styles.body} block font-medium`}>
                    {pattern.name}
                  </span>
                  <span
                    className={`${styles.caption} mt-1 line-clamp-2 block text-muted-foreground`}
                  >
                    {pattern.summary}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section
        className="mb-6 mt-8"
        aria-labelledby="studio-directions-heading"
      >
        <h2
          id="studio-directions-heading"
          className={`${styles.body} font-medium`}
        >
          Production directions
        </h2>
        <p className={`${styles.label} mt-1 text-muted-foreground`}>
          Load a complete, editable brief into the composer.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {DIRECTIONS.map((direction) => (
            <button
              key={direction.title}
              type="button"
              aria-label={`Use direction: ${direction.title}`}
              onClick={() => applyPrompt(direction.prompt, direction.kind)}
              className="group relative aspect-[4/3] overflow-hidden rounded-xl bg-muted text-left"
            >
              <Image
                src={direction.cardSrc}
                alt=""
                fill
                sizes="(min-width: 1024px) 22vw, 50vw"
                className="object-cover transition-transform duration-300 motion-safe:group-hover:scale-[1.025]"
              />
              <span
                aria-hidden
                className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent"
              />
              <span className="absolute inset-x-0 bottom-0 p-4 text-white">
                <span className="mb-1 flex items-center gap-1.5 text-[10px] text-white/75">
                  {direction.kind === "video" ? (
                    <Volume2 aria-hidden className="size-3" />
                  ) : (
                    <ImageIcon aria-hidden className="size-3" />
                  )}
                  {direction.kind === "video" ? "Video" : "Image"}
                </span>
                <span className="block text-[13px] font-medium">
                  {direction.title}
                </span>
                <span className="mt-1 block text-[11px] text-white/75">
                  {direction.detail}
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>
    </section>
  );
}
