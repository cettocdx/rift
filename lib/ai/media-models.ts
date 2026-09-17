/**
 * Server-owned Media Studio policy.
 *
 * Never accept a raw model id or price from the browser. The selected picker
 * value is resolved to a model in `types/chat.ts`, then resolved again here
 * against this independent allowlist before any billable provider request.
 */

export const IMAGE_ASPECT_RATIOS = [
  "auto",
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "4:5",
  "5:4",
] as const;

export const IMAGE_RESOLUTIONS = ["1K", "2K", "4K"] as const;
export const IMAGE_OUTPUT_FORMATS = ["png", "jpeg", "webp"] as const;
export const IMAGE_BACKGROUNDS = ["auto", "transparent", "opaque"] as const;

export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];
export type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number];
export type ImageOutputFormat = (typeof IMAGE_OUTPUT_FORMATS)[number];
export type ImageBackground = (typeof IMAGE_BACKGROUNDS)[number];

export type ImageModelPolicy = {
  model: string;
  fallbackCostUsd: number;
  resolutions: readonly ImageResolution[];
  aspectRatios: readonly ImageAspectRatio[];
  /** Omit unsupported unified Image API parameters instead of provoking a 400. */
  supportsResolution?: boolean;
  supportsAspectRatio?: boolean;
  /** Only models advertising this field receive `output_format`. */
  outputFormats?: readonly ImageOutputFormat[];
  /** Maximum owner-checked images accepted through `input_references`. */
  maxInputReferences: number;
  supportsQuality: boolean;
  supportsBackground: boolean;
  /** Exact background values advertised by the selected Images endpoint. */
  backgrounds?: readonly ImageBackground[];
};

const COMMON_RATIOS = IMAGE_ASPECT_RATIOS;
const GOOGLE_IMAGE_RATIOS: readonly ImageAspectRatio[] = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "4:5",
  "5:4",
];
const GROK_IMAGE_RATIOS: readonly ImageAspectRatio[] = [
  "auto",
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
];

export const DEFAULT_IMAGE_GENERATION_MODEL = "google/gemini-3.1-flash-image";

export const IMAGE_MODEL_POLICIES: Readonly<Record<string, ImageModelPolicy>> =
  {
    "google/gemini-3.1-flash-lite-image": {
      model: "google/gemini-3.1-flash-lite-image",
      fallbackCostUsd: 0.04,
      resolutions: ["1K"],
      aspectRatios: GOOGLE_IMAGE_RATIOS,
      maxInputReferences: 14,
      supportsQuality: false,
      supportsBackground: false,
    },
    "google/gemini-3.1-flash-image": {
      model: "google/gemini-3.1-flash-image",
      fallbackCostUsd: 0.08,
      resolutions: ["1K", "2K", "4K"],
      aspectRatios: GOOGLE_IMAGE_RATIOS,
      maxInputReferences: 14,
      supportsQuality: false,
      supportsBackground: false,
    },
    "google/gemini-3-pro-image": {
      model: "google/gemini-3-pro-image",
      fallbackCostUsd: 0.14,
      resolutions: ["1K", "2K", "4K"],
      aspectRatios: GOOGLE_IMAGE_RATIOS,
      maxInputReferences: 14,
      supportsQuality: false,
      supportsBackground: false,
    },
    "bytedance-seed/seedream-5-0-pro": {
      model: "bytedance-seed/seedream-5-0-pro",
      fallbackCostUsd: 0.04,
      // 5.0 Pro advertises 1K/2K only — 4.5's 4K tier is gone.
      resolutions: ["1K", "2K"],
      aspectRatios: COMMON_RATIOS,
      maxInputReferences: 14,
      supportsQuality: false,
      supportsBackground: false,
    },
    "black-forest-labs/flux.2-max": {
      model: "black-forest-labs/flux.2-max",
      // Default output is approximately one megapixel. OpenRouter's real
      // `usage.cost` wins whenever present.
      fallbackCostUsd: 0.07,
      resolutions: ["1K", "2K"],
      aspectRatios: COMMON_RATIOS,
      // FLUX.2 Max's dedicated Images endpoint currently exposes output_format
      // but not resolution/aspect_ratio. Keep those controls out of the wire
      // payload and constrain formats to its advertised png/jpeg allowlist.
      supportsResolution: false,
      supportsAspectRatio: false,
      outputFormats: ["png", "jpeg"],
      maxInputReferences: 8,
      supportsQuality: false,
      supportsBackground: false,
    },
    "x-ai/grok-imagine-image-2.0": {
      model: "x-ai/grok-imagine-image-2.0",
      fallbackCostUsd: 0.05,
      resolutions: ["1K", "2K"],
      aspectRatios: GROK_IMAGE_RATIOS,
      maxInputReferences: 3,
      supportsQuality: false,
      supportsBackground: false,
    },
    "qwen/qwen-image-3-pro": {
      model: "qwen/qwen-image-3-pro",
      fallbackCostUsd: 0.05,
      resolutions: ["1K", "2K"],
      // Qwen advertises its own ratio set and omits "auto".
      aspectRatios: [
        "1:1",
        "2:3",
        "3:2",
        "3:4",
        "4:3",
        "4:5",
        "5:4",
        "9:16",
        "16:9",
      ],
      maxInputReferences: 4,
      supportsQuality: false,
      supportsBackground: false,
    },
    "openai/gpt-image-2": {
      model: "openai/gpt-image-2",
      fallbackCostUsd: 0.2,
      resolutions: ["1K", "2K", "4K"],
      aspectRatios: COMMON_RATIOS,
      // GPT Image's dedicated endpoint advertises quality/background rather
      // than the unified resolution/aspect/output-format knobs.
      supportsResolution: false,
      supportsAspectRatio: false,
      maxInputReferences: 16,
      supportsQuality: true,
      supportsBackground: true,
      // GPT Image 2 currently advertises auto/opaque only. In particular,
      // forwarding `transparent` turns a paid request into a provider 400.
      backgrounds: ["auto", "opaque"],
    },
  };

