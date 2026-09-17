import { UIMessage } from "ai";
import { z } from "zod";
import { Id } from "@/convex/_generated/dataModel";
import type { FileDetails, FilePart } from "./file";

export type ChatMode = "agent" | "ask";

export const CHAT_MODES: readonly ChatMode[] = ["agent", "ask"];

export function isChatMode(value: string | null): value is ChatMode {
  return value !== null && (CHAT_MODES as readonly string[]).includes(value);
}

/**
 * What the agent is FOR — orthogonal to {@link ChatMode} (which is the
 * execution-path selector: long Trigger worker vs fast ask). `security` is the
 * original offensive-security agent. `app` is the Claude-Code-style builder
 * (web apps / browser games) — same runtime, but a different system prompt and
 * a stronger codegen model. `image` is the image/photo generator — a fast
 * single-tool flow (Grok + `generate_image`). Stored on the chat row; defaults
 * to `security`.
 */
export type ChatPurpose = "security" | "app" | "image";

/**
 * Client-visible project binding for a new or rehydrated chat. The server never
 * trusts this object: it resolves the project again against the authenticated
 * owner before persistence or sandbox/tool initialization.
 */
export interface ActiveProjectContext {
  id: Id<"projects">;
  type: ChatPurpose;
  name?: string;
}

export const CHAT_PURPOSES: readonly ChatPurpose[] = [
  "security",
  "app",
  "image",
];

export function isChatPurpose(value: string | null): value is ChatPurpose {
  return value !== null && (CHAT_PURPOSES as readonly string[]).includes(value);
}

/** Narrow any stored value to a ChatPurpose, defaulting to "security". */
export function coerceChatPurpose(
  value: string | null | undefined,
): ChatPurpose {
  return value === "app" || value === "image" ? value : "security";
}

export type SelectedModel =
  | "auto"
  | "rift-standard"
  | "rift-pro"
  | "rift-max"
  // Build-mode (app builder) picker selections. Orthogonal to the generic
  // tiers above; only meaningful when purpose === "app".
  | "build-fast"
  | "build-balanced"
  | "build-astra"
  | "build-gemini"
  | "build-codex"
  | "build-sol-pro"
  | "build-max"
  | "build-glm"
  | "build-hunyuan"
  | "build-grok"
  | "build-deepseek"
  | "build-kimi"
  | "build-qwen"
  | "build-opus46"
  | "build-fable"
  // Media Studio picker selections. Only meaningful when purpose === "image";
  // image-* routes to generate_image and video-* routes to generate_video.
  | "image-lite"
  | "image-gemini"
  | "image-gemini-pro"
  | "image-seedream"
  | "image-flux"
  | "image-grok"
  | "image-gpt"
  | "image-qwen"
  | "video-veo-fast"
  | "video-veo"
  | "video-kling"
  | "video-seedance"
  | "video-grok"
  | "video-sora"
  | "video-runway"
  | "video-wan"
  | "video-hailuo";

export const SELECTABLE_MODELS: readonly SelectedModel[] = [
  "auto",
  "rift-standard",
  "rift-pro",
  "rift-max",
  "build-codex",
  "build-astra",
  "build-gemini",
  "build-max",
  "build-glm",
  "build-hunyuan",
  "build-grok",
  "build-deepseek",
  "build-kimi",
  "build-qwen",
  "build-opus46",
  "build-fable",
  "image-lite",
  "image-gemini",
  "image-gemini-pro",
  "image-seedream",
  "image-flux",
  "image-grok",
  "image-gpt",
  "image-qwen",
  "video-veo-fast",
  "video-veo",
  "video-kling",
  "video-seedance",
  "video-grok",
  "video-sora",
  "video-runway",
  "video-wan",
  "video-hailuo",
];

/**
 * Media Studio image options. Model ids are a product allowlist, not arbitrary
 * client input. The generation tool maintains its own server-side capability
 * and billing policy and prefers OpenRouter's returned `usage.cost`.
 */
