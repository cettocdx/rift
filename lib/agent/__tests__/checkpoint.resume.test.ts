/** @jest-environment node */
import { streamText, stepCountIs, tool, type ModelMessage } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { z } from "zod";
import {
  createCompletedStepCheckpoint,
  restoreCompletedStepCheckpoint,
  type AgentStepCheckpoint,
} from "../checkpoint";

it("restores actual SDK completed tool history without re-executing the finished edit", async () => {
  const execute = jest.fn(async () => ({ saved: true }));
  const tools = {
    edit: tool({
      description: "Edit fixture",
      inputSchema: z.object({ path: z.string() }),
      execute,
    }),
  };
  const initialMessages: ModelMessage[] = [
    { role: "user", content: "Edit a.ts then report" },
  ];
  const usage = {
    inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  };
  const original = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        initialDelayInMs: null,
        chunkDelayInMs: null,
        chunks: [
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: "edit-once",
            toolName: "edit",
            input: JSON.stringify({ path: "a.ts" }),
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool-calls" },
            usage,
          },
        ],
      }),
    }),
  });
  let saved: AgentStepCheckpoint | undefined;
  const first = streamText({
    model: original,
    messages: initialMessages,
    tools,
    stopWhen: stepCountIs(1),
    onStepFinish: ({ response, finishReason }) => {
      saved = createCompletedStepCheckpoint({
        initialMessages,
        responseMessages: response.messages,
        stepIndex: 1,
        finishReason,
      });
    },
  });
  await first.consumeStream();
  expect(execute).toHaveBeenCalledTimes(1);
  expect(saved).toBeDefined();

  // Simulate a process replacement exactly at the durable completed boundary.
  const restored = restoreCompletedStepCheckpoint(saved!);
  expect(restored.resumeAllowed).toBe(true);
  let prompt: unknown;
  const replacement = new MockLanguageModelV3({
    doStream: async (options) => {
      prompt = options.prompt;
      return {
        stream: simulateReadableStream({
          initialDelayInMs: null,
          chunkDelayInMs: null,
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "text" },
            { type: "text-delta", id: "text", delta: "Saved a.ts." },
            { type: "text-end", id: "text" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage,
            },
          ],
        }),
      };
    },
  });
  const resumed = streamText({
    model: replacement,
    messages: restored.messages,
    tools,
  });
  await resumed.consumeStream();
  expect(await resumed.text).toBe("Saved a.ts.");
  expect(execute).toHaveBeenCalledTimes(1);
  expect(prompt).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: "assistant",
        content: expect.arrayContaining([
          expect.objectContaining({
            type: "tool-call",
            toolCallId: "edit-once",
          }),
        ]),
      }),
      expect.objectContaining({
        role: "tool",
        content: expect.arrayContaining([
          expect.objectContaining({
            type: "tool-result",
            toolCallId: "edit-once",
            output: { type: "json", value: { saved: true } },
          }),
        ]),
      }),
    ]),
  );
});
