import { BUILD_MODELS, DEFAULT_BUILD_MODEL } from "@/types/chat";
import { getRawModelPricing } from "@/lib/rate-limit/token-bucket";

/**
 * Pure builder for the `opencode.json` written into the chat sandbox.
 *
 * OpenCode reaches models only through RIFT's LLM proxy, declared here as a
 * single OpenAI-compatible provider ("gateway") whose model ids are RIFT
 * `providerKey`s — so the proxy, pricing map and usage tracker share one key.
 * `cost` here is display-only (billing runs through the proxy); `limit.context`
 * is the real working window OpenCode compacts against. Everything that could
 * phone home (models fetch, autoupdate, share, LSP) is turned off. The optional
 * `extensions` fragment (skills/MCP/agent prompt from the materializer) is
 * deep-merged last so this builder stays pure and independently testable.
 */

export interface OpenCodeConfigInput {
  /** Proxy base URL reachable from the sandbox, e.g. https://riftsys.app/api/llm/v1 */
  proxyBaseUrl: string;
  /** Per-run proxy bearer token (goes in provider.options.apiKey). */
  proxyToken: string;
  /** Working context window in tokens (getMaxTokensForSubscription). */
  workingContextTokens: number;
  /** Per-leg step cap (getMaxStepsForUser). */
  maxSteps: number;
  /** Max output tokens per response. */
  maxOutputTokens: number;
  /** RIFT providerKey to run by default; falls back to the Build default. */
  defaultModelKey?: string;
  /** RIFT providerKey for the small/utility model (titles, summaries). */
  smallModelKey?: string;
  /** Fragment deep-merged last (mcp, agent overrides, plugin, permission). */
  extensions?: Record<string, unknown>;
}

 
type Json = Record<string, any>;

function isPlainObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Recursive merge; arrays and scalars from `over` replace `base`. */
export function deepMerge(base: Json, over: Json): Json {
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

function defaultProviderKey(): string {
  return (
    BUILD_MODELS.find((m) => m.id === DEFAULT_BUILD_MODEL)?.providerKey ??
    BUILD_MODELS[0].providerKey
  );
}

function fastProviderKey(): string {
  return (
    BUILD_MODELS.find((m) => m.id === "build-gemini")?.providerKey ??
    defaultProviderKey()
  );
}

export function buildOpenCodeConfig(input: OpenCodeConfigInput): Json {
  const models: Json = {};
  for (const m of BUILD_MODELS) {
    const price = getRawModelPricing(m.providerKey);
    models[m.providerKey] = {
      name: m.model,
      tool_call: m.capabilities.includes("tools"),
      reasoning: m.capabilities.includes("reasoning"),
      limit: {
        context: input.workingContextTokens,
        output: input.maxOutputTokens,
      },
      cost: {
        input: price.input,
        output: price.output,
        // OpenRouter prompt-cache economics: reads ~0.1x input, writes ~1.25x.
        cache_read: Number((price.input * 0.1).toFixed(4)),
        cache_write: Number((price.input * 1.25).toFixed(4)),
      },
    };
  }

  const defaultKey = input.defaultModelKey ?? defaultProviderKey();
  const smallKey = input.smallModelKey ?? fastProviderKey();

  const base: Json = {
    $schema: "https://opencode.ai/config.json",
    model: `gateway/${defaultKey}`,
    small_model: `gateway/${smallKey}`,
    enabled_providers: ["gateway"],
    provider: {
      gateway: {
        npm: "@ai-sdk/openai-compatible",
        name: "RIFT",
        options: {
          baseURL: input.proxyBaseUrl,
          apiKey: input.proxyToken,
          timeout: 600000,
        },
        models,
      },
    },
    share: "disabled",
    autoupdate: false,
    lsp: false,
    permission: {
      "*": "allow",
      external_directory: "deny",
      question: "deny",
      // Unanswered in headless mode this would block forever; the driver
      // detects loops itself and aborts, so deny keeps the model moving.
      doom_loop: "deny",
    },
    compaction: { auto: true, prune: true },
    tool_output: { max_lines: 2000, max_bytes: 51200 },
    agent: { build: { steps: input.maxSteps } },
  };

  return input.extensions ? deepMerge(base, input.extensions) : base;
}
