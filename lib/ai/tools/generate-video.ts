import { getProviderContext } from "@/lib/ai/provider-context";
import { experimental_generateVideo as generateVideo, tool } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import type { ToolContext } from "@/types";
import { openrouterAttributionHeaders } from "@/lib/ai/openrouter-attribution";
import { isMediaPromptHardBlocked } from "@/lib/ai/media-moderation";
import { sanitizeMediaReferenceUrls } from "@/lib/ai/media-references";
import {
  VIDEO_ASPECT_RATIOS,
  VIDEO_RESOLUTIONS,
  getProviderReportedCost,
  getVideoModelPolicy,
  type VideoAspectRatio,
  type VideoDuration,
  type VideoFrameType,
  type VideoModelPolicy,
  type VideoResolution,
} from "@/lib/ai/media-models";
import { MAX_GENERATED_FILE_SIZE_BYTES } from "@/lib/constants/s3";
import { createOpenRouterVideoDownload } from "@/lib/ai/video-download";
import {
  canPersistGeneratedMedia,
  captureGeneratedMediaStorageOrigin,
  persistGeneratedMediaBytes,
} from "./utils/generated-media-storage";

const VIDEO_POLL_INTERVAL_MS = 5_000;
const VIDEO_MAX_POLL_TIME_MS = 12 * 60 * 1000;
const VIDEO_DURATION_SCHEMA = z.union([
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(8),
  z.literal(10),
]);
const VIDEO_REFERENCE_MODE_SCHEMA = z.enum([
  "first-frame",
  "first-last",
  "style",
]);

export type VideoReferenceMode = z.infer<typeof VIDEO_REFERENCE_MODE_SCHEMA>;

type VideoToolInput = {
  prompt: string;
  /**
   * Label shown while the asset renders. Optional because it is
   * presentation only — never read by `execute` — and a model that
   * omitted it used to fail schema validation, killing the whole
   * generation over a caption. The UI already handles its absence.
   */
  brief?: string;
  duration?: VideoDuration;
  aspectRatio?: VideoAspectRatio;
  resolution?: VideoResolution;
  generateAudio?: boolean;
  referenceMode?: VideoReferenceMode;
};

export type SanitizedVideoSettings = {
  duration: VideoDuration;
  aspectRatio: VideoAspectRatio;
  resolution: VideoResolution;
  generateAudio: boolean;
};

type OpenRouterVideoFrameImage = {
  type: "image_url";
  image_url: { url: string };
  frame_type: VideoFrameType;
};

type OpenRouterVideoInputReference = {
  type: "image_url";
  image_url: { url: string };
};

export type OpenRouterVideoReferencePlan = {
  extraBody: {
    frame_images?: OpenRouterVideoFrameImage[];
    input_references?: OpenRouterVideoInputReference[];
  };
  mode: VideoReferenceMode | "none";
  referenceCount: number;
};

function chooseSupported<T extends string | number>(
  requested: T | undefined,
  supported: readonly T[],
): T {
  return requested !== undefined && supported.includes(requested)
    ? requested
    : supported[0];
}

export function sanitizeVideoSettings(
  policy: VideoModelPolicy,
  input: VideoToolInput,
): SanitizedVideoSettings {
  return {
    duration: chooseSupported(input.duration, policy.durations),
    aspectRatio: chooseSupported(input.aspectRatio, policy.aspectRatios),
    resolution: chooseSupported(input.resolution, policy.resolutions),
    generateAudio: policy.supportsAudio && (input.generateAudio ?? true),
  };
}

/**
 * Build reference fields from server-resolved attachments only. Unsupported
 * modes gracefully narrow to a first frame (or no references) instead of
 * forwarding a provider field that would turn a paid request into a 400.
 */
