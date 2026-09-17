/** @jest-environment node */
import { APICallError, type UIMessage, type UIMessageStreamWriter } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import {
  generateTitleFromUserMessage,
  generateTitleFromUserMessageWithWriter,
} from "..";

let mockModel: MockLanguageModelV3;
jest.mock("@/lib/ai/providers", () => ({
  myProvider: { languageModel: () => mockModel },
}));
jest.mock("@/lib/api/chat-stream-helpers", () => ({
  isXaiSafetyError: () => false,
}));
const messages: UIMessage[] = [
  {
    id: "user",
    role: "user",
    parts: [{ type: "text", text: "Plan a garden" }],
  },
];

it("passes the output ceiling through the real SDK and preserves structured titles", async () => {
  mockModel = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: '{"title":"Garden plan"}' }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: { inputTokens: { total: 20 }, outputTokens: { total: 8 } },
      warnings: [],
    }),
  });
  await expect(generateTitleFromUserMessage(messages)).resolves.toBe(
    "Garden plan",
  );
  expect(mockModel.doGenerateCalls).toHaveLength(1);
  expect(mockModel.doGenerateCalls[0].maxOutputTokens).toBe(256);
});

it("does not retry a retryable provider capacity response for an optional title", async () => {
  const error = new APICallError({
    message: "Capacity",
    url: "https://example.test",
    requestBodyValues: {},
    statusCode: 503,
    isRetryable: true,
  });
  mockModel = new MockLanguageModelV3({
    doGenerate: async () => {
      throw error;
    },
  });
  await expect(generateTitleFromUserMessage(messages)).rejects.toBe(error);
  expect(mockModel.doGenerateCalls).toHaveLength(1);
});

it("bounds a stuck real SDK invocation and cancels its provider signal", async () => {
  jest.useFakeTimers();
  try {
    mockModel = new MockLanguageModelV3({
      doGenerate: () => new Promise(() => {}),
    });
    const write = jest.fn();
    const pending = generateTitleFromUserMessageWithWriter(messages, {
      write,
    } as unknown as UIMessageStreamWriter);
    await jest.advanceTimersByTimeAsync(0);
    expect(mockModel.doGenerateCalls).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(4000);
    await expect(pending).resolves.toBeUndefined();
    expect(mockModel.doGenerateCalls[0].abortSignal?.aborted).toBe(true);
    expect(write).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});
