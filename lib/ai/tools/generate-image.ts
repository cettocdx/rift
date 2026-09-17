import { getProviderContext } from "@/lib/ai/provider-context";
import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "@/types";
import { openrouterAttributionHeaders } from "@/lib/ai/openrouter-attribution";
import { isMediaPromptHardBlocked } from "@/lib/ai/media-moderation";
import { sanitizeMediaReferenceUrls } from "@/lib/ai/media-references";
import {
  canPersistGeneratedMedia,
  captureGeneratedMediaStorageOrigin,
  persistGeneratedMediaBytes,
} from "@/lib/ai/tools/utils/generated-media-storage";
import {
  IMAGE_ASPECT_RATIOS,
  IMAGE_BACKGROUNDS,
  IMAGE_OUTPUT_FORMATS,
  IMAGE_RESOLUTIONS,
  getImageModelPolicy,
  type ImageAspectRatio,
  type ImageBackground,
  type ImageModelPolicy,
  type ImageOutputFormat,
  type ImageResolution,
} from "@/lib/ai/media-models";

const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images";
const IMAGE_REQUEST_TIMEOUT_MS = 3 * 60 * 1000;
/**
 * Transport guard only — the image goes straight to durable storage and the
 * transcript keeps a URL, never the bytes. Sized for the biggest legitimate
 * output: a 4K PNG from the Google image models. 6MB was measured too small in
 * production use — a 2K PNG of an ordinary campaign brief is ~6.5MB, so every
 * 2K/4K request failed as "no usable raster image".
 */
const MAX_INLINE_IMAGE_BYTES = 32 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type ImageToolInput = {
  prompt: string;
  /**
   * Label shown while the asset renders. Optional because it is
   * presentation only — never read by `execute` — and a model that
   * omitted it used to fail schema validation, killing the whole
   * generation over a caption. The UI already handles its absence.
   */
  brief?: string;
  aspectRatio?: ImageAspectRatio;
  resolution?: ImageResolution;
  outputFormat?: ImageOutputFormat;
  quality?: "auto" | "low" | "medium" | "high";
  background?: ImageBackground;
};

type OpenRouterImageResponse = {
  data?: Array<{ b64_json?: string; media_type?: string }>;
  usage?: { cost?: number };
  error?: { message?: string };
};

export type OpenRouterImageRequest = {
  model: string;
  prompt: string;
  n: 1;
  aspect_ratio?: ImageAspectRatio;
  resolution?: ImageResolution;
  output_format?: ImageOutputFormat;
  quality?: ImageToolInput["quality"];
  background?: ImageBackground;
  input_references?: Array<{
    type: "image_url";
    image_url: { url: string };
  }>;
};

function chooseSupported<T extends string>(
  requested: T | undefined,
  supported: readonly T[],
  fallback: T,
): T {
  return requested && supported.includes(requested) ? requested : fallback;
}

/** Builds a capability-safe request. Unsupported knobs never reach OpenRouter. */
export function buildOpenRouterImageRequest(
  policy: ImageModelPolicy,
  input: ImageToolInput,
  mediaReferenceUrls: readonly string[] = [],
): OpenRouterImageRequest {
  const supportedOutputFormats = policy.outputFormats;
  let outputFormat = supportedOutputFormats?.length
    ? chooseSupported(
        input.outputFormat,
        supportedOutputFormats,
        supportedOutputFormats[0],
      )
    : undefined;
  const supportedBackgrounds =
    policy.backgrounds ??
    (policy.supportsBackground ? IMAGE_BACKGROUNDS : undefined);
  let background = supportedBackgrounds?.length
    ? chooseSupported(
        input.background,
        supportedBackgrounds,
        supportedBackgrounds[0],
      )
    : undefined;

  // Transparent JPEG is invalid in the unified Images API. Preserve the
  // requested transparency by switching to an alpha-capable format.
  if (background === "transparent" && outputFormat === "jpeg") {
    outputFormat = "png";
  }

  const references = sanitizeMediaReferenceUrls(
    mediaReferenceUrls,
    policy.maxInputReferences,
  );

  return {
    model: policy.model,
    prompt: input.prompt,
    n: 1,
    ...(policy.supportsAspectRatio !== false
      ? {
          aspect_ratio: chooseSupported(
            input.aspectRatio,
            policy.aspectRatios,
            policy.aspectRatios.includes("auto")
              ? "auto"
              : policy.aspectRatios[0],
          ),
        }
      : {}),
    ...(policy.supportsResolution !== false
      ? {
          resolution: chooseSupported(
            input.resolution,
            policy.resolutions,
            policy.resolutions[0],
          ),
        }
      : {}),
    ...(outputFormat ? { output_format: outputFormat } : {}),
    ...(policy.supportsQuality ? { quality: input.quality ?? "high" } : {}),
    ...(background ? { background } : {}),
    ...(references.length > 0
      ? {
          input_references: references.map((url) => ({
            type: "image_url" as const,
            image_url: { url },
          })),
        }
      : {}),
  };
}