export function getImageModelPolicy(
  model: string | undefined,
): ImageModelPolicy | null {
  const selected = model ?? DEFAULT_IMAGE_GENERATION_MODEL;
  return IMAGE_MODEL_POLICIES[selected] ?? null;
}

export const VIDEO_ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
/*
 * "2K" is here for MiniMax H3, which advertises that tier and no other. Adding
 * it to the enum does not offer it anywhere else: a resolution is only
 * selectable if the chosen model's policy lists it.
 */
export const VIDEO_RESOLUTIONS = ["720p", "1080p", "2K"] as const;
export const VIDEO_DURATIONS = [4, 5, 6, 8, 10] as const;

export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number];
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];
export type VideoDuration = (typeof VIDEO_DURATIONS)[number];
export type VideoFrameType = "first_frame" | "last_frame";

export type VideoModelPolicy = {
  model: string;
  costPerSecondUsd: number;
  durations: readonly VideoDuration[];
  resolutions: readonly VideoResolution[];
  aspectRatios: readonly VideoAspectRatio[];
  supportsAudio: boolean;
  supportedFrameImages: readonly VideoFrameType[];
  /** Zero means reference-to-video is intentionally disabled for this route. */
  maxInputReferences: number;
};

export const DEFAULT_VIDEO_GENERATION_MODEL = "google/veo-3.1-fast";