export function buildOpenRouterVideoReferencePlan(
  policy: VideoModelPolicy,
  mediaReferenceUrls: readonly string[] = [],
  requestedMode: VideoReferenceMode = "first-frame",
): OpenRouterVideoReferencePlan {
  const references = sanitizeMediaReferenceUrls(
    mediaReferenceUrls,
    Math.max(policy.maxInputReferences, 2),
  );
  if (references.length === 0) {
    return { extraBody: {}, mode: "none", referenceCount: 0 };
  }

  if (requestedMode === "style" && policy.maxInputReferences > 0) {
    const styleReferences = references.slice(0, policy.maxInputReferences);
    return {
      extraBody: {
        input_references: styleReferences.map((url) => ({
          type: "image_url",
          image_url: { url },
        })),
      },
      mode: "style",
      referenceCount: styleReferences.length,
    };
  }

  if (policy.supportedFrameImages.includes("first_frame")) {
    const frameImages: OpenRouterVideoFrameImage[] = [
      {
        type: "image_url",
        image_url: { url: references[0] },
        frame_type: "first_frame",
      },
    ];
    if (
      requestedMode === "first-last" &&
      references.length > 1 &&
      policy.supportedFrameImages.includes("last_frame")
    ) {
      frameImages.push({
        type: "image_url",
        image_url: { url: references[1] },
        frame_type: "last_frame",
      });
    }
    return {
      extraBody: { frame_images: frameImages },
      mode: frameImages.length > 1 ? "first-last" : "first-frame",
      referenceCount: frameImages.length,
    };
  }

  if (policy.maxInputReferences > 0) {
    const styleReferences = references.slice(0, policy.maxInputReferences);
    return {
      extraBody: {
        input_references: styleReferences.map((url) => ({
          type: "image_url",
          image_url: { url },
        })),
      },
      mode: "style",
      referenceCount: styleReferences.length,
    };
  }

  return { extraBody: {}, mode: "none", referenceCount: 0 };
}

function videoFileName(): string {
  return `rift-video-${Date.now()}.mp4`;
}

