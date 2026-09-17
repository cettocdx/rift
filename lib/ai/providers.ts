import { getProviderContext, type ProviderContext } from "./provider-context";
import { customProvider } from "ai";
import {
  fetchWithProviderCapacityRecovery,
  type OnProviderCapacity,
} from "./provider-capacity-fetch";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { BUILD_MODELS, type ChatMode, type SelectedModel } from "@/types/chat";
import { isAgentMode } from "@/lib/utils/mode-helpers";
import { openrouterAttributionHeaders } from "@/lib/ai/openrouter-attribution";
// import { withTracing } from "@posthog/ai";
// import PostHogClient from "@/app/posthog";
// import type { SubscriptionTier } from "@/types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

// OpenRouter serves the turn from `model` and only tries the `models` chain
// after that endpoint errors, so the body is repaired for the model that will
// actually see it. Judging a blob against the whole chain instead lets a
// fallback license a payload the primary cannot read, which fails the primary
// on every turn: almost every RIFT chain ends in Grok, so that reading hands
// the request to a leg that normally never runs.
const addressedModel = (body: Record<string, unknown>): unknown =>
  body.model !== undefined
    ? body.model
    : Array.isArray(body.models)
      ? body.models[0]
      : undefined;

/**
 * The provider family that minted a reasoning blob. Encrypted reasoning is
 * sealed to the endpoint that produced it — it can only be replayed to a model
 * of the same family, never to another one.
 */
type ReasoningOrigin = "anthropic" | "google" | "openai" | "xai" | "other";

// `format` on an OpenRouter reasoning detail names the provider dialect that
// produced it (ReasoningFormat in @openrouter/ai-sdk-provider); details round-
// trip verbatim through providerMetadata, so the tag survives into the outgoing
// body. ReasoningFormat.Unknown is deliberately absent here: it attributes
// nothing, and only a positive attribution may license a strip.
const REASONING_FORMAT_ORIGINS: Record<string, ReasoningOrigin> = {
  "anthropic-claude-v1": "anthropic",
  "google-gemini-v1": "google",
  "openai-responses-v1": "openai",
  "azure-openai-responses-v1": "openai",
  "xai-responses-v1": "xai",
};

// Every first-party endpoint on OpenRouter lives under a fixed vendor prefix,
// so the prefix decides which reasoning dialect the target speaks. Vendors
// outside this list ("deepseek/", "qwen/", …) are still a definite mismatch for
// the four dialects above, which is why they resolve to "other" rather than to
// an unknown.
const MODEL_SLUG_ORIGINS: ReadonlyArray<readonly [string, ReasoningOrigin]> = [
  ["anthropic/", "anthropic"],
  ["google/", "google"],
  ["openai/", "openai"],
  ["x-ai/", "xai"],
];

const modelSlugOrigin = (value: unknown): ReasoningOrigin | null => {
  if (typeof value !== "string") return null;
  const slug = value.toLowerCase();

  for (const [prefix, origin] of MODEL_SLUG_ORIGINS) {
    if (slug.startsWith(prefix)) return origin;
  }

  // "openrouter/auto" and the cloaked "openrouter/*" models hide the endpoint
  // behind a router, so nothing about the eventual target can be proven.
  if (slug.startsWith("openrouter/")) return null;
  return slug.indexOf("/") > 0 ? "other" : null;
};

const reasoningDetailOrigin = (
  detail: Record<string, unknown>,
): ReasoningOrigin | null => {
  const format = detail.format;
  if (typeof format !== "string") return null;
  return REASONING_FORMAT_ORIGINS[format.toLowerCase()] ?? null;
};

// Two encrypted shapes reach the wire: OpenRouter's normalised
// `reasoning.encrypted` detail (payload in `data`) and the OpenAI-Responses
// reasoning item it passes through verbatim (payload in `encrypted_content`).
const isEncryptedReasoningDetail = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  if (Object.hasOwn(value, "encrypted_content")) return true;
  return value.type === "reasoning.encrypted" || value.type === "encrypted";
};

type ShouldDropDetail = (detail: Record<string, unknown>) => boolean;

