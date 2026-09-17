import {
  createUsageTallyTransform,
  parseUsageFromJson,
  type ProxyUsage,
} from "@/lib/opencode/sse-usage";

async function runStream(
  chunks: string[],
): Promise<{ out: string; usage: ProxyUsage | null }> {
  let usage: ProxyUsage | null = null;
  const transform = createUsageTallyTransform((u) => (usage = u));
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  const piped = readable.pipeThrough(transform);
  let out = "";
  const reader = piped.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  return { out, usage };
}

const FRAMES = [
  'data: {"id":"gen-1","model":"openai/gpt-5.6-sol","choices":[{"delta":{"content":"Hi"}}]}\n\n',
  'data: {"id":"gen-1","model":"openai/gpt-5.6-sol","choices":[{"delta":{"content":"!"}}]}\n\n',
  'data: {"id":"gen-1","model":"openai/gpt-5.6-sol","usage":{"prompt_tokens":100,"completion_tokens":20,"cost":0.0123,"prompt_tokens_details":{"cached_tokens":40},"completion_tokens_details":{"reasoning_tokens":8}}}\n\n',
  "data: [DONE]\n\n",
];

describe("createUsageTallyTransform", () => {
  it("passes bytes through unchanged and reports final usage", async () => {
    const { out, usage } = await runStream(FRAMES);
    expect(out).toBe(FRAMES.join(""));
    expect(usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cachedTokens: 40,
      reasoningTokens: 8,
      costDollars: 0.0123,
      servedModel: "openai/gpt-5.6-sol",
      generationId: "gen-1",
    });
  });

  it("is byte-exact even when frames are split mid-line across chunks", async () => {
    const whole = FRAMES.join("");
    const pieces: string[] = [];
    for (let i = 0; i < whole.length; i += 7) pieces.push(whole.slice(i, i + 7));
    const { out, usage } = await runStream(pieces);
    expect(out).toBe(whole);
    expect(usage?.costDollars).toBe(0.0123);
    expect(usage?.inputTokens).toBe(100);
  });

  it("does not fire onUsage when no usage frame is seen", async () => {
    const { out, usage } = await runStream([
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    expect(out).toContain('"content":"x"');
    // model present but no usage -> servedModel changes, still counts as seen
    // (a frame with only content and no model/usage never triggers a change)
    expect(usage).toBeNull();
  });

  it("uses the last cumulative usage frame, not a sum", async () => {
    const { usage } = await runStream([
      'data: {"usage":{"prompt_tokens":100,"completion_tokens":10,"cost":0.01}}\n\n',
      'data: {"usage":{"prompt_tokens":100,"completion_tokens":25,"cost":0.02}}\n\n',
      "data: [DONE]\n\n",
    ]);
    expect(usage?.outputTokens).toBe(25);
    expect(usage?.costDollars).toBe(0.02);
  });
});

describe("parseUsageFromJson", () => {
  it("reads usage from a full non-streaming completion", () => {
    const u = parseUsageFromJson({
      id: "gen-2",
      model: "x-ai/grok-4.6",
      usage: { prompt_tokens: 5, completion_tokens: 3, cost: 0.001 },
    });
    expect(u).toMatchObject({ inputTokens: 5, outputTokens: 3, costDollars: 0.001, servedModel: "x-ai/grok-4.6" });
  });
});
