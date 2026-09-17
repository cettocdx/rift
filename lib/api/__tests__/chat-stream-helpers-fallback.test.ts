/**
 * Tests for buildProviderOptions fallback-chain resolution.
 *
 * Verifies that MODEL_FALLBACK_CHAIN entries (declared as registry keys) are
 * resolved to OpenRouter slugs via myProvider.languageModel(...).modelId, and
 * that the function fails closed (no fallback, no throw) for unknown keys.
 */

import {
  buildProviderOptions,
  getRetryFallbackModel,
} from "@/lib/api/chat-stream-helpers";

jest.mock("@/lib/db/actions", () => ({
  getNotes: jest.fn(),
}));

jest.mock("@/lib/logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

// Slugs the test asserts against. These match the registry in lib/ai/providers.ts.
// If the registry slug for a model changes, update both places intentionally.
const GEMINI_SLUG = "google/gemini-3-flash-preview";
const GROK_SLUG = "x-ai/grok-4.3";
const GROK_45_SLUG = "x-ai/grok-4.6";
const FLASH_SLUG = "google/gemini-3.8-flash";
const ASTRA_SLUG = "openai/gpt-6-astra";
const SOL_SLUG = "openai/gpt-5.6-sol";

describe("buildProviderOptions fallback chain", () => {
  it("resolves Opus 4.6 ask chain to current multimodal fallbacks", () => {
    const opts = buildProviderOptions(false, "user-1", "model-opus-4.6", "ask");
    expect(opts.openrouter).toMatchObject({
      models: [SOL_SLUG, GROK_45_SLUG],
      user: "user-1",
    });
  });

  it("resolves Opus 4.6 agent chain to Terra then Grok slugs", () => {
    const opts = buildProviderOptions(
      false,
      "user-1",
      "model-opus-4.6",
      "agent",
    );
    expect(opts.openrouter).toMatchObject({
      models: [SOL_SLUG, GROK_45_SLUG, GROK_SLUG],
      user: "user-1",
    });
  });

  it("resolves Opus 4.6 multimodal agent chain to frontier vision fallbacks", () => {
    const opts = buildProviderOptions(
      false,
      "user-1",
      "model-opus-4.6",
      "agent",
      { hasMultimodalToolResults: true },
    );
    expect(opts.openrouter).toMatchObject({
      models: [SOL_SLUG, GROK_45_SLUG, GROK_SLUG],
      user: "user-1",
    });
  });

  it("resolves Sonnet 4.6 ask chain to current multimodal fallbacks", () => {
    const opts = buildProviderOptions(
      false,
      "user-1",
      "model-sonnet-4.6",
      "ask",
    );
    expect(opts.openrouter).toMatchObject({
      models: [SOL_SLUG, GROK_45_SLUG],
      user: "user-1",
    });
  });

  it("resolves Sonnet 4.6 agent chain to Terra then Grok slugs", () => {
    const opts = buildProviderOptions(
      false,
      "user-1",
      "model-sonnet-4.6",
      "agent",
    );
    expect(opts.openrouter).toMatchObject({
      models: [SOL_SLUG, GROK_45_SLUG, GROK_SLUG],
      user: "user-1",
    });
  });

  it("resolves Sonnet 4.6 multimodal agent chain to frontier vision fallbacks", () => {
    const opts = buildProviderOptions(
      false,
      "user-1",
      "model-sonnet-4.6",
      "agent",
      { hasMultimodalToolResults: true },
    );
    expect(opts.openrouter).toMatchObject({
      models: [SOL_SLUG, GROK_45_SLUG, GROK_SLUG],
      user: "user-1",
    });
  });

  it("falls back from the auto agent route to Grok", () => {
    const opts = buildProviderOptions(false, "user-1", "agent-model", "agent");
    expect(opts.openrouter).toMatchObject({
      models: [GROK_SLUG],
      user: "user-1",
    });
  });

  it("keeps exact Kimi K3 on a production-safe Build fallback chain", () => {
    const opts = buildProviderOptions(true, "user-1", "model-kimi-k3", "agent");
    expect(opts.openrouter).toMatchObject({
      reasoning: { enabled: true, effort: "max" },
      models: [SOL_SLUG],
      user: "user-1",
    });
  });

  it("uses Qwen3.8 Max's real reasoning toggle without inventing effort", () => {
    const enabled = buildProviderOptions(
      true,
      "user-1",
      "model-qwen3.8-max",
      "agent",
      { reasoningEffort: "on" },
    );
    const disabled = buildProviderOptions(
      true,
      "user-1",
      "model-qwen3.8-max",
      "agent",
      { reasoningEffort: "off" },
    );
    const staleEffort = buildProviderOptions(
      true,
      "user-1",
      "model-qwen3.8-max",
      "agent",
      { reasoningEffort: "high" },
    );

    expect(enabled.openrouter).toMatchObject({
      reasoning: { enabled: true },
      models: [SOL_SLUG, GROK_45_SLUG],
      user: "user-1",
    });
    expect(enabled.openrouter.reasoning).not.toHaveProperty("effort");
    expect(enabled.openrouter.reasoning).not.toHaveProperty("max_tokens");
    expect(disabled.openrouter.reasoning).toEqual({ enabled: false });
    expect(staleEffort.openrouter.reasoning).toEqual({ enabled: true });
  });

  it("falls back from free Grok agent model to Gemini", () => {
    const opts = buildProviderOptions(false, "user-1", "agent-model-free");
    expect(opts.openrouter).toMatchObject({
      models: [GEMINI_SLUG],
      user: "user-1",
    });
  });

  it("falls back from Gemini to Grok", () => {
    const opts = buildProviderOptions(false, "user-1", "model-gemini-3-flash");
    expect(opts.openrouter).toMatchObject({
      models: [GROK_SLUG],
      user: "user-1",
    });
  });

  it("keeps Grok 4.6 reasoning on and falls back to Grok 4.3", () => {
    const opts = buildProviderOptions(
      false,
      "user-1",
      "model-grok-4.6",
      "agent",
    );
    expect(opts.openrouter).toMatchObject({
      reasoning: { enabled: true, effort: "high" },
      models: [GROK_SLUG],
      user: "user-1",
    });
  });

  it("keeps the proven GPT-5.6 Sol route selectable with verified fallbacks", () => {
    const opts = buildProviderOptions(
      true,
      "user-1",
      "model-gpt-5.6-sol",
      "agent",
    );
    expect(opts.openrouter).toMatchObject({
      reasoning: { enabled: true, effort: "medium" },
      models: [FLASH_SLUG, ASTRA_SLUG, GROK_45_SLUG],
    });
    expect(opts.openrouter.models).toHaveLength(3);
  });

  it("falls back from Sol Pro through the proven Sol family before Grok", () => {
    const opts = buildProviderOptions(
      true,
      "user-1",
      "model-gpt-5.6-sol-pro",
      "agent",
    );
    expect(opts.openrouter).toMatchObject({
      reasoning: { enabled: true, max_tokens: 2048 },
      models: [SOL_SLUG, FLASH_SLUG, GROK_45_SLUG],
    });
    expect(opts.openrouter.models).toHaveLength(3);
  });

  it("upgrades a legacy GPT-5.5 failure through Gemini", () => {
    // Terra was retired from the roster, so the legacy chain steps to the next
    // model that is actually selectable rather than to one that is not.
    const opts = buildProviderOptions(true, "user-1", "model-gpt-5.5", "agent");
    expect(opts.openrouter).toMatchObject({
      reasoning: { enabled: true, max_tokens: 2048 },
      models: [FLASH_SLUG, GROK_45_SLUG, GROK_SLUG],
    });
  });

  it.each([["model-gpt-5.6-luna", [GROK_45_SLUG, GROK_SLUG]]])(
    "uses GPT-5.6 reasoning and fallbacks for %s",
    (modelName, models) => {
      const opts = buildProviderOptions(true, "user-1", modelName, "agent");
      expect(opts.openrouter).toMatchObject({
        reasoning: { enabled: true, max_tokens: 2048 },
        models,
      });
    },
  );

  it("uses the current Opus 4.8 registry key with the Anthropic chain", () => {
    const opts = buildProviderOptions(false, "user-1", "model-opus-5", "ask");
    expect(opts.openrouter).toMatchObject({
      reasoning: { enabled: false },
      models: [SOL_SLUG, GROK_45_SLUG],
    });
  });

  it.each([
    ["model-fable-5.1", "high"],
    ["model-opus-5", "medium"],
  ])(
    "uses the qualitative default reasoning effort for %s",
    (modelName, effort) => {
      const opts = buildProviderOptions(true, "user-1", modelName, "agent");
      expect(opts.openrouter).toMatchObject({
        reasoning: { enabled: true, effort },
        models: [SOL_SLUG, GROK_45_SLUG, GROK_SLUG],
      });
      expect(opts.openrouter.reasoning).not.toHaveProperty("max_tokens");
    },
  );

  it("honors Kimi K3 levels without marking reasoning mandatory", () => {
    const enabled = buildProviderOptions(
      true,
      "user-1",
      "model-kimi-k3",
      "agent",
      { reasoningEffort: "low" },
    );
    const disabled = buildProviderOptions(
      false,
      "user-1",
      "model-kimi-k3",
      "ask",
      { reasoningEffort: "high" },
    );
    const staleImported = buildProviderOptions(
      true,
      "user-1",
      "model-kimi-k3",
      "agent",
      { reasoningEffort: "medium" },
    );

    expect(enabled.openrouter).toMatchObject({
      reasoning: { enabled: true, effort: "low" },
      models: [SOL_SLUG, GROK_45_SLUG],
    });
    expect(disabled.openrouter.reasoning).toEqual({ enabled: false });
    expect(staleImported.openrouter.reasoning).toEqual({
      enabled: true,
      effort: "max",
    });
  });

  it("clamps stale profile effort again at the provider boundary", () => {
    const grok = buildProviderOptions(
      true,
      "user-1",
      "model-grok-4.6",
      "agent",
      { reasoningEffort: "max" },
    );
    expect(grok.openrouter.reasoning).toEqual({
      enabled: true,
      effort: "high",
    });
  });

  it("applies a server-validated custom-agent reasoning override", () => {
    const qualitative = buildProviderOptions(
      true,
      "user-1",
      "model-fable-5.1",
      "agent",
      { reasoningEffort: "low" },
    );
    const tokenBudget = buildProviderOptions(
      true,
      "user-1",
      "model-gpt-5.5",
      "agent",
      { reasoningEffort: "high" },
    );

    expect(qualitative.openrouter.reasoning).toMatchObject({
      enabled: true,
      effort: "low",
    });
    expect(tokenBudget.openrouter.reasoning).toMatchObject({
      enabled: true,
      max_tokens: 4096,
    });
  });

  it("keeps xhigh/max fallback legs capability-compatible", () => {
    const xhigh = buildProviderOptions(
      true,
      "user-1",
      "model-fable-5.1",
      "agent",
      { reasoningEffort: "xhigh" },
    );
    const max = buildProviderOptions(
      true,
      "user-1",
      "model-gpt-5.6-sol",
      "agent",
      { reasoningEffort: "max" },
    );

    expect(xhigh.openrouter).toMatchObject({
      reasoning: { enabled: true, effort: "xhigh" },
      models: [SOL_SLUG],
    });
    expect(max.openrouter).toMatchObject({
      reasoning: { enabled: true, effort: "max" },
      models: [ASTRA_SLUG],
    });
    expect(xhigh.openrouter.models).not.toContain(GROK_45_SLUG);
    expect(max.openrouter.models).not.toContain(GROK_45_SLUG);
  });

  it("keeps whole-request retry fallbacks compatible with xhigh/max", () => {
    expect(getRetryFallbackModel("model-gpt-5.6-sol", "agent", "max")).toBe(
      "model-gpt-6-astra",
    );
    expect(getRetryFallbackModel("model-kimi-k3", "agent", "max")).toBe(
      "model-gpt-5.6-sol",
    );
    expect(getRetryFallbackModel("model-qwen3.8-max", "agent", "on")).toBe(
      "model-gpt-5.6-sol",
    );
    expect(getRetryFallbackModel("model-grok-4.6", "agent")).toBe(
      "fallback-grok-4.3",
    );
  });

  it("does not throw for an unknown registry key — no chain, no slug", () => {
    expect(() =>
      buildProviderOptions(false, "user-1", "model-does-not-exist"),
    ).not.toThrow();
    const opts = buildProviderOptions(false, "user-1", "model-does-not-exist");
    expect(opts.openrouter).not.toHaveProperty("models");
  });

  it("emits no `models` field when modelName is omitted", () => {
    const opts = buildProviderOptions(false, "user-1");
    expect(opts.openrouter).not.toHaveProperty("models");
  });

  it("includes reasoning settings independent of fallback chain", () => {
    const reasoning = buildProviderOptions(
      true,
      "user-1",
      "model-opus-4.6",
      "agent",
    );
    expect(reasoning.openrouter).toMatchObject({
      reasoning: { enabled: true },
      models: [SOL_SLUG, GROK_45_SLUG, GROK_SLUG],
    });

    const noReasoning = buildProviderOptions(
      false,
      "user-1",
      "model-opus-4.6",
      "agent",
    );
    expect(noReasoning.openrouter).toMatchObject({
      reasoning: { enabled: false },
      models: [SOL_SLUG, GROK_45_SLUG, GROK_SLUG],
    });

    const multimodal = buildProviderOptions(
      true,
      "user-1",
      "model-opus-4.6",
      "agent",
      { hasMultimodalToolResults: true },
    );
    expect(multimodal.openrouter).toMatchObject({
      reasoning: { enabled: true },
      models: [SOL_SLUG, GROK_45_SLUG, GROK_SLUG],
    });
  });
});

describe("context-safe fallback routes", () => {
  it("excludes 500k fallbacks from a 600k prompt", () => {
    const options = buildProviderOptions(
      true,
      "user-1",
      "model-fable-5.1",
      "agent",
      { inputTokens: 600_000, subscription: "pro" },
    );
    expect(options.openrouter.models).toContain(SOL_SLUG);
    expect(options.openrouter.models).not.toContain(GROK_45_SLUG);
  });
  it("excludes Sol when its gateway input ceiling is exceeded", () => {
    const options = buildProviderOptions(
      true,
      "user-1",
      "model-fable-5.1",
      "agent",
      { inputTokens: 940_000, subscription: "pro" },
    );
    expect(options.openrouter.models ?? []).not.toContain(SOL_SLUG);
    expect(options.openrouter.models ?? []).not.toContain(GROK_45_SLUG);
  });
});

describe("interactive OpenAI Build routing", () => {
  it("prefers low latency without changing effort or the fallback chain", () => {
    const options = buildProviderOptions(
      true,
      "user-1",
      "model-gpt-5.6-sol",
      "agent",
      { reasoningEffort: "medium" },
    );
    expect(options.openrouter).toMatchObject({
      provider: { sort: "latency" },
      reasoning: { enabled: true, effort: "medium" },
    });
  });
  it("does not override routing for other model families or ordinary chat", () => {
    expect(
      buildProviderOptions(true, "user-1", "model-opus-5", "agent").openrouter,
    ).not.toHaveProperty("provider");
    expect(
      buildProviderOptions(true, "user-1", "model-gpt-5.6-sol", "ask")
        .openrouter,
    ).not.toHaveProperty("provider");
  });
});