const stripEncryptedReasoningDetails = (
  value: unknown,
  shouldDrop: ShouldDropDetail,
  inReasoningDetails = false,
): { value: unknown; changed: boolean } => {
  if (Array.isArray(value)) {
    let changed = false;
    const cleaned: unknown[] = [];

    for (const item of value) {
      if (inReasoningDetails && isRecord(item) && shouldDrop(item)) {
        changed = true;
        continue;
      }
      const result = stripEncryptedReasoningDetails(
        item,
        shouldDrop,
        inReasoningDetails,
      );
      changed ||= result.changed;
      cleaned.push(result.value);
    }

    return changed ? { value: cleaned, changed } : { value, changed: false };
  }

  if (!isRecord(value)) {
    return { value, changed: false };
  }

  // A detail reached as a bare object rather than an array item cannot be
  // dropped whole without losing its siblings, so it loses the payload instead.
  const dropPayload = inReasoningDetails && shouldDrop(value);

  let changed = false;
  const cleaned: Record<string, unknown> = {};

  for (const [key, entryValue] of Object.entries(value)) {
    if (dropPayload && key === "encrypted_content") {
      changed = true;
      continue;
    }

    const nextInReasoningDetails =
      inReasoningDetails || key === "reasoning_details";
    const result = stripEncryptedReasoningDetails(
      entryValue,
      shouldDrop,
      nextInReasoningDetails,
    );
    changed ||= result.changed;

    if (
      key === "reasoning_details" &&
      Array.isArray(result.value) &&
      result.value.length === 0
    ) {
      changed = true;
      continue;
    }

    cleaned[key] = result.value;
  }

  return changed ? { value: cleaned, changed } : { value, changed: false };
};

/**
 * Drop encrypted reasoning that the addressed model cannot have produced.
 *
 * Encrypted payloads are provider-private and only replayable to the endpoint
 * that created them; a conversation whose history accumulated them under one
 * model and is then sent to another fails the entire turn. The visible
 * assistant text survives either way, so a provably foreign blob costs nothing
 * to drop and everything to send.
 *
 * Signed `reasoning.text` details are left intact — Gemini's thought signature
 * travels there and in providerMetadata, and stripping it breaks function
 * calling (see lib/utils/message-processor.ts).
 */
export const sanitizeOpenRouterEncryptedReasoning = (
  body: unknown,
): { body: unknown; changed: boolean } => {
  if (!isRecord(body) || !Array.isArray(body.messages)) {
    return { body, changed: false };
  }

  // An endpoint that cannot be resolved ("openrouter/auto", a slug with no
  // vendor) contradicts nothing, so nothing may be dropped against it.
  const targetOrigin = modelSlugOrigin(addressedModel(body));
  if (targetOrigin === null) {
    return { body, changed: false };
  }

  const shouldDrop: ShouldDropDetail = (detail) => {
    if (!isEncryptedReasoningDetail(detail)) return false;
    // xAI refuses replayed blobs outright, its own included, so a Grok turn
    // sheds every one instead of matching dialects.
    if (targetOrigin === "xai") return true;

    const origin = reasoningDetailOrigin(detail);
    // No `format`, no proof of origin. Anthropic 400s when a redacted thinking
    // block goes missing from a tool-call turn, so an unattributable blob stays.
    if (!origin) return false;
    return origin !== targetOrigin;
  };

  let changed = false;
  const messages = body.messages.map((message) => {
    const result = stripEncryptedReasoningDetails(message, shouldDrop);
    changed ||= result.changed;
    return result.value;
  });

  if (!changed) return { body, changed: false };
  return { body: { ...body, messages }, changed: true };
};

export const patchKimiReasoningToolCalls = (
  body: unknown,
): { body: unknown; changed: boolean } => {
  if (!isRecord(body)) return { body, changed: false };
  if (
    !Array.isArray(body.messages) ||
    !isRecord(body.reasoning) ||
    body.reasoning.enabled !== true
  ) {
    return { body, changed: false };
  }

  let changed = false;
  const messages = body.messages.map((message) => {
    if (
      isRecord(message) &&
      message.role === "assistant" &&
      Array.isArray(message.tool_calls) &&
      message.tool_calls.length > 0 &&
      !message.reasoning
    ) {
      changed = true;
      return { ...message, reasoning: "." };
    }
    return message;
  });

  return changed
    ? { body: { ...body, messages }, changed: true }
    : { body, changed: false };
};

const OPENROUTER_METADATA_HEADER = "X-OpenRouter-Experimental-Metadata";