/** Providers are loose with subtype spelling; accept the common aliases. */
const MEDIA_TYPE_ALIASES: Readonly<Record<string, string>> = {
  "image/jpg": "image/jpeg",
  "image/x-png": "image/png",
};

export function extractOpenRouterImage(data: OpenRouterImageResponse): {
  base64: string;
  mediaType: string;
  providerCostUsd: number | null;
} | null {
  const image = data.data?.find((entry) => entry.b64_json);
  if (!image?.b64_json) {
    console.warn("generate_image: provider response carried no b64 image");
    return null;
  }

  const rawMediaType = image.media_type?.toLowerCase() ?? "image/png";
  const mediaType = MEDIA_TYPE_ALIASES[rawMediaType] ?? rawMediaType;
  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
    console.warn(
      `generate_image: rejected media type from provider: ${rawMediaType}`,
    );
    return null;
  }

  const byteLength = Buffer.byteLength(image.b64_json, "base64");
  if (byteLength <= 0 || byteLength > MAX_INLINE_IMAGE_BYTES) {
    console.warn(
      `generate_image: rejected image of ${byteLength} bytes (cap ${MAX_INLINE_IMAGE_BYTES})`,
    );
    return null;
  }

  const providerCost = data.usage?.cost;
  return {
    base64: image.b64_json,
    mediaType,
    providerCostUsd:
      typeof providerCost === "number" &&
      Number.isFinite(providerCost) &&
      providerCost >= 0
        ? providerCost
        : null,
  };
}

function createRequestSignal(parent?: AbortSignal): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) onAbort();
  else parent?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new Error("Image generation timed out")),
    IMAGE_REQUEST_TIMEOUT_MS,
  );
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

