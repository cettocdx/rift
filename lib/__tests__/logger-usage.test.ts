import { WideEventBuilder } from "@/lib/logger";

function builder() {
  return new WideEventBuilder("test-request", "test-chat", "/api/agent-long");
}

it("reads SDK v6 cache and reasoning details without adding them to total tokens", () => {
  const b = builder();
  b.setUsage({
    inputTokens: 250,
    outputTokens: 50,
    inputTokenDetails: { cacheReadTokens: 200, cacheWriteTokens: 10 },
    outputTokenDetails: { reasoningTokens: 12 },
    raw: { cost: 0.03 },
  });
  expect(b.build().usage).toMatchObject({
    input_tokens: 250,
    output_tokens: 50,
    total_tokens: 300,
    cache_read_tokens: 200,
    cache_write_tokens: 10,
    reasoning_tokens: 12,
    total_cost: 0.03,
  });
});

it("preserves a zero provider price instead of fabricating a token-list price", () => {
  const b = builder();
  b.setUsage({ inputTokens: 10_000, outputTokens: 200, raw: { cost: 0 } });
  expect(b.build().usage?.total_cost).toBe(0);
});

it("leaves total cost unknown when the provider price is absent", () => {
  const b = builder();
  b.setUsage({ inputTokens: 10_000, outputTokens: 200 });
  b.addToolCost(0.5);
  expect(b.build().usage?.total_cost).toBeUndefined();
});

it("does not add tool spend again when the event is read more than once", () => {
  const b = builder();
  b.setUsage({ inputTokens: 100, outputTokens: 20, raw: { cost: 0.03 } });
  b.addToolCost(0.02);
  expect(b.build().usage?.total_cost).toBeCloseTo(0.05);
  expect(b.build().usage?.total_cost).toBeCloseTo(0.05);
});
