/** @jest-environment node */
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { createConsoleModelAgent } from "../console-model-agent";

const usage = {
  inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 3, text: 3, reasoning: 0 },
};

test("the real SDK returns a tool request without executing it on the server or starting another step", async () => {
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        initialDelayInMs: null,
        chunkDelayInMs: null,
        chunks: [
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: "local-edit",
            toolName: "write_file",
            input: JSON.stringify({ path: "example.txt", content: "hello" }),
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool_calls" },
            usage,
          },
        ],
      }),
    }),
  });
  const finished = jest.fn();
  const agent = createConsoleModelAgent({
    model,
    instructions: "Local coding agent",
    providerOptions: {},
    onStepFinish: finished,
  });
  for (const definition of Object.values(agent.tools))
    expect(definition.execute).toBeUndefined();
  const result = await agent.stream({ prompt: "Update example.txt" });
  await result.consumeStream();
  expect(model.doStreamCalls).toHaveLength(1);
  expect(finished).toHaveBeenCalledTimes(1);
  expect((await result.response).messages).toEqual([
    expect.objectContaining({
      role: "assistant",
      content: expect.arrayContaining([
        expect.objectContaining({
          type: "tool-call",
          toolCallId: "local-edit",
          toolName: "write_file",
          input: { path: "example.txt", content: "hello" },
        }),
      ]),
    }),
  ]);
  expect(await result.totalUsage).toMatchObject({
    inputTokens: 12,
    outputTokens: 3,
  });
});

test("the SDK delivers text deltas before the final model step is released", async () => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream({
        async start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "answer" });
          controller.enqueue({
            type: "text-delta",
            id: "answer",
            delta: "Immediate",
          });
          await gate;
          controller.enqueue({ type: "text-end", id: "answer" });
          controller.enqueue({
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage,
          });
          controller.close();
        },
      }),
    }),
  });
  const agent = createConsoleModelAgent({
    model,
    instructions: "Reply",
    providerOptions: {},
    onStepFinish: undefined,
  });
  const result = await agent.stream({ prompt: "hello" });
  const reader = result.textStream.getReader();
  try {
    expect(await reader.read()).toEqual({ done: false, value: "Immediate" });
  } finally {
    finish();
    reader.releaseLock();
  }
  await result.consumeStream();
  expect(await result.text).toBe("Immediate");
});
