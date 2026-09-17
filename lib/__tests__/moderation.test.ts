/** @jest-environment node */
const mockCreate = jest.fn();
jest.mock("openai", () => ({
  __esModule: true,
  default: jest.fn(() => ({ moderations: { create: mockCreate } })),
}));
import { getModerationResult } from "../moderation";
const messages = [
  {
    role: "user",
    parts: [
      {
        type: "text",
        text: "Inspect this local project and explain the architecture.",
      },
    ],
  },
];
const key = process.env.OPENAI_API_KEY;
it("uses conservative framing without a remote lookup for a verified standalone greeting", async () => {
  await expect(getModerationResult([
    { role: "user", parts: [{ type: "text", text: "merhaba" }] },
  ], true, { standaloneGreeting: true })).resolves.toEqual({
    shouldUncensorResponse: false, moderationText: "",
  });
  expect(mockCreate).not.toHaveBeenCalled();
});

it("still checks instructions even when a caller incorrectly marks them as a greeting", async () => {
  mockCreate.mockRejectedValue(new Error("timeout"));
  await getModerationResult(messages, true, { standaloneGreeting: true });
  expect(mockCreate).toHaveBeenCalledTimes(1);
});
beforeEach(() => {
  mockCreate.mockReset();
  process.env.OPENAI_API_KEY = "test-only";
});
afterAll(() => {
  if (key === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = key;
});
it("bounds moderation latency without multiplying automatic retries", async () => {
  mockCreate.mockRejectedValue(new Error("timeout"));
  expect(await getModerationResult(messages, true)).toEqual({
    shouldUncensorResponse: false,
    moderationText: "",
  });
  expect(mockCreate.mock.calls[0][1]).toMatchObject({
    timeout: 4000,
    maxRetries: 0,
  });
});
it("propagates cancellation before a request starts", async () => {
  const stop = new AbortController();
  stop.abort(new Error("Stopped"));
  await expect(
    getModerationResult(messages, true, { signal: stop.signal }),
  ).rejects.toThrow("Stopped");
  expect(mockCreate).not.toHaveBeenCalled();
});
it("cancels in-flight moderation without converting a user Stop into successful preflight", async () => {
  const stop = new AbortController();
  mockCreate.mockImplementation(
    (_input, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(options.signal.reason),
          { once: true },
        );
      }),
  );
  const running = getModerationResult(messages, true, { signal: stop.signal });
  stop.abort(new Error("Stopped"));
  await expect(running).rejects.toThrow("Stopped");
});
it("preserves moderation decisions for successful responses", async () => {
  mockCreate.mockResolvedValue({
    results: [
      { category_scores: { sexual: 0.99 }, categories: { sexual: true } },
    ],
  });
  expect(
    (await getModerationResult(messages, true)).shouldUncensorResponse,
  ).toBe(false);
});