export const IMAGE_MODELS: ReadonlyArray<{
  id: Extract<SelectedModel, `image-${string}`>;
  name: string;
  desc: string;
  model: string;
  badge: string;
}> = [
  {
    id: "image-lite",
    name: "Nano Banana 2 Lite",
    desc: "Fast drafts and iterations",
    model: "google/gemini-3.1-flash-lite-image",
    badge: "Fast",
  },
  {
    id: "image-gemini",
    name: "Nano Banana 2",
    desc: "Best everyday image model",
    model: "google/gemini-3.1-flash-image",
    badge: "Default",
  },
  {
    id: "image-gemini-pro",
    name: "Gemini 3 Pro Image",
    desc: "Premium composition and prompt fidelity",
    model: "google/gemini-3-pro-image",
    badge: "Premium",
  },
  {
    id: "image-seedream",
    name: "Seedream 5.0 Pro",
    desc: "Commercial retouching and precise edit control",
    model: "bytedance-seed/seedream-5-0-pro",
    badge: "Creative",
  },
  {
    id: "image-flux",
    name: "FLUX.2 Max",
    desc: "Top-tier prompt fidelity and editing consistency",
    model: "black-forest-labs/flux.2-max",
    badge: "Max",
  },
  {
    id: "image-grok",
    name: "Grok Imagine 2.0",
    desc: "Photorealism and clean text",
    model: "x-ai/grok-imagine-image-2.0",
    badge: "Photo",
  },
  {
    id: "image-gpt",
    name: "GPT Image 2",
    desc: "Highest-fidelity generation and edits",
    model: "openai/gpt-image-2",
    badge: "Max",
  },
  {
    // Already in the server allowlist (lib/ai/media-models.ts) and, until now,
    // in no picker — the policy shipped ahead of the roster entry.
    id: "image-qwen",
    name: "Qwen Image 3 Pro",
    desc: "Type and fine detail down to 10px",
    model: "qwen/qwen-image-3-pro",
    badge: "Creative",
  },
];

/** Video options use OpenRouter's asynchronous /videos API. */
export const VIDEO_MODELS: ReadonlyArray<{
  id: Extract<SelectedModel, `video-${string}`>;
  name: string;
  desc: string;
  model: string;
  badge: string;
}> = [
  {
    id: "video-veo-fast",
    name: "Veo 3.1 Fast",
    desc: "Cinematic video with audio",
    model: "google/veo-3.1-fast",
    badge: "Default",
  },
  {
    id: "video-veo",
    name: "Veo 3.1",
    desc: "Maximum cinematic quality",
    model: "google/veo-3.1",
    badge: "Max",
  },
  {
    id: "video-kling",
    name: "Kling 3.0 Pro",
    desc: "Controlled motion and characters",
    model: "kwaivgi/kling-v3.0-pro",
    badge: "Motion",
  },
  {
    id: "video-seedance",
    name: "Seedance 2.5",
    desc: "Expressive social and ad clips",
    model: "bytedance/seedance-2.5",
    badge: "Creative",
  },
  {
    id: "video-grok",
    name: "Grok Imagine Video 1.5",
    desc: "Fast visual experiments",
    model: "x-ai/grok-imagine-video-1.5",
    badge: "Fast",
  },
  {
    id: "video-sora",
    name: "Sora 2 Pro",
    desc: "Physics-accurate motion with synchronized audio",
    model: "openai/sora-2-pro",
    badge: "Max",
  },
  {
    id: "video-runway",
    name: "Runway Gen-4.5",
    desc: "Cinematic scenes from text or a still",
    model: "runway/gen-4.5",
    badge: "Motion",
  },
  {
    id: "video-wan",
    name: "Wan 3.0",
    desc: "Long takes, reference-guided",
    model: "alibaba/wan-3.0",
    badge: "Creative",
  },
  {
    id: "video-hailuo",
    name: "Hailuo 3",
    desc: "Controlled edits at 2K",
    model: "minimax/hailuo-3",
    badge: "Premium",
  },
];

export const MEDIA_MODELS = [...IMAGE_MODELS, ...VIDEO_MODELS] as const;

export type MediaModelKind = "image" | "video";

/** Default image model when none is picked (matches generate_image's default). */
export const DEFAULT_IMAGE_MODEL: SelectedModel = "image-gemini";
export const DEFAULT_VIDEO_MODEL: SelectedModel = "video-veo-fast";

