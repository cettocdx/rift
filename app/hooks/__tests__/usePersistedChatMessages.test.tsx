import { act, renderHook } from "@testing-library/react";
import type { ChatMessage } from "@/types/chat";
import { usePersistedChatMessages } from "../usePersistedChatMessages";

const text = (id: string, content: string, role: "user" | "assistant" = "assistant"): ChatMessage => ({ id, role, parts: [{ type: "text", text: content }] });
const current = [text("u", "Build", "user"), text("a", "Hello")];

it("applies a same-ID final answer received while streaming once the reader settles", () => {
  const messagesRef = { current };
  const serverMessages = [current[0], text("a", "Hello world")];
  const setMessages = jest.fn((messages) => { messagesRef.current = messages; });
  const { rerender } = renderHook((status: "streaming" | "ready") => usePersistedChatMessages({
    serverMessages, messagesRef, setMessages, status, enabled: true,
  }), { initialProps: "streaming" });
  expect(setMessages).not.toHaveBeenCalled();
  rerender("ready");
  expect(messagesRef.current[1].parts).toEqual(serverMessages[1].parts);
});

it("never lets a stale shorter persisted prefix erase live output after reconnect", () => {
  const messagesRef = { current: [current[0], text("a", "Hello world")] };
  const setMessages = jest.fn();
  renderHook(() => usePersistedChatMessages({ serverMessages: current, messagesRef, setMessages, status: "ready", enabled: true }));
  expect(setMessages).not.toHaveBeenCalled();
});

it("protects optimistic turns and local ordering from late server snapshots", () => {
  const messagesRef = { current: [...current, text("u2", "Next", "user")] };
  const setMessages = jest.fn();
  const { rerender } = renderHook((serverMessages) => usePersistedChatMessages({ serverMessages, messagesRef, setMessages, status: "ready", enabled: true }), { initialProps: current });
  rerender([current[0], messagesRef.current[2], current[1]]);
  expect(setMessages).not.toHaveBeenCalled();
});

it("hydrates real tool completion and metadata without dropping streamed run totals", () => {
  const input = { type: "tool-file", toolCallId: "t", state: "input-available", input: { path: "a.ts" } };
  const output = { ...input, state: "output-available", output: { content: "done" } };
  const messagesRef = { current: [{ ...text("a", "Done"), parts: [input], metadata: { totalTokens: 50 } }] as ChatMessage[] };
  const serverMessages = [{ ...messagesRef.current[0], parts: [output], metadata: { generationTimeMs: 500 } }] as ChatMessage[];
  const setMessages = jest.fn((messages) => { messagesRef.current = messages; });
  const { rerender } = renderHook(() => usePersistedChatMessages({ serverMessages, messagesRef, setMessages, status: "ready", enabled: true }));
  expect(messagesRef.current[0].parts).toEqual([output]);
  expect(messagesRef.current[0].metadata).toEqual({ totalTokens: 50, generationTimeMs: 500 });
  act(rerender);
  expect(setMessages).toHaveBeenCalledTimes(1);
});
