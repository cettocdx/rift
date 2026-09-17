/** @jest-environment node */
import { Chat } from "@ai-sdk/react";
import type { UIMessage, UIMessageChunk } from "ai";
import { prepareMessagesForAgentReplay } from "../agent-replay";

it("replays a saved assistant turn once through the real AI SDK reducer", async () => {
  const answer = "Merhaba! Ne inşa etmemi istersiniz?";
  const saved: UIMessage[] = [
    { id: "user", role: "user", parts: [{ type: "text", text: "merhaba" }] },
    {
      id: "run_1",
      role: "assistant",
      parts: [{ type: "step-start" }, { type: "text", text: answer }],
    },
  ];
  const chunks: UIMessageChunk[] = [
    { type: "start", messageId: "run_1" },
    { type: "start-step" },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: answer },
    { type: "text-end", id: "t1" },
    { type: "finish-step" },
    { type: "finish" },
  ];
  const chat = new Chat({
    id: "chat",
    messages: saved,
    transport: {
      sendMessages: jest.fn(),
      reconnectToStream: async () => {
        chat.messages = prepareMessagesForAgentReplay(chat.messages, "run_1");
        return new ReadableStream<UIMessageChunk>({
          start(controller) {
            chunks.forEach((chunk) => controller.enqueue(chunk));
            controller.close();
          },
        });
      },
    },
  });
  await chat.resumeStream();
  expect(chat.error).toBeUndefined();
  expect(chat.messages).toHaveLength(2);
  expect(chat.messages[1].parts.filter((part) => part.type === "text")).toEqual(
    [expect.objectContaining({ text: answer })],
  );
});

it("preserves previous turns, metadata and user messages", () => {
  const messages: UIMessage[] = [
    {
      id: "old",
      role: "assistant",
      parts: [{ type: "text", text: "Earlier answer" }],
    },
    {
      id: "current",
      role: "assistant",
      metadata: { mode: "agent" },
      parts: [{ type: "text", text: "Partial" }],
    },
  ];
  const reset = prepareMessagesForAgentReplay(messages, "current");
  expect(reset[0]).toBe(messages[0]);
  expect(reset[1]).toEqual({ ...messages[1], parts: [] });
  expect(messages[1].parts).toHaveLength(1);
  expect(prepareMessagesForAgentReplay(messages, "another-run")).toBe(messages);
  const user: UIMessage[] = [
    { id: "u", role: "user", parts: [{ type: "text", text: "Next" }] },
  ];
  expect(prepareMessagesForAgentReplay(user, "current")).toBe(user);
});