const withOpenRouterMetadataHeader = (
  headers: HeadersInit | undefined,
): Headers => {
  const nextHeaders = new Headers(headers);
  if (!nextHeaders.has(OPENROUTER_METADATA_HEADER)) {
    nextHeaders.set(OPENROUTER_METADATA_HEADER, "enabled");
  }
  return nextHeaders;
};

// Custom fetch for OpenRouter provider-specific request-body repairs.
//
// - Kimi requires a `reasoning` field on assistant tool-call messages when
//   reasoning mode is enabled, but the AI SDK does not always include one.
// - Encrypted reasoning blobs are sealed to the endpoint that minted them, so
//   history carried across a model switch or an OpenRouter fallback fails the
//   turn ("encrypted reasoning ... produced under a different model"). The
//   visible assistant text remains in the prompt, so blobs the target provably
//   cannot have written are omitted.
// - The metadata header opts into OpenRouter routing metadata for attribution.
const createOpenrouterPatchFetch =
  (onProgress?: OnProviderCapacity): typeof fetch =>
  async (url, init) => {
    let nextInit: RequestInit = {
      ...init,
      headers: withOpenRouterMetadataHeader(init?.headers),
    };

    if (nextInit.body && typeof nextInit.body === "string") {
      try {
        const parsedBody = JSON.parse(nextInit.body) as unknown;
        const kimiPatched = patchKimiReasoningToolCalls(parsedBody);
        const reasoningPatched = sanitizeOpenRouterEncryptedReasoning(
          kimiPatched.body,
        );
        if (kimiPatched.changed || reasoningPatched.changed) {
          nextInit = {
            ...nextInit,
            body: JSON.stringify(reasoningPatched.body),
          };
        }
      } catch {
        // If parsing fails, send the request as-is
      }
    }
    return fetchWithProviderCapacityRecovery(url, nextInit, onProgress);
  };

// Registry-only models preserve exported provider shape; runtime selection below
// always builds models with originating credentials. Never use SDK env fallback.
const openrouter = createOpenRouter({
  apiKey: "",
  fetch: createOpenrouterPatchFetch(),
  headers: openrouterAttributionHeaders,
});

type OpenRouterInstance = typeof openrouter;

type BuildProviderKey = (typeof BUILD_MODELS)[number]["providerKey"];

/**
 * The visible Build catalog owns its provider keys and OpenRouter slugs. This
 * registration step keeps the client menus and runtime provider map on the
 * same source of truth instead of maintaining a second model-id table here.
 */
const createBuildProviderMap = (or: OpenRouterInstance) =>
  Object.fromEntries(
    BUILD_MODELS.map((model) => [model.providerKey, or(model.providerModel)]),
  ) as unknown as Record<BuildProviderKey, ReturnType<OpenRouterInstance>>;

const buildProviderMap = (or: OpenRouterInstance) => ({
  "ask-model": or("google/gemini-3-flash-preview"),
  // Free tiers route to Grok 4.3 (xAI). Prior DeepSeek/Kimi routes hard-refused
  // OSINT / offensive-security work with an un-overridable safety response —
  // the system prompt cannot stop it.
  // Grok 4.3 has no such cyber content-filter and actually serves the output.
  // Grok 4.5 still 403s on the EU route, so the product default remains 4.3.
  // Hacker Mode registers 4.5 separately for its US-region canary route and
  // always carries a 4.3 model fallback.
  "ask-model-free": or("x-ai/grok-4.3"),
  // Paid auto agent path — Grok too. Every agent route now lands on the
  // non-refusing Grok 4.3.
  "agent-model": or("x-ai/grok-4.3"),
  "agent-model-free": or("x-ai/grok-4.3"),
  "model-sonnet-4.6": or("anthropic/claude-sonnet-4.6"),
  "model-gemini-3-flash": or("google/gemini-3-flash-preview"),
  "model-deepseek-v4-flash": or("deepseek/deepseek-v4-flash"),
  "model-opus-4.6": or("anthropic/claude-opus-4.6"),
  "model-opus-4.7": or("anthropic/claude-opus-4.7"),
  // Permissive, frontier-tier models that do NOT apply a cyber content-filter
  // (unlike Claude/GPT/Gemini), so they actually serve offensive-security
  // output. Grok 4.3 remains the best practical pentest model.
  "model-grok-4.3": or("x-ai/grok-4.3"),
  // Every visible Build model is registered from the canonical picker catalog.
  ...createBuildProviderMap(or),
  // Hidden legacy Build keys stay registered so existing chats remain
  // replayable. Visible routes live only in BUILD_MODELS.
  "model-gpt-5.6-luna": or("openai/gpt-5.6-luna"),
  "model-gpt-5.6-sol-pro": or("openai/gpt-5.6-sol-pro"),
  "model-sonnet-5": or("anthropic/claude-sonnet-5"),
  "model-gpt-5.5": or("openai/gpt-5.5"),
  // Retired from the picker by the 17 Aug 2026 catalog refresh (superseded by
  // Opus 5 / Grok 4.6 / Qwen3.8 Max). Still registered so a chat pinned to one
  // of them replays instead of failing to resolve a model.
  "model-opus-4.8": or("anthropic/claude-opus-4.8"),
  "model-grok-4.5": or("x-ai/grok-4.5"),
  "model-qwen3.7-max": or("qwen/qwen3.7-max"),
  "fallback-agent-model": or("google/gemini-3-flash-preview"),
  "fallback-ask-model": or("google/gemini-3-flash-preview"),
  "fallback-gemini-3.5-flash": or("google/gemini-3.5-flash"),
  "fallback-grok-4.3": or("x-ai/grok-4.3"),
  "title-generator-model": or("google/gemini-2.5-flash"),
});