/** Resolve a validated Media Studio selection to its generation model. */
export function resolveMediaModel(
  selectedModel?: string | null,
): { kind: MediaModelKind; model: string } | null {
  const image = IMAGE_MODELS.find((m) => m.id === selectedModel);
  if (image) return { kind: "image", model: image.model };
  const video = VIDEO_MODELS.find((m) => m.id === selectedModel);
  return video ? { kind: "video", model: video.model } : null;
}

/**
 * Keep Media Studio's selected model and execution path in lockstep. Video
 * generation can outlive the request route, so it must always use the durable
 * Agent worker; image generation stays on the shorter Ask path.
 */
export function resolveChatModeForPurpose({
  purpose,
  selectedModel,
  fallbackMode,
}: {
  purpose: ChatPurpose;
  selectedModel?: string | null;
  fallbackMode: ChatMode;
}): ChatMode {
  if (purpose !== "image") return fallbackMode;
  return resolveMediaModel(selectedModel)?.kind === "video" ? "agent" : "ask";
}

/** Resolve an image-* selection, rejecting video and arbitrary model ids. */
export function resolveImageModel(
  selectedModel?: string | null,
): { model: string } | null {
  const entry = IMAGE_MODELS.find((m) => m.id === selectedModel);
  return entry ? { model: entry.model } : null;
}

/** Resolve a video-* selection, rejecting image and arbitrary model ids. */
export function resolveVideoModel(
  selectedModel?: string | null,
): { model: string } | null {
  const entry = VIDEO_MODELS.find((m) => m.id === selectedModel);
  return entry ? { model: entry.model } : null;
}

/**
 * The model options shown in the Build-mode picker. `id` is stored in
 * `selectedModel`; the backend maps it to an OpenRouter model in `selectModel`.
 * Curated to current frontier models. Legacy build ids remain valid for
 * existing chats, but are intentionally not shown here.
 */
export type BuildModelCapability = "reasoning" | "tools" | "vision" | "files";

export const REASONING_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export const REASONING_TOGGLE_VALUES = ["off", "on"] as const;

export type ReasoningEffort =
  | (typeof REASONING_EFFORTS)[number]
  | (typeof REASONING_TOGGLE_VALUES)[number];

export const REASONING_EFFORT_LABELS: Readonly<
  Record<ReasoningEffort, string>
> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
  off: "Off",
  on: "On",
};

export interface BuildModelReasoningDefinition {
  /** Values advertised by the selected OpenRouter endpoint. */
  supportedEfforts: readonly ReasoningEffort[];
  defaultEffort: ReasoningEffort;
  /** Qualitative effort by default; toggle endpoints accept enabled only. */
  control?: "effort" | "toggle";
  /** The endpoint cannot be called with reasoning disabled. */
  mandatory?: boolean;
}

export interface BuildModelDefinition {
  id: Extract<SelectedModel, `build-${string}`>;
  label: string;
  model: string;
  family:
    | "OpenAI"
    | "Claude"
    | "Grok"
    | "Kimi"
    | "Qwen"
    | "GLM"
    | "Hunyuan"
    | "Gemini";
  provider:
    | "OpenAI"
    | "Anthropic"
    | "xAI"
    | "MoonshotAI"
    | "Alibaba"
    | "Z.ai"
    | "Tencent"
    | "Google";
  providerKey: `model-${string}`;
  providerModel: string;
  desc: string;
  contextTokens: number;
  /** Gateway max_prompt_tokens, verified 2026-09-08; see docs/runtime/model-context-capacity.md. */
  maxInputTokens?: number;
  capabilities: readonly BuildModelCapability[];
  reasoning: BuildModelReasoningDefinition;
  aliases: readonly string[];
}

