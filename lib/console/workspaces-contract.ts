import { z } from "zod";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/types/chat";
import {
  getImageModelPolicy,
  getVideoModelPolicy,
} from "@/lib/ai/media-models";
import {
  STUDIO_PATTERNS,
  STUDIO_PATTERN_CATEGORIES,
} from "@/lib/ai/studio-patterns";
import { HACK_TASK_GROUPS } from "@/lib/hack/task-catalog";

export const workspaceSchema = z.enum(["studio", "hack"]);
export const identitySchema = z.object({
  workspace: workspaceSchema,
  chatId: z.string().uuid(),
});
export const settingsSchema = z
  .object({
    aspectRatio: z.string().max(16).optional(),
    resolution: z.string().max(16).optional(),
    outputFormat: z.string().max(16).optional(),
    quality: z.enum(["auto", "low", "medium", "high"]).optional(),
    background: z.string().max(32).optional(),
    duration: z.number().int().positive().optional(),
    audio: z.boolean().optional(),
    referenceMode: z.enum(["first-frame", "first-last", "style"]).optional(),
  })
  .strict();
export type StudioSettings = z.infer<typeof settingsSchema>;
export class StudioSettingsError extends Error {}
export const startSchema = identitySchema
  .extend({
    operationId: z.string().uuid(),
    prompt: z.string().trim().min(1).max(16000),
    permission: z.enum(["ask", "auto"]).default("ask"),
    model: z.string().max(80).optional(),
    settings: settingsSchema.optional(),
    referenceFileIds: z.array(z.string().min(1).max(128)).max(16).default([]),
    target: z.string().trim().max(2048).optional(),
    scope: z.string().trim().max(8000).optional(),
    sandboxPreference: z.string().min(1).max(128).optional(),
    taskId: z.string().max(80).optional(),
  })
  .strict();
export function workspaceCapabilities() {
  return {
    version: 1,
    studio: {
      models: [
        ...IMAGE_MODELS.map(({ id, name, desc, model }) => {
          const policy = getImageModelPolicy(model)!;
          return {
            id,
            name,
            description: desc,
            kind: "image" as const,
            controls: {
              aspectRatio:
                policy.supportsAspectRatio === false ? [] : policy.aspectRatios,
              resolution:
                policy.supportsResolution === false ? [] : policy.resolutions,
              outputFormat: policy.outputFormats ?? [],
              quality: policy.supportsQuality
                ? ["auto", "low", "medium", "high"]
                : [],
              background: policy.supportsBackground
                ? (policy.backgrounds ?? ["auto", "transparent", "opaque"])
                : [],
              maxInputReferences: policy.maxInputReferences,
            },
          };
        }),
        ...VIDEO_MODELS.map(({ id, name, desc, model }) => {
          const policy = getVideoModelPolicy(model)!;
          return {
            id,
            name,
            description: desc,
            kind: "video" as const,
            controls: {
              aspectRatio: policy.aspectRatios,
              resolution: policy.resolutions,
              duration: policy.durations,
              audio: policy.supportsAudio ? [false, true] : [],
              referenceMode: [
                ...(policy.supportedFrameImages.includes("first_frame")
                  ? ["first-frame"]
                  : []),
                ...(policy.supportedFrameImages.includes("last_frame")
                  ? ["first-last"]
                  : []),
                ...(policy.maxInputReferences > 0 ? ["style"] : []),
              ],
              maxInputReferences: Math.max(
                policy.maxInputReferences,
                policy.supportedFrameImages.length,
              ),
              frameTypes: policy.supportedFrameImages,
            },
          };
        }),
      ],
      patterns: STUDIO_PATTERNS,
      categories: STUDIO_PATTERN_CATEGORIES,
    },
    hack: { model: "build-grok", groups: HACK_TASK_GROUPS },
    permissions: ["ask", "auto"],
  };
}
export function validateStudioSettings(
  modelId: string,
  settings: StudioSettings = {},
  references = 0,
) {
  const model = workspaceCapabilities().studio.models.find(
    (item) => item.id === modelId,
  );
  if (!model)
    throw new StudioSettingsError("Select an available Studio model.");
  const controls = model.controls as Record<string, unknown>;
  for (const [key, value] of Object.entries(settings)) {
    const allowed = controls[key];
    if (!Array.isArray(allowed) || !allowed.includes(value))
      throw new StudioSettingsError(
        `The selected model does not support ${key}=${String(value)}.`,
      );
  }
  if (references > model.controls.maxInputReferences)
    throw new StudioSettingsError("Too many reference images for this model.");
  return model;
}