const IMAGE_EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export const createGenerateImage = (
  context: ToolContext,
  origin = getProviderContext(),
  storageOrigin = captureGeneratedMediaStorageOrigin(),
) => {
  const { onToolCost } = context;

  return tool({
    description: `Generate one professional image through RIFT Media Studio and render it inline.

Use for photos, illustrations, logos, icons, mockups, posters, product visuals, textures, and image edits. Images attached to the current user turn are already bound as secure edit/composition references; never request or invent their URLs. Expand terse requests into a precise production prompt. Choose an aspect ratio that matches the requested destination. The selected Media Studio model is enforced by the server; never put model names or prices in the prompt.`,
    inputSchema: z.object({
      prompt: z
        .string()
        .min(3)
        .max(8_000)
        .describe(
          "Detailed production prompt covering subject, composition, lighting, materials, color, mood, camera, and typography where relevant.",
        ),
      brief: z
        .string()
        .max(240)
        .optional()
        .describe(
          "One concise sentence describing the generation, shown while it renders.",
        ),
      aspectRatio: z.enum(IMAGE_ASPECT_RATIOS).optional(),
      resolution: z.enum(IMAGE_RESOLUTIONS).optional(),
      outputFormat: z.enum(IMAGE_OUTPUT_FORMATS).optional(),
      quality: z.enum(["auto", "low", "medium", "high"]).optional(),
      background: z.enum(IMAGE_BACKGROUNDS).optional(),
    }),
    execute: async (input: ImageToolInput, { abortSignal, toolCallId }) => {
      input = { ...input, ...context.studioSettings } as ImageToolInput;
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
          error: "Media Studio image generation is not configured.",
        };
      }

      const policy = getImageModelPolicy(context.imageModel);
      if (!policy) {
        return {
          ok: false as const,
          error: "The selected image model is not available in Media Studio.",
        };
      }

      // Provider output can be several megabytes. Refuse before a billable
      // request when durable storage is unavailable; a data URL is too large
      // for persisted messages and would disappear after refresh.
      if (!canPersistGeneratedMedia(storageOrigin)) {
        return {
          ok: false as const,
          error: "Media Studio storage is not configured on this server.",
        };
      }

      if (await isMediaPromptHardBlocked(input.prompt, origin)) {
        return {
          ok: false as const,
          error:
            "This request was blocked by the safety filter. Try a different description.",
        };
      }

      const request = buildOpenRouterImageRequest(
        policy,
        input,
        context.mediaReferenceUrls,
      );
      const requestSignal = createRequestSignal(abortSignal);

      try {
        progress("generating");
        const response = await fetch(OPENROUTER_IMAGES_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            ...openrouterAttributionHeaders,
          },
          body: JSON.stringify(request),
          signal: requestSignal.signal,
        });

        if (!response.ok) {
          // Consume the response for connection reuse but never expose provider
          // bodies; they can contain routing or account details.
          await response.text().catch(() => "");
          console.error("generate_image API error", response.status);
          const error =
            response.status === 402
              ? "Image credits are exhausted. Add credits and try again."
              : response.status === 429
                ? "Image generation is busy right now. Try again shortly."
                : response.status === 400
                  ? "The selected model could not use these image settings. Try a simpler request."
                  : `Image generation failed (${response.status}). Please try again.`;
          return { ok: false as const, error };
        }

        const data = (await response.json()) as OpenRouterImageResponse;
        const generated = extractOpenRouterImage(data);
        if (!generated) {
          return {
            ok: false as const,
            error: "The image provider returned no usable raster image.",
          };
        }

        const billedCost = generated.providerCostUsd ?? policy.fallbackCostUsd;
        onToolCost?.(billedCost);

        let stored: Awaited<ReturnType<typeof persistGeneratedMediaBytes>>;
        try {
          const extension =
            IMAGE_EXTENSION_BY_MEDIA_TYPE[generated.mediaType] ?? "png";
          progress("saving");
          stored = await persistGeneratedMediaBytes(
            {
              bytes: Buffer.from(generated.base64, "base64"),
              mediaType: generated.mediaType,
              name: `rift-image-${Date.now()}.${extension}`,
              userId: context.userID,
              fileAccumulator: context.fileAccumulator,
              // Lineage: what this asset was made from, so it is never an
              // anonymous blob (spec 24.5).
              generation: {
                prompt: input.prompt,
                model: policy.model,
                surface: "studio",
                settings: {
                  aspectRatio: input.aspectRatio,
                  resolution: input.resolution,
                },
                costDollars: billedCost,
                runId: context.runRecorder?.runId,
              },
            },
            storageOrigin,
          );
        } catch (storageError) {
          console.error(
            "generate_image: durable storage failed",
            storageError instanceof Error
              ? storageError.message
              : "unknown error",
          );
          return {
            ok: false as const,
            error:
              "The image was generated but could not be saved. Please try again.",
          };
        }

        return {
          ok: true as const,
          url: stored.url,
          mediaType: generated.mediaType,
          durable: true,
          fileId: stored.fileId,
          storageId: stored.storageId,
          name: stored.name,
          model: policy.model,
          settings: {
            aspectRatio: request.aspect_ratio,
            resolution: request.resolution,
            outputFormat: request.output_format,
            referenceCount: request.input_references?.length ?? 0,
          },
        };
      } catch (error) {
        if (
          requestSignal.signal.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          return {
            ok: false as const,
            error: abortSignal?.aborted
              ? "Image generation was cancelled."
              : "Image generation timed out. Please try again.",
          };
        }
        console.error(
          "generate_image tool error",
          error instanceof Error ? error.message : "unknown error",
        );
        return {
          ok: false as const,
          error: "Something went wrong generating the image. Please try again.",
        };
      } finally {
        requestSignal.cleanup();
      }
    },
  });
};
