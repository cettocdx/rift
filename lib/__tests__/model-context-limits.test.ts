import {
  getMaxTokensForSubscription,
  getMaxInputTokensForSubscription,
  getMessageTokenBudget,
  getContextCompactionThreshold,
  getContextHistoryPageLimit,
  getMaxFileTokens,
} from "@/lib/token-limits";

describe("model-aware context capacity", () => {
  it("uses the selected model window instead of the old paid 200k limit", () => {
    expect(
      getMaxTokensForSubscription("pro", {
        model: "anthropic/claude-fable-5.1",
      }),
    ).toBe(1_000_000);
    expect(
      getMaxTokensForSubscription("pro", { model: "openai/gpt-5.6-sol" }),
    ).toBe(1_050_000);
    expect(getMaxTokensForSubscription("pro", { model: "x-ai/grok-4.6" })).toBe(
      500_000,
    );
  });

  it("resolves picker, runtime ids, legacy choices, and purpose-specific orchestrators", () => {
    for (const model of [
      "build-max",
      "model-opus-5",
      "anthropic/claude-opus-5",
      "rift-max",
    ]) {
      expect(
        getMaxTokensForSubscription("pro", { model, purpose: "app" }),
      ).toBe(1_000_000);
    }
    expect(
      getMaxTokensForSubscription("pro", { model: "auto", purpose: "app" }),
    ).toBe(1_050_000);
    expect(
      getMaxTokensForSubscription("pro", {
        model: "build-grok",
        purpose: "image",
      }),
    ).toBe(1_000_000);
    expect(
      getMaxTokensForSubscription("pro", {
        model: "build-grok",
        purpose: "security",
      }),
    ).toBe(1_000_000);
    expect(
      getMaxTokensForSubscription("pro", {
        model: "model-grok-4.6",
        purpose: "security",
      }),
    ).toBe(500_000);
  });

  it("preserves the free cap but grants verified prepaid accounts model capacity", () => {
    const options = { model: "anthropic/claude-fable-5.1" };
    expect(getMaxTokensForSubscription("free", options)).toBe(128_000);
    expect(
      getMaxTokensForSubscription("free", { ...options, hasPaidContext: true }),
    ).toBe(1_000_000);
    expect(
      getMaxTokensForSubscription("free", {
        ...options,
        hasPaidContext: false,
      }),
    ).toBe(128_000);
    expect(
      getMaxTokensForSubscription("pro", { model: "unverified/model" }),
    ).toBe(200_000);
    expect(
      getMaxTokensForSubscription("pro", {
        model: "unverified/model",
        purpose: "app",
      }),
    ).toBe(200_000);
  });

  it("reserves real output tokens and respects gateway prompt-only ceilings", () => {
    for (const model of ["build-codex", "build-sol-pro", "build-fast"]) {
      expect(getMaxInputTokensForSubscription("pro", { model })).toBe(922_000);
    }
    expect(
      getMaxInputTokensForSubscription("pro", { model: "build-balanced" }),
    ).toBe(970_000);
    expect(
      getMaxInputTokensForSubscription("free", {
        model: "build-qwen",
        hasPaidContext: true,
      }),
    ).toBe(983_616);
    expect(
      getMaxInputTokensForSubscription("pro", { model: "build-grok" }),
    ).toBe(470_000);
    expect(
      getMaxInputTokensForSubscription("free", { model: "build-codex" }),
    ).toBe(113_000);
    expect(getMessageTokenBudget("pro", { model: "build-codex" })).toBeLessThan(
      922_000,
    );
  });

  it("does not compact 1M models at 180k but never consumes the output reserve", () => {
    expect(
      getContextCompactionThreshold("pro", { model: "build-balanced" }),
    ).toBe(900_000);
    expect(getContextCompactionThreshold("pro", { model: "build-codex" })).toBe(
      922_000,
    );
    expect(getContextCompactionThreshold("pro", { model: "build-grok" })).toBe(
      450_000,
    );
    expect(
      getContextCompactionThreshold("free", { model: "build-codex" }),
    ).toBe(113_000);
  });

  it("expands bounded history loading without lifting the separate upload quota", () => {
    expect(getContextHistoryPageLimit("pro", { model: "build-balanced" })).toBe(
      20,
    );
    expect(getContextHistoryPageLimit("pro", { model: "build-codex" })).toBe(
      24,
    );
    expect(getContextHistoryPageLimit("free", { model: "build-codex" })).toBe(
      4,
    );
    expect(
      getContextHistoryPageLimit("pro", { model: "unverified/model" }),
    ).toBe(4);
    expect(getMaxFileTokens("pro", { model: "build-codex" })).toBe(100_000);
    expect(
      getMaxFileTokens("free", { model: "build-codex", hasPaidContext: true }),
    ).toBe(64_000);
  });
});
