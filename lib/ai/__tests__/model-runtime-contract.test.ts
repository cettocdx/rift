import {
  BUILD_MODELS,
  DEFAULT_BUILD_MODEL,
  coerceSelectedModel,
  getEffectiveBuildModel,
  parseReasoningEffort,
  resolveBuildReasoningEffort,
} from "@/types/chat";
import {
  myProvider,
  supportsMultimodalToolResults,
  isAnthropicModel,
  type ModelName,
} from "@/lib/ai/providers";
import { buildProviderOptions } from "@/lib/api/chat-stream-helpers";
import { getMaxTokensForSubscription, getMaxInputTokensForSubscription } from "@/lib/token-limits";
import { selectModel } from "@/lib/chat/chat-processor";

const resolveBuildModel = (selectedModel?: string) => {
  const validated = coerceSelectedModel(selectedModel);
  const providerKey = selectModel(
    "agent",
    "pro",
    validated ?? undefined,
    false,
    "app",
  );
  const model = myProvider.languageModel(providerKey);

  return { providerKey, modelId: model.modelId };
};

describe("Build model runtime contract", () => {
  it("maps every visible picker option to a registered OpenRouter model", () => {
    for (const entry of BUILD_MODELS) {
      const { providerKey, modelId } = resolveBuildModel(entry.id);

      expect(providerKey).toBe(entry.providerKey);
      expect(modelId).toBe(entry.providerModel);
    }
  });

  it.each([
    ["build-astra", "openai/gpt-6-astra", 1_050_000, "medium"],
    ["build-fable", "anthropic/claude-fable-5.1", 1_000_000, "high"],
    ["build-gemini", "google/gemini-3.8-flash", 1_048_576, "medium"],
  ] as const)("runs %s with verified routing, context and mandatory reasoning", (id, slug, context, effort) => {
    const resolved = resolveBuildModel(id);
    expect(resolved.modelId).toBe(slug);
    expect(getMaxTokensForSubscription("pro", {model: id, purpose: "app"})).toBe(context);
    expect(supportsMultimodalToolResults(resolved.providerKey)).toBe(true);
    expect(buildProviderOptions(false, "test", resolved.providerKey, "ask").openrouter.reasoning)
      .toEqual({enabled: true, effort});
  });

  it("removes retired models and preserves the replacement across UI and runtime", () => {
    for (const [oldId, newId] of [["build-sol-pro", "build-astra"], ["build-balanced", "build-fable"], ["build-fast", "build-codex"]]) {
      expect(BUILD_MODELS.some(m => m.id === oldId)).toBe(false);
      expect(coerceSelectedModel(oldId)).toBe(newId);
      expect(getEffectiveBuildModel(oldId).id).toBe(newId);
      expect(resolveBuildModel(oldId)).toEqual(resolveBuildModel(newId));
    }
    expect(isAnthropicModel("model-fable-5.1")).toBe(true);
    expect(getMaxInputTokensForSubscription("pro", {model:"build-astra"})).toBe(922_000);
    expect(resolveBuildReasoningEffort("build-gemini", "max")).toBe("medium");
    const fallbacks = buildProviderOptions(true, "test", "model-gpt-5.6-sol", "agent").openrouter.models ?? [];
    expect(fallbacks).not.toContain("openai/gpt-5.6-luna");
  });

  it("keeps visible ids and resolved provider models unique", () => {
    const ids = BUILD_MODELS.map(({ id }) => id);
    const providerKeys = ids.map(
      (id) => resolveBuildModel(id).providerKey as ModelName,
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(providerKeys).size).toBe(providerKeys.length);
  });

  it("publishes unique searchable aliases and the requested model families", () => {
    const aliases = BUILD_MODELS.flatMap((entry) => entry.aliases);
    const families = new Set(BUILD_MODELS.map((entry) => entry.family));

    expect(new Set(aliases).size).toBe(aliases.length);
    expect(families).toEqual(
      new Set(["OpenAI", "Claude", "Grok", "Kimi", "Qwen", "GLM", "Hunyuan", "Gemini"]),
    );
  });

  it("keeps Kimi K3 on the verified provider capabilities", () => {
    const kimi = BUILD_MODELS.find((entry) => entry.id === "build-kimi");

    expect(kimi).toMatchObject({
      providerModel: "moonshotai/kimi-k3",
      contextTokens: 1_048_576,
      capabilities: ["reasoning", "tools", "vision"],
    });
    expect(kimi?.capabilities).not.toContain("files");
  });

  it("routes the Build default through the same validated selector path", () => {
    expect(resolveBuildModel().providerKey).toBe(
      resolveBuildModel(DEFAULT_BUILD_MODEL).providerKey,
    );
  });

  it("normalizes auto, cross-purpose, and stale UI state to the Build default", () => {
    expect(getEffectiveBuildModel("auto").id).toBe(DEFAULT_BUILD_MODEL);
    expect(getEffectiveBuildModel("rift-max").id).toBe(DEFAULT_BUILD_MODEL);
    expect(getEffectiveBuildModel("video-grok").id).toBe(DEFAULT_BUILD_MODEL);
    expect(getEffectiveBuildModel("build-opus46").id).toBe(DEFAULT_BUILD_MODEL);
    expect(getEffectiveBuildModel("build-grok").id).toBe("build-grok");
  });

  it("passes the Grok picker choice to the xAI OpenRouter slug", () => {
    expect(resolveBuildModel("build-grok")).toEqual({
      providerKey: "model-grok-4.6",
      modelId: "x-ai/grok-4.6",
    });
  });

  it("routes Kimi K3 through OpenRouter's exact official slug", () => {
    expect(resolveBuildModel("build-kimi")).toEqual({
      providerKey: "model-kimi-k3",
      modelId: "moonshotai/kimi-k3",
    });
    expect(supportsMultimodalToolResults("model-kimi-k3")).toBe(true);
  });

  it("routes text-only Qwen3.8 Max through its exact OpenRouter slug", () => {
    const qwen = BUILD_MODELS.find((entry) => entry.id === "build-qwen");

    expect(qwen).toMatchObject({
      model: "Qwen3.8 Max",
      providerKey: "model-qwen3.8-max",
      providerModel: "qwen/qwen3.8-max",
      contextTokens: 1_000_000,
      capabilities: ["reasoning", "tools"],
    });
    expect(resolveBuildModel("build-qwen")).toEqual({
      providerKey: "model-qwen3.8-max",
      modelId: "qwen/qwen3.8-max",
    });
    expect(supportsMultimodalToolResults("model-qwen3.8-max")).toBe(false);
  });

  it("keeps the proven Sol picker choice on its successful OpenRouter route", () => {
    expect(resolveBuildModel("build-codex")).toEqual({
      providerKey: "model-gpt-5.6-sol",
      modelId: "openai/gpt-5.6-sol",
    });
  });

  it("migrates retired Sol Pro selections to Astra", () => {
    expect(resolveBuildModel("build-sol-pro")).toEqual({
      providerKey: "model-gpt-6-astra",
      modelId: "openai/gpt-6-astra",
    });
  });

  it("routes the open-weights slot to Tencent's Hy4 preview", () => {
    expect(resolveBuildModel("build-hunyuan")).toEqual({
      providerKey: "model-hy4-preview",
      modelId: "tencent/hy4-preview",
    });
  });

  it("migrates retired Luna selections to Sol", () => {
    expect(resolveBuildModel("build-fast")).toEqual({
      providerKey: "model-gpt-5.6-sol",
      modelId: "openai/gpt-5.6-sol",
    });
  });

  it("migrates retired Sonnet selections to Fable 5.1", () => {
    expect(resolveBuildModel("build-balanced")).toEqual({
      providerKey: "model-fable-5.1",
      modelId: "anthropic/claude-fable-5.1",
    });
  });

  it("routes deep reasoning to the current Opus generation", () => {
    expect(resolveBuildModel("build-max")).toEqual({
      providerKey: "model-opus-5",
      modelId: "anthropic/claude-opus-5",
    });
  });

  it("rejects arbitrary provider slugs at HTTP and worker boundaries", () => {
    expect(coerceSelectedModel("vendor/not-in-rift-registry")).toBeNull();
    expect(coerceSelectedModel({ model: "x-ai/grok-4.6" })).toBeNull();
    expect(coerceSelectedModel(45)).toBeNull();
  });

  it("publishes the verified reasoning matrix for every visible Build model", () => {
    const byId = Object.fromEntries(
      BUILD_MODELS.map((model) => [model.id, model.reasoning]),
    );
    const fiveLevels = ["low", "medium", "high", "xhigh", "max"];

    expect(byId).toMatchObject({
      "build-codex": {
        supportedEfforts: fiveLevels,
        defaultEffort: "medium",
      },
      "build-astra": {
        supportedEfforts: fiveLevels,
        defaultEffort: "medium",
      },
      "build-gemini": {
        supportedEfforts: ["low", "medium", "high"],
        defaultEffort: "medium",
      },
      "build-max": {
        supportedEfforts: fiveLevels,
        defaultEffort: "medium",
      },
      "build-fable": {
        supportedEfforts: fiveLevels,
        defaultEffort: "high",
      },
      "build-grok": {
        supportedEfforts: ["low", "medium", "high"],
        defaultEffort: "high",
        mandatory: true,
      },
      // Exact K3 metadata currently advertises low/high/max with max default.
      "build-kimi": {
        supportedEfforts: ["low", "high", "max"],
        defaultEffort: "max",
      },
      "build-qwen": {
        supportedEfforts: ["off", "on"],
        defaultEffort: "on",
        control: "toggle",
      },
    });
  });

  it("coerces stale or hostile effort values against the runtime model", () => {
    expect(resolveBuildReasoningEffort("build-codex", "xhigh")).toBe("xhigh");
    expect(resolveBuildReasoningEffort("model-grok-4.6", "xhigh")).toBe("high");
    expect(resolveBuildReasoningEffort("moonshotai/kimi-k3", "low")).toBe(
      "low",
    );
    expect(resolveBuildReasoningEffort("moonshotai/kimi-k3", "medium")).toBe(
      "max",
    );
    expect(resolveBuildReasoningEffort("qwen/qwen3.8-max", "off")).toBe("off");
    expect(resolveBuildReasoningEffort("build-qwen", "high")).toBe("on");
    expect(resolveBuildReasoningEffort("build-codex", "constructor")).toBe(
      "medium",
    );
  });

  it("parses Extra high and Max as distinct command values", () => {
    expect(parseReasoningEffort("extra-high")).toBe("xhigh");
    expect(parseReasoningEffort("xhigh")).toBe("xhigh");
    expect(parseReasoningEffort("maximum")).toBe("max");
    expect(parseReasoningEffort("off")).toBe("off");
    expect(parseReasoningEffort("on")).toBe("on");
    expect(parseReasoningEffort("fast")).toBeNull();
  });
});
