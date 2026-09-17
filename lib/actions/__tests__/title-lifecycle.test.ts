/** @jest-environment node */
import { generateText, type UIMessage, type UIMessageStreamWriter } from "ai";
import {
  generateTitleFromUserMessage,
  generateTitleFromUserMessageWithWriter,
} from "..";

jest.mock("ai", () => ({
  ...jest.requireActual("ai"),
  generateText: jest.fn(),
}));
jest.mock("@/lib/ai/providers", () => ({
  myProvider: { languageModel: jest.fn(() => "title-model") },
}));
jest.mock("@/lib/api/chat-stream-helpers", () => ({
  isXaiSafetyError: () => false,
}));

const messages: UIMessage[] = [
  {
    id: "first",
    role: "user",
    parts: [{ type: "text", text: "Plan a garden" }],
  },
];
const generate = jest.mocked(generateText);
const writer = () => ({ write: jest.fn() }) as unknown as UIMessageStreamWriter;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  generate.mockReset();
  generate.mockResolvedValue({ output: { title: "Garden plan" } } as never);
});
afterEach(() => jest.useRealTimers());

it("bounds optional title output and disables automatic model retries", async () => {
  generate.mockResolvedValue({ output: { title: "Garden plan" } } as never);
  const stream = writer();
  await expect(
    generateTitleFromUserMessageWithWriter(messages, stream),
  ).resolves.toBe("Garden plan");
  expect(generate).toHaveBeenCalledWith(
    expect.objectContaining({
      maxRetries: 0,
      maxOutputTokens: 256,
      abortSignal: expect.any(AbortSignal),
    }),
  );
  expect(stream.write).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it("releases finalization after four seconds even when a transport ignores abort", async () => {
  let finish!: (value: never) => void;
  generate.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const stream = writer();
  const pending = generateTitleFromUserMessageWithWriter(messages, stream);
  await jest.advanceTimersByTimeAsync(4000);
  await expect(pending).resolves.toBeUndefined();
  expect(generate.mock.calls[0][0].abortSignal?.aborted).toBe(true);
  finish({ output: { title: "Too late" } } as never);
  await Promise.resolve();
  expect(stream.write).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

it("stops waiting and aborts the title transport when the parent is cancelled", async () => {
  generate.mockImplementation(() => new Promise(() => {}));
  const parent = new AbortController();
  const stream = writer();
  const pending = generateTitleFromUserMessageWithWriter(messages, stream, {
    abortSignal: parent.signal,
  });
  parent.abort();
  await expect(pending).resolves.toBeUndefined();
  expect(generate.mock.calls[0][0].abortSignal?.aborted).toBe(true);
  expect(stream.write).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

it("does not spend on a pre-cancelled task or messages without user text", async () => {
  const parent = new AbortController();
  parent.abort();
  await expect(
    generateTitleFromUserMessage(messages, { abortSignal: parent.signal }),
  ).resolves.toBeUndefined();
  await expect(generateTitleFromUserMessage([])).resolves.toBeUndefined();
  await expect(
    generateTitleFromUserMessage([
      {
        id: "a",
        role: "assistant",
        parts: [{ type: "text", text: "Internal" }],
      },
    ]),
  ).resolves.toBeUndefined();
  expect(generate).not.toHaveBeenCalled();
});

it("does not emit an empty title", async () => {
  generate.mockResolvedValue({ output: { title: "  " } } as never);
  const stream = writer();
  await expect(
    generateTitleFromUserMessageWithWriter(messages, stream),
  ).resolves.toBeUndefined();
  expect(stream.write).not.toHaveBeenCalled();
});

it("does not write a completed title after its parent has stopped", async () => {
  const parent = new AbortController();
  const stream = writer();
  const pending = generateTitleFromUserMessageWithWriter(messages, stream, {
    abortSignal: parent.signal,
  });
  parent.abort();
  await expect(pending).resolves.toBeUndefined();
  expect(stream.write).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});