export const VIDEO_MODEL_POLICIES: Readonly<Record<string, VideoModelPolicy>> =
  {
    "google/veo-3.1-fast": {
      model: "google/veo-3.1-fast",
      costPerSecondUsd: 0.1,
      durations: [4, 6, 8],
      resolutions: ["720p", "1080p"],
      aspectRatios: ["16:9", "9:16"],
      supportsAudio: true,
      supportedFrameImages: ["first_frame", "last_frame"],
      maxInputReferences: 0,
    },
    "google/veo-3.1": {
      model: "google/veo-3.1",
      costPerSecondUsd: 0.4,
      durations: [4, 6, 8],
      resolutions: ["720p", "1080p"],
      aspectRatios: ["16:9", "9:16"],
      supportsAudio: true,
      supportedFrameImages: ["first_frame", "last_frame"],
      maxInputReferences: 0,
    },
    "kwaivgi/kling-v3.0-pro": {
      model: "kwaivgi/kling-v3.0-pro",
      costPerSecondUsd: 0.168,
      durations: [5, 10],
      resolutions: ["720p"],
      aspectRatios: VIDEO_ASPECT_RATIOS,
      supportsAudio: true,
      supportedFrameImages: ["first_frame", "last_frame"],
      maxInputReferences: 0,
    },
    "bytedance/seedance-2.5": {
      model: "bytedance/seedance-2.5",
      // 2.5 tops out at 720p (2.0 went to 4K) and prices ~1.5x 2.0's token
      // rate. Keep the old conservative fallback: reported usage.cost wins,
      // and over-estimating here can only ever over-reserve, never under-bill.
      costPerSecondUsd: 0.3402,
      durations: [4, 5, 6, 8, 10],
      resolutions: ["720p"],
      aspectRatios: VIDEO_ASPECT_RATIOS,
      supportsAudio: true,
      supportedFrameImages: ["first_frame", "last_frame"],
      maxInputReferences: 9,
    },
    "x-ai/grok-imagine-video-1.5": {
      model: "x-ai/grok-imagine-video-1.5",
      // 1.5 adds a 1080p tier at 25c/s; bill the ceiling when the provider
      // reports nothing.
      costPerSecondUsd: 0.25,
      durations: [4, 5, 6],
      resolutions: ["720p", "1080p"],
      aspectRatios: VIDEO_ASPECT_RATIOS,
      supportsAudio: false,
      supportedFrameImages: ["first_frame"],
      maxInputReferences: 7,
    },
    "openai/sora-2-pro": {
      model: "openai/sora-2-pro",
      // pricing_skus: 0.30/s at 720p, 0.50/s at 1080p. Bill the ceiling when
      // the provider reports nothing, as every other entry here does.
      costPerSecondUsd: 0.5,
      // Advertised [4, 8, 12, 16, 20]; 12 and up are outside VIDEO_DURATIONS.
      durations: [4, 8],
      resolutions: ["720p", "1080p"],
      aspectRatios: ["16:9", "9:16"],
      supportsAudio: true,
      // `supported_frame_images` is null on this route — text-to-video only.
      supportedFrameImages: [],
      maxInputReferences: 0,
    },
    "runway/gen-4.5": {
      model: "runway/gen-4.5",
      // pricing_skus: cents_per_second_output 12.
      costPerSecondUsd: 0.12,
      durations: [4, 5, 6, 8, 10],
      resolutions: ["720p"],
      aspectRatios: ["16:9", "9:16"],
      supportsAudio: false,
      supportedFrameImages: ["first_frame"],
      maxInputReferences: 0,
    },
    "alibaba/wan-3.0": {
      model: "alibaba/wan-3.0",
      // pricing_skus: 0.1/s at 720p, 0.2/s at 1080p.
      costPerSecondUsd: 0.2,
      // Advertised 2-30s; the picker's ladder is the intersection.
      durations: [4, 5, 6, 8, 10],
      // 480p is advertised too and is not in VIDEO_RESOLUTIONS.
      resolutions: ["720p", "1080p"],
      aspectRatios: ["16:9", "9:16", "1:1"],
      supportsAudio: true,
      supportedFrameImages: ["first_frame"],
      maxInputReferences: 0,
    },
    "minimax/hailuo-3": {
      model: "minimax/hailuo-3",
      // pricing_skus: duration_seconds 0.13, plus 0.04 per reference image.
      costPerSecondUsd: 0.13,
      durations: [5, 6, 8, 10],
      // The only tier it advertises.
      resolutions: ["2K"],
      aspectRatios: ["16:9", "9:16", "1:1"],
      supportsAudio: true,
      supportedFrameImages: ["first_frame", "last_frame"],
      maxInputReferences: 3,
    },
  };

export function getVideoModelPolicy(
  model: string | undefined,
): VideoModelPolicy | null {
  const selected = model ?? DEFAULT_VIDEO_GENERATION_MODEL;
  return VIDEO_MODEL_POLICIES[selected] ?? null;
}

export function getProviderReportedCost(
  providerMetadata: unknown,
): number | null {
  if (!providerMetadata || typeof providerMetadata !== "object") return null;
  const openrouter = (providerMetadata as Record<string, unknown>).openrouter;
  if (!openrouter || typeof openrouter !== "object") return null;
  const cost = (openrouter as Record<string, unknown>).cost;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0
    ? cost
    : null;
}