export const BUILD_MODELS = [
  {
    id: "build-codex",
    label: "Default",
    model: "GPT-5.6 Sol",
    family: "OpenAI",
    provider: "OpenAI",
    providerKey: "model-gpt-5.6-sol",
    providerModel: "openai/gpt-5.6-sol",
    desc: "Proven RIFT coding route",
    contextTokens: 1_050_000,
    maxInputTokens: 922_000,
    capabilities: ["reasoning", "tools", "vision", "files"],
    reasoning: {
      supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: "medium",
    },
    aliases: ["sol", "codex", "default", "gpt-5.6-sol"],
  },
  {
    id: "build-astra",
    label: "Frontier",
    model: "GPT-6 Astra",
    family: "OpenAI",
    provider: "OpenAI",
    providerKey: "model-gpt-6-astra",
    providerModel: "openai/gpt-6-astra",
    desc: "Advanced reasoning and complex builds",
    contextTokens: 1_050_000,
    maxInputTokens: 922_000,
    capabilities: ["reasoning", "tools", "vision", "files"],
    reasoning: {
      supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: "medium",
      mandatory: true,
    },
    aliases: ["astra", "gpt-6-astra", "maximum"],
  },
  {
    id: "build-gemini",
    label: "Multimodal",
    model: "Gemini 3.8 Flash",
    family: "Gemini",
    provider: "Google",
    providerKey: "model-gemini-3.8-flash",
    providerModel: "google/gemini-3.8-flash",
    desc: "Google's latest reasoning and coding model",
    contextTokens: 1_048_576,
    capabilities: ["reasoning", "tools", "vision", "files"],
    reasoning: {
      supportedEfforts: ["low", "medium", "high"],
      defaultEffort: "medium",
      mandatory: true,
    },
    aliases: ["gemini", "gemini-3.8-flash", "google", "fast"],
  },
  {
    id: "build-max",
    label: "Deep reasoning",
    model: "Claude Opus 5",
    family: "Claude",
    provider: "Anthropic",
    providerKey: "model-opus-5",
    providerModel: "anthropic/claude-opus-5",
    desc: "Complex architecture and review",
    contextTokens: 1_000_000,
    capabilities: ["reasoning", "tools", "vision", "files"],
    reasoning: {
      supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: "medium",
    },
    aliases: ["opus", "claude-opus", "opus-5", "opus-4.8"],
  },
  {
    id: "build-fable",
    label: "Product work",
    model: "Claude Fable 5.1",
    family: "Claude",
    provider: "Anthropic",
    providerKey: "model-fable-5.1",
    providerModel: "anthropic/claude-fable-5.1",
    desc: "Advanced implementation and product work",
    contextTokens: 1_000_000,
    capabilities: ["reasoning", "tools", "vision", "files"],
    reasoning: {
      supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: "high",
      mandatory: true,
    },
    aliases: ["claude", "fable", "claude-fable", "fable-5.1"],
  },
  {
    id: "build-grok",
    label: "Long context",
    model: "Grok 4.6",
    family: "Grok",
    provider: "xAI",
    providerKey: "model-grok-4.6",
    providerModel: "x-ai/grok-4.6",
    desc: "Frontier reasoning through OpenRouter",
    contextTokens: 500_000,
    capabilities: ["reasoning", "tools", "vision", "files"],
    reasoning: {
      supportedEfforts: ["low", "medium", "high"],
      defaultEffort: "high",
      mandatory: true,
    },
    aliases: ["grok", "grok-4.6", "grok-4.5"],
  },
  {
    id: "build-kimi",
    label: "Kimi K3",
    model: "Kimi K3",
    family: "Kimi",
    provider: "MoonshotAI",
    providerKey: "model-kimi-k3",
    providerModel: "moonshotai/kimi-k3",
    desc: "Moonshot's flagship multimodal reasoning model",
    contextTokens: 1_048_576,
    capabilities: ["reasoning", "tools", "vision"],
    reasoning: {
      supportedEfforts: ["low", "high", "max"],
      defaultEffort: "max",
    },
    aliases: ["kimi", "k3", "kimi-k3", "kimi-latest"],
  },
  {
    id: "build-qwen",
    label: "Qwen3.8 Max",
    model: "Qwen3.8 Max",
    family: "Qwen",
    provider: "Alibaba",
    providerKey: "model-qwen3.8-max",
    providerModel: "qwen/qwen3.8-max",
    desc: "Alibaba's latest flagship agent model",
    contextTokens: 1_000_000,
    maxInputTokens: 983_616,
    capabilities: ["reasoning", "tools"],
    reasoning: {
      supportedEfforts: ["off", "on"],
      defaultEffort: "on",
      control: "toggle",
    },
    aliases: ["qwen", "qwen-max", "qwen3.8", "qwen3.8-max", "qwen3.7-max"],
  },
  {
    id: "build-glm",
    label: "GLM 5.3",
    model: "GLM 5.3",
    family: "GLM",
    provider: "Z.ai",
    providerKey: "model-glm-5.3",
    providerModel: "z-ai/glm-5.3",
    desc: "Z.ai's flagship open reasoning and coding model",
    contextTokens: 1_048_576,
    capabilities: ["reasoning", "tools", "vision"],
    reasoning: {
      supportedEfforts: ["off", "on"],
      defaultEffort: "on",
      control: "toggle",
    },
    // 5.2 stays in the alias list: it is what people have typed for months and
    // what saved slash commands still say.
    aliases: ["glm", "glm-5.3", "glm-5.2", "zai", "z-ai"],
  },
  {
    id: "build-hunyuan",
    label: "Open weights",
    model: "Hy4 preview",
    family: "Hunyuan",
    provider: "Tencent",
    providerKey: "model-hy4-preview",
    providerModel: "tencent/hy4-preview",
    desc: "Tencent's open 770B mixture-of-experts, 1M context",
    contextTokens: 1_048_576,
    capabilities: ["reasoning", "tools"],
    reasoning: {
      supportedEfforts: ["off", "on"],
      defaultEffort: "on",
      control: "toggle",
    },
    aliases: ["hunyuan", "hy4", "hy4-preview", "tencent"],
  },
] as const satisfies ReadonlyArray<BuildModelDefinition>;

