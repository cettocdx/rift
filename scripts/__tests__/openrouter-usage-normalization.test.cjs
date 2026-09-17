const assert = require("node:assert/strict");
const { test } = require("node:test");
const { generateText, streamText } = require("ai");
const { createOpenRouter } = require("@openrouter/ai-sdk-provider");
const usage = {
  prompt_tokens: 19301,
  completion_tokens: 12,
  total_tokens: 19313,
  prompt_tokens_details: { cached_tokens: 31736 },
  completion_tokens_details: { reasoning_tokens: 10 },
  cost: 0,
};

test("installed provider + SDK preserve explicit zero and independent cache/reasoning details without adding them to total", async () => {
  let requests = 0;
  const provider = createOpenRouter({
    apiKey: "offline-fixture",
    fetch: async () => {
      requests++;
      return new Response(
        JSON.stringify({
          id: "offline-id",
          created: 1,
          model: "offline-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
          usage,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });
  const result = await generateText({
    model: provider("offline/model"),
    prompt: "offline fixture",
    maxRetries: 0,
  });
  assert.equal(requests, 1);
  assert.equal(result.usage.raw.cost, 0);
  assert.equal(result.usage.inputTokens, 19301);
  assert.equal(result.usage.inputTokenDetails.cacheReadTokens, 31736);
  assert.equal(result.usage.outputTokens, 12);
  assert.equal(result.usage.outputTokenDetails.reasoningTokens, 10);
  assert.equal(result.usage.totalTokens, 19313);
});

test("repeated cumulative usage frames produce one final per-step cost, not a sum of frames", async () => {
  const frame = (data) => `data: ${JSON.stringify(data)}\n\n`;
  const envelope = { id: "offline-id", created: 1, model: "offline-model" };
  const provider = createOpenRouter({
    apiKey: "offline-fixture",
    fetch: async () =>
      new Response(
        frame({
          ...envelope,
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "ok" },
              finish_reason: null,
            },
          ],
          usage: { ...usage, cost: 0.01 },
        }) +
          frame({
            ...envelope,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { ...usage, cost: 0.02 },
          }) +
          "data: [DONE]\n\n",
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
  });
  const steps = [];
  const result = streamText({
    model: provider("offline/model"),
    prompt: "offline fixture",
    maxRetries: 0,
    onStepFinish: (step) => steps.push(step.usage),
  });
  await result.consumeStream();
  assert.equal(steps.length, 1);
  assert.equal(steps[0].raw.cost, 0.02);
  assert.equal(steps[0].inputTokens, 19301);
});
