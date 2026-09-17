import { resolveCostMicros } from "@/lib/opencode/proxy-cost";
import type { ProxyUsage } from "@/lib/opencode/sse-usage";

const u = (o: Partial<ProxyUsage>): ProxyUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  reasoningTokens: 0,
  costDollars: 0,
  ...o,
});

describe("resolveCostMicros", () => {
  it("uses OpenRouter usage.cost when present", () => {
    expect(resolveCostMicros(u({ costDollars: 0.0123 }), "model-gpt-5.6-sol")).toBe(12300);
  });

  it("falls back to token pricing when cost is absent", () => {
    // sol: $5/1M in, $30/1M out. 1M in + 1M out = 5 + 30 = $35 -> 35_000_000 micros
    expect(resolveCostMicros(u({ inputTokens: 1_000_000, outputTokens: 1_000_000 }), "model-gpt-5.6-sol")).toBe(
      35_000_000,
    );
  });

  it("prices cached input at 10% of input", () => {
    // 1M input of which 1M cached -> billable 0 input, cache 1M*5*0.1 = $0.5
    expect(
      resolveCostMicros(u({ inputTokens: 1_000_000, cachedTokens: 1_000_000 }), "model-gpt-5.6-sol"),
    ).toBe(500_000);
  });

  it("uses the default price for an unknown key", () => {
    // default 0.5/3.0; 1M out -> $3
    expect(resolveCostMicros(u({ outputTokens: 1_000_000 }), "unknown")).toBe(3_000_000);
  });
});