export type BuildModel = (typeof BUILD_MODELS)[number];
export type BuildModelId = BuildModel["id"];

/** Compact context label shared by every Build model picker surface. */
export function formatBuildModelContext(contextTokens: number): string {
  if (contextTokens >= 1_000_000) {
    const millions = Number((contextTokens / 1_000_000).toFixed(2));
    return `${millions}M context`;
  }
  return `${Math.round(contextTokens / 1_000)}K context`;
}

/** The Build picker's default: the model proven by successful RIFT runs. */
export const DEFAULT_BUILD_MODEL: BuildModelId = "build-codex";

export function findBuildModel(value: unknown): BuildModel | undefined {
  return BUILD_MODELS.find((model) => model.id === value);
}

/** Resolve either a picker id, provider registry key, or OpenRouter slug. */
export function findBuildModelByRuntimeValue(
  value: unknown,
): BuildModel | undefined {
  if (typeof value !== "string") return undefined;
  const selected = coerceSelectedModel(value) ?? value;
  return BUILD_MODELS.find(
    (model) =>
      model.id === selected ||
      model.providerKey === value ||
      model.providerModel === value,
  );
}

/**
 * Resolve stale, cross-purpose, or `auto` selections to the real Build default
 * so the titlebar and composer always describe the same runtime route.
 */
export function getEffectiveBuildModel(value: unknown): BuildModel {
  return (
    findBuildModelByRuntimeValue(value) ??
    BUILD_MODELS.find((model) => model.id === DEFAULT_BUILD_MODEL)!
  );
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return (
    typeof value === "string" &&
    (
      [...REASONING_EFFORTS, ...REASONING_TOGGLE_VALUES] as readonly string[]
    ).includes(value)
  );
}

export function isBuildReasoningEffortSupported(
  modelValue: unknown,
  effort: unknown,
): effort is ReasoningEffort {
  if (!isReasoningEffort(effort)) return false;
  const supportedEfforts = getEffectiveBuildModel(modelValue).reasoning
    .supportedEfforts as readonly ReasoningEffort[];
  return supportedEfforts.includes(effort);
}

/**
 * Clamp untrusted or stale reasoning state to the selected model's declared
 * default. This helper is shared by browser hydration and both server paths.
 */