const baseProviders = buildProviderMap(openrouter);

export type ModelName = keyof typeof baseProviders;

const buildModelDisplayNames = Object.fromEntries(
  BUILD_MODELS.map((model) => [
    model.providerKey,
    `${model.provider} ${model.model}`,
  ]),
) as Record<BuildProviderKey, string>;

// Provider marketing/version dates are not knowledge cutoffs. Keep this map
// empty until a provider publishes a cutoff for an exact model slug; the
// system prompt handles an undisclosed cutoff explicitly.
export const modelCutoffDates: Partial<Record<ModelName, string>> = {};

export const modelDisplayNames = {
  "ask-model": "Auto, an intelligent model router built by RIFT",
  "ask-model-free": "Auto, an intelligent model router built by RIFT",
  "agent-model": "Auto, an intelligent model router built by RIFT",
  "agent-model-free": "Auto, an intelligent model router built by RIFT",
  "model-sonnet-4.6": "Anthropic Claude Sonnet 4.6",
  "model-gemini-3-flash": "Google Gemini 3 Flash",
  "model-deepseek-v4-flash": "DeepSeek V4 Flash",
  "model-opus-4.6": "Anthropic Claude Opus 4.6",
  "model-opus-4.7": "Anthropic Claude Opus 4.7",
  "model-grok-4.3": "xAI Grok 4.3",
  ...buildModelDisplayNames,
  "model-gpt-5.6-luna": "OpenAI GPT-5.6 Luna",
  "model-gpt-5.6-sol-pro": "OpenAI GPT-5.6 Sol Pro",
  "model-sonnet-5": "Anthropic Claude Sonnet 5",
  "model-gpt-5.5": "OpenAI GPT-5.5",
  "model-opus-4.8": "Anthropic Claude Opus 4.8",
  "model-grok-4.5": "xAI Grok 4.5",
  "model-qwen3.7-max": "Alibaba Qwen3.7 Max",
  "fallback-agent-model": "Auto, an intelligent model router built by RIFT",
  "fallback-ask-model": "Auto, an intelligent model router built by RIFT",
  "fallback-gemini-3.5-flash": "Google Gemini 3.5 Flash",
  "fallback-grok-4.3": "Auto, an intelligent model router built by RIFT",
  "title-generator-model": "Google Gemini 2.5 Flash",
} satisfies Record<ModelName, string>;

export const getModelDisplayName = (modelName: ModelName): string => {
  return modelDisplayNames[modelName];
};

export const getModelCutoffDate = (
  modelName: ModelName,
): string | undefined => {
  return modelCutoffDates[modelName];
};

export function isAnthropicModel(modelName: string): boolean {
  // Match both RIFT registry keys and raw Anthropic/OpenRouter slugs so message
  // repair and cache breakpoints stay active through fallback transitions.
  const m = modelName.toLowerCase();
  return (
    m.includes("sonnet") ||
    m.includes("fable") ||
    m.includes("opus") ||
    m.includes("claude") ||
    m.includes("anthropic")
  );
}

