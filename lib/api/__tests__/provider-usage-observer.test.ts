import {
  MockLanguageModelV3,
  convertReadableStreamToArray,
  simulateReadableStream,
} from "ai/test";
import {
  observeProviderUsage,
  measureProviderPrompt,
} from "../provider-usage-observer";

const usage = {
  inputTokens: { total: 100, noCache: 20, cacheRead: 80, cacheWrite: 0 },
  outputTokens: { total: 20, text: 15, reasoning: 5 },
  raw: { cost: 0.012 },
};
const finish = {
  type: "finish" as const,
  finishReason: { unified: "stop" as const, raw: "stop" },
  usage,
};

it("records a non-streaming generation before SDK tools or output validation", async () => {
  const record = jest.fn();
  const response = {
    content: [{ type: "text" as const, text: "result" }],
    finishReason: finish.finishReason,
    usage,
    warnings: [],
  };
  const model = observeProviderUsage(
    new MockLanguageModelV3({ doGenerate: async () => response }),
    record,
  );
  for (let i = 0; i < 2; i++) await model.doGenerate({ prompt: [] });
  expect(record).toHaveBeenCalledTimes(2);
  expect(record).toHaveBeenLastCalledWith(
    expect.objectContaining({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      raw: { cost: 0.012 },
    }),
  );
});

it("does not invent a receipt when a non-streaming provider rejects", async () => {
  const record = jest.fn();
  const model = observeProviderUsage(
    new MockLanguageModelV3({
      doGenerate: async () => {
        throw new Error("unavailable");
      },
    }),
    record,
  );
  await expect(model.doGenerate({ prompt: [] })).rejects.toThrow("unavailable");
  expect(record).not.toHaveBeenCalled();
});

it("passes through provider frames and counts one terminal receipt per invocation", async () => {
  const record = jest.fn();
  const model = observeProviderUsage(
    new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({ chunks: [finish, finish] }),
      }),
    }),
    record,
  );
  for (let i = 0; i < 2; i++) {
    const result = await model.doStream({ prompt: [] });
    expect(await convertReadableStreamToArray(result.stream)).toEqual([
      finish,
      finish,
    ]);
  }
  expect(record).toHaveBeenCalledTimes(2);
  expect(record).toHaveBeenLastCalledWith(
    expect.objectContaining({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      raw: { cost: 0.012 },
    }),
  );
});

it("does not invent a zero receipt for a response with no finish frame", async () => {
  const record = jest.fn();
  const model = observeProviderUsage(
    new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [{ type: "stream-start", warnings: [] }],
        }),
      }),
    }),
    record,
  );
  await convertReadableStreamToArray(
    (await model.doStream({ prompt: [] })).stream,
  );
  expect(record).not.toHaveBeenCalled();
});

it("keeps missing totals unknown and preserves explicit zero cost", async () => {
  const record = jest.fn();
  const partial = {
    ...finish,
    usage: {
      ...usage,
      inputTokens: { ...usage.inputTokens, total: undefined },
      raw: { cost: 0 },
    },
  };
  const model = observeProviderUsage(
    new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({ chunks: [partial] }),
      }),
    }),
    record,
  );
  await convertReadableStreamToArray(
    (await model.doStream({ prompt: [] })).stream,
  );
  expect(record).toHaveBeenCalledWith(
    expect.objectContaining({
      inputTokens: undefined,
      totalTokens: undefined,
      raw: { cost: 0 },
    }),
  );
});

it("measures selected provider payload without retaining its contents", () => {
  const info = measureProviderPrompt({
    prompt: [
      { role: "system", content: "private system" },
      { role: "user", content: [{ type: "text", text: "private request" }] },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "a",
            toolName: "read",
            output: { type: "text", value: "private result" },
          },
        ],
      },
    ],
    tools: [
      {
        type: "function",
        name: "read",
        description: "private schema",
        inputSchema: { type: "object" },
      },
    ],
  });
  expect(info.messageCount).toBe(3);
  expect(info.toolCount).toBe(1);
  expect(info.systemChars).toBe(JSON.stringify("private system").length);
  expect(info.toolResultChars).toBeGreaterThan(0);
  expect(info.toolSchemaChars).toBeGreaterThan(0);
  expect(info.assistantChars).toBe(0);
  expect(JSON.stringify(info)).not.toContain("private");
});

it("a failing prompt reporter cannot prevent a provider receipt", async () => {
  const record = jest.fn();
  const model = observeProviderUsage(
    new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({ chunks: [finish] }),
      }),
    }),
    record,
    () => {
      throw new Error("report unavailable");
    },
  );
  const result = await model.doStream({ prompt: [] });
  await convertReadableStreamToArray(result.stream);
  expect(record).toHaveBeenCalledTimes(1);
});