export function resolveBuildReasoningEffort(
  modelValue: unknown,
  requestedEffort: unknown,
): ReasoningEffort {
  const model = getEffectiveBuildModel(modelValue);
  const supportedEfforts = model.reasoning
    .supportedEfforts as readonly ReasoningEffort[];
  return isReasoningEffort(requestedEffort) &&
    supportedEfforts.includes(requestedEffort)
    ? requestedEffort
    : model.reasoning.defaultEffort;
}

/** Parse the public command vocabulary without conflating model and effort. */
export function parseReasoningEffort(value: string): ReasoningEffort | null {
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, " ");
  if (normalized === "extra high" || normalized === "x high") return "xhigh";
  if (normalized === "maximum") return "max";
  const compact = normalized.replace(/\s+/g, "");
  return isReasoningEffort(compact) ? compact : null;
}

/**
 * Map of legacy ids to the current `SelectedModel` union. Covers two prior
 * shapes:
 *   1. Underlying-model ids from before the RIFT tier rebrand.
 *   2. `rift-lite` from the short-lived first naming of the entry tier
 *      (renamed to `rift-standard` because Lite mis-described Kimi K2.6).
 * Used by `coerceSelectedModel` to migrate values on read.
 */
export const LEGACY_MODEL_ID_MAP: Record<string, SelectedModel> = {
  "build-sol-pro": "build-astra",
  "build-fast": "build-codex",
  "build-balanced": "build-fable",
  "sonnet-4.6": "rift-pro",
  "opus-4.6": "rift-max",
  "gemini-3-flash": "rift-standard",
  "kimi-k2.6": "rift-standard",
  // Grok was removed from the picker before the tier rebrand. Both variants
  // were entry-level alternatives to the auto router (Gemini/Kimi territory),
  // so map them to Standard rather than dropping the user's preference.
  "grok-4.1": "rift-standard",
  "grok-4.3": "rift-standard",
  "rift-lite": "rift-standard",
  // The old Gemini 2.5 "Nano Banana" picker entry is upgraded to the current
  // low-latency Gemini 3.1 image model when an existing chat is reopened.
  "image-nano": "image-lite",
};

/**
 * Coerce any stored selected-model string into the current `SelectedModel`
 * union. Returns `null` if the value isn't recognized (caller should fall
 * back to "auto").
 */
export function coerceSelectedModel(value: unknown): SelectedModel | null {
  if (typeof value !== "string") return null;
  if ((SELECTABLE_MODELS as readonly string[]).includes(value)) {
    return value as SelectedModel;
  }
  // Use Object.hasOwn (not the `in` operator) to avoid matching inherited
  // properties like "toString" or "constructor" if a hostile/garbage value
  // ever reaches this function via localStorage or the request body.
  if (Object.hasOwn(LEGACY_MODEL_ID_MAP, value)) {
    return LEGACY_MODEL_ID_MAP[value];
  }
  return null;
}

export function isSelectedModel(value: string | null): value is SelectedModel {
  return (
    value !== null && (SELECTABLE_MODELS as readonly string[]).includes(value)
  );
}

export type SubscriptionTier = "free" | "pro" | "pro-plus" | "ultra" | "team";

export const SUBSCRIPTION_TIERS: readonly SubscriptionTier[] = [
  "free",
  "pro",
  "pro-plus",
  "ultra",
  "team",
];

export function isSubscriptionTier(value: unknown): value is SubscriptionTier {
  return (
    typeof value === "string" &&
    (SUBSCRIPTION_TIERS as readonly string[]).includes(value)
  );
}

