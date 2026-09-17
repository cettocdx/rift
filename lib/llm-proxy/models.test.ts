import {
  allowedModelKeys,
  isAllowedModelKey,
  resolveOpenRouterSlug,
} from "@/lib/llm-proxy/models";
import { BUILD_MODELS } from "@/types/chat";

describe("llm-proxy model allowlist", () => {
  it("maps every BUILD_MODELS providerKey to its OpenRouter slug", () => {
    for (const m of BUILD_MODELS) {
      expect(resolveOpenRouterSlug(m.providerKey)).toBe(m.providerModel);
      expect(isAllowedModelKey(m.providerKey)).toBe(true);
    }
  });

  it("resolves the default Sol route", () => {
    expect(resolveOpenRouterSlug("model-gpt-5.6-sol")).toBe("openai/gpt-5.6-sol");
  });

  it("rejects unknown, empty, and non-string keys", () => {
    expect(resolveOpenRouterSlug("openai/gpt-5.6-sol")).toBeNull(); // slug is not a key
    expect(resolveOpenRouterSlug("model-does-not-exist")).toBeNull();
    expect(resolveOpenRouterSlug("")).toBeNull();
    expect(resolveOpenRouterSlug(undefined)).toBeNull();
    expect(resolveOpenRouterSlug(42)).toBeNull();
    expect(isAllowedModelKey("nope")).toBe(false);
    expect(isAllowedModelKey(null)).toBe(false);
  });

  it("lists all keys, one per build model", () => {
    expect(allowedModelKeys().sort()).toEqual(
      BUILD_MODELS.map((m) => m.providerKey).sort(),
    );
  });
});
