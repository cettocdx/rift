import { resolveOpenRouterSlug } from "@/lib/llm-proxy/models";

/**
 * Pure transform of the completion body OpenCode sends to the RIFT proxy into
 * the body the proxy forwards to OpenRouter.
 *
 * OpenCode addresses the model by RIFT `providerKey`; here it becomes the real
 * OpenRouter slug (allowlist-checked). We force usage accounting on so the run
 * can be billed, clamp the output cap, drop client-supplied routing fields
 * (`user`, `provider`, `transforms`) so the sandbox cannot steer OpenRouter,
 * and merge RIFT's own reasoning/fallback provider options. Provider-specific
 * body repairs (Kimi reasoning, encrypted-reasoning stripping) are applied by
 * the route on the final object, not here, to keep this pure and dependency-free.
 */

export interface PrepareUpstreamInput {
  /** Parsed JSON body from OpenCode. */
  body: unknown;
  /** OpenRouter provider options from buildProviderOptions(...).openrouter. */
  providerOptions?: Record<string, unknown>;
  /** Hard cap on max_tokens (PAID_MAX_OUTPUT_TOKENS). */
  maxOutputTokens: number;
}

export type PrepareUpstreamResult =
  | { ok: true; body: Record<string, unknown>; slug: string; stream: boolean }
  | { ok: false; status: number; code: string; message: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function prepareUpstreamRequest(
  input: PrepareUpstreamInput,
): PrepareUpstreamResult {
  if (!isRecord(input.body)) {
    return { ok: false, status: 400, code: "invalid_body", message: "Body must be a JSON object." };
  }
  const src = input.body;
  const modelKey = src.model;
  const slug = resolveOpenRouterSlug(modelKey);
  if (!slug) {
    return {
      ok: false,
      status: 400,
      code: "model_not_allowed",
      message: `Model '${String(modelKey)}' is not on the Build allowlist.`,
    };
  }

  const stream = src.stream === true;
  const out: Record<string, unknown> = { ...src, model: slug };

  // Force usage accounting on both axes (OpenAI stream_options + OpenRouter usage).
  if (stream) {
    out.stream_options = { ...(isRecord(src.stream_options) ? src.stream_options : {}), include_usage: true };
  }
  out.usage = { ...(isRecord(src.usage) ? src.usage : {}), include: true };

  // Clamp output tokens to the tier cap.
  const requested = typeof src.max_tokens === "number" ? src.max_tokens : undefined;
  out.max_tokens = requested ? Math.min(requested, input.maxOutputTokens) : input.maxOutputTokens;

  // Drop client-supplied routing/attribution the sandbox must not control.
  delete out.user;
  delete out.provider;
  delete out.transforms;

  // Merge RIFT's own OpenRouter provider options (reasoning, user, models chain).
  if (input.providerOptions) {
    for (const [k, v] of Object.entries(input.providerOptions)) {
      out[k] = v;
    }
  }

  return { ok: true, body: out, slug, stream };
}