export interface SidebarFile {
  path: string;
  content: string;
  language?: string;
  range?: {
    start: number;
    end?: number;
  };
  action?:
    | "viewing"
    | "reading"
    | "creating"
    | "editing"
    | "writing"
    | "searching"
    | "appending";
  toolCallId?: string;
  /** Whether the file operation is currently executing */
  isExecuting?: boolean;
  /** Original content before edit (for diff view) */
  originalContent?: string;
  /** Modified content after edit (for diff view) */
  modifiedContent?: string;
  /** A confirmed edit whose prior content is unknown; do not infer additions. */
  diffUnavailable?: boolean;
  /** Error message if the operation failed */
  error?: string;
  /** Media type for viewed multimodal files */
  mediaType?: string;
  /** File size for viewed multimodal files */
  sizeBytes?: number;
  /** File kind for viewed multimodal files */
  kind?: "image" | "pdf";
  /** Display filename returned by the file tool */
  filename?: string;
  /** Preview images for viewed images/PDF pages */
  previewFiles?: Array<FilePart & { page?: number }>;
  /** PDF pages rendered for this view action */
  renderedPages?: number[];
  /** Maximum PDF pages rendered for this view action */
  renderedPageLimit?: number;
  /** Whether the PDF view was truncated to the render limit */
  truncatedPages?: boolean;
  /** Total PDF page count when known */
  pageCount?: number;
  /** Non-fatal preview upload/render error */
  previewError?: string;
}

export interface SidebarTerminal {
  command: string;
  output: string;
  isExecuting: boolean;
  /** Observed tool-envelope outcome, shared with the transcript. */
  toolOutcome?: import("@/lib/chat/transcript-presentation").TranscriptToolStatus;
  isBackground?: boolean;
  /** Legacy run_terminal_cmd: input.interactive — true if PTY-backed session. */
  isInteractive?: boolean;
  /** E2B process ID (only for E2B sandboxes). */
  pid?: number | null;
  /** Local session identifier (only for local sandboxes). */
  session?: string | null;
  toolCallId: string;
  shellAction?: string;
  /** The raw input sent via the `send` action — string or array of tokens. */
  input?: string | string[];
  /** Raw PTY bytes for xterm.js rendering (preserves colors and cursor sequences). */
  rawBytes?: string;
}

export interface SidebarProxy {
  /** The proxy tool name, e.g. "list_requests", "send_request" */
  proxyAction: string;
  command: string;
  output: string;
  isExecuting: boolean;
  toolCallId: string;
}

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
  date: string | null;
  lastUpdated: string | null;
}

export interface SidebarWebSearch {
  query: string;
  results: WebSearchResult[];
  isSearching: boolean;
  toolCallId: string;
}

export const VALID_NOTE_CATEGORIES = [
  "general",
  "findings",
  "methodology",
  "questions",
  "plan",
] as const;

export type NoteCategory = (typeof VALID_NOTE_CATEGORIES)[number];

export interface SidebarNote {
  note_id: string;
  title: string;
  content: string;
  category: NoteCategory;
  tags: string[];
  updated_at: number;
}

export interface SidebarNotes {
  action: "create" | "list" | "update" | "delete";
  notes: SidebarNote[];
  totalCount: number;
  isExecuting: boolean;
  toolCallId: string;
  /** For create/update/delete - the affected note title */
  affectedTitle?: string;
  /** For create - the new note ID */
  newNoteId?: string;
  /** For update - original note data before update (for before/after comparison) */
  original?: {
    title: string;
    content: string;
    category: string;
    tags: string[];
  };
  /** For update - modified note data after update (for before/after comparison) */
  modified?: {
    title: string;
    content: string;
    category: string;
    tags: string[];
  };
}

export interface SidebarSharedFiles {
  files: Array<{
    name: string;
    mediaType?: string;
    fileId?: string;
    s3Key?: string;
    storageId?: string;
  }>;
  requestedPaths: string[];
  isExecuting: boolean;
  toolCallId: string;
}

export type SidebarContent =
  | SidebarFile
  | SidebarTerminal
  | SidebarProxy
  | SidebarWebSearch
  | SidebarNotes
  | SidebarSharedFiles;

export const isSidebarFile = (
  content: SidebarContent,
): content is SidebarFile => {
  return "path" in content && !("requestedPaths" in content);
};

export const isSidebarTerminal = (
  content: SidebarContent,
): content is SidebarTerminal => {
  return "command" in content && !("proxyAction" in content);
};

export const isSidebarProxy = (
  content: SidebarContent,
): content is SidebarProxy => {
  return "proxyAction" in content;
};

export const isSidebarWebSearch = (
  content: SidebarContent,
): content is SidebarWebSearch => {
  return "results" in content && "query" in content;
};

export const isSidebarNotes = (
  content: SidebarContent,
): content is SidebarNotes => {
  return "notes" in content && "action" in content;
};

