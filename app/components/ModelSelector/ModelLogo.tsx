"use client";

import {
  Alibaba,
  ByteDance,
  Claude,
  Flux,
  Gemini,
  Google,
  Grok,
  Hailuo,
  Hunyuan,
  Kimi,
  Kling,
  OpenAI,
  Qwen,
  Runway,
  Sora,
  ZAI,
} from "@lobehub/icons";
import type { BuildModel, SelectedModel } from "@/types/chat";

// Use the library's original SVG artwork and its embedded brand colors.
// Monochrome marks use black/white, independent of the workspace accent.
const BRAND_MARKS = {
  OpenAI,
  Claude: Claude.Color,
  Grok,
  Kimi: Kimi.Color,
  Qwen: Qwen.Color,
  GLM: ZAI,
  Hunyuan: Hunyuan.Color,
  Gemini: Gemini.Color,
  Google: Google.Color,
  ByteDance: ByteDance.Color,
  Flux,
  Kling: Kling.Color,
  Sora: Sora.Color,
  Runway,
  Alibaba: Alibaba.Color,
  Hailuo: Hailuo.Color,
};

type Brand = keyof typeof BRAND_MARKS;
type MediaModelId = Extract<
  SelectedModel,
  `image-${string}` | `video-${string}`
>;

const MEDIA_BRANDS: Record<MediaModelId, Brand> = {
  "image-lite": "Gemini",
  "image-gemini": "Gemini",
  "image-gemini-pro": "Gemini",
  "image-seedream": "ByteDance",
  "image-flux": "Flux",
  "image-grok": "Grok",
  "image-gpt": "OpenAI",
  "image-qwen": "Qwen",
  "video-veo-fast": "Google",
  "video-veo": "Google",
  "video-kling": "Kling",
  "video-seedance": "ByteDance",
  "video-grok": "Grok",
  "video-sora": "Sora",
  "video-runway": "Runway",
  "video-wan": "Alibaba",
  "video-hailuo": "Hailuo",
};

function ModelLogo({ brand, size = 17 }: { brand: Brand; size?: number }) {
  const Mark = BRAND_MARKS[brand];
  return (
    <span className="rift-model-mark" data-brand={brand} aria-hidden="true">
      <Mark size={size} />
    </span>
  );
}

export function BuildModelLogo({
  family,
  size,
}: {
  family: BuildModel["family"];
  size?: number;
}) {
  return <ModelLogo brand={family} size={size} />;
}

export function MediaModelLogo({
  model,
  size,
}: {
  model: MediaModelId;
  size?: number;
}) {
  return <ModelLogo brand={MEDIA_BRANDS[model]} size={size} />;
}
