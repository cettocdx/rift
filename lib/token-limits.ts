import type { ChatMode, ChatPurpose, SubscriptionTier } from "@/types";
import { findBuildModelByRuntimeValue } from "@/types/chat";
import { SUMMARIZATION_THRESHOLD_PERCENTAGE } from "@/lib/chat/summarization/constants";
import {
  FREE_MAX_CONTEXT_TOKENS,
  FREE_MAX_OUTPUT_TOKENS,
  PAID_MAX_OUTPUT_TOKENS,
} from "@/lib/rate-limit/free-config";

export const MAX_TOKENS_FREE = FREE_MAX_CONTEXT_TOKENS;
/** Conservative fallback for a runtime model without verified metadata. */
export const MAX_TOKENS_PAID = 200_000;

export interface ContextLimitOptions {
  mode?: ChatMode;
  /** Picker id, provider registry key, or exact OpenRouter model id. */
  model?: string;
  /** Needed for picker values: security/image have their own orchestrator. */
  purpose?: ChatPurpose;
  /** Verified prepaid balance; grants capacity, never spending permission. */
  hasPaidContext?: boolean;
}

const LEGACY_BUILD_CONTEXT_MODELS: Record<string, string> = {
  "build-opus46": "build-max",
  "build-deepseek": "build-codex",
  "rift-max": "build-max",
};

function resolveContextModel(options: ContextLimitOptions = {}) {
  let value = options.model;
  const runtimeId = value?.startsWith("model-") || value?.includes("/");
  // A resolved provider id is authoritative, including fallback/canary models.
  if (!runtimeId) {
    if (options.purpose === "security") value = "x-ai/grok-4.3";
    else if (options.purpose === "image") value = "build-fable";
    else {
      value = value ? (LEGACY_BUILD_CONTEXT_MODELS[value] ?? value) : value;
      if (
        options.purpose === "app" &&
        (!value || ["auto", "rift-standard", "rift-pro"].includes(value))
      )
        value = "build-codex";
    }
  }
  const build = findBuildModelByRuntimeValue(value);
  if (build)
    return {
      contextTokens: build.contextTokens,
      maxInputTokens:
        "maxInputTokens" in build ? build.maxInputTokens : undefined,
    };
  // Active security route. Public OpenRouter /models and /endpoints metadata,
  // verified 2026-09-08. Unknown/retired ids deliberately keep the fallback.
  if (value === "model-grok-4.3" || value === "x-ai/grok-4.3")
    return { contextTokens: 1_000_000, maxInputTokens: undefined };
  return { contextTokens: MAX_TOKENS_PAID, maxInputTokens: undefined };
}

/** Total window. Subscription/PAYG checks still gate the request separately. */
export const getMaxTokensForSubscription = (
  subscription?: SubscriptionTier,
  options?: ContextLimitOptions,
): number =>
  Math.min(
    resolveContextModel(options).contextTokens,
    subscription === "free" && !options?.hasPaidContext
      ? MAX_TOKENS_FREE
      : Infinity,
  );

/** Match the actual generation cap; context entitlement does not change output policy. */
export const getOutputTokenReserve = (
  subscription?: SubscriptionTier,
): number =>
  subscription === "free" ? FREE_MAX_OUTPUT_TOKENS : PAID_MAX_OUTPUT_TOKENS;

export const getMaxInputTokensForSubscription = (
  subscription?: SubscriptionTier,
  options?: ContextLimitOptions,
): number =>
  Math.max(
    0,
    Math.min(
      getMaxTokensForSubscription(subscription, options) -
        getOutputTokenReserve(subscription),
      resolveContextModel(options).maxInputTokens ?? Infinity,
    ),
  );

// History/input validation runs before the system prompt and tool schemas are
// assembled. Leave room for them; the runner counts actual system tokens too.
export const CONTEXT_INSTRUCTION_RESERVE = 8_192;
export const getMessageTokenBudget = (
  subscription?: SubscriptionTier,
  options?: ContextLimitOptions,
): number =>
  Math.max(
    0,
    getMaxInputTokensForSubscription(subscription, options) -
      CONTEXT_INSTRUCTION_RESERVE,
  );

export const getContextCompactionThreshold = (
  subscription?: SubscriptionTier,
  options?: ContextLimitOptions,
): number =>
  Math.min(
    Math.floor(
      getMaxTokensForSubscription(subscription, options) *
        SUMMARIZATION_THRESHOLD_PERCENTAGE,
    ),
    getMaxInputTokensForSubscription(subscription, options),
  );

/** Bound DB work while allowing long windows to backfill proportionately. */
export const getContextHistoryPageLimit = (
  subscription?: SubscriptionTier,
  options?: ContextLimitOptions,
): number =>
  Math.max(
    4,
    Math.min(
      24,
      Math.ceil(
        getMaxTokensForSubscription(subscription, options) / MAX_TOKENS_PAID,
      ) * 4,
    ),
  );

/** Uploaded files retain their separate platform ceiling; this is not the model window. */
export const FILE_TOKEN_PERCENT = 0.5;
export const getMaxFileTokens = (
  subscription: SubscriptionTier,
  _options?: ContextLimitOptions,
): number =>
  Math.floor(
    (subscription === "free" ? MAX_TOKENS_FREE : MAX_TOKENS_PAID) *
      FILE_TOKEN_PERCENT,
  );