export const isSidebarSharedFiles = (
  content: SidebarContent,
): content is SidebarSharedFiles => {
  return "requestedPaths" in content;
};

export interface Todo {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  sourceMessageId?: string;
}

export interface TodoBlockProps {
  todos: Todo[];
  inputTodos?: Todo[];
  blockId: string;
  messageId: string;
}

export interface TodoWriteInput {
  merge?: boolean;
  todos?: Todo[];
}

export type ChatStatus = "submitted" | "streaming" | "ready" | "error";

export const messageMetadataSchema = z.object({
  feedbackType: z.enum(["positive", "negative"]).optional(),
  isAutoContinue: z.boolean().optional(),
  mode: z.enum(["agent", "ask"]).optional(),
  createdAt: z.number().optional(),
  generationStartedAt: z.number().optional(),
  generationTimeMs: z.number().optional(),
  /** Set to "user" when the run was stopped by the operator. Durable. */
  stopReason: z.enum(["user"]).optional(),
  /** Persisted producer outcome; trailing prose alone does not prove completion. */
  finishReason: z.string().optional(),
  /** Run totals, sent on the finish part so a run can report its own cost. */
  totalTokens: z.number().optional(),
  inputTokens: z.number().optional(),
  /** Latest provider request input, distinct from cumulative run usage. */
  contextInputTokens: z.number().nonnegative().optional(),
  costDollars: z.number().optional(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

export type ChatMessage = UIMessage<MessageMetadata> & {
  createdAt?: number;
  fileDetails?: FileDetails[];
  sourceMessageId?: string;
};

export type RateLimitInfo = {
  /** Resolved by the server from authenticated account identity. */
  pricingMargin?: number;
  remaining: number;
  resetTime: Date;
  limit: number;
  // Monthly token bucket details for paid users
  monthly?: { remaining: number; limit: number; resetTime: Date };
  // Points deducted for potential refund on error (always = estimatedCost)
  pointsDeducted?: number;
  // Extra usage points deducted (only set when extra usage balance was used)
  extraUsagePointsDeducted?: number;
  // Idempotency key for restoring a failed Pro/Max account-ledger reservation
  // to its exact included/purchased sources.
  creditRefundKey?: string;
  // True when rate limiting was skipped (Redis not configured)
  rateLimitSkipped?: boolean;
  // Where this request was served from (PAYG routing):
  //  - "free"    : within the daily free allowance (no balance charge)
  //  - "balance" : drawn from the prepaid token balance
  //  - "bucket"  : monthly token bucket (team / legacy paid tiers)
  //  - "account" : authoritative Convex ledger (Pro / Max)
  // Threaded into post-stream deductUsage so a free-served request never
  // double-charges the balance.
  servedFrom?: "free" | "balance" | "bucket" | "account";
};

export interface ExtraUsageConfig {
  enabled: boolean;
  /** Whether user has prepaid balance available */
  hasBalance?: boolean;
  /** Current balance in dollars (for UI display) */
  balanceDollars?: number;
  /** Whether auto-reload is enabled (can use extra usage even with $0 balance) */
  autoReloadEnabled?: boolean;
}

export interface QueuedMessage {
  dispatchState?: "sending" | "unconfirmed";
  dispatchAttempt?: string;
  id: string;
  text: string;
  files?: import("@/types/file").FileMessagePart[];
  timestamp: number;
}

export type QueueBehavior = "queue" | "stop-and-send";

// "e2b" for cloud sandbox, "desktop" for Tauri desktop app, or a connectionId UUID for a specific local connection.
// Uses `string & {}` to preserve autocomplete for well-known values while allowing arbitrary strings.
export type SandboxPreference = "e2b" | "desktop" | (string & {});

/**
 * Preview message for share dialog (full message structure with parts)
 */
export interface PreviewMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content?: string;
  parts: any[];
  fileDetails?: FileDetails[];
}

/**
 * Shared chat entry returned by getUserSharedChats query
 */
export interface SharedChat {
  _id: Id<"chats">;
  id: string;
  title: string;
  share_id: string;
  share_date: number;
  update_time: number;
}
