import { buildOpenCodeConfig, deepMerge } from "@/lib/opencode/config";
import { BUILD_MODELS } from "@/types/chat";

const baseInput = {
  proxyBaseUrl: "https://riftsys.app/api/llm/v1",
  proxyToken: "tok_secret_123",
  workingContextTokens: 200000,
  maxSteps: 100,
  maxOutputTokens: 30000,
};

describe("buildOpenCodeConfig", () => {
  it("declares one gateway model per BUILD_MODELS entry, keyed by providerKey", () => {
    const cfg = buildOpenCodeConfig(baseInput) as any;
    const models = cfg.provider.gateway.models;
    expect(Object.keys(models).sort()).toEqual(
      BUILD_MODELS.map((m) => m.providerKey).sort(),
    );
    for (const m of BUILD_MODELS) {
      expect(models[m.providerKey].limit).toEqual({ context: 200000, output: 30000 });
      expect(models[m.providerKey].tool_call).toBe(true);
      expect(models[m.providerKey].cost.input).toBeGreaterThan(0);
    }
  });

  it("routes default + small model and locks the provider list", () => {
    const cfg = buildOpenCodeConfig(baseInput) as any;
    expect(cfg.model).toBe("gateway/model-gpt-5.6-sol");
    expect(cfg.small_model).toBe("gateway/model-gemini-3.8-flash");
    expect(cfg.enabled_providers).toEqual(["gateway"]);
  });

  it("puts the token only in provider.options.apiKey, nowhere else", () => {
    const cfg = buildOpenCodeConfig(baseInput);
    const json = JSON.stringify(cfg);
    const occurrences = json.split("tok_secret_123").length - 1;
    expect(occurrences).toBe(1);
    expect((cfg as any).provider.gateway.options.apiKey).toBe("tok_secret_123");
  });

  it("disables all phone-home + blocking behaviors", () => {
    const cfg = buildOpenCodeConfig(baseInput) as any;
    expect(cfg.share).toBe("disabled");
    expect(cfg.autoupdate).toBe(false);
    expect(cfg.lsp).toBe(false);
    expect(cfg.permission.question).toBe("deny");
    expect(cfg.permission.doom_loop).toBe("deny");
    expect(cfg.agent.build.steps).toBe(100);
  });

  it("honors explicit default/small model overrides", () => {
    const cfg = buildOpenCodeConfig({
      ...baseInput,
      defaultModelKey: "model-opus-5",
      smallModelKey: "model-glm-5.3",
    }) as any;
    expect(cfg.model).toBe("gateway/model-opus-5");
    expect(cfg.small_model).toBe("gateway/model-glm-5.3");
  });

  it("deep-merges an extensions fragment last", () => {
    const cfg = buildOpenCodeConfig({
      ...baseInput,
      extensions: {
        mcp: { linear: { type: "remote", url: "https://x" } },
        agent: { build: { prompt: "{file:/p.md}" } },
        permission: { webfetch: "deny" },
      },
    }) as any;
    expect(cfg.mcp.linear.url).toBe("https://x");
    // merged, not replaced: steps survives alongside the new prompt
    expect(cfg.agent.build.steps).toBe(100);
    expect(cfg.agent.build.prompt).toBe("{file:/p.md}");
    expect(cfg.permission.webfetch).toBe("deny");
    expect(cfg.permission.question).toBe("deny");
  });
});

describe("deepMerge", () => {
  it("recurses objects, replaces arrays and scalars", () => {
    expect(deepMerge({ a: { b: 1, c: 2 }, arr: [1] }, { a: { c: 3 }, arr: [2] })).toEqual({
      a: { b: 1, c: 3 },
      arr: [2],
    });
  });
});