export const createGenerateVideo = (
  context: ToolContext,
  origin = getProviderContext(),
  storageOrigin = captureGeneratedMediaStorageOrigin(),
) => {
  const { onToolCost } = context;

  return tool({
    description: `Generate one short, production-quality video through RIFT Media Studio.

Use only for requested video, animation or motion content. Current-turn image attachments are securely bound by the server; never request or invent their URLs. Choose referenceMode as documented below. Generation is asynchronous and may take several minutes.`,
    inputSchema: z.object({
      prompt: z
        .string()
        .min(8)
        .max(8_000)
        .describe(
          "Shot-ready video prompt: subject, action, environment, camera movement, lens, lighting, pacing, and continuity.",
        ),
      brief: z
        .string()
        .max(240)
        .optional()
        .describe(
          "One concise sentence describing the video generation, shown while it renders.",
        ),
      duration: VIDEO_DURATION_SCHEMA.optional(),
      aspectRatio: z.enum(VIDEO_ASPECT_RATIOS).optional(),
      resolution: z.enum(VIDEO_RESOLUTIONS).optional(),
      generateAudio: z
        .boolean()
        .optional()
        .describe(
          "Generate synchronized audio when the selected model supports it.",
        ),
      referenceMode: VIDEO_REFERENCE_MODE_SCHEMA.optional().describe(
        "first-frame animates the first attachment; first-last requires explicitly supplied start/end images; style uses attachments for identity and visual guidance.",
      ),
    }),
    execute: async (input: VideoToolInput, { abortSignal, toolCallId }) => {
      input = {
        ...input,
        ...context.studioSettings,
        ...(context.studioSettings?.audio !== undefined
          ? { generateAudio: context.studioSettings.audio }
          : {}),
      } as VideoToolInput;
      const progress = (stage: "preparing" | "generating" | "saving") =>
        context.writer?.write({
          type: "data-media-progress",
          data: { toolCallId, stage },
          transient: true,
        });
      progress("preparing");
      const apiKey = origin.openrouterApiKey;
      if (!apiKey) {
        return {
          ok: false as const,
          error: "Media Studio video generation is not configured.",
        };
      }
      if (!canPersistGeneratedMedia(storageOrigin)) {
        // Check storage before the billable provider call. A video is never
        // generated unless RIFT can immediately persist the finished bytes.
        return {
          ok: false as const,
          error:
            "Durable video storage is not configured. Configure Convex storage before generating a video.",
        };
      }

      const policy = getVideoModelPolicy(context.videoModel);
      if (!policy) {
        return {
          ok: false as const,
          error: "The selected video model is not available in Media Studio.",
        };
      }

      if (await isMediaPromptHardBlocked(input.prompt, origin)) {
        return {
          ok: false as const,
          error:
            "This request was blocked by the safety filter. Try a different description.",
        };
      }

      const settings = sanitizeVideoSettings(policy, input);
      const referencePlan = buildOpenRouterVideoReferencePlan(
        policy,
        context.mediaReferenceUrls,
        input.referenceMode,
      );
      const openrouter = createOpenRouter({
        apiKey,
        compatibility: "strict",
        headers: openrouterAttributionHeaders,
      });

      try {
        progress("generating");
        const result = await generateVideo({
          model: openrouter.videoModel(policy.model, {
            generateAudio: settings.generateAudio,
            pollIntervalMs: VIDEO_POLL_INTERVAL_MS,
            maxPollTimeMs: VIDEO_MAX_POLL_TIME_MS,
            extraBody: referencePlan.extraBody,
          }),
          prompt: input.prompt,
          duration: settings.duration,
          aspectRatio: settings.aspectRatio,
          // OpenRouter's video API expects normalized values such as "720p".
          // The provider forwards this provider option as `resolution`.
          providerOptions: {
            openrouter: { resolution: settings.resolution },
          },
          maxRetries: 1,
          abortSignal,
          download: createOpenRouterVideoDownload({
            apiKey,
            maxBytes: MAX_GENERATED_FILE_SIZE_BYTES,
          }),
        });

        const mediaType = result.video.mediaType || "video/mp4";
        if (!mediaType.startsWith("video/")) {
          return {
            ok: false as const,
            error: "The video provider returned an unsupported file type.",
          };
        }

        // OpenRouter reports the actual routed-provider charge after polling.
        // Only use the server-side per-second policy if metadata is absent.
        const providerCost = getProviderReportedCost(result.providerMetadata);
        const billedCost =
          providerCost ?? policy.costPerSecondUsd * settings.duration;
        onToolCost?.(billedCost);

        progress("saving");
        const stored = await persistGeneratedMediaBytes(
          {
            bytes: result.video.uint8Array,
            mediaType,
            name: videoFileName(),
            userId: context.userID,
            fileAccumulator: context.fileAccumulator,
            // Lineage: what this asset was made from (spec 24.5).
            generation: {
              prompt: input.prompt,
              model: policy.model,
              surface: "studio",
              settings: {
                duration: settings.duration,
                resolution: settings.resolution,
                aspectRatio: settings.aspectRatio,
              },
              costDollars: billedCost,
              runId: context.runRecorder?.runId,
            },
          },
          storageOrigin,
        );

        return {
          ok: true as const,
          ...stored,
          model: policy.model,
          settings: {
            ...settings,
            references: {
              mode: referencePlan.mode,
              count: referencePlan.referenceCount,
            },
          },
        };
      } catch (error) {
        if (
          abortSignal?.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          return {
            ok: false as const,
            error: "Video generation was cancelled.",
          };
        }
        console.error(
          "generate_video tool error",
          error instanceof Error ? error.message : "unknown error",
        );
        return {
          ok: false as const,
          error:
            "Video generation did not complete. No partial result was saved; try again or choose a faster model.",
        };
      }
    },
  });
};
