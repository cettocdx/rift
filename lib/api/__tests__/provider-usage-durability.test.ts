import {
  MockLanguageModelV3,
  convertReadableStreamToArray,
  simulateReadableStream,
} from "ai/test";
import { observeProviderUsage } from "../provider-usage-observer";
const finish = {
  type: "finish" as const,
  finishReason: { unified: "stop" as const, raw: "stop" },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
};
it("awaits durable receipt acknowledgment before releasing the provider finish", async () => {
  let acknowledge!: () => void;
  const pending = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  const record = jest.fn(() => pending);
  const model = observeProviderUsage(
    new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({ chunks: [finish] }),
      }),
    }),
    record,
  );
  let ended = false;
  const reading = convertReadableStreamToArray(
    (await model.doStream({ prompt: [] })).stream,
  ).then(() => {
    ended = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(record).toHaveBeenCalledTimes(1);
  expect(ended).toBe(false);
  acknowledge();
  await reading;
  expect(ended).toBe(true);
});
it("surfaces asynchronous persistence failure instead of accepting a finish", async () => {
  const error = new Error("Receipt storage unavailable");
  const record = jest.fn(() => Promise.reject(error));
  const model = observeProviderUsage(
    new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({ chunks: [finish] }),
      }),
    }),
    record,
  );
  await expect(
    convertReadableStreamToArray((await model.doStream({ prompt: [] })).stream),
  ).rejects.toBe(error);
});