export function isDeepSeekModel(modelName: string): boolean {
  // NOTE: ask-model-free / agent-model-free now route to Grok 4.3, not DeepSeek.
  // Only the explicit DeepSeek key remains.
  return modelName === "model-deepseek-v4-flash";
}

export function supportsMultimodalToolResults(modelName?: string): boolean {
  if (!modelName) return false;

  const normalized = modelName.toLowerCase();

  return (
    normalized === "ask-model" ||
    // Free tiers are Grok 4.3-backed (vision-capable) — see buildProviderMap.
    normalized === "ask-model-free" ||
    normalized === "agent-model-free" ||
    normalized.includes("gemini") ||
    normalized.includes("google/") ||
    isAnthropicModel(normalized) ||
    normalized.includes("anthropic/") ||
    normalized.includes("claude") ||
    normalized.includes("openai/") ||
    normalized.includes("gpt-") ||
    normalized.includes("o1") ||
    normalized.includes("o3") ||
    normalized.includes("o4") ||
    normalized.includes("x-ai/") ||
    normalized.includes("grok") ||
    normalized.includes("moonshotai/") ||
    normalized.includes("kimi")
  );
}

export function isGeminiModel(modelName: string): boolean {
  return modelName === "ask-model" || modelName === "model-gemini-3-flash";
}

/**
 * Map a RIFT tier id to the underlying provider key for a given mode.
 * Returns `null` for `"auto"` (the caller routes to the auto-router model
 * key instead).
 *
 * AGENT mode = live pentest/OSINT → ALL tiers use Grok 4.3. Prior Chinese-model
 * routes applied a built-in safety layer that hard-refused offensive-security
 * work, while Grok 4.3 reliably serves it. Ask mode keeps Gemini for Recon.
 */
export function resolveTierToProviderKey(
  tier: SelectedModel,
  mode: ChatMode,
): ModelName | null {
  if (tier === "auto") return null;
  switch (tier) {
    case "rift-standard":
      // Recon: agent → Grok (no refusal); ask → Gemini 3 Flash (cheap, fine).
      return isAgentMode(mode) ? "model-grok-4.3" : "model-gemini-3-flash";
    case "rift-pro":
      // Strike → Grok 4.3 (reliably serves the security workflow).
      return "model-grok-4.3";
    case "rift-max":
      // Dominate → Grok 4.3: the best PRACTICAL pentest model. Frontier-tier
      // cyber capability AND permissive — it actually serves offensive-security
      // output, unlike Claude/Opus (real-time content-filter) or the Chinese
      // models (Chinese safety refusal).
      return "model-grok-4.3";
    default:
      // build-* selections are Build-mode only (mapped in selectModel); they
      // have no security/ask tier route, so fall through to the auto router.
      return null;
  }
}

const providerShape = customProvider({ languageModels: baseProviders });
const contextProviders = new WeakMap<ProviderContext, typeof providerShape>();

function createOriginProvider(
  context: ProviderContext,
  onCapacity?: OnProviderCapacity,
) {
  if (!onCapacity) {
    const cached = contextProviders.get(context);
    if (cached) return cached;
  }
  const patchedFetch = createOpenrouterPatchFetch(onCapacity);
  const router = createOpenRouter({
    // Explicit empty prevents the SDK from looking up a later run's key.
    apiKey: context.openrouterApiKey ?? "",
    fetch: (url, init) => {
      if (!context.openrouterApiKey)
        throw new Error("OpenRouter API key is missing.");
      return patchedFetch(url, init);
    },
    headers: openrouterAttributionHeaders,
  });
  const provider = customProvider({ languageModels: buildProviderMap(router) });
  if (!onCapacity) contextProviders.set(context, provider);
  return provider;
}

/** Global callers resolve the origin when selecting a model, not at import. */
export const myProvider: typeof providerShape = {
  ...providerShape,
  languageModel: (modelId: string) =>
    createOriginProvider(getProviderContext()).languageModel(modelId),
};

/** A returned provider stays bound even when used by an out-of-scope callback. */
export const createTrackedProvider = (onCapacity?: OnProviderCapacity) =>
  createOriginProvider(getProviderContext(), onCapacity);
